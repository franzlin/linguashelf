// Pure PDF line and page cleaning.
//
// Shared by the PDF parser and the OCR fallback, which is why it lives below
// both rather than inside either: OCR needs cleanPdfPages, and the parser needs
// OCR, so keeping these helpers here is what stops the two from forming a cycle.
import { nanoid } from 'nanoid'
import { cleanTitle, normalizeText, wordCount } from './text.js'

export function normalizePdfLine(line) {
  return String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function pdfLineFingerprint(line) {
  return normalizePdfLine(line)
    .replace(/^\d+\s+|\s+\d+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function isLikelyPageNumber(line) {
  const value = normalizePdfLine(line)
  return /^\d{1,4}$/.test(value) || /^[ivxlcdm]{1,8}$/i.test(value) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(value)
}

export function isPdfProductionArtifactLine(line) {
  const value = normalizePdfLine(line)
  if (!value) return false
  if (/(?:^|\s)[A-Za-z]:[\\/][^\s]+/i.test(value)) return true
  if (/\b(?:workingfolder|itools|typeset|proofs?|prepress)\b/i.test(value) && /[\\/]|\.3d\b/i.test(value)) return true
  return false
}

export function isPdfChapterHeading(line) {
  const value = normalizePdfLine(line)
  if (isPdfProductionArtifactLine(value)) return false
  if (!value || value.length > 120 || wordCount(value) > 14) return false
  if (/^(chapter|part|book)\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(value)) return true
  if (/^\d{1,2}\s*[\.:–—-]\s+[A-Z][A-Za-z]/.test(value)) return true
  if (/^(introduction|prologue|epilogue|conclusion|afterword|preface|acknowledg(e)?ments|notes|bibliography|index)\b/i.test(value)) return true
  const letters = value.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 8 && letters === letters.toUpperCase() && wordCount(value) >= 2 && !/[.!?]$/.test(value)) return true
  return false
}

export function cleanPdfHeading(line, fallback) {
  return cleanTitle(
    normalizePdfLine(line)
      .replace(/\s{2,}/g, ' ')
      .replace(/^chapter\s+/i, 'Chapter '),
    fallback
  )
}

export function formatPdfPageRange(startPage, endPage = startPage) {
  const start = Number(startPage || 0)
  const end = Number(endPage || start)
  if (!start) return ''
  return start === end ? `原文页码 ${start}` : `原文页码 ${start}-${end}`
}

export function pdfSectionTitle(index) {
  return `PDF 区块 ${index}`
}

export function isGenericPdfSectionTitle(title) {
  return /^PDF 区块 \d+$/i.test(String(title || '').trim())
}

/**
 * Finds lines that repeat across pages and are therefore page furniture rather
 * than body text.
 *
 * Heading-shaped lines are counted separately. A real chapter title appears on
 * one page; a line that *looks* like a heading but is printed on most pages is a
 * running head (a book title in small caps, for example). Without this
 * distinction an ALL-CAPS running head matches the "looks like a chapter
 * heading" rule, escapes removal, and ends up inside every unit's source text.
 *
 * Running heads need a clearly higher bar than ordinary repeated lines, plus a
 * minimum document length, so that a short excerpt whose single chapter title
 * happens to span two of three pages is never mistaken for one.
 */
export function collectRepeatedPdfLines(pages) {
  const bodyCounts = new Map()
  const headingSpans = new Map()

  pages.forEach((page, pageIndex) => {
    const seenBody = new Set()
    const seenHeadings = new Set()
    for (const line of page.lines) {
      if (isLikelyPageNumber(line) || isPdfProductionArtifactLine(line)) continue
      const fingerprint = pdfLineFingerprint(line)
      if (!fingerprint || fingerprint.length < 4 || fingerprint.length > 90) continue
      if (wordCount(fingerprint) > 12) continue
      if (isPdfChapterHeading(line)) seenHeadings.add(fingerprint)
      else seenBody.add(fingerprint)
    }
    for (const fingerprint of seenBody) bodyCounts.set(fingerprint, (bodyCounts.get(fingerprint) || 0) + 1)
    for (const fingerprint of seenHeadings) {
      const span = headingSpans.get(fingerprint) || { count: 0, first: pageIndex, last: pageIndex }
      span.count += 1
      span.last = pageIndex
      headingSpans.set(fingerprint, span)
    }
  })

  const bodyThreshold = Math.max(3, Math.ceil(pages.length * 0.25))
  const repeated = new Set(
    [...bodyCounts.entries()].filter(([, count]) => count >= bodyThreshold).map(([fingerprint]) => fingerprint),
  )

  // A running head is defined by two things at once: it is printed on most pages,
  // and it runs from near the start of the document to near the end. Requiring
  // both is what separates a book title from a chapter title that happens to be
  // repeated as a running head within its own chapter — the latter is dense but
  // confined to one stretch of pages, so it stays a heading.
  const frequencyThreshold = Math.max(4, Math.ceil(pages.length * 0.6))
  const spanThreshold = Math.ceil(pages.length * 0.8)
  const runningHeads =
    pages.length >= 5
      ? new Set(
          [...headingSpans.entries()]
            .filter(([, span]) => span.count >= frequencyThreshold && span.last - span.first + 1 >= spanThreshold)
            .map(([fingerprint]) => fingerprint),
        )
      : new Set()

  return { repeated, runningHeads }
}

export function cleanPdfPages(resultPages) {
  const pages = resultPages.map((page) => ({
    id: nanoid(),
    page: page.num,
    lines: String(page.text || '')
      .replace(/\r/g, '\n')
      .split(/\n+/)
      .map(normalizePdfLine)
      .filter(Boolean),
  }))
  const { repeated, runningHeads } = collectRepeatedPdfLines(pages)

  return pages.map((page) => {
    const lines = page.lines.filter((line) => {
      if (isLikelyPageNumber(line) || isPdfProductionArtifactLine(line)) return false
      const fingerprint = pdfLineFingerprint(line)
      // Chapter headings are preserved, unless the same "heading" is printed on
      // most pages — then it is a running head and belongs to the furniture.
      if (runningHeads.has(fingerprint)) return false
      if (repeated.has(fingerprint) && !isPdfChapterHeading(line)) return false
      return true
    })
    const text = pdfLinesToText(lines)
    return {
      ...page,
      lines,
      title: '',
      text,
      label: formatPdfPageRange(page.page, page.page),
      wordCount: wordCount(text),
    }
  })
}

export function pdfLinesToText(lines) {
  const paragraphs = []
  let current = ''

  function flush() {
    const clean = normalizeText(current)
    if (clean) paragraphs.push(clean)
    current = ''
  }

  for (const line of lines) {
    if (isPdfChapterHeading(line)) {
      flush()
      paragraphs.push(cleanPdfHeading(line, line))
      continue
    }
    current = current ? `${current} ${line}` : line
    if (/[.!?]["')\]]?$/.test(line) && wordCount(current) >= 28) flush()
  }
  flush()

  return normalizeText(paragraphs.join('\n\n'))
}
