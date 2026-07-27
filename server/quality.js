// Source-fidelity auditing and content quality assessment.
//
// The local audit always runs; the AI audit refines it when a text model is
// configured. Both are advisory — they annotate a unit rather than block it, and
// the paragraph-to-source map they produce is what the study page shows as
// provenance.
import { callTextAi, textAiConfigured } from './ai-runtime.js'
import { extractKeywords, normalizeText, splitSentences, takeWords, wordCount } from './text.js'

export function contentMetrics(content) {
  const readingParagraphs = content?.reading?.paragraphs || []
  const readingText = readingParagraphs.map((paragraph) => paragraph.text).join(' ')
  return {
    title: content?.title || '',
    readingLevel: content?.level?.reading || '',
    listeningLevel: content?.level?.listening || '',
    readingWords: wordCount(readingText),
    listeningWords: wordCount(content?.listening?.text || ''),
    paragraphCount: readingParagraphs.length,
    questionCount: content?.questions?.length || 0,
  }
}

export function makeSourceRefs(unit) {
  const paragraphs = sourceParagraphs(unit)
  return paragraphs.slice(0, 6).map((item, index) => {
    return {
      id: `${unit.id}-src-${index + 1}`,
      label: `${unit.sourceLocation}, 段落 ${item.index + 1}`,
      excerpt: takeWords(item.text, 80),
      wordCount: item.wordCount,
    }
  })
}

export function sourceParagraphs(unit) {
  return normalizeText(unit?.sourceText || '')
    .split(/\n{2,}/)
    .filter((item) => wordCount(item) >= 25)
    .map((text, index) => ({
      index,
      text,
      wordCount: wordCount(text),
      keywords: new Set(extractKeywords(text, 18)),
    }))
}

export function keywordOverlapScore(readingText, sourceItem) {
  const readingKeywords = new Set(extractKeywords(readingText, 24))
  if (!readingKeywords.size || !sourceItem?.keywords?.size) return 0
  let overlap = 0
  for (const keyword of readingKeywords) {
    if (sourceItem.keywords.has(keyword)) overlap += 1
  }
  return overlap / Math.max(4, Math.min(readingKeywords.size, sourceItem.keywords.size))
}

export function matchedKeywordsForSource(readingText, sourceItem, limit = 10) {
  const readingKeywords = new Set(extractKeywords(readingText, 24))
  if (!readingKeywords.size || !sourceItem?.keywords?.size) return []
  const matched = []
  for (const keyword of readingKeywords) {
    if (sourceItem.keywords.has(keyword)) matched.push(keyword)
  }
  return matched.slice(0, limit)
}

export function textKeywordSimilarity(a, b) {
  const left = new Set(extractKeywords(a, 24))
  const right = new Set(extractKeywords(b, 24))
  if (!left.size || !right.size) return 0
  let overlap = 0
  for (const word of left) {
    if (right.has(word)) overlap += 1
  }
  return overlap / Math.max(1, Math.min(left.size, right.size))
}

export function normalizeClaimText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSuspiciousSentence(item) {
  if (!item) return null
  if (typeof item === 'string') {
    return { readingParagraph: 0, sentence: item, reason: 'AI 审稿认为这句话可能缺少原文支持', sourceParagraphs: [] }
  }
  const sentence = String(item.sentence || item.claim || '').trim()
  if (!sentence) return null
  return {
    readingParagraph: Number(item.readingParagraph || 0),
    sentence,
    reason: String(item.reason || 'AI 审稿认为这句话可能缺少原文支持'),
    sourceParagraphs: Array.isArray(item.sourceParagraphs) ? item.sourceParagraphs.map(String) : [],
  }
}

