// Targeted repair of individual low-fidelity reading paragraphs.
//
// Rewriting only the flagged paragraphs, against only their own allowed source
// context, is what lets a mostly-good unit be fixed without regenerating (and
// re-risking) the parts that were already faithful.
import { callTextAi, textAiConfigured } from './ai-runtime.js'
import { normalizeText, splitSentences, takeWords, wordCount } from './text.js'
import { assessContentQuality, auditContentFidelity, sourceParagraphs, textKeywordSimilarity } from './quality.js'

export function exampleSentenceFromText(text, term) {
  const lower = String(term || '').toLowerCase()
  return splitSentences(text).find((sentence) => sentence.toLowerCase().includes(lower)) || ''
}

export const paragraphRepairSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          text: { type: 'string' },
          summaryZh: { type: 'string' },
        },
        required: ['readingParagraph', 'text', 'summaryZh'],
      },
    },
  },
  required: ['paragraphs'],
}

export function sourceIndexesFromRefs(refs = []) {
  return refs
    .map((ref) => Number(String(ref?.label || '').match(/段落\s*(\d+)/)?.[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value - 1)
}

export function sourceContextForReadingParagraph(unit, sourceMapItem, paragraphIndex, totalParagraphs) {
  const paragraphs = sourceParagraphs(unit)
  if (!paragraphs.length) return ''
  const indexSet = new Set(sourceIndexesFromRefs(sourceMapItem?.sourceRefs || []))
  if (!indexSet.size) {
    const approx = Math.min(paragraphs.length - 1, Math.max(0, Math.round((paragraphIndex / Math.max(1, totalParagraphs - 1)) * (paragraphs.length - 1))))
    indexSet.add(approx)
    if (approx > 0) indexSet.add(approx - 1)
    if (approx < paragraphs.length - 1) indexSet.add(approx + 1)
  }
  return [...indexSet]
    .sort((a, b) => a - b)
    .map((index) => {
      const item = paragraphs[index]
      return item ? `Source paragraph ${item.index + 1}:\n${takeWords(item.text, 220)}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export function lowQualityParagraphIndexes(unit, requested = []) {
  const paragraphCount = unit?.content?.reading?.paragraphs?.length || 0
  const validRequested = requested
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= paragraphCount)
    .map((value) => value - 1)
  if (validRequested.length) return [...new Set(validRequested)]

  const sourceMap = unit?.quality?.sourceMap || []
  const audit = unit?.quality?.fidelity?.audit || {}
  const suspicious = (audit.suspiciousSentences || [])
    .map((item) => Number(item?.readingParagraph || 0) - 1)
    .filter((value) => value >= 0)
  const fromMap = sourceMap
    .filter((item) => item.status === 'review' || !item.sourceRefs?.length || item.suspiciousSentences?.length)
    .map((item) => Number(item.readingParagraph || 0) - 1)
    .filter((value) => value >= 0)
  const indexes = [...new Set([...fromMap, ...suspicious])]
  if (indexes.length) return indexes.slice(0, 3)
  if (audit.verdict === 'review' || audit.verdict === 'fail') return [0]
  if (!['pass', 'review', 'fail'].includes(audit.verdict) && audit.score !== undefined && Number(audit.score) < 0.55) return [0]
  return []
}

export function fallbackRepairParagraph(unit, paragraphIndex) {
  const current = unit.content?.reading?.paragraphs?.[paragraphIndex] || {}
  const sourceMapItem = (unit.quality?.sourceMap || []).find((item) => Number(item.readingParagraph || 0) === paragraphIndex + 1)
  const context = sourceContextForReadingParagraph(unit, sourceMapItem, paragraphIndex, unit.content?.reading?.paragraphs?.length || 1)
  const sentences = splitSentences(context).slice(0, 6)
  const text = sentences.length
    ? sentences.join(' ')
    : takeWords(context || current.text || unit.sourceExcerpt || unit.sourceText, 155)
  return {
    readingParagraph: paragraphIndex + 1,
    text,
    summaryZh: current.summaryZh || '这一段已按原文来源重新整理。',
  }
}

export async function repairParagraphsWithOpenAI(unit, indexes, settings) {
  if (!textAiConfigured()) return null

  const sourceMap = unit.quality?.sourceMap || []
  const paragraphCount = unit.content?.reading?.paragraphs?.length || 0
  const targets = indexes.map((index) => {
    const paragraph = unit.content.reading.paragraphs[index]
    const sourceMapItem = sourceMap.find((item) => Number(item.readingParagraph || 0) === index + 1)
    return `
Reading paragraph ${index + 1}
Current generated text:
${paragraph.text}

Known issues:
${(sourceMapItem?.suspiciousSentences || []).map((item) => `- ${item.sentence}: ${item.reason}`).join('\n') || '- Weak or unclear source support.'}

Allowed source context:
${sourceContextForReadingParagraph(unit, sourceMapItem, index, paragraphCount)}
`
  }).join('\n\n---\n\n')

  return callTextAi(
    {
      instructions: 'You repair only selected paragraphs of a graded English lesson. Return only schema-valid JSON.',
      schema: paragraphRepairSchema,
      schemaName: 'paragraph_repair',
      input: `
Repair the selected reading paragraphs only.

Rules:
- Keep the same reading paragraph numbers.
- Rewrite only from the allowed source context shown for each paragraph.
- Remove unsupported claims. Do not add background knowledge, opinions, examples, or facts not in the source context.
- Keep adult learner English at CEFR ${settings.readingLevel}.
- Each repaired paragraph should be 120-175 words.
- Return a concise Chinese summary for each repaired paragraph.
- Do not rewrite other parts of the lesson.

${targets}
`,
    },
    '段落修复',
  )
}

export async function repairLowQualityParagraphs(unit, settings, requestedParagraphs = []) {
  if (!unit?.content?.reading?.paragraphs?.length) throw new Error('这个单元还没有可修复的阅读正文')
  const indexes = lowQualityParagraphIndexes(unit, requestedParagraphs)
  if (!indexes.length) throw new Error('没有检测到需要段落级修复的问题')

  let result = null
  let aiError = ''
  try {
    result = await repairParagraphsWithOpenAI(unit, indexes, settings)
  } catch (error) {
    aiError = error.message || String(error)
  }
  const repairs = result?.paragraphs?.length ? result.paragraphs : indexes.map((index) => fallbackRepairParagraph(unit, index))
  const nextContent = JSON.parse(JSON.stringify(unit.content))
  const repairedIndexes = []
  for (const repair of repairs) {
    const index = Number(repair.readingParagraph || 0) - 1
    if (!indexes.includes(index) || !nextContent.reading.paragraphs[index]) continue
    nextContent.reading.paragraphs[index] = {
      text: String(repair.text || '').trim() || nextContent.reading.paragraphs[index].text,
      summaryZh: String(repair.summaryZh || '').trim() || nextContent.reading.paragraphs[index].summaryZh,
    }
    repairedIndexes.push(index)
  }
  if (!repairedIndexes.length) throw new Error('段落修复结果没有匹配到目标段落')
  nextContent.fidelityNote = `${nextContent.fidelityNote || ''} Paragraph ${repairedIndexes.map((index) => index + 1).join(', ')} was repaired for stricter source fidelity. ${aiError ? `AI repair fallback note: ${aiError}` : ''}`.trim()
  nextContent.qualityAudit = await auditContentFidelity(nextContent, unit)
  return { content: nextContent, repairedParagraphs: repairedIndexes.map((index) => index + 1), aiError }
}
