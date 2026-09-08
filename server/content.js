// Graded-reading content generation.
//
// Every prompt here insists on fidelity to the uploaded source: the model
// rewrites for level, it never adds facts. When no text model is configured the
// local fallback builds a usable lesson from the source text directly, so the
// whole study loop still works offline.
import crypto from 'node:crypto'
import { nanoid } from 'nanoid'
import { callTextAi, textAiConfigured } from './ai-runtime.js'
import { extractKeywords, normalizeText, splitSentences, takeWords, titleCase, wordCount } from './text.js'
import { levelIndex, listeningLevels, normalizeLevel, readingLevels } from './levels.js'
import { assessContentQuality, auditContentFidelity, exampleSentenceForTerm } from './quality.js'
import { normalizeUnitContent } from './content-compat.js'

export function makeFallbackContent(unit, settings) {
  const sentences = splitSentences(unit.sourceText)
  const keySentences = selectSentences(sentences, 28)
  const keywords = extractKeywords(unit.sourceText, 8)
  const paragraphs = buildReadingParagraphs(keySentences)
  const vocabulary = keywords.slice(0, 10).map((term) => ({
    term,
    meaningZh: fallbackChineseMeaning(term),
    simpleEnglish: `A key word from the source text. Notice how the book uses "${term}" in this topic.`,
  }))
  const concepts = vocabulary.slice(0, 5).map((item) => ({
    term: item.term,
    simpleEnglish: item.simpleEnglish,
    chinese: item.meaningZh,
  }))
  const listeningText = buildListeningText(unit.title, keySentences, keywords)

  return {
    title: unit.title,
    level: {
      reading: settings.readingLevel,
      listening: settings.listeningLevel,
    },
    sourceLocation: unit.sourceLocation,
    background: `This unit introduces one idea from the source book in clear adult English.`,
    concepts,
    listening: {
      text: listeningText,
      transcriptHiddenByDefault: true,
    },
    reading: {
      paragraphs: paragraphs.map((text, index) => ({
        text,
        summaryZh: `第 ${index + 1} 段概括了原书这一部分的核心信息。`,
      })),
    },
    vocabulary,
    questions: makeQuestions(unit.title, paragraphs),
    generationMode: 'local-demo',
    fidelityNote: '本地演示生成器只使用原文句子做简化重组；配置 AI key 后会得到更自然的分级改写。',
  }
}

export function selectSentences(sentences, maxCount) {
  const chosen = []
  const seen = new Set()
  for (const sentence of sentences) {
    const compact = sentence.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 90)
    if (seen.has(compact)) continue
    seen.add(compact)
    chosen.push(simplifySentence(sentence))
    if (chosen.length >= maxCount) break
  }
  return chosen
}

export function simplifySentence(sentence) {
  return sentence
    .replace(/\s*\([^)]{20,}\)/g, '')
    .replace(/; /g, '. ')
    .replace(/,\s+(which|who|where|when)\s+/gi, '. This ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildReadingParagraphs(sentences) {
  const paragraphs = []
  let current = []
  for (const sentence of sentences) {
    current.push(sentence)
    if (current.length >= 4) {
      paragraphs.push(current.join(' '))
      current = []
    }
  }
  if (current.length) paragraphs.push(current.join(' '))
  return paragraphs.slice(0, 8)
}

export function buildListeningText(title, sentences, keywords) {
  const lead = `This short listening preview is about ${title.toLowerCase()}.`
  const simple = sentences.slice(0, 7).map((sentence) => {
    const words = sentence.split(/\s+/)
    return words.length > 24 ? `${words.slice(0, 24).join(' ')}.` : sentence
  })
  const keyLine = keywords.length ? `Listen for these ideas: ${keywords.slice(0, 4).join(', ')}.` : ''
  return normalizeText([lead, keyLine, ...simple].filter(Boolean).join(' '))
}

export function fallbackChineseMeaning(term) {
  const dictionary = {
    empire: '帝国',
    inflation: '通货膨胀',
    market: '市场',
    trade: '贸易',
    tax: '税收',
    parliament: '议会',
    sovereignty: '主权',
    colony: '殖民地',
    capital: '资本',
    labor: '劳动',
    crisis: '危机',
    reform: '改革',
    revolution: '革命',
    policy: '政策',
    institution: '制度、机构',
  }
  return dictionary[term.toLowerCase()] || '核心词，请结合上下文理解'
}

export function fallbackDefinition(term) {
  return {
    term,
    meaningZh: fallbackChineseMeaning(term),
    simpleEnglish: `A word from the reading text. Use the sentence context to understand how "${term}" works here.`,
  }
}

