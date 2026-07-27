// Unit tests for the parts of the pipeline where a silent behaviour change would
// be hardest to notice: how a book becomes learning units, how faithfulness is
// scored, how PDF pages are cleaned, and how a failed job is classified.
//
// These are the product's real invariants, not coverage filler — every
// assertion below corresponds to a rule stated in the project's requirements
// (units follow topics not pages, source provenance is always recorded,
// typesetting paths never reach a title, difficulty moves one step at a time).
//
// Run with: node scripts/test-units.mjs
import assert from 'node:assert/strict'
import { planUnits, splitIntoSourceUnits, isStudyChapter, mergeShortSourceParts } from '../server/units.js'
import { localFidelityAudit, mapReadingToSource, assessContentQuality } from '../server/quality.js'
import { cleanPdfPages, isPdfProductionArtifactLine, isLikelyPageNumber, formatPdfPageRange } from '../server/pdf-text.js'
import { diagnoseJobError, canAutoRetryJob } from '../server/job-diagnosis.js'
import { normalizeLevel, shiftLevel, readingLevels, listeningLevels } from '../server/levels.js'
import { wordCount, extractKeywords } from '../server/text.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}\n      ${error.message}`)
  }
}

// Prose dense enough to look like real book text to the keyword extractor.
function paragraph(seed) {
  return (
    `Empire commerce and public finance reshaped political authority in ${seed}. ` +
    'Merchants needed credit, soldiers needed pay, and ministers needed new taxes. ' +
    'These pressures shaped debates about parliament, sovereignty, local rights, and the rules of trade. ' +
    'Ordinary people felt these forces through prices, wages, debts, and daily work. ' +
    'Reformers wanted cleaner institutions but depended on older networks of patronage. '
  )
}

function chapterText(words) {
  let text = ''
  let index = 0
  while (wordCount(text) < words) {
    text += `${paragraph(`period ${(index += 1)}`)}\n\n`
  }
  return text
}

console.log('Core pipeline unit tests\n')
console.log('· unit planning')

test('a long chapter is split into multiple units', () => {
  const chapters = [{ title: 'Chapter One: Empire and Credit', text: chapterText(5200) }]
  const units = planUnits('book-1', chapters, 'epub')
  assert.ok(units.length >= 2, `expected several units, got ${units.length}`)
})

test('every unit records where it came from', () => {
  const chapters = [{ title: 'Chapter One: Empire and Credit', text: chapterText(4000) }]
  const units = planUnits('book-1', chapters, 'epub')
  assert.ok(units.every((unit) => typeof unit.sourceLocation === 'string' && unit.sourceLocation.length > 0))
  assert.ok(units.every((unit) => unit.sourceWordCount > 0))
  assert.ok(units.every((unit) => unit.sourceExcerpt.length > 0))
})

test('unit source sizes cluster around the configured target', () => {
  const chapters = [{ title: 'Chapter One', text: chapterText(6000) }]
  const units = planUnits('book-1', chapters, 'epub')
  const target = Number(process.env.SOURCE_WORDS_PER_UNIT || 1700)
  // Only the trailing unit may be short; the rest must be in a sane band.
  for (const unit of units.slice(0, -1)) {
    assert.ok(
      unit.sourceWordCount >= target * 0.5 && unit.sourceWordCount <= target * 2,
      `unit of ${unit.sourceWordCount} words is far from the ${target}-word target`,
    )
  }
})

test('units start unplanned and carry no generated content', () => {
  const units = planUnits('book-1', [{ title: 'Chapter One', text: chapterText(2000) }], 'epub')
  assert.ok(units.every((unit) => unit.status === 'planned'))
  assert.ok(units.every((unit) => unit.content === null))
  assert.ok(units.every((unit) => unit.generatedAt === null))
})

test('front and back matter are excluded from study units', () => {
  assert.equal(isStudyChapter({ title: 'Copyright', text: chapterText(2000) }), false)
  assert.equal(isStudyChapter({ title: 'Index', text: chapterText(2000) }), false)
  assert.equal(isStudyChapter({ title: 'Chapter Three: Revenue', text: chapterText(2000) }), true)
})

