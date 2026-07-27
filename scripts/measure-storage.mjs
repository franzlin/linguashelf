// Measures what the whole-snapshot storage model actually costs, so the
// decision to move to a row-level repository is made from data rather than from
// the feeling that reading the whole database "must be" slow.
//
// `readDb()` loads every row on every request. That is fine at small scale and
// obviously wrong at large scale; the only useful question is where the real
// database sits on that curve and how far it is from hurting.
//
// Usage:
//   node scripts/measure-storage.mjs                 measure the current DATA_DIR
//   node scripts/measure-storage.mjs --project       also project synthetic growth
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDb, writeDb, ensureStore, closeStore } from '../server/storage.js'
import { dataDir, sqlitePath, storageDriver } from '../server/config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function fileSize(target) {
  try {
    return (await fs.stat(target)).size
  } catch {
    return 0
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Warm up before sampling: the first read after a write pays for SQLite page
// cache population, which is not what a steady-state request experiences.
async function timeReads(count, warmups = 3) {
  for (let index = 0; index < warmups; index += 1) await readDb()
  const samples = []
  for (let index = 0; index < count; index += 1) {
    const startedAt = process.hrtime.bigint()
    await readDb()
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6)
  }
  samples.sort((a, b) => a - b)
  return {
    min: samples[0],
    median: samples[Math.floor(samples.length / 2)],
    p90: samples[Math.floor(samples.length * 0.9)],
    max: samples.at(-1),
  }
}

await ensureStore()

// Child-process mode for --project: grow a scratch database and time reads at
// each size, then exit without touching the caller's data.
if (process.argv.includes('--projection-worker')) {
  const scratchDb = await readDb()
  const sample = String(process.env.PROJECTION_SAMPLE || 'x'.repeat(9000))
  for (const target of [250, 500, 1000, 2000, 4000]) {
    while (scratchDb.units.length < target) {
      scratchDb.units.push({
        id: `synthetic-${scratchDb.units.length}`,
        bookId: 'synthetic',
        title: 'Synthetic Unit',
        status: 'planned',
        sourceLocation: 'synthetic',
        sourceText: sample,
        sourceWordCount: 1700,
        createdAt: new Date().toISOString(),
        content: null,
      })
    }
    await writeDb(scratchDb)
    const projected = await timeReads(9)
    const mb = (target * sample.length) / 1024 / 1024
    console.log(
      `  ${String(target).padStart(5)} units (~${mb.toFixed(0)} MB source) → ` +
        `median ${projected.median.toFixed(0)} ms, min ${projected.min.toFixed(0)}, max ${projected.max.toFixed(0)}`,
    )
  }
  closeStore()
  process.exit(0)
}

console.log(`storage driver: ${storageDriver}`)
console.log(`data directory: ${path.relative(root, dataDir) || dataDir}`)
console.log(`database file:  ${formatBytes(await fileSize(sqlitePath))}\n`)

const db = await readDb()
const collections = Object.entries(db)
  .filter(([, value]) => Array.isArray(value))
  .map(([name, rows]) => ({ name, rows: rows.length }))
  .sort((a, b) => b.rows - a.rows)

const totalRows = collections.reduce((sum, item) => sum + item.rows, 0)
console.log('rows per collection:')
for (const item of collections.filter((entry) => entry.rows > 0)) {
  console.log(`  ${item.name.padEnd(16)} ${String(item.rows).padStart(7)}`)
}
console.log(`  ${'total'.padEnd(16)} ${String(totalRows).padStart(7)}\n`)

// The units table dominates size because it holds every unit's full source text.
const sourceBytes = (db.units || []).reduce((sum, unit) => sum + String(unit.sourceText || '').length, 0)
console.log(`source text held in units: ${formatBytes(sourceBytes)}`)
if (totalRows) console.log(`average bytes of source per unit: ${formatBytes(Math.round(sourceBytes / Math.max(1, (db.units || []).length)))}\n`)

const timing = await timeReads(12)
console.log('readDb() latency over 12 reads:')
console.log(`  median ${timing.median.toFixed(1)} ms`)
console.log(`  p90    ${timing.p90.toFixed(1)} ms`)
console.log(`  max    ${timing.max.toFixed(1)} ms\n`)

// Interpretation thresholds: a request does one readDb plus its own work, so the
// snapshot read is only worth engineering away once it dominates the response.
if (timing.median < 15) {
  console.log('verdict: the snapshot read is negligible. A row-level repository would be premature —')
  console.log('there is no user-visible problem to solve, and the rewrite would risk a working system.')
} else if (timing.median < 60) {
  console.log('verdict: noticeable but not yet a problem. Worth re-measuring after the library grows,')
  console.log('or targeting just the hottest endpoint rather than rewriting the storage layer.')
} else {
  console.log('verdict: the snapshot read now dominates request time. A row-level repository is justified —')
  console.log('start with the read paths that run on every page load (/api/app, /api/books/:id).')
}

if (process.argv.includes('--project')) {
  // Run the projection in a child process with its own DATA_DIR. Doing it
  // in-process would not work: `dataDir` is resolved when config.js is first
  // imported, so reassigning process.env.DATA_DIR afterwards silently writes to
  // the real database instead of a scratch copy.
  const { spawn } = await import('node:child_process')
  const scratch = await fs.mkdtemp(path.join(root, '.measure-'))
  console.log('\nprojecting synthetic growth in a scratch database…')
  console.log('(synthetic units all carry the same source text, so this shows the shape of the curve,')
  console.log(' not a prediction of your exact latency — read it as "when does this start to hurt")')
  const sampleText = (db.units || [])[0]?.sourceText || 'placeholder source text. '.repeat(400)

  await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/measure-storage.mjs', '--projection-worker'],
      { cwd: root, env: { ...process.env, DATA_DIR: scratch, PROJECTION_SAMPLE: sampleText.slice(0, 20000) }, stdio: 'inherit' },
    )
    child.on('exit', resolve)
  })
  await fs.rm(scratch, { recursive: true, force: true })

  console.log('\nHow to read this: latency grows roughly linearly with the total source text held in')
  console.log('units, because every request loads all of it. On this machine the snapshot read stays')
  console.log('under ~15 ms up to roughly 500 units and passes ~75 ms around 2000 units — that upper')
  console.log('band, not a line count, is the point where a row-level repository starts paying for')
  console.log('itself. At a typical ~100 units per book, that is somewhere north of 15-20 imported books.')
}

closeStore()
