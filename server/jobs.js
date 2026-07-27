// Background job queue: unit generation, batch pre-generation, podcast
// synthesis and PDF OCR.
//
// Jobs run one at a time per kind and are resumable: `recoverInterruptedJobs`
// re-queues anything left running when the process died, so a restart mid-job
// does not strand a book in "generating" forever.
import fs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import {
  autoFailureRetryBaseSeconds,
  maxActivePodcastJobs,
  maxAutoRegenAttempts,
  maxPodcastEpisodes,
  pdfOcrMaxPages,
  podcastLexileDefault,
} from './config.js'
import { readDb, writeDb } from './storage.js'
import { assessContentQuality, fidelityRepairNotesFromQuality, isLowFidelityQuality } from './quality.js'
import { podcastGeminiFallbackConfig, podcastGeminiOfficialConfig, podcastQwenConfig } from './ai-runtime.js'
import { estimateTextTokens, takeWords, wordCount } from './text.js'
import { groupPdfPages, parsePdf, withUploadParseSlot } from './pdf.js'
import { hasEnoughOcrText, normalizeOcrText, ocrPdfFallback, shouldUseVisionOcr, withOcrSlot } from './ocr.js'
import { planUnits } from './units.js'
import { buildGeneratedContent, generationSettingsFromBody } from './content.js'
import { applyGeneratedContent, publicUnit } from './progress.js'
import { repairLowQualityParagraphs } from './repair.js'
import { generatePodcastScript, normalizePodcastKind, planPodcastEpisodes, publicPodcast } from './podcast.js'
import { podcastTtsPriority, synthesizePodcastAudio } from './tts.js'
import { chunkTextForTts, deletePodcastAudioFiles, estimateTtsInputTokens, pcmDurationSeconds } from './audio.js'
import { userSettings } from './settings.js'
import { appendErrorLog, persistAiUsage, recordAiUsage, shouldRecordTextAiUsage, textAiUsageSource } from './telemetry.js'
import {
  applyJobDiagnosis,
  canAutoRetryJob,
  clearJobDiagnosis,
  diagnoseJobError,
  jobNextAction,
  jobUsageSummary,
  markJobCanceled,
  markJobFailed,
  parseStatusCode,
  promoteDueAutoRetryJobs,
  scheduleAutoRetryJob,
  secondsUntil,
} from './job-diagnosis.js'

export let ocrJobQueueActive = false

export let jobQueueActive = false

export function publicJob(job, db = null) {
  if (!job) return null
  const fallbackDiagnosis =
    !job.errorHint && ['failed', 'canceled'].includes(job.status) && (job.error || job.message)
      ? diagnoseJobError(job, job.error || job.message, { stage: job.status === 'canceled' ? 'cancel' : '' })
      : null
  const nextAction = jobNextAction({
    ...job,
    errorCode: job.errorCode || fallbackDiagnosis?.errorCode || '',
    retryable: job.retryable === undefined ? fallbackDiagnosis?.retryable !== false : job.retryable !== false,
  })
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    unitId: job.unitId,
    podcastId: job.podcastId,
    bookId: job.bookId,
    processedPages: Number(job.processedPages || 0),
    totalPages: Number(job.totalPages || 0),
    progress: job.progress || 0,
    message: job.message || '',
    error: job.error || '',
    errorStage: job.errorStage || fallbackDiagnosis?.errorStage || '',
    errorCode: job.errorCode || fallbackDiagnosis?.errorCode || '',
    errorHint: job.errorHint || fallbackDiagnosis?.errorHint || '',
    retryable: job.retryable === undefined ? fallbackDiagnosis?.retryable !== false : job.retryable !== false,
    provider: job.provider || fallbackDiagnosis?.provider || '',
    statusCode: job.statusCode || fallbackDiagnosis?.statusCode || null,
    retryCount: Number(job.retryCount || 0),
    qualityStatus: job.qualityStatus || '',
    autoRetryAt: job.autoRetryAt || '',
    autoRetryDelaySeconds: Number(job.autoRetryDelaySeconds || 0),
    autoRetryReason: job.autoRetryReason || '',
    lastError: job.lastError || '',
    lastErrorCode: job.lastErrorCode || '',
    lastErrorStage: job.lastErrorStage || '',
    canRetryNow: !job.autoRetryAt || secondsUntil(job.autoRetryAt) <= 0,
    usageSummary: db ? jobUsageSummary(job, db) : null,
    ...nextAction,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  }
}

