// Server-side API regression harness.
//
// Boots a real server against an isolated data directory with mock AI, then
// drives the whole study loop over HTTP: signup, EPUB/PDF parsing, unit
// planning, generation, progress, completion, vocabulary, micro practice,
// podcast synthesis, job diagnostics and the admin panels.
//
// It exists to make the server/index.js module split verifiable: it is fast
// (no browser, no build) and it asserts the *shape and numbers* the refactor
// must not change. Run it before and after every extraction phase.
//
// Run with: node scripts/test-server-regression.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-regression-'))
const port = 6100 + Math.floor(Math.random() * 500)
const baseUrl = `http://127.0.0.1:${port}`
const email = 'regression@example.com'
const password = 'reader12345'

let passed = 0
let failed = 0
const cleanups = []
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n· ${title}`)
}

// --- fixtures -------------------------------------------------------------

async function makeEpub(title = 'Regression History Reader') {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  const paragraph =
    'Empire, commerce, and public finance changed political life in the late eighteenth century. Merchants needed credit, soldiers needed pay, and ministers needed new taxes. These pressures shaped debates about parliament, sovereignty, local rights, reform, and the rules of trade. Ordinary people felt these large forces through prices, wages, debts, and daily work. Reformers wanted cleaner institutions, but they also depended on older networks of patronage and local influence.'
  const chapter = (index) =>
    Array.from(
      { length: 8 },
      (_, paragraphIndex) =>
        `<p>${paragraph} Chapter ${index} example ${paragraphIndex + 1} shows how economic power and political authority developed together.</p>`,
    ).join('\n')

  for (let index = 1; index <= 2; index += 1) {
    zip.file(
      `OEBPS/chapter${index}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${index}</title></head><body><h1>Chapter ${index}: Empire and Credit</h1>${chapter(index)}</body></html>`,
    )
  }
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>LinguaShelf Test</dc:creator><dc:language>en</dc:language><dc:identifier id="bookid">regression</dc:identifier></metadata>
  <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`,
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function makeTextPdf(pageCount = 10) {
  function alphabeticToken(value) {
    let number = value + 1
    let token = ''
    while (number > 0) {
      number -= 1
      token = String.fromCharCode(97 + (number % 26)) + token
      number = Math.floor(number / 26)
    }
    return token
  }
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const pageReferences = []
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObjectNumber = 4 + pageIndex * 2
    pageReferences.push(`${pageObjectNumber} 0 R`)
    // Page furniture that must never reach a unit's source text: a typesetting
    // tool path, and an ALL-CAPS running head printed on every page.
    const lines = [
      `C:/ITOOLS/WMS/CUP-NEW/WORKINGFOLDER/BOOK-${alphabeticToken(pageIndex)}.3D page ${pageIndex + 1}`,
      'A HISTORY OF PUBLIC FINANCE',
    ]
    lines.push(
      ...Array.from({ length: 14 }, (_, lineIndex) => {
        const marker = `marker${alphabeticToken(pageIndex * 14 + lineIndex)}`
        return `The ${marker} passage explains how merchants soldiers ministers taxes credit reform parliament sovereignty prices wages debts labor institutions and local authority shaped political life.`
      }),
    )
    const commands = ['BT', '/F1 10 Tf', '48 750 Td']
    for (const line of lines) commands.push(`(${escape(line)}) Tj`, '0 -48 Td')
    commands.push('ET')
    const stream = `${commands.join('\n')}\n`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObjectNumber + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    )
  }
  objects[1] = `<< /Type /Pages /Kids [${pageReferences.join(' ')}] /Count ${pageCount} >>`

  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(output)
}

