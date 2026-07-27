// OCR for scanned PDFs: a vision model first, local Tesseract as the fallback.
//
// Runs behind a slot limiter because rendering pages to images and shipping them
// upstream is the most memory-hungry thing the server does.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  pdfOcrCommandTimeoutMs,
  pdfOcrDpi,
  pdfOcrEnabled,
  pdfOcrLanguage,
  pdfOcrMaxPages,
  pdfOcrProvider,
  pdfOcrVisionDpi,
  pdfOcrVisionMinWords,
} from './config.js'
import { fetchOcrService } from './http.js'
import { normalizeText, wordCount } from './text.js'
import { cleanPdfPages } from './pdf-text.js'
import { ocrVisionConfig } from './ai-runtime.js'

const execFileAsync = promisify(execFile)

export const ocrSlotWaiters = []

export let activeOcrTasks = 0

export async function withOcrSlot(task) {
  const maxConcurrent = Math.max(1, Number(process.env.MAX_ACTIVE_OCR_TASKS || 1))
  if (activeOcrTasks >= maxConcurrent) await new Promise((resolve) => ocrSlotWaiters.push(resolve))
  activeOcrTasks += 1
  try {
    return await task()
  } finally {
    activeOcrTasks -= 1
    ocrSlotWaiters.shift()?.()
  }
}

export function inferPdfPageCount(result) {
  const candidates = [
    result?.pages?.length,
    result?.total,
    result?.numpages,
    result?.numPages,
    result?.info?.Pages,
  ]
  const count = candidates.map((item) => Number(item)).find((item) => Number.isFinite(item) && item > 0)
  return Math.max(1, Math.round(count || 1))
}

export async function ocrPdfFallback(buffer, pageCount, onProgress = async () => undefined) {
  if (!pdfOcrEnabled) {
    throw new Error('这个 PDF 可能是扫描版或文字过少，当前服务器未开启 OCR')
  }
  const maxPages = Math.min(pageCount, pdfOcrMaxPages)
  const errors = []

  if (shouldUseVisionOcr()) {
    try {
      const pages = await ocrPdfPagesWithVision(buffer, maxPages, onProgress)
      const cleaned = cleanPdfPages(pages).filter((page) => page.wordCount >= pdfOcrVisionMinWords)
      if (hasEnoughOcrText(cleaned)) {
        console.info(`PDF OCR completed with ${ocrVisionConfig().model}: ${cleaned.length}/${maxPages} pages`)
        return { pages: cleaned, provider: ocrVisionConfig().model, pagesAttempted: maxPages }
      }
      const message = `${ocrVisionConfig().model} 识别正文不足`
      errors.push(message)
      console.warn(`PDF OCR ${message}; falling back to tesseract`)
    } catch (error) {
      const message = `${ocrVisionConfig().model} 失败：${String(error?.message || error).slice(0, 160)}`
      errors.push(message)
      console.warn(`PDF OCR ${message}; falling back to tesseract`)
    }
  }

  const pages = await ocrPdfPagesWithTesseract(buffer, maxPages, onProgress)
  const cleaned = cleanPdfPages(pages).filter((page) => page.wordCount >= 40)
  if (!hasEnoughOcrText(cleaned)) {
    const detail = errors.length ? `；${errors.join('；')}` : ''
    throw new Error(`OCR 没能识别出足够的英文正文，请确认 PDF 清晰、方向正确，且内容主要为英文${detail}`)
  }
  console.info(`PDF OCR completed with tesseract: ${cleaned.length}/${maxPages} pages`)
  return { pages: cleaned, provider: 'tesseract-ocr', pagesAttempted: maxPages }
}

export function hasEnoughOcrText(pages) {
  return pages.reduce((total, page) => total + Number(page.wordCount || wordCount(page.text)), 0) >= 120
}

export function shouldUseVisionOcr() {
  if (['tesseract', 'local', 'local-only'].includes(pdfOcrProvider)) return false
  const config = ocrVisionConfig()
  return Boolean(config.baseUrl && config.apiKey && config.model)
}

export async function ocrPdfPagesWithVision(buffer, maxPages, onProgress = async () => undefined) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-ocr-vision-'))
  const pdfPath = path.join(tmpDir, 'source.pdf')
  const pages = []
  try {
    await fs.writeFile(pdfPath, buffer)
    for (let page = 1; page <= maxPages; page += 1) {
      const imagePath = await renderPdfPage(pdfPath, tmpDir, page, pdfOcrVisionDpi)
      try {
        const text = normalizeOcrText(await runVisionOcr(imagePath))
        if (wordCount(text) >= 20) pages.push({ num: page, text })
      } finally {
        await fs.rm(imagePath, { force: true }).catch(() => undefined)
      }
      await onProgress({ provider: ocrVisionConfig().model, page, total: maxPages })
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
  return pages
}

export async function ocrPdfPagesWithTesseract(buffer, maxPages, onProgress = async () => undefined) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-ocr-'))
  const pdfPath = path.join(tmpDir, 'source.pdf')
  const pages = []
  try {
    await fs.writeFile(pdfPath, buffer)
    for (let page = 1; page <= maxPages; page += 1) {
      const imagePath = await renderPdfPage(pdfPath, tmpDir, page, pdfOcrDpi)
      try {
        const { stdout } = await runOcrCommand('tesseract', [imagePath, 'stdout', '-l', pdfOcrLanguage, '--psm', '3'])
        const text = normalizeOcrText(stdout)
        if (wordCount(text) >= 20) pages.push({ num: page, text })
      } finally {
        await fs.rm(imagePath, { force: true }).catch(() => undefined)
      }
      await onProgress({ provider: 'tesseract-ocr', page, total: maxPages })
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
  return pages
}

export async function renderPdfPage(pdfPath, tmpDir, page, dpi) {
  const prefix = path.join(tmpDir, `page-${String(page).padStart(4, '0')}`)
  const imagePath = `${prefix}.png`
  await runOcrCommand('pdftoppm', [
    '-f',
    String(page),
    '-l',
    String(page),
    '-r',
    String(dpi),
    '-png',
    '-singlefile',
    pdfPath,
    prefix,
  ])
  return imagePath
}

export async function runVisionOcr(imagePath) {
  const config = ocrVisionConfig()
  const imageBytes = await fs.readFile(imagePath)
  const response = await fetchOcrService(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Read every visible English word in this scanned book page. Include body paragraphs, not only headings. Preserve reading order as much as possible. Return plain OCR text only. Do not summarize, translate, or explain.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageBytes.toString('base64')}`,
              },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4000,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`视觉 OCR 请求失败：${response.status} ${text.slice(0, 240)}`)
  }

  const data = await response.json()
  return messageContentText(data?.choices?.[0]?.message?.content)
}

export function messageContentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : item?.text || item?.content || ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export async function runOcrCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      timeout: pdfOcrCommandTimeoutMs,
      maxBuffer: 12 * 1024 * 1024,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('服务器缺少 OCR 组件，请安装 poppler-utils 和 tesseract-ocr 后重试')
    }
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new Error('OCR 处理超时，请尝试页数更少或更清晰的 PDF')
    }
    const detail = String(error?.stderr || error?.message || '').trim()
    throw new Error(detail ? `OCR 处理失败：${detail.slice(0, 240)}` : 'OCR 处理失败')
  }
}

export function normalizeOcrText(text) {
  return normalizeText(
    String(text || '')
      .replace(/[|]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  )
}

export async function commandLooksAvailable(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 5000, maxBuffer: 1024 * 1024 })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    return Boolean(error?.stdout || error?.stderr)
  }
}
