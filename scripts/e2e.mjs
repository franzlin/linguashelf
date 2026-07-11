import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium, request as playwrightRequest } from 'playwright'
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

function makeTextPdf(pageCount = 12) {
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

  function escapePdfText(value) {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  }

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const pageReferences = []
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObjectNumber = 4 + pageIndex * 2
    const contentObjectNumber = pageObjectNumber + 1
    pageReferences.push(`${pageObjectNumber} 0 R`)
    const lines = [`C:/ITOOLS/WMS/CUP-NEW/WORKINGFOLDER/BOOK-${alphabeticToken(pageIndex)}.3D page ${pageIndex + 1}`]
    lines.push(...Array.from({ length: 14 }, (_, lineIndex) => {
      const marker = `marker${alphabeticToken(pageIndex * 14 + lineIndex)}`
      return `The ${marker} passage explains how merchants soldiers ministers taxes credit reform parliament sovereignty prices wages debts labor institutions and local authority shaped political life.`
    }))
    const commands = ['BT', '/F1 10 Tf', '48 750 Td']
    for (const line of lines) {
      commands.push(`(${escapePdfText(line)}) Tj`, '0 -48 Td')
    }
    commands.push('ET')
    const stream = `${commands.join('\n')}\n`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
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

async function verifyConsistentSqliteBackup() {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-backup-e2e-'))
  const sourceDataDir = path.join(backupRoot, 'source-data')
  const restoredDataDir = path.join(backupRoot, 'restored-data')
  const backupFile = path.join(backupRoot, 'snapshot.zip')
  const extractedSqlite = path.join(backupRoot, 'snapshot.sqlite')
  await fs.mkdir(sourceDataDir, { recursive: true })
  await fs.mkdir(path.join(sourceDataDir, 'upload-tmp'), { recursive: true })
  await fs.writeFile(path.join(sourceDataDir, 'upload-tmp', 'partial-upload.epub'), 'incomplete upload')

  const liveDb = new DatabaseSync(path.join(sourceDataDir, 'app.sqlite'))
  try {
    liveDb.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY(collection, id)
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO records VALUES ('users', 'backup-user', '{"id":"backup-user"}', '2026-07-10T00:00:00.000Z');
      INSERT INTO meta VALUES ('initialized', '1');
    `)

    await execFileAsync(process.execPath, [path.join(root, 'scripts', 'backup.mjs'), '--out', backupFile], {
      cwd: root,
      env: {
        ...process.env,
        DATA_DIR: sourceDataDir,
        BACKUP_ENCRYPTION_REQUIRED: 'false',
        BACKUP_KEY: '',
      },
      timeout: 30_000,
    })

    const zip = await JSZip.loadAsync(await fs.readFile(backupFile))
    const names = Object.keys(zip.files)
    if (!names.includes('data/app.sqlite')) throw new Error('Consistent backup did not contain app.sqlite')
    if (names.some((name) => name.endsWith('app.sqlite-wal') || name.endsWith('app.sqlite-shm'))) {
      throw new Error(`Consistent backup copied live SQLite sidecars: ${JSON.stringify(names)}`)
    }
    if (names.some((name) => name.startsWith('data/upload-tmp/'))) {
      throw new Error(`Consistent backup copied temporary uploads: ${JSON.stringify(names)}`)
    }
    const meta = JSON.parse(await zip.file('backup-meta.json').async('string'))
    if (meta.databaseSnapshot !== 'sqlite-vacuum-into') {
      throw new Error(`Backup did not report a transaction-consistent SQLite snapshot: ${JSON.stringify(meta)}`)
    }

    await fs.writeFile(extractedSqlite, await zip.file('data/app.sqlite').async('nodebuffer'))
    const snapshotDb = new DatabaseSync(extractedSqlite, { readOnly: true })
    try {
      const integrity = snapshotDb.prepare('PRAGMA integrity_check').get()
      const count = snapshotDb.prepare('SELECT COUNT(*) AS count FROM records').get()
      if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok' || Number(count?.count || 0) !== 1) {
        throw new Error(`SQLite backup snapshot is invalid: ${JSON.stringify({ integrity, count })}`)
      }
    } finally {
      snapshotDb.close()
    }

    await execFileAsync(process.execPath, [path.join(root, 'scripts', 'restore.mjs'), backupFile], {
      cwd: root,
      env: { ...process.env, DATA_DIR: restoredDataDir, BACKUP_KEY: '' },
      timeout: 30_000,
    })
    const restoredDb = new DatabaseSync(path.join(restoredDataDir, 'app.sqlite'), { readOnly: true })
    try {
      const restoredUser = restoredDb.prepare("SELECT payload FROM records WHERE collection='users' AND id='backup-user'").get()
      if (!restoredUser || JSON.parse(restoredUser.payload).id !== 'backup-user') {
        throw new Error('Restored consistent backup did not contain the expected record')
      }
    } finally {
      restoredDb.close()
    }
  } finally {
    liveDb.close()
    await fs.rm(backupRoot, { recursive: true, force: true })
  }
}

async function verifyPasswordChecksDoNotBlockHealth() {
  const attempts = Array.from({ length: 4 }, (_, index) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: `wrong-password-${index}` }),
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  const healthStartedAt = Date.now()
  const health = await fetch(`${baseUrl}/api/health`)
  const healthElapsedMs = Date.now() - healthStartedAt
  await Promise.all(attempts)
  if (!health.ok || healthElapsedMs > 750) {
    throw new Error(`Password verification blocked the health endpoint for ${healthElapsedMs}ms`)
  }
}

async function waitForUploadTempCleanup(uploadTempDir, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const entries = await fs.readdir(uploadTempDir)
    if (!entries.length) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${label} left temporary upload files behind: ${JSON.stringify(await fs.readdir(uploadTempDir))}`)
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
    const timeoutCookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    if (!login.ok || !timeoutCookie.startsWith('linguashelf_session=')) throw new Error(`Timeout test login failed: ${JSON.stringify(loginPayload)}`)

    const startedAt = Date.now()
    const testResponse = await fetch(`${timeoutBaseUrl}/api/ai/services/text-ai/test`, {
      method: 'POST',
      headers: { Cookie: timeoutCookie, 'Content-Type': 'application/json' },
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

function replaceBookUnitsWithLegacyFragments(bookId, wordsPerUnit = 260) {
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'))
  try {
    const unitRows = db.prepare("SELECT id, payload FROM records WHERE collection='units'").all()
    const units = unitRows.map((row) => ({ rowId: row.id, value: JSON.parse(row.payload) })).filter((item) => item.value.bookId === bookId)
    const sourceText = units.map((item) => item.value.sourceText || '').join('\n\n').trim()
    const words = sourceText.split(/\s+/).filter(Boolean)
    if (words.length < wordsPerUnit * 3) throw new Error(`Text PDF fixture produced too little source text: ${words.length}`)
    const now = new Date().toISOString()
    const fragments = []
    for (let index = 0; index < words.length; index += wordsPerUnit) {
      const fragment = words.slice(index, index + wordsPerUnit).join(' ')
      if (fragment.split(/\s+/).length < 80) continue
      fragments.push({
        id: `e2e-legacy-unit-${fragments.length + 1}`,
        bookId,
        title: `Legacy Page ${fragments.length + 1}`,
        status: 'planned',
        sourceLocation: `Page ${fragments.length + 1}`,
        sourceText: fragment,
        sourceExcerpt: fragment.split(/\s+/).slice(0, 180).join(' '),
        sourceWordCount: fragment.split(/\s+/).length,
        createdAt: now,
        generatedAt: null,
        content: null,
      })
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of units) db.prepare("DELETE FROM records WHERE collection='units' AND id=?").run(item.rowId)
      for (const fragment of fragments) upsert(db, 'units', fragment.id, fragment)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return fragments.length
  } finally {
    db.close()
  }
}

function setTemporaryPodcastBlocker(bookId, enabled) {
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'))
  try {
    const id = 'e2e-replan-podcast-blocker'
    if (!enabled) {
      db.prepare("DELETE FROM records WHERE collection='podcasts' AND id=?").run(id)
      return
    }
    const book = JSON.parse(db.prepare("SELECT payload FROM records WHERE collection='books' AND id=?").get(bookId).payload)
    const now = new Date().toISOString()
    upsert(db, 'podcasts', id, {
      id,
      userId: book.userId,
      bookId,
      kind: 'preview',
      index: 1,
      title: 'Replan blocker',
      status: 'ready',
      sourceUnitIds: [],
      sourceWordCount: 100,
      lexile: 900,
      audio: null,
      createdAt: now,
      updatedAt: now,
    })
  } finally {
    db.close()
  }
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
  await verifyConsistentSqliteBackup()
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
  if (await page.locator('.notice.danger').count()) throw new Error('First login displayed a stale global error notice')
  const localStorageToken = await page.evaluate(() => localStorage.getItem('linguashelf-token'))
  if (localStorageToken) throw new Error('Login persisted a session token in localStorage')
  const sessionCookie = (await page.context().cookies(baseUrl)).find((cookie) => cookie.name === 'linguashelf_session')
  if (!sessionCookie?.value || !sessionCookie.httpOnly || sessionCookie.sameSite !== 'Strict') {
    throw new Error(`Login did not create a hardened HttpOnly session cookie: ${JSON.stringify(sessionCookie)}`)
  }
  const token = sessionCookie.value

  const bearerFallbackResponse = await fetch(`${baseUrl}/api/app`, {
    headers: {
      Cookie: 'linguashelf_session=expired-cookie-value',
      Authorization: `Bearer ${token}`,
    },
  })
  if (!bearerFallbackResponse.ok) {
    throw new Error(`A stale cookie prevented valid Bearer authentication: ${bearerFallbackResponse.status}`)
  }
  const refreshedCookie = String(bearerFallbackResponse.headers.get('set-cookie') || '')
  if (!refreshedCookie.includes(`linguashelf_session=${token}`)) {
    throw new Error(`Bearer fallback did not refresh the session cookie: ${refreshedCookie}`)
  }

  await verifyPasswordChecksDoNotBlockHealth()

  await page.route(
    '**/api/app',
    async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary app failure' }) })
    },
    { times: 1 }
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('暂时无法打开书架').waitFor()
  if (await page.locator('input[type="email"]').count()) throw new Error('A transient /api/app failure returned the user to the login screen')
  const cookieAfterFailure = (await page.context().cookies(baseUrl)).find((cookie) => cookie.name === 'linguashelf_session')
  if (!cookieAfterFailure?.value) throw new Error('A transient /api/app failure discarded the session cookie')
  await page.getByRole('button', { name: '重试' }).click()
  await page.getByRole('heading', { name: '首页' }).waitFor()

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
  const legacyApi = await playwrightRequest.newContext({ baseURL: baseUrl })
  const legacyLoginResponse = await legacyApi.post('/api/auth/login', {
    data: { email: 'legacy@example.com', password: legacyPassword },
  })
  const legacyLoginPayload = await legacyLoginResponse.json()
  const legacySessionCookie = (await legacyApi.storageState()).cookies.find((cookie) => cookie.name === 'linguashelf_session')
  if (!legacyLoginResponse.ok() || !legacySessionCookie?.value) throw new Error(`Legacy password login failed: ${JSON.stringify(legacyLoginPayload)}`)
  await legacyApi.dispose()
  const upgradedDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true })
  try {
    const upgradedUser = JSON.parse(upgradedDb.prepare("SELECT payload FROM records WHERE collection='users' AND id=?").get(legacyUserId).payload)
    const upgradedSession = JSON.parse(
      upgradedDb.prepare("SELECT payload FROM records WHERE collection='sessions' AND payload LIKE ? ORDER BY updatedAt DESC LIMIT 1").get(`%${legacyUserId}%`).payload
    )
    if (!String(upgradedUser.passwordHash || '').startsWith('pbkdf2-sha256$600000$')) throw new Error('Legacy password hash was not upgraded on login')
    if (upgradedSession.token || upgradedSession.tokenHash !== crypto.createHash('sha256').update(legacySessionCookie.value).digest('hex')) {
      throw new Error('Legacy-user session was not stored as a token hash')
    }
  } finally {
    upgradedDb.close()
  }

  const migrationContext = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await migrationContext.addInitScript((legacyToken) => {
    localStorage.setItem('linguashelf-token', legacyToken)
  }, legacySessionCookie.value)
  const migrationPage = await migrationContext.newPage()
  await migrationPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await migrationPage.getByRole('heading', { name: '首页' }).waitFor()
  const migratedLocalToken = await migrationPage.evaluate(() => localStorage.getItem('linguashelf-token'))
  const migratedCookie = (await migrationContext.cookies(baseUrl)).find((cookie) => cookie.name === 'linguashelf_session')
  if (migratedLocalToken || !migratedCookie?.httpOnly) throw new Error('Legacy localStorage session was not migrated to an HttpOnly cookie')
  await migrationContext.close()

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

  const invalidUploadResponse = await page.request.post(`${baseUrl}/api/books/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'invalid.epub',
        mimeType: 'application/epub+zip',
        buffer: Buffer.from('not an epub file'),
      },
    },
  })
  if (invalidUploadResponse.status() !== 400) {
    throw new Error(`Invalid EPUB returned HTTP ${invalidUploadResponse.status()} instead of 400`)
  }
  const uploadTempDir = path.join(dataDir, 'upload-tmp')
  await waitForUploadTempCleanup(uploadTempDir, 'Invalid upload')

  await page.locator('input[type="file"]').setInputFiles(epubPath)
  await page.getByText('E2E History Reader').waitFor({ timeout: 15000 })
  await waitForUploadTempCleanup(uploadTempDir, 'Successful EPUB upload')
  const uploadDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true })
  try {
    const storedBook = JSON.parse(
      uploadDb.prepare("SELECT payload FROM records WHERE collection='books' AND payload LIKE '%E2E History Reader%' LIMIT 1").get().payload
    )
    if (!storedBook.sourcePath || !(await fs.stat(storedBook.sourcePath)).isFile()) {
      throw new Error('Successful EPUB upload did not retain the configured source file')
    }
  } finally {
    uploadDb.close()
  }
  await page.screenshot({ path: path.join(screenshotDir, 'library-upload.png'), fullPage: true })

  const replanPdfResponse = await page.request.post(`${baseUrl}/api/books/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'e2e-replan.pdf',
        mimeType: 'application/pdf',
        buffer: makeTextPdf(),
      },
    },
  })
  const replanPdfPayload = await replanPdfResponse.json()
  if (!replanPdfResponse.ok() || !replanPdfPayload.book?.sourceRetained) {
    throw new Error(`Text PDF upload did not retain a replan source: ${replanPdfResponse.status()} ${JSON.stringify(replanPdfPayload)}`)
  }
  if ('sourcePath' in replanPdfPayload.book || 'userId' in replanPdfPayload.book || 'sourceTemporary' in replanPdfPayload.book) {
    throw new Error(`Public book payload exposed internal storage fields: ${JSON.stringify(replanPdfPayload.book)}`)
  }
  const legacyUnitCount = replaceBookUnitsWithLegacyFragments(replanPdfPayload.book.id)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '首页' }).waitFor()
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.locator('.book-card').filter({ hasText: 'e2e-replan' }).getByRole('button', { name: '打开' }).click()
  await page.getByRole('heading', { name: '学习单元' }).waitFor()
  let replanDialogText = ''
  page.once('dialog', async (dialog) => {
    replanDialogText = dialog.message()
    await dialog.accept()
  })
  const replanApplyResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes(`/api/books/${replanPdfPayload.book.id}/replan`) || response.request().method() !== 'POST') return false
    try {
      return response.request().postDataJSON()?.preview !== true
    } catch {
      return false
    }
  })
  await page.getByRole('button', { name: '重新规划单元' }).click()
  const replanApplyResponse = await replanApplyResponsePromise
  const replanApplyPayload = await replanApplyResponse.json()
  if (!replanApplyResponse.ok() || !replanApplyPayload.preview?.allowed) {
    throw new Error(`Safe unit replan failed: ${replanApplyResponse.status()} ${JSON.stringify(replanApplyPayload)}`)
  }
  if (!replanDialogText.includes(`当前：${legacyUnitCount} 个`) || !replanDialogText.includes('预计：')) {
    throw new Error(`Unit replan confirmation did not show before/after statistics: ${replanDialogText}`)
  }
  if (replanApplyPayload.units.length >= legacyUnitCount || replanApplyPayload.preview.proposed.average < 900) {
    throw new Error(`Unit replan did not merge legacy page fragments: ${JSON.stringify(replanApplyPayload.preview)}`)
  }
  if (replanApplyPayload.units.some((unit) => String(unit.sourceLocation).includes('C:/') || String(unit.sourceExcerpt).includes('C:/'))) {
    throw new Error('PDF production-tool paths leaked into replanned source locations or excerpts')
  }
  await page.getByText(`已将 ${legacyUnitCount} 个旧单元重新规划为 ${replanApplyPayload.units.length} 个新单元。`).waitFor()

  setTemporaryPodcastBlocker(replanPdfPayload.book.id, true)
  try {
    const blockedReplanResponse = await page.request.post(`${baseUrl}/api/books/${replanPdfPayload.book.id}/replan`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { preview: true },
    })
    const blockedReplanPayload = await blockedReplanResponse.json()
    if (!blockedReplanResponse.ok() || blockedReplanPayload.preview?.allowed || !blockedReplanPayload.preview?.blockers?.some((item) => item.includes('播客'))) {
      throw new Error(`Podcast data did not block unit replan: ${blockedReplanResponse.status()} ${JSON.stringify(blockedReplanPayload)}`)
    }
  } finally {
    setTemporaryPodcastBlocker(replanPdfPayload.book.id, false)
  }
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()

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
  const oldBookPodcast = {
    id: 'e2e-old-book-podcast',
    bookId: firstRaceBook.id,
    kind: 'preview',
    index: 1,
    title: 'Old book podcast',
    status: 'planned',
    sourceUnitIds: [],
    sourceWordCount: 100,
    lexile: 900,
    voice: 'Kore',
    audio: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const oldBookPodcastJob = {
    id: 'e2e-old-book-podcast-job',
    type: 'generate-podcast',
    status: 'running',
    podcastId: oldBookPodcast.id,
    bookId: firstRaceBook.id,
    progress: 20,
    message: 'Generating old book podcast',
    error: '',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  const retryPodcast = {
    ...oldBookPodcast,
    id: 'e2e-retry-podcast',
    title: 'Retry podcast',
  }
  const retryPodcastJob = {
    ...oldBookPodcastJob,
    id: 'e2e-retry-podcast-job',
    podcastId: retryPodcast.id,
  }
  let podcastGenerateCount = 0
  let retryPodcastPollCount = 0
  let oldBookPodcastPollCount = 0
  await page.route(`**/api/books/${firstRaceBook.id}/podcasts/generate`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    podcastGenerateCount += 1
    const podcast = podcastGenerateCount === 1 ? retryPodcast : oldBookPodcast
    const job = podcastGenerateCount === 1 ? retryPodcastJob : oldBookPodcastJob
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ podcasts: [podcast], jobs: [job], enqueued: 1 }),
    })
  })
  await page.route(`**/api/jobs/${retryPodcastJob.id}`, async (route) => {
    retryPodcastPollCount += 1
    if (retryPodcastPollCount === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary podcast poll failure' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: { ...retryPodcastJob, status: 'succeeded', progress: 100 },
        podcast: { ...retryPodcast, status: 'ready' },
      }),
    })
  })
  await page.route(`**/api/jobs/${oldBookPodcastJob.id}`, async (route) => {
    oldBookPodcastPollCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: oldBookPodcastJob, podcast: oldBookPodcast }),
    })
  })
  const retryPodcastGenerateResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/books/${firstRaceBook.id}/podcasts/generate`) && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: '生成下一集' }).click()
  await retryPodcastGenerateResponse
  for (let attempt = 0; attempt < 25 && retryPodcastPollCount < 2; attempt += 1) await page.waitForTimeout(200)
  if (retryPodcastPollCount < 2) throw new Error(`A transient podcast poll failure was not retried: ${retryPodcastPollCount} polls`)
  await page.getByRole('button', { name: '生成下一集' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('生成下一集'))
    return Boolean(button && !button.disabled)
  })
  const oldPodcastGenerateResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/books/${firstRaceBook.id}/podcasts/generate`) && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: '生成下一集' }).click()
  await oldPodcastGenerateResponse
  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.locator('.book-card').filter({ hasText: 'E2E Second Reader' }).getByRole('button', { name: '打开' }).click()
  await page.locator('.detail-head h1').filter({ hasText: 'E2E Second Reader' }).waitFor()
  await page.waitForTimeout(1800)
  if (oldBookPodcastPollCount !== 0) {
    throw new Error(`An old-book podcast poll continued after switching books: ${oldBookPodcastPollCount}`)
  }
  if (await page.getByText(oldBookPodcast.title).count()) throw new Error('An old-book podcast appeared on the newly opened book')
  await page.unroute(`**/api/books/${firstRaceBook.id}/podcasts/generate`)
  await page.unroute(`**/api/jobs/${retryPodcastJob.id}`)
  await page.unroute(`**/api/jobs/${oldBookPodcastJob.id}`)

  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
  await page.getByRole('heading', { name: '学习单元' }).waitFor()

  if (!(await page.getByRole('heading', { name: '学习单元' }).count())) {
    await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
    await page.getByRole('heading', { name: '学习单元' }).waitFor()
  }
  await page.screenshot({ path: path.join(screenshotDir, 'book-detail.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileBookMetrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (mobileBookMetrics.scrollWidth > mobileBookMetrics.width) {
    throw new Error(`Mobile book page overflows horizontally: ${JSON.stringify(mobileBookMetrics)}`)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'book-detail-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  const pollingSetup = await (
    await page.request.get(`${baseUrl}/api/books/${firstRaceBook.id}`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()
  const batchWatchJob = {
    id: 'e2e-batch-watch-job',
    type: 'generate-unit',
    status: 'running',
    bookId: firstRaceBook.id,
    progress: 20,
    message: 'Watching batch generation',
    error: '',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  let batchWatchPollCount = 0
  let unitPollFailureInjected = false
  await page.route(`**/api/books/${firstRaceBook.id}/pre-generate`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ book: pollingSetup.book, units: pollingSetup.units, jobs: [batchWatchJob], enqueued: 1 }),
    })
  })
  await page.route('**/api/jobs/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    if (route.request().url().endsWith(`/api/jobs/${batchWatchJob.id}`)) {
      batchWatchPollCount += 1
      if (batchWatchPollCount === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary batch poll failure' }) })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            ...batchWatchJob,
            status: batchWatchPollCount >= 3 ? 'succeeded' : 'running',
            progress: batchWatchPollCount >= 3 ? 100 : 60,
          },
        }),
      })
      return
    }
    if (!unitPollFailureInjected) {
      unitPollFailureInjected = true
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary unit poll failure' }) })
      return
    }
    await route.continue()
  })
  const preGenerateResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/books/${firstRaceBook.id}/pre-generate`) && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: '批量预生成' }).click()
  await preGenerateResponsePromise
  await page.locator('.unit-row').first().getByRole('button', { name: /^(学习|生成)$/ }).click()
  await page.getByRole('heading', { name: '分级阅读' }).waitFor({ timeout: 20000 })
  await page.getByRole('heading', { name: '听力预热' }).waitFor()
  for (let attempt = 0; attempt < 30 && batchWatchPollCount < 3; attempt += 1) await page.waitForTimeout(200)
  if (!unitPollFailureInjected) throw new Error('The unit-generation poll did not exercise the transient-failure retry path')
  if (batchWatchPollCount < 3) {
    throw new Error(`Starting a unit generation canceled the batch watcher or its retry: ${batchWatchPollCount} polls`)
  }
  await page.unroute(`**/api/books/${firstRaceBook.id}/pre-generate`)
  await page.unroute('**/api/jobs/*')
  await page.screenshot({ path: path.join(screenshotDir, 'study-generated.png'), fullPage: true })

  let unitAudioRequestCount = 0
  await page.route('**/api/units/*/audio*', async (route) => {
    unitAudioRequestCount += 1
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: makeSilentWav() })
  })
  const firstUnitAudioRequest = page.waitForRequest((request) => request.url().includes('/api/units/') && request.url().includes('/audio'))
  await page.locator('.listening-block').getByRole('button', { name: '播放' }).click()
  await firstUnitAudioRequest
  await page.locator('.focus-quality-notice').getByRole('button', { name: '查看' }).click()
  const faithfulRegenerateButton = page.getByRole('button', { name: '重新生成更忠实版本' })
  await faithfulRegenerateButton.click()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('重新生成更忠实版本'))
    return Boolean(button && !button.disabled)
  }, null, { timeout: 20000 })
  const secondUnitAudioRequest = page.waitForRequest((request) => request.url().includes('/api/units/') && request.url().includes('/audio'))
  await page.locator('.listening-block').getByRole('button', { name: '播放' }).click()
  await secondUnitAudioRequest
  if (unitAudioRequestCount < 2) throw new Error(`Regenerating a unit reused stale listening audio: ${unitAudioRequestCount} requests`)
  await page.unroute('**/api/units/*/audio*')

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
