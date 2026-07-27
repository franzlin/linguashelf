// Learning-unit planning: turning parsed book sections into ~10-minute units,
// and safely replanning a book whose units are all still empty.
//
// Units follow topic and chapter boundaries, never page boundaries. Short
// sections get merged toward the configured source-word target so a chapter
// break cannot produce a two-paragraph unit.
import fs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { sourceWordsMergeMin, sourceWordsPerUnit } from './config.js'
import { cleanTitle, extractKeywords, normalizeText, takeWords, titleCase, wordCount } from './text.js'
import { formatPdfPageRange, isGenericPdfSectionTitle, pdfSectionTitle } from './pdf-text.js'
import { looksLikeTableOfContents, parseEpub } from './epub.js'
import { parsePdf } from './pdf.js'

export const bookReplanLocks = new Set()

export function pdfUnitSourceLocation(chapter, partCount, partIndex) {
  const title = cleanTitle(chapter.title, chapter.label || '')
  const pageLabel = chapter.pageLabel || formatPdfPageRange(chapter.startPage, chapter.endPage)
  const main = title && !isGenericPdfSectionTitle(title) ? title : chapter.label || title || pdfSectionTitle(chapter.sequence || 1)
  const location = [main, pageLabel].filter(Boolean).join(' · ')
  return partCount > 1 ? `${location}，第 ${partIndex + 1} 部分` : location
}

export function unitTitleFallback(chapter, sourceType) {
  if (sourceType === 'pdf' && isGenericPdfSectionTitle(chapter.title)) return 'Reading Unit'
  return chapter.title
}

export function combineSourceLocations(parts) {
  const locations = parts.map((part) => part.sourceLocation).filter(Boolean)
  if (!locations.length) return ''
  if (locations.length === 1 || locations[0] === locations[locations.length - 1]) return locations[0]
  return `${locations[0]} → ${locations[locations.length - 1]}`
}

export function mergeShortSourceParts(parts, targetWords = sourceWordsPerUnit) {
  const merged = []
  const maxWords = Math.round(targetWords * 1.18)
  let current = null

  function pushCurrent() {
    if (!current) return
    current.sourceLocation = combineSourceLocations(current.parts)
    merged.push(current)
    current = null
  }

  for (const part of parts) {
    const partWords = wordCount(part.sourceText)
    if (!current) {
      current = { ...part, parts: [part] }
      continue
    }
    const currentWords = wordCount(current.sourceText)
    if (currentWords < sourceWordsMergeMin && currentWords + partWords <= maxWords) {
      current.sourceText = normalizeText(`${current.sourceText}\n\n${part.sourceText}`)
      current.parts.push(part)
      current.sourceLocation = combineSourceLocations(current.parts)
    } else {
      pushCurrent()
      current = { ...part, parts: [part] }
    }
  }
  pushCurrent()

  if (merged.length >= 2) {
    const last = merged[merged.length - 1]
    const previous = merged[merged.length - 2]
    const lastWords = wordCount(last.sourceText)
    const previousWords = wordCount(previous.sourceText)
    if (lastWords < sourceWordsMergeMin && previousWords + lastWords <= maxWords) {
      previous.sourceText = normalizeText(`${previous.sourceText}\n\n${last.sourceText}`)
      previous.parts.push(...last.parts)
      previous.sourceLocation = combineSourceLocations(previous.parts)
      merged.pop()
    }
  }

  return merged.map(({ parts, ...part }) => part)
}

