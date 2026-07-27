import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { shouldRateLimitAiText } from '../quota.js'
import { deletePodcastAudioFiles, deleteSourceFileIfSafe, deleteUnitAudioFiles } from '../audio.js'
import {
  formatMegabytes,
  maxActivePodcastJobs,
  maxEpubUploadBytes,
  maxPdfUploadBytes,
  maxPodcastEpisodes,
  podcastLexileDefault,
  podcastLexileMax,
  podcastLexileMin,
  uploadDir,
} from '../config.js'
import { parseEpub } from '../epub.js'
import { isEpubFile, isPdfFile } from '../http.js'
import {
  activeGenerationJob,
  activePodcastJob,
  activePodcastJobs,
  enqueueGenerationJob,
  enqueuePdfOcrJob,
  enqueuePodcastJob,
  processJobQueue,
  processOcrJobQueue,
  publicJob,
  publicJobWithContext,
} from '../jobs.js'
import { parsePdf, withUploadParseSlot } from '../pdf.js'
import {
  buildBookGlossary,
  normalizePodcastKind,
  planPodcastEpisodes,
  podcastKindLabel,
  publicPodcast,
  sortPodcasts,
} from '../podcast.js'
import { publicUnit } from '../progress.js'
import { consumeUserQuota } from '../ratelimit.js'
import { userSettings } from '../settings.js'
import { readDb, writeDb } from '../storage.js'
import { recordAiUsage } from '../telemetry.js'
import { normalizeText } from '../text.js'
import { normalizePodcastVoice } from '../tts.js'
import {
  applyBookUnitReplan,
  bookReplanSafety,
  planUnits,
  prepareBookUnitReplan,
  replanBlockedError,
  withBookReplanLock,
} from '../units.js'
import { shouldRateLimitPodcast } from './../quota.js'
import { auth } from './../users.js'
import { limitBookUpload, uploadBookFile } from './../upload.js'
import { summarizeBook } from './../stats.js'

