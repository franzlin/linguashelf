// Single-host podcast planning, scripting and the book glossary.
//
// Four kinds — read-before preview, read-after review, whole-book topic, and
// whole-book walkthrough episodes. Scripts stay faithful to the book for the
// same reason units do; the local fallback script is used when no text model is
// configured.
import { nanoid } from 'nanoid'
import {
  maxPodcastEpisodes,
  podcastKindLabels,
  podcastKindOrder,
  podcastLexileDefault,
  podcastScriptSourceChunkWords,
} from './config.js'
import { callTextAi, textAiConfigured } from './ai-runtime.js'
import { extractKeywords, normalizeText, splitSentences, takeWords, titleCase, wordCount } from './text.js'
import { splitIntoSourceUnits } from './units.js'

export function normalizePodcastKind(value) {
  const kind = String(value || '').trim().toLowerCase()
  if (podcastKindOrder.includes(kind)) return kind
  if (['intro', 'before', 'pre-reading', 'prereading'].includes(kind)) return 'preview'
  if (['recap', 'after', 'post-reading', 'postreading'].includes(kind)) return 'review'
  if (['full', 'theme', 'thematic'].includes(kind)) return 'topic'
  return 'walkthrough'
}

export function podcastKindLabel(kind) {
  return podcastKindLabels[normalizePodcastKind(kind)] || podcastKindLabels.walkthrough
}

export function sortPodcasts(a, b) {
  const kindDiff = podcastKindOrder.indexOf(normalizePodcastKind(a.kind)) - podcastKindOrder.indexOf(normalizePodcastKind(b.kind))
  if (kindDiff) return kindDiff
  return Number(a.index || 0) - Number(b.index || 0)
}

export const podcastScriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    script: { type: 'string' },
  },
  required: ['title', 'script'],
}

export function podcastPromptProfile(kind, lexile) {
  const safeKind = normalizePodcastKind(kind)
  if (safeKind === 'preview') {
    return `
Podcast Type: Read-before preview.
Goal: Prepare the listener before reading the related source section. Make the upcoming reading easier.
Structure:
- Open with one clear guiding question.
- Explain the background, people, institutions, and difficult concepts that the listener needs first.
- Introduce 5 to 8 high-value words in context.
- Give a light map of the source without trying to cover every detail.
- End by telling the listener what to notice while reading.
Style: simpler than the reading text, calm, practical, and not too dense.
Do not turn this into a full summary.`
  }
  if (safeKind === 'review') {
    return `
Podcast Type: After-reading review.
Goal: Help the listener consolidate the source after reading it.
Structure:
- Start by reminding the listener of the central issue.
- Review the key events, arguments, and cause-effect links.
- Clarify confusing concepts in simple English.
- Include a short self-check section with 3 spoken questions and immediate answers.
- End with a concise takeaway.
Style: reflective, precise, and slightly more analytical than the preview.`
  }
  if (safeKind === 'topic') {
    return `
Podcast Type: Full-book thematic episode.
Goal: Use representative source excerpts to explain one major theme or question across the book.
Structure:
- Start with a broad theme or question supported by the source.
- Organize by ideas, forces, and cause-effect relationships, not by page order.
- Connect evidence from different source locations when possible.
- Explain why the theme matters for understanding the whole book.
- End with a compact synthesis.
Style: like a serious single-host knowledge podcast for an English learner.
Do not pretend to have read material that is not present in the source excerpts.`
  }
  return `
Podcast Type: Sequential guided explanation.
Goal: Explain the source section in order as a detailed teacher-led lesson.
Structure:
- Start with a simple introduction.
- Explain every key detail and concept from the source.
- After a few main ideas, add a short "Micro-Recap".
- Keep the original logic and order clear.
Style: patient, encouraging, clear teacher.
Focus on depth over brevity.`
}

