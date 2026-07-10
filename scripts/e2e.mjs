import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)
const root = path.resolve(__dirname, '..')
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-e2e-'))
const port = 5317 + Math.floor(Math.random() * 600)
const baseUrl = `http://127.0.0.1:${port}`
const email = 'e2e@example.com'
const password = 'reader12345'
const screenshotDir = path.join(root, 'work-screenshots', 'e2e')
await fs.mkdir(screenshotDir, { recursive: true })

const server = spawn(process.execPath, ['server/index.js', '--prod'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    AI_PROVIDER: 'mock',
    ALLOW_SIGNUP: 'true',
    INITIAL_ADMIN_EMAIL: email,
    INITIAL_ADMIN_PASSWORD: password,
    MAX_AUTO_FAILURE_RETRIES: '0',
    PDF_OCR_ENABLED: 'false',
    STORAGE_DRIVER: 'sqlite',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString()
})

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // Keep waiting while the server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`E2E server did not start.\n${serverOutput}`)
}

async function makeEpub(filename = 'e2e-sample.epub', title = 'E2E History Reader') {
  const file = path.join(dataDir, filename)
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  const paragraph = `Empire, commerce, and public finance changed political life in the late eighteenth century. Merchants needed credit, soldiers needed pay, and ministers needed new taxes. These pressures shaped debates about parliament, sovereignty, local rights, reform, and the rules of trade. Ordinary people felt these large forces through prices, wages, debts, and daily work. Reformers wanted cleaner institutions, but they also depended on older networks of patronage and local influence.`
  const body = Array.from({ length: 8 }, (_, index) => `<p>${paragraph} Example ${index + 1} shows how economic power and political authority developed together.</p>`).join('\n')
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One: Empire and Credit</h1>${body}</body></html>`)
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>LinguaShelf Test</dc:creator><dc:language>en</dc:language><dc:identifier id="bookid">${filename}</dc:identifier></metadata>
  <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`
  )
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(file, buffer)
  if (buffer.subarray(30, 58).toString('utf8') === 'application/epub+zip') {
    throw new Error('E2E EPUB unexpectedly matches the old fixed-offset check')
  }
  return file
}

function makeBlankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(output)
}

async function verifyAtomicRestoreFailure() {
  const restoreRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-restore-atomic-'))
  const targetDataDir = path.join(restoreRoot, 'data')
  const invalidBackup = path.join(restoreRoot, 'invalid-backup.zip')
  await fs.mkdir(targetDataDir, { recursive: true })
  await fs.writeFile(path.join(targetDataDir, 'db.json'), JSON.stringify({ marker: 'original-data' }), 'utf8')
  const zip = new JSZip()
  zip.file('data/db.json', '{ invalid json')
  await fs.writeFile(invalidBackup, await zip.generateAsync({ type: 'nodebuffer' }))

  let failed = false
  try {
    await execFileAsync(process.execPath, [path.join(root, 'scripts', 'restore.mjs'), invalidBackup], {
      cwd: root,
      env: { ...process.env, DATA_DIR: targetDataDir },
      timeout: 30_000,
    })
  } catch {
    failed = true
  }
  if (!failed) throw new Error('Invalid restore unexpectedly succeeded')
  const original = JSON.parse(await fs.readFile(path.join(targetDataDir, 'db.json'), 'utf8'))
  if (original.marker !== 'original-data') throw new Error('Failed restore replaced the original data directory')

  const validBackup = path.join(restoreRoot, 'valid-backup.zip')
  const validZip = new JSZip()
  validZip.file('data/db.json', JSON.stringify({ users: [{ id: 'restored-user' }], sessions: [] }))
  await fs.writeFile(validBackup, await validZip.generateAsync({ type: 'nodebuffer' }))
  await execFileAsync(process.execPath, [path.join(root, 'scripts', 'restore.mjs'), validBackup], {
    cwd: root,
    env: { ...process.env, DATA_DIR: targetDataDir },
    timeout: 30_000,
  })
  const restored = JSON.parse(await fs.readFile(path.join(targetDataDir, 'db.json'), 'utf8'))
  if (restored.users?.[0]?.id !== 'restored-user') throw new Error('Validated restore did not replace the data directory')
  const safetyDirectories = (await fs.readdir(restoreRoot)).filter((name) => name.startsWith('data-before-restore-'))
  if (!safetyDirectories.length) throw new Error('Successful restore did not preserve the previous data directory')
  await fs.rm(restoreRoot, { recursive: true, force: true })
}