export function makeQuestions(title, paragraphs) {
  const first = paragraphs[0] || `This unit is about ${title}.`
  const second = paragraphs[1] || first
  return [
    {
      id: nanoid(),
      prompt: `What is the main topic of this unit?`,
      options: [title, 'A personal travel story', 'A grammar rule only', 'A list of random words'],
      answerIndex: 0,
      explanationZh: '本题考查你是否理解了单元主题。',
    },
    {
      id: nanoid(),
      prompt: 'Which sentence best matches the source idea?',
      options: [first.slice(0, 160), 'The text asks readers to ignore historical context.', 'The unit is unrelated to the book.', 'The author only talks about language learning.'],
      answerIndex: 0,
      explanationZh: '正确选项来自阅读正文，并保持了原文含义。',
    },
    {
      id: nanoid(),
      prompt: 'What should you do if a concept is difficult?',
      options: ['Use the concept preview and Chinese help.', 'Skip the whole unit forever.', 'Read only the answer choices.', 'Change every English word into Chinese.'],
      answerIndex: 0,
      explanationZh: '复杂概念先看简单英文解释，再回到正文。',
    },
    {
      id: nanoid(),
      prompt: 'Which statement is supported by this unit?',
      options: [second.slice(0, 160), 'The AI adds new opinions freely.', 'The source location is hidden.', 'Difficult words are never allowed.'],
      answerIndex: 0,
      explanationZh: '本应用要求忠于原书，同时允许保留必要难词。',
    },
  ]
}

export async function generateWithOpenAI(unit, settings) {
  if (!textAiConfigured()) return null

  const source = takeWords(unit.sourceText, 2600)
  const strictFidelityPrompt = buildStrictFidelityPrompt(unit, settings)
  const prompt = `
Generate a personal English graded-reading lesson from a copyrighted source the user uploaded for private study.

Follow these rules:
- Be strictly faithful to the source. Do not add opinions, examples, facts, or claims that are not in the source.
- Rewrite only for language learning.
- Use clear adult English at CEFR ${settings.readingLevel}. It may include necessary harder terms.
- Listening text must be easier than the reading text, CEFR ${settings.listeningLevel}, about 180-240 words at normal speed.
- Reading text must contain exactly 5 paragraphs.
- Each reading paragraph must be 130-170 words.
- The total reading text must be 700-850 words. Never exceed 900 words.
- If the source contains too much information, preserve the central argument and most important details. Omit minor details instead of making the lesson longer.
- Explain 3-6 complex concepts before the reading.
- Include 8-12 useful vocabulary items.
- Include 4-6 comprehension questions.
- The JSON must match the supplied schema.
${strictFidelityPrompt}

Source:
${source}
`

  const parsed = await callTextAi({
    instructions: 'You write faithful graded-reading lessons. Return only schema-valid JSON.',
    input: prompt,
    schema: gradedReadingLessonSchema,
    schemaName: 'graded_reading_lesson',
    normalizeResponse: (value) => normalizeGeneratedLesson(value, unit),
  })
  parsed.generationMode = 'ai'
  parsed.questions = (parsed.questions || []).map((question) => ({
    ...question,
    id: question.id || nanoid(),
  }))
  return parsed
}

export function normalizeGeneratedLesson(content, unit = {}) {
  const normalized = normalizeUnitContent(content, unit)
  if (!normalized) return null
  return {
    title: normalized.title,
    level: normalized.level,
    sourceLocation: normalized.sourceLocation,
    background: normalized.background,
    concepts: (normalized.concepts || []).map(({ term, simpleEnglish, chinese }) => ({ term, simpleEnglish, chinese })),
    listening: {
      text: normalized.listening?.text || '',
      transcriptHiddenByDefault: normalized.listening?.transcriptHiddenByDefault !== false,
    },
    reading: {
      paragraphs: (normalized.reading?.paragraphs || []).map(({ text, summaryZh }) => ({ text, summaryZh })),
    },
    vocabulary: (normalized.vocabulary || []).map(({ term, meaningZh, simpleEnglish }) => ({ term, meaningZh, simpleEnglish })),
    questions: (normalized.questions || []).map(({ id, prompt, options, answerIndex, explanationZh }) => ({
      id,
      prompt,
      options,
      answerIndex,
      explanationZh,
    })),
    generationMode: normalized.generationMode,
    fidelityNote: normalized.fidelityNote,
  }
}

export function buildStrictFidelityPrompt(unit, settings = {}) {
  if (settings.fidelityMode !== 'strict') return ''
  const audit = unit?.quality?.fidelity?.audit || {}
  const unsupportedClaims = (audit.unsupportedClaims || []).slice(0, 8)
  const missingImportantIdeas = (audit.missingImportantIdeas || []).slice(0, 8)
  const missingKeywords = (unit?.quality?.fidelity?.missingKeywords || []).slice(0, 10)
  const unmappedParagraphs = (unit?.quality?.sourceMap || [])
    .filter((item) => !item.sourceRefs?.length)
    .map((item) => `reading paragraph ${item.readingParagraph}`)
    .slice(0, 8)
  const explicitRepairNotes = Array.isArray(settings.fidelityRepairNotes) ? settings.fidelityRepairNotes.slice(0, 10) : []

  const repairNotes = []
  if (unsupportedClaims.length) repairNotes.push(`Unsupported claims from the previous audit: ${unsupportedClaims.join(' | ')}`)
  if (missingImportantIdeas.length) repairNotes.push(`Important source ideas possibly missed: ${missingImportantIdeas.join(' | ')}`)
  if (missingKeywords.length) repairNotes.push(`Source keywords or ideas to preserve when genuinely central: ${missingKeywords.join(', ')}`)
  if (unmappedParagraphs.length) repairNotes.push(`Previous reading paragraphs without clear source mapping: ${unmappedParagraphs.join(', ')}`)
  repairNotes.push(...explicitRepairNotes.map((note) => `Latest failed draft issue: ${note}`))

  return `

Strict fidelity repair mode:
- The previous version was flagged for low source fidelity. Produce a more conservative version.
- Every reading paragraph must be traceable to the provided source. If a point is not directly supported, omit it.
- Do not add background facts, dates, motives, evaluations, examples, or causal explanations unless they appear in the source excerpt.
- Prefer cautious wording when the source is cautious. Preserve uncertainty and attribution.
- It is better to be slightly less smooth than to add unsupported content.
- In fidelityNote, explicitly state that this version was regenerated for strict source fidelity and uses only the provided source excerpt.
${repairNotes.map((note) => `- ${note}`).join('\n')}
`
}

