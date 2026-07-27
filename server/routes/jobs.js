import { clearJobDiagnosis, diagnoseJobError, markJobCanceled } from './../job-diagnosis.js'
import { enqueueGenerationJob, processJobQueue, publicJobWithContext } from './../jobs.js'
import { publicPodcast } from './../podcast.js'
import { publicUnit } from './../progress.js'
import { shouldRateLimitAiText, shouldRateLimitPodcast } from './../quota.js'
import { consumeUserQuota } from './../ratelimit.js'
import { userSettings } from './../settings.js'
import { summarizeBook } from './../stats.js'
import { writeDb } from './../storage.js'
import { auth } from './../users.js'

export function registerJobsRoutes(app) {
  app.get('/api/jobs/:jobId', auth, async (req, res) => {
    const db = req.db
    const job = db.jobs.find((item) => item.id === req.params.jobId && item.userId === req.user.id)
    if (!job) {
      res.status(404).json({ error: '未找到这个任务' })
      return
    }
    const unit = db.units.find((item) => item.id === job.unitId)
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === req.user.id)
    const book = db.books.find((item) => item.id === job.bookId && item.userId === req.user.id)
    res.json({
      job: publicJobWithContext(job, db),
      unit: publicUnit(unit, db, req.user.id),
      podcast: publicPodcast(podcast),
      book: book ? summarizeBook(book, db.units.filter((item) => item.bookId === book.id)) : null,
    })
  })

  app.get('/api/jobs', auth, async (req, res) => {
    const db = req.db
    const status = String(req.query.status || '')
    const type = String(req.query.type || '')
    const errorCode = String(req.query.errorCode || '')
    const jobs = db.jobs
      .filter((job) => {
        if (job.userId !== req.user.id) return false
        if (status && job.status !== status) return false
        if (type && job.type !== type) return false
        if (errorCode && (job.errorCode || diagnoseJobError(job, job.error || job.message).errorCode) !== errorCode) return false
        return true
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map((job) => publicJobWithContext(job, db))
    res.json({ jobs })
  })

  app.patch('/api/jobs/:jobId', auth, async (req, res) => {
    const db = req.db
    const job = db.jobs.find((item) => item.id === req.params.jobId && item.userId === req.user.id)
    if (!job) {
      res.status(404).json({ error: '未找到这个任务' })
      return
    }
    const unit = db.units.find((item) => item.id === job.unitId)
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === req.user.id)
    const book = db.books.find((item) => item.id === job.bookId && item.userId === req.user.id)
    const action = String(req.body.action || '')
    const now = new Date().toISOString()

    if (action === 'pause' && job.status === 'queued') {
      job.status = 'paused'
      job.message = '任务已暂停'
      job.updatedAt = now
    } else if (action === 'resume' && job.status === 'paused') {
      job.status = 'queued'
      job.message = '已恢复排队'
      job.updatedAt = now
      setTimeout(job.type === 'parse-pdf-ocr' ? processOcrJobQueue : processJobQueue, 0)
    } else if (action === 'cancel' && ['queued', 'paused'].includes(job.status)) {
      markJobCanceled(job)
      if (podcast) {
        podcast.status = 'failed'
        podcast.error = job.message
        podcast.updatedAt = job.updatedAt
      }
      if (book && job.type === 'parse-pdf-ocr') {
        book.status = 'failed'
        book.error = job.message
        book.updatedAt = job.updatedAt
      }
    } else if (action === 'cancel' && job.status === 'running') {
      job.cancelRequested = true
      job.message = '任务将在当前生成结束后取消'
      job.updatedAt = now
    } else if (['retry', 'retry-fallback'].includes(action) && ['failed', 'canceled'].includes(job.status)) {
      if (job.type === 'generate-podcast' && shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast')) return
      if (job.type === 'generate-unit' && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      if (action === 'retry-fallback' && job.type !== 'generate-podcast') {
        res.status(400).json({ error: '只有播客任务支持备用 TTS 来源重试' })
        return
      }
      job.status = 'queued'
      job.progress = 0
      job.error = ''
      clearJobDiagnosis(job)
      job.cancelRequested = false
      job.preferTtsFallback = action === 'retry-fallback'
      job.retryCount = Number(job.retryCount || 0) + 1
      job.message = action === 'retry-fallback' ? '已用备用 TTS 来源重新加入队列' : '已重新加入队列'
      job.finishedAt = null
      job.updatedAt = now
      if (unit) {
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'queued',
          progress: 0,
          message: job.message,
        }
      }
      if (podcast) {
        podcast.status = 'planned'
        podcast.error = ''
        podcast.preferTtsFallback = action === 'retry-fallback'
        podcast.updatedAt = now
      }
      if (book && job.type === 'parse-pdf-ocr') {
        book.status = 'processing'
        book.error = ''
        book.updatedAt = now
      }
      setTimeout(job.type === 'parse-pdf-ocr' ? processOcrJobQueue : processJobQueue, 0)
    } else if (action === 'retry' && job.status === 'succeeded' && unit) {
      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const settings = userSettings(db, req.user.id)
      const nextJob = enqueueGenerationJob(db, req.user.id, unit, settings, { force: Boolean(unit.content) })
      await writeDb(db)
      setTimeout(processJobQueue, 0)
      res.json({ job: publicJobWithContext(nextJob, db), unit: publicUnit(unit, db, req.user.id) })
      return
    } else {
      res.status(400).json({ error: '当前任务状态不支持这个操作' })
      return
    }

    if (unit && ['paused', 'canceled'].includes(job.status)) {
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: job.status,
        progress: job.progress || 0,
        message: job.message,
      }
    }
    await writeDb(db)
    res.json({
      job: publicJobWithContext(job, db),
      unit: publicUnit(unit, db, req.user.id),
      podcast: publicPodcast(podcast),
      book: book ? summarizeBook(book, db.units.filter((item) => item.bookId === book.id)) : null,
    })
  })
}