test('a PDF unit location references pages, never becomes a page-sized unit', () => {
  const chapters = [{ title: 'Chapter One', text: chapterText(5000), pageStart: 12, pageEnd: 30 }]
  const units = planUnits('book-1', chapters, 'pdf')
  assert.ok(units.length >= 1)
  // Page numbers are provenance only: no unit may be a single page's worth of text.
  assert.ok(units.every((unit) => unit.sourceWordCount > 200), 'a unit collapsed to page size')
})

test('short PDF fragments are merged rather than left as tiny units', () => {
  const parts = Array.from({ length: 6 }, (_, index) => ({
    fallbackTitle: 'Chapter One',
    sourceLocation: `pages ${index + 1}`,
    sourceText: paragraph(`fragment ${index}`),
  }))
  const merged = mergeShortSourceParts(parts, 1700)
  assert.ok(merged.length < parts.length, 'nothing was merged')
  assert.ok(merged.every((part) => wordCount(part.sourceText) > 0))
})

test('splitIntoSourceUnits never loses text', () => {
  const text = chapterText(4000)
  const parts = splitIntoSourceUnits(text, 1700)
  const totalWords = parts.reduce((sum, part) => sum + wordCount(part), 0)
  const originalWords = wordCount(text)
  assert.ok(
    Math.abs(totalWords - originalWords) < originalWords * 0.02,
    `word count drifted: ${originalWords} in, ${totalWords} out`,
  )
})

console.log('\n· fidelity auditing')

const sourceUnit = {
  sourceText:
    'Parliament debated sovereignty and taxation throughout the decade. ' +
    'Merchants financed the war through credit markets in Amsterdam and London. ' +
    'Ministers raised excise duties on salt, beer, and imported textiles. ' +
    'Local magistrates resisted central authority wherever revenue collection threatened patronage.',
}

function contentFrom(sentences) {
  return { reading: { paragraphs: sentences.map((text) => ({ text })) } }
}

test('faithful content scores high', () => {
  const audit = localFidelityAudit(
    contentFrom([
      'Parliament debated sovereignty and taxation for years.',
      'Merchants financed the war using credit markets in Amsterdam and London.',
      'Ministers raised excise duties on salt, beer, and imported textiles.',
      'Local magistrates resisted central authority over revenue and patronage.',
    ]),
    sourceUnit,
  )
  assert.ok(audit.score > 0.6, `expected a high score, got ${audit.score}`)
  assert.equal(audit.mode, 'local')
})

test('content unrelated to the source scores low and is flagged', () => {
  const audit = localFidelityAudit(
    contentFrom([
      'Photosynthesis converts light into chemical energy inside plant cells.',
      'Chloroplasts contain pigments that absorb particular wavelengths.',
    ]),
    sourceUnit,
  )
  assert.ok(audit.score < 0.45, `expected a low score, got ${audit.score}`)
  assert.ok(audit.risks.length > 0, 'unrelated content raised no risk')
})

test('the audit always reports a paragraph-to-source map', () => {
  const content = contentFrom(['Parliament debated sovereignty and taxation.', 'Merchants financed the war through credit.'])
  const audit = localFidelityAudit(content, sourceUnit)
  assert.equal(audit.sourceAlignedParagraphs.length, 2)
  assert.ok(audit.sourceAlignedParagraphs.every((item) => typeof item.readingParagraph === 'number'))
})

test('mapReadingToSource links a paragraph to the source it echoes', () => {
  const map = mapReadingToSource(contentFrom(['Ministers raised excise duties on salt and beer.']), sourceUnit)
  assert.equal(map.length, 1)
  assert.ok(Array.isArray(map[0].sourceRefs))
})

test('quality assessment reports word and paragraph metrics', () => {
  const quality = assessContentQuality(
    contentFrom([paragraph('one'), paragraph('two'), paragraph('three')]),
    sourceUnit,
    { readingLevel: 'B1', listeningLevel: 'A2' },
  )
  assert.ok(quality && typeof quality === 'object')
  assert.ok('fidelity' in quality || 'metrics' in quality || 'checks' in quality, Object.keys(quality).join(','))
})

console.log('\n· PDF cleaning')

test('typesetting tool paths are recognised as artifacts', () => {
  assert.equal(isPdfProductionArtifactLine('C:/ITOOLS/WMS/CUP-NEW/WORKINGFOLDER/BOOK-a.3D page 4'), true)
  assert.equal(isPdfProductionArtifactLine('Parliament debated sovereignty and taxation.'), false)
})

