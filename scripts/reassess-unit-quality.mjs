import 'dotenv/config'
import { normalizeGeneratedLesson } from '../server/content.js'
import { refreshAiServiceConfig, textAiConfigured } from '../server/ai-runtime.js'
import { assessContentQuality, auditContentFidelity, fidelityAuditNeedsReview } from '../server/quality.js'
import { readDb, writeDb } from '../server/storage.js'

const apply = process.argv.includes('--apply')
const localOnly = process.argv.includes('--local-only')
const requestedUnitId = readArg('--unit')

if (localOnly) process.env.QUALITY_AUDIT_MODE = 'off'
await refreshAiServiceConfig()
if (apply && !localOnly && !textAiConfigured()) throw new Error('文本 AI 未配置，拒绝以本地审稿覆盖现有生产审稿；可先只读预览或显式使用 --local-only')

const db = await readDb()
const units = (db.units || []).filter((unit) => unit.content && (!requestedUnitId || unit.id === requestedUnitId))
const reassessed = []
const summary = {
  units: units.length,
  beforeReview: 0,
  afterReview: 0,
  beforeFidelityReview: 0,
  afterFidelityReview: 0,
  aiAudits: 0,
  localAudits: 0,
  auditErrors: 0,
  normalizedLegacyLessons: 0,
  applied: 0,
  skippedChangedUnits: 0,
}

for (const unit of units) {
  const wasLegacy = !Array.isArray(unit.content?.reading?.paragraphs) && Boolean(unit.content?.readingText)
  const content = normalizeGeneratedLesson(unit.content, unit)
  content.qualityAudit = await auditContentFidelity(content, unit)
  const quality = assessContentQuality(content, unit)

  if (unit.quality?.status === 'review') summary.beforeReview += 1
  if (quality.status === 'review') summary.afterReview += 1
  if (legacyUiNeedsFidelityReview(unit.quality)) summary.beforeFidelityReview += 1
  if (fidelityAuditNeedsReview(quality.fidelity?.audit) || (quality.sourceMap || []).some((item) => item.status === 'review')) {
    summary.afterFidelityReview += 1
  }
  if (content.qualityAudit?.mode === 'ai') summary.aiAudits += 1
  else summary.localAudits += 1
  if (content.qualityAudit?.error) summary.auditErrors += 1
  if (wasLegacy) summary.normalizedLegacyLessons += 1
  reassessed.push({ unitId: unit.id, originalContent: JSON.stringify(unit.content), content, quality })
}

if (apply && summary.auditErrors && !localOnly) {
  throw new Error(`${summary.auditErrors} 个单元的 AI 审稿失败，未写入任何数据`)
}

if (apply && reassessed.length) {
  const freshDb = await readDb()
  for (const result of reassessed) {
    const unit = freshDb.units.find((item) => item.id === result.unitId)
    if (!unit || JSON.stringify(unit.content) !== result.originalContent) {
      summary.skippedChangedUnits += 1
      continue
    }
    unit.content = result.content
    unit.quality = result.quality
    unit.sourceRefs = result.quality.sourceRefs
    summary.applied += 1
  }
  if (summary.applied) await writeDb(freshDb)
}

console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', localOnly, ...summary }, null, 2))

function readArg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || '' : ''
}

function legacyUiNeedsFidelityReview(quality) {
  const audit = quality?.fidelity?.audit
  const lowScore = audit?.score !== undefined && Number(audit.score) < 0.6
  const unsupported = Boolean(audit?.unsupportedClaims?.length)
  const weakMap = (quality?.sourceMap || []).some(
    (item) => item.status === 'review' || !item.sourceRefs?.length || Number(item.confidence || 0) < 0.12 || item.suspiciousSentences?.length
  )
  return lowScore || unsupported || weakMap
}
