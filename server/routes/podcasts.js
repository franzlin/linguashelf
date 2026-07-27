import path from 'node:path'
import { deletePodcastAudioFiles, podcastAudioContentType } from './../audio.js'
import { audioDir, maxActivePodcastJobs } from './../config.js'
import { markJobCanceled } from './../job-diagnosis.js'
import {
  activePodcastJob,
  activePodcastJobs,
  enqueuePodcastJob,
  processJobQueue,
  publicJobWithContext,
} from './../jobs.js'
import { publicPodcast } from './../podcast.js'
import { shouldRateLimitPodcast } from './../quota.js'
import { consumeUserQuota } from './../ratelimit.js'
import { writeDb } from './../storage.js'
import { auth } from './../users.js'

export function registerPodcastsRoutes(app) {
  app.delete('/api/podcasts/:podcastId', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    const active = activePodcastJob(db, req.user.id, podcast.id)
    if (active && ['queued', 'running', 'paused'].includes(active.status)) {
      active.cancelRequested = true
      markJobCanceled(active)
    }
    await deletePodcastAudioFiles(podcast)
    db.podcasts = db.podcasts.filter((item) => item.id !== podcast.id)
    await writeDb(db)
    res.json({ ok: true })
  })

  app.get('/api/podcasts/:podcastId', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    res.json({ podcast: publicPodcast(podcast, { includeScript: true }) })
  })

  app.post('/api/podcasts/:podcastId/retry', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    if (activePodcastJob(db, req.user.id, podcast.id)) {
      res.status(409).json({ error: '这集播客已经在生成中' })
      return
    }
    if (activePodcastJobs(db, req.user.id).length >= maxActivePodcastJobs) {
      res.status(429).json({ error: '播客生成任务较重，请稍后重试' })
      return
    }
    if (shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast')) return
    await deletePodcastAudioFiles(podcast)
    podcast.status = 'planned'
    podcast.audio = null
    podcast.error = ''
    podcast.progress = { positionSeconds: 0, completed: false, updatedAt: '' }
    podcast.updatedAt = new Date().toISOString()
    const job = enqueuePodcastJob(db, req.user.id, podcast)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    res.json({ podcast: publicPodcast(podcast), job: publicJobWithContext(job, db) })
  })

  app.patch('/api/podcasts/:podcastId/progress', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    const duration = Number(podcast.audio?.durationSeconds || 0)
    const positionSeconds = Math.max(0, Math.min(duration || 24 * 60 * 60, Number(req.body.positionSeconds || 0)))
    podcast.progress = {
      positionSeconds,
      completed: Boolean(req.body.completed) || (duration > 0 && positionSeconds >= duration - 3),
      updatedAt: new Date().toISOString(),
    }
    podcast.updatedAt = podcast.progress.updatedAt
    await writeDb(db)
    res.json({ podcast: publicPodcast(podcast) })
  })

  app.get('/api/podcasts/:podcastId/audio', auth, async (req, res, next) => {
    try {
      const db = req.db
      const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
      if (!podcast || podcast.status !== 'ready' || !podcast.audio?.file) {
        res.status(404).json({ error: '未找到可播放的播客音频' })
        return
      }
      const audioPath = path.resolve(audioDir, podcast.audio.file)
      if (!audioPath.startsWith(path.resolve(audioDir))) {
        res.status(400).json({ error: '音频路径无效' })
        return
      }
      const format = podcast.audio.format || path.extname(podcast.audio.file).slice(1) || 'wav'
      res.setHeader('Content-Type', podcast.audio.contentType || podcastAudioContentType(format))
      res.setHeader('Cache-Control', 'no-store')
      if (req.query.download) {
        const safeTitle = `${String(podcast.title || `Podcast ${podcast.index}`).replace(/[^\w.-]+/g, '-')}.${format}`
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}"`)
      }
      res.sendFile(audioPath)
    } catch (error) {
      next(error)
    }
  })
}
