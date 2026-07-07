import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { PDFParse } from 'pdf-parse'
import { nanoid } from 'nanoid'
import lamejs from '@breezystack/lamejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data')
const uploadDir = path.join(dataDir, 'uploads')
const audioDir = path.join(dataDir, 'audio')
const dbPath = path.join(dataDir, 'db.json')
const sqlitePath = path.join(dataDir, 'app.sqlite')
const storageDriver = String(process.env.STORAGE_DRIVER || 'sqlite').toLowerCase()
const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5173)
const signupInviteCode = String(process.env.SIGNUP_INVITE_CODE || '')
const allowSignup = parseBoolean(process.env.ALLOW_SIGNUP, !isProd)
const sessionDays = Number(process.env.SESSION_DAYS || 30)
const loginWindowMs = Number(process.env.LOGIN_WINDOW_MINUTES || 10) * 60 * 1000
const loginMaxFailures = Number(process.env.LOGIN_MAX_FAILURES || 8)
const maxAutoRegenAttempts = Number(process.env.MAX_AUTO_REGEN_ATTEMPTS || 1)
const maxUploadBytes = bytesFromMegabytes(process.env.MAX_UPLOAD_MB, 50)
const maxEpubUploadBytes = bytesFromMegabytes(process.env.MAX_EPUB_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))
const maxPdfUploadBytes = bytesFromMegabytes(process.env.MAX_PDF_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))
const maxEpubExpandedBytes = bytesFromMegabytes(process.env.MAX_EPUB_EXPANDED_MB, 200)
const maxEpubEntries = Number(process.env.MAX_EPUB_ENTRIES || 2000)
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 60) * 60 * 1000
const podcastLexileDefault = Number(process.env.PODCAST_LEXILE_DEFAULT || 900)
const podcastLexileMin = 500
const podcastLexileMax = 1500
const maxPodcastEpisodes = Number(process.env.MAX_PODCAST_EPISODES || 12)
const maxActivePodcastJobs = Number(process.env.MAX_ACTIVE_PODCAST_JOBS || 2)
const podcastTtsChunkChars = Number(process.env.PODCAST_TTS_CHUNK_CHARS || 2500)
const podcastTtsConcurrency = Number(process.env.PODCAST_TTS_CONCURRENCY || 2)
const podcastAudioFormat = String(process.env.PODCAST_AUDIO_FORMAT || 'mp3').toLowerCase()
const podcastMp3Kbps = Number(process.env.PODCAST_MP3_KBPS || 64)
const podcastScriptSourceChunkWords = Number(process.env.PODCAST_SCRIPT_SOURCE_CHUNK_WORDS || 2600)
const podcastKindOrder = ['preview', 'review', 'topic', 'walkthrough']
const podcastKindLabels = {
  preview: '读前导入',
  review: '读后复盘',
  topic: '全书专题',
  walkthrough: '全书分集讲解',
}
const aiRateLimits = {
  'generate-unit': { max: Number(process.env.RATE_LIMIT_GENERATE_UNITS_MAX || 20), windowMs: rateLimitWindowMs },
  'define-word': { max: Number(process.env.RATE_LIMIT_DEFINITIONS_MAX || 120), windowMs: rateLimitWindowMs },
  'speech-audio': { max: Number(process.env.RATE_LIMIT_AUDIO_MAX || 30), windowMs: rateLimitWindowMs },
  'generate-podcast': { max: Number(process.env.RATE_LIMIT_PODCAST_EPISODES_MAX || 12), windowMs: rateLimitWindowMs },
}
const loginAttempts = new Map()
const actionRateBuckets = new Map()
const dbSnapshotMeta = Symbol('dbSnapshotMeta')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
})

const defaultDb = {
  users: [],
  sessions: [],
  books: [],
  units: [],
  reports: [],
  progress: [],
  vocabulary: [],
  definitions: [],
  settings: [],
  jobs: [],
  podcasts: [],
}

let sqliteDb = null

async function ensureStore() {
  await fs.mkdir(uploadDir, { recursive: true })
  await fs.mkdir(audioDir, { recursive: true })

  if (storageDriver === 'sqlite') {
    const db = await openSqlite()
    const initialized = db.prepare("SELECT value FROM meta WHERE key = 'initialized'").get()
    if (!initialized) {
      const imported = await readJsonSnapshotIfPresent()
      writeSqliteSnapshot(imported || defaultDb)
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('initialized', ?)").run(new Date().toISOString())
    }
    return
  }

  try {
    await fs.access(dbPath)
  } catch {
    await writeJsonSnapshot(defaultDb)
  }
}

async function readDb() {
  await ensureStore()
  if (storageDriver === 'sqlite') return readSqliteSnapshot()
  const raw = await fs.readFile(dbPath, 'utf8')
  return normalizeDb(JSON.parse(raw))
}

async function writeDb(db) {
  if (storageDriver === 'sqlite') {
    await ensureStore()
    writeSqliteChanges(db)
    return
  }
  await writeJsonSnapshot(db)
}

async function writeJsonSnapshot(db) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(dbPath, JSON.stringify(normalizeDb(db), null, 2), 'utf8')
}

async function readJsonSnapshotIfPresent() {
  try {
    const raw = await fs.readFile(dbPath, 'utf8')
    return normalizeDb(JSON.parse(raw))
  } catch {
    return null
  }
}

function normalizeDb(db) {
  const next = {}
  for (const key of Object.keys(defaultDb)) {
    next[key] = Array.isArray(db?.[key]) ? db[key] : []
  }
  return next
}