export function localPodcastScript(sourceText, kind, episodeNumber = 1, part = null) {
  const label = podcastKindLabel(kind)
  const partName = part ? `, part ${part.index}` : ''
  const source = takeWords(sourceText, normalizePodcastKind(kind) === 'preview' ? 520 : 900)
  if (normalizePodcastKind(kind) === 'preview') {
    return `Welcome to this LinguaShelf ${label} lesson${partName}. Before you read, listen for the main people, places, and ideas in this source section. The important point is to make the reading feel familiar before you start. Here is the source in simpler language: ${source} Micro-Recap: when you read, pay attention to the main question, the important names, and the cause-and-effect links.`
  }
  if (normalizePodcastKind(kind) === 'review') {
    return `Welcome to this LinguaShelf ${label} lesson${partName}. You have already met the source section, so now we will review the main ideas and make them easier to remember. ${source} Self-check: What was the central issue? Which people or forces mattered most? What changed by the end of this section? Micro-Recap: this review connects the source ideas and helps you remember them.`
  }
  if (normalizePodcastKind(kind) === 'topic') {
    return `Welcome to this LinguaShelf ${label} lesson. This episode looks across the book excerpts for one larger theme. ${source} Micro-Recap: this full-book topic connects different parts of the source, but it only uses ideas found in the provided text.`
  }
  return `Welcome to this LinguaShelf ${label} lesson${partName}. In this episode, we will learn from the book in simple English. ${source} Micro-Recap: this part connects the important ideas in the source and explains them slowly for learning. That's the end of this part. Play the next episode to keep learning.`
}

export function buildPodcastPrompt(sourceText, lexile, episodeNumber = 1, part = null, kind = 'walkthrough') {
  const safeKind = normalizePodcastKind(kind)
  const partLine = part ? `This is part ${part.index} of ${part.total} for this episode. Explain only this source part, and do not repeat a long episode introduction.` : ''
  const closingRule = part && part.index < part.total ? 'End with one short bridge sentence to the next part. Do not give a final episode closing.' : safeKind === 'preview' ? 'End with one natural line that sends the listener into the related reading.' : safeKind === 'review' ? 'End with one natural review takeaway.' : safeKind === 'topic' ? 'End with one natural synthesis line for the full-book theme.' : 'End the episode with one natural closing line inviting the listener to play the next episode. Do NOT ask the listener to type anything or wait for input.'
  return `
Listener Profile: English Language Learner, target vocabulary level Lexile ${lexile}L.
Create an audio-ready single-host podcast script for English learners.
${podcastPromptProfile(safeKind, lexile)}
${partLine}

Rules:
1. Primarily use vocabulary at Lexile ${lexile}L. If the source uses any difficult word or specialized idea, immediately explain it: state the term, then define it in very simple words.
2. Stay faithful to the source. Do not add claims, facts, examples, or opinions that are not supported by the source.
3. Use natural spoken prose. Do not use markdown, bullet labels, stage directions, or timestamps.
4. Keep a single-speaker professional tone.
5. ${closingRule}

Return JSON: { "title": short episode title, "script": the full spoken script as plain prose, no markdown, no stage directions }.

Podcast type: ${podcastKindLabel(safeKind)}
Episode: ${episodeNumber}
Source:
${sourceText}
`
}

export async function generatePodcastScriptPart(sourceText, lexile, episodeNumber = 1, part = null, kind = 'walkthrough') {
  if (!textAiConfigured()) {
    return {
      title: part ? `${podcastKindLabel(kind)} ${episodeNumber}, part ${part.index}` : `${podcastKindLabel(kind)} ${episodeNumber}`,
      script: localPodcastScript(sourceText, kind, episodeNumber, part),
      mode: 'local-demo',
    }
  }

  const parsed = await callTextAi(
    {
      instructions: 'You write faithful, expanded graded-reading podcast scripts for English learners. Return only schema-valid JSON.',
      input: buildPodcastPrompt(takeWords(sourceText, 3000), lexile, episodeNumber, part, kind),
      schema: podcastScriptSchema,
      schemaName: 'podcast_script',
      verbosity: 'high',
    },
    '播客脚本生成',
  )
  return { title: parsed.title || `${podcastKindLabel(kind)} ${episodeNumber}`, script: parsed.script, mode: 'ai' }
}

