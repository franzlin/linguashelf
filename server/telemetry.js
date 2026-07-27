// AI usage accounting and the server error log, plus their aggregations.
//
// Deliberately below both the job queue (which writes these records) and the
// admin report (which reads them), so those two never have to import each other.
import { nanoid } from 'nanoid'
import { readDb, writeDb } from './storage.js'
import { estimateTextTokens } from './text.js'
import { textAiConfig, textAiConfigured } from './ai-runtime.js'
import { sanitizeServiceMessage } from './ai-services.js'
import { serviceEndpointHost } from './tts.js'

export function computeAiUsageSummary(db, userId) {
  const now = Date.now()
  const todayKey = new Date(now).toISOString().slice(0, 10)
  const all = (db.aiUsage || [])
    .filter((item) => item.userId === userId)
    .filter((item) => Number.isFinite(Date.parse(item.createdAt || '')))
  const todayRecords = all.filter((item) => String(item.createdAt || '').slice(0, 10) === todayKey)
  const sevenDayRecords = all.filter((item) => Date.parse(item.createdAt) >= now - 7 * 24 * 60 * 60 * 1000)
  const thirtyDayRecords = all.filter((item) => Date.parse(item.createdAt) >= now - 30 * 24 * 60 * 60 * 1000)
  const byAction = groupUsage(thirtyDayRecords, (item) => item.action).slice(0, 10)
  const byProviderModel = groupUsage(thirtyDayRecords, (item) => {
    const provider = item.provider || 'unknown'
    const model = item.model || 'unknown'
    return `${provider} · ${model}`
  }).slice(0, 8)
  const recentFailures = all
    .filter((item) => item.success === false)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 8)
    .map((item) => ({
      action: item.action,
      provider: item.provider,
      model: item.model,
      message: item.message,
      errorCode: item.errorCode,
      statusCode: item.statusCode,
      createdAt: item.createdAt,
    }))
  const today = summarizeUsageRecords(todayRecords)
  const sevenDays = summarizeUsageRecords(sevenDayRecords)
  const thirtyDays = summarizeUsageRecords(thirtyDayRecords)
  const warnings = []
  if (sevenDays.failed >= 3) warnings.push({ level: 'warning', message: `近 7 天 AI/OCR/TTS 失败 ${sevenDays.failed} 次`, detail: '建议打开服务状态页测试对应来源。' })
  if (today.calls >= 30) warnings.push({ level: 'warning', message: `今天 AI 调用 ${today.calls} 次`, detail: '如果不是主动批量生成，请检查任务中心。' })
  if (today.audioSeconds >= 60 * 45) warnings.push({ level: 'warning', message: `今天 TTS 音频约 ${Math.round(today.audioSeconds / 60)} 分钟`, detail: '播客 TTS 成本通常高于普通文本生成。' })

  return {
    today,
    sevenDays,
    thirtyDays,
    byAction,
    byProviderModel,
    recentFailures,
    warnings,
  }
}

export function appendErrorLog(db, entry = {}) {
  if (!db) return null
  db.errorLogs = Array.isArray(db.errorLogs) ? db.errorLogs : []
  const now = new Date().toISOString()
  const log = {
    id: nanoid(),
    level: entry.level || 'error',
    scope: entry.scope || 'server',
    message: sanitizeServiceMessage(entry.message || '未知错误'),
    detail: sanitizeServiceMessage(entry.detail || ''),
    userId: entry.userId || '',
    jobId: entry.jobId || '',
    unitId: entry.unitId || '',
    podcastId: entry.podcastId || '',
    statusCode: entry.statusCode || null,
    errorCode: entry.errorCode || '',
    createdAt: now,
  }
  db.errorLogs.push(log)
  if (db.errorLogs.length > 200) db.errorLogs = db.errorLogs.slice(-200)
  return log
}

export function publicErrorLog(log) {
  return {
    id: log.id,
    level: log.level || 'error',
    scope: log.scope || 'server',
    message: log.message || '',
    detail: log.detail || '',
    jobId: log.jobId || '',
    unitId: log.unitId || '',
    podcastId: log.podcastId || '',
    statusCode: log.statusCode || null,
    errorCode: log.errorCode || '',
    createdAt: log.createdAt || '',
  }
}

export function shouldRecordTextAiUsage() {
  return textAiConfigured()
}

export function textAiUsageSource() {
  const config = textAiConfig()
  return {
    provider: serviceEndpointHost(config.baseUrl) || 'text-ai',
    model: config.model,
  }
}

export function recordAiUsage(db, entry = {}) {
  if (!db || !entry.userId) return null
  db.aiUsage = Array.isArray(db.aiUsage) ? db.aiUsage : []
  const record = {
    id: nanoid(),
    userId: entry.userId,
    jobId: String(entry.jobId || '').slice(0, 80),
    category: String(entry.category || 'text').slice(0, 32),
    action: String(entry.action || 'unknown').slice(0, 64),
    provider: sanitizeServiceMessage(entry.provider || '').slice(0, 80),
    model: sanitizeServiceMessage(entry.model || '').slice(0, 100),
    inputTokens: Math.max(0, Math.round(Number(entry.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(Number(entry.outputTokens || 0))),
    audioSeconds: Math.max(0, Math.round(Number(entry.audioSeconds || 0))),
    audioBytes: Math.max(0, Math.round(Number(entry.audioBytes || 0))),
    pages: Math.max(0, Math.round(Number(entry.pages || 0))),
    bytes: Math.max(0, Math.round(Number(entry.bytes || 0))),
    chunks: Math.max(0, Math.round(Number(entry.chunks || 0))),
    success: entry.success !== false,
    statusCode: entry.statusCode || null,
    errorCode: String(entry.errorCode || '').slice(0, 60),
    message: sanitizeServiceMessage(entry.message || '').slice(0, 180),
    createdAt: entry.createdAt || new Date().toISOString(),
  }
  db.aiUsage.push(record)
  if (db.aiUsage.length > 3000) db.aiUsage = db.aiUsage.slice(-3000)
  return record
}

export async function persistAiUsage(entry = {}) {
  const db = await readDb()
  recordAiUsage(db, entry)
  await writeDb(db)
}

export function summarizeUsageRecords(records) {
  return records.reduce(
    (summary, item) => {
      summary.calls += 1
      if (item.success === false) summary.failed += 1
      summary.inputTokens += Number(item.inputTokens || 0)
      summary.outputTokens += Number(item.outputTokens || 0)
      summary.audioSeconds += Number(item.audioSeconds || 0)
      summary.audioBytes += Number(item.audioBytes || 0)
      summary.pages += Number(item.pages || 0)
      summary.bytes += Number(item.bytes || 0)
      summary.chunks += Number(item.chunks || 0)
      return summary
    },
    { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, audioSeconds: 0, audioBytes: 0, pages: 0, bytes: 0, chunks: 0 }
  )
}

export function groupUsage(records, keyFn) {
  const map = new Map()
  for (const item of records) {
    const key = keyFn(item)
    if (!key) continue
    const current = map.get(key) || []
    current.push(item)
    map.set(key, current)
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, ...summarizeUsageRecords(items) }))
    .sort((a, b) => b.calls - a.calls)
}