async function openSqlite() {
  if (sqliteDb) return sqliteDb
  await fs.mkdir(dataDir, { recursive: true })
  const { DatabaseSync } = await import('node:sqlite')
  sqliteDb = new DatabaseSync(sqlitePath)
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS records_collection_idx ON records (collection);
  `)
  return sqliteDb
}

function readSqliteSnapshot() {
  const output = normalizeDb({})
  const meta = createSnapshotMeta()
  const rows = sqliteDb.prepare('SELECT collection, id, payload FROM records ORDER BY collection, rowid').all()
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(output, row.collection)) continue
    meta.records.get(row.collection).set(row.id, row.payload)
    output[row.collection].push(JSON.parse(row.payload))
  }
  attachSnapshotMeta(output, meta)
  return output
}

function writeSqliteSnapshot(db) {
  const snapshot = normalizeDb(db)
  const now = new Date().toISOString()
  const insert = sqliteDb.prepare('INSERT INTO records (collection, id, payload, updatedAt) VALUES (?, ?, ?, ?)')
  sqliteDb.exec('BEGIN IMMEDIATE')
  try {
    sqliteDb.prepare('DELETE FROM records').run()
    for (const [collection, items] of Object.entries(snapshot)) {
      items.forEach((item, index) => {
        insert.run(collection, recordId(collection, item, index), JSON.stringify(item), now)
      })
    }
    sqliteDb.exec('COMMIT')
  } catch (error) {
    sqliteDb.exec('ROLLBACK')
    throw error
  }
}

function writeSqliteChanges(db) {
  const snapshot = normalizeDb(db)
  const meta = db?.[dbSnapshotMeta]
  if (!meta?.records) {
    writeSqliteSnapshot(snapshot)
    return
  }

  const now = new Date().toISOString()
  const upsert = sqliteDb.prepare(`
    INSERT INTO records (collection, id, payload, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET
      payload = excluded.payload,
      updatedAt = excluded.updatedAt
  `)
  const remove = sqliteDb.prepare('DELETE FROM records WHERE collection = ? AND id = ?')
  sqliteDb.exec('BEGIN IMMEDIATE')
  try {
    for (const [collection, items] of Object.entries(snapshot)) {
      const original = meta.records.get(collection) || new Map()
      const currentIds = new Set()
      items.forEach((item, index) => {
        const id = recordId(collection, item, index)
        const payload = JSON.stringify(item)
        currentIds.add(id)
        if (original.get(id) !== payload) upsert.run(collection, id, payload, now)
      })
      for (const id of original.keys()) {
        if (!currentIds.has(id)) remove.run(collection, id)
      }
    }
    sqliteDb.exec('COMMIT')
    attachSnapshotMeta(db, buildSnapshotMeta(snapshot))
  } catch (error) {
    sqliteDb.exec('ROLLBACK')
    throw error
  }
}

function createSnapshotMeta() {
  const records = new Map()
  for (const collection of Object.keys(defaultDb)) records.set(collection, new Map())
  return { records }
}

function buildSnapshotMeta(snapshot) {
  const meta = createSnapshotMeta()
  for (const [collection, items] of Object.entries(normalizeDb(snapshot))) {
    items.forEach((item, index) => {
      meta.records.get(collection).set(recordId(collection, item, index), JSON.stringify(item))
    })
  }
  return meta
}

function attachSnapshotMeta(db, meta) {
  Object.defineProperty(db, dbSnapshotMeta, {
    value: meta,
    enumerable: false,
    configurable: true,
  })
}

function recordId(collection, item, index) {
  if (item?.id) return String(item.id)
  if (collection === 'sessions' && item?.token) return String(item.token)
  if (collection === 'settings' && item?.userId) return String(item.userId)
  if (collection === 'progress' && item?.userId && item?.unitId) return progressKey(item.userId, item.unitId)
  if (collection === 'definitions' && item?.key) return `${item.userId || 'global'}:${item.key}`
  return `${collection}:${index}`
}

async function storageHealth() {
  await ensureStore()
  const db = await readDb()
  return {
    ok: true,
    storageDriver,
    sqlite: storageDriver === 'sqlite',
    books: db.books.length,
    units: db.units.length,
    jobs: db.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length,
  }
}

function closeStore() {
  if (!sqliteDb) return
  sqliteDb.close()
  sqliteDb = null
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function bytesFromMegabytes(value, fallbackMb) {
  const mb = Number(value)
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb
  return Math.round(safeMb * 1024 * 1024)
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function sessionExpiresAt(session) {
  if (session.expiresAt) return Date.parse(session.expiresAt)
  return Date.parse(session.createdAt || '') + sessionDays * 24 * 60 * 60 * 1000
}

function isSessionExpired(session) {
  return Number.isFinite(sessionExpiresAt(session)) && sessionExpiresAt(session) <= Date.now()
}

function loginAttemptKey(req, email) {
  return `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`
}

function loginLimitStatus(req, email) {
  const key = loginAttemptKey(req, email)
  const now = Date.now()
  const attempt = loginAttempts.get(key)
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(key)
    return { limited: false, key, remaining: loginMaxFailures }
  }
  return {
    limited: attempt.count >= loginMaxFailures,
    key,
    remaining: Math.max(0, loginMaxFailures - attempt.count),
    resetAt: attempt.resetAt,
  }
}

function recordLoginFailure(key) {
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs })
    return
  }
  current.count += 1
}

function clearLoginFailures(key) {
  loginAttempts.delete(key)
}

function cleanupExpiredLoginAttempts(now = Date.now()) {
  for (const [key, attempt] of loginAttempts) {
    if (!attempt?.resetAt || attempt.resetAt <= now) loginAttempts.delete(key)
  }
}

function cleanupRateLimitBuckets(now = Date.now()) {
  for (const [key, bucket] of actionRateBuckets) {
    if (!bucket?.resetAt || bucket.resetAt <= now) actionRateBuckets.delete(key)
  }
}

async function cleanupExpiredSessions() {
  const db = await readDb()
  const before = db.sessions.length
  db.sessions = db.sessions.filter((session) => !isSessionExpired(session))
  if (db.sessions.length !== before) await writeDb(db)
}

function rateLimitKey(userId, action) {
  return `${action}:${userId}`
}

function applyRateLimitHeaders(res, limit, bucket) {
  res.setHeader('X-RateLimit-Limit', String(limit.max))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit.max - bucket.count)))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))
}

function consumeUserQuota(req, res, action, cost = 1) {
  const limit = aiRateLimits[action]
  if (!limit || limit.max <= 0 || cost <= 0) return true

  const now = Date.now()
  cleanupRateLimitBuckets(now)
  const key = rateLimitKey(req.user.id, action)
  let bucket = actionRateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + limit.windowMs }
    actionRateBuckets.set(key, bucket)
  }

  if (bucket.count + cost > limit.max) {
    applyRateLimitHeaders(res, limit, bucket)
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
    res.status(429).json({ error: '操作太频繁，请稍后再试' })
    return false
  }

  bucket.count += cost
  applyRateLimitHeaders(res, limit, bucket)
  return true
}

function shouldRateLimitAiText() {
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(process.env.OPENAI_API_KEY)
}

function shouldRateLimitSpeech() {
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY)
}

function shouldRateLimitPodcast() {
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_TTS_API_KEY)
}

function canCreateUser(inviteCode) {
  if (signupInviteCode) return inviteCode === signupInviteCode
  return allowSignup
}

async function ensureInitialAdmin() {
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '')
  if (!email || !password) return

  const db = await readDb()
  if (db.users.some((user) => user.email === email)) return
  db.users.push({
    id: nanoid(),
    email,
    name: email.split('@')[0] || 'Admin',
    passwordHash: hashPassword(password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  })
  userSettings(db, db.users[db.users.length - 1].id)
  await writeDb(db)
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  const candidate = hashPassword(password, salt).split(':')[1]
  const expected = Buffer.from(hash, 'hex')
  const actual = Buffer.from(candidate, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected)
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  }
}

async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: '需要登录' })
    return
  }

  const db = await readDb()
  const session = db.sessions.find((item) => item.token === token)
  const user = session ? db.users.find((item) => item.id === session.userId) : null
  if (!session || !user) {
    res.status(401).json({ error: '登录已失效' })
    return
  }
  if (isSessionExpired(session)) {
    db.sessions = db.sessions.filter((item) => item.token !== token)
    await writeDb(db)
    res.status(401).json({ error: '登录已过期，请重新登录' })
    return
  }

  req.user = user
  req.token = token
  req.db = db
  next()
}

function userSettings(db, userId) {
  let settings = db.settings.find((item) => item.userId === userId)
  if (!settings) {
    settings = {
      userId,
      readingLevel: 'A2+',
      listeningLevel: 'A2',
      studyMinutes: 10,
      chineseAssist: 'click',
      aiSuggestions: true,
      keepSourceFiles: true,
      podcastLexile: podcastLexileDefault,
      podcastVoice: process.env.GEMINI_TTS_VOICE || 'Kore',
    }
    db.settings.push(settings)
  }
  if (!settings.podcastLexile) settings.podcastLexile = podcastLexileDefault
  if (!settings.podcastVoice) settings.podcastVoice = process.env.GEMINI_TTS_VOICE || 'Kore'
  settings.readingLevel = normalizeLevel(readingLevels, settings.readingLevel, 'A2+')
  settings.listeningLevel = normalizeLevel(listeningLevels, settings.listeningLevel, 'A2')
  settings.podcastLexile = Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault)))
  return settings
}

function normalizePodcastKind(value) {
  const kind = String(value || '').trim().toLowerCase()
  if (podcastKindOrder.includes(kind)) return kind
  if (['intro', 'before', 'pre-reading', 'prereading'].includes(kind)) return 'preview'
  if (['recap', 'after', 'post-reading', 'postreading'].includes(kind)) return 'review'
  if (['full', 'theme', 'thematic'].includes(kind)) return 'topic'
  return 'walkthrough'
}

function podcastKindLabel(kind) {
  return podcastKindLabels[normalizePodcastKind(kind)] || podcastKindLabels.walkthrough
}

function sortPodcasts(a, b) {
  const kindDiff = podcastKindOrder.indexOf(normalizePodcastKind(a.kind)) - podcastKindOrder.indexOf(normalizePodcastKind(b.kind))
  if (kindDiff) return kindDiff
  return Number(a.index || 0) - Number(b.index || 0)
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripHtml(html) {
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

function decodeEntities(value) {
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

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function wordCount(text) {
  return (String(text || '').match(/[A-Za-z][A-Za-z'-]*/g) || []).length
}

function takeWords(text, maxWords) {
  const words = String(text || '').split(/\s+/)
  return words.slice(0, maxWords).join(' ')
}

function extractHeading(html, fallback) {
  const match = String(html || '').match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
  if (match) return normalizeText(stripHtml(match[1])).slice(0, 120)
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title) return normalizeText(stripHtml(title[1])).slice(0, 120)
  return fallback
}

function cleanTitle(value, fallback = '') {
  const title = normalizeText(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,\-–—]+|[\s:;.,\-–—]+$/g, '')
    .slice(0, 140)
  return title || fallback
}

function epubPath(baseDir, href = '') {
  const clean = String(href || '').split('#')[0]
  try {
    return path.posix.normalize(path.posix.join(baseDir, decodeURIComponent(clean)))
  } catch {
    return path.posix.normalize(path.posix.join(baseDir, clean))
  }
}

function normalizedHref(value = '') {
  return path.posix.normalize(String(value || '').split('#')[0]).replace(/^\.?\//, '').toLowerCase()
}

function cleanEpubHtml(html) {
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

function splitHtmlIntoSections(html, fallbackTitle) {
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

function tocMapSet(map, href, title) {
  const cleanHref = normalizedHref(href)
  const clean = cleanTitle(title)
  if (!cleanHref || !clean) return
  if (!map.has(cleanHref)) map.set(cleanHref, clean)
}

function parseNavToc(html, baseDir) {
  const map = new Map()
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(linkRegex)) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    tocMapSet(map, epubPath(baseDir, href), stripHtml(match[2]))
  }
  return map
}

function walkNcxNavPoints(node, map, baseDir) {
  for (const point of asArray(node)) {
    const label = textValue(point?.navLabel?.text)
    const src = point?.content?.src
    if (src) tocMapSet(map, epubPath(baseDir, src), label)
    walkNcxNavPoints(point?.navPoint, map, baseDir)
  }
}

async function buildEpubTocMap(zip, manifest, packageNode, opfPath, xmlParser) {
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

function tocTitleForPath(tocMap, itemPath, fallback) {
  const normalized = normalizedHref(itemPath)
  if (tocMap.has(normalized)) return tocMap.get(normalized)
  const match = [...tocMap.entries()].find(([href]) => href === normalized || href.endsWith(`/${normalized}`) || normalized.endsWith(`/${href}`))
  return match?.[1] || fallback
}

function isNonReadingEpubItem(item, title = '') {
  const haystack = `${item?.href || ''} ${item?.id || ''} ${item?.properties || ''} ${title}`.toLowerCase()
  return /\b(cover|nav|toc|contents|copyright|titlepage|title-page|dedication|acknowledg|dramatis|personae|review|bibliography|index|notes|footnotes|endnotes|illustration|illustrations|about-author)\b/.test(haystack)
}

async function parseEpub(buffer, filename) {
  const zip = await JSZip.loadAsync(buffer)
  validateEpubZip(zip)
  const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('EPUB 文件缺少 container.xml')

  const container = xmlParser.parse(containerXml)
  const rootFile = asArray(container?.container?.rootfiles?.rootfile)[0]
  const opfPath = rootFile?.['full-path']
  if (!opfPath) throw new Error('无法识别 EPUB 包结构')

  const opfXml = await zip.file(opfPath)?.async('string')
  if (!opfXml) throw new Error('无法读取 EPUB 内容清单')

  const opf = xmlParser.parse(opfXml)
  const packageNode = opf.package
  const manifest = asArray(packageNode?.manifest?.item)
  const spine = asArray(packageNode?.spine?.itemref)
  const metadata = packageNode?.metadata || {}
  const baseDir = path.posix.dirname(opfPath)
  const title = textValue(metadata['dc:title']) || filename.replace(/\.[^.]+$/, '')
  const author = textValue(metadata['dc:creator']) || ''
  const tocMap = await buildEpubTocMap(zip, manifest, packageNode, opfPath, xmlParser)

  const chapters = []
  for (const ref of spine) {
    const item = manifest.find((candidate) => candidate.id === ref.idref)
    if (!item?.href || !String(item['media-type'] || '').includes('html')) continue

    const itemPath = epubPath(baseDir, item.href)
    const rawHtml = await zip.file(itemPath)?.async('string')
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

function validateEpubZip(zip) {
  const entries = Object.values(zip.files || {})
  if (entries.length > maxEpubEntries) throw new Error('EPUB 文件条目过多，暂不支持处理')

  let expandedBytes = 0
  for (const entry of entries) {
    if (entry.dir) continue
    expandedBytes += Number(entry?._data?.uncompressedSize || 0)
    if (expandedBytes > maxEpubExpandedBytes) throw new Error(`EPUB 解压后内容超过 ${formatMegabytes(maxEpubExpandedBytes)}`)
  }
}

function textValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return textValue(value[0])
  if (typeof value === 'object') return value['#text'] || value.text || ''
  return ''
}

function normalizePdfLine(line) {
  return String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function pdfLineFingerprint(line) {
  return normalizePdfLine(line)
    .replace(/^\d+\s+|\s+\d+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function isLikelyPageNumber(line) {
  const value = normalizePdfLine(line)
  return /^\d{1,4}$/.test(value) || /^[ivxlcdm]{1,8}$/i.test(value) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(value)
}

function isPdfChapterHeading(line) {
  const value = normalizePdfLine(line)
  if (!value || value.length > 120 || wordCount(value) > 14) return false
  if (/^(chapter|part|book)\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(value)) return true
  if (/^\d{1,2}\s*[\.:–—-]\s+[A-Z][A-Za-z]/.test(value)) return true
  if (/^(introduction|prologue|epilogue|conclusion|afterword|preface|acknowledg(e)?ments|notes|bibliography|index)\b/i.test(value)) return true
  const letters = value.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 8 && letters === letters.toUpperCase() && wordCount(value) >= 2 && !/[.!?]$/.test(value)) return true
  return false
}

function cleanPdfHeading(line, fallback) {
  return cleanTitle(
    normalizePdfLine(line)
      .replace(/\s{2,}/g, ' ')
      .replace(/^chapter\s+/i, 'Chapter '),
    fallback
  )
}

function collectRepeatedPdfLines(pages) {
  const counts = new Map()
  for (const page of pages) {
    const seen = new Set()
    for (const line of page.lines) {
      if (isLikelyPageNumber(line) || isPdfChapterHeading(line)) continue
      const fingerprint = pdfLineFingerprint(line)
      if (!fingerprint || fingerprint.length < 4 || fingerprint.length > 90) continue
      if (wordCount(fingerprint) > 12) continue
      seen.add(fingerprint)
    }
    for (const fingerprint of seen) counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1)
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.25))
  return new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line))
}

function cleanPdfPages(resultPages) {
  const pages = resultPages.map((page) => ({
    id: nanoid(),
    page: page.num,
    lines: String(page.text || '')
      .replace(/\r/g, '\n')
      .split(/\n+/)
      .map(normalizePdfLine)
      .filter(Boolean),
  }))
  const repeated = collectRepeatedPdfLines(pages)

  return pages.map((page) => {
    const lines = page.lines.filter((line) => {
      if (isLikelyPageNumber(line)) return false
      const fingerprint = pdfLineFingerprint(line)
      if (repeated.has(fingerprint) && !isPdfChapterHeading(line)) return false
      return true
    })
    const text = pdfLinesToText(lines)
    return {
      ...page,
      lines,
      title: `Pages ${page.page}`,
      text,
      label: `Page ${page.page}`,
      wordCount: wordCount(text),
    }
  })
}

function pdfLinesToText(lines) {
  const paragraphs = []
  let current = ''

  function flush() {
    const clean = normalizeText(current)
    if (clean) paragraphs.push(clean)
    current = ''
  }

  for (const line of lines) {
    if (isPdfChapterHeading(line)) {
      flush()
      paragraphs.push(cleanPdfHeading(line, line))
      continue
    }
    current = current ? `${current} ${line}` : line
    if (/[.!?]["')\]]?$/.test(line) && wordCount(current) >= 28) flush()
  }
  flush()

  return normalizeText(paragraphs.join('\n\n'))
}

function splitPdfPageIntoSections(page) {
  const sections = []
  let currentTitle = ''
  let currentLines = []

  function flush() {
    const text = pdfLinesToText(currentLines)
    if (wordCount(text) || currentTitle) {
      sections.push({
        title: currentTitle,
        text,
        page: page.page,
      })
    }
    currentTitle = ''
    currentLines = []
  }

  for (const line of page.lines) {
    if (isPdfChapterHeading(line)) {
      flush()
      currentTitle = cleanPdfHeading(line, `Pages ${page.page}`)
      continue
    }
    currentLines.push(line)
  }
  flush()
  if (!sections.length) sections.push({ title: '', text: page.text, page: page.page })
  return sections
}

async function parsePdf(buffer, filename) {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const pages = cleanPdfPages(result.pages || [])
    const usable = pages.filter((page) => page.wordCount >= 60)
    if (!usable.length) {
      throw new Error('这个 PDF 可能是扫描版或文字过少，第一版暂不适合处理')
    }

    const chapters = groupPdfPages(usable)
    return {
      title: filename.replace(/\.[^.]+$/, ''),
      author: '',
      type: 'pdf',
      chapters,
    }
  } finally {
    await parser.destroy()
  }
}

function groupPdfPages(pages) {
  const chapters = []
  let current = null

  function startChapter(title, text, page) {
    current = {
      id: nanoid(),
      title: cleanTitle(title, `Pages ${page.page}`),
      text,
      label: `Page ${page.page}`,
      startPage: page.page,
      endPage: page.page,
      wordCount: wordCount(text),
    }
    chapters.push(current)
  }

  function appendToCurrent(text, page) {
    current.text = normalizeText(`${current.text}\n\n${text}`)
    current.endPage = page.page
    current.label = current.startPage === current.endPage ? `Page ${current.startPage}` : `Pages ${current.startPage}-${current.endPage}`
    current.wordCount = wordCount(current.text)
  }

  for (const page of pages) {
    for (const section of splitPdfPageIntoSections(page)) {
      const text = normalizeText(section.text)
      if (wordCount(text) < 40 && !section.title) continue
      const hasHeading = Boolean(section.title)
      if (!current || hasHeading || wordCount(current.text) > 2600) {
        const title = section.title || `Pages ${page.page}`
        startChapter(title, text, page)
      } else {
        appendToCurrent(text, page)
      }
    }
  }

  return chapters
    .filter((chapter) => wordCount(chapter.text) >= 120)
    .map((chapter) => ({
      ...chapter,
      title: cleanTitle(chapter.title, chapter.label),
      label: chapter.startPage === chapter.endPage ? `Page ${chapter.startPage}` : `Pages ${chapter.startPage}-${chapter.endPage}`,
      wordCount: wordCount(chapter.text),
    }))
}

function legacyGroupPdfPages(pages) {
  const chapters = []
  let current = null

  for (const page of pages) {
    if (!current || wordCount(current.text) > 2200) {
      current = {
        id: nanoid(),
        title: `Pages ${page.page}`,
        text: page.text,
        label: `Page ${page.page}`,
        startPage: page.page,
        endPage: page.page,
        wordCount: wordCount(page.text),
      }
      chapters.push(current)
    } else {
      current.text = normalizeText(`${current.text}\n\n${page.text}`)
      current.endPage = page.page
      current.label = `Pages ${current.startPage}-${current.endPage}`
      current.title = current.label
      current.wordCount = wordCount(current.text)
    }
  }

  return chapters
}

function planUnits(bookId, chapters, sourceType) {
  const units = []
  const studyChapters = chapters.filter(isStudyChapter)
  const maxUnits = Number(process.env.MAX_UNITS_PER_BOOK || 240)

  for (const chapter of studyChapters) {
    const parts = splitIntoSourceUnits(chapter.text, 1700)
    parts.forEach((sourceText, index) => {
      const title = inferEnglishTitle(sourceText, chapter.title, index)
      const location =
        sourceType === 'pdf'
          ? `${chapter.label}${parts.length > 1 ? `, section ${index + 1}` : ''}`
          : `${chapter.title}${parts.length > 1 ? `, section ${index + 1}` : ''}`

      units.push({
        id: nanoid(),
        bookId,
        title,
        status: 'planned',
        sourceLocation: location,
        sourceText,
        sourceExcerpt: takeWords(sourceText, 180),
        sourceWordCount: wordCount(sourceText),
        createdAt: new Date().toISOString(),
        generatedAt: null,
        content: null,
      })
    })
  }
  return units.slice(0, maxUnits)
}

function isStudyChapter(chapter) {
  const title = String(chapter.title || '').toLowerCase()
  const label = String(chapter.label || '').toLowerCase()
  const text = String(chapter.text || '').trim()
  const frontOrBackMatter = [
    'review',
    'praise',
    'copyright',
    'title page',
    'contents',
    'table of contents',
    'dedication',
    'acknowledgements',
    'acknowledgments',
    'dramatis personae',
    'illustrations',
    'notes',
    'footnotes',
    'endnotes',
    'references',
    'bibliography',
    'glossary',
    'index',
    'about the author',
  ]

  if (wordCount(text) < 120) return false
  if (looksLikeTableOfContents(text)) return false
  return !frontOrBackMatter.some((term) => title.includes(term) || label.includes(term))
}

function looksLikeTableOfContents(text) {
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

function splitIntoSourceUnits(text, targetWords) {
  const paragraphs = normalizeText(text).split(/\n{2,}/).filter((item) => wordCount(item) > 20)
  const chunks = []
  let current = ''

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (wordCount(next) > targetWords && wordCount(current) > 500) {
      chunks.push(current)
      current = paragraph
    } else {
      current = next
    }
  }
  if (wordCount(current) > 120) chunks.push(current)

  if (!chunks.length && wordCount(text) > 120) return [takeWords(text, targetWords)]
  return chunks
}

function inferEnglishTitle(text, fallback, index) {
  const keywords = extractKeywords(text, 4)
  if (keywords.length >= 2) {
    return `${titleCase(keywords[0])} and ${titleCase(keywords[1])}`
  }
  return index === 0 ? fallback || 'Reading Unit' : `${fallback || 'Reading Unit'} ${index + 1}`
}

function titleCase(value) {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

const stopWords = new Set(
  'about after again against also among because before between could every first from have into more most other over people should some such than that their there these they this those through under very were when where which while will with would government political economic history historical society country countries state states world years'.split(
    ' '
  )
)

function extractKeywords(text, count = 8) {
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

function splitSentences(text) {
  return normalizeText(text)
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20)
}

function makeFallbackContent(unit, settings) {
  const sentences = splitSentences(unit.sourceText)
  const keySentences = selectSentences(sentences, 28)
  const keywords = extractKeywords(unit.sourceText, 8)
  const paragraphs = buildReadingParagraphs(keySentences)
  const vocabulary = keywords.slice(0, 10).map((term) => ({
    term,
    meaningZh: fallbackChineseMeaning(term),
    simpleEnglish: `A key word from the source text. Notice how the book uses "${term}" in this topic.`,
  }))
  const concepts = vocabulary.slice(0, 5).map((item) => ({
    term: item.term,
    simpleEnglish: item.simpleEnglish,
    chinese: item.meaningZh,
  }))
  const listeningText = buildListeningText(unit.title, keySentences, keywords)

  return {
    title: unit.title,
    level: {
      reading: settings.readingLevel,
      listening: settings.listeningLevel,
    },
    sourceLocation: unit.sourceLocation,
    background: `This unit introduces one idea from the source book in clear adult English.`,
    concepts,
    listening: {
      text: listeningText,
      transcriptHiddenByDefault: true,
    },
    reading: {
      paragraphs: paragraphs.map((text, index) => ({
        text,
        summaryZh: `第 ${index + 1} 段概括了原书这一部分的核心信息。`,
      })),
    },
    vocabulary,
    questions: makeQuestions(unit.title, paragraphs),
    generationMode: 'local-demo',
    fidelityNote: '本地演示生成器只使用原文句子做简化重组；配置 AI key 后会得到更自然的分级改写。',
  }
}

function selectSentences(sentences, maxCount) {
  const chosen = []
  const seen = new Set()
  for (const sentence of sentences) {
    const compact = sentence.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 90)
    if (seen.has(compact)) continue
    seen.add(compact)
    chosen.push(simplifySentence(sentence))
    if (chosen.length >= maxCount) break
  }
  return chosen
}

function simplifySentence(sentence) {
  return sentence
    .replace(/\s*\([^)]{20,}\)/g, '')
    .replace(/; /g, '. ')
    .replace(/,\s+(which|who|where|when)\s+/gi, '. This ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildReadingParagraphs(sentences) {
  const paragraphs = []
  let current = []
  for (const sentence of sentences) {
    current.push(sentence)
    if (current.length >= 4) {
      paragraphs.push(current.join(' '))
      current = []
    }
  }
  if (current.length) paragraphs.push(current.join(' '))
  return paragraphs.slice(0, 8)
}

function buildListeningText(title, sentences, keywords) {
  const lead = `This short listening preview is about ${title.toLowerCase()}.`
  const simple = sentences.slice(0, 7).map((sentence) => {
    const words = sentence.split(/\s+/)
    return words.length > 24 ? `${words.slice(0, 24).join(' ')}.` : sentence
  })
  const keyLine = keywords.length ? `Listen for these ideas: ${keywords.slice(0, 4).join(', ')}.` : ''
  return normalizeText([lead, keyLine, ...simple].filter(Boolean).join(' '))
}

function fallbackChineseMeaning(term) {
  const dictionary = {
    empire: '帝国',
    inflation: '通货膨胀',
    market: '市场',
    trade: '贸易',
    tax: '税收',
    parliament: '议会',
    sovereignty: '主权',
    colony: '殖民地',
    capital: '资本',
    labor: '劳动',
    crisis: '危机',
    reform: '改革',
    revolution: '革命',
    policy: '政策',
    institution: '制度、机构',
  }
  return dictionary[term.toLowerCase()] || '核心词，请结合上下文理解'
}

function fallbackDefinition(term) {
  return {
    term,
    meaningZh: fallbackChineseMeaning(term),
    simpleEnglish: `A word from the reading text. Use the sentence context to understand how "${term}" works here.`,
  }
}

function makeQuestions(title, paragraphs) {
  const first = paragraphs[0] || `This unit is about ${title}.`
  const second = paragraphs[1] || first
  return [
    {
      id: nanoid(),
      prompt: `What is the main topic of this unit?`,
      options: [title, 'A personal travel story', 'A grammar rule only', 'A list of random words'],
      answerIndex: 0,
      explanationZh: '本题考查你是否理解了单元主题。',
    },
    {
      id: nanoid(),
      prompt: 'Which sentence best matches the source idea?',
      options: [first.slice(0, 160), 'The text asks readers to ignore historical context.', 'The unit is unrelated to the book.', 'The author only talks about language learning.'],
      answerIndex: 0,
      explanationZh: '正确选项来自阅读正文，并保持了原文含义。',
    },
    {
      id: nanoid(),
      prompt: 'What should you do if a concept is difficult?',
      options: ['Use the concept preview and Chinese help.', 'Skip the whole unit forever.', 'Read only the answer choices.', 'Change every English word into Chinese.'],
      answerIndex: 0,
      explanationZh: '复杂概念先看简单英文解释，再回到正文。',
    },
    {
      id: nanoid(),
      prompt: 'Which statement is supported by this unit?',
      options: [second.slice(0, 160), 'The AI adds new opinions freely.', 'The source location is hidden.', 'Difficult words are never allowed.'],
      answerIndex: 0,
      explanationZh: '本应用要求忠于原书，同时允许保留必要难词。',
    },
  ]
}

async function generateWithOpenAI(unit, settings) {
  const provider = process.env.AI_PROVIDER || 'auto'
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'mock' || !apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-5.5'
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || 'medium'
  const source = takeWords(unit.sourceText, 2600)
  const prompt = `
Generate a personal English graded-reading lesson from a copyrighted source the user uploaded for private study.

Follow these rules:
- Be strictly faithful to the source. Do not add opinions, examples, facts, or claims that are not in the source.
- Rewrite only for language learning.
- Use clear adult English at CEFR ${settings.readingLevel}. It may include necessary harder terms.
- Listening text must be easier than the reading text, CEFR ${settings.listeningLevel}, about 180-240 words at normal speed.
- Reading text must contain exactly 5 paragraphs.
- Each reading paragraph must be 130-170 words.
- The total reading text must be 700-850 words. Never exceed 900 words.
- If the source contains too much information, preserve the central argument and most important details. Omit minor details instead of making the lesson longer.
- Explain 3-6 complex concepts before the reading.
- Include 8-12 useful vocabulary items.
- Include 4-6 comprehension questions.
- The JSON must match the supplied schema.

Source:
${source}
`

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: reasoningEffort },
      instructions: 'You write faithful graded-reading lessons. Return only schema-valid JSON.',
      input: prompt,
      text: {
        verbosity: process.env.OPENAI_VERBOSITY || 'medium',
        format: {
          type: 'json_schema',
          name: 'graded_reading_lesson',
          strict: true,
          schema: gradedReadingLessonSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI 服务返回错误：${response.status} ${text.slice(0, 240)}`)
  }

  const data = await response.json()
  const content = getResponsesOutputText(data)
  if (!content) throw new Error('AI 服务未返回内容')
  const parsed = JSON.parse(content)
  parsed.generationMode = 'ai'
  parsed.questions = (parsed.questions || []).map((question) => ({
    ...question,
    id: question.id || nanoid(),
  }))
  return parsed
}

const gradedReadingLessonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    level: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reading: { type: 'string' },
        listening: { type: 'string' },
      },
      required: ['reading', 'listening'],
    },
    sourceLocation: { type: 'string' },
    background: { type: 'string' },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string' },
          simpleEnglish: { type: 'string' },
          chinese: { type: 'string' },
        },
        required: ['term', 'simpleEnglish', 'chinese'],
      },
    },
    listening: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        transcriptHiddenByDefault: { type: 'boolean' },
      },
      required: ['text', 'transcriptHiddenByDefault'],
    },
    reading: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paragraphs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              summaryZh: { type: 'string' },
            },
            required: ['text', 'summaryZh'],
          },
        },
      },
      required: ['paragraphs'],
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string' },
          meaningZh: { type: 'string' },
          simpleEnglish: { type: 'string' },
        },
        required: ['term', 'meaningZh', 'simpleEnglish'],
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
          },
          answerIndex: { type: 'number' },
          explanationZh: { type: 'string' },
        },
        required: ['id', 'prompt', 'options', 'answerIndex', 'explanationZh'],
      },
    },
    generationMode: { type: 'string' },
    fidelityNote: { type: 'string' },
  },
  required: [
    'title',
    'level',
    'sourceLocation',
    'background',
    'concepts',
    'listening',
    'reading',
    'vocabulary',
    'questions',
    'generationMode',
    'fidelityNote',
  ],
}

function getResponsesOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text

  const chunks = []
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text)
      if (typeof content?.content === 'string') chunks.push(content.content)
    }
  }
  return chunks.join('').trim()
}

const wordDefinitionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    term: { type: 'string' },
    meaningZh: { type: 'string' },
    simpleEnglish: { type: 'string' },
  },
  required: ['term', 'meaningZh', 'simpleEnglish'],
}

async function generateWordDefinition(term, sentence) {
  const provider = process.env.AI_PROVIDER || 'auto'
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'mock' || !apiKey) return fallbackDefinition(term)

  const model = process.env.OPENAI_MODEL || 'gpt-5.5'
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const prompt = `
Define the English word for a Chinese-speaking adult English learner.

Rules:
- Use the sentence context to choose the right meaning.
- Keep meaningZh short and useful.
- Keep simpleEnglish at CEFR A2-B1.
- Return schema-valid JSON only.

Word: ${term}
Sentence: ${sentence || ''}
`

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      instructions: 'You provide concise contextual English word definitions for Chinese-speaking learners.',
      input: prompt,
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'word_definition',
          strict: true,
          schema: wordDefinitionSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`单词释义失败：${response.status} ${text.slice(0, 200)}`)
  }

  const content = getResponsesOutputText(await response.json())
  if (!content) throw new Error('AI 未返回单词释义')
  return JSON.parse(content)
}

