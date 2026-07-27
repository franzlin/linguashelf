// Daily micro-practice: short reading or listening drills built from the user's
// books, weak vocabulary, or a chosen topic.
//
// Book-sourced practices carry the same fidelity rule as units — no invented
// facts — which is why a thin source produces a simpler drill rather than a
// padded one.
import { nanoid } from 'nanoid'
import { callTextAi, textAiConfigured } from './ai-runtime.js'
import { extractKeywords, normalizeText, splitSentences, takeWords, wordCount } from './text.js'
import { levelIndex, listeningLevels, normalizeLevel, readingLevels, shiftLevel } from './levels.js'
import { normalizeMicroPracticeTopic, normalizeMicroPracticeType, userSettings } from './settings.js'
import { exampleSentenceForTerm } from './quality.js'
import { exampleSentenceFromText } from './repair.js'
import { fallbackChineseMeaning } from './content.js'
import { buildBookGlossary, representativeBookSource } from './podcast.js'

export const microCompletionLocks = new Map()

export const microPracticeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    transcriptHiddenByDefault: { type: 'boolean' },
    sourceSummary: { type: 'string' },
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
          relatedTerms: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['id', 'prompt', 'options', 'answerIndex', 'explanationZh', 'relatedTerms'],
      },
    },
  },
  required: ['title', 'body', 'transcriptHiddenByDefault', 'sourceSummary', 'concepts', 'vocabulary', 'questions'],
}

export function microPracticeTypeLabel(type) {
  return normalizeMicroPracticeType(type) === 'listening' ? '听力轻练' : '短文阅读'
}

export function microTopicLabel(topic) {
  const labels = {
    book: '最近书籍',
    'weak-vocabulary': '近期生词',
    history: '历史',
    politics: '政治',
    economics: '经济',
    technology: '科技',
    random: '随机主题',
    custom: '自定义主题',
  }
  return labels[normalizeMicroPracticeTopic(topic)] || '每日轻练'
}

export function resolveMicroPracticeType(settings, body = {}) {
  const requested = normalizeMicroPracticeType(body.type || body.practiceType || settings.microPracticeType, 'random')
  if (requested !== 'random') return requested
  return Math.random() > 0.48 ? 'reading' : 'listening'
}

export function resolveMicroDifficulty(settings, body = {}) {
  return normalizeLevel([...listeningLevels, ...readingLevels], body.difficulty || settings.microPracticeDifficulty, settings.readingLevel)
}