export function planUnits(bookId, chapters, sourceType) {
  const rawParts = []
  const studyChapters = chapters.filter(isStudyChapter)
  const maxUnits = Number(process.env.MAX_UNITS_PER_BOOK || 240)

  for (const chapter of studyChapters) {
    const parts = splitIntoSourceUnits(chapter.text, sourceWordsPerUnit)
    parts.forEach((sourceText, index) => {
      const location =
        sourceType === 'pdf'
          ? pdfUnitSourceLocation(chapter, parts.length, index)
          : `${chapter.title}${parts.length > 1 ? `, section ${index + 1}` : ''}`

      rawParts.push({
        fallbackTitle: unitTitleFallback(chapter, sourceType),
        sourceLocation: location,
        sourceText,
      })
    })
  }

  const plannedParts = sourceType === 'pdf' ? mergeShortSourceParts(rawParts, sourceWordsPerUnit) : rawParts
  const units = plannedParts.map((part, index) => {
    const sourceText = part.sourceText
    const title = inferEnglishTitle(sourceText, part.fallbackTitle, index)
    return {
      id: nanoid(),
      bookId,
      title,
      status: 'planned',
      sourceLocation: part.sourceLocation,
      sourceText,
      sourceExcerpt: takeWords(sourceText, 180),
      sourceWordCount: wordCount(sourceText),
      createdAt: new Date().toISOString(),
      generatedAt: null,
      content: null,
    }
  })
  return units.slice(0, maxUnits)
}

export function sourceUnitStats(units) {
  const counts = units.map((unit) => Number(unit.sourceWordCount || wordCount(unit.sourceText || ''))).sort((a, b) => a - b)
  const sum = counts.reduce((total, count) => total + count, 0)
  return {
    unitCount: counts.length,
    min: counts[0] || 0,
    median: counts[Math.floor(counts.length / 2)] || 0,
    average: counts.length ? Math.round(sum / counts.length) : 0,
    max: counts[counts.length - 1] || 0,
    belowMergeMinimum: counts.filter((count) => count < sourceWordsMergeMin).length,
    sourceWordsPerUnit,
    sourceWordsMergeMin,
  }
}

export function bookReplanSafety(db, book) {
  const existingUnits = db.units.filter((unit) => unit.bookId === book.id)
  const unitIds = new Set(existingUnits.map((unit) => unit.id))
  const generatedUnitCount = existingUnits.filter((unit) => unit.content || unit.status !== 'planned').length
  const progressCount = db.progress.filter((item) => unitIds.has(item.unitId)).length
  const reportCount = db.reports.filter((item) => item.bookId === book.id || unitIds.has(item.unitId)).length
  const podcastCount = db.podcasts.filter((item) => item.bookId === book.id).length
  const activeJobCount = db.jobs.filter(
    (job) => (job.bookId === book.id || unitIds.has(job.unitId)) && ['queued', 'running', 'paused'].includes(job.status)
  ).length
  const historicalJobCount = db.jobs.filter((job) => job.bookId === book.id || unitIds.has(job.unitId)).length
  const blockers = []
  if (!book.sourcePath) blockers.push('这本书没有保留原始文件')
  if (book.status && book.status !== 'ready') blockers.push('书籍仍在处理或解析失败')
  if (generatedUnitCount) blockers.push(`已有 ${generatedUnitCount} 个生成或完成单元`)
  if (progressCount) blockers.push(`已有 ${progressCount} 条学习进度`)
  if (reportCount) blockers.push(`已有 ${reportCount} 份学习报告`)
  if (podcastCount) blockers.push(`已有 ${podcastCount} 个播客`)
  if (activeJobCount) blockers.push(`已有 ${activeJobCount} 个活动任务`)
  return {
    allowed: blockers.length === 0,
    blockers,
    existingUnits,
    historicalJobCount,
  }
}

export function replanBlockedError(blockers) {
  const error = new Error(`暂不能重建学习单元：${blockers.join('；')}`)
  error.status = 409
  return error
}

