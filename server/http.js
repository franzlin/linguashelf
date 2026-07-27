// Upstream HTTP helpers and small file-type predicates.
//
// Every outbound AI call goes through one of the fetch* wrappers so timeouts are
// classified consistently and surface to the user as "请求超时" rather than a
// generic network error.
import path from 'node:path'
import JSZip from 'jszip'
import { aiTextRequestTimeoutMs, ocrHttpRequestTimeoutMs, ttsRequestTimeoutMs } from './config.js'
import { normalizeText } from './text.js'

export function openAiCompatibleBaseUrl(value) {
  const base = String(value || '').replace(/\/+$/, '')
  if (!base) return ''
  return base.endsWith('/v1') ? base : `${base}/v1`
}

export async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`${label}请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
      timeoutError.code = 'UPSTREAM_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function fetchTextService(url, options) {
  return fetchWithTimeout(url, options, aiTextRequestTimeoutMs, 'AI 文本服务')
}

export function fetchTtsService(url, options) {
  return fetchWithTimeout(url, options, ttsRequestTimeoutMs, 'TTS 服务')
}

export function fetchOcrService(url, options) {
  return fetchWithTimeout(url, options, ocrHttpRequestTimeoutMs, 'OCR 服务')
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0))
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function isPdfFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
}

export async function isEpubFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false
  if (buffer.subarray(0, 4).toString('binary') !== 'PK\u0003\u0004') return false
  try {
    const zip = await JSZip.loadAsync(buffer)
    const names = Object.keys(zip.files || {})
    if (!names.length) return false
    const mimetype = await zip.file('mimetype')?.async('string').catch(() => '')
    if (mimetype && normalizeText(mimetype) !== 'application/epub+zip') return false
    const container = await zip.file('META-INF/container.xml')?.async('string').catch(() => '')
    if (!container || !/<rootfile\b/i.test(container) || !/full-path\s*=/i.test(container)) return false
    return names.some((name) => /\.opf$/i.test(name))
  } catch {
    return false
  }
}
