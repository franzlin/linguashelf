import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const externalBaseUrl = process.env.BASE_URL || ''
const email = process.env.VISUAL_EMAIL || 'e2e@example.com'
const password = process.env.VISUAL_PASSWORD || 'reader12345'
const outputDir = path.join(root, 'work-screenshots', 'frontend-rebuild')

let server = null
let dataDir = ''
let serverOutput = ''
let baseUrl = externalBaseUrl

if (!baseUrl) {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-visual-'))
  const port = 6000 + Math.floor(Math.random() * 1000)
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server/index.js', '--prod'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      AI_PROVIDER: 'mock',
      ALLOW_SIGNUP: 'true',
      INITIAL_ADMIN_EMAIL: email,
      INITIAL_ADMIN_PASSWORD: password,
      PDF_OCR_ENABLED: 'false',
      STORAGE_DRIVER: 'sqlite',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!ready) throw new Error(`Visual-check server did not start.\n${serverOutput}`)
}

await fs.mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const consoleErrors = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(error.message))

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })

  if (await page.locator('input[type="email"]').count()) {
    await page.screenshot({ path: path.join(outputDir, 'login-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(outputDir, 'login-mobile-390.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: '登录 / 创建账号' }).click()
  }

  try {
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, 'login-failure.png'), fullPage: true })
    const formError = await page.locator('.form-error').textContent().catch(() => '')
    throw new Error(`无法进入应用外壳${formError ? `：${formError}` : ''}`, { cause: error })
  }
  // A fresh browser intentionally receives one unauthenticated /api/app response
  // before the login screen appears. Only audit console errors after login succeeds.
  consoleErrors.length = 0
  await page.screenshot({ path: path.join(outputDir, 'home-desktop.png'), fullPage: true })

  await page.locator('[data-nav-view="library"]').click()
  await page.locator('.upload-dropzone').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outputDir, 'library-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  await page.locator('[data-mobile-nav-view="library"]').click()
  await page.locator('.upload-dropzone').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outputDir, 'library-mobile-390.png'), fullPage: true })

  const viewportAudit = await page.evaluate(() => {
    const navButtons = [...document.querySelectorAll('.mobile-nav button')]
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mobileNavVisible: getComputedStyle(document.querySelector('.mobile-nav')).display !== 'none',
      smallestNavTarget: Math.min(...navButtons.map((button) => button.getBoundingClientRect().height)),
    }
  })

  if (viewportAudit.scrollWidth > viewportAudit.viewportWidth + 1) {
    throw new Error(`390px 页面发生横向溢出：${viewportAudit.scrollWidth}px > ${viewportAudit.viewportWidth}px`)
  }
  if (!viewportAudit.mobileNavVisible) throw new Error('390px 移动导航不可见')
  if (viewportAudit.smallestNavTarget < 44) throw new Error(`移动导航触控高度不足：${viewportAudit.smallestNavTarget}px`)

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('dialog', { name: '更多导航' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(220)
  await page.screenshot({ path: path.join(outputDir, 'mobile-more-navigation.png'), fullPage: false })
  await page.getByRole('dialog', { name: '更多导航' }).getByRole('button', { name: '设置' }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).first().waitFor({ state: 'visible' })

  if (consoleErrors.length) throw new Error(`浏览器控制台错误：\n${consoleErrors.join('\n')}`)

  console.log(`Visual check passed: ${JSON.stringify(viewportAudit)}`)
  console.log(`Screenshots: ${outputDir}`)
} finally {
  await browser.close()
  if (server) {
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
}
