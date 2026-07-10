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
  const epubPath = await makeEpub()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: '首页' }).waitFor()
  const token = await page.evaluate(() => localStorage.getItem('linguashelf-token'))
  if (!token) throw new Error('Login did not persist a session token')

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

  if (!(await page.getByRole('heading', { name: '学习单元' }).count())) {
    await page.locator('.book-card').filter({ hasText: 'E2E History Reader' }).getByRole('button', { name: '打开' }).click()
    await page.getByRole('heading', { name: '学习单元' }).waitFor()
  }
  await page.locator('.unit-row').first().getByRole('button', { name: /^(学习|生成)$/ }).click()
  await page.getByRole('heading', { name: '分级阅读' }).waitFor({ timeout: 20000 })
  await page.getByRole('heading', { name: '听力预热' }).waitFor()
  await page.screenshot({ path: path.join(screenshotDir, 'study-generated.png'), fullPage: true })

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
