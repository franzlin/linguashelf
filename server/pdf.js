// PDF parsing.
//
// Page numbers are used only for source provenance — units are never split by
// page. Sections follow chapter headings and continuous body text, and short
// fragments get merged, which is what keeps a 400-page book from turning into
// hundreds of unusable one-page units.
import { PDFParse } from 'pdf-parse'
import { nanoid } from 'nanoid'
import { maxActiveUploadParses, pdfSectionTargetWords } from './config.js'
import { cleanTitle, normalizeText, wordCount } from './text.js'
import {
  cleanPdfHeading,
  cleanPdfPages,
  formatPdfPageRange,
  isPdfChapterHeading,
  pdfLinesToText,
  pdfSectionTitle,
} from './pdf-text.js'
import { inferPdfPageCount, ocrPdfFallback, withOcrSlot } from './ocr.js'

export const uploadParseWaiters = []

export let activeUploadParses = 0

export function splitPdfPageIntoSections(page) {
  const sections = []
  let currentTitle = ''
  let currentLines = []

  function flush() {
    const text = pdfLinesToText(currentLines)
    if (wordCount(text) || currentTitle) {
      sections.push({
        title: currentTitle,
        text,
        page: page.page,
      })
    }
    currentTitle = ''
    currentLines = []
  }

  for (const line of page.lines) {
    if (isPdfChapterHeading(line)) {
      flush()
      currentTitle = cleanPdfHeading(line, '')
      continue
    }
    currentLines.push(line)
  }
  flush()
  if (!sections.length) sections.push({ title: '', text: page.text, page: page.page })
  return sections
}

export async function parsePdf(buffer, filename, options = {}) {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const pages = cleanPdfPages(result.pages || [])
    const usable = pages.filter((page) => page.wordCount >= 60)
    let sourcePages = usable
    let ocr = null
    if (!sourcePages.length) {
      if (options.deferOcr) {
        return {
          title: filename.replace(/\.[^.]+$/, ''),
          author: '',
          type: 'pdf',
          chapters: [],
          needsOcr: true,
          pageCount: inferPdfPageCount(result),
        }
      }
      const ocrResult = await withOcrSlot(() => ocrPdfFallback(buffer, inferPdfPageCount(result)))
      sourcePages = ocrResult.pages
      ocr = {
        provider: ocrResult.provider,
        pages: sourcePages.length,
        pagesAttempted: ocrResult.pagesAttempted,
      }
    }

    const chapters = groupPdfPages(sourcePages)
    if (!chapters.length) {
      throw new Error('PDF 已解析，但可用于生成学习单元的英文正文太少')
    }
    return {
      title: filename.replace(/\.[^.]+$/, ''),
      author: '',
      type: 'pdf',
      chapters,
      ocr,
    }
  } finally {
    await parser.destroy()
  }
}

export async function withUploadParseSlot(task) {
  if (activeUploadParses >= maxActiveUploadParses) {
    await new Promise((resolve) => uploadParseWaiters.push(resolve))
  } else {
    activeUploadParses += 1
  }
  try {
    return await task()
  } finally {
    const next = uploadParseWaiters.shift()
    if (next) next()
    else activeUploadParses = Math.max(0, activeUploadParses - 1)
  }
}

export function groupPdfPages(pages) {
  const chapters = []
  let current = null
  let sequence = 0

  function startChapter(title, text, page) {
    sequence += 1
    const cleanHeading = cleanTitle(title, '')
    current = {
      id: nanoid(),
      title: cleanHeading || pdfSectionTitle(sequence),
      text,
      label: cleanHeading || pdfSectionTitle(sequence),
      startPage: page.page,
      endPage: page.page,
      pageLabel: formatPdfPageRange(page.page, page.page),
      sequence,
      wordCount: wordCount(text),
    }
    chapters.push(current)
  }

  function appendToCurrent(text, page) {
    current.text = normalizeText(`${current.text}\n\n${text}`)
    current.endPage = page.page
    current.pageLabel = formatPdfPageRange(current.startPage, current.endPage)
    current.wordCount = wordCount(current.text)
  }

  for (const page of pages) {
    for (const section of splitPdfPageIntoSections(page)) {
      const text = normalizeText(section.text)
      if (wordCount(text) < 40 && !section.title) continue
      const hasHeading = Boolean(section.title)
      const currentIsFull = current && wordCount(current.text) >= pdfSectionTargetWords
      if (!current || hasHeading || currentIsFull) {
        startChapter(section.title, text, page)
      } else {
        appendToCurrent(text, page)
      }
    }
  }

  return chapters
    .filter((chapter) => wordCount(chapter.text) >= 120)
    .map((chapter) => ({
      ...chapter,
      title: cleanTitle(chapter.title, pdfSectionTitle(chapter.sequence)),
      label: cleanTitle(chapter.label, pdfSectionTitle(chapter.sequence)),
      pageLabel: formatPdfPageRange(chapter.startPage, chapter.endPage),
      wordCount: wordCount(chapter.text),
    }))
}