export function publicJobWithContext(job, db) {
  const output = publicJob(job, db)
  if (!output) return null
  const unit = db.units.find((item) => item.id === job.unitId)
  const podcast = db.podcasts.find((item) => item.id === job.podcastId)
  const book = unit
    ? db.books.find((item) => item.id === unit.bookId)
    : podcast
      ? db.books.find((item) => item.id === podcast.bookId)
      : db.books.find((item) => item.id === job.bookId)
  return {
    ...output,
    unitTitle: unit?.title || '',
    podcastTitle: podcast?.title || '',
    bookTitle: book?.title || '',
  }
}

export function activeGenerationJob(db, userId, unitId) {
  return db.jobs.find(
    (job) =>
      job.userId === userId &&
      job.unitId === unitId &&
      job.type === 'generate-unit' &&
      ['queued', 'running', 'paused'].includes(job.status)
  )
}

export function enqueueGenerationJob(db, userId, unit, settings, body = {}) {
  const active = activeGenerationJob(db, userId, unit.id)
  if (active) return active

  const generationSettings = generationSettingsFromBody(settings, body)
  const now = new Date().toISOString()
  const job = {
    id: nanoid(),
    userId,
    type: 'generate-unit',
    status: 'queued',
    progress: 0,
    message: generationSettings.fidelityMode === 'strict' ? '已加入忠实度修复队列' : '已加入生成队列',
    unitId: unit.id,
    bookId: unit.bookId,
    force: Boolean(body.force),
    settings: {
      readingLevel: generationSettings.readingLevel,
      listeningLevel: generationSettings.listeningLevel,
      fidelityMode: generationSettings.fidelityMode,
    },
    createdAt: now,
    updatedAt: now,
  }
  db.jobs.push(job)
  unit.generation = {
    jobId: job.id,
    status: 'queued',
    progress: 0,
    message: job.message,
    requestedAt: now,
    readingLevel: generationSettings.readingLevel,
    listeningLevel: generationSettings.listeningLevel,
  }
  return job
}

export function activePodcastJobs(db, userId) {
  return db.jobs.filter((job) => job.userId === userId && job.type === 'generate-podcast' && ['queued', 'running'].includes(job.status))
}

export function activePodcastJob(db, userId, podcastId) {
  return db.jobs.find(
    (job) =>
      job.userId === userId &&
      job.podcastId === podcastId &&
      job.type === 'generate-podcast' &&
      ['queued', 'running', 'paused'].includes(job.status)
  )
}

export function enqueuePodcastJob(db, userId, podcast) {
  const active = activePodcastJob(db, userId, podcast.id)
  if (active) return active

  const now = new Date().toISOString()
  podcast.kind = normalizePodcastKind(podcast.kind)
  const job = {
    id: nanoid(),
    userId,
    type: 'generate-podcast',
    status: 'queued',
    progress: 0,
    message: '播客已加入生成队列',
    podcastId: podcast.id,
    bookId: podcast.bookId,
    createdAt: now,
    updatedAt: now,
  }
  db.jobs.push(job)
  podcast.jobId = job.id
  podcast.status = 'planned'
  podcast.error = ''
  podcast.updatedAt = now
  return job
}

export function enqueuePdfOcrJob(db, userId, book, pageCount, fileBytes) {
  const active = db.jobs.find(
    (job) => job.userId === userId && job.bookId === book.id && job.type === 'parse-pdf-ocr' && ['queued', 'running', 'paused'].includes(job.status)
  )
  if (active) return active
  const now = new Date().toISOString()
  const job = {
    id: nanoid(),
    userId,
    type: 'parse-pdf-ocr',
    status: 'queued',
    progress: 2,
    message: '扫描 PDF 已加入 OCR 队列',
    bookId: book.id,
    totalPages: Math.min(Math.max(1, Number(pageCount || 1)), pdfOcrMaxPages),
    processedPages: 0,
    fileBytes: Number(fileBytes || 0),
    createdAt: now,
    updatedAt: now,
  }
  db.jobs.push(job)
  book.status = 'processing'
  book.processingJobId = job.id
  book.error = ''
  book.updatedAt = now
  return job
}