function definitionCacheKey(term, sentence) {
  const normalized = `${String(term || '').toLowerCase()}\n${String(sentence || '').toLowerCase().slice(0, 260)}`
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function buildSpeechAudioRequest(unit) {
  const provider = process.env.AI_PROVIDER || 'auto'
  const ttsProvider = process.env.OPENAI_TTS_PROVIDER || 'openai-speech'
  const apiKey = process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY
  if (provider === 'mock' || !apiKey) throw new Error('未配置可用的语音生成 API key')

  const input = unit.content?.listening?.text
  if (!input) throw new Error('这个单元还没有听力预热文本')

  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
  const voice = resolveTtsVoice(unit.id)
  const baseUrl = process.env.OPENAI_TTS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const instructions =
    process.env.OPENAI_TTS_INSTRUCTIONS ||
    'Read in a natural, professional audiobook style for an adult English learner. Use clear articulation, a warm neutral tone, normal speed, and natural pauses. Do not sound robotic.'
  const outputFormat = ttsProvider === 'mimo' || model.startsWith('mimo-') ? 'wav' : 'mp3'
  const contentType = outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
  const hash = crypto.createHash('sha256').update([ttsProvider, model, voice, instructions, input, outputFormat].join('\n')).digest('hex').slice(0, 16)
  const filename = `${unit.id}-${hash}.${outputFormat}`
  const audioPath = path.join(audioDir, filename)
  return { ttsProvider, baseUrl, apiKey, model, voice, input, instructions, outputFormat, contentType, hash, audioPath }
}

async function hasCachedSpeechAudio(request) {
  try {
    await fs.access(request.audioPath)
    return true
  } catch {
    return false
  }
}

async function generateSpeechAudio(unit, request = buildSpeechAudioRequest(unit)) {
  if (await hasCachedSpeechAudio(request)) return request
  const bytes =
    request.ttsProvider === 'mimo' || request.model.startsWith('mimo-')
      ? await generateMimoSpeech(request)
      : await generateOpenAISpeech(request)

  if (bytes.length < 1000) throw new Error('语音生成返回的音频过小')
  await fs.writeFile(request.audioPath, bytes)
  return request
}

async function generateOpenAISpeech({ baseUrl, apiKey, model, voice, input, instructions, outputFormat }) {
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input,
      instructions,
      response_format: outputFormat,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`语音生成失败：${response.status} ${text.slice(0, 240)}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function generateMimoSpeech({ baseUrl, apiKey, model, voice, input, instructions, outputFormat }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: instructions },
        { role: 'assistant', content: input },
      ],
      audio: {
        format: outputFormat,
        voice,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`MiMo 语音生成失败：${response.status} ${text.slice(0, 240)}`)
  }

  const data = await response.json()
  const encoded = data?.choices?.[0]?.message?.audio?.data
  if (!encoded) throw new Error('MiMo 语音接口没有返回 audio.data')
  return Buffer.from(encoded, 'base64')
}

function resolveTtsVoice(seed = '') {
  const voices = String(process.env.OPENAI_TTS_VOICES || process.env.OPENAI_TTS_VOICE || 'marin')
    .split(',')
    .map((voice) => voice.trim())
    .filter(Boolean)
  if (voices.length <= 1) return voices[0] || 'marin'

  const hash = crypto.createHash('sha256').update(String(seed)).digest()
  return voices[hash[0] % voices.length]
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const byteRate = (sampleRate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function pcmDurationSeconds(pcmLength, sampleRate = 24000, channels = 1, bits = 16) {
  return pcmLength / (sampleRate * channels * (bits / 8))
}

function silencePcm(ms, sampleRate = 24000, channels = 1, bits = 16) {
  const samples = Math.round((sampleRate * ms) / 1000)
  return Buffer.alloc(samples * channels * (bits / 8))
}

function pcmBufferToInt16Array(pcm) {
  const samples = new Int16Array(Math.floor(pcm.length / 2))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE(index * 2)
  }
  return samples
}

function encodePcmToMp3(pcm, sampleRate = 24000, kbps = podcastMp3Kbps) {
  const samples = pcmBufferToInt16Array(pcm)
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, Math.max(48, Math.min(128, Number(kbps || 64))))
  const chunks = []
  for (let offset = 0; offset < samples.length; offset += 1152) {
    const frame = samples.subarray(offset, offset + 1152)
    const bytes = encoder.encodeBuffer(frame)
    if (bytes.length) chunks.push(Buffer.from(bytes))
  }
  const flushed = encoder.flush()
  if (flushed.length) chunks.push(Buffer.from(flushed))
  const output = Buffer.concat(chunks)
  if (output.length < 1000) throw new Error('MP3 编码输出过小')
  return output
}

function podcastAudioContentType(format = '') {
  return String(format).toLowerCase() === 'mp3' ? 'audio/mpeg' : 'audio/wav'
}

function podcastAudioFilename(podcast, format) {
  return `${podcast.id}.${format === 'mp3' ? 'mp3' : 'wav'}`
}

async function writePodcastAudio(podcast, pcm) {
  await fs.mkdir(audioDir, { recursive: true })
  const requested = podcastAudioFormat === 'wav' ? 'wav' : 'mp3'
  const durationSeconds = Math.round(pcmDurationSeconds(pcm.length))

  try {
    if (requested === 'mp3') {
      const file = podcastAudioFilename(podcast, 'mp3')
      const bytes = encodePcmToMp3(pcm)
      await fs.writeFile(path.join(audioDir, file), bytes)
      return {
        file,
        format: 'mp3',
        contentType: 'audio/mpeg',
        byteLength: bytes.length,
        durationSeconds,
      }
    }
  } catch (error) {
    console.error('podcast mp3 encoding failed, falling back to wav', error)
  }

  const file = podcastAudioFilename(podcast, 'wav')
  const bytes = pcmToWav(pcm)
  await fs.writeFile(path.join(audioDir, file), bytes)
  return {
    file,
    format: 'wav',
    contentType: 'audio/wav',
    byteLength: bytes.length,
    durationSeconds,
  }
}

async function deletePodcastAudioFiles(podcast) {
  const files = new Set([podcast?.audio?.file, `${podcast?.id}.wav`, `${podcast?.id}.mp3`].filter(Boolean))
  for (const file of files) {
    const audioPath = path.resolve(audioDir, file)
    if (!audioPath.startsWith(path.resolve(audioDir))) continue
    await fs.unlink(audioPath).catch(() => undefined)
  }
}

function chunkTextForTts(text, maxChars = podcastTtsChunkChars) {
  const sentences = String(text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\S+$/g) || []
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const value = sentence.trim()
    if (!value) continue
    if (current && current.length + 1 + value.length > maxChars) {
      chunks.push(current)
      current = value
    } else {
      current = current ? `${current} ${value}` : value
    }
    while (current.length > maxChars) {
      const sliceAt = Math.max(current.lastIndexOf(' ', maxChars), Math.floor(maxChars * 0.8))
      chunks.push(current.slice(0, sliceAt).trim())
      current = current.slice(sliceAt).trim()
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function mockPodcastPcm(scriptText) {
  const seconds = Math.max(6, Math.min(45, Math.round(wordCount(scriptText) / 2.4)))
  return silencePcm(seconds * 1000)
}

async function geminiTtsChunk(text, voiceName) {
  const provider = process.env.AI_PROVIDER || 'auto'
  const baseUrl = process.env.GEMINI_TTS_BASE_URL || 'https://api.futureppo.top'
  const apiKey = process.env.GEMINI_TTS_API_KEY
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
  if (provider === 'mock') return mockPodcastPcm(text)
  if (!apiKey) throw new Error('未配置 GEMINI_TTS_API_KEY')

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } },
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini TTS 失败：${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data)
  if (!part) throw new Error('Gemini TTS 未返回音频数据')
  return Buffer.from(part.inlineData.data, 'base64')
}

async function synthesizePodcastAudio(podcast, onProgress = async () => undefined) {
  const voice = podcast.audio?.voice || podcast.voice || process.env.GEMINI_TTS_VOICE || 'Kore'
  const chunks = chunkTextForTts(podcast.scriptText || '')
  if (!chunks.length) throw new Error('脚本为空，无法合成')

  const concurrency = Math.max(1, Math.min(4, podcastTtsConcurrency))
  const pcmParts = new Array(chunks.length)
  let cursor = 0
  let done = 0

  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor
      cursor += 1
      const instruction = 'Read in a warm, patient, encouraging teacher voice for an adult English learner. Use clear articulation, normal speed, and natural pauses.\n\n'
      pcmParts[index] = await geminiTtsChunk(`${instruction}${chunks[index]}`, voice)
      done += 1
      await onProgress(Math.round((done / chunks.length) * 100), done, chunks.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))

  const gap = silencePcm(120)
  const merged = []
  pcmParts.forEach((part, index) => {
    if (index > 0) merged.push(gap)
    merged.push(part)
  })
  const pcm = Buffer.concat(merged)
  const audioFile = await writePodcastAudio(podcast, pcm)

  return {
    file: audioFile.file,
    format: audioFile.format,
    contentType: audioFile.contentType,
    byteLength: audioFile.byteLength,
    voice,
    durationSeconds: audioFile.durationSeconds,
    chunkCount: chunks.length,
    generatedAt: new Date().toISOString(),
  }
}

const podcastScriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    script: { type: 'string' },
  },
  required: ['title', 'script'],
}

function podcastPromptProfile(kind, lexile) {
  const safeKind = normalizePodcastKind(kind)
  if (safeKind === 'preview') {
    return `
Podcast Type: Read-before preview.
Goal: Prepare the listener before reading the related source section. Make the upcoming reading easier.
Structure:
- Open with one clear guiding question.
- Explain the background, people, institutions, and difficult concepts that the listener needs first.
- Introduce 5 to 8 high-value words in context.
- Give a light map of the source without trying to cover every detail.
- End by telling the listener what to notice while reading.
Style: simpler than the reading text, calm, practical, and not too dense.
Do not turn this into a full summary.`
  }
  if (safeKind === 'review') {
    return `
Podcast Type: After-reading review.
Goal: Help the listener consolidate the source after reading it.
Structure:
- Start by reminding the listener of the central issue.
- Review the key events, arguments, and cause-effect links.
- Clarify confusing concepts in simple English.
- Include a short self-check section with 3 spoken questions and immediate answers.
- End with a concise takeaway.
Style: reflective, precise, and slightly more analytical than the preview.`
  }
  if (safeKind === 'topic') {
    return `
Podcast Type: Full-book thematic episode.
Goal: Use representative source excerpts to explain one major theme or question across the book.
Structure:
- Start with a broad theme or question supported by the source.
- Organize by ideas, forces, and cause-effect relationships, not by page order.
- Connect evidence from different source locations when possible.
- Explain why the theme matters for understanding the whole book.
- End with a compact synthesis.
Style: like a serious single-host knowledge podcast for an English learner.
Do not pretend to have read material that is not present in the source excerpts.`
  }
  return `
Podcast Type: Sequential guided explanation.
Goal: Explain the source section in order as a detailed teacher-led lesson.
Structure:
- Start with a simple introduction.
- Explain every key detail and concept from the source.
- After a few main ideas, add a short "Micro-Recap".
- Keep the original logic and order clear.
Style: patient, encouraging, clear teacher.
Focus on depth over brevity.`
}

function localPodcastScript(sourceText, kind, episodeNumber = 1, part = null) {
  const label = podcastKindLabel(kind)
  const partName = part ? `, part ${part.index}` : ''
  const source = takeWords(sourceText, normalizePodcastKind(kind) === 'preview' ? 520 : 900)
  if (normalizePodcastKind(kind) === 'preview') {
    return `Welcome to this LinguaShelf ${label} lesson${partName}. Before you read, listen for the main people, places, and ideas in this source section. The important point is to make the reading feel familiar before you start. Here is the source in simpler language: ${source} Micro-Recap: when you read, pay attention to the main question, the important names, and the cause-and-effect links.`
  }
  if (normalizePodcastKind(kind) === 'review') {
    return `Welcome to this LinguaShelf ${label} lesson${partName}. You have already met the source section, so now we will review the main ideas and make them easier to remember. ${source} Self-check: What was the central issue? Which people or forces mattered most? What changed by the end of this section? Micro-Recap: this review connects the source ideas and helps you remember them.`
  }
  if (normalizePodcastKind(kind) === 'topic') {
    return `Welcome to this LinguaShelf ${label} lesson. This episode looks across the book excerpts for one larger theme. ${source} Micro-Recap: this full-book topic connects different parts of the source, but it only uses ideas found in the provided text.`
  }
  return `Welcome to this LinguaShelf ${label} lesson${partName}. In this episode, we will learn from the book in simple English. ${source} Micro-Recap: this part connects the important ideas in the source and explains them slowly for learning. That's the end of this part. Play the next episode to keep learning.`
}

function buildPodcastPrompt(sourceText, lexile, episodeNumber = 1, part = null, kind = 'walkthrough') {
  const safeKind = normalizePodcastKind(kind)
  const partLine = part ? `This is part ${part.index} of ${part.total} for this episode. Explain only this source part, and do not repeat a long episode introduction.` : ''
  const closingRule = part && part.index < part.total ? 'End with one short bridge sentence to the next part. Do not give a final episode closing.' : safeKind === 'preview' ? 'End with one natural line that sends the listener into the related reading.' : safeKind === 'review' ? 'End with one natural review takeaway.' : safeKind === 'topic' ? 'End with one natural synthesis line for the full-book theme.' : 'End the episode with one natural closing line inviting the listener to play the next episode. Do NOT ask the listener to type anything or wait for input.'
  return `
Listener Profile: English Language Learner, target vocabulary level Lexile ${lexile}L.
Create an audio-ready single-host podcast script for English learners.
${podcastPromptProfile(safeKind, lexile)}
${partLine}

Rules:
1. Primarily use vocabulary at Lexile ${lexile}L. If the source uses any difficult word or specialized idea, immediately explain it: state the term, then define it in very simple words.
2. Stay faithful to the source. Do not add claims, facts, examples, or opinions that are not supported by the source.
3. Use natural spoken prose. Do not use markdown, bullet labels, stage directions, or timestamps.
4. Keep a single-speaker professional tone.
5. ${closingRule}

Return JSON: { "title": short episode title, "script": the full spoken script as plain prose, no markdown, no stage directions }.

Podcast type: ${podcastKindLabel(safeKind)}
Episode: ${episodeNumber}
Source:
${sourceText}
`
}

async function generatePodcastScriptPart(sourceText, lexile, episodeNumber = 1, part = null, kind = 'walkthrough') {
  const provider = process.env.AI_PROVIDER || 'auto'
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'mock' || !apiKey) {
    return {
      title: part ? `${podcastKindLabel(kind)} ${episodeNumber}, part ${part.index}` : `${podcastKindLabel(kind)} ${episodeNumber}`,
      script: localPodcastScript(sourceText, kind, episodeNumber, part),
      mode: 'local-demo',
    }
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.5'
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || 'medium' },
      instructions: 'You write faithful, expanded graded-reading podcast scripts for English learners. Return only schema-valid JSON.',
      input: buildPodcastPrompt(takeWords(sourceText, 3000), lexile, episodeNumber, part, kind),
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'podcast_script',
          strict: true,
          schema: podcastScriptSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`播客脚本生成失败：${response.status} ${text.slice(0, 200)}`)
  }
  const content = getResponsesOutputText(await response.json())
  if (!content) throw new Error('脚本生成未返回内容')
  const parsed = JSON.parse(content)
  return { title: parsed.title || `${podcastKindLabel(kind)} ${episodeNumber}`, script: parsed.script, mode: 'ai' }
}

async function generatePodcastScript(sourceText, lexile, episodeNumber = 1, kind = 'walkthrough') {
  const maxWords = podcastScriptSourceChunkWords
  if (wordCount(sourceText) <= maxWords + 400) return generatePodcastScriptPart(sourceText, lexile, episodeNumber, null, kind)

  const parts = splitIntoSourceUnits(sourceText, maxWords).filter((part) => wordCount(part) > 120)
  if (parts.length <= 1) return generatePodcastScriptPart(sourceText, lexile, episodeNumber, null, kind)

  const scripts = []
  for (let index = 0; index < parts.length; index += 1) {
    const result = await generatePodcastScriptPart(parts[index], lexile, episodeNumber, { index: index + 1, total: parts.length }, kind)
    scripts.push(result)
  }
  return {
    title: scripts[0]?.title || `Podcast ${episodeNumber}`,
    script: scripts.map((item) => item.script).join('\n\n'),
    mode: scripts.some((item) => item.mode === 'ai') ? 'ai-segmented' : 'local-demo',
    partCount: scripts.length,
  }
}

function summarizeBook(book, units) {
  const total = units.length
  const generated = units.filter((unit) => unit.status !== 'planned').length
  const completed = units.filter((unit) => unit.status === 'completed').length
  return { ...book, totalUnits: total, generatedUnits: generated, completedUnits: completed }
}

function progressKey(userId, unitId) {
  return `${userId}:${unitId}`
}

function getUnitProgress(db, userId, unitId) {
  return db.progress.find((item) => item.userId === userId && item.unitId === unitId) || null
}

