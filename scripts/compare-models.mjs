// Compare text models on the one thing that matters for this app: producing a
// graded reading that stays faithful to the source book.
//
// Now that endpoints are configurable per capability, switching models is a form
// field rather than a redeploy — so the useful question moved from "how do I
// change it" to "which one is actually better on my books". This runs the same
// source excerpt through several models and reports fidelity, length compliance
// and structure side by side.
//
// Usage:
//   node scripts/compare-models.mjs --source path/to/excerpt.txt
//   node scripts/compare-models.mjs --book "Tamerlane"        (pull from your data)
//   node scripts/compare-models.mjs --source x.txt --runs 3   (repeat for variance)
//
// Models come from scripts/model-candidates.json (created on first run).
// API keys are read from that file or the environment; they are never printed.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestTextAi, resolveTextConfig, parseJsonLoose, resetEndpointCapabilities } from '../server/ai-config.js'
import { localFidelityAudit } from '../server/quality.js'
import { wordCount, takeWords } from '../server/text.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidatesPath = path.join(root, 'scripts', 'model-candidates.json')

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback)
}

const SAMPLE_TEMPLATE = {
  _comment: [
    'Each entry is one model to compare. baseUrl/model are required.',
    'apiKey may be a literal key or "env:VAR_NAME" to read from the environment.',
    'apiStyle and jsonMode default to auto-detection; pin them only if you know the endpoint.',
    'This file is gitignored-by-convention: do not commit real keys.',
  ],
  candidates: [
    { label: 'current', baseUrl: 'env:OPENAI_BASE_URL', apiKey: 'env:OPENAI_API_KEY', model: 'env:OPENAI_MODEL' },
    { label: 'alternative', baseUrl: 'https://api.example.com/v1', apiKey: 'env:ALT_API_KEY', model: 'some-model' },
  ],
}

function resolveEnvRef(value) {
  const raw = String(value || '')
  return raw.startsWith('env:') ? String(process.env[raw.slice(4)] || '') : raw
}

async function loadCandidates() {
  try {
    const parsed = JSON.parse(await fs.readFile(candidatesPath, 'utf8'))
    return (parsed.candidates || [])
      .map((candidate) => ({
        label: candidate.label || candidate.model || 'unnamed',
        baseUrl: resolveEnvRef(candidate.baseUrl),
        apiKey: resolveEnvRef(candidate.apiKey),
        model: resolveEnvRef(candidate.model),
        apiStyle: candidate.apiStyle || 'auto',
        jsonMode: candidate.jsonMode || 'auto',
        reasoningEffort: candidate.reasoningEffort || 'medium',
        verbosity: candidate.verbosity || 'medium',
      }))
      .filter((candidate) => candidate.baseUrl && candidate.apiKey && candidate.model)
  } catch {
    await fs.writeFile(candidatesPath, `${JSON.stringify(SAMPLE_TEMPLATE, null, 2)}\n`)
    console.log(`created ${path.relative(root, candidatesPath)} — fill in your models and run again`)
    console.log('(keys can be written as "env:VAR_NAME" so nothing sensitive lives in the file)')
    process.exit(0)
  }
}

// Reads a source excerpt from a file, or from a book already in the database.
async function loadSource() {
  const file = argValue('--source')
  if (file) return fs.readFile(path.resolve(root, file), 'utf8')

  const bookQuery = argValue('--book')
  if (!bookQuery) {
    console.error('provide --source <file> or --book "<title fragment>"')
    process.exit(1)
  }
  const { readDb } = await import('../server/storage.js')
  const db = await readDb()
  const book = db.books.find((item) => String(item.title || '').toLowerCase().includes(bookQuery.toLowerCase()))
  if (!book) {
    console.error(`no book matching "${bookQuery}". Available: ${db.books.map((item) => item.title).join(' | ')}`)
    process.exit(1)
  }
  const unit = db.units.find((item) => item.bookId === book.id && item.sourceText)
  if (!unit) {
    console.error(`book "${book.title}" has no unit with source text`)
    process.exit(1)
  }
  console.log(`source: "${book.title}" — ${unit.sourceLocation}\n`)
  return unit.sourceText
}

const LESSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    reading: {
      type: 'object',
      additionalProperties: false,
      properties: { paragraphs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] } } },
      required: ['paragraphs'],
    },
    vocabulary: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { term: { type: 'string' }, meaningZh: { type: 'string' } }, required: ['term', 'meaningZh'] } },
  },
  required: ['title', 'reading', 'vocabulary'],
}