export function userBooksSorted(db, userId) {
  return db.books
    .filter((book) => book.userId === userId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
}

export function selectMicroBook(db, userId, bookId = '') {
  const books = userBooksSorted(db, userId)
  if (!books.length) return null
  if (bookId) return books.find((book) => book.id === bookId) || null
  const userBookIds = new Set(books.map((book) => book.id))
  const recentProgress = db.progress
    .filter((item) => item.userId === userId && userBookIds.has(db.units.find((unit) => unit.id === item.unitId)?.bookId))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const progressUnit = recentProgress.length ? db.units.find((unit) => unit.id === recentProgress[0].unitId) : null
  if (progressUnit) return books.find((book) => book.id === progressUnit.bookId) || books[0]
  return books[0]
}

export function buildMicroPracticeContext(db, userId, settings, body = {}) {
  let topic = normalizeMicroPracticeTopic(body.topic || settings.microPracticeTopic, 'book')
  const books = userBooksSorted(db, userId)
  const vocabulary = db.vocabulary.filter((item) => item.userId === userId)
  if (topic === 'random') {
    const pool = ['history', 'politics', 'economics', 'technology']
    if (books.length) pool.push('book')
    if (vocabulary.length) pool.push('weak-vocabulary')
    topic = pool[Math.floor(Math.random() * pool.length)] || 'history'
  }

  if (topic === 'book') {
    const book = selectMicroBook(db, userId, body.bookId)
    if (book) {
      const units = db.units.filter((unit) => unit.bookId === book.id)
      const generatedUnits = units.filter((unit) => unit.content)
      const glossary = buildBookGlossary(book, units)
      const glossaryTerms = (glossary.items || []).slice(0, 10).map((item) => item.term)
      const generatedTerms = generatedUnits
        .flatMap((unit) => unit.content?.vocabulary || [])
        .map((item) => item.term)
        .filter(Boolean)
        .slice(0, 10)
      const keyTerms = [...new Set([...glossaryTerms, ...generatedTerms])].slice(0, 10)
      const contextUnits = generatedUnits.length ? generatedUnits.slice(-8) : units.slice(0, 8)
      const sourceContext = representativeBookSource(contextUnits, 1200) || takeWords(units.map((unit) => unit.sourceExcerpt).join('\n\n'), 900)
      return {
        topic,
        topicLabel: `书籍：${book.title}`,
        sourceMode: 'book',
        sourceBookId: book.id,
        sourceBookTitle: book.title,
        sourceSummary: `来自《${book.title}》的近期学习内容。`,
        sourceContext,
        keyTerms,
      }
    }
    topic = 'history'
  }

  if (topic === 'weak-vocabulary') {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const weakItems = vocabulary
      .map((item) => {
        const mastery = Math.max(0, Number(item.mastery || 0))
        const lastSeenAt = Date.parse(item.lastSeenAt || item.createdAt || '') || 0
        const ageDays = lastSeenAt ? Math.max(0, (now - lastSeenAt) / dayMs) : 365
        const dueAt = Date.parse(item.dueAt || '')
        const due = !item.dueAt || (Number.isFinite(dueAt) && dueAt <= now)
        const score = Math.max(0, 45 - ageDays) + Math.max(0, 4 - mastery) * 12 + (due ? 20 : 0)
        return { item, mastery, lastSeenAt, ageDays, due, score }
      })
      .filter(({ mastery, ageDays, due }) => ageDays <= 90 || mastery <= 2 || due)
      .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt || a.mastery - b.mastery)
      .slice(0, 10)
      .map(({ item }) => item)
    if (weakItems.length) {
      return {
        topic,
        topicLabel: '近期生词',
        sourceMode: 'vocabulary',
        sourceBookId: '',
        sourceBookTitle: '',
        sourceSummary: `围绕 ${weakItems.slice(0, 5).map((item) => item.term).join(', ')} 等薄弱词生成。`,
        sourceContext: weakItems.map((item) => `${item.term}: ${item.simpleEnglish || item.meaningZh || ''}`).join('\n'),
        keyTerms: weakItems.map((item) => item.term).filter(Boolean),
      }
    }
    topic = 'history'
  }

  if (topic === 'custom') {
    const custom = normalizeText(body.customTopic || settings.microPracticeCustomTopic).slice(0, 80)
    if (custom) {
      return {
        topic,
        topicLabel: custom,
        sourceMode: 'custom',
        sourceBookId: '',
        sourceBookTitle: '',
        sourceSummary: `自定义主题：${custom}`,
        sourceContext: '',
        keyTerms: extractKeywords(custom, 6),
      }
    }
    topic = 'history'
  }

  const genericTopics = {
    history: 'history and historical change',
    politics: 'political institutions and public decisions',
    economics: 'markets, trade, work, and economic choices',
    technology: 'technology and its effects on society',
  }
  return {
    topic,
    topicLabel: microTopicLabel(topic),
    sourceMode: 'general',
    sourceBookId: '',
    sourceBookTitle: '',
    sourceSummary: `通用主题：${microTopicLabel(topic)}`,
    sourceContext: genericTopics[topic] || genericTopics.history,
    keyTerms: extractKeywords(genericTopics[topic] || genericTopics.history, 6),
  }
}