// A DashScope-compatible stand-in so podcast synthesis exercises the real path.
async function startFakeDashscope() {
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/services/audio/tts/SpeechSynthesizer') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ output: { audio: { url: `http://127.0.0.1:${server.address().port}/audio.pcm` } } }))
      return
    }
    if (req.method === 'GET' && req.url === '/audio.pcm') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.alloc(96_000))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(() => new Promise((resolve) => server.close(resolve)))
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` }
}

const dashscope = await startFakeDashscope()

const server = spawn(process.execPath, ['server/index.js', '--prod'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: 'production',
    STORAGE_DRIVER: 'sqlite',
    SESSION_SECRET: 'regression-secret',
    ALLOW_SIGNUP: 'true',
    AI_PROVIDER: 'mock',
    DASHSCOPE_TTS_BASE_URL: dashscope.baseUrl,
    DASHSCOPE_TTS_API_KEY: 'regression-dashscope-key',
    INITIAL_ADMIN_EMAIL: email,
    INITIAL_ADMIN_PASSWORD: password,
    PDF_OCR_ENABLED: 'false',
    MAX_BATCH_GENERATE_UNITS: '3',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (chunk) => serverLog.push(String(chunk)))
server.stderr.on('data', (chunk) => serverLog.push(String(chunk)))
cleanups.push(async () => {
  server.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 300))
})

let cookie = ''

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text, ok: response.ok }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server did not start\n${serverLog.join('')}`)
}

async function uploadBook(filename, buffer, type) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type }), filename)
  return api('/api/books/upload', { method: 'POST', body: form })
}

async function waitForJob(jobId, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const result = await api(`/api/jobs/${jobId}`)
    last = result.json?.job || null
    if (last && ['done', 'failed', 'canceled'].includes(last.status)) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return last
}

