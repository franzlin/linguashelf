import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL || 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /登录/ }).click()
await page.getByRole('heading', { name: '首页' }).waitFor()
await page.screenshot({ path: 'work-screenshots/desktop-home.png', fullPage: true })
await page.getByLabel('主导航').getByRole('button', { name: '书库' }).click()
await page.getByRole('heading', { name: '我的书库' }).waitFor()
await page.screenshot({ path: 'work-screenshots/desktop-library.png', fullPage: true })

const firstBook = page.locator('.book-card').first()
await firstBook.getByRole('button', { name: '打开' }).click()
await page.getByRole('heading', { name: '学习单元' }).waitFor()
await page.locator('.unit-row').first().getByRole('button', { name: /^(学习|生成)$/ }).click()
await page.getByRole('heading', { name: '分级阅读' }).waitFor()
await page.screenshot({ path: 'work-screenshots/desktop-study.png', fullPage: true })

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: '首页' }).waitFor()
await page.screenshot({ path: 'work-screenshots/mobile-home.png', fullPage: true })
await page.getByLabel('移动端导航').getByRole('button', { name: '书库' }).click()
await page.getByRole('heading', { name: '我的书库' }).waitFor()
await page.screenshot({ path: 'work-screenshots/mobile-library.png', fullPage: true })

await browser.close()
