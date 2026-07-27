// EPUB parsing: container/OPF discovery, spine order, nav and NCX tables of
// contents, and section splitting.
//
// The zip reader enforces real expanded-size and entry-count limits so a zip
// bomb cannot exhaust the server before parsing starts.
import path from 'node:path'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { nanoid } from 'nanoid'
import { formatMegabytes, maxEpubEntries, maxEpubExpandedBytes } from './config.js'
import { asArray, cleanTitle, extractHeading, normalizeText, stripHtml, wordCount } from './text.js'

export function epubPath(baseDir, href = '') {
  const clean = String(href || '').split('#')[0]
  try {
    return path.posix.normalize(path.posix.join(baseDir, decodeURIComponent(clean)))
  } catch {
    return path.posix.normalize(path.posix.join(baseDir, clean))
  }
}

export function normalizedHref(value = '') {
  return path.posix.normalize(String(value || '').split('#')[0]).replace(/^\.?\//, '').toLowerCase()
}

export function cleanEpubHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|aside|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<([a-z0-9]+)(?=[^>]*(?:class|id|epub:type|role)\s*=\s*["'][^"']*(?:footnote|endnote|rearnote|noteref|pagebreak|pagenum|page-list|toc|contents|copyright|cover|bibliography|index)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi,
      ' '
    )
    .replace(/<span[^>]*(?:epub:type|role|class|id)\s*=\s*["'][^"']*(?:pagebreak|pagenum|noteref)[^"']*["'][^>]*\/?>/gi, ' ')
}

export function splitHtmlIntoSections(html, fallbackTitle) {
  const source = String(html || '')
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
  const headings = [...source.matchAll(headingRegex)].filter((match) => cleanTitle(stripHtml(match[2])).length > 1)
  if (headings.length <= 1) {
    return [{ title: cleanTitle(headings[0]?.[2] ? stripHtml(headings[0][2]) : fallbackTitle, fallbackTitle), html: source }]
  }

  const sections = []
  const intro = source.slice(0, headings[0].index)
  if (wordCount(stripHtml(intro)) >= 80) sections.push({ title: fallbackTitle, html: intro })

  headings.forEach((heading, index) => {
    const start = heading.index || 0
    const end = index + 1 < headings.length ? headings[index + 1].index || source.length : source.length
    const htmlSlice = source.slice(start, end)
    const title = cleanTitle(stripHtml(heading[2]), fallbackTitle)
    sections.push({ title, html: htmlSlice })
  })

  return sections
}

export function tocMapSet(map, href, title) {
  const cleanHref = normalizedHref(href)
  const clean = cleanTitle(title)
  if (!cleanHref || !clean) return
  if (!map.has(cleanHref)) map.set(cleanHref, clean)
}

export function parseNavToc(html, baseDir) {
  const map = new Map()
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(linkRegex)) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    tocMapSet(map, epubPath(baseDir, href), stripHtml(match[2]))
  }
  return map
}

export function walkNcxNavPoints(node, map, baseDir) {
  for (const point of asArray(node)) {
    const label = textValue(point?.navLabel?.text)
    const src = point?.content?.src
    if (src) tocMapSet(map, epubPath(baseDir, src), label)
    walkNcxNavPoints(point?.navPoint, map, baseDir)
  }
}

export async function buildEpubTocMap(zip, manifest, packageNode, opfPath, xmlParser) {
  const baseDir = path.posix.dirname(opfPath)
  const map = new Map()
  const navItem = manifest.find((item) => /\bnav\b/i.test(String(item.properties || ''))) || manifest.find((item) => /(?:^|\/)(nav|toc|contents)\.(x?html?)$/i.test(String(item.href || '')))
  if (navItem?.href) {
    const navPath = epubPath(baseDir, navItem.href)
    const navHtml = await zip.file(navPath)?.async('string')
    if (navHtml) {
      for (const [href, title] of parseNavToc(navHtml, baseDir)) map.set(href, title)
    }
  }

  const ncxId = packageNode?.spine?.toc
  const ncxItem = manifest.find((item) => item.id === ncxId) || manifest.find((item) => String(item['media-type'] || '').includes('dtbncx'))
  if (ncxItem?.href) {
    const ncxPath = epubPath(baseDir, ncxItem.href)
    const ncxXml = await zip.file(ncxPath)?.async('string')
    if (ncxXml) {
      const ncx = xmlParser.parse(ncxXml)
      walkNcxNavPoints(ncx?.ncx?.navMap?.navPoint, map, baseDir)
    }
  }

  return map
}

export function tocTitleForPath(tocMap, itemPath, fallback) {
  const normalized = normalizedHref(itemPath)
  if (tocMap.has(normalized)) return tocMap.get(normalized)
  const match = [...tocMap.entries()].find(([href]) => href === normalized || href.endsWith(`/${normalized}`) || normalized.endsWith(`/${href}`))
  return match?.[1] || fallback
}

export function isNonReadingEpubItem(item, title = '') {
  const haystack = `${item?.href || ''} ${item?.id || ''} ${item?.properties || ''} ${title}`.toLowerCase()
  return /\b(cover|nav|toc|contents|copyright|titlepage|title-page|dedication|acknowledg|dramatis|personae|review|bibliography|index|notes|footnotes|endnotes|illustration|illustrations|about-author)\b/.test(haystack)
}

export async function parseEpub(buffer, filename) {
  const zip = await JSZip.loadAsync(buffer)
  validateEpubZip(zip)
  const safeZip = createMeasuredZipReader(zip)
  const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  const containerXml = await readZipText(safeZip, 'META-INF/container.xml')
  if (!containerXml) throw new Error('EPUB 文件缺少 container.xml')

  const container = xmlParser.parse(containerXml)
  const rootFile = asArray(container?.container?.rootfiles?.rootfile)[0]
  const opfPath = rootFile?.['full-path']
  if (!opfPath) throw new Error('无法识别 EPUB 包结构')

  const opfXml = await readZipText(safeZip, opfPath)
  if (!opfXml) throw new Error('无法读取 EPUB 内容清单')

  const opf = xmlParser.parse(opfXml)
  const packageNode = opf.package
  const manifest = asArray(packageNode?.manifest?.item)
  const spine = asArray(packageNode?.spine?.itemref)
  const metadata = packageNode?.metadata || {}
  const baseDir = path.posix.dirname(opfPath)
  const title = textValue(metadata['dc:title']) || filename.replace(/\.[^.]+$/, '')
  const author = textValue(metadata['dc:creator']) || ''
  const tocMap = await buildEpubTocMap(safeZip, manifest, packageNode, opfPath, xmlParser)

  const chapters = []
  for (const ref of spine) {
    const item = manifest.find((candidate) => candidate.id === ref.idref)
    if (!item?.href || !String(item['media-type'] || '').includes('html')) continue

    const itemPath = epubPath(baseDir, item.href)
    const rawHtml = await readZipText(safeZip, itemPath)
    if (!rawHtml) continue

    const fallbackTitle = tocTitleForPath(tocMap, itemPath, extractHeading(rawHtml, `Chapter ${chapters.length + 1}`))
    if (isNonReadingEpubItem(item, fallbackTitle)) continue

    const cleanedHtml = cleanEpubHtml(rawHtml)
    const sections = splitHtmlIntoSections(cleanedHtml, fallbackTitle)
    for (const section of sections) {
      const text = normalizeText(stripHtml(section.html))
      if (wordCount(text) < 80) continue
      const sectionTitle = cleanTitle(section.title, fallbackTitle || `Chapter ${chapters.length + 1}`)
      if (isNonReadingEpubItem(item, sectionTitle) || looksLikeTableOfContents(text)) continue

      chapters.push({
        id: nanoid(),
        title: sectionTitle,
        text,
        label: item.href,
        wordCount: wordCount(text),
      })
    }
  }

  if (!chapters.length) throw new Error('未能从 EPUB 中提取足够的英文正文')
  return { title, author, type: 'epub', chapters }
}

export function validateEpubZip(zip) {
  const entries = Object.values(zip.files || {})
  if (entries.length > maxEpubEntries) throw new Error('EPUB 文件条目过多，暂不支持处理')
  for (const entry of entries) {
    if (entry.dir) continue
    const unsafeName = String(entry.name || '')
    if (unsafeName.includes('\0') || unsafeName.split('/').some((part) => part === '..')) {
      throw new Error('EPUB 文件包含不安全路径')
    }
  }
}

export function createMeasuredZipReader(zip) {
  let expandedBytes = 0
  return {
    file(name) {
      const entry = zip.file(name)
      if (!entry) return null
      return {
        async async(type) {
          const value = await entry.async(type)
          const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : Buffer.byteLength(value)
          expandedBytes += size
          if (expandedBytes > maxEpubExpandedBytes) throw new Error(`EPUB 解压后内容超过 ${formatMegabytes(maxEpubExpandedBytes)}`)
          return value
        },
      }
    },
  }
}

export async function readZipText(zip, name) {
  return zip.file(name)?.async('string')
}

export function textValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return textValue(value[0])
  if (typeof value === 'object') return value['#text'] || value.text || ''
  return ''
}

export function looksLikeTableOfContents(text) {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 6) return false
  const tocLike = lines.filter((line) => {
    if (/\.{3,}\s*\d{1,4}$/.test(line)) return true
    if (/^(chapter|part|book)\s+([ivxlcdm]+|\d+).{0,80}\s+\d{1,4}$/i.test(line)) return true
    if (/^[A-Z][A-Za-z' -]{3,80}\s+\d{1,4}$/.test(line) && wordCount(line) <= 10) return true
    return false
  }).length
  return tocLike >= Math.max(5, Math.ceil(lines.length * 0.35))
}