export function suspiciousSentencesForParagraph(content, audit, paragraphIndex) {
  const paragraph = content?.reading?.paragraphs?.[paragraphIndex]
  const sentences = splitSentences(paragraph?.text || '')
  if (!sentences.length) return []

  const candidates = [
    ...((audit?.suspiciousSentences || []).map(normalizeSuspiciousSentence).filter(Boolean)),
    ...((audit?.unsupportedClaims || []).map(normalizeSuspiciousSentence).filter(Boolean)),
  ]
  const output = []
  for (const candidate of candidates) {
    const requestedIndex = Number(candidate.readingParagraph || 0)
    let bestSentence = ''
    let bestScore = 0
    const claim = normalizeClaimText(candidate.sentence)
    for (const sentence of sentences) {
      const normalizedSentence = normalizeClaimText(sentence)
      const direct = claim && normalizedSentence.includes(claim.slice(0, Math.min(80, claim.length))) ? 1 : 0
      const score = Math.max(direct, textKeywordSimilarity(candidate.sentence, sentence))
      if (score > bestScore) {
        bestScore = score
        bestSentence = sentence
      }
    }
    const matchesRequestedParagraph = !requestedIndex || requestedIndex === paragraphIndex + 1
    if (bestSentence && matchesRequestedParagraph && bestScore >= 0.18) {
      output.push({
        sentence: bestSentence,
        reason: candidate.reason,
        sourceParagraphs: candidate.sourceParagraphs,
        confidence: Number(bestScore.toFixed(2)),
      })
    }
  }

  const seen = new Set()
  return output.filter((item) => {
    const key = normalizeClaimText(item.sentence)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mapReadingToSource(content, unit) {
  const sourceItems = sourceParagraphs(unit)
  const paragraphs = content?.reading?.paragraphs || []
  return paragraphs.map((paragraph, index) => {
    const ranked = sourceItems
      .map((source) => ({ source, score: keywordOverlapScore(paragraph.text || '', source) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
    const confidence = ranked[0]?.score || 0
    const suspiciousSentences = suspiciousSentencesForParagraph(content, content?.qualityAudit, index)
    const status = !ranked.length || confidence < 0.12 || suspiciousSentences.length ? 'review' : 'ok'
    const output = {
      readingParagraph: index + 1,
      status,
      confidence: Number(confidence.toFixed(2)),
      generatedExcerpt: takeWords(paragraph.text || '', 90),
      suspiciousSentences,
      sourceRefs: ranked.map(({ source, score }) => ({
        id: `${unit.id}-map-${index + 1}-${source.index + 1}`,
        label: `${unit.sourceLocation}, 段落 ${source.index + 1}`,
        sourceParagraphIndex: source.index + 1,
        excerpt: takeWords(source.text, 110),
        wordCount: source.wordCount,
        keywordOverlap: Number(score.toFixed(2)),
        matchedKeywords: matchedKeywordsForSource(paragraph.text || '', source),
      })),
      coverageNote: ranked.length
        ? confidence >= 0.25
          ? '关键词覆盖较充分，适合快速核对。'
          : '关键词有重合但不强，建议展开来源段落核对。'
        : '未找到明显对应来源段落，建议用更忠实版本重生成。',
      note: ranked.length ? '按关键词重合度匹配的来源段落' : '未找到明显对应来源段落',
    }
    return output
  })
}

export function localFidelityAudit(content, unit) {
  const readingText = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  const sourceKeywords = unit ? extractKeywords(unit.sourceText, 16) : []
  const readingLower = readingText.toLowerCase()
  const coveredKeywords = sourceKeywords.filter((keyword) => readingLower.includes(keyword.toLowerCase()))
  const missingImportantIdeas = sourceKeywords.filter((keyword) => !coveredKeywords.includes(keyword)).slice(0, 8)
  const score = sourceKeywords.length ? coveredKeywords.length / sourceKeywords.length : 1
  const sourceMap = unit ? mapReadingToSource(content, unit) : []
  const unmappedCount = sourceMap.filter((item) => !item.sourceRefs.length).length
  const risks = []
  if (score < 0.45) risks.push('核心关键词覆盖偏低')
  if (unmappedCount) risks.push(`${unmappedCount} 个阅读段落缺少明显来源映射`)
  return {
    mode: 'local',
    score: Number(score.toFixed(2)),
    verdict: risks.length ? '需要复核来源忠实度' : '本地检查未发现明显忠实度问题',
    risks,
    unsupportedClaims: [],
    suspiciousSentences: [],
    missingImportantIdeas,
    sourceAlignedParagraphs: sourceMap.map((item) => ({
      readingParagraph: item.readingParagraph,
      sourceParagraphs: item.sourceRefs.map((ref) => ref.label),
      note: item.note,
    })),
  }
}

export const fidelityAuditSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    suspiciousSentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          sentence: { type: 'string' },
          reason: { type: 'string' },
          sourceParagraphs: { type: 'array', items: { type: 'string' } },
        },
        required: ['readingParagraph', 'sentence', 'reason', 'sourceParagraphs'],
      },
    },
    missingImportantIdeas: { type: 'array', items: { type: 'string' } },
    sourceAlignedParagraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          sourceParagraphs: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['readingParagraph', 'sourceParagraphs', 'note'],
      },
    },
  },
  required: ['score', 'verdict', 'risks', 'unsupportedClaims', 'suspiciousSentences', 'missingImportantIdeas', 'sourceAlignedParagraphs'],
}

