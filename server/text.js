export function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
}

export function decodeEntities(value) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, token) => {
    if (token[0] === '#') {
      const number = token[1]?.toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10)
      return Number.isFinite(number) ? String.fromCodePoint(number) : ' '
    }
    return entities[token.toLowerCase()] || ' '
  })
}

export function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function wordCount(text) {
  return (String(text || '').match(/[A-Za-z][A-Za-z'-]*/g) || []).length
}

export function estimateTextTokens(text) {
  const value = String(text || '')
  return Math.max(1, Math.ceil(value.length / 4))
}

export function takeWords(text, maxWords) {
  const words = String(text || '').split(/\s+/)
  return words.slice(0, maxWords).join(' ')
}

export function extractHeading(html, fallback) {
  const match = String(html || '').match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
  if (match) return normalizeText(stripHtml(match[1])).slice(0, 120)
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title) return normalizeText(stripHtml(title[1])).slice(0, 120)
  return fallback
}

export function titleCase(value) {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function splitSentences(text) {
  return normalizeText(text)
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20)
}

export function cleanTitle(value, fallback = '') {
  const title = normalizeText(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,\-–—]+|[\s:;.,\-–—]+$/g, '')
    .slice(0, 140)
  return title || fallback
}

export const stopWords = new Set(
  'about after again against also among because before between could every first from have into more most other over people should some such than that their there these they this those through under very were when where which while will with would government political economic history historical society country countries state states world years'.split(
    ' ',
  ),
)


export function extractKeywords(text, count = 8) {
  const freq = new Map()
  const words = String(text || '').toLowerCase().match(/[a-z][a-z'-]{4,}/g) || []
  for (const raw of words) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (stopWords.has(word)) continue
    freq.set(word, (freq.get(word) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word)
}
