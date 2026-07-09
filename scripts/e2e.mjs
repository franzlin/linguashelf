import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

async function makeEpub() {
  const file = path.join(dataDir, 'e2e-sample.epub')
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
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E History Reader</dc:title><dc:creator>LinguaShelf Test</dc:creator><dc:language>en</dc:language><dc:identifier id="bookid">e2e</dc:identifier></metadata>
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
  const epubPath = await makeEpub()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: '首页' }).waitFor()

  await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
  await page.getByRole('heading', { name: '我的书库' }).waitFor()
  await page.locator('input[type="file"]').setInputFiles(epubPath)
  await page.getByText('E2E History Reader').waitFor({ timeout: 15000 })
  await page.screenshot({ path: path.join(screenshotDir, 'library-upload.png'), fullPage: true })

  if (!(await page.getByRole('heading', { name: '学习单元' }).count())) {
    await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
    await page.getByRole('heading', { name: '学习单元' }).waitFor()
  }
  await page.locator('.unit-row').first().getByRole('button', { name: /^(学习|生成)$/ }).click()
  await page.getByRole('heading', { name: '分级阅读' }).waitFor({ timeout: 20000 })
  await page.getByRole('heading', { name: '听力预热' }).waitFor()
  await page.screenshot({ path: path.join(screenshotDir, 'study-generated.png'), fullPage: true })

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