export async function generatePodcastScript(sourceText, lexile, episodeNumber = 1, kind = 'walkthrough') {
  const maxWords = podcastScriptSourceChunkWords
  if (wordCount(sourceText) <= maxWords + 400) return generatePodcastScriptPart(sourceText, lexile, episodeNumber, null, kind)

  const parts = splitIntoSourceUnits(sourceText, maxWords).filter((part) => wordCount(part) > 120)
  if (parts.length <= 1) return generatePodcastScriptPart(sourceText, lexile, episodeNumber, null, kind)

  const scripts = []
  for (let index = 0; index < parts.length; index += 1) {
    const result = await generatePodcastScriptPart(parts[index], lexile, episodeNumber, { index: index + 1, total: parts.length }, kind)
    scripts.push(result)
  }
  return {
    title: scripts[0]?.title || `Podcast ${episodeNumber}`,
    script: scripts.map((item) => item.script).join('\n\n'),
    mode: scripts.some((item) => item.mode === 'ai') ? 'ai-segmented' : 'local-demo',
    partCount: scripts.length,
  }
}

export const glossaryCategoryLabels = {
  concept: '概念',
  person: '人名',
  place: '地名',
  institution: '机构/政权',
  term: '术语',
}

export function cleanGlossaryTerm(value) {
  return normalizeText(value)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.()' -]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export function countTermOccurrences(text, term) {
  const source = String(text || '').toLowerCase()
  const needle = String(term || '').toLowerCase()
  if (!source || !needle) return 0
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = source.match(new RegExp(`\\b${escaped}\\b`, 'g'))
  return matches ? matches.length : 0
}

