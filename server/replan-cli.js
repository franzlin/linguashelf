// `node server/index.js --replan-book` — rebuild one book's units offline.
//
// Refuses to run unless the book is safe to replan (no generated content,
// progress, reports, podcasts or active jobs), and supports --preview so the
// old and new unit counts can be compared before anything is written.
import { closeStore, ensureStore, readDb, writeDb } from './storage.js'
import { applyBookUnitReplan, prepareBookUnitReplan, replanBlockedError } from './units.js'

export function cliArgValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return String(process.argv[index + 1] || '')
}

export async function runReplanBookCli() {
  await ensureStore()
  const db = await readDb()
  const bookId = cliArgValue('--book-id')
  const title = cliArgValue('--book-title')
  const previewOnly = process.argv.includes('--preview')
  const book = db.books.find((item) => (bookId && item.id === bookId) || (title && String(item.title || item.filename || '').includes(title)))
  if (!book) throw new Error('未找到要重建单元的书籍，请提供 --book-id 或 --book-title')
  const prepared = await prepareBookUnitReplan(db, book)
  if (!prepared.allowed) throw replanBlockedError(prepared.blockers)
  const result = previewOnly
    ? { units: prepared.units, previousUnitCount: prepared.previous.unitCount, preview: prepared }
    : applyBookUnitReplan(db, book, prepared)
  if (!previewOnly) await writeDb(db)
  console.log(
    JSON.stringify(
      {
        mode: previewOnly ? 'preview' : 'applied',
        bookId: book.id,
        title: book.title,
        previousUnitCount: result.previousUnitCount,
        unitCount: result.units.length,
        sourceWordsPerUnit: result.preview.proposed.sourceWordsPerUnit,
        sourceWordsMergeMin: result.preview.proposed.sourceWordsMergeMin,
        min: result.preview.proposed.min,
        median: result.preview.proposed.median,
        avg: result.preview.proposed.average,
        max: result.preview.proposed.max,
        belowMergeMinimum: result.preview.proposed.belowMergeMinimum,
      },
      null,
      2
    )
  )
  closeStore()
}