function ensureUnitProgress(db, userId, unitId) {
  let progress = getUnitProgress(db, userId, unitId)
  if (!progress) {
    progress = {
      id: progressKey(userId, unitId),
      userId,
      unitId,
      paragraphIndex: 0,
      listeningCompleted: false,
      answers: {},
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    db.progress.push(progress)
  }
  return progress
}

function publicProgress(progress) {
  if (!progress) {
    return {
      paragraphIndex: 0,
      listeningCompleted: false,
      answers: {},
      completed: false,
      updatedAt: '',
    }
  }
  return {
    paragraphIndex: Number(progress.paragraphIndex || 0),
    listeningCompleted: Boolean(progress.listeningCompleted),
    answers: progress.answers || {},
    completed: Boolean(progress.completed),
    updatedAt: progress.updatedAt,
  }
}

function publicUnit(unit, db = null, userId = '') {
  if (!unit) return null
  const { sourceText, versions, ...safeUnit } = unit
  safeUnit.versions = (versions || []).map((version, index) => ({
    id: version.id || `version-${index}`,
    title: version.title || `历史版本 ${index + 1}`,
    reason: version.reason || 'regenerated',
    savedAt: version.savedAt || version.generatedAt || '',
    generatedAt: version.generatedAt || '',
    level: version.level || null,
    quality: version.quality || null,
  }))
  if (db && userId) safeUnit.progress = publicProgress(getUnitProgress(db, userId, unit.id))
  return safeUnit
}

function publicPodcast(podcast, { includeScript = false } = {}) {
  if (!podcast) return null
  const { sourceText, ...safePodcast } = podcast
  safePodcast.kind = normalizePodcastKind(safePodcast.kind)
  safePodcast.kindLabel = podcastKindLabel(safePodcast.kind)
  if (!includeScript) delete safePodcast.scriptText
  return safePodcast
}

function unitPodcastSource(unit) {
  return normalizeText(unit?.sourceText || unit?.sourceExcerpt || '')
}

function representativeBookSource(units, maxWords) {
  const available = units
    .map((unit) => ({ unit, text: unitPodcastSource(unit) }))
    .filter((item) => item.text)
  if (!available.length) return ''

  const perUnit = Math.max(80, Math.floor(maxWords / Math.max(1, available.length)))
  const snippets = available.map(({ unit, text }) => {
    const location = unit.sourceLocation || unit.title || 'Source section'
    return `Source location: ${location}\n${takeWords(text, perUnit)}`
  })
  return takeWords(snippets.join('\n\n'), maxWords)
}

function planTopicPodcastEpisode(book, units) {
  const bookUnits = units.filter((unit) => unit.bookId === book.id)
  const text = representativeBookSource(bookUnits, Math.max(2200, Math.min(4200, podcastScriptSourceChunkWords + 1000)))
  if (!text) return []
  return [
    {
      unitIds: bookUnits.map((unit) => unit.id),
      text,
      words: wordCount(text),
    },
  ]
}

function planPodcastEpisodes(book, units, kind = 'walkthrough') {
  const safeKind = normalizePodcastKind(kind)
  if (safeKind === 'topic') return planTopicPodcastEpisode(book, units)

  const bookUnits = units.filter((unit) => unit.bookId === book.id)
  const groups = []
  const targetWords = Number(process.env.PODCAST_SOURCE_WORDS_PER_EPISODE || 2200)
  let current = { unitIds: [], text: '', words: 0 }

  for (const unit of bookUnits) {
    const text = unitPodcastSource(unit)
    if (!text.trim()) continue
    current.unitIds.push(unit.id)
    current.text = current.text ? `${current.text}\n\n${text}` : text
    current.words += Number(unit.sourceWordCount || wordCount(text))
    if (current.words >= targetWords) {
      groups.push(current)
      current = { unitIds: [], text: '', words: 0 }
    }
  }
  if (current.unitIds.length) groups.push(current)
  return groups.slice(0, maxPodcastEpisodes)
}

function computeHome(db, userId) {
  const userBooks = db.books
    .filter((book) => book.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const userBookIds = new Set(userBooks.map((book) => book.id))
  const userUnits = db.units.filter((unit) => userBookIds.has(unit.bookId))
  const reports = db.reports.filter((report) => report.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const completedIds = new Set(reports.map((report) => report.unitId))
  const inProgress = db.progress
    .filter((item) => item.userId === userId && !item.completed)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((item) => userUnits.find((unit) => unit.id === item.unitId))
    .find(Boolean)
  const latestReport = reports[0]
  const latestUnit = latestReport ? userUnits.find((unit) => unit.id === latestReport.unitId) : null
  const latestBookUnits = latestUnit ? userUnits.filter((unit) => unit.bookId === latestUnit.bookId) : []
  const latestIndex = latestUnit ? latestBookUnits.findIndex((unit) => unit.id === latestUnit.id) : -1
  let continueUnit = inProgress || (latestIndex >= 0 ? latestBookUnits.slice(latestIndex + 1).find((unit) => unit.status !== 'completed') : null)

  if (!continueUnit) continueUnit = userUnits.find((unit) => unit.status === 'generated' && !completedIds.has(unit.id))
  if (!continueUnit) continueUnit = userUnits.find((unit) => unit.status === 'planned')

  const continueBook = continueUnit ? userBooks.find((book) => book.id === continueUnit.bookId) : null
  const activeJobs = db.jobs
    .filter((job) => job.userId === userId && ['queued', 'running'].includes(job.status))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, 8)

  return {
    continueBook: continueBook ? summarizeBook(continueBook, userUnits.filter((unit) => unit.bookId === continueBook.id)) : null,
    continueUnit: publicUnit(continueUnit, db, userId),
    recentBooks: userBooks.slice(0, 3).map((book) => summarizeBook(book, userUnits.filter((unit) => unit.bookId === book.id))),
    latestReport: latestReport || null,
    activeJobs: activeJobs.map(publicJob),
  }
}

function computeStats(db, userId) {
  const reports = db.reports.filter((item) => item.userId === userId)
  const vocabulary = db.vocabulary.filter((item) => item.userId === userId)
  const settings = userSettings(db, userId)
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const completedUnits = reports.length
  const averageCorrectRate = reports.length
    ? reports.reduce((total, report) => total + Number(report.correctRate || 0), 0) / reports.length
    : 0
  const dueVocabulary = vocabulary.filter((item) => !item.dueAt || Date.parse(item.dueAt) <= now).length
  const masteredVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) >= 4).length
  const recentReports = reports
    .filter((report) => Date.parse(report.createdAt) >= now - 14 * 24 * 60 * 60 * 1000)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((report) => ({
      date: report.createdAt.slice(0, 10),
      correctRate: report.correctRate,
      words: report.newVocabularyCount,
    }))
  const dailyMap = new Map()
  for (const report of reports) {
    const date = String(report.createdAt || '').slice(0, 10)
    if (!date) continue
    const item = dailyMap.get(date) || { date, units: 0, words: 0, correctRate: 0 }
    item.units += 1
    item.words += Number(report.newVocabularyCount || 0)
    item.correctRate += Number(report.correctRate || 0)
    dailyMap.set(date, item)
  }
  const calendar = []
  for (let index = 13; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const item = dailyMap.get(date) || { date, units: 0, words: 0, correctRate: 0 }
    calendar.push({ ...item, correctRate: item.units ? item.correctRate / item.units : 0 })
  }
  let streakDays = 0
  for (let index = 0; index < 365; index += 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    if ((dailyMap.get(date)?.units || 0) === 0) break
    streakDays += 1
  }

  return {
    completedUnits,
    averageCorrectRate,
    vocabularyCount: vocabulary.length,
    dueVocabulary,
    masteredVocabulary,
    recentReports,
    todayCompleted: dailyMap.get(today)?.units || 0,
    dailyGoalUnits: Math.max(1, Math.round(Number(settings.studyMinutes || 10) / 10)),
    streakDays,
    calendar,
  }
}

function makeSourceRefs(unit) {
  const paragraphs = sourceParagraphs(unit)
  return paragraphs.slice(0, 6).map((item, index) => {
    return {
      id: `${unit.id}-src-${index + 1}`,
      label: `${unit.sourceLocation}, 段落 ${item.index + 1}`,
      excerpt: takeWords(item.text, 80),
      wordCount: item.wordCount,
    }
  })
}

function sourceParagraphs(unit) {
  return normalizeText(unit?.sourceText || '')
    .split(/\n{2,}/)
    .filter((item) => wordCount(item) >= 25)
    .map((text, index) => ({
      index,
      text,
      wordCount: wordCount(text),
      keywords: new Set(extractKeywords(text, 18)),
    }))
}

function keywordOverlapScore(readingText, sourceItem) {
  const readingKeywords = new Set(extractKeywords(readingText, 24))
  if (!readingKeywords.size || !sourceItem?.keywords?.size) return 0
  let overlap = 0
  for (const keyword of readingKeywords) {
    if (sourceItem.keywords.has(keyword)) overlap += 1
  }
  return overlap / Math.max(4, Math.min(readingKeywords.size, sourceItem.keywords.size))
}

function mapReadingToSource(content, unit) {
  const sourceItems = sourceParagraphs(unit)
  const paragraphs = content?.reading?.paragraphs || []
  return paragraphs.map((paragraph, index) => {
    const ranked = sourceItems
      .map((source) => ({ source, score: keywordOverlapScore(paragraph.text || '', source) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
    const output = {
      readingParagraph: index + 1,
      sourceRefs: ranked.map(({ source, score }) => ({
        id: `${unit.id}-map-${index + 1}-${source.index + 1}`,
        label: `${unit.sourceLocation}, 段落 ${source.index + 1}`,
        excerpt: takeWords(source.text, 70),
        wordCount: source.wordCount,
        keywordOverlap: Number(score.toFixed(2)),
      })),
      note: ranked.length ? '按关键词重合度匹配的来源段落' : '未找到明显对应来源段落',
    }
    return output
  })
}

function localFidelityAudit(content, unit) {
  const readingText = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  const sourceKeywords = unit ? extractKeywords(unit.sourceText, 16) : []
  const readingLower = readingText.toLowerCase()
  const coveredKeywords = sourceKeywords.filter((keyword) => readingLower.includes(keyword.toLowerCase()))
  const missingImportantIdeas = sourceKeywords.filter((keyword) => !coveredKeywords.includes(keyword)).slice(0, 8)
  const score = sourceKeywords.length ? coveredKeywords.length / sourceKeywords.length : 1
  const sourceMap = unit ? mapReadingToSource(content, unit) : []
  const unmappedCount = sourceMap.filter((item) => !item.sourceRefs.length).length
  const risks = []
  if (score < 0.45) risks.push('核心关键词覆盖偏低')
  if (unmappedCount) risks.push(`${unmappedCount} 个阅读段落缺少明显来源映射`)
  return {
    mode: 'local',
    score: Number(score.toFixed(2)),
    verdict: risks.length ? '需要复核来源忠实度' : '本地检查未发现明显忠实度问题',
    risks,
    unsupportedClaims: [],
    missingImportantIdeas,
    sourceAlignedParagraphs: sourceMap.map((item) => ({
      readingParagraph: item.readingParagraph,
      sourceParagraphs: item.sourceRefs.map((ref) => ref.label),
      note: item.note,
    })),
  }
}

const fidelityAuditSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    missingImportantIdeas: { type: 'array', items: { type: 'string' } },
    sourceAlignedParagraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          sourceParagraphs: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['readingParagraph', 'sourceParagraphs', 'note'],
      },
    },
  },
  required: ['score', 'verdict', 'risks', 'unsupportedClaims', 'missingImportantIdeas', 'sourceAlignedParagraphs'],
}

async function auditContentFidelity(content, unit) {
  const local = localFidelityAudit(content, unit)
  const provider = process.env.AI_PROVIDER || 'auto'
  const mode = String(process.env.QUALITY_AUDIT_MODE || 'auto').toLowerCase()
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'mock' || mode === 'off' || !apiKey || !unit?.sourceText) return local

  try {
    const readingText = (content?.reading?.paragraphs || []).map((paragraph, index) => `Paragraph ${index + 1}: ${paragraph.text}`).join('\n\n')
    const sourceRefs = sourceParagraphs(unit)
      .slice(0, 12)
      .map((item) => `Source paragraph ${item.index + 1}: ${takeWords(item.text, 140)}`)
      .join('\n\n')
    const model = process.env.OPENAI_MODEL || 'gpt-5.5'
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: 'low' },
        instructions: 'You audit whether a graded English lesson stays faithful to its source. Do not rewrite the lesson. Return only schema-valid JSON.',
        input: `
Compare the source excerpts and generated lesson.

Rules:
- Score 1.0 means fully faithful; 0.0 means mostly unsupported.
- List unsupported claims only if the lesson says something not supported by the source.
- List important missing ideas only if they are central to the source excerpt.
- Map each generated reading paragraph to the best matching source paragraph labels when possible.

Source:
${sourceRefs}

Generated lesson:
${readingText}
`,
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'fidelity_audit',
            strict: true,
            schema: fidelityAuditSchema,
          },
        },
      }),
    })
    if (!response.ok) throw new Error(`AI 审稿失败：${response.status}`)
    const text = getResponsesOutputText(await response.json())
    if (!text) throw new Error('AI 审稿未返回内容')
    const parsed = JSON.parse(text)
    return {
      ...local,
      ...parsed,
      mode: 'ai',
      localScore: local.score,
      risks: [...new Set([...(local.risks || []), ...(parsed.risks || [])])],
      missingImportantIdeas: [...new Set([...(local.missingImportantIdeas || []), ...(parsed.missingImportantIdeas || [])])].slice(0, 12),
    }
  } catch (error) {
    return {
      ...local,
      mode: 'local',
      error: error.message || 'AI 审稿不可用',
      risks: [...(local.risks || []), 'AI 忠实度审稿不可用，已使用本地检查'],
    }
  }
}

function assessContentQuality(content, unit = null) {
  const readingText = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  const readingWords = wordCount(readingText)
  const listeningWords = wordCount(content?.listening?.text || '')
  const paragraphCount = content?.reading?.paragraphs?.length || 0
  const questionCount = content?.questions?.length || 0
  const warnings = []
  const audit = content?.qualityAudit || (unit ? localFidelityAudit(content, unit) : null)
  const sourceMap = unit ? mapReadingToSource(content, unit) : []
  const sourceKeywords = unit ? extractKeywords(unit.sourceText, 12) : []
  const readingLower = readingText.toLowerCase()
  const coveredKeywords = sourceKeywords.filter((keyword) => readingLower.includes(keyword.toLowerCase()))
  const keywordCoverage = sourceKeywords.length ? coveredKeywords.length / sourceKeywords.length : 1

  if (readingWords < 650) warnings.push('阅读正文偏短')
  if (readingWords > 950) warnings.push('阅读正文偏长')
  if (paragraphCount !== 5) warnings.push('段落数偏离目标')
  if (listeningWords < 150 || listeningWords > 260) warnings.push('听力预热长度需要调整')
  if (questionCount < 4) warnings.push('理解题偏少')
  if (keywordCoverage < 0.35) warnings.push('原文关键词覆盖偏低')
  if (!String(content?.fidelityNote || '').toLowerCase().includes('source')) warnings.push('忠实度说明不足')
  if (audit?.score !== undefined && Number(audit.score) < 0.55) warnings.push('AI 忠实度审稿分数偏低')
  if (audit?.unsupportedClaims?.length) warnings.push('AI 审稿发现疑似未受原文支持的表述')
  if (sourceMap.some((item) => !item.sourceRefs.length)) warnings.push('部分段落缺少明确来源映射')

  return {
    readingWords,
    listeningWords,
    paragraphCount,
    questionCount,
    sourceRefs: unit ? makeSourceRefs(unit) : [],
    sourceMap,
    fidelity: {
      keywordCoverage,
      coveredKeywords,
      missingKeywords: sourceKeywords.filter((keyword) => !coveredKeywords.includes(keyword)),
      sourceLocation: unit?.sourceLocation || content?.sourceLocation || '',
      audit,
    },
    status: warnings.length ? 'review' : 'good',
    warnings,
  }
}

function adaptiveSuggestion(report, settings) {
  const score = report.correctRate
  const words = report.newVocabularyCount
  if (score >= 0.85 && words <= 8) {
    return {
      reading: `阅读正确率较高，下一阶段可以考虑从 ${settings.readingLevel} 小幅提高。`,
      listening: `听力先保持 ${settings.listeningLevel}，确保先听后读仍然轻松。`,
      action: 'consider-up',
    }
  }
  if (score < 0.6 || words > 18) {
    return {
      reading: `当前阅读材料可能偏难，建议暂时保持 ${settings.readingLevel}，并多复习核心词。`,
      listening: `听力继续保持 ${settings.listeningLevel}。`,
      action: 'hold',
    }
  }
  return {
    reading: `当前阅读难度基本合适，继续保持 ${settings.readingLevel}。`,
    listening: `听力难度保持 ${settings.listeningLevel}。`,
    action: 'stay',
  }
}

function exampleSentenceForTerm(content, term) {
  const target = String(term || '').toLowerCase()
  const text = (content?.reading?.paragraphs || []).map((paragraph) => paragraph.text).join(' ')
  return splitSentences(text).find((sentence) => sentence.toLowerCase().includes(target)) || ''
}

