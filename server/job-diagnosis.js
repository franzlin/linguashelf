// Failure classification and retry policy for background jobs.
//
// Turns an upstream error into something a person can act on: which stage
// failed, whether waiting is likely to help, what to try next, and whether the
// job should retry itself on a backoff.
import { autoFailureRetryBaseSeconds, maxAutoFailureRetries } from './config.js'
import { formatBytes } from './http.js'
import { estimateTextTokens } from './text.js'
import { formatServiceNumber } from './ai-services.js'
import { chunkTextForTts, estimateTtsInputTokens } from './audio.js'
import { summarizeUsageRecords } from './telemetry.js'

export function clearJobDiagnosis(job) {
  delete job.errorStage
  delete job.errorCode
  delete job.errorHint
  delete job.retryable
  delete job.provider
  delete job.statusCode
  delete job.diagnosedAt
  delete job.autoRetryAt
  delete job.autoRetryDelaySeconds
  delete job.autoRetryReason
}

export function parseStatusCode(message) {
  const match = String(message || '').match(/\b([45]\d{2})\b/)
  return match ? Number(match[1]) : null
}

export function stageLabel(stage, job) {
  const normalized = String(stage || '').toLowerCase()
  if (normalized === 'unit-generation') return '学习单元生成'
  if (normalized === 'podcast-script') return '播客脚本生成'
  if (normalized === 'podcast-audio') return '播客音频合成'
  if (normalized === 'podcast-setup') return '播客任务准备'
  if (normalized === 'quality-review') return '生成质量检查'
  if (normalized === 'pdf-ocr') return '扫描 PDF 解析'
  if (normalized === 'cancel') return '用户操作'
  if (normalized === 'setup') return '任务准备'
  if (job?.type === 'generate-podcast') return '播客生成'
  return '学习单元生成'
}

export function providerLabel(stage, message) {
  const text = String(message || '').toLowerCase()
  const normalized = String(stage || '').toLowerCase()
  if (normalized === 'podcast-audio' || /gemini|tts|语音|音频|mimo/.test(text)) return 'TTS 服务'
  if (/ocr|tesseract|视觉/.test(text)) return /tesseract/.test(text) ? '本地 Tesseract OCR' : 'Hunyuan OCR'
  if (/ai|openai|gpt|模型|脚本|审稿/.test(text) || normalized.includes('script') || normalized.includes('generation')) return 'AI 文本服务'
  return ''
}

export function diagnoseJobError(job, errorOrMessage, options = {}) {
  const message = typeof errorOrMessage === 'string' ? errorOrMessage : errorOrMessage?.message || String(errorOrMessage || '')
  const text = message.toLowerCase()
  const statusCode = options.statusCode || parseStatusCode(message)
  let errorCode = options.errorCode || 'unknown'
  let errorHint = '可以稍后重试；如果连续失败，请减少批量数量，或检查对应的 AI/OCR/TTS 配置。'
  let retryable = true

  if (options.stage === 'cancel' || /任务已取消|cancel/.test(text)) {
    errorCode = 'canceled'
    errorHint = '任务是手动取消的；需要继续时可以重新加入队列。'
    retryable = true
  } else if (options.stage === 'setup' || options.stage === 'podcast-setup' || /不存在|未找到/.test(message)) {
    errorCode = 'missing-resource'
    errorHint = '任务关联的书籍、单元或播客已经不存在。请回到书库重新创建任务。'
    retryable = false
  } else if (statusCode === 429 || /rate limit|quota|too many|频繁|限流|额度/.test(text)) {
    errorCode = 'rate-limit'
    errorHint = '外部服务正在限流或额度不足。等待几分钟后重试，或降低批量生成数量。'
    retryable = true
  } else if ([401, 403].includes(statusCode) || /api key|unauthorized|forbidden|鉴权|密钥|未配置|invalid key/.test(text)) {
    errorCode = 'provider-auth'
    errorHint = '外部服务密钥或模型配置不可用。需要先检查服务器环境变量，再重试任务。'
    retryable = false
  } else if ([408, 500, 502, 503, 504].includes(statusCode) || /timeout|timed out|econnreset|enotfound|fetch failed|network|超时|暂时|上游/.test(text)) {
    errorCode = 'upstream-temporary'
    errorHint = '上游服务或网络临时不稳定。稍后点击重试通常可以恢复。'
    retryable = true
  } else if (/ocr|tesseract|视觉/.test(text)) {
    errorCode = 'ocr-failed'
    errorHint = 'OCR 没有得到足够正文。请确认 PDF 清晰、方向正确，或换用非扫描版文件。'
    retryable = false
  } else if (/质量|忠实度|review|source|keyword/.test(text)) {
    errorCode = 'quality-review'
    errorHint = '质量检查认为结果不够稳定。可以点击重试，系统会重新生成一版。'
    retryable = true
  } else if (statusCode && statusCode >= 400 && statusCode < 500) {
    errorCode = 'bad-request'
    errorHint = '上游服务拒绝了这次请求。若重试仍失败，请降低难度或减少本次材料长度。'
    retryable = false
  }

  return {
    errorStage: stageLabel(options.stage, job),
    errorCode,
    errorHint,
    retryable,
    provider: options.provider || providerLabel(options.stage, message),
    statusCode,
  }
}