function buildPrompt(source, level) {
  return `
Generate a personal English graded-reading lesson from a copyrighted source the user uploaded for private study.

Rules:
- Be strictly faithful to the source. Do not add opinions, examples, facts, or claims that are not in the source.
- Rewrite only for language learning.
- Use clear adult English at CEFR ${level}.
- Reading text must contain exactly 5 paragraphs.
- Each reading paragraph must be 130-170 words.
- Include 8-12 useful vocabulary items.

Source:
${takeWords(source, 2600)}
`
}

function evaluate(parsed, source) {
  const paragraphs = parsed?.reading?.paragraphs || []
  const texts = paragraphs.map((item) => String(item.text || ''))
  const words = texts.map(wordCount)
  const total = words.reduce((sum, value) => sum + value, 0)
  const audit = localFidelityAudit({ reading: { paragraphs: texts.map((text) => ({ text })) } }, { sourceText: source })
  const inBand = words.filter((count) => count >= 130 && count <= 170).length

  return {
    fidelity: audit.score,
    risks: audit.risks.length,
    paragraphs: paragraphs.length,
    totalWords: total,
    paragraphsInBand: `${inBand}/${words.length || 0}`,
    vocabulary: (parsed?.vocabulary || []).length,
    // A lesson that follows the brief scores 1.0 here; deviations are visible.
    compliance: Number(
      (
        (paragraphs.length === 5 ? 0.4 : 0) +
        (words.length ? (inBand / words.length) * 0.4 : 0) +
        ((parsed?.vocabulary || []).length >= 8 && (parsed?.vocabulary || []).length <= 12 ? 0.2 : 0)
      ).toFixed(2),
    ),
  }
}

const source = await loadSource()
const candidates = await loadCandidates()
const runs = Math.max(1, Number(argValue('--runs', '1')))
const level = argValue('--level', 'B1')

if (!candidates.length) {
  console.error(`no usable candidates in ${path.relative(root, candidatesPath)} (missing baseUrl, apiKey or model)`)
  process.exit(1)
}

console.log(`comparing ${candidates.length} models, ${runs} run(s) each, CEFR ${level}`)
console.log(`source excerpt: ${wordCount(source)} words\n`)

const results = []
for (const candidate of candidates) {
  const config = resolveTextConfig({ text: candidate }, {})
  for (let run = 1; run <= runs; run += 1) {
    resetEndpointCapabilities()
    const label = runs > 1 ? `${candidate.label} #${run}` : candidate.label
    const startedAt = Date.now()
    try {
      const response = await requestTextAi(
        config,
        {
          instructions: 'You write faithful graded-reading lessons. Return only schema-valid JSON.',
          input: buildPrompt(source, level),
          schema: LESSON_SCHEMA,
          schemaName: 'graded_reading_lesson',
        },
        { fetchImpl: fetch, errorLabel: candidate.label },
      )
      const parsed = parseJsonLoose(response.text)
      results.push({ label, seconds: Math.round((Date.now() - startedAt) / 100) / 10, dialect: response.apiStyle, ...evaluate(parsed, source) })
      console.log(`  ok  ${label}`)
    } catch (error) {
      results.push({ label, error: String(error.message || error).slice(0, 90) })
      console.error(`FAIL  ${label}: ${String(error.message || error).slice(0, 140)}`)
    }
  }
}

console.log('\n--- results ---\n')
const ok = results.filter((row) => !row.error)
if (ok.length) {
  const columns = ['label', 'fidelity', 'compliance', 'paragraphs', 'totalWords', 'paragraphsInBand', 'vocabulary', 'seconds', 'dialect']
  const widths = columns.map((column) => Math.max(column.length, ...ok.map((row) => String(row[column] ?? '').length)))
  console.log(columns.map((column, index) => column.padEnd(widths[index])).join('  '))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of ok.sort((a, b) => b.fidelity - a.fidelity || b.compliance - a.compliance)) {
    console.log(columns.map((column, index) => String(row[column] ?? '').padEnd(widths[index])).join('  '))
  }
  console.log('\nfidelity: local keyword-coverage audit against the source (higher is better)')
  console.log('compliance: how closely the lesson followed the 5-paragraph / 130-170-word / 8-12-vocabulary brief')
  console.log('\nThese are mechanical signals, not a verdict. Read the top two candidates yourself before switching —')
  console.log('a model can score well and still write English you find flat or subtly off-topic.')
}

const failures = results.filter((row) => row.error)
if (failures.length) {
  console.log('\nfailed:')
  for (const row of failures) console.log(`  ${row.label}: ${row.error}`)
}