export async function updatePdfOcrJobProgress(jobId, info) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId && item.type === 'parse-pdf-ocr')
  if (!job) throw new Error('OCR 任务已不存在')
  if (job.cancelRequested) {
    const error = new Error('任务已取消')
    error.code = 'OCR_TASK_CANCELED'
    throw error
  }
  const book = db.books.find((item) => item.id === job.bookId && item.userId === job.userId)
  const page = Math.max(0, Number(info.page || 0))
  const total = Math.max(1, Number(info.total || job.totalPages || 1))
  job.processedPages = page
  job.totalPages = total
  job.progress = Math.max(Number(job.progress || 0), Math.min(90, 10 + Math.round((page / total) * 80)))
  job.provider = info.provider || job.provider || ''
  job.message = `${job.provider || 'OCR'} 正在识别第 ${page}/${total} 页`
  job.updatedAt = new Date().toISOString()
  if (book) {
    book.status = 'processing'
    book.updatedAt = job.updatedAt
  }
  await writeDb(db)
}

export async function processPdfOcrJob(jobId) {
  let db = await readDb()
  let job = db.jobs.find((item) => item.id === jobId && item.type === 'parse-pdf-ocr')
  let book = job ? db.books.find((item) => item.id === job.bookId && item.userId === job.userId) : null
  if (!job) return
  if (!book?.sourcePath) {
    markJobFailed(job, 'OCR 原始 PDF 不存在', { stage: 'pdf-ocr' })
    if (book) {
      book.status = 'failed'
      book.error = job.error
    }
    await writeDb(db)
    return
  }

  job.status = 'running'
  job.progress = Math.max(5, Number(job.progress || 0))
  job.message = '正在准备扫描 PDF OCR'
  job.startedAt = job.startedAt || new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  book.status = 'processing'
  book.error = ''
  book.updatedAt = job.updatedAt
  await writeDb(db)

  try {
    const buffer = await fs.readFile(book.sourcePath)
    const ocrResult = await withOcrSlot(() =>
      ocrPdfFallback(buffer, job.totalPages || 1, (info) => updatePdfOcrJobProgress(jobId, info))
    )
    const chapters = groupPdfPages(ocrResult.pages)
    if (!chapters.length) throw new Error('OCR 已完成，但可用于生成学习单元的英文正文太少')

    db = await readDb()
    job = db.jobs.find((item) => item.id === jobId && item.type === 'parse-pdf-ocr')
    book = job ? db.books.find((item) => item.id === job.bookId && item.userId === job.userId) : null
    if (!job || !book) return
    if (job.cancelRequested) {
      markJobCanceled(job)
      book.status = 'failed'
      book.error = job.message
      book.updatedAt = job.updatedAt
      await writeDb(db)
      return
    }

    const units = planUnits(book.id, chapters, 'pdf')
    db.units = db.units.filter((unit) => unit.bookId !== book.id)
    db.units.push(...units)
    book.chapterCount = chapters.length
    book.wordCount = chapters.reduce((total, chapter) => total + Number(chapter.wordCount || wordCount(chapter.text)), 0)
    book.status = 'ready'
    book.ocr = {
      provider: ocrResult.provider,
      pages: ocrResult.pages.length,
      pagesAttempted: ocrResult.pagesAttempted,
    }
    book.error = ''
    book.updatedAt = new Date().toISOString()
    job.status = 'succeeded'
    job.progress = 100
    job.processedPages = ocrResult.pagesAttempted
    job.provider = ocrResult.provider
    job.message = `OCR 完成，已生成 ${units.length} 个学习单元`
    job.finishedAt = book.updatedAt
    job.updatedAt = book.updatedAt
    clearJobDiagnosis(job)
    recordAiUsage(db, {
      userId: job.userId,
      jobId: job.id,
      category: 'ocr',
      action: 'pdf-ocr',
      provider: ocrResult.provider,
      model: ocrResult.provider,
      pages: ocrResult.pagesAttempted || ocrResult.pages.length,
      bytes: job.fileBytes || 0,
      success: true,
    })

    const keepSource = Boolean(userSettings(db, job.userId).keepSourceFiles)
    const temporarySourcePath = book.sourceTemporary && !keepSource ? book.sourcePath : ''
    if (temporarySourcePath) {
      book.sourcePath = ''
      book.sourceTemporary = false
    }
    await writeDb(db)
    if (temporarySourcePath) await fs.rm(temporarySourcePath, { force: true }).catch(() => undefined)
  } catch (error) {
    db = await readDb()
    job = db.jobs.find((item) => item.id === jobId && item.type === 'parse-pdf-ocr')
    book = job ? db.books.find((item) => item.id === job.bookId && item.userId === job.userId) : null
    if (!job) return
    if (error?.code === 'OCR_TASK_CANCELED' || job.cancelRequested) {
      markJobCanceled(job)
    } else {
      markJobFailed(job, error?.message || 'PDF OCR 失败', { stage: 'pdf-ocr', message: '扫描 PDF 解析失败' })
      scheduleAutoRetryJob(job)
      recordAiUsage(db, {
        userId: job.userId,
        jobId: job.id,
        category: 'ocr',
        action: 'pdf-ocr',
        provider: job.provider || 'OCR',
        model: job.provider || '',
        pages: job.processedPages || 0,
        bytes: job.fileBytes || 0,
        success: false,
        statusCode: job.statusCode,
        errorCode: job.errorCode,
        message: job.error,
      })
      appendErrorLog(db, {
        scope: 'job',
        message: job.error,
        detail: job.errorHint || '',
        userId: job.userId,
        jobId: job.id,
        bookId: job.bookId,
        statusCode: job.statusCode,
        errorCode: job.errorCode,
      })
    }
    if (book) {
      book.status = 'failed'
      book.error = job.error || job.message
      book.updatedAt = job.updatedAt
    }
    await writeDb(db)
    if (job.autoRetryAt) setTimeout(processOcrJobQueue, Math.max(250, secondsUntil(job.autoRetryAt) * 1000 + 250))
  }
}

