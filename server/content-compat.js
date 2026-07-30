// Older generated lessons used flat listeningText/readingText fields and
// open-ended comprehension questions. Normalize them at the server boundary so
// existing study data remains usable without rewriting the stored record.

export function normalizeUnitContent(content, unit = {}) {
  if (!content || typeof content !== 'object') return null

  const readingLevel = typeof content.level === 'string' ? content.level : content.level?.reading
  const listeningLevel = typeof content.level === 'object' ? content.level?.listening : ''
  const legacyReading = content.readingText?.paragraphs || content.readingText
  const rawParagraphs = Array.isArray(content.reading?.paragraphs)
    ? content.reading.paragraphs
    : Array.isArray(legacyReading)
      ? legacyReading
      : typeof legacyReading === 'string'
        ? legacyReading.split(/\n\s*\n/)
        : []
  const rawQuestions = Array.isArray(content.questions) && content.questions.length
    ? content.questions
    : Array.isArray(content.comprehensionQuestions)
      ? content.comprehensionQuestions
      : []

  return {
    ...content,
    title: compatText(content.title || content.lessonTitle || unit.title || '学习单元'),
    level: {
      reading: compatText(readingLevel || unit.readingLevel || 'A2'),
      listening: compatText(listeningLevel || unit.listeningLevel || 'A1'),
    },
    sourceLocation: compatText(content.sourceLocation || unit.sourceLocation || ''),
    background: compatText(content.background || ''),
    concepts: arrayValue(content.concepts).map((concept) => ({
      term: compatText(concept?.term),
      simpleEnglish: compatText(concept?.simpleEnglish || concept?.explanation),
      chinese: compatText(concept?.chinese || concept?.meaningZh),
    })).filter((concept) => concept.term),
    listening: {
      text: compatText(content.listening?.text || content.listeningText),
      transcriptHiddenByDefault: content.listening?.transcriptHiddenByDefault !== false,
    },
    reading: {
      paragraphs: rawParagraphs.map((paragraph, index) => ({
        text: compatText(typeof paragraph === 'string' ? paragraph : paragraph?.text),
        summaryZh: compatText(typeof paragraph === 'object' ? paragraph?.summaryZh : '') || `第 ${index + 1} 段来自旧版学习内容。`,
      })).filter((paragraph) => paragraph.text),
    },
    vocabulary: arrayValue(content.vocabulary).map((item) => ({
      ...item,
      term: compatText(item?.term || item?.word),
      meaningZh: compatText(item?.meaningZh || item?.chinese),
      simpleEnglish: compatText(item?.simpleEnglish || item?.definition),
      exampleSentence: compatText(item?.exampleSentence),
    })).filter((item) => item.term),
    questions: rawQuestions.map((question, index) => normalizeQuestion(question, unit.id, index)).filter((question) => question.prompt),
    generationMode: compatText(content.generationMode || 'legacy-ai'),
    fidelityNote: compatText(content.fidelityNote || '此单元由旧版内容格式兼容显示，正文与参考答案均保留原生成内容。'),
  }
}

export function normalizeQuestion(question, unitId = 'unit', index = 0) {
  const options = arrayValue(question?.options).map(compatText).filter(Boolean)
  const answerIndex = options.length
    ? Math.max(0, Math.min(options.length - 1, Number(question?.answerIndex || 0)))
    : 0
  return {
    ...question,
    id: compatText(question?.id || `legacy-${unitId}-question-${index + 1}`),
    prompt: compatText(question?.prompt || question?.question),
    options,
    answerIndex,
    explanationZh: compatText(question?.explanationZh || question?.answer),
    relatedTerms: arrayValue(question?.relatedTerms).map(compatText).filter(Boolean),
  }
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function compatText(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}