function csvCell(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`
}

function tsvCell(value) {
  return String(value || '')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
}

const readingLevels = ['A2', 'A2+', 'B1', 'B1+', 'B2']
const listeningLevels = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']

function normalizeLevel(levels, value, fallback) {
  const level = String(value || '')
  return levels.includes(level) ? level : fallback
}

function shiftLevel(levels, currentLevel, step) {
  const index = levels.includes(currentLevel) ? levels.indexOf(currentLevel) : 0
  return levels[Math.max(0, Math.min(levels.length - 1, index + step))]
}

function applyAdaptiveLeveling(db, userId) {
  const settings = userSettings(db, userId)
  if (!settings.aiSuggestions) {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: '自动难度调整已关闭。',
    }
  }

  const since = settings.lastLevelAdjustedAt || ''
  const reports = db.reports
    .filter((report) => report.userId === userId && (!since || String(report.createdAt) > since))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))

  if (reports.length < 3) {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: `再完成 ${3 - reports.length} 个单元后判断难度。`,
    }
  }

  const recent = reports.slice(-3)
  const averageCorrectRate = recent.reduce((total, report) => total + Number(report.correctRate || 0), 0) / recent.length
  const averageWords = recent.reduce((total, report) => total + Number(report.newVocabularyCount || 0), 0) / recent.length
  let readingStep = 0
  let listeningStep = 0
  let reason = ''

  if (averageCorrectRate >= 0.88 && averageWords <= 8) {
    readingStep = 1
    if (averageCorrectRate >= 0.92 && averageWords <= 6) listeningStep = 1
    reason = '最近 3 个单元正确率高、生词少'
  } else if (averageCorrectRate < 0.55 || averageWords >= 18) {
    readingStep = -1
    if (averageCorrectRate < 0.5) listeningStep = -1
    reason = '最近 3 个单元负担偏高'
  } else {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: '最近 3 个单元难度合适，保持当前设置。',
    }
  }

  const previous = {
    readingLevel: settings.readingLevel,
    listeningLevel: settings.listeningLevel,
  }
  const nextReading = shiftLevel(readingLevels, settings.readingLevel, readingStep)
  const nextListening = shiftLevel(listeningLevels, settings.listeningLevel, listeningStep)

  if (nextReading === settings.readingLevel && nextListening === settings.listeningLevel) {
    settings.lastLevelAdjustedAt = new Date().toISOString()
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: `${reason}，但当前设置已到可调整边界。`,
    }
  }

  settings.readingLevel = nextReading
  settings.listeningLevel = nextListening
  settings.lastLevelAdjustedAt = new Date().toISOString()
  settings.lastLevelCheckReportId = recent[recent.length - 1]?.id

  return {
    applied: true,
    from: previous,
    to: {
      readingLevel: nextReading,
      listeningLevel: nextListening,
    },
    readingLevel: nextReading,
    listeningLevel: nextListening,
    message: `${reason}，已调整为阅读 ${nextReading}、听力 ${nextListening}。`,
  }
}

let jobQueueActive = false

function generationSettingsFromBody(settings, body = {}) {
  return {
    ...settings,
    readingLevel: normalizeLevel(readingLevels, body.readingLevel, settings.readingLevel),
    listeningLevel: normalizeLevel(listeningLevels, body.listeningLevel, settings.listeningLevel),
  }
}

async function buildGeneratedContent(unit, generationSettings) {
  let content = null
  let aiError = ''
  try {
    content = await generateWithOpenAI(unit, generationSettings)
  } catch (error) {
    aiError = error.message
  }
  if (!content) content = makeFallbackContent(unit, generationSettings)
  content.qualityAudit = await auditContentFidelity(content, unit)
  if (aiError) content.fidelityNote = `${content.fidelityNote || ''} AI 调用失败，已使用本地演示生成器。${aiError}`.trim()
  return content
}

function saveUnitVersion(unit, reason = 'regenerated') {
  if (!unit?.content) return null
  unit.versions = Array.isArray(unit.versions) ? unit.versions : []
  const version = {
    id: nanoid(),
    title: unit.title,
    reason,
    savedAt: new Date().toISOString(),
    generatedAt: unit.generatedAt,
    level: unit.content.level,
    quality: unit.quality,
    content: unit.content,
  }
  unit.versions.push(version)
  if (unit.versions.length > 8) unit.versions = unit.versions.slice(-8)
  return version
}

function applyGeneratedContent(unit, content, options = {}) {
  if (unit.content && options.force) saveUnitVersion(unit, 'regenerated')
  unit.content = content
  unit.title = content.title || unit.title
  unit.status = 'generated'
  unit.generatedAt = new Date().toISOString()
  unit.quality = assessContentQuality(content, unit)
  unit.sourceRefs = unit.quality.sourceRefs
  unit.audio = null
  unit.generation = {
    ...(unit.generation || {}),
    status: 'succeeded',
    finishedAt: new Date().toISOString(),
  }
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    unitId: job.unitId,
    podcastId: job.podcastId,
    bookId: job.bookId,
    progress: job.progress || 0,
    message: job.message || '',
    error: job.error || '',
    retryCount: Number(job.retryCount || 0),
    qualityStatus: job.qualityStatus || '',
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  }
}

function publicJobWithContext(job, db) {
  const output = publicJob(job)
  if (!output) return null
  const unit = db.units.find((item) => item.id === job.unitId)
  const podcast = db.podcasts.find((item) => item.id === job.podcastId)
  const book = unit ? db.books.find((item) => item.id === unit.bookId) : podcast ? db.books.find((item) => item.id === podcast.bookId) : null
  return {
    ...output,
    unitTitle: unit?.title || '',
    podcastTitle: podcast?.title || '',
    bookTitle: book?.title || '',
  }
}

function activeGenerationJob(db, userId, unitId) {
  return db.jobs.find(
    (job) =>
      job.userId === userId &&
      job.unitId === unitId &&
      job.type === 'generate-unit' &&
      ['queued', 'running', 'paused'].includes(job.status)
  )
}

function enqueueGenerationJob(db, userId, unit, settings, body = {}) {
  const active = activeGenerationJob(db, userId, unit.id)
  if (active) return active

  const generationSettings = generationSettingsFromBody(settings, body)
  const now = new Date().toISOString()
  const job = {
    id: nanoid(),
    userId,
    type: 'generate-unit',
    status: 'queued',
    progress: 0,
    message: '已加入生成队列',
    unitId: unit.id,
    bookId: unit.bookId,
    force: Boolean(body.force),
    settings: {
      readingLevel: generationSettings.readingLevel,
      listeningLevel: generationSettings.listeningLevel,
    },
    createdAt: now,
    updatedAt: now,
  }
  db.jobs.push(job)
  unit.generation = {
    jobId: job.id,
    status: 'queued',
    progress: 0,
    message: job.message,
    requestedAt: now,
    readingLevel: generationSettings.readingLevel,
    listeningLevel: generationSettings.listeningLevel,
  }
  return job
}

function activePodcastJobs(db, userId) {
  return db.jobs.filter((job) => job.userId === userId && job.type === 'generate-podcast' && ['queued', 'running'].includes(job.status))
}

function activePodcastJob(db, userId, podcastId) {
  return db.jobs.find(
    (job) =>
      job.userId === userId &&
      job.podcastId === podcastId &&
      job.type === 'generate-podcast' &&
      ['queued', 'running', 'paused'].includes(job.status)
  )
}

function enqueuePodcastJob(db, userId, podcast) {
  const active = activePodcastJob(db, userId, podcast.id)
  if (active) return active

  const now = new Date().toISOString()
  podcast.kind = normalizePodcastKind(podcast.kind)
  const job = {
    id: nanoid(),
    userId,
    type: 'generate-podcast',
    status: 'queued',
    progress: 0,
    message: '播客已加入生成队列',
    podcastId: podcast.id,
    bookId: podcast.bookId,
    createdAt: now,
    updatedAt: now,
  }
  db.jobs.push(job)
  podcast.jobId = job.id
  podcast.status = 'planned'
  podcast.error = ''
  podcast.updatedAt = now
  return job
}

async function recoverInterruptedJobs() {
  const db = await readDb()
  let changed = false
  for (const job of db.jobs) {
    if (job.status !== 'running') continue
    job.status = 'queued'
    job.progress = 0
    job.message = '服务重启后重新排队'
    job.updatedAt = new Date().toISOString()
    const unit = db.units.find((item) => item.id === job.unitId)
    if (unit?.generation?.jobId === job.id) {
      unit.generation.status = 'queued'
      unit.generation.progress = 0
      unit.generation.message = job.message
    }
    const podcast = db.podcasts.find((item) => item.id === job.podcastId)
    if (podcast?.jobId === job.id) {
      podcast.status = podcast.scriptText ? 'synthesizing' : 'planned'
      podcast.updatedAt = job.updatedAt
    }
    changed = true
  }
  if (changed) await writeDb(db)
  setTimeout(processJobQueue, 0)
}

async function updatePodcastJobProgress(podcastId, jobId, progress, message) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId)
  const podcast = db.podcasts.find((item) => item.id === podcastId)
  if (!job || !podcast) return
  job.progress = Math.max(job.progress || 0, Math.min(99, progress))
  job.message = message || job.message
  job.updatedAt = new Date().toISOString()
  podcast.updatedAt = job.updatedAt
  await writeDb(db)
}

async function failPodcastJob(jobId, message) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId)
  if (!job) return
  const podcast = db.podcasts.find((item) => item.id === job.podcastId)
  job.status = 'failed'
  job.progress = 100
  job.error = message || '播客生成失败'
  job.message = '播客生成失败'
  job.finishedAt = new Date().toISOString()
  job.updatedAt = job.finishedAt
  if (podcast) {
    podcast.status = 'failed'
    podcast.error = job.error
    podcast.updatedAt = job.updatedAt
  }
  await writeDb(db)
}

async function processPodcastJob(jobId) {
  let db = await readDb()
  let job = db.jobs.find((item) => item.id === jobId)
  let podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  const user = job ? db.users.find((item) => item.id === job.userId) : null
  if (!job) return
  if (!podcast || !user) {
    await failPodcastJob(job.id, '播客或用户不存在')
    return
  }

  job.status = 'running'
  job.progress = 8
  job.message = '正在生成播客讲解脚本'
  job.startedAt = job.startedAt || new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  podcast.status = 'scripting'
  podcast.updatedAt = job.updatedAt
  await writeDb(db)

  let scriptResult = null
  try {
    scriptResult = await generatePodcastScript(podcast.sourceText, podcast.lexile || podcastLexileDefault, podcast.index || 1, normalizePodcastKind(podcast.kind))
  } catch (error) {
    await failPodcastJob(job.id, error.message || '播客脚本生成失败')
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return
  if (job.cancelRequested) {
    await failPodcastJob(job.id, '任务已取消')
    return
  }

  podcast.title = scriptResult.title || podcast.title
  podcast.scriptText = scriptResult.script
  podcast.scriptMode = scriptResult.mode
  podcast.scriptPartCount = scriptResult.partCount || 1
  podcast.status = 'synthesizing'
  podcast.updatedAt = new Date().toISOString()
  job.progress = 35
  job.message = '正在合成播客音频'
  job.updatedAt = podcast.updatedAt
  await writeDb(db)

  let audio = null
  try {
    audio = await synthesizePodcastAudio(podcast, async (percent, done, total) => {
      const progress = 35 + Math.round(percent * 0.6)
      await updatePodcastJobProgress(podcast.id, job.id, progress, `正在合成音频 ${done}/${total}`)
    })
  } catch (error) {
    await failPodcastJob(job.id, error.message || '播客音频合成失败')
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return

  podcast.audio = audio
  podcast.status = 'ready'
  podcast.updatedAt = new Date().toISOString()
  job.status = 'succeeded'
  job.progress = 100
  job.message = '播客已生成'
  job.finishedAt = podcast.updatedAt
  job.updatedAt = podcast.updatedAt
  await writeDb(db)
}

async function processJobQueue() {
  if (jobQueueActive) return
  jobQueueActive = true
  try {
    while (true) {
      let db = await readDb()
      let job = db.jobs.find((item) => ['generate-unit', 'generate-podcast'].includes(item.type) && item.status === 'queued')
      if (!job) break

      if (job.type === 'generate-podcast') {
        await processPodcastJob(job.id)
        continue
      }

      let unit = db.units.find((item) => item.id === job.unitId)
      const user = db.users.find((item) => item.id === job.userId)
      if (!unit || !user) {
        job.status = 'failed'
        job.error = '学习单元或用户不存在'
        job.finishedAt = new Date().toISOString()
        job.updatedAt = job.finishedAt
        await writeDb(db)
        continue
      }

      job.status = 'running'
      job.progress = 15
      job.message = '正在调用 AI 生成学习单元'
      job.startedAt = job.startedAt || new Date().toISOString()
      job.updatedAt = new Date().toISOString()
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'running',
        progress: job.progress,
        message: job.message,
      }
      await writeDb(db)

      let content = null
      let failure = ''
      try {
        content = await buildGeneratedContent(unit, {
          ...userSettings(db, user.id),
          readingLevel: job.settings?.readingLevel || userSettings(db, user.id).readingLevel,
          listeningLevel: job.settings?.listeningLevel || userSettings(db, user.id).listeningLevel,
        })
      } catch (error) {
        failure = error.message || '生成失败'
      }

      db = await readDb()
      job = db.jobs.find((item) => item.id === job.id)
      unit = db.units.find((item) => item.id === job.unitId)
      if (!job || !unit) continue

      if (job.cancelRequested) {
        job.status = 'canceled'
        job.progress = 100
        job.message = '任务已取消'
        job.finishedAt = new Date().toISOString()
        job.updatedAt = job.finishedAt
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'canceled',
          progress: 100,
          message: job.message,
          finishedAt: job.finishedAt,
        }
        await writeDb(db)
        continue
      }

      if (failure || !content) {
        job.status = 'failed'
        job.progress = 100
        job.error = failure || 'AI 未返回学习单元'
        job.message = '生成失败'
        job.finishedAt = new Date().toISOString()
        job.updatedAt = job.finishedAt
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'failed',
          progress: 100,
          message: job.message,
          error: job.error,
          finishedAt: job.finishedAt,
        }
        await writeDb(db)
        continue
      }

      const quality = assessContentQuality(content, unit)
      if (quality.status === 'review' && Number(job.retryCount || 0) < maxAutoRegenAttempts) {
        job.status = 'queued'
        job.progress = 0
        job.retryCount = Number(job.retryCount || 0) + 1
        job.qualityStatus = 'auto-retry'
        job.message = `质量检查未通过，自动重试 ${job.retryCount}/${maxAutoRegenAttempts}`
        job.updatedAt = new Date().toISOString()
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'queued',
          progress: 0,
          message: job.message,
        }
        await writeDb(db)
        continue
      }

      applyGeneratedContent(unit, content, { force: job.force })
      job.status = 'succeeded'
      job.progress = 100
      job.message = '学习单元已生成'
      job.qualityStatus = unit.quality?.status || ''
      job.finishedAt = new Date().toISOString()
      job.updatedAt = job.finishedAt
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'succeeded',
        progress: 100,
        message: job.message,
        finishedAt: job.finishedAt,
      }
      await writeDb(db)
    }
  } finally {
    jobQueueActive = false
  }
}

function uploadBookFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `文件不能超过 ${formatMegabytes(maxUploadBytes)}` })
      return
    }
    next(error)
  })
}

async function createApp() {
  await ensureStore()
  await ensureInitialAdmin()
  await recoverInterruptedJobs()
  cleanupExpiredLoginAttempts()
  cleanupExpiredSessions().catch((error) => console.error('session cleanup failed', error))
  const maintenanceTimer = setInterval(() => {
    cleanupExpiredLoginAttempts()
    cleanupRateLimitBuckets()
    cleanupExpiredSessions().catch((error) => console.error('session cleanup failed', error))
  }, 10 * 60 * 1000)
  maintenanceTimer.unref?.()
  const app = express()
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : Number(process.env.TRUST_PROXY) || false)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self' https: ws: wss:",
        "manifest-src 'self'",
        "form-action 'self'",
      ].join('; ')
    )
    next()
  })
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      storageDriver,
      version: process.env.npm_package_version || '0.0.0',
    })
  })

  app.get('/api/ready', async (_req, res, next) => {
    try {
      res.json(await storageHealth())
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const inviteCode = String(req.body.inviteCode || '')
    const loginFailureMessage = '邮箱或密码不正确，或当前不允许创建账号'
    if (!email || !password) {
      res.status(400).json({ error: '请输入邮箱和密码' })
      return
    }

    const limit = loginLimitStatus(req, email)
    if (limit.limited) {
      res.status(429).json({ error: '登录尝试过多，请稍后再试' })
      return
    }

    const db = await readDb()
    let user = db.users.find((item) => item.email === email)
    if (!user) {
      if (!canCreateUser(inviteCode)) {
        recordLoginFailure(limit.key)
        res.status(401).json({ error: loginFailureMessage })
        return
      }
      user = {
        id: nanoid(),
        email,
        name: email.split('@')[0] || 'Learner',
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      }
      db.users.push(user)
      userSettings(db, user.id)
    } else if (!verifyPassword(password, user.passwordHash)) {
      recordLoginFailure(limit.key)
      res.status(401).json({ error: loginFailureMessage })
      return
    }

    const token = nanoid(48)
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString()
    db.sessions.push({ token, userId: user.id, createdAt, expiresAt })
    await writeDb(db)
    clearLoginFailures(limit.key)
    res.json({ token, user: publicUser(user), settings: userSettings(db, user.id) })
  })

  app.get('/api/app', auth, async (req, res) => {
    const db = req.db
    const books = db.books
      .filter((book) => book.userId === req.user.id)
      .map((book) => summarizeBook(book, db.units.filter((unit) => unit.bookId === book.id)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

    res.json({
      user: publicUser(req.user),
      settings: userSettings(db, req.user.id),
      home: computeHome(db, req.user.id),
      books,
      vocabulary: db.vocabulary.filter((item) => item.userId === req.user.id),
      reports: db.reports.filter((item) => item.userId === req.user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      stats: computeStats(db, req.user.id),
    })
  })

  app.patch('/api/settings', auth, async (req, res) => {
    const db = req.db
    const settings = userSettings(db, req.user.id)
    const allowed = ['readingLevel', 'listeningLevel', 'studyMinutes', 'chineseAssist', 'aiSuggestions', 'keepSourceFiles', 'podcastLexile', 'podcastVoice']
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) settings[key] = req.body[key]
    }
    settings.readingLevel = normalizeLevel(readingLevels, settings.readingLevel, 'A2+')
    settings.listeningLevel = normalizeLevel(listeningLevels, settings.listeningLevel, 'A2')
    settings.podcastLexile = Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault)))
    settings.podcastVoice = String(settings.podcastVoice || 'Kore').trim() || 'Kore'
    await writeDb(db)
    res.json({ settings })
  })

  app.get('/api/security/status', auth, async (req, res) => {
    const db = req.db
    const activeJobs = db.jobs.filter((job) => job.userId === req.user.id && ['queued', 'running'].includes(job.status)).length
    res.json({
      security: {
        allowSignup,
        inviteRequired: Boolean(signupInviteCode),
        sessionDays,
        loginWindowMinutes: Math.round(loginWindowMs / 60000),
        loginMaxFailures,
      },
      deployment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        storageDriver,
        dataDir,
        backupDir: process.env.BACKUP_DIR || path.join(root, 'backups'),
        trustProxy: Boolean(process.env.TRUST_PROXY),
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        ttsConfigured: Boolean(process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY),
        ttsProvider: process.env.OPENAI_TTS_PROVIDER || 'openai-speech',
        podcastTtsConfigured: Boolean(process.env.GEMINI_TTS_API_KEY),
        maxUnitsPerBook: Number(process.env.MAX_UNITS_PER_BOOK || 240),
        maxPodcastEpisodes,
        maxActivePodcastJobs,
        maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024),
        maxEpubUploadMb: Math.round(maxEpubUploadBytes / 1024 / 1024),
        maxPdfUploadMb: Math.round(maxPdfUploadBytes / 1024 / 1024),
        rateLimitWindowMinutes: Math.round(rateLimitWindowMs / 60000),
        rateLimits: {
          generateUnits: aiRateLimits['generate-unit'].max,
          definitions: aiRateLimits['define-word'].max,
          audio: aiRateLimits['speech-audio'].max,
          podcasts: aiRateLimits['generate-podcast'].max,
        },
        activeJobs,
      },
    })
  })

  app.patch('/api/account/password', auth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '')
    const nextPassword = String(req.body.nextPassword || '')
    if (nextPassword.length < 8) {
      res.status(400).json({ error: '新密码至少需要 8 个字符' })
      return
    }
    if (!verifyPassword(currentPassword, req.user.passwordHash)) {
      res.status(401).json({ error: '当前密码不正确' })
      return
    }

    const db = req.db
    const user = db.users.find((item) => item.id === req.user.id)
    if (!user) {
      res.status(404).json({ error: '账号不存在' })
      return
    }
    user.passwordHash = hashPassword(nextPassword)
    user.passwordChangedAt = new Date().toISOString()
    db.sessions = db.sessions.filter((session) => session.token === req.token || session.userId !== user.id)
    await writeDb(db)
    res.json({ ok: true })
  })

  app.post('/api/books/upload', auth, uploadBookFile, async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: '请选择 EPUB 或 PDF 文件' })
        return
      }

      const original = req.file.originalname || 'book'
      const ext = path.extname(original).toLowerCase()
      if (!['.epub', '.pdf'].includes(ext)) {
        res.status(400).json({ error: '第一版仅支持 EPUB 和文字版 PDF' })
        return
      }
      if (ext === '.epub' && req.file.size > maxEpubUploadBytes) {
        res.status(400).json({ error: `EPUB 第一版建议不超过 ${formatMegabytes(maxEpubUploadBytes)}` })
        return
      }
      if (ext === '.pdf' && req.file.size > maxPdfUploadBytes) {
        res.status(400).json({ error: `PDF 第一版建议不超过 ${formatMegabytes(maxPdfUploadBytes)}` })
        return
      }

      const parsed = ext === '.epub' ? await parseEpub(req.file.buffer, original) : await parsePdf(req.file.buffer, original)
      const db = req.db
      const settings = userSettings(db, req.user.id)
      const bookId = nanoid()
      let sourcePath = ''
      if (settings.keepSourceFiles) {
        const userDir = path.join(uploadDir, req.user.id)
        await fs.mkdir(userDir, { recursive: true })
        sourcePath = path.join(userDir, `${bookId}${ext}`)
        await fs.writeFile(sourcePath, req.file.buffer)
      }

      const book = {
        id: bookId,
        userId: req.user.id,
        title: parsed.title,
        author: parsed.author,
        type: parsed.type,
        filename: original,
        sourcePath,
        chapterCount: parsed.chapters.length,
        wordCount: parsed.chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
        status: 'ready',
        createdAt: new Date().toISOString(),
      }
      const units = planUnits(bookId, parsed.chapters, parsed.type)
      db.books.push(book)
      db.units.push(...units)
      await writeDb(db)

      res.json({ book: summarizeBook(book, units), units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/books/:bookId', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({ book: summarizeBook(book, units), units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
  })

  app.patch('/api/books/:bookId', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const title = normalizeText(req.body.title || '').replace(/\s+/g, ' ').slice(0, 160)
    if (title.length < 1) {
      res.status(400).json({ error: '书名不能为空' })
      return
    }

    const previousTitle = book.title
    book.title = title
    book.updatedAt = new Date().toISOString()
    for (const report of db.reports.filter((item) => item.userId === req.user.id && item.bookId === book.id)) {
      report.bookTitle = title
    }
    for (const item of db.vocabulary.filter((entry) => entry.userId === req.user.id && entry.sourceBookTitle === previousTitle)) {
      item.sourceBookTitle = title
    }
    await writeDb(db)
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({ book: summarizeBook(book, units) })
  })

  app.post('/api/books/:bookId/pre-generate', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const maxBatch = Number(process.env.MAX_BATCH_GENERATE_UNITS || 5)
    const requested = Math.max(1, Math.min(maxBatch, Number(req.body.count || 3)))
    const settings = userSettings(db, req.user.id)
    const candidates = db.units
      .filter((unit) => unit.bookId === book.id && !unit.content && !activeGenerationJob(db, req.user.id, unit.id))
      .slice(0, requested)

    if (candidates.length && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit', candidates.length)) return

    const jobs = candidates.map((unit) =>
      enqueueGenerationJob(db, req.user.id, unit, settings, {
        readingLevel: req.body.readingLevel,
        listeningLevel: req.body.listeningLevel,
      })
    )
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    const units = db.units.filter((unit) => unit.bookId === book.id)
    res.json({
      book: summarizeBook(book, units),
      units: units.map((unit) => publicUnit(unit, db, req.user.id)),
      jobs: jobs.map(publicJob),
      enqueued: jobs.length,
      maxBatch,
    })
  })

  app.get('/api/books/:bookId/podcasts', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }
    const podcasts = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id)
      .sort(sortPodcasts)
      .map((podcast) => publicPodcast(podcast))
    res.json({ podcasts })
  })

  app.post('/api/books/:bookId/podcasts/generate', auth, async (req, res) => {
    const db = req.db
    const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
    if (!book) {
      res.status(404).json({ error: '未找到这本书' })
      return
    }

    const kind = normalizePodcastKind(req.body.kind)
    const existing = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
      .sort(sortPodcasts)
    const requestedCount = Math.max(0, Math.min(maxPodcastEpisodes, Number(req.body.count || 0)))
    const existingJobs = db.jobs.filter((job) => job.userId === req.user.id && job.type === 'generate-podcast' && existing.some((podcast) => podcast.id === job.podcastId))
    const kindHasActiveJob = existingJobs.some((job) => ['queued', 'running', 'paused'].includes(job.status))
    if (requestedCount && !req.body.force && kindHasActiveJob) {
      res.json({
        podcasts: existing.map((podcast) => publicPodcast(podcast)),
        jobs: existingJobs.map((job) => publicJobWithContext(job, db)),
        enqueued: 0,
      })
      return
    }
    if (existing.length && !req.body.force && !requestedCount) {
      res.json({ podcasts: existing.map((podcast) => publicPodcast(podcast)), jobs: existingJobs.map((job) => publicJobWithContext(job, db)), enqueued: 0 })
      return
    }

    const active = activePodcastJobs(db, req.user.id)
    if (active.length >= maxActivePodcastJobs) {
      res.status(429).json({ error: `播客生成任务较重，请等待当前 ${active.length} 个任务完成后再试` })
      return
    }

    const units = db.units.filter((unit) => unit.bookId === book.id)
    const groups = planPodcastEpisodes(book, units, kind)
    if (!groups.length) {
      res.status(400).json({ error: '这本书还没有可用于播客的正文单元' })
      return
    }

    const settings = userSettings(db, req.user.id)
    const now = new Date().toISOString()
    if (req.body.force && existing.length) {
      for (const podcast of existing) {
        await deletePodcastAudioFiles(podcast)
      }
      db.podcasts = db.podcasts.filter((item) => !(item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind))
      db.jobs = db.jobs.filter((job) => !(job.userId === req.user.id && job.type === 'generate-podcast' && existing.some((podcast) => podcast.id === job.podcastId)))
    }

    const kindLabel = podcastKindLabel(kind)
    const activeIndexes = new Set(
      (req.body.force ? [] : existing)
        .filter((podcast) => activePodcastJob(db, req.user.id, podcast.id))
        .map((podcast) => Number(podcast.index || 0))
    )
    const existingIndexes = new Set((req.body.force ? [] : existing).map((podcast) => Number(podcast.index || 0)))
    const plannedGroups = groups
      .map((group, index) => ({ group, index }))
      .filter((item) => req.body.force || (!existingIndexes.has(item.index + 1) && !activeIndexes.has(item.index + 1)))
      .slice(0, requestedCount || groups.length)

    if (!plannedGroups.length) {
      const current = db.podcasts
        .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
        .sort(sortPodcasts)
      res.json({ podcasts: current.map((podcast) => publicPodcast(podcast)), jobs: [], enqueued: 0, remaining: 0 })
      return
    }
    if (shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast', plannedGroups.length)) return

    const podcasts = plannedGroups.map(({ group, index }) => ({
      id: nanoid(),
      userId: req.user.id,
      bookId: book.id,
      index: index + 1,
      kind,
      kindLabel,
      title: kind === 'topic' ? kindLabel : `${kindLabel} ${index + 1}`,
      status: 'planned',
      sourceUnitIds: group.unitIds,
      sourceText: group.text,
      sourceWordCount: group.words,
      lexile: Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault))),
      voice: String(settings.podcastVoice || process.env.GEMINI_TTS_VOICE || 'Kore'),
      scriptText: null,
      scriptMode: '',
      scriptPartCount: 0,
      audio: null,
      progress: {
        positionSeconds: 0,
        completed: false,
        updatedAt: '',
      },
      jobId: '',
      error: '',
      createdAt: now,
      updatedAt: now,
    }))
    const jobs = podcasts.map((podcast) => enqueuePodcastJob(db, req.user.id, podcast))
    db.podcasts.push(...podcasts)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    const current = db.podcasts
      .filter((item) => item.bookId === book.id && item.userId === req.user.id && normalizePodcastKind(item.kind) === kind)
      .sort(sortPodcasts)
    res.json({
      podcasts: current.map((podcast) => publicPodcast(podcast)),
      jobs: jobs.map((job) => publicJobWithContext(job, db)),
      enqueued: jobs.length,
      remaining: Math.max(0, groups.length - current.length),
    })
  })

  app.delete('/api/podcasts/:podcastId', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    const active = activePodcastJob(db, req.user.id, podcast.id)
    if (active && ['queued', 'running', 'paused'].includes(active.status)) {
      active.status = 'canceled'
      active.cancelRequested = true
      active.progress = 100
      active.message = '任务已取消'
      active.finishedAt = new Date().toISOString()
      active.updatedAt = active.finishedAt
    }
    await deletePodcastAudioFiles(podcast)
    db.podcasts = db.podcasts.filter((item) => item.id !== podcast.id)
    await writeDb(db)
    res.json({ ok: true })
  })

  app.get('/api/podcasts/:podcastId', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    res.json({ podcast: publicPodcast(podcast, { includeScript: true }) })
  })

  app.post('/api/podcasts/:podcastId/retry', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    if (activePodcastJob(db, req.user.id, podcast.id)) {
      res.status(409).json({ error: '这集播客已经在生成中' })
      return
    }
    if (activePodcastJobs(db, req.user.id).length >= maxActivePodcastJobs) {
      res.status(429).json({ error: '播客生成任务较重，请稍后重试' })
      return
    }
    if (shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast')) return
    await deletePodcastAudioFiles(podcast)
    podcast.status = 'planned'
    podcast.audio = null
    podcast.error = ''
    podcast.progress = { positionSeconds: 0, completed: false, updatedAt: '' }
    podcast.updatedAt = new Date().toISOString()
    const job = enqueuePodcastJob(db, req.user.id, podcast)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    res.json({ podcast: publicPodcast(podcast), job: publicJobWithContext(job, db) })
  })

  app.patch('/api/podcasts/:podcastId/progress', auth, async (req, res) => {
    const db = req.db
    const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
    if (!podcast) {
      res.status(404).json({ error: '未找到这集播客' })
      return
    }
    const duration = Number(podcast.audio?.durationSeconds || 0)
    const positionSeconds = Math.max(0, Math.min(duration || 24 * 60 * 60, Number(req.body.positionSeconds || 0)))
    podcast.progress = {
      positionSeconds,
      completed: Boolean(req.body.completed) || (duration > 0 && positionSeconds >= duration - 3),
      updatedAt: new Date().toISOString(),
    }
    podcast.updatedAt = podcast.progress.updatedAt
    await writeDb(db)
    res.json({ podcast: publicPodcast(podcast) })
  })

  app.get('/api/podcasts/:podcastId/audio', auth, async (req, res, next) => {
    try {
      const db = req.db
      const podcast = db.podcasts.find((item) => item.id === req.params.podcastId && item.userId === req.user.id)
      if (!podcast || podcast.status !== 'ready' || !podcast.audio?.file) {
        res.status(404).json({ error: '未找到可播放的播客音频' })
        return
      }
      const audioPath = path.resolve(audioDir, podcast.audio.file)
      if (!audioPath.startsWith(path.resolve(audioDir))) {
        res.status(400).json({ error: '音频路径无效' })
        return
      }
      const format = podcast.audio.format || path.extname(podcast.audio.file).slice(1) || 'wav'
      res.setHeader('Content-Type', podcast.audio.contentType || podcastAudioContentType(format))
      res.setHeader('Cache-Control', 'no-store')
      if (req.query.download) {
        const safeTitle = `${String(podcast.title || `Podcast ${podcast.index}`).replace(/[^\w.-]+/g, '-')}.${format}`
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}"`)
      }
      res.sendFile(audioPath)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/generate', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book) {
        res.status(404).json({ error: '未找到学习单元' })
        return
      }

      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const content = await buildGeneratedContent(unit, generationSettingsFromBody(userSettings(db, req.user.id), req.body))
      applyGeneratedContent(unit, content, { force: req.body.force })
      await writeDb(db)
      res.json({ unit: publicUnit(unit, db, req.user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/generate-job', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }

    if (!activeGenerationJob(db, req.user.id, unit.id) && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
    const job = enqueueGenerationJob(db, req.user.id, unit, userSettings(db, req.user.id), req.body)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    res.json({ job: publicJobWithContext(job, db), unit: publicUnit(unit, db, req.user.id) })
  })

  app.post('/api/units/:unitId/versions/:versionId/restore', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }
    const versions = Array.isArray(unit.versions) ? unit.versions : []
    const version = versions.find((item, index) => (item.id || `version-${index}`) === req.params.versionId)
    if (!version?.content) {
      res.status(404).json({ error: '未找到这个历史版本' })
      return
    }

    saveUnitVersion(unit, 'restore-point')
    unit.content = version.content
    unit.title = version.title || version.content.title || unit.title
    unit.status = 'generated'
    unit.generatedAt = new Date().toISOString()
    unit.quality = version.quality || assessContentQuality(version.content, unit)
    unit.sourceRefs = unit.quality.sourceRefs
    unit.audio = null
    unit.generation = {
      ...(unit.generation || {}),
      status: 'succeeded',
      progress: 100,
      message: '已恢复历史版本',
      finishedAt: unit.generatedAt,
    }
    await writeDb(db)
    res.json({ unit: publicUnit(unit, db, req.user.id) })
  })

  app.get('/api/jobs/:jobId', auth, async (req, res) => {
    const db = req.db
    const job = db.jobs.find((item) => item.id === req.params.jobId && item.userId === req.user.id)
    if (!job) {
      res.status(404).json({ error: '未找到这个任务' })
      return
    }
    const unit = db.units.find((item) => item.id === job.unitId)
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === req.user.id)
    res.json({ job: publicJobWithContext(job, db), unit: publicUnit(unit, db, req.user.id), podcast: publicPodcast(podcast) })
  })

  app.get('/api/jobs', auth, async (req, res) => {
    const db = req.db
    const status = String(req.query.status || '')
    const jobs = db.jobs
      .filter((job) => job.userId === req.user.id && (!status || job.status === status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map((job) => publicJobWithContext(job, db))
    res.json({ jobs })
  })

  app.patch('/api/jobs/:jobId', auth, async (req, res) => {
    const db = req.db
    const job = db.jobs.find((item) => item.id === req.params.jobId && item.userId === req.user.id)
    if (!job) {
      res.status(404).json({ error: '未找到这个任务' })
      return
    }
    const unit = db.units.find((item) => item.id === job.unitId)
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === req.user.id)
    const action = String(req.body.action || '')
    const now = new Date().toISOString()

    if (action === 'pause' && job.status === 'queued') {
      job.status = 'paused'
      job.message = '任务已暂停'
      job.updatedAt = now
    } else if (action === 'resume' && job.status === 'paused') {
      job.status = 'queued'
      job.message = '已恢复排队'
      job.updatedAt = now
      setTimeout(processJobQueue, 0)
    } else if (action === 'cancel' && ['queued', 'paused'].includes(job.status)) {
      job.status = 'canceled'
      job.progress = 100
      job.message = '任务已取消'
      job.finishedAt = now
      job.updatedAt = now
      if (podcast) {
        podcast.status = 'failed'
        podcast.error = '任务已取消'
        podcast.updatedAt = now
      }
    } else if (action === 'cancel' && job.status === 'running') {
      job.cancelRequested = true
      job.message = '任务将在当前生成结束后取消'
      job.updatedAt = now
    } else if (action === 'retry' && ['failed', 'canceled'].includes(job.status)) {
      if (job.type === 'generate-podcast' && shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast')) return
      if (job.type !== 'generate-podcast' && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      job.status = 'queued'
      job.progress = 0
      job.error = ''
      job.cancelRequested = false
      job.retryCount = Number(job.retryCount || 0) + 1
      job.message = '已重新加入队列'
      job.finishedAt = null
      job.updatedAt = now
      if (unit) {
        unit.generation = {
          ...(unit.generation || {}),
          jobId: job.id,
          status: 'queued',
          progress: 0,
          message: job.message,
        }
      }
      if (podcast) {
        podcast.status = 'planned'
        podcast.error = ''
        podcast.updatedAt = now
      }
      setTimeout(processJobQueue, 0)
    } else if (action === 'retry' && job.status === 'succeeded' && unit) {
      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const settings = userSettings(db, req.user.id)
      const nextJob = enqueueGenerationJob(db, req.user.id, unit, settings, { force: Boolean(unit.content) })
      await writeDb(db)
      setTimeout(processJobQueue, 0)
      res.json({ job: publicJobWithContext(nextJob, db), unit: publicUnit(unit, db, req.user.id) })
      return
    } else {
      res.status(400).json({ error: '当前任务状态不支持这个操作' })
      return
    }

    if (unit && ['paused', 'canceled'].includes(job.status)) {
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: job.status,
        progress: job.progress || 0,
        message: job.message,
      }
    }
    await writeDb(db)
    res.json({ job: publicJobWithContext(job, db), unit: publicUnit(unit, db, req.user.id), podcast: publicPodcast(podcast) })
  })

  app.post('/api/words/define', auth, async (req, res, next) => {
    try {
      const term = String(req.body.term || '').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
      const sentence = String(req.body.sentence || '').trim()
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(term)) {
        res.status(400).json({ error: '请选择一个英文单词' })
        return
      }

      const db = req.db
      const key = definitionCacheKey(term, sentence)
      let definition = db.definitions.find((item) => item.userId === req.user.id && item.key === key)
      if (!definition) {
        if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'define-word')) return
        let detail
        try {
          detail = await generateWordDefinition(term, sentence)
        } catch {
          detail = fallbackDefinition(term)
        }

        definition = {
          id: nanoid(),
          key,
          userId: req.user.id,
          term: detail.term || term,
          meaningZh: detail.meaningZh || fallbackChineseMeaning(term),
          simpleEnglish: detail.simpleEnglish || fallbackDefinition(term).simpleEnglish,
          sentence: sentence.slice(0, 500),
          createdAt: new Date().toISOString(),
        }
        db.definitions.push(definition)
        await writeDb(db)
      }

      res.json({
        definition: {
          term: definition.term,
          meaningZh: definition.meaningZh,
          simpleEnglish: definition.simpleEnglish,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/units/:unitId/progress', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }
    res.json({ progress: publicProgress(getUnitProgress(db, req.user.id, unit.id)) })
  })

  app.patch('/api/units/:unitId/progress', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }
    const progress = ensureUnitProgress(db, req.user.id, unit.id)
    if (Object.prototype.hasOwnProperty.call(req.body, 'paragraphIndex')) {
      const maxParagraph = Math.max(0, (unit.content?.reading?.paragraphs?.length || 1) - 1)
      progress.paragraphIndex = Math.max(0, Math.min(maxParagraph, Number(req.body.paragraphIndex || 0)))
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'listeningCompleted')) progress.listeningCompleted = Boolean(req.body.listeningCompleted)
    if (Object.prototype.hasOwnProperty.call(req.body, 'answers') && typeof req.body.answers === 'object') progress.answers = req.body.answers || {}
    if (Object.prototype.hasOwnProperty.call(req.body, 'completed')) progress.completed = Boolean(req.body.completed)
    progress.updatedAt = new Date().toISOString()
    await writeDb(db)
    res.json({ progress: publicProgress(progress) })
  })

  app.post('/api/units/:unitId/complete', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book || !unit.content) {
      res.status(404).json({ error: '未找到可完成的学习单元' })
      return
    }

    const answers = req.body.answers || {}
    const questions = unit.content.questions || []
    const correctCount = questions.filter((question) => Number(answers[question.id]) === Number(question.answerIndex)).length
    const wrongQuestions = questions
      .filter((question) => Number(answers[question.id]) !== Number(question.answerIndex))
      .map((question) => ({ id: question.id, prompt: question.prompt, explanationZh: question.explanationZh }))
    const correctRate = questions.length ? correctCount / questions.length : 0
    const viewedWords = Array.isArray(req.body.viewedWords) ? req.body.viewedWords : []
    const vocabTerms = new Set([...viewedWords, ...(unit.content.vocabulary || []).slice(0, 5).map((item) => item.term)])

    for (const term of vocabTerms) {
      if (!term) continue
      const existing = db.vocabulary.find((item) => item.userId === req.user.id && item.term.toLowerCase() === String(term).toLowerCase())
      if (existing) {
        existing.seenCount += 1
        existing.lastSeenAt = new Date().toISOString()
        existing.dueAt = existing.dueAt || new Date().toISOString()
        existing.mastery = Number(existing.mastery || 0)
        existing.exampleSentence = existing.exampleSentence || exampleSentenceForTerm(unit.content, term)
      } else {
        const detail = (unit.content.vocabulary || []).find((item) => item.term.toLowerCase() === String(term).toLowerCase())
        db.vocabulary.push({
          id: nanoid(),
          userId: req.user.id,
          term,
          meaningZh: detail?.meaningZh || fallbackChineseMeaning(term),
          simpleEnglish: detail?.simpleEnglish || 'A word saved from your reading.',
          exampleSentence: exampleSentenceForTerm(unit.content, term),
          wrongQuestionCount: wrongQuestions.length,
          sourceBookTitle: book.title,
          seenCount: 1,
          mastery: 0,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          dueAt: new Date().toISOString(),
        })
      }
    }

    const report = {
      id: nanoid(),
      userId: req.user.id,
      bookId: book.id,
      unitId: unit.id,
      bookTitle: book.title,
      unitTitle: unit.title,
      correctCount,
      questionCount: questions.length,
      correctRate,
      newVocabularyCount: vocabTerms.size,
      wrongQuestions,
      suggestion: adaptiveSuggestion({ correctRate, newVocabularyCount: vocabTerms.size }, userSettings(db, req.user.id)),
      createdAt: new Date().toISOString(),
    }
    unit.status = 'completed'
    unit.completedAt = new Date().toISOString()
    const progress = ensureUnitProgress(db, req.user.id, unit.id)
    progress.answers = answers
    progress.completed = true
    progress.listeningCompleted = Boolean(req.body.listeningCompleted || progress.listeningCompleted)
    progress.paragraphIndex = Math.max(progress.paragraphIndex || 0, (unit.content.reading?.paragraphs?.length || 1) - 1)
    progress.updatedAt = new Date().toISOString()
    db.reports.push(report)
    report.levelAdjustment = applyAdaptiveLeveling(db, req.user.id)
    await writeDb(db)
    res.json({ report })
  })

  app.get('/api/vocabulary/export', auth, async (req, res) => {
    const db = req.db
    const format = String(req.query.format || 'csv').toLowerCase()
    const vocabulary = db.vocabulary.filter((item) => item.userId === req.user.id)
    if (format === 'anki') {
      const rows = vocabulary.map((item) => [
        item.term,
        item.meaningZh,
        item.simpleEnglish,
        item.exampleSentence || '',
        item.sourceBookTitle || '',
      ])
      const tsv = rows.map((row) => row.map(tsvCell).join('\t')).join('\n')
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="linguashelf-vocabulary.anki.tsv"')
      res.send(`\ufeff${tsv}`)
      return
    }

    const rows = [['term', 'meaning_zh', 'simple_english', 'example_sentence', 'source_book', 'mastery', 'seen_count']]
    for (const item of vocabulary) {
      rows.push([
        item.term,
        item.meaningZh,
        item.simpleEnglish,
        item.exampleSentence || '',
        item.sourceBookTitle || '',
        String(item.mastery || 0),
        String(item.seenCount || 1),
      ])
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="linguashelf-vocabulary.csv"')
    res.send(`\ufeff${csv}`)
  })

  app.patch('/api/vocabulary/:vocabId/review', auth, async (req, res) => {
    const db = req.db
    const item = db.vocabulary.find((entry) => entry.id === req.params.vocabId && entry.userId === req.user.id)
    if (!item) {
      res.status(404).json({ error: '未找到这个生词' })
      return
    }

    const result = req.body.result === 'known' ? 'known' : 'again'
    const currentMastery = Number(item.mastery || 0)
    item.mastery = result === 'known' ? Math.min(5, currentMastery + 1) : Math.max(0, currentMastery - 1)
    item.reviewCount = Number(item.reviewCount || 0) + 1
    item.lastReviewedAt = new Date().toISOString()

    const intervals = [1, 2, 4, 7, 14, 30]
    const days = result === 'known' ? intervals[item.mastery] || 30 : 1
    item.dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    await writeDb(db)
    res.json({ vocabulary: item, stats: computeStats(db, req.user.id) })
  })

  app.get('/api/units/:unitId/audio', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book || !unit.content) {
        res.status(404).json({ error: '未找到可生成音频的学习单元' })
        return
      }

      const audioRequest = buildSpeechAudioRequest(unit)
      if (!(await hasCachedSpeechAudio(audioRequest)) && shouldRateLimitSpeech() && !consumeUserQuota(req, res, 'speech-audio')) return
      const audio = await generateSpeechAudio(unit, audioRequest)
      unit.audio = {
        model: audio.model,
        voice: audio.voice,
        hash: audio.hash,
        format: audio.outputFormat,
        generatedAt: unit.audio?.hash === audio.hash ? unit.audio.generatedAt : new Date().toISOString(),
      }
      await writeDb(db)

      res.setHeader('Content-Type', audio.contentType)
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(audio.audioPath)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/logout', auth, async (req, res) => {
    const db = req.db
    db.sessions = db.sessions.filter((item) => item.token !== req.token)
    await writeDb(db)
    res.json({ ok: true })
  })

  app.use((error, _req, res, _next) => {
    console.error(error)
    const statusValue = Number(error.status || error.statusCode || 500)
    const status = Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : 500
    const message = status >= 500 && isProd ? '服务器出现错误' : error.message || '服务器出现错误'
    res.status(status).json({ error: message })
  })

  if (isProd) {
    app.use(express.static(path.join(root, 'dist')))
    app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  return app
}

createApp().then((app) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`LinguaShelf running at http://localhost:${port}`)
  })

  function shutdown(signal) {
    console.log(`Received ${signal}, shutting down...`)
    server.close(() => {
      closeStore()
      process.exit(0)
    })
    setTimeout(() => {
      closeStore()
      process.exit(1)
    }, 10000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})