async function verifyExternalRequestTimeout() {
  const hangingServer = createServer(() => undefined)
  await new Promise((resolve, reject) => {
    hangingServer.once('error', reject)
    hangingServer.listen(0, '127.0.0.1', resolve)
  })
  const hangingPort = hangingServer.address().port
  const timeoutDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-timeout-e2e-'))
  const timeoutPort = 6100 + Math.floor(Math.random() * 500)
  const timeoutBaseUrl = `http://127.0.0.1:${timeoutPort}`
  const timeoutApp = spawn(process.execPath, ['server/index.js', '--prod'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(timeoutPort),
      DATA_DIR: timeoutDataDir,
      STORAGE_DRIVER: 'sqlite',
      AI_PROVIDER: 'auto',
      OPENAI_API_KEY: 'timeout-test-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${hangingPort}/v1`,
      AI_TEXT_REQUEST_TIMEOUT_MS: '1000',
      ALLOW_SIGNUP: 'false',
      INITIAL_ADMIN_EMAIL: 'timeout-admin@example.com',
      INITIAL_ADMIN_PASSWORD: 'timeout-reader-123',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  timeoutApp.stdout.on('data', (chunk) => (output += chunk.toString()))
  timeoutApp.stderr.on('data', (chunk) => (output += chunk.toString()))

  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const response = await fetch(`${timeoutBaseUrl}/api/health`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        undefined
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error(`Timeout test app did not start: ${output}`)

    const login = await fetch(`${timeoutBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'timeout-admin@example.com', password: 'timeout-reader-123' }),
    })
    const loginPayload = await login.json()
    if (!login.ok || !loginPayload.token) throw new Error(`Timeout test login failed: ${JSON.stringify(loginPayload)}`)

    const startedAt = Date.now()
    const testResponse = await fetch(`${timeoutBaseUrl}/api/ai/services/text-ai/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginPayload.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const payload = await testResponse.json()
    const elapsedMs = Date.now() - startedAt
    if (!testResponse.ok || payload.check?.status !== 'failed' || !String(payload.check?.message || '').includes('超时')) {
      throw new Error(`Hanging upstream was not classified as a timeout: ${elapsedMs}ms ${JSON.stringify(payload.check)}`)
    }
    if (elapsedMs < 800 || elapsedMs > 5000) throw new Error(`Configured upstream timeout fired at an unexpected time: ${elapsedMs}ms`)
  } finally {
    const exited = new Promise((resolve) => timeoutApp.once('exit', resolve))
    timeoutApp.kill()
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
    hangingServer.closeAllConnections?.()
    await new Promise((resolve) => hangingServer.close(resolve))
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await fs.rm(timeoutDataDir, { recursive: true, force: true })
        break
      } catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 19) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
}

function makeSilentWav(durationMs = 3000) {
  const sampleRate = 24000
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const pcmBytes = samples * 2
  const wav = Buffer.alloc(44 + pcmBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + pcmBytes, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcmBytes, 40)
  return wav
}

function upsert(db, collection, id, payload) {
  db.prepare(
    `INSERT INTO records (collection, id, payload, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(collection, id) DO UPDATE SET
       payload = excluded.payload,
       updatedAt = excluded.updatedAt`
  ).run(collection, id, JSON.stringify(payload), new Date().toISOString())
}

function insertFailedPodcastTask() {
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'))
  const user = JSON.parse(db.prepare("SELECT payload FROM records WHERE collection='users' LIMIT 1").get().payload)
  const book = JSON.parse(db.prepare("SELECT payload FROM records WHERE collection='books' LIMIT 1").get().payload)
  const unit = JSON.parse(db.prepare("SELECT payload FROM records WHERE collection='units' LIMIT 1").get().payload)
  const now = new Date().toISOString()
  const podcast = {
    id: 'e2e-failed-podcast',
    userId: user.id,
    bookId: book.id,
    index: 1,
    kind: 'walkthrough',
    kindLabel: '全书分集讲解',
    title: '失败播客任务',
    status: 'failed',
    sourceUnitIds: [unit.id],
    sourceText: unit.sourceExcerpt,
    sourceWordCount: unit.sourceWordCount,
    lexile: 900,
    voice: 'Kore',
    scriptText: 'This script is intentionally short for an E2E retry check.',
    scriptMode: 'local-demo',
    audio: null,
    error: 'Gemini TTS 全部来源失败：503 upstream temporary',
    createdAt: now,
    updatedAt: now,
  }
  const job = {
    id: 'e2e-failed-job',
    userId: user.id,
    type: 'generate-podcast',
    status: 'failed',
    progress: 100,
    message: '播客生成失败',
    error: podcast.error,
    errorStage: '播客音频合成',
    errorCode: 'upstream-temporary',
    errorHint: '上游服务或网络临时不稳定。稍后点击重试通常可以恢复。',
    retryable: true,
    provider: 'TTS 服务',
    statusCode: 503,
    retryCount: 0,
    podcastId: podcast.id,
    bookId: book.id,
    createdAt: now,
    finishedAt: now,
    updatedAt: now,
  }
  const usage = {
    id: 'e2e-usage',
    userId: user.id,
    jobId: job.id,
    category: 'audio',
    action: 'generate-podcast-tts',
    provider: 'Gemini TTS',
    model: 'gemini-3.1-flash-tts-preview',
    inputTokens: 1200,
    outputTokens: 0,
    audioSeconds: 0,
    audioBytes: 0,
    pages: 0,
    bytes: 0,
    chunks: 2,
    success: false,
    statusCode: 503,
    errorCode: 'upstream-temporary',
    message: 'temporary upstream failure',
    createdAt: now,
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    upsert(db, 'podcasts', podcast.id, podcast)
    upsert(db, 'jobs', job.id, job)
    upsert(db, 'aiUsage', usage.id, usage)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

let browser
try {
  await waitForServer()
  await verifyAtomicRestoreFailure()
  await verifyExternalRequestTimeout()
  const epubPath = await makeEpub()
  const secondEpubPath = await makeEpub('e2e-sample-two.epub', 'E2E Second Reader')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: '首页' }).waitFor()
  const token = await page.evaluate(() => localStorage.getItem('linguashelf-token'))
  if (!token) throw new Error('Login did not persist a session token')

  const authDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true })
  try {
    const session = JSON.parse(authDb.prepare("SELECT payload FROM records WHERE collection='sessions' LIMIT 1").get().payload)
    const user = JSON.parse(authDb.prepare("SELECT payload FROM records WHERE collection='users' LIMIT 1").get().payload)
    if (session.token) throw new Error('Session token was stored in plaintext')
    if (session.tokenHash !== crypto.createHash('sha256').update(token).digest('hex')) throw new Error('Stored session token hash does not match')
    if (!String(user.passwordHash || '').startsWith('pbkdf2-sha256$600000$')) throw new Error('Password hash did not use the upgraded PBKDF2 format')
  } finally {
    authDb.close()
  }

  const legacyUserId = 'e2e-legacy-user'
  const legacyPassword = 'legacy-reader-123'
  const legacySalt = crypto.randomBytes(16).toString('hex')
  const legacyHash = crypto.pbkdf2Sync(legacyPassword, legacySalt, 100000, 32, 'sha256').toString('hex')
  const legacyDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'))
  try {
    upsert(legacyDb, 'users', legacyUserId, {
      id: legacyUserId,
      email: 'legacy@example.com',
      name: 'legacy',
      passwordHash: `${legacySalt}:${legacyHash}`,
      role: 'user',
      createdAt: new Date().toISOString(),
    })
  } finally {
    legacyDb.close()
  }
  const legacyLoginResponse = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { email: 'legacy@example.com', password: legacyPassword },
  })
  const legacyLoginPayload = await legacyLoginResponse.json()
  if (!legacyLoginResponse.ok() || !legacyLoginPayload.token) throw new Error(`Legacy password login failed: ${JSON.stringify(legacyLoginPayload)}`)
  const upgradedDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true })
  try {
    const upgradedUser = JSON.parse(upgradedDb.prepare("SELECT payload FROM records WHERE collection='users' AND id=?").get(legacyUserId).payload)
    const upgradedSession = JSON.parse(
      upgradedDb.prepare("SELECT payload FROM records WHERE collection='sessions' AND payload LIKE ? ORDER BY updatedAt DESC LIMIT 1").get(`%${legacyUserId}%`).payload
    )
    if (!String(upgradedUser.passwordHash || '').startsWith('pbkdf2-sha256$600000$')) throw new Error('Legacy password hash was not upgraded on login')
    if (upgradedSession.token || upgradedSession.tokenHash !== crypto.createHash('sha256').update(legacyLoginPayload.token).digest('hex')) {
      throw new Error('Legacy-user session was not stored as a token hash')
    }
  } finally {
    upgradedDb.close()
  }

  const readyResponse = await page.request.get(`${baseUrl}/api/ready`)
  const readyPayload = await readyResponse.json()
  if (!readyResponse.ok() || JSON.stringify(readyPayload) !== JSON.stringify({ ok: true })) {
    throw new Error(`Readiness endpoint exposed unexpected data: ${JSON.stringify(readyPayload)}`)
  }

  const zeroGoalResponse = await page.request.patch(`${baseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { microPracticeDailyGoal: 0, microPracticeMonthlyGoal: 0 },
  })
  if (!zeroGoalResponse.ok()) throw new Error(`Setting zero micro goals failed with HTTP ${zeroGoalResponse.status()}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '首页' }).waitFor()
  await page.getByText('今日 0/0 次').waitFor()
  if (await page.getByText('轻练目标已完成。').count()) throw new Error('A disabled micro goal was incorrectly shown as completed')
  const restoreGoalResponse = await page.request.patch(`${baseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { microPracticeDailyGoal: 1, microPracticeMonthlyGoal: 30 },
  })
  if (!restoreGoalResponse.ok()) throw new Error(`Restoring micro goals failed with HTTP ${restoreGoalResponse.status()}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '首页' }).waitFor()

  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.getByRole('heading', { name: '我的书库' }).waitFor()
  await page.locator('input[type="file"]').setInputFiles(epubPath)
  await page.getByText('E2E History Reader').waitFor({ timeout: 15000 })
  await page.screenshot({ path: path.join(screenshotDir, 'library-upload.png'), fullPage: true })

  const ocrUploadStartedAt = Date.now()
  const ocrUploadResponse = await page.request.post(`${baseUrl}/api/books/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'background-ocr.pdf',
        mimeType: 'application/pdf',
        buffer: makeBlankPdf(),
      },
    },
  })
  const ocrUploadPayload = await ocrUploadResponse.json()
  if (ocrUploadResponse.status() !== 202 || ocrUploadPayload.job?.type !== 'parse-pdf-ocr' || ocrUploadPayload.book?.status !== 'processing') {
    throw new Error(`Scanned PDF was not queued for background OCR: ${ocrUploadResponse.status()} ${JSON.stringify(ocrUploadPayload)}`)
  }
  if (Date.now() - ocrUploadStartedAt > 5000) throw new Error('Scanned PDF upload waited too long for OCR')
  let ocrJobPayload = ocrUploadPayload
  for (let attempt = 0; attempt < 30 && !['failed', 'succeeded'].includes(ocrJobPayload.job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    ocrJobPayload = await (
      await page.request.get(`${baseUrl}/api/jobs/${ocrUploadPayload.job.id}`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()
  }
  if (ocrJobPayload.job.status !== 'failed' || ocrJobPayload.job.errorStage !== '扫描 PDF 解析') {
    throw new Error(`Background OCR failure was not diagnosed correctly: ${JSON.stringify(ocrJobPayload.job)}`)
  }
  const deleteOcrBookResponse = await page.request.delete(`${baseUrl}/api/books/${ocrUploadPayload.book.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!deleteOcrBookResponse.ok()) throw new Error(`Failed to clean up OCR E2E book: ${deleteOcrBookResponse.status()}`)

  const secondUploadResponse = await page.request.post(`${baseUrl}/api/books/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'e2e-sample-two.epub',
        mimeType: 'application/epub+zip',
        buffer: await fs.readFile(secondEpubPath),
      },
    },
  })
  if (!secondUploadResponse.ok()) throw new Error(`Second EPUB upload failed: ${secondUploadResponse.status()} ${await secondUploadResponse.text()}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '首页' }).waitFor()
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.getByText('E2E Second Reader').waitFor()
  const booksForRace = await (await page.request.get(`${baseUrl}/api/app`, { headers: { Authorization: `Bearer ${token}` } })).json()
  const firstRaceBook = booksForRace.books.find((book) => book.title === 'E2E History Reader')
  let delayedBookRequestSeen = false
  await page.route(`**/api/books/${firstRaceBook.id}`, async (route) => {
    delayedBookRequestSeen = true
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue().catch(() => undefined)
  })
  await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.locator('.book-card').filter({ hasText: 'E2E Second Reader' }).getByRole('button', { name: '打开' }).click()
  await page.locator('.detail-head h1').filter({ hasText: 'E2E Second Reader' }).waitFor()
  await page.waitForTimeout(650)
  if (!delayedBookRequestSeen || !(await page.locator('.detail-head h1').filter({ hasText: 'E2E Second Reader' }).count())) {
    throw new Error('A delayed book response overwrote the most recently opened book')
  }
  await page.unroute(`**/api/books/${firstRaceBook.id}`)
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
  await page.getByRole('heading', { name: '学习单元' }).waitFor()

  if (!(await page.getByRole('heading', { name: '学习单元' }).count())) {
    await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
    await page.getByRole('heading', { name: '学习单元' }).waitFor()
  }
  await page.locator('.unit-row').first().getByRole('button', { name: /^(学习|生成)$/ }).click()
  await page.getByRole('heading', { name: '分级阅读' }).waitFor({ timeout: 20000 })
  await page.getByRole('heading', { name: '听力预热' }).waitFor()
  await page.screenshot({ path: path.join(screenshotDir, 'study-generated.png'), fullPage: true })

  let progressRequestsInFlight = 0
  let maxProgressRequestsInFlight = 0
  const progressBodies = []
  await page.route('**/api/units/*/progress', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    progressRequestsInFlight += 1
    maxProgressRequestsInFlight = Math.max(maxProgressRequestsInFlight, progressRequestsInFlight)
    progressBodies.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (progressBodies.length === 1) await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({ response })
    progressRequestsInFlight -= 1
  })
  const studyQuestions = page.locator('.question-item')
  await studyQuestions.nth(0).locator('.options-grid button').nth(0).click()
  await studyQuestions.nth(1).locator('.options-grid button').nth(0).click()
  await page.getByRole('button', { name: '已同步' }).waitFor({ timeout: 5000 })
  await page.unroute('**/api/units/*/progress')
  if (maxProgressRequestsInFlight !== 1) throw new Error(`Progress saves were not serialized: max in flight ${maxProgressRequestsInFlight}`)
  if (progressBodies.length < 2 || Object.keys(progressBodies.at(-1)?.answers || {}).length < 2) {
    throw new Error(`Latest progress save did not contain all answers: ${JSON.stringify(progressBodies)}`)
  }

  const appBeforeCompletion = await (await page.request.get(`${baseUrl}/api/app`, { headers: { Authorization: `Bearer ${token}` } })).json()
  const uploadedBook = appBeforeCompletion.books.find((book) => book.title === 'E2E History Reader')
  const uploadedBookDetail = await (
    await page.request.get(`${baseUrl}/api/books/${uploadedBook.id}`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()
  const generatedUnit = uploadedBookDetail.units[0]
  const correctAnswers = Object.fromEntries(generatedUnit.content.questions.map((question) => [question.id, question.answerIndex]))
  const completeOptions = {
    headers: { Authorization: `Bearer ${token}` },
    data: { answers: correctAnswers, viewedWords: [], listeningCompleted: true },
  }
  const [unitCompleteFirst, unitCompleteSecond] = await Promise.all([
    page.request.post(`${baseUrl}/api/units/${generatedUnit.id}/complete`, completeOptions),
    page.request.post(`${baseUrl}/api/units/${generatedUnit.id}/complete`, completeOptions),
  ])
  const [unitCompleteFirstPayload, unitCompleteSecondPayload] = await Promise.all([unitCompleteFirst.json(), unitCompleteSecond.json()])
  if (unitCompleteFirstPayload.report.id !== unitCompleteSecondPayload.report.id) {
    throw new Error(`Concurrent unit completion created duplicate reports: ${JSON.stringify([unitCompleteFirstPayload, unitCompleteSecondPayload])}`)
  }
  if ([unitCompleteFirstPayload.duplicate, unitCompleteSecondPayload.duplicate].filter(Boolean).length !== 1) {
    throw new Error('Concurrent unit completion did not return one original and one duplicate response')
  }
  if (unitCompleteFirstPayload.report.newVocabularyCount !== 0) {
    throw new Error(`Unit completion added unviewed vocabulary: ${JSON.stringify(unitCompleteFirstPayload.report)}`)
  }
  const appAfterCompletion = await (await page.request.get(`${baseUrl}/api/app`, { headers: { Authorization: `Bearer ${token}` } })).json()
  if (appAfterCompletion.reports.filter((report) => report.unitId === generatedUnit.id).length !== 1) {
    throw new Error('Duplicate unit reports were persisted')
  }
  if (appAfterCompletion.vocabulary.length !== 0) throw new Error(`Unviewed lesson vocabulary was saved: ${JSON.stringify(appAfterCompletion.vocabulary)}`)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileStudyMetrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (mobileStudyMetrics.scrollWidth > mobileStudyMetrics.width) {
    throw new Error(`Mobile study page overflows horizontally: ${JSON.stringify(mobileStudyMetrics)}`)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-study-sync.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.getByLabel('主导航').getByRole('button', { name: '轻练' }).click()
  await page.getByRole('heading', { name: '每日轻练' }).waitFor()
  await page.getByRole('button', { name: '短文阅读' }).click()
  await page.getByRole('button', { name: '开始新轻练' }).click()
  await page.getByRole('heading', { name: 'Short Reading Practice' }).waitFor({ timeout: 15000 })
  const microQuestions = page.locator('.micro-practice-card .question-item')
  const microQuestionCount = await microQuestions.count()
  if (microQuestionCount < 2) {
    throw new Error(`Expected at least 2 micro-practice questions, found ${microQuestionCount}`)
  }
  for (let index = 0; index < microQuestionCount; index += 1) {
    await microQuestions.nth(index).locator('.options-grid button').nth(index === 0 ? 1 : 0).click()
  }
  const microCompleteResponsePromise = page.waitForResponse((response) => response.url().includes('/api/micro-practices/') && response.url().includes('/complete'))
  await page.getByRole('button', { name: '提交答案' }).click()
  const microCompleteResponse = await microCompleteResponsePromise
  if (!microCompleteResponse.ok()) {
    throw new Error(`Micro practice complete failed with HTTP ${microCompleteResponse.status()}: ${await microCompleteResponse.text()}`)
  }
  const microCompletePayload = await microCompleteResponse.json()
  if (!microCompletePayload.attempt || !microCompletePayload.practice) {
    throw new Error(`Micro practice complete returned unexpected payload: ${JSON.stringify(microCompletePayload)}`)
  }
  if (microCompletePayload.attempt.savedVocabularyCount !== 2) {
    throw new Error(`Expected the single wrong answer to link 2 related terms, got ${microCompletePayload.attempt.savedVocabularyCount}`)
  }
  await page.waitForTimeout(750)
  if (!(await page.locator('.completion-overlay').count())) {
    const bodyText = (await page.locator('body').innerText()).slice(0, 2000)
    throw new Error(`Micro practice completion overlay did not appear. Page text:\n${bodyText}`)
  }
  await page.locator('.completion-overlay').getByRole('heading', { name: /正确/ }).waitFor()
  await page.getByText('关联生词').waitFor()
  await page.screenshot({ path: path.join(screenshotDir, 'micro-practice-completed.png'), fullPage: true })
  await page.getByRole('button', { name: '查看详情' }).click()
  const recommendationCard = page.locator('.micro-side .page-section').filter({ hasText: '今日推荐' }).first()
  await recommendationCard.getByRole('heading', { name: '近期生词' }).waitFor()

  const duplicateCompleteResponse = await page.request.post(`${baseUrl}/api/micro-practices/${microCompletePayload.practice.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { answers: {}, elapsedSeconds: 1 },
  })
  if (!duplicateCompleteResponse.ok()) throw new Error(`Duplicate completion returned HTTP ${duplicateCompleteResponse.status()}`)
  const duplicateCompletePayload = await duplicateCompleteResponse.json()
  if (!duplicateCompletePayload.duplicate || duplicateCompletePayload.attempt.id !== microCompletePayload.attempt.id) {
    throw new Error(`Duplicate completion was not idempotent: ${JSON.stringify(duplicateCompletePayload)}`)
  }
  const microAfterDuplicate = await page.request.get(`${baseUrl}/api/micro-practices/recent`, { headers: { Authorization: `Bearer ${token}` } })
  const microAfterDuplicatePayload = await microAfterDuplicate.json()
  if (microAfterDuplicatePayload.stats.microPracticeCount !== 1 || microAfterDuplicatePayload.stats.todayMicroPractices !== 1) {
    throw new Error(`Duplicate completion changed stats: ${JSON.stringify(microAfterDuplicatePayload.stats)}`)
  }
  const appAfterWrongAnswer = await page.request.get(`${baseUrl}/api/app`, { headers: { Authorization: `Bearer ${token}` } })
  const appAfterWrongAnswerPayload = await appAfterWrongAnswer.json()
  if (appAfterWrongAnswerPayload.vocabulary.some((item) => Number(item.wrongQuestionCount || 0) > 1)) {
    throw new Error(`Wrong-question counts were over-incremented: ${JSON.stringify(appAfterWrongAnswerPayload.vocabulary)}`)
  }

  await page.route('**/api/micro-practices/*/audio*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: makeSilentWav() })
  })
  await page.getByRole('button', { name: '听力轻练' }).click()
  const firstListeningResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/micro-practices/generate') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始新轻练' }).click()
  const firstListeningPayload = await (await firstListeningResponsePromise).json()
  const secondListeningResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/micro-practices/generate') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始新轻练' }).click()
  const secondListeningPayload = await (await secondListeningResponsePromise).json()
  const secondAudioRequestPromise = page.waitForRequest((request) => request.url().includes(`/api/micro-practices/${secondListeningPayload.practice.id}/audio`))
  await page.getByRole('button', { name: '播放' }).click()
  await secondAudioRequestPromise
  await page.getByRole('button', { name: '暂停' }).click()
  const listeningHistory = page.locator('.micro-practice-list button').filter({ hasText: 'Short Listening Practice' })
  if ((await listeningHistory.count()) < 2) throw new Error('Expected two listening practices in recent history')
  await listeningHistory.nth(1).click()
  if (await page.locator('.micro-listening .podcast-audio').count()) throw new Error('Switching practices did not clear the previous audio URL')
  const firstAudioRequestPromise = page.waitForRequest((request) => request.url().includes(`/api/micro-practices/${firstListeningPayload.practice.id}/audio`))
  await page.getByRole('button', { name: '播放' }).click()
  await firstAudioRequestPromise

  const personalizedResponse = await page.request.post(`${baseUrl}/api/micro-practices/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'reading', topic: 'weak-vocabulary', difficulty: 'A2' },
  })
  if (!personalizedResponse.ok()) throw new Error(`Recent-vocabulary generation returned HTTP ${personalizedResponse.status()}`)
  const personalizedPayload = await personalizedResponse.json()
  if (personalizedPayload.practice.sourceMode !== 'vocabulary' || personalizedPayload.practice.topicLabel !== '近期生词') {
    throw new Error(`Recent-vocabulary generation used the wrong source: ${JSON.stringify(personalizedPayload.practice)}`)
  }

  const concurrentPracticeResponse = await page.request.post(`${baseUrl}/api/micro-practices/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'reading', topic: 'history', difficulty: 'A2' },
  })
  const concurrentPracticePayload = await concurrentPracticeResponse.json()
  const concurrentAnswers = Object.fromEntries(
    concurrentPracticePayload.practice.content.questions.map((question) => [question.id, question.answerIndex])
  )
  const concurrentCompleteOptions = {
    headers: { Authorization: `Bearer ${token}` },
    data: { answers: concurrentAnswers, elapsedSeconds: 60 },
  }
  const [concurrentFirstResponse, concurrentSecondResponse] = await Promise.all([
    page.request.post(`${baseUrl}/api/micro-practices/${concurrentPracticePayload.practice.id}/complete`, concurrentCompleteOptions),
    page.request.post(`${baseUrl}/api/micro-practices/${concurrentPracticePayload.practice.id}/complete`, concurrentCompleteOptions),
  ])
  const [concurrentFirstPayload, concurrentSecondPayload] = await Promise.all([
    concurrentFirstResponse.json(),
    concurrentSecondResponse.json(),
  ])
  if (concurrentFirstPayload.attempt.id !== concurrentSecondPayload.attempt.id) {
    throw new Error(`Concurrent completion created different attempts: ${JSON.stringify([concurrentFirstPayload, concurrentSecondPayload])}`)
  }
  if ([concurrentFirstPayload.duplicate, concurrentSecondPayload.duplicate].filter(Boolean).length !== 1) {
    throw new Error(`Concurrent completion did not return one original and one duplicate response`)
  }

  insertFailedPodcastTask()
  await page.getByLabel('主导航').getByRole('button', { name: '任务' }).click()
  await page.locator('h1').filter({ hasText: '任务' }).waitFor()
  await page.getByText('可以直接重试').waitFor()
  await page.getByText('已记录 1 次服务调用').waitFor()
  const retryResponsePromise = page.waitForResponse((response) => response.url().includes('/api/jobs/e2e-failed-job') && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: '用备用源重试' }).click()
  const retryResponse = await retryResponsePromise
  if (!retryResponse.ok()) throw new Error(`Fallback retry failed with HTTP ${retryResponse.status()}`)
  const retryPayload = await retryResponse.json()
  if (!retryPayload.job || !['queued', 'running', 'succeeded'].includes(retryPayload.job.status)) {
    throw new Error(`Fallback retry returned unexpected payload: ${JSON.stringify(retryPayload)}`)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'tasks-failure-guidance.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('移动端导航').getByRole('button', { name: '数据' }).click()
  await page.getByRole('heading', { name: '学习数据' }).waitFor()
  const mobileMetrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  if (mobileMetrics.scrollWidth > mobileMetrics.width) {
    throw new Error(`Mobile page overflows horizontally: ${JSON.stringify(mobileMetrics)}`)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-dashboard.png'), fullPage: true })
} finally {
  if (browser) await browser.close()
  server.kill()
}

console.log(`E2E passed against ${baseUrl}`)