export async function auditContentFidelity(content, unit) {
  const local = localFidelityAudit(content, unit)
  const mode = String(process.env.QUALITY_AUDIT_MODE || 'auto').toLowerCase()
  if (mode === 'off' || !textAiConfigured() || !unit?.sourceText) return local

  try {
    const readingText = (content?.reading?.paragraphs || []).map((paragraph, index) => `Paragraph ${index + 1}: ${paragraph.text}`).join('\n\n')
    const sourceRefs = sourceParagraphs(unit)
      .slice(0, 12)
      .map((item) => `Source paragraph ${item.index + 1}: ${takeWords(item.text, 140)}`)
      .join('\n\n')
    const parsed = await callTextAi(
      {
        instructions: 'You audit whether a graded English lesson stays faithful to its source. Do not rewrite the lesson. Return only schema-valid JSON.',
        schema: fidelityAuditSchema,
        schemaName: 'fidelity_audit',
        reasoningEffort: 'low',
        verbosity: 'low',
        input: `
Compare the source excerpts and generated lesson.

Rules:
- Score 1.0 means fully faithful; 0.0 means mostly unsupported.
- List unsupported claims only if the lesson says something not supported by the source.
- In suspiciousSentences, copy the exact generated sentence when a specific sentence is unsupported or weakly supported.
- List important missing ideas only if they are central to the source excerpt.
- Map each generated reading paragraph to the best matching source paragraph labels when possible.

Source:
${sourceRefs}

Generated lesson:
${readingText}
`,
      },
      'AI 审稿',
    )
    return {
      ...local,
      ...parsed,
      mode: 'ai',
      localScore: local.score,
      risks: [...new Set([...(local.risks || []), ...(parsed.risks || [])])],
      missingImportantIdeas: [...new Set([...(local.missingImportantIdeas || []), ...(parsed.missingImportantIdeas || [])])].slice(0, 12),
    }
  } catch (error) {
    return {
      ...local,
      mode: 'local',
      error: error.message || 'AI 审稿不可用',
      risks: [...(local.risks || []), 'AI 忠实度审稿不可用，已使用本地检查'],
    }
  }
}