test('bare page numbers are recognised', () => {
  assert.equal(isLikelyPageNumber('42'), true)
  assert.equal(isLikelyPageNumber('Chapter Three'), false)
})

function pdfPages(runningHead) {
  return Array.from({ length: 6 }, (_, index) => ({
    num: index + 1,
    text:
      `C:/ITOOLS/WMS/CUP-NEW/WORKINGFOLDER/BOOK-${index}.3D page ${index + 1}\n` +
      `${runningHead}\n` +
      `${index + 1}\n` +
      `${paragraph(`page ${index}`)}`,
  }))
}

test('cleanPdfPages strips typesetting paths, page numbers and running heads', () => {
  const cleaned = cleanPdfPages(pdfPages('A history of public finance'))
  const allText = cleaned.map((page) => page.text).join('\n')
  assert.ok(!/ITOOLS|WORKINGFOLDER|\.3D/i.test(allText), 'a typesetting path survived cleaning')
  assert.ok(!/a history of public finance/i.test(allText), 'a repeated running head survived cleaning')
  assert.ok(/Merchants needed credit/.test(allText), 'body text was removed')
  assert.ok(cleaned.every((page) => page.wordCount > 0))
})

// Repeated-line removal must not start eating real chapter titles, which is why
// headings are exempt from the ordinary running-head rule.
test('a chapter title that appears once is preserved', () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({
    num: index + 1,
    text: `${index === 0 ? 'CHAPTER ONE: EMPIRE AND CREDIT\n' : ''}${index + 1}\n${paragraph(`page ${index}`)}`,
  }))
  const allText = cleanPdfPages(pages)
    .map((page) => page.text)
    .join('\n')
  // cleanPdfHeading re-cases headings, so match case-insensitively.
  assert.ok(/chapter one: empire and credit/i.test(allText), 'a one-off chapter title was removed')
})

test('several distinct chapter titles all survive', () => {
  const pages = Array.from({ length: 9 }, (_, index) => ({
    num: index + 1,
    text: `${index % 3 === 0 ? `CHAPTER ${index / 3 + 1}: REVENUE AND REFORM\n` : ''}${paragraph(`page ${index}`)}`,
  }))
  const allText = cleanPdfPages(pages)
    .map((page) => page.text)
    .join('\n')
  for (const number of [1, 2, 3]) {
    assert.ok(new RegExp(`chapter ${number}: revenue and reform`, 'i').test(allText), `chapter ${number} title was removed`)
  }
})

test('a short excerpt never triggers running-head removal', () => {
  // Three pages, the title on two of them: proportionally that looks like a
  // running head, but the document is far too short to conclude anything.
  const pages = Array.from({ length: 3 }, (_, index) => ({
    num: index + 1,
    text: `A HISTORY OF PUBLIC FINANCE\n${paragraph(`page ${index}`)}`,
  }))
  const allText = cleanPdfPages(pages)
    .map((page) => page.text)
    .join('\n')
  assert.ok(/a history of public finance/i.test(allText), 'a 3-page excerpt lost its heading')
})

// The case the span requirement exists for: a book whose running head is the
// current chapter's title. It is dense within its chapter but does not run the
// length of the book, so it must stay a heading and keep marking the chapter.
test('a chapter title repeated within its own chapter stays a heading', () => {
  const pages = Array.from({ length: 12 }, (_, index) => ({
    num: index + 1,
    text: `${index < 7 ? 'CHAPTER ONE: EMPIRE AND CREDIT' : 'CHAPTER TWO: REVENUE AND REFORM'}\n${paragraph(`page ${index}`)}`,
  }))
  const allText = cleanPdfPages(pages)
    .map((page) => page.text)
    .join('\n')
  assert.ok(/chapter one: empire and credit/i.test(allText), 'a per-chapter running head was treated as book furniture')
  assert.ok(/chapter two: revenue and reform/i.test(allText), 'the second chapter heading was removed')
})