try {
  console.log('Server API regression')
  await waitForServer()

  // --- auth ---------------------------------------------------------------
  section('auth and session')
  const badLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'wrong-password' }) })
  check('a wrong password is rejected', badLogin.status === 401, `status ${badLogin.status}`)
  check('the failure message does not reveal whether the account exists', !/密码错误|不存在/.test(badLogin.json?.error || ''))

  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  check('the seeded admin can log in', login.status === 200, `${login.status} ${login.text.slice(0, 160)}`)
  check('login sets a session cookie', cookie.startsWith('linguashelf_session='))
  check('login never returns a password hash', !/passwordHash|salt/i.test(login.text))

  const app = await api('/api/app')
  check('/api/app returns the study payload', app.status === 200 && Boolean(app.json?.settings && app.json?.home && app.json?.stats))
  check('a new account starts with no books', Array.isArray(app.json?.books) && app.json.books.length === 0)
  const defaultSettings = app.json?.settings || {}
  check('reading and listening levels are independent fields', Boolean(defaultSettings.readingLevel && defaultSettings.listeningLevel))

  // --- EPUB ---------------------------------------------------------------
  section('EPUB parsing and unit planning')
  const epubUpload = await uploadBook('regression.epub', await makeEpub(), 'application/epub+zip')
  check('EPUB upload succeeds', epubUpload.status === 200, `${epubUpload.status} ${epubUpload.text.slice(0, 200)}`)
  const epubBook = epubUpload.json?.book
  check('the EPUB title is read from metadata', epubBook?.title === 'Regression History Reader', epubBook?.title)
  check('the EPUB produced units', (epubBook?.totalUnits || 0) > 0, `totalUnits ${epubBook?.totalUnits}`)

  if (process.env.DUMP_SHAPES) console.log('BOOK:', JSON.stringify(epubBook, null, 1).slice(0, 900))
  const epubDetail = await api(`/api/books/${epubBook.id}`)
  if (process.env.DUMP_SHAPES) console.log('UNIT0:', JSON.stringify((epubDetail.json?.units||[])[0], null, 1).slice(0, 700))
  const epubUnits = epubDetail.json?.units || []
  check('unit list is returned with the book', epubUnits.length === epubBook.totalUnits, `${epubUnits.length} vs ${epubBook.totalUnits}`)
  check('every unit records a source location', epubUnits.every((unit) => Boolean(unit.sourceLocation)))
  check('every unit carries source word statistics', epubUnits.every((unit) => (unit.sourceWordCount || 0) > 0))
  check('units are not split by page', epubUnits.every((unit) => !/^第\s*\d+\s*页$/.test(unit.sourceLocation || '')))

  // --- PDF ----------------------------------------------------------------
  section('PDF parsing')
  const pdfUpload = await uploadBook('regression.pdf', makeTextPdf(10), 'application/pdf')
  check('PDF upload succeeds', pdfUpload.status === 200, `${pdfUpload.status} ${pdfUpload.text.slice(0, 200)}`)
  const pdfBook = pdfUpload.json?.book
  check('the PDF produced units', (pdfBook?.totalUnits || 0) > 0, `totalUnits ${pdfBook?.totalUnits}`)

  const pdfDetail = await api(`/api/books/${pdfBook.id}`)
  const pdfUnits = pdfDetail.json?.units || []
  const artifactTitles = pdfUnits.filter((unit) => /WORKINGFOLDER|ITOOLS|\.3D/i.test(`${unit.title} ${unit.sourceLocation}`))
  check('typesetting-tool paths are filtered out of titles', artifactTitles.length === 0, artifactTitles.map((u) => u.title).join(' | '))

  // The running head is printed on every page, so if it survived cleaning it
  // would appear repeatedly inside each unit's source excerpt.
  if (process.env.DUMP_SHAPES) console.log('PDFUNIT0:', JSON.stringify(pdfUnits[0]).slice(0, 600))
  // The fixture prints an ALL-CAPS running head on every page. If it is mistaken
  // for a chapter heading, every page starts a new section — page-based
  // splitting, which the product forbids — and each section inherits the running
  // head as its title. Both symptoms are asserted here.
  const namedAfterRunningHead = pdfUnits.filter((unit) => /a history of public finance/i.test(`${unit.title} ${unit.sourceLocation}`))
  check(
    'no unit is titled after the page running head',
    namedAfterRunningHead.length === 0,
    namedAfterRunningHead.map((unit) => unit.title).join(' | '),
  )
  check(
    'a 10-page PDF does not produce one unit per page',
    pdfUnits.length < 10,
    `${pdfUnits.length} units from 10 pages suggests page-based splitting`,
  )
  check('PDF units reference page ranges for provenance', pdfUnits.some((unit) => /\d/.test(unit.sourceLocation || '')))

  // --- generation ---------------------------------------------------------
  section('unit generation and quality')
  const firstUnit = epubUnits[0]
  const generated = await api(`/api/units/${firstUnit.id}/generate`, { method: 'POST', body: JSON.stringify({}) })
  check('generation succeeds in mock mode', generated.status === 200, `${generated.status} ${generated.text.slice(0, 200)}`)
  const unit = generated.json?.unit
  const paragraphs = unit?.content?.reading?.paragraphs || []
  check('reading content has paragraphs', paragraphs.length > 0, `paragraphs ${paragraphs.length}`)
  check('listening warm-up text exists', Boolean(unit?.content?.listening?.text))
  check('comprehension questions exist', (unit?.content?.questions || []).length > 0)
  check('vocabulary items exist', (unit?.content?.vocabulary || []).length > 0)
  check('a fidelity audit is attached', Boolean(unit?.quality?.fidelity))
  check('a paragraph-to-source map is attached', Array.isArray(unit?.quality?.sourceMap) && unit.quality.sourceMap.length > 0)
  check('the unit never exposes raw source text', unit?.sourceText === undefined)

  const regenerated = await api(`/api/units/${firstUnit.id}/generate`, { method: 'POST', body: JSON.stringify({ force: true }) })
  check('regeneration keeps a previous version', (regenerated.json?.unit?.versions || []).length > 0)

  // --- progress and completion -------------------------------------------
  section('progress, completion and vocabulary')
  const progressPatch = await api(`/api/units/${firstUnit.id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ paragraphIndex: 2, listeningCompleted: true }),
  })
  check('progress saves', progressPatch.status === 200, `${progressPatch.status} ${progressPatch.text.slice(0, 160)}`)
  const progressRead = await api(`/api/units/${firstUnit.id}/progress`)
  if (process.env.DUMP_SHAPES) console.log('PROGRESS:', progressRead.text.slice(0, 400))
  check('progress round-trips the paragraph position', progressRead.json?.progress?.paragraphIndex === 2, JSON.stringify(progressRead.json?.progress))
  check('progress round-trips listening completion', progressRead.json?.progress?.listeningCompleted === true)

  const questions = regenerated.json?.unit?.content?.questions || unit?.content?.questions || []
  const answers = questions.map((question, index) => ({ questionId: question.id, answerIndex: index === 0 ? question.answerIndex : 0 }))
  const completion = await api(`/api/units/${firstUnit.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ answers, savedWords: [{ term: 'sovereignty', meaningZh: '主权' }] }),
  })
  check('completion succeeds', completion.status === 200, `${completion.status} ${completion.text.slice(0, 200)}`)
  if (process.env.DUMP_SHAPES) console.log('COMPLETION:', completion.text.slice(0, 700))
  check('a study report is produced', Boolean(completion.json?.report))
  check('the report scores accuracy', typeof completion.json?.report?.correctRate === 'number')
  check('the report counts questions', (completion.json?.report?.questionCount || 0) > 0)

  const afterCompletion = await api('/api/app')
  check('completion records vocabulary counters', typeof completion.json?.report?.savedVocabularyCount === 'number')
  check('the report reaches the reports list', (afterCompletion.json?.reports || []).length > 0)
  check('home data reflects completed study', (afterCompletion.json?.stats?.completedUnits || 0) > 0)

  if (process.env.DUMP_SHAPES) console.log('APP-VOCAB:', JSON.stringify(afterCompletion.json?.vocabulary || []).slice(0, 400), 'STATS:', JSON.stringify(afterCompletion.json?.stats || {}).slice(0, 400))
  const csvExport = await api('/api/vocabulary/export?format=csv')
  if (process.env.DUMP_SHAPES) console.log('CSV:', csvExport.status, csvExport.text.slice(0, 300))
  check('vocabulary exports as CSV with a header row', csvExport.status === 200 && csvExport.text.startsWith('"term"'), csvExport.text.slice(0, 80))
  check('CSV export escapes spreadsheet formulas', !/^[=+\-@]/m.test(csvExport.text.split('\n').slice(1).join('\n')))

  // --- word definition ----------------------------------------------------
  section('word definition')
  const definition = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: 'sovereignty', sentence: 'The sovereignty of parliament.' }) })
  check('word definition succeeds', definition.status === 200, `${definition.status} ${definition.text.slice(0, 160)}`)
  check('the definition has a Chinese meaning', Boolean(definition.json?.definition?.meaningZh))
  check('the definition has simple English', Boolean(definition.json?.definition?.simpleEnglish))
  const badTerm = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: '中文', sentence: '' }) })
  check('a non-English term is rejected', badTerm.status === 400)

  // --- micro practice -----------------------------------------------------
  section('micro practice')
  const micro = await api('/api/micro-practices/generate', { method: 'POST', body: JSON.stringify({ type: 'reading', topic: 'history' }) })
  check('micro practice generates', micro.status === 200, `${micro.status} ${micro.text.slice(0, 200)}`)
  const practice = micro.json?.practice
  check('micro practice has questions', (practice?.content?.questions || []).length > 0)
  const microAnswers = (practice?.content?.questions || []).map((question) => ({ questionId: question.id, answerIndex: 0 }))
  const microComplete = await api(`/api/micro-practices/${practice.id}/complete`, { method: 'POST', body: JSON.stringify({ answers: microAnswers }) })
  check('micro practice completes', microComplete.status === 200, `${microComplete.status} ${microComplete.text.slice(0, 200)}`)

  // --- podcast ------------------------------------------------------------
  section('podcast generation')
  const podcastStart = await api(`/api/books/${epubBook.id}/podcasts/generate`, { method: 'POST', body: JSON.stringify({ kind: 'topic' }) })
  check('podcast generation is accepted', podcastStart.status === 200 || podcastStart.status === 202, `${podcastStart.status} ${podcastStart.text.slice(0, 200)}`)
  const podcastJobId = podcastStart.json?.job?.id
  if (podcastJobId) {
    const finished = await waitForJob(podcastJobId, { timeoutMs: 45_000 })
    check('the podcast job finishes', finished?.status === 'done', `status ${finished?.status} ${finished?.message || ''}`)
    const podcasts = await api(`/api/books/${epubBook.id}/podcasts`)
    const ready = (podcasts.json?.podcasts || []).filter((item) => item.status === 'ready')
    check('a ready podcast is listed', ready.length > 0, JSON.stringify((podcasts.json?.podcasts || []).map((p) => p.status)))
    check('podcast synthesis called the TTS endpoint', dashscope.requests.length > 0)
    if (ready[0]) {
      const audio = await fetch(`${baseUrl}/api/podcasts/${ready[0].id}/audio`, { headers: { Cookie: cookie } })
      check('podcast audio downloads', audio.ok, `status ${audio.status}`)
      check('podcast audio is not empty', Number(audio.headers.get('content-length') || 0) > 1000)
    }
  }

  // --- jobs ---------------------------------------------------------------
  section('jobs and diagnostics')
  const jobs = await api('/api/jobs')
  check('the job list is returned', jobs.status === 200 && Array.isArray(jobs.json?.jobs))
  check('jobs carry a status', (jobs.json?.jobs || []).every((job) => Boolean(job.status)))

  const preGenerate = await api(`/api/books/${epubBook.id}/pre-generate`, { method: 'POST', body: JSON.stringify({ count: 2 }) })
  check('batch pre-generation is accepted', preGenerate.status === 200, `${preGenerate.status} ${preGenerate.text.slice(0, 200)}`)

  // --- book management ----------------------------------------------------
  section('book management')
  const rename = await api(`/api/books/${pdfBook.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed Regression PDF' }) })
  check('a book can be renamed', rename.json?.book?.title === 'Renamed Regression PDF', rename.text.slice(0, 160))

  const replanPreview = await api(`/api/books/${pdfBook.id}/replan`, { method: 'POST', body: JSON.stringify({ confirm: false }) })
  check('replan preview responds', replanPreview.status === 200 || replanPreview.status === 409, `${replanPreview.status} ${replanPreview.text.slice(0, 200)}`)
  if (process.env.DUMP_SHAPES) console.log('REPLAN:', replanPreview.status, replanPreview.text.slice(0, 400))
  if (replanPreview.status === 200) {
    check('replan preview returns the book with unit totals', typeof replanPreview.json?.book?.totalUnits === 'number', replanPreview.text.slice(0, 160))
  }

  const blockedReplan = await api(`/api/books/${epubBook.id}/replan`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
  check('replanning a book with generated content is blocked', blockedReplan.status === 409, `status ${blockedReplan.status}`)

  // --- settings -----------------------------------------------------------
  section('settings and difficulty')
  const settingsPatch = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ readingLevel: 'B1', listeningLevel: 'A2' }) })
  check('settings save independently for reading and listening', settingsPatch.json?.settings?.readingLevel === 'B1' && settingsPatch.json?.settings?.listeningLevel === 'A2', settingsPatch.text.slice(0, 160))

  // --- admin --------------------------------------------------------------
  section('admin surfaces')
  const security = await api('/api/security/status')
  check('security status responds', security.status === 200, `status ${security.status}`)
  check('security status leaks no key', !/sk-|api[_-]?key["']?\s*:\s*["'][^"']{8,}/i.test(security.text))

  const adminStatus = await api('/api/admin/status')
  check('admin status responds', adminStatus.status === 200, `status ${adminStatus.status}`)

  const services = await api('/api/ai/services')
  check('AI services payload responds', services.status === 200 && Array.isArray(services.json?.services))
  check('every capability appears in the custom config', Object.keys(services.json?.customConfig || {}).length === 6, Object.keys(services.json?.customConfig || {}).join(','))
  check('services payload leaks no key', !services.text.includes('regression-dashscope-key'))

  // --- authorization ------------------------------------------------------
  section('authorization')
  const adminCookie = cookie
  cookie = ''
  const anonApp = await api('/api/app')
  check('unauthenticated study data is refused', anonApp.status === 401, `status ${anonApp.status}`)
  const anonBook = await api(`/api/books/${epubBook.id}`)
  check('unauthenticated book access is refused', anonBook.status === 401, `status ${anonBook.status}`)
  cookie = adminCookie

  const logout = await api('/api/logout', { method: 'POST' })
  check('logout succeeds', logout.status === 200, `status ${logout.status}`)
} catch (error) {
  failed += 1
  failures.push(`harness error: ${error.message}`)
  console.error(`FAIL  harness error: ${error.message}`)
  console.error(error.stack)
  console.error(serverLog.join('').slice(-2000))
} finally {
  if (process.env.DUMP_SERVER_LOG) console.error(serverLog.join('').slice(-4000))
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined)
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failures.length) console.log(`\nfailures:\n  ${failures.join('\n  ')}`)
process.exit(failed ? 1 : 0)