export async function prepareBookUnitReplan(db, book) {
  const safety = bookReplanSafety(db, book)
  if (book.sourcePath) {
    try {
      const stat = await fs.stat(book.sourcePath)
      if (!stat.isFile()) safety.blockers.push('保留的原始文件不可用')
    } catch {
      safety.blockers.push('保留的原始文件已丢失')
    }
  }
  safety.allowed = safety.blockers.length === 0
  const previous = sourceUnitStats(safety.existingUnits)
  if (!safety.allowed) {
    return {
      allowed: false,
      blockers: safety.blockers,
      previous,
      proposed: null,
      historicalJobCount: safety.historicalJobCount,
    }
  }

  const buffer = await fs.readFile(book.sourcePath)
  const parsed = book.type === 'epub' ? await parseEpub(buffer, book.filename) : await parsePdf(buffer, book.filename)
  const units = planUnits(book.id, parsed.chapters, parsed.type)
  return {
    allowed: true,
    blockers: [],
    previous,
    proposed: sourceUnitStats(units),
    historicalJobCount: safety.historicalJobCount,
    parsed,
    units,
  }
}

export function applyBookUnitReplan(db, book, prepared) {
  const existingUnits = db.units.filter((unit) => unit.bookId === book.id)
  const unitIds = new Set(existingUnits.map((unit) => unit.id))
  db.units = db.units.filter((unit) => unit.bookId !== book.id)
  db.units.push(...prepared.units)
  db.jobs = db.jobs.filter((job) => job.bookId !== book.id && !unitIds.has(job.unitId))
  book.chapterCount = prepared.parsed.chapters.length
  book.wordCount = prepared.parsed.chapters.reduce((total, chapter) => total + Number(chapter.wordCount || wordCount(chapter.text)), 0)
  book.status = 'ready'
  book.updatedAt = new Date().toISOString()
  return {
    book,
    units: prepared.units,
    previousUnitCount: existingUnits.length,
    preview: {
      allowed: true,
      blockers: [],
      previous: sourceUnitStats(existingUnits),
      proposed: sourceUnitStats(prepared.units),
      historicalJobCount: prepared.historicalJobCount,
    },
  }
}

export async function withBookReplanLock(bookId, task) {
  if (bookReplanLocks.has(bookId)) {
    const error = new Error('这本书正在重新规划学习单元')
    error.status = 409
    throw error
  }
  bookReplanLocks.add(bookId)
  try {
    return await task()
  } finally {
    bookReplanLocks.delete(bookId)
  }
}

export function isStudyChapter(chapter) {
  const title = String(chapter.title || '').toLowerCase()
  const label = String(chapter.label || '').toLowerCase()
  const text = String(chapter.text || '').trim()
  const frontOrBackMatter = [
    'review',
    'praise',
    'copyright',
    'title page',
    'contents',
    'table of contents',
    'dedication',
    'acknowledgements',
    'acknowledgments',
    'dramatis personae',
    'illustrations',
    'notes',
    'footnotes',
    'endnotes',
    'references',
    'bibliography',
    'glossary',
    'index',
    'about the author',
  ]

  if (wordCount(text) < 120) return false
  if (looksLikeTableOfContents(text)) return false
  return !frontOrBackMatter.some((term) => title.includes(term) || label.includes(term))
}

export function splitIntoSourceUnits(text, targetWords) {
  const paragraphs = normalizeText(text).split(/\n{2,}/).filter((item) => wordCount(item) > 20)
  const chunks = []
  let current = ''

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (wordCount(next) > targetWords && wordCount(current) > 500) {
      chunks.push(current)
      current = paragraph
    } else {
      current = next
    }
  }
  if (wordCount(current) > 120) chunks.push(current)

  if (!chunks.length && wordCount(text) > 120) return [takeWords(text, targetWords)]
  return chunks
}

export function inferEnglishTitle(text, fallback, index) {
  const keywords = extractKeywords(text, 4)
  if (keywords.length >= 2) {
    return `${titleCase(keywords[0])} and ${titleCase(keywords[1])}`
  }
  return index === 0 ? fallback || 'Reading Unit' : `${fallback || 'Reading Unit'} ${index + 1}`
}