export async function processOcrJobQueue() {
  if (ocrJobQueueActive) return
  ocrJobQueueActive = true
  try {
    while (true) {
      const db = await readDb()
      const autoRetry = promoteDueAutoRetryJobs(db, ['parse-pdf-ocr'])
      if (autoRetry.changed) await writeDb(db)
      if (autoRetry.nextDelayMs) setTimeout(processOcrJobQueue, Math.min(autoRetry.nextDelayMs + 250, 2_147_483_647))
      const job = db.jobs.find((item) => item.type === 'parse-pdf-ocr' && item.status === 'queued')
      if (!job) break
      await processPdfOcrJob(job.id)
    }
  } finally {
    ocrJobQueueActive = false
  }
}

export async function recoverInterruptedJobs() {
  const db = await readDb()
  let changed = false
  for (const job of db.jobs) {
    if (job.status !== 'running') continue
    job.status = 'queued'
    job.progress = 0
    job.message = '服务重启后重新排队'
    job.updatedAt = new Date().toISOString()
    const unit = db.units.find((item) => item.id === job.unitId)
    if (unit?.generation?.jobId === job.id) {
      unit.generation.status = 'queued'
      unit.generation.progress = 0
      unit.generation.message = job.message
    }
    const podcast = db.podcasts.find((item) => item.id === job.podcastId)
    if (podcast?.jobId === job.id) {
      podcast.status = podcast.scriptText ? 'synthesizing' : 'planned'
      podcast.updatedAt = job.updatedAt
    }
    const book = job.type === 'parse-pdf-ocr' ? db.books.find((item) => item.id === job.bookId) : null
    if (book) {
      book.status = 'processing'
      book.error = ''
      book.updatedAt = job.updatedAt
    }
    changed = true
  }
  if (changed) await writeDb(db)
  setTimeout(processJobQueue, 0)
  setTimeout(processOcrJobQueue, 0)
}

export async function updatePodcastJobProgress(podcastId, jobId, progress, message) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId)
  const podcast = db.podcasts.find((item) => item.id === podcastId)
  if (!job || !podcast) return
  job.progress = Math.max(job.progress || 0, Math.min(99, progress))
  job.message = message || job.message
  job.updatedAt = new Date().toISOString()
  podcast.updatedAt = job.updatedAt
  await writeDb(db)
}