export function applyJobDiagnosis(job, errorOrMessage, options = {}) {
  Object.assign(job, diagnoseJobError(job, errorOrMessage, options), {
    diagnosedAt: new Date().toISOString(),
  })
}

export function markJobCanceled(job, message = '任务已取消') {
  job.status = 'canceled'
  job.progress = 100
  job.error = ''
  job.message = message
  job.finishedAt = new Date().toISOString()
  job.updatedAt = job.finishedAt
  applyJobDiagnosis(job, message, { stage: 'cancel' })
}

export function markJobFailed(job, errorOrMessage, options = {}) {
  const message = typeof errorOrMessage === 'string' ? errorOrMessage : errorOrMessage?.message || String(errorOrMessage || '')
  job.status = 'failed'
  job.progress = 100
  job.error = message || '任务失败'
  job.message = options.message || '生成失败'
  job.finishedAt = new Date().toISOString()
  job.updatedAt = job.finishedAt
  applyJobDiagnosis(job, job.error, options)
}

export function formatRelativeSeconds(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)))
  if (value < 60) return `${value || 1} 秒`
  const minutes = Math.round(value / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.round(minutes / 60)} 小时`
}

export function secondsUntil(isoTime) {
  const target = Date.parse(isoTime || '')
  if (!Number.isFinite(target)) return 0
  return Math.max(0, Math.ceil((target - Date.now()) / 1000))
}

export function canAutoRetryJob(job) {
  if (!job || maxAutoFailureRetries <= 0 || job.retryable === false || job.cancelRequested) return false
  if (!['rate-limit', 'upstream-temporary'].includes(job.errorCode || '')) return false
  return Number(job.retryCount || 0) < maxAutoFailureRetries
}

export function scheduleAutoRetryJob(job) {
  if (!canAutoRetryJob(job)) return false
  const attempt = Number(job.retryCount || 0) + 1
  const delaySeconds = Math.min(30 * 60, autoFailureRetryBaseSeconds * 2 ** Math.max(0, attempt - 1))
  job.autoRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
  job.autoRetryDelaySeconds = delaySeconds
  job.autoRetryReason =
    job.errorCode === 'rate-limit'
      ? '检测到限流或额度暂时不可用，系统会先等待再自动重试。'
      : '检测到上游服务或网络临时异常，系统会自动重试一次。'
  job.message = `${job.message || '生成失败'}，已安排 ${formatRelativeSeconds(delaySeconds)} 后自动重试`
  return true
}

export function promoteDueAutoRetryJobs(db, allowedTypes = null) {
  const now = Date.now()
  let changed = false
  let nextDelayMs = 0
  for (const job of db.jobs || []) {
    if (allowedTypes && !allowedTypes.includes(job.type)) continue
    if (job.status !== 'failed' || !job.autoRetryAt) continue
    const retryAt = Date.parse(job.autoRetryAt)
    if (!Number.isFinite(retryAt)) continue
    if (retryAt > now) {
      const delay = retryAt - now
      nextDelayMs = nextDelayMs ? Math.min(nextDelayMs, delay) : delay
      continue
    }

    const lastError = job.error || job.message || ''
    const lastErrorCode = job.errorCode || ''
    const lastErrorStage = job.errorStage || ''
    const retryCount = Number(job.retryCount || 0) + 1
    clearJobDiagnosis(job)
    job.lastError = lastError
    job.lastErrorCode = lastErrorCode
    job.lastErrorStage = lastErrorStage
    job.retryCount = retryCount
    job.status = 'queued'
    job.progress = 0
    job.error = ''
    job.cancelRequested = false
    job.message = `自动重试 ${retryCount}/${maxAutoFailureRetries}`
    job.finishedAt = null
    job.updatedAt = new Date().toISOString()

    const unit = db.units.find((item) => item.id === job.unitId)
    if (unit) {
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'queued',
        progress: 0,
        message: job.message,
      }
    }
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === job.userId)
    if (podcast) {
      podcast.status = 'planned'
      podcast.error = ''
      podcast.updatedAt = job.updatedAt
    }
    const book = job.type === 'parse-pdf-ocr' ? db.books.find((item) => item.id === job.bookId && item.userId === job.userId) : null
    if (book) {
      book.status = 'processing'
      book.error = ''
      book.updatedAt = job.updatedAt
    }
    changed = true
  }
  return { changed, nextDelayMs }
}

export function jobNextAction(job) {
  const retryIn = secondsUntil(job.autoRetryAt)
  if (retryIn > 0) {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待自动重试',
      nextActionDetail: `系统将在约 ${formatRelativeSeconds(retryIn)} 后自动重试。你也可以手动取消或稍后查看结果。`,
    }
  }
  if (job.status === 'running') {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待当前任务',
      nextActionDetail: '任务正在运行，暂时不用操作。长时间卡住时可以取消后重新加入队列。',
    }
  }
  if (job.status === 'queued' || job.status === 'paused') {
    return {
      nextActionKind: job.status === 'paused' ? 'resume' : 'wait',
      nextActionLabel: job.status === 'paused' ? '恢复任务' : '等待排队',
      nextActionDetail: job.status === 'paused' ? '任务已暂停，需要时点击恢复。' : '任务已在队列里，会按顺序执行。',
    }
  }
  if (job.status === 'succeeded') {
    return {
      nextActionKind: 'done',
      nextActionLabel: '无需处理',
      nextActionDetail: '任务已经完成。只有想刷新内容时才需要重新生成。',
    }
  }
  if (job.errorCode === 'provider-auth') {
    return {
      nextActionKind: 'service',
      nextActionLabel: '先检查服务配置',
      nextActionDetail: '密钥、模型或网关配置不可用。先到 AI 服务页测试对应来源，再重试任务。',
    }
  }
  if (job.errorCode === 'rate-limit') {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待额度恢复',
      nextActionDetail: '这是限流或额度问题。建议等几分钟，减少批量数量，或切换可用的备用来源。',
    }
  }
  if (job.errorCode === 'upstream-temporary') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '可以直接重试',
      nextActionDetail: '这是上游或网络临时异常。通常等待一下再重试即可。',
    }
  }
  if (job.errorCode === 'ocr-failed') {
    return {
      nextActionKind: 'replace-file',
      nextActionLabel: '换文字版或更清晰 PDF',
      nextActionDetail: 'OCR 没识别出足够正文。优先使用文字版 PDF，或换方向正确、清晰度更高的文件。',
    }
  }
  if (job.errorCode === 'quality-review') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '重新生成更忠实版本',
      nextActionDetail: '质量检查认为内容不够稳。重试会重新生成，并继续做质量检查。',
    }
  }
  if (job.status === 'canceled') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '需要时重新生成',
      nextActionDetail: '任务是手动取消的，点击重试会重新排队。',
    }
  }
  return {
    nextActionKind: job.retryable === false ? 'fix' : 'retry',
    nextActionLabel: job.retryable === false ? '先处理问题' : '可以重试',
    nextActionDetail: job.retryable === false ? '这个失败通常不是临时波动，需要先处理配置、文件或材料。' : '如果不是连续失败，可以直接重试一次。',
  }
}

export function usageText(summary) {
  const parts = []
  if (summary.inputTokens) parts.push(`输入约 ${formatServiceNumber(summary.inputTokens)} tokens`)
  if (summary.outputTokens) parts.push(`输出约 ${formatServiceNumber(summary.outputTokens)} tokens`)
  if (summary.audioSeconds) parts.push(`音频约 ${formatRelativeSeconds(summary.audioSeconds)}`)
  if (summary.audioBytes) parts.push(`音频 ${formatBytes(summary.audioBytes)}`)
  if (summary.pages) parts.push(`OCR ${summary.pages} 页`)
  if (summary.chunks) parts.push(`${summary.chunks} 块`)
  if (summary.failed) parts.push(`失败 ${summary.failed} 次`)
  return parts.join(' · ')
}

export function jobUsageSummary(job, db) {
  const records = (db?.aiUsage || []).filter((item) => item.userId === job.userId && item.jobId === job.id)
  if (records.length) {
    const summary = summarizeUsageRecords(records)
    return {
      label: `已记录 ${summary.calls} 次服务调用`,
      detail: usageText(summary) || '这次任务没有记录到明显 token、音频或页数消耗。',
      estimated: false,
    }
  }

  const unit = db?.units?.find((item) => item.id === job.unitId)
  const podcast = db?.podcasts?.find((item) => item.id === job.podcastId)
  if (unit) {
    const inputTokens = estimateTextTokens(unit.sourceText || unit.sourceExcerpt || '')
    return {
      label: '预计文本生成消耗',
      detail: `输入约 ${formatServiceNumber(inputTokens)} tokens；实际用量会在任务运行后记录。`,
      estimated: true,
    }
  }
  if (podcast) {
    const inputTokens = estimateTtsInputTokens(podcast.scriptText || podcast.sourceText || '')
    const chunks = chunkTextForTts(podcast.scriptText || podcast.sourceText || '').length
    return {
      label: '预计播客生成消耗',
      detail: `输入约 ${formatServiceNumber(inputTokens)} tokens · ${chunks || 1} 块；音频合成成功后会记录秒数和文件大小。`,
      estimated: true,
    }
  }
  return {
    label: '暂无消耗记录',
    detail: '任务还没有开始调用外部服务，或旧任务没有记录到用量。',
    estimated: true,
  }
}