export function registerBooksRoutes(app) {
  app.post('/api/books/upload', auth, limitBookUpload, uploadBookFile, async (req, res, next) => {
    let temporaryPath = req.file?.path || ''
    let movedSourcePath = ''
    let persisted = false
    try {
      if (!req.file) {
        res.status(400).json({ error: '请选择 EPUB 或 PDF 文件' })
        return
      }

      const original = req.file.originalname || 'book'
      const ext = path.extname(original).toLowerCase()
      if (!['.epub', '.pdf'].includes(ext)) {
        res.status(400).json({ error: '目前支持 EPUB 和 PDF 文件' })
        return
      }
      if (ext === '.epub' && req.file.size > maxEpubUploadBytes) {
        res.status(400).json({ error: `EPUB 第一版建议不超过 ${formatMegabytes(maxEpubUploadBytes)}` })
        return
      }
      if (ext === '.pdf' && req.file.size > maxPdfUploadBytes) {
        res.status(400).json({ error: `PDF 第一版建议不超过 ${formatMegabytes(maxPdfUploadBytes)}` })
        return
      }
      await withUploadParseSlot(async () => {
        const buffer = await fs.readFile(temporaryPath)
        if (ext === '.epub' && !(await isEpubFile(buffer))) {
          res.status(400).json({ error: '文件内容不像有效的 EPUB，请确认文件没有损坏' })
          return
        }
        if (ext === '.pdf' && !isPdfFile(buffer)) {
          res.status(400).json({ error: '文件内容不像有效的 PDF，请确认文件没有损坏' })
          return
        }

        const parsed = ext === '.epub' ? await parseEpub(buffer, original) : await parsePdf(buffer, original, { deferOcr: true })
        const db = await readDb()
        const settings = userSettings(db, req.user.id)
        const bookId = nanoid()
        let sourcePath = ''
        if (settings.keepSourceFiles || parsed.needsOcr) {
          const userDir = path.join(uploadDir, req.user.id)
          await fs.mkdir(userDir, { recursive: true })
          sourcePath = path.join(userDir, `${bookId}${ext}`)
          await fs.rename(temporaryPath, sourcePath)
          temporaryPath = ''
          movedSourcePath = sourcePath
        }

        const book = {
          id: bookId,
          userId: req.user.id,
          title: parsed.title,
          author: parsed.author,
          type: parsed.type,
          filename: original,
          sourcePath,
          sourceTemporary: Boolean(parsed.needsOcr && !settings.keepSourceFiles),
          chapterCount: parsed.chapters.length,
          wordCount: parsed.chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
          status: parsed.needsOcr ? 'processing' : 'ready',
          createdAt: new Date().toISOString(),
        }
        const units = planUnits(bookId, parsed.chapters, parsed.type)
        db.books.push(book)
        db.units.push(...units)
        if (parsed.needsOcr) {
          const job = enqueuePdfOcrJob(db, req.user.id, book, parsed.pageCount, req.file.size)
          await writeDb(db)
          persisted = true
          setTimeout(processOcrJobQueue, 0)
          res.status(202).json({
            book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) },
            units: [],
            job: publicJobWithContext(job, db),
          })
          return
        }
        if (parsed.ocr) {
          recordAiUsage(db, {
            userId: req.user.id,
            category: 'ocr',
            action: 'pdf-ocr',
            provider: parsed.ocr.provider,
            model: parsed.ocr.provider,
            pages: parsed.ocr.pagesAttempted || parsed.ocr.pages,
            bytes: req.file.size,
            success: true,
          })
        }
        await writeDb(db)
        persisted = true

        res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) }, units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
      })
    } catch (error) {
      next(error)
    } finally {
      if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (movedSourcePath && !persisted) await deleteSourceFileIfSafe(movedSourcePath)
    }
  })

  app.get('/api/books/:bookId', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) }, units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
  })

  app.patch('/api/books/:bookId', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const title = normalizeText(req.body.title || '').replace(/\s+/g, ' ').slice(0, 160)
    if (title.length < 1) {
      res.status(400).json({ error: '书名不能为空' })
      return
    }

    const previousTitle = book.title
    book.title = title
    book.updatedAt = new Date().toISOString()
    for (const report of db.reports.filter((item) => item.userId === req.user.id && item.bookId === book.id)) {
      report.bookTitle = title
    }
    for (const item of db.vocabulary.filter((entry) => entry.userId === req.user.id && entry.sourceBookTitle === previousTitle)) {
      item.sourceBookTitle = title
    }
    await writeDb(db)
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) } })
  })

  app.post('/api/books/:bookId/replan', auth, async (req, res, next) => {
    try {
      const previewOnly = req.body?.preview === true
      const db = req.db
      const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
      if (!book) {
        res.status(404).json({ error: '未找到这本书' })
        return
      }
      if (!consumeUserQuota(req, res, 'upload')) return
      if (previewOnly) {
        const prepared = await withUploadParseSlot(() => prepareBookUnitReplan(db, book))
        res.json({
          preview: {
            allowed: prepared.allowed,
            blockers: prepared.blockers,
            previous: prepared.previous,
            proposed: prepared.proposed,
            historicalJobCount: prepared.historicalJobCount,
          },
        })
        return
      }

      const expectedPreviousUnitCount = Number(req.body?.expectedPreviousUnitCount)
      const result = await withBookReplanLock(book.id, async () => {
        const initialDb = await readDb()
        const initialBook = initialDb.books.find((item) => item.id === book.id && item.userId === req.user.id)
        if (!initialBook) {
          const error = new Error('未找到这本书')
          error.status = 404
          throw error
        }
        const prepared = await withUploadParseSlot(() => prepareBookUnitReplan(initialDb, initialBook))
        if (!prepared.allowed) throw replanBlockedError(prepared.blockers)
        if (Number.isInteger(expectedPreviousUnitCount) && prepared.previous.unitCount !== expectedPreviousUnitCount) {
          const error = new Error('单元数量在确认后发生变化，请重新预览')
          error.status = 409
          throw error
        }

        const latestDb = await readDb()
        const latestBook = latestDb.books.find((item) => item.id === book.id && item.userId === req.user.id)
        if (!latestBook) {
          const error = new Error('未找到这本书')
          error.status = 404
          throw error
        }
        const latestSafety = bookReplanSafety(latestDb, latestBook)
        if (!latestSafety.allowed) throw replanBlockedError(latestSafety.blockers)
        if (latestSafety.existingUnits.length !== prepared.previous.unitCount) {
          const error = new Error('单元或学习状态在重建过程中发生变化，请重新预览')
          error.status = 409
          throw error
        }
        const applied = applyBookUnitReplan(latestDb, latestBook, prepared)
        await writeDb(latestDb)
        return { ...applied, db: latestDb }
      })
      res.json({
        book: { ...summarizeBook(result.book, result.units), glossary: buildBookGlossary(result.book, result.units) },
        units: result.units.map((unit) => publicUnit(unit, result.db, req.user.id)),
        previousUnitCount: result.previousUnitCount,
        preview: result.preview,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/books/:bookId', auth, async (req, res, next) => {
    try {
      const db = req.db
      const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
      if (!book) {
        res.status(404).json({ error: '未找到这本书' })
        return
      }

      const units = db.units.filter((unit) => unit.bookId === book.id)
      const unitIds = new Set(units.map((unit) => unit.id))
      const podcasts = db.podcasts.filter((podcast) => podcast.bookId === book.id && podcast.userId === req.user.id)
      const podcastIds = new Set(podcasts.map((podcast) => podcast.id))
      const jobs = db.jobs.filter(
        (job) =>
          job.userId === req.user.id &&
          (job.bookId === book.id || unitIds.has(job.unitId) || podcastIds.has(job.podcastId))
      )
      const runningJobs = jobs.filter((job) => job.status === 'running')
      if (runningJobs.length) {
        res.status(409).json({ error: '这本书还有正在运行的生成任务，请稍后再删除，或先到任务中心取消任务' })
        return
      }
      const jobIds = new Set(jobs.map((job) => job.id))
      const progressCount = db.progress.filter((item) => !item.userId || (item.userId === req.user.id && unitIds.has(item.unitId))).length
      const reportCount = db.reports.filter((report) => report.bookId === book.id || unitIds.has(report.unitId)).length

      await Promise.all([
        ...podcasts.map((podcast) => deletePodcastAudioFiles(podcast)),
        ...units.map((unit) => deleteUnitAudioFiles(unit)),
        deleteSourceFileIfSafe(book.sourcePath),
      ])

      db.books = db.books.filter((item) => item.id !== book.id)
      db.units = db.units.filter((unit) => unit.bookId !== book.id)
      db.progress = db.progress.filter((item) => !unitIds.has(item.unitId))
      db.reports = db.reports.filter((report) => report.bookId !== book.id && !unitIds.has(report.unitId))
      db.jobs = db.jobs.filter((job) => !jobIds.has(job.id))
      db.podcasts = db.podcasts.filter((podcast) => podcast.bookId !== book.id || podcast.userId !== req.user.id)
      db.errorLogs = (db.errorLogs || []).filter((log) => !unitIds.has(log.unitId) && !podcastIds.has(log.podcastId) && !jobIds.has(log.jobId))

      await writeDb(db)
      res.json({
        ok: true,
        deleted: {
          book: 1,
          units: units.length,
          reports: reportCount,
          progress: progressCount,
          jobs: jobs.length,
          podcasts: podcasts.length,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/books/:bookId/pre-generate', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const maxBatch = Number(process.env.MAX_BATCH_GENERATE_UNITS || 5)
    const requested = Math.max(1, Math.min(maxBatch, Number(req.body.count || 3)))
    const settings = userSettings(db, req.user.id)
    const candidates = db.units
      .filter((unit) => unit.bookId === book.id && !unit.content && !activeGenerationJob(db, req.user.id, unit.id))
      .slice(0, requested)

    if (candidates.length && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit', candidates.length)) return

    const jobs = candidates.map((unit) =>
      enqueueGenerationJob(db, req.user.id, unit, settings, {
        readingLevel: req.body.readingLevel,
        listeningLevel: req.body.listeningLevel,
      })
    )
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({
      book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) },
      units: units.map((unit) => publicUnit(unit, db, req.user.id)),
      jobs: jobs.map(publicJob),
      enqueued: jobs.length,
      maxBatch,
    })
  })

  app.get('/api/books/:bookId/podcasts', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }
    const podcasts = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id)
      .sort(sortPodcasts)
      .map((podcast) => publicPodcast(podcast))
    res.json({ podcasts })
  })

  app.post('/api/books/:bookId/podcasts/generate', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const kind = normalizePodcastKind(req.body.kind)
    const existing = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
      .sort(sortPodcasts)
    const requestedCount = Math.max(0, Math.min(maxPodcastEpisodes, Number(req.body.count || 0)))
    const existingJobs = db.jobs.filter((job) => job.userId === req.user.id && job.type === 'generate-podcast' && existing.some((podcast) => podcast.id === job.podcastId))
    const kindHasActiveJob = existingJobs.some((job) => ['queued', 'running', 'paused'].includes(job.status))
    if (requestedCount && !req.body.force && kindHasActiveJob) {
      res.json({
        podcasts: existing.map((podcast) => publicPodcast(podcast)),
        jobs: existingJobs.map((job) => publicJobWithContext(job, db)),
        enqueued: 0,
      })
      return
    }
    if (existing.length && !req.body.force && !requestedCount) {
      res.json({ podcasts: existing.map((podcast) => publicPodcast(podcast)), jobs: existingJobs.map((job) => publicJobWithContext(job, db)), enqueued: 0 })
      return
    }

    const active = activePodcastJobs(db, req.user.id)
    if (active.length >= maxActivePodcastJobs) {
      res.status(429).json({ error: `播客生成任务较重，请等待当前 ${active.length} 个任务完成后再试` })
      return
    }

    const units = db.units.filter((unit) => unit.bookId === book.id)
    const groups = planPodcastEpisodes(book, units, kind)
    if (!groups.length) {
      res.status(400).json({ error: '这本书还没有可用于播客的正文单元' })
      return
    }

    const settings = userSettings(db, req.user.id)
    const now = new Date().toISOString()
    if (req.body.force && existing.length) {
      for (const podcast of existing) {
        await deletePodcastAudioFiles(podcast)
      }
      db.podcasts = db.podcasts.filter((item) => !(item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind))
      db.jobs = db.jobs.filter((job) => !(job.userId === req.user.id && job.type === 'generate-podcast' && existing.some((podcast) => podcast.id === job.podcastId)))
    }

    const kindLabel = podcastKindLabel(kind)
    const activeIndexes = new Set(
      (req.body.force ? [] : existing)
        .filter((podcast) => activePodcastJob(db, req.user.id, podcast.id))
        .map((podcast) => Number(podcast.index || 0))
    )
    const existingIndexes = new Set((req.body.force ? [] : existing).map((podcast) => Number(podcast.index || 0)))
    const plannedGroups = groups
      .map((group, index) => ({ group, index }))
      .filter((item) => req.body.force || (!existingIndexes.has(item.index + 1) && !activeIndexes.has(item.index + 1)))
      .slice(0, requestedCount || groups.length)

    if (!plannedGroups.length) {
      const current = db.podcasts
        .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
        .sort(sortPodcasts)
      res.json({ podcasts: current.map((podcast) => publicPodcast(podcast)), jobs: [], enqueued: 0, remaining: 0 })
      return
    }
    if (shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast', plannedGroups.length)) return

    const podcasts = plannedGroups.map(({ group, index }) => ({
      id: nanoid(),
      userId: req.user.id,
      bookId: book.id,
      index: index + 1,
      kind,
      kindLabel,
      title: kind === 'topic' ? kindLabel : `${kindLabel} ${index + 1}`,
      status: 'planned',
      sourceUnitIds: group.unitIds,
      sourceText: group.text,
      sourceWordCount: group.words,
      lexile: Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault))),
      voice: normalizePodcastVoice(settings.podcastVoice),
      scriptText: null,
      scriptMode: '',
      scriptPartCount: 0,
      audio: null,
      progress: {
        positionSeconds: 0,
        completed: false,
        updatedAt: '',
      },
      jobId: '',
      error: '',
      createdAt: now,
      updatedAt: now,
    }))
    const jobs = podcasts.map((podcast) => enqueuePodcastJob(db, req.user.id, podcast))
    db.podcasts.push(...podcasts)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    const current = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
      .sort(sortPodcasts)
    res.json({
      podcasts: current.map((podcast) => publicPodcast(podcast)),
      jobs: jobs.map((job) => publicJobWithContext(job, db)),
      enqueued: jobs.length,
      remaining: Math.max(0, groups.length - current.length),
    })
  })
}
