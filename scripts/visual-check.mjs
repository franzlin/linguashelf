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
    const loginButtonHeight = await page
      .getByRole('button', { name: '登录 / 创建账号' })
      .evaluate((element) => element.getBoundingClientRect().height)
    if (loginButtonHeight < 44) throw new Error(`移动登录按钮触控高度不足：${loginButtonHeight}px`)
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

  const desktopRouteAudit = ['micro', 'dashboard', 'reports', 'vocabulary', 'tasks', 'services', 'admin', 'settings', 'home']
  for (const route of desktopRouteAudit) {
    await page.locator(`[data-nav-view="${route}"]`).click()
    await page.locator(`[data-nav-view="${route}"][aria-current="page"]`).waitFor({ state: 'visible' })
    await page.waitForTimeout(120)
    const contentLength = await page.locator('.workspace-content').evaluate((element) => element.textContent?.trim().length || 0)
    if (contentLength < 8) throw new Error(`页面 ${route} 未渲染有效内容`)
  }

  await page.locator('[data-nav-view="services"]').click()
  await page.getByRole('button', { name: /自定义 API/ }).click()
  const textConfigToggle = page.locator('.ai-config-card').first().locator('.ai-config-summary')
  await textConfigToggle.click()
  await page.locator('#text-baseUrl').waitFor({ state: 'visible' })
  const configAudit = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.ai-config-form input, .ai-config-form select, .ai-config-form textarea')]
    const keyInput = document.querySelector('#text-apiKey')
    return {
      fieldCount: inputs.length,
      smallestField: Math.min(...inputs.map((element) => element.getBoundingClientRect().height)),
      keyInputType: keyInput?.getAttribute('type') || '',
      keyInputValue: keyInput?.value ?? 'missing',
    }
  })
  if (configAudit.fieldCount < 6) throw new Error(`自定义 API 表单字段不足：${configAudit.fieldCount}`)
  if (configAudit.smallestField < 44) throw new Error(`自定义 API 表单控件高度不足：${configAudit.smallestField}px`)
  if (configAudit.keyInputType !== 'password') throw new Error('API key 输入框必须是 password 类型')
  if (configAudit.keyInputValue !== '') throw new Error('API key 输入框不能预填任何值')
  await page.screenshot({ path: path.join(outputDir, 'ai-config-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(160)
  const configMobileAudit = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.ai-config-form input, .ai-config-form select, .ai-config-form textarea')]
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      smallestField: Math.min(...inputs.map((element) => element.getBoundingClientRect().height)),
      widestField: Math.max(...inputs.map((element) => element.getBoundingClientRect().width)),
    }
  })
  if (configMobileAudit.scrollWidth > configMobileAudit.viewportWidth + 1) {
    throw new Error(`自定义 API 面板在 390px 横向溢出：${configMobileAudit.scrollWidth}px > ${configMobileAudit.viewportWidth}px`)
  }
  if (configMobileAudit.smallestField < 44) throw new Error(`390px 自定义 API 控件高度不足：${configMobileAudit.smallestField}px`)
  await page.screenshot({ path: path.join(outputDir, 'ai-config-mobile-390.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForTimeout(120)

  await page.locator('[data-nav-view="library"]').click()
  await page.locator('.upload-dropzone').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outputDir, 'library-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  await page.locator('[data-mobile-nav-view="library"]').click()
  await page.getByRole('button', { name: '导入书籍' }).waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outputDir, 'library-mobile-390.png'), fullPage: true })

  const viewportAudit = await page.evaluate(() => {
    const navButtons = [...document.querySelectorAll('.mobile-nav button')]
    const activeNavButton = document.querySelector('.mobile-nav button.active')
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mobileNavVisible: getComputedStyle(document.querySelector('.mobile-nav')).display !== 'none',
      smallestNavTarget: Math.min(...navButtons.map((button) => button.getBoundingClientRect().height)),
      activeMobileView: activeNavButton?.getAttribute('data-mobile-nav-view') || '',
    }
  })

  if (viewportAudit.scrollWidth > viewportAudit.viewportWidth + 1) {
    throw new Error(`390px 页面发生横向溢出：${viewportAudit.scrollWidth}px > ${viewportAudit.viewportWidth}px`)
  }
  if (!viewportAudit.mobileNavVisible) throw new Error('390px 移动导航不可见')
  if (viewportAudit.smallestNavTarget < 44) throw new Error(`移动导航触控高度不足：${viewportAudit.smallestNavTarget}px`)
  if (viewportAudit.activeMobileView !== 'library') throw new Error(`移动导航高亮与页面不一致：${viewportAudit.activeMobileView || '无高亮'} ≠ library`)

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('dialog', { name: '更多导航' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(220)
  await page.screenshot({ path: path.join(outputDir, 'mobile-more-navigation.png'), fullPage: false })
  await page.getByRole('dialog', { name: '更多导航' }).getByRole('button', { name: '设置' }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).first().waitFor({ state: 'visible' })

  if (consoleErrors.length) throw new Error(`浏览器控制台错误：\n${consoleErrors.join('\n')}`)

  console.log(`Visual check passed: ${JSON.stringify({ ...viewportAudit, auditedDesktopRoutes: desktopRouteAudit.length + 1 })}`)
  console.log(`Screenshots: ${outputDir}`)
} finally {
  await browser.close()
  if (server) {
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
}