export function classifyProperNoun(term) {
  const value = String(term || '')
  const lower = value.toLowerCase()
  const institutionWords = [
    'government',
    'parliament',
    'congress',
    'council',
    'court',
    'company',
    'bank',
    'party',
    'army',
    'empire',
    'dynasty',
    'kingdom',
    'republic',
    'ministry',
    'committee',
    'university',
    'administration',
  ]
  const placeWords = ['city', 'province', 'state', 'river', 'fort', 'palace', 'gate', 'road', 'street', 'sea', 'bay', 'island', 'delhi', 'india', 'britain', 'england', 'europe', 'asia', 'america']
  if (institutionWords.some((word) => lower.includes(word))) return 'institution'
  if (placeWords.some((word) => lower.includes(word))) return 'place'
  const capitalizedParts = value.match(/\b[A-Z][a-z]+(?:'[a-z]+)?\b/g) || []
  if (capitalizedParts.length >= 2) return 'person'
  return 'place'
}

export function extractProperNounCandidates(text, limit = 30) {
  const candidates = new Map()
  const matches = String(text || '').match(/\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:of|and|the|for|de|al|[A-Z][a-z]+|[A-Z]{2,})){0,4}\b/g) || []
  const blocked = new Set([
    'The',
    'This',
    'That',
    'These',
    'Those',
    'When',
    'Where',
    'After',
    'Before',
    'Because',
    'However',
    'English',
    'Reading',
    'Source',
    'Paragraph',
    'Chapter',
    'Section',
  ])

  for (const raw of matches) {
    const term = cleanGlossaryTerm(raw)
    if (!term || term.length < 4 || blocked.has(term)) continue
    if (/^(The|This|That|When|Where|After|Before)\s+[a-z]/.test(term)) continue
    const words = term.split(/\s+/)
    if (words.length === 1 && !/[A-Z]{2,}/.test(term) && countTermOccurrences(text, term) < 2) continue
    const key = term.toLowerCase()
    candidates.set(key, {
      term,
      category: classifyProperNoun(term),
      count: (candidates.get(key)?.count || 0) + 1,
    })
  }

  return [...candidates.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export function buildBookGlossary(book, units) {
  const entries = new Map()
  const addEntry = (termValue, category, unit, extra = {}) => {
    const term = cleanGlossaryTerm(termValue)
    if (!term || term.length < 3) return
    const key = term.toLowerCase()
    const sourceText = `${unit?.sourceText || ''}\n${JSON.stringify(unit?.content || {})}`
    const occurrence = countTermOccurrences(sourceText, term)
    const existing =
      entries.get(key) || {
        id: key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || nanoid(),
        term,
        category,
        categoryLabel: glossaryCategoryLabels[category] || glossaryCategoryLabels.term,
        meaningZh: '',
        simpleEnglish: '',
        occurrenceCount: 0,
        unitCount: 0,
        sources: [],
        sourceTitles: new Set(),
      }
    existing.category = existing.category === 'term' && category !== 'term' ? category : existing.category
    existing.categoryLabel = glossaryCategoryLabels[existing.category] || glossaryCategoryLabels.term
    existing.meaningZh = existing.meaningZh || extra.meaningZh || extra.chinese || ''
    existing.simpleEnglish = existing.simpleEnglish || extra.simpleEnglish || ''
    existing.occurrenceCount += Math.max(1, occurrence)
    if (unit?.id && !existing.sourceTitles.has(unit.id)) {
      existing.sourceTitles.add(unit.id)
      existing.unitCount += 1
      existing.sources.push({
        unitId: unit.id,
        unitTitle: unit.title,
        sourceLocation: unit.sourceLocation,
      })
    }
    entries.set(key, existing)
  }

  for (const unit of units) {
    for (const concept of unit.content?.concepts || []) addEntry(concept.term, 'concept', unit, concept)
    for (const item of unit.content?.vocabulary || []) addEntry(item.term, 'term', unit, item)
    for (const candidate of extractProperNounCandidates(`${unit.sourceText || ''}\n${unit.sourceExcerpt || ''}`, 20)) {
      addEntry(candidate.term, candidate.category, unit)
    }
  }

  const categoryOrder = ['concept', 'person', 'place', 'institution', 'term']
  const items = [...entries.values()]
    .map((item) => {
      const { sourceTitles, ...safeItem } = item
      return {
        ...safeItem,
        sources: safeItem.sources.slice(0, 4),
      }
    })
    .filter((item) => item.occurrenceCount >= 2 || item.category === 'concept' || item.category === 'term')
    .sort((a, b) => {
      const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      if (categoryDiff) return categoryDiff
      return b.occurrenceCount - a.occurrenceCount || a.term.localeCompare(b.term)
    })
    .slice(0, 80)

  return {
    bookId: book.id,
    itemCount: items.length,
    generatedUnitCount: units.filter((unit) => unit.content).length,
    sourceUnitCount: units.length,
    items,
  }
}

export function publicPodcast(podcast, { includeScript = false } = {}) {
  if (!podcast) return null
  const { sourceText, ...safePodcast } = podcast
  safePodcast.kind = normalizePodcastKind(safePodcast.kind)
  safePodcast.kindLabel = podcastKindLabel(safePodcast.kind)
  if (!includeScript) delete safePodcast.scriptText
  return safePodcast
}

export function unitPodcastSource(unit) {
  return normalizeText(unit?.sourceText || unit?.sourceExcerpt || '')
}

export function representativeBookSource(units, maxWords) {
  const available = units
    .map((unit) => ({ unit, text: unitPodcastSource(unit) }))
    .filter((item) => item.text)
  if (!available.length) return ''

  const perUnit = Math.max(80, Math.floor(maxWords / Math.max(1, available.length)))
  const snippets = available.map(({ unit, text }) => {
    const location = unit.sourceLocation || unit.title || 'Source section'
    return `Source location: ${location}\n${takeWords(text, perUnit)}`
  })
  return takeWords(snippets.join('\n\n'), maxWords)
}

export function planTopicPodcastEpisode(book, units) {
  const bookUnits = units.filter((unit) => unit.bookId === book.id)
  const text = representativeBookSource(bookUnits, Math.max(2200, Math.min(4200, podcastScriptSourceChunkWords + 1000)))
  if (!text) return []
  return [
    {
      unitIds: bookUnits.map((unit) => unit.id),
      text,
      words: wordCount(text),
    },
  ]
}

export function planPodcastEpisodes(book, units, kind = 'walkthrough') {
  const safeKind = normalizePodcastKind(kind)
  if (safeKind === 'topic') return planTopicPodcastEpisode(book, units)

  const bookUnits = units.filter((unit) => unit.bookId === book.id)
  const groups = []
  const targetWords = Number(process.env.PODCAST_SOURCE_WORDS_PER_EPISODE || 2200)
  let current = { unitIds: [], text: '', words: 0 }

  for (const unit of bookUnits) {
    const text = unitPodcastSource(unit)
    if (!text.trim()) continue
    current.unitIds.push(unit.id)
    current.text = current.text ? `${current.text}\n\n${text}` : text
    current.words += Number(unit.sourceWordCount || wordCount(text))
    if (current.words >= targetWords) {
      groups.push(current)
      current = { unitIds: [], text: '', words: 0 }
    }
  }
  if (current.unitIds.length) groups.push(current)
  return groups.slice(0, maxPodcastEpisodes)
}