export const gradedReadingLessonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    level: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reading: { type: 'string' },
        listening: { type: 'string' },
      },
      required: ['reading', 'listening'],
    },
    sourceLocation: { type: 'string' },
    background: { type: 'string' },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string' },
          simpleEnglish: { type: 'string' },
          chinese: { type: 'string' },
        },
        required: ['term', 'simpleEnglish', 'chinese'],
      },
    },
    listening: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 1 },
        transcriptHiddenByDefault: { type: 'boolean' },
      },
      required: ['text', 'transcriptHiddenByDefault'],
    },
    reading: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paragraphs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              summaryZh: { type: 'string' },
            },
            required: ['text', 'summaryZh'],
          },
        },
      },
      required: ['paragraphs'],
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string' },
          meaningZh: { type: 'string' },
          simpleEnglish: { type: 'string' },
        },
        required: ['term', 'meaningZh', 'simpleEnglish'],
      },
    },
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
          },
          answerIndex: { type: 'number' },
          explanationZh: { type: 'string' },
        },
        required: ['id', 'prompt', 'options', 'answerIndex', 'explanationZh'],
      },
    },
    generationMode: { type: 'string' },
    fidelityNote: { type: 'string' },
  },
  required: [
    'title',
    'level',
    'sourceLocation',
    'background',
    'concepts',
    'listening',
    'reading',
    'vocabulary',
    'questions',
    'generationMode',
    'fidelityNote',
  ],
}

export function getResponsesOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text

  const chunks = []
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text)
      if (typeof content?.content === 'string') chunks.push(content.content)
    }
  }
  return chunks.join('').trim()
}

export const wordDefinitionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    term: { type: 'string' },
    meaningZh: { type: 'string' },
    simpleEnglish: { type: 'string' },
  },
  required: ['term', 'meaningZh', 'simpleEnglish'],
}

export async function generateWordDefinition(term, sentence) {
  if (!textAiConfigured()) return fallbackDefinition(term)

  const prompt = `
Define the English word for a Chinese-speaking adult English learner.

Rules:
- Use the sentence context to choose the right meaning.
- Keep meaningZh short and useful.
- Keep simpleEnglish at CEFR A2-B1.
- Return schema-valid JSON only.

Word: ${term}
Sentence: ${sentence || ''}
`

  return callTextAi(
    {
      instructions: 'You provide concise contextual English word definitions for Chinese-speaking learners.',
      input: prompt,
      schema: wordDefinitionSchema,
      schemaName: 'word_definition',
      reasoningEffort: 'low',
      verbosity: 'low',
    },
    '单词释义',
  )
}

export function definitionCacheKey(term, sentence) {
  const normalized = `${String(term || '').toLowerCase()}\n${String(sentence || '').toLowerCase().slice(0, 260)}`
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function generationSettingsFromBody(settings, body = {}) {
  const fidelityMode = body.fidelityMode === 'strict' || body.qualityFocus === 'fidelity' ? 'strict' : ''
  return {
    ...settings,
    readingLevel: normalizeLevel(readingLevels, body.readingLevel, settings.readingLevel),
    listeningLevel: normalizeLevel(listeningLevels, body.listeningLevel, settings.listeningLevel),
    fidelityMode,
  }
}

export async function buildGeneratedContent(unit, generationSettings) {
  let content = null
  let aiError = ''
  try {
    content = await generateWithOpenAI(unit, generationSettings)
  } catch (error) {
    aiError = error.message
  }
  const allowLocalFallback = (process.env.ALLOW_LOCAL_FALLBACK ?? 'true') !== 'false'
  if (!content && !allowLocalFallback) {
    throw new Error(`AI 文本生成失败，本地演示兜底已按配置禁用（ALLOW_LOCAL_FALLBACK=false）。原始错误: ${aiError}`)
  }
  if (!content) content = makeFallbackContent(unit, generationSettings)
  content = normalizeGeneratedLesson(content, unit)
  content.qualityAudit = await auditContentFidelity(content, unit)
  if (aiError) content.fidelityNote = `${content.fidelityNote || ''} AI 调用失败，已使用本地演示生成器。${aiError}`.trim()
  return content
}
