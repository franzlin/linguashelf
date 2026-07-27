// Per-unit study progress, the public unit view, and content versioning.
//
// `publicUnit` is the single place that decides what a client may see: it always
// strips `sourceText`, so the uploaded book's text never leaves the server.
import { nanoid } from 'nanoid'
import { progressKey } from './storage.js'
import { takeWords, wordCount } from './text.js'
import { assessContentQuality, contentMetrics, normalizeClaimText, textKeywordSimilarity } from './quality.js'

export const unitCompletionLocks = new Map()

export const unitProgressLocks = new Map()

export function getUnitProgress(db, userId, unitId) {
  return db.progress.find((item) => item.userId === userId && item.unitId === unitId) || null
}

export function ensureUnitProgress(db, userId, unitId) {
  let progress = getUnitProgress(db, userId, unitId)
  if (!progress) {
    progress = {
      id: progressKey(userId, unitId),
      userId,
      unitId,
      paragraphIndex: 0,
      listeningCompleted: false,
      answers: {},
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    db.progress.push(progress)
  }
  return progress
}

export function publicProgress(progress) {
  if (!progress) {
    return {
      paragraphIndex: 0,
      listeningCompleted: false,
      answers: {},
      completed: false,
      updatedAt: '',
    }
  }
  return {
    paragraphIndex: Number(progress.paragraphIndex || 0),
    listeningCompleted: Boolean(progress.listeningCompleted),
    answers: progress.answers || {},
    completed: Boolean(progress.completed),
    updatedAt: progress.updatedAt,
  }
}

export function buildVersionDiff(version, unit) {
  const previous = version?.content
  const current = unit?.content
  if (!previous || !current) return null

  const previousMetrics = contentMetrics(previous)
  const currentMetrics = contentMetrics(current)
  const previousParagraphs = previous.reading?.paragraphs || []
  const currentParagraphs = current.reading?.paragraphs || []
  const maxParagraphs = Math.max(previousParagraphs.length, currentParagraphs.length)
  const paragraphDiffs = []
  let changedParagraphs = 0

  for (let index = 0; index < maxParagraphs; index += 1) {
    const previousText = previousParagraphs[index]?.text || ''
    const currentText = currentParagraphs[index]?.text || ''
    const similarity = previousText && currentText ? textKeywordSimilarity(previousText, currentText) : previousText === currentText ? 1 : 0
    const previousWords = wordCount(previousText)
    const currentWords = wordCount(currentText)
    const changed = normalizeClaimText(previousText) !== normalizeClaimText(currentText)
    if (changed) changedParagraphs += 1
    paragraphDiffs.push({
      paragraph: index + 1,
      changed,
      similarity: Number(similarity.toFixed(2)),
      wordDelta: currentWords - previousWords,
      previousPreview: takeWords(previousText, 45),
      currentPreview: takeWords(currentText, 45),
    })
  }

  const previousScore = version.quality?.fidelity?.audit?.score
  const currentScore = unit.quality?.fidelity?.audit?.score
  return {
    previous: previousMetrics,
    current: currentMetrics,
    summary: {
      titleChanged: previousMetrics.title !== currentMetrics.title,
      levelChanged:
        previousMetrics.readingLevel !== currentMetrics.readingLevel || previousMetrics.listeningLevel !== currentMetrics.listeningLevel,
      changedParagraphs,
      wordDelta: currentMetrics.readingWords - previousMetrics.readingWords,
      listeningWordDelta: currentMetrics.listeningWords - previousMetrics.listeningWords,
      questionDelta: currentMetrics.questionCount - previousMetrics.questionCount,
      fidelityScoreDelta:
        previousScore !== undefined && currentScore !== undefined ? Number((Number(currentScore) - Number(previousScore)).toFixed(2)) : null,
    },
    paragraphDiffs,
  }
}

export function publicUnit(unit, db = null, userId = '') {
  if (!unit) return null
  const { sourceText, versions, ...safeUnit } = unit
  safeUnit.versions = (versions || []).map((version, index) => ({
    id: version.id || `version-${index}`,
    title: version.title || `历史版本 ${index + 1}`,
    reason: version.reason || 'regenerated',
    savedAt: version.savedAt || version.generatedAt || '',
    generatedAt: version.generatedAt || '',
    level: version.level || null,
    quality: version.quality || null,
    diff: buildVersionDiff(version, unit),
  }))
  if (db && userId) safeUnit.progress = publicProgress(getUnitProgress(db, userId, unit.id))
  return safeUnit
}

export function saveUnitVersion(unit, reason = 'regenerated') {
  if (!unit?.content) return null
  unit.versions = Array.isArray(unit.versions) ? unit.versions : []
  const version = {
    id: nanoid(),
    title: unit.title,
    reason,
    savedAt: new Date().toISOString(),
    generatedAt: unit.generatedAt,
    level: unit.content.level,
    quality: unit.quality,
    content: unit.content,
  }
  unit.versions.push(version)
  if (unit.versions.length > 8) unit.versions = unit.versions.slice(-8)
  return version
}

export function applyGeneratedContent(unit, content, options = {}) {
  if (unit.content && options.force) saveUnitVersion(unit, options.versionReason || 'regenerated')
  unit.content = content
  unit.title = content.title || unit.title
  unit.status = 'generated'
  unit.generatedAt = new Date().toISOString()
  unit.quality = assessContentQuality(content, unit)
  unit.sourceRefs = unit.quality.sourceRefs
  unit.audio = null
  unit.generation = {
    ...(unit.generation || {}),
    status: 'succeeded',
    finishedAt: new Date().toISOString(),
  }
}