export function normalizeMicroPracticeContent(content, type, context) {
  const body = normalizeText(content?.body || '')
  const fallback = fallbackMicroPracticeContent(type, context)
  const normalized = {
    title: normalizeText(content?.title || fallback.title).slice(0, 100) || fallback.title,
    body: body || fallback.body,
    transcriptHiddenByDefault: type === 'listening' ? content?.transcriptHiddenByDefault !== false : false,
    sourceSummary: normalizeText(content?.sourceSummary || context.sourceSummary || fallback.sourceSummary).slice(0, 220),
    concepts: Array.isArray(content?.concepts) ? content.concepts : fallback.concepts,
    vocabulary: Array.isArray(content?.vocabulary) ? content.vocabulary : fallback.vocabulary,
    questions: Array.isArray(content?.questions) ? content.questions : fallback.questions,
  }
  normalized.concepts = normalized.concepts.slice(0, 4).map((item) => ({
    term: normalizeText(item.term).slice(0, 60),
    simpleEnglish: normalizeText(item.simpleEnglish).slice(0, 180),
    chinese: normalizeText(item.chinese).slice(0, 120),
  })).filter((item) => item.term && item.simpleEnglish)
  normalized.vocabulary = normalized.vocabulary.slice(0, 8).map((item) => ({
    term: normalizeText(item.term).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').slice(0, 60),
    meaningZh: normalizeText(item.meaningZh || fallbackChineseMeaning(item.term)).slice(0, 120),
    simpleEnglish: normalizeText(item.simpleEnglish || 'A useful word from this practice.').slice(0, 180),
  })).filter((item) => item.term)
  normalized.questions = normalized.questions.slice(0, 3).map((question) => {
    const options = Array.isArray(question.options) ? question.options.map((option) => normalizeText(option).slice(0, 180)).filter(Boolean).slice(0, 4) : []
    while (options.length < 4) options.push(['Not stated in the text.', 'The opposite idea.', 'A minor detail.', 'A new claim.'][options.length] || 'Not supported.')
    const answerIndex = Math.max(0, Math.min(options.length - 1, Math.round(Number(question.answerIndex || 0))))
    return {
      id: normalizeText(question.id || nanoid()),
      prompt: normalizeText(question.prompt).slice(0, 220) || 'What is the main idea?',
      options,
      answerIndex,
      explanationZh: normalizeText(question.explanationZh || '答案可以从材料中直接找到。').slice(0, 220),
      relatedTerms: (Array.isArray(question.relatedTerms) ? question.relatedTerms : [])
        .map((term) => normalizeText(term).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').slice(0, 60))
        .filter(Boolean)
        .slice(0, 4),
    }
  })
  if (!normalized.questions.length) normalized.questions = fallback.questions
  return normalized
}

export async function generateMicroPracticeWithOpenAI(type, difficulty, context) {
  if (!textAiConfigured()) return null

  const isListening = type === 'listening'
  const fidelityRules =
    context.sourceMode === 'book'
      ? '- The practice must be strictly based on the provided book source context. Do not add external facts, examples, opinions, dates, or causal claims.\n- If the source context is thin, make a simpler practice instead of inventing details.'
      : context.sourceMode === 'vocabulary'
        ? '- Use the weak vocabulary naturally and accurately. Keep the topic adult and concrete.'
        : '- Use reliable general knowledge, but keep the language simple and avoid controversial unsupported claims.'

  return callTextAi(
    {
      instructions: 'You create short English micro-practice packages for a Chinese-speaking adult learner. Return only schema-valid JSON.',
      schema: microPracticeSchema,
      schemaName: 'micro_practice',
      input: `
Create one ${isListening ? 'listening' : 'reading'} micro-practice for a busy adult English learner.

Rules:
- Target level: CEFR ${difficulty}.
- UI language is Chinese, but the learning material must be English.
- ${isListening ? 'Write one natural TTS script, about 80-120 words, for 30-60 seconds of normal-speed listening.' : 'Write one short reading text, about 100-150 words.'}
- Include 2-3 multiple-choice comprehension questions with exactly 4 options.
- Include 4-7 vocabulary items and 1-3 simple concept previews.
- relatedTerms should list vocabulary/concepts connected to each question, especially for wrong-answer review.
${fidelityRules}

Topic: ${context.topicLabel}
Source summary: ${context.sourceSummary}
Key terms: ${(context.keyTerms || []).join(', ') || 'none'}

Source context:
${takeWords(context.sourceContext || '', 1200)}
`,
    },
    '每日轻练生成',
  )
}

export function fallbackMicroPracticeContent(type, context) {
  const sourceSentences = splitSentences(context.sourceContext || context.sourceSummary || '')
  const terms = (context.keyTerms || []).filter(Boolean).slice(0, 6)
  const baseSentences = sourceSentences.length
    ? sourceSentences.slice(0, type === 'listening' ? 5 : 7)
    : [
        `${context.topicLabel} can be studied through small, clear examples.`,
        'A short practice should focus on one idea, not on too many details.',
        'The learner can notice key words, answer simple questions, and return to the main reading later.',
      ]
  const body = takeWords(baseSentences.join(' '), type === 'listening' ? 105 : 145)
  const vocabulary = (terms.length ? terms : extractKeywords(body, 5)).slice(0, 6).map((term) => ({
    term,
    meaningZh: fallbackChineseMeaning(term),
    simpleEnglish: `A useful word for this topic: ${term}.`,
  }))
  const concepts = vocabulary.slice(0, 3).map((item) => ({
    term: item.term,
    simpleEnglish: item.simpleEnglish,
    chinese: item.meaningZh,
  }))
  const answer = takeWords(baseSentences[0] || body, 20)
  return {
    title: type === 'listening' ? 'Short Listening Practice' : 'Short Reading Practice',
    body,
    transcriptHiddenByDefault: type === 'listening',
    sourceSummary: context.sourceSummary || context.topicLabel,
    concepts,
    vocabulary,
    questions: [
      {
        id: nanoid(),
        prompt: 'What is the main focus of this practice?',
        options: [answer, 'A completely unrelated topic.', 'A list of grammar rules only.', 'A plan to stop reading.'],
        answerIndex: 0,
        explanationZh: '正确选项概括了材料里的主要内容。',
        relatedTerms: vocabulary.slice(0, 2).map((item) => item.term),
      },
      {
        id: nanoid(),
        prompt: 'What should the learner notice?',
        options: ['Key words and the main idea.', 'Only the longest sentence.', 'Only the Chinese translation.', 'Facts not in the material.'],
        answerIndex: 0,
        explanationZh: '轻练的目标是抓住主旨和关键词。',
        relatedTerms: vocabulary.slice(2, 4).map((item) => item.term),
      },
    ],
  }
}

export async function buildMicroPractice(db, userId, body = {}) {
  const settings = userSettings(db, userId)
  const type = resolveMicroPracticeType(settings, body)
  const difficulty = resolveMicroDifficulty(settings, body)
  const context = buildMicroPracticeContext(db, userId, settings, body)
  let rawContent = null
  let aiError = ''
  try {
    rawContent = await generateMicroPracticeWithOpenAI(type, difficulty, context)
  } catch (error) {
    aiError = error.message || String(error)
  }
  const content = normalizeMicroPracticeContent(rawContent || fallbackMicroPracticeContent(type, context), type, context)
  if (aiError) {
    content.sourceSummary = `${content.sourceSummary}；AI 生成失败，使用本地兜底。`
  }
  return {
    id: nanoid(),
    userId,
    type,
    typeLabel: microPracticeTypeLabel(type),
    topic: context.topic,
    topicLabel: context.topicLabel,
    difficulty,
    sourceMode: context.sourceMode,
    sourceBookId: context.sourceBookId,
    sourceBookTitle: context.sourceBookTitle,
    sourceSummary: content.sourceSummary,
    keyTerms: context.keyTerms || [],
    content,
    audio: null,
    status: 'ready',
    generatedBy: rawContent ? 'ai' : 'fallback',
    error: aiError,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function publicMicroPractice(practice) {
  if (!practice) return null
  return {
    id: practice.id,
    type: practice.type,
    typeLabel: practice.typeLabel || microPracticeTypeLabel(practice.type),
    topic: practice.topic,
    topicLabel: practice.topicLabel,
    difficulty: practice.difficulty,
    sourceMode: practice.sourceMode,
    sourceBookId: practice.sourceBookId || '',
    sourceBookTitle: practice.sourceBookTitle || '',
    sourceSummary: practice.sourceSummary || practice.content?.sourceSummary || '',
    keyTerms: practice.keyTerms || [],
    content: practice.content,
    audio: practice.audio || null,
    status: practice.status || 'ready',
    generatedBy: practice.generatedBy || 'ai',
    completedAt: practice.completedAt || '',
    createdAt: practice.createdAt,
  }
}

export function publicMicroAttempt(attempt) {
  if (!attempt) return null
  return {
    id: attempt.id,
    practiceId: attempt.practiceId,
    type: attempt.type,
    topicLabel: attempt.topicLabel,
    difficulty: attempt.difficulty,
    correctCount: attempt.correctCount,
    questionCount: attempt.questionCount,
    correctRate: attempt.correctRate,
    studyMinutes: attempt.studyMinutes,
    savedVocabularyCount: attempt.savedVocabularyCount,
    wrongQuestions: attempt.wrongQuestions || [],
    suggestion: attempt.suggestion || '',
    createdAt: attempt.createdAt,
  }
}

export function microPracticeSuggestion(correctRate, type, difficulty) {
  const levels = type === 'listening' ? listeningLevels : readingLevels
  const normalized = normalizeLevel(levels, difficulty, type === 'listening' ? 'A2' : 'A2+')
  const next = shiftLevel(levels, normalized, 1)
  const previous = shiftLevel(levels, normalized, -1)
  if (correctRate >= 0.85) return `${type === 'listening' ? '听力' : '阅读'}正确率不错。下一次可以继续 ${normalized}，如果连续几次都轻松，可以试试 ${next}。`
  if (correctRate < 0.55) return `这次偏难。下一次建议先用 ${previous}，或者选择最近书籍/近期生词这种更熟悉的主题。`
  return `难度基本合适。保持短频快的节奏，比一次学很久更容易坚持。`
}

export function saveMicroVocabularyFromAttempt(db, userId, practice, wrongQuestions, savedTerms = []) {
  const contentVocabulary = practice.content?.vocabulary || []
  const wrongCountByTerm = new Map()
  const normalizeTerm = (term) => normalizeText(term).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
  for (const question of wrongQuestions) {
    const explicit = (question.relatedTerms || []).map(normalizeTerm).filter((term) => /^[A-Za-z][A-Za-z'-]*$/.test(term))
    const questionText = `${question.prompt || ''} ${question.explanationZh || ''}`.toLowerCase()
    const inferred = explicit.length
      ? []
      : contentVocabulary
          .map((item) => normalizeTerm(item.term))
          .filter((term) => term && questionText.includes(term.toLowerCase()))
          .slice(0, 2)
    for (const term of [...new Set([...explicit, ...inferred])]) {
      wrongCountByTerm.set(term.toLowerCase(), (wrongCountByTerm.get(term.toLowerCase()) || 0) + 1)
    }
  }
  const normalizedSavedTerms = savedTerms.map(normalizeTerm).filter((term) => /^[A-Za-z][A-Za-z'-]*$/.test(term))
  const relatedTerms = [...wrongCountByTerm.keys()].map(
    (key) => contentVocabulary.find((item) => normalizeTerm(item.term).toLowerCase() === key)?.term || key
  )
  const termsByKey = new Map()
  for (const term of [...normalizedSavedTerms, ...relatedTerms]) {
    const key = term.toLowerCase()
    if (!termsByKey.has(key)) termsByKey.set(key, term)
  }
  const terms = [...termsByKey.values()].slice(0, 6)
  const now = new Date().toISOString()
  let savedCount = 0
  for (const term of terms) {
    const detail = contentVocabulary.find((item) => item.term.toLowerCase() === term.toLowerCase())
    const existing = db.vocabulary.find((item) => item.userId === userId && item.term.toLowerCase() === term.toLowerCase())
    const wrongQuestionCount = wrongCountByTerm.get(term.toLowerCase()) || 0
    if (existing) {
      existing.seenCount = Number(existing.seenCount || 0) + 1
      existing.lastSeenAt = now
      existing.dueAt = existing.dueAt || now
      existing.wrongQuestionCount = Number(existing.wrongQuestionCount || 0) + wrongQuestionCount
    } else {
      db.vocabulary.push({
        id: nanoid(),
        userId,
        term,
        meaningZh: detail?.meaningZh || fallbackChineseMeaning(term),
        simpleEnglish: detail?.simpleEnglish || 'A useful word from a daily micro practice.',
        exampleSentence: exampleSentenceFromText(practice.content?.body || '', term),
        wrongQuestionCount,
        sourceBookTitle: practice.sourceBookTitle || '每日轻练',
        seenCount: 1,
        mastery: 0,
        createdAt: now,
        lastSeenAt: now,
        dueAt: now,
      })
    }
    savedCount += 1
  }
  return savedCount
}

export function saveUnitVocabularyFromCompletion(db, userId, book, unit, wrongQuestions, viewedWords = []) {
  const contentVocabulary = unit.content?.vocabulary || []
  const normalizeTerm = (term) => normalizeText(term).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').slice(0, 80)
  const isValidTerm = (term) => /^[A-Za-z][A-Za-z' -]*$/.test(term)
  const wrongCountByTerm = new Map()

  for (const question of wrongQuestions) {
    const explicit = (question.relatedTerms || []).map(normalizeTerm).filter(isValidTerm)
    const questionText = `${question.prompt || ''} ${question.explanationZh || ''}`.toLowerCase()
    const inferred = explicit.length
      ? []
      : contentVocabulary
          .map((item) => normalizeTerm(item.term))
          .filter((term) => term && questionText.includes(term.toLowerCase()))
          .slice(0, 2)
    for (const term of new Set([...explicit, ...inferred])) {
      const key = term.toLowerCase()
      wrongCountByTerm.set(key, (wrongCountByTerm.get(key) || 0) + 1)
    }
  }

  const termsByKey = new Map()
  for (const rawTerm of [...viewedWords, ...wrongCountByTerm.keys()]) {
    const normalized = normalizeTerm(rawTerm)
    if (!isValidTerm(normalized)) continue
    const key = normalized.toLowerCase()
    const canonical = contentVocabulary.find((item) => normalizeTerm(item.term).toLowerCase() === key)?.term || normalized
    if (!termsByKey.has(key)) termsByKey.set(key, canonical)
  }

  const now = new Date().toISOString()
  let newVocabularyCount = 0
  const savedTerms = [...termsByKey.values()].slice(0, 30)
  for (const term of savedTerms) {
    const key = normalizeTerm(term).toLowerCase()
    const detail = contentVocabulary.find((item) => normalizeTerm(item.term).toLowerCase() === key)
    const existing = db.vocabulary.find((item) => item.userId === userId && normalizeTerm(item.term).toLowerCase() === key)
    const wrongQuestionCount = wrongCountByTerm.get(key) || 0
    if (existing) {
      existing.seenCount = Number(existing.seenCount || 0) + 1
      existing.lastSeenAt = now
      existing.dueAt = existing.dueAt || now
      existing.mastery = Number(existing.mastery || 0)
      existing.wrongQuestionCount = Number(existing.wrongQuestionCount || 0) + wrongQuestionCount
      existing.exampleSentence = existing.exampleSentence || exampleSentenceForTerm(unit.content, term)
      continue
    }

    db.vocabulary.push({
      id: nanoid(),
      userId,
      term,
      meaningZh: detail?.meaningZh || fallbackChineseMeaning(term),
      simpleEnglish: detail?.simpleEnglish || 'A word saved from your reading.',
      exampleSentence: exampleSentenceForTerm(unit.content, term),
      wrongQuestionCount,
      sourceBookTitle: book.title,
      seenCount: 1,
      mastery: 0,
      createdAt: now,
      lastSeenAt: now,
      dueAt: now,
    })
    newVocabularyCount += 1
  }

  return {
    newVocabularyCount,
    savedVocabularyCount: savedTerms.length,
  }
}