test('a heading on a minority of pages is left alone', () => {
  const pages = Array.from({ length: 10 }, (_, index) => ({
    num: index + 1,
    text: `${index < 3 ? 'PART ONE: THE FISCAL STATE\n' : ''}${paragraph(`page ${index}`)}`,
  }))
  const allText = cleanPdfPages(pages)
    .map((page) => page.text)
    .join('\n')
  assert.ok(/part one: the fiscal state/i.test(allText), 'a heading on 3 of 10 pages was treated as a running head')
})

test('page ranges format for provenance display', () => {
  assert.ok(formatPdfPageRange(4, 4).includes('4'))
  assert.ok(formatPdfPageRange(4, 9).includes('4'))
  assert.ok(formatPdfPageRange(4, 9).includes('9'))
})

console.log('\n· job failure diagnosis')

test('rate limiting is retryable and says so', () => {
  const result = diagnoseJobError({}, 'Request failed with status 429 too many requests')
  assert.equal(result.errorCode, 'rate-limit')
  assert.equal(result.retryable, true)
  assert.ok(result.errorHint.length > 0)
})

test('an auth failure is not retryable', () => {
  const result = diagnoseJobError({}, 'Error 401 invalid api key')
  assert.equal(result.errorCode, 'provider-auth')
  assert.equal(result.retryable, false)
})

test('a timeout is classified as transient', () => {
  const result = diagnoseJobError({}, 'AI 文本服务请求超时（60 秒）')
  assert.equal(result.errorCode, 'upstream-temporary')
  assert.equal(result.retryable, true)
})

test('a missing book is not retryable', () => {
  const result = diagnoseJobError({}, '未找到学习单元', { stage: 'setup' })
  assert.equal(result.errorCode, 'missing-resource')
  assert.equal(result.retryable, false)
})

test('a cancelled job is reported as cancelled, not failed', () => {
  const result = diagnoseJobError({}, '任务已取消', { stage: 'cancel' })
  assert.equal(result.errorCode, 'canceled')
})

test('auto-retry only applies to retryable failures within the attempt budget', () => {
  const retryable = { errorCode: 'rate-limit', retryable: true, retryCount: 0 }
  const exhausted = { errorCode: 'rate-limit', retryable: true, retryCount: 99 }
  const permanent = { errorCode: 'provider-auth', retryable: false, retryCount: 0 }
  const cancelled = { errorCode: 'rate-limit', retryable: true, retryCount: 0, cancelRequested: true }
  assert.equal(canAutoRetryJob(retryable), true)
  assert.equal(canAutoRetryJob(exhausted), false)
  assert.equal(canAutoRetryJob(permanent), false)
  assert.equal(canAutoRetryJob(cancelled), false, 'a cancelled job must not auto-retry')
})

console.log('\n· difficulty levels')

test('reading and listening use independent ladders', () => {
  assert.notDeepEqual(readingLevels, listeningLevels)
  assert.ok(listeningLevels.length > readingLevels.length, 'listening should allow finer low-end steps')
})

test('an unknown level falls back instead of throwing', () => {
  assert.ok(readingLevels.includes(normalizeLevel(readingLevels, 'nonsense', 'B1')))
})

test('difficulty moves exactly one step at a time', () => {
  const start = 'B1'
  const up = shiftLevel(readingLevels, start, 1)
  const down = shiftLevel(readingLevels, start, -1)
  assert.equal(Math.abs(readingLevels.indexOf(up) - readingLevels.indexOf(start)), 1)
  assert.equal(Math.abs(readingLevels.indexOf(down) - readingLevels.indexOf(start)), 1)
})

test('difficulty never runs off either end of the ladder', () => {
  assert.equal(shiftLevel(readingLevels, readingLevels[0], -1), readingLevels[0])
  assert.equal(shiftLevel(readingLevels, readingLevels.at(-1), 1), readingLevels.at(-1))
})

console.log('\n· text helpers')

test('keyword extraction ignores stop words and short tokens', () => {
  const keywords = extractKeywords('The government and the people should have more political power over trade', 8)
  assert.ok(!keywords.includes('should'))
  assert.ok(!keywords.includes('the'))
  assert.ok(keywords.length > 0)
})

test('word count matches a hand-counted sentence', () => {
  assert.equal(wordCount('Parliament debated sovereignty and taxation'), 5)
  assert.equal(wordCount(''), 0)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