export async function failPodcastJob(jobId, message, options = {}) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId)
  if (!job) return
  const podcast = db.podcasts.find((item) => item.id === job.podcastId)
  if (options.status === 'canceled') {
    markJobCanceled(job, message || '任务已取消')
  } else {
    markJobFailed(job, message || '播客生成失败', { ...options, message: '播客生成失败' })
  }
  const scheduledAutoRetry = job.status === 'failed' ? scheduleAutoRetryJob(job) : false
  if (podcast) {
    podcast.status = 'failed'
    podcast.error = job.error || job.message
    podcast.updatedAt = job.updatedAt
  }
  if (job.status === 'failed') {
    appendErrorLog(db, {
      scope: 'job',
      message: job.error || job.message,
      detail: job.errorHint || '',
      userId: job.userId,
      jobId: job.id,
      podcastId: job.podcastId,
      statusCode: job.statusCode,
      errorCode: job.errorCode,
    })
  }
  await writeDb(db)
  if (scheduledAutoRetry) setTimeout(processJobQueue, Math.min(Number(job.autoRetryDelaySeconds || autoFailureRetryBaseSeconds) * 1000 + 250, 2_147_483_647))
}

export async function processPodcastJob(jobId) {
  let db = await readDb()
  let job = db.jobs.find((item) => item.id === jobId)
  let podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  const user = job ? db.users.find((item) => item.id === job.userId) : null
  if (!job) return
  if (!podcast || !user) {
    await failPodcastJob(job.id, '播客或用户不存在', { stage: 'podcast-setup' })
    return
  }

  job.status = 'running'
  job.progress = 8
  job.message = '正在生成播客讲解脚本'
  job.startedAt = job.startedAt || new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  podcast.status = 'scripting'
  podcast.updatedAt = job.updatedAt
  await writeDb(db)

  let scriptResult = null
  try {
    scriptResult = await generatePodcastScript(podcast.sourceText, podcast.lexile || podcastLexileDefault, podcast.index || 1, normalizePodcastKind(podcast.kind))
  } catch (error) {
    if (shouldRecordTextAiUsage()) {
      const source = textAiUsageSource()
      await persistAiUsage({
        userId: job.userId,
        jobId: job.id,
        category: 'text',
        action: 'generate-podcast-script',
        ...source,
        inputTokens: estimateTextTokens(podcast.sourceText),
        success: false,
        statusCode: parseStatusCode(error.message),
        message: error.message || '播客脚本生成失败',
      }).catch((usageError) => console.error('failed to record ai usage', usageError))
    }
    await failPodcastJob(job.id, error.message || '播客脚本生成失败', { stage: 'podcast-script' })
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return
  if (job.cancelRequested) {
    await failPodcastJob(job.id, '任务已取消', { stage: 'cancel', status: 'canceled' })
    return
  }

  podcast.title = scriptResult.title || podcast.title
  podcast.scriptText = scriptResult.script
  podcast.scriptMode = scriptResult.mode
  podcast.scriptPartCount = scriptResult.partCount || 1
  podcast.status = 'synthesizing'
  podcast.updatedAt = new Date().toISOString()
  job.progress = 35
  job.message = '正在合成播客音频'
  job.updatedAt = podcast.updatedAt
  if (shouldRecordTextAiUsage()) {
    const source = textAiUsageSource()
    recordAiUsage(db, {
      userId: job.userId,
      jobId: job.id,
      category: 'text',
      action: 'generate-podcast-script',
      ...source,
      inputTokens: estimateTextTokens(podcast.sourceText),
      outputTokens: estimateTextTokens(podcast.scriptText),
      success: String(scriptResult.mode || '').includes('ai'),
      message: String(scriptResult.mode || '').includes('ai') ? '' : '使用本地播客脚本兜底',
    })
  }
  await writeDb(db)

  let audio = null
  try {
    audio = await synthesizePodcastAudio(
      podcast,
      async (percent, done, total) => {
        const progress = 35 + Math.round(percent * 0.6)
        await updatePodcastJobProgress(podcast.id, job.id, progress, `正在合成音频 ${done}/${total}`)
      },
      {
        preferFallback: Boolean(job.preferTtsFallback || podcast.preferTtsFallback),
        priority: podcastTtsPriority(db),
      }
    )
  } catch (error) {
    await persistAiUsage({
      userId: job.userId,
      jobId: job.id,
      category: 'audio',
      action: 'generate-podcast-tts',
      provider: 'Podcast TTS',
      model: podcastQwenConfig().model || podcastGeminiOfficialConfig().model || podcastGeminiFallbackConfig().model || 'podcast-tts',
      inputTokens: estimateTtsInputTokens(podcast.scriptText || ''),
      chunks: chunkTextForTts(podcast.scriptText || '').length,
      success: false,
      statusCode: parseStatusCode(error.message),
      message: error.message || '播客音频合成失败',
    }).catch((usageError) => console.error('failed to record ai usage', usageError))
    await failPodcastJob(job.id, error.message || '播客音频合成失败', { stage: 'podcast-audio' })
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return

  podcast.audio = audio
  recordAiUsage(db, {
    userId: job.userId,
    jobId: job.id,
    category: 'audio',
    action: 'generate-podcast-tts',
    provider: audio.provider || 'Podcast TTS',
    model: audio.model || '',
    inputTokens: estimateTtsInputTokens(podcast.scriptText || ''),
    audioSeconds: audio.durationSeconds,
    audioBytes: audio.byteLength,
    chunks: audio.chunkCount,
    success: true,
  })
  podcast.status = 'ready'
  podcast.updatedAt = new Date().toISOString()
  job.status = 'succeeded'
  job.progress = 100
  job.message = '播客已生成'
  job.finishedAt = podcast.updatedAt
  job.updatedAt = podcast.updatedAt
  clearJobDiagnosis(job)
  await writeDb(db)
}

export async function processJobQueue() {
  if (jobQueueActive) return
  jobQueueActive = true
  try {
    while (true) {
      let db = await readDb()
      const autoRetry = promoteDueAutoRetryJobs(db, ['generate-unit', 'generate-podcast'])
      if (autoRetry.changed) await writeDb(db)
      if (autoRetry.nextDelayMs) setTimeout(processJobQueue, Math.min(autoRetry.nextDelayMs + 250, 2_147_483_647))
      let job = db.jobs.find((item) => ['generate-unit', 'generate-podcast'].includes(item.type) && item.status === 'queued')
      if (!job) break

      if (job.type === 'generate-podcast') {
        await processPodcastJob(job.id)
        continue
      }

      let unit = db.units.find((item) => item.id === job.unitId)
      const user = db.users.find((item) => item.id === job.userId)
      if (!unit || !user) {
        markJobFailed(job, '学习单元或用户不存在', { stage: 'setup' })
        appendErrorLog(db, {
          scope: 'job',
          message: job.error || job.message,
          detail: job.errorHint || '',
          userId: job.userId,
          jobId: job.id,
          unitId: job.unitId,
          statusCode: job.statusCode,
          errorCode: job.errorCode,
        })
        await writeDb(db)
        continue
      }

      job.status = 'running'
      job.progress = 15
      job.message = job.settings?.fidelityMode === 'strict' ? '正在调用 AI 生成更忠实版本' : '正在调用 AI 生成学习单元'
      job.startedAt = job.startedAt || new Date().toISOString()
      job.updatedAt = new Date().toISOString()
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'running',
        progress: job.progress,
        message: job.message,
      }
      await writeDb(db)

      let content = null
      let failure = ''
      try {
        content = await buildGeneratedContent(unit, {
          ...userSettings(db, user.id),
          readingLevel: job.settings?.readingLevel || userSettings(db, user.id).readingLevel,
          listeningLevel: job.settings?.listeningLevel || userSettings(db, user.id).listeningLevel,
          fidelityMode: job.settings?.fidelityMode || '',
          fidelityRepairNotes: job.settings?.fidelityRepairNotes || [],
        })
      } catch (error) {
        failure = error.message || '生成失败'
      }

      db = await readDb()
      job = db.jobs.find((item) => item.id === job.id)
      unit = db.units.find((item) => item.id === job.unitId)
      if (!job || !unit) continue

      if (job.cancelRequested) {
        markJobCanceled(job)
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'canceled',
          progress: 100,
          message: job.message,
          finishedAt: job.finishedAt,
        }
        await writeDb(db)
        continue
      }

      if (failure || !content) {
        if (shouldRecordTextAiUsage()) {
          const source = textAiUsageSource()
          recordAiUsage(db, {
            userId: job.userId,
            jobId: job.id,
            category: 'text',
            action: 'generate-unit',
            ...source,
            inputTokens: estimateTextTokens(unit.sourceText),
            success: false,
            statusCode: parseStatusCode(failure),
            message: failure || 'AI 未返回学习单元',
          })
        }
        markJobFailed(job, failure || 'AI 未返回学习单元', { stage: 'unit-generation' })
        const scheduledAutoRetry = scheduleAutoRetryJob(job)
        appendErrorLog(db, {
          scope: 'job',
          message: job.error || job.message,
          detail: job.errorHint || '',
          userId: job.userId,
          jobId: job.id,
          unitId: job.unitId,
          statusCode: job.statusCode,
          errorCode: job.errorCode,
        })
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'failed',
          progress: 100,
          message: job.message,
          error: job.error,
          finishedAt: job.finishedAt,
        }
        await writeDb(db)
        if (scheduledAutoRetry) setTimeout(processJobQueue, Math.min(Number(job.autoRetryDelaySeconds || autoFailureRetryBaseSeconds) * 1000 + 250, 2_147_483_647))
        continue
      }

      if (shouldRecordTextAiUsage()) {
        const source = textAiUsageSource()
        const usedAi = content.generationMode !== 'local-demo'
        recordAiUsage(db, {
          userId: job.userId,
          jobId: job.id,
          category: 'text',
          action: 'generate-unit',
          ...source,
          inputTokens: estimateTextTokens(unit.sourceText),
          outputTokens: estimateTextTokens(JSON.stringify(content)),
          success: usedAi,
          message: usedAi ? '' : 'AI 调用失败，学习单元使用本地兜底',
        })
      }

      const quality = assessContentQuality(content, unit)
      const retryCount = Number(job.retryCount || 0)
      const shouldRetryForFidelity = isLowFidelityQuality(quality) && job.settings?.fidelityMode !== 'strict' && retryCount < maxAutoRegenAttempts
      if (shouldRetryForFidelity) {
        job.settings = {
          ...(job.settings || {}),
          fidelityMode: 'strict',
          fidelityRepairNotes: fidelityRepairNotesFromQuality(quality),
        }
        job.force = Boolean(unit.content)
        job.status = 'queued'
        job.progress = 0
        job.retryCount = retryCount + 1
        job.qualityStatus = 'strict-fidelity-auto-retry'
        job.message = `忠实度审稿偏低，正在自动生成更忠实版本 ${job.retryCount}/${maxAutoRegenAttempts}`
        job.updatedAt = new Date().toISOString()
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'queued',
          progress: 0,
          message: job.message,
        }
        await writeDb(db)
        continue
      }
      if (quality.status === 'review' && Number(job.retryCount || 0) < maxAutoRegenAttempts) {
        job.status = 'queued'
        job.progress = 0
        job.retryCount = Number(job.retryCount || 0) + 1
        job.qualityStatus = 'auto-retry'
        job.message = `质量检查未通过，自动重试 ${job.retryCount}/${maxAutoRegenAttempts}`
        job.updatedAt = new Date().toISOString()
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'queued',
          progress: 0,
          message: job.message,
        }
        await writeDb(db)
        continue
      }

      applyGeneratedContent(unit, content, {
        force: job.force,
        versionReason: job.settings?.fidelityMode === 'strict' ? 'fidelity-regenerated' : 'regenerated',
      })
      job.status = 'succeeded'
      job.progress = 100
      job.message = '学习单元已生成'
      job.qualityStatus = unit.quality?.status || ''
      job.finishedAt = new Date().toISOString()
      job.updatedAt = job.finishedAt
      clearJobDiagnosis(job)
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'succeeded',
        progress: 100,
        message: job.message,
        finishedAt: job.finishedAt,
      }
      await writeDb(db)
    }
  } finally {
    jobQueueActive = false
  }
}