export function assessContentQuality(content, unit = null) {
  const readingText = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  const readingWords = wordCount(readingText)
  const listeningWords = wordCount(content?.listening?.text || '')
  const paragraphCount = content?.reading?.paragraphs?.length || 0
  const questionCount = content?.questions?.length || 0
  const warnings = []
  const audit = content?.qualityAudit || (unit ? localFidelityAudit(content, unit) : null)
  const sourceMap = unit ? mapReadingToSource(content, unit) : []
  const sourceKeywords = unit ? extractKeywords(unit.sourceText, 12) : []
  const readingLower = readingText.toLowerCase()
  const coveredKeywords = sourceKeywords.filter((keyword) => readingLower.includes(keyword.toLowerCase()))
  const keywordCoverage = sourceKeywords.length ? coveredKeywords.length / sourceKeywords.length : 1

  if (readingWords < 650) warnings.push('阅读正文偏短')
  if (readingWords > 950) warnings.push('阅读正文偏长')
  if (paragraphCount !== 5) warnings.push('段落数偏离目标')
  if (listeningWords < 150 || listeningWords > 260) warnings.push('听力预热长度需要调整')
  if (questionCount < 4) warnings.push('理解题偏少')
  if (keywordCoverage < 0.35) warnings.push('原文关键词覆盖偏低')
  if (!String(content?.fidelityNote || '').toLowerCase().includes('source')) warnings.push('忠实度说明不足')
  if (audit?.score !== undefined && Number(audit.score) < 0.55) warnings.push('AI 忠实度审稿分数偏低')
  if (audit?.unsupportedClaims?.length) warnings.push('AI 审稿发现疑似未受原文支持的表述')
  if (sourceMap.some((item) => !item.sourceRefs.length)) warnings.push('部分段落缺少明确来源映射')

  return {
    readingWords,
    listeningWords,
    paragraphCount,
    questionCount,
    sourceRefs: unit ? makeSourceRefs(unit) : [],
    sourceMap,
    fidelity: {
      keywordCoverage,
      coveredKeywords,
      missingKeywords: sourceKeywords.filter((keyword) => !coveredKeywords.includes(keyword)),
      sourceLocation: unit?.sourceLocation || content?.sourceLocation || '',
      audit,
    },
    status: warnings.length ? 'review' : 'good',
    warnings,
  }
}

export function isLowFidelityQuality(quality) {
  const audit = quality?.fidelity?.audit
  const score = audit?.score === undefined ? 1 : Number(audit.score)
  const unsupportedCount = (audit?.unsupportedClaims || []).length
  const suspiciousCount = (audit?.suspiciousSentences || []).length
  const unmappedCount = (quality?.sourceMap || []).filter((item) => !item.sourceRefs?.length).length
  return score < 0.6 || unsupportedCount > 0 || suspiciousCount > 1 || unmappedCount > 1
}

export function fidelityRepairNotesFromQuality(quality) {
  const audit = quality?.fidelity?.audit || {}
  const notes = []
  if (audit.score !== undefined) notes.push(`The failed draft received a fidelity score of ${audit.score}. Aim for a clearly higher score by staying closer to the source.`)
  for (const claim of (audit.unsupportedClaims || []).slice(0, 5)) notes.push(`Remove or rewrite this unsupported claim unless it is directly in the source: ${claim}`)
  for (const sentence of (audit.suspiciousSentences || []).slice(0, 5)) {
    notes.push(`Check generated paragraph ${sentence.readingParagraph || '?'} carefully; suspicious sentence: ${sentence.sentence}`)
  }
  const missingKeywords = (quality?.fidelity?.missingKeywords || []).slice(0, 8)
  if (missingKeywords.length) notes.push(`Preserve central source ideas when supported: ${missingKeywords.join(', ')}`)
  const unmapped = (quality?.sourceMap || []).filter((item) => !item.sourceRefs?.length).map((item) => item.readingParagraph).slice(0, 5)
  if (unmapped.length) notes.push(`Make reading paragraphs ${unmapped.join(', ')} directly traceable to the provided source.`)
  return notes
}

export function adaptiveSuggestion(report, settings) {
  const score = report.correctRate
  const words = report.newVocabularyCount
  if (score >= 0.85 && words <= 8) {
    return {
      reading: `阅读正确率较高，下一阶段可以考虑从 ${settings.readingLevel} 小幅提高。`,
      listening: `听力先保持 ${settings.listeningLevel}，确保先听后读仍然轻松。`,
      action: 'consider-up',
    }
  }
  if (score < 0.6 || words > 18) {
    return {
      reading: `当前阅读材料可能偏难，建议暂时保持 ${settings.readingLevel}，并多复习核心词。`,
      listening: `听力继续保持 ${settings.listeningLevel}。`,
      action: 'hold',
    }
  }
  return {
    reading: `当前阅读难度基本合适，继续保持 ${settings.readingLevel}。`,
    listening: `听力难度保持 ${settings.listeningLevel}。`,
    action: 'stay',
  }
}

export function exampleSentenceForTerm(content, term) {
  const target = String(term || '').toLowerCase()
  const text = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  return splitSentences(text).find((sentence) => sentence.toLowerCase().includes(target)) || ''
}
