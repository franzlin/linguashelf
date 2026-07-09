import 'dotenv/config'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
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
const execFileAsync = promisify(execFile)
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data')
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(root, 'backups')
const uploadDir = path.join(dataDir, 'uploads')
const audioDir = path.join(dataDir, 'audio')
const dbPath = path.join(dataDir, 'db.json')
const sqlitePath = path.join(dataDir, 'app.sqlite')
const storageDriver = String(process.env.STORAGE_DRIVER || 'sqlite').toLowerCase()
const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5173)
const signupInviteCode = String(process.env.SIGNUP_INVITE_CODE || '')
const allowSignup = parseBoolean(process.env.ALLOW_SIGNUP, false)
const sessionDays = Number(process.env.SESSION_DAYS || 30)
const loginWindowMs = Number(process.env.LOGIN_WINDOW_MINUTES || 10) * 60 * 1000
const loginMaxFailures = Number(process.env.LOGIN_MAX_FAILURES || 8)
const passwordMinLength = Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH || 8))
const maxAutoRegenAttempts = Number(process.env.MAX_AUTO_REGEN_ATTEMPTS || 1)
const maxAutoFailureRetries = Math.max(0, Number(process.env.MAX_AUTO_FAILURE_RETRIES || 2))
const autoFailureRetryBaseSeconds = Math.max(30, Number(process.env.AUTO_FAILURE_RETRY_BASE_SECONDS || 180))
const maxUploadBytes = bytesFromMegabytes(process.env.MAX_UPLOAD_MB, 50)
const maxEpubUploadBytes = bytesFromMegabytes(process.env.MAX_EPUB_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))
const maxPdfUploadBytes = bytesFromMegabytes(process.env.MAX_PDF_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))
const maxEpubExpandedBytes = bytesFromMegabytes(process.env.MAX_EPUB_EXPANDED_MB, 200)
const maxEpubEntries = Number(process.env.MAX_EPUB_ENTRIES || 2000)
const sourceWordsPerUnit = Math.max(600, Math.min(3500, Number(process.env.SOURCE_WORDS_PER_UNIT || 1700)))
const sourceWordsMergeMin = Math.max(300, Math.min(sourceWordsPerUnit, Number(process.env.SOURCE_WORDS_MIN_PER_UNIT || Math.round(sourceWordsPerUnit * 0.7))))
const pdfOcrEnabled = parseBoolean(process.env.PDF_OCR_ENABLED, true)
const pdfOcrProvider = String(process.env.PDF_OCR_PROVIDER || 'hunyuan-first').toLowerCase()
const pdfOcrLanguage = String(process.env.PDF_OCR_LANGUAGE || 'eng')
const pdfOcrDpi = Math.max(120, Math.min(350, Number(process.env.PDF_OCR_DPI || 220)))
const pdfOcrMaxPages = Math.max(1, Number(process.env.PDF_OCR_MAX_PAGES || 120))
const pdfOcrCommandTimeoutMs = Math.max(10_000, Number(process.env.PDF_OCR_COMMAND_TIMEOUT_MS || 120_000))
const pdfOcrVisionModel = String(process.env.PDF_OCR_VISION_MODEL || 'hunyuan-ocr')
const pdfOcrVisionBaseUrl = openAiCompatibleBaseUrl(process.env.PDF_OCR_VISION_BASE_URL || process.env.GEMINI_TTS_BASE_URL || '')
const pdfOcrVisionApiKey = String(process.env.PDF_OCR_VISION_API_KEY || process.env.GEMINI_TTS_API_KEY || '')
const pdfOcrVisionDpi = Math.max(90, Math.min(220, Number(process.env.PDF_OCR_VISION_DPI || 110)))
const pdfOcrVisionMinWords = Math.max(10, Number(process.env.PDF_OCR_VISION_MIN_WORDS || 40))
const pdfSectionTargetWords = Math.max(1200, Number(process.env.PDF_SECTION_TARGET_WORDS || 3400))
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 60) * 60 * 1000
const podcastLexileDefault = Number(process.env.PODCAST_LEXILE_DEFAULT || 900)
const podcastLexileMin = 500
const podcastLexileMax = 1500
const maxPodcastEpisodes = Number(process.env.MAX_PODCAST_EPISODES || 12)
const maxActivePodcastJobs = Number(process.env.MAX_ACTIVE_PODCAST_JOBS || 2)
const geminiTtsInputTokenLimit = Math.max(1024, Number(process.env.GEMINI_TTS_INPUT_TOKEN_LIMIT || 8192))
const geminiTtsOutputTokenLimit = Math.max(1024, Number(process.env.GEMINI_TTS_OUTPUT_TOKEN_LIMIT || 16384))
const defaultPodcastTtsChunkTokens = Math.min(5500, Math.max(512, geminiTtsInputTokenLimit - 512))
const podcastTtsChunkTokens = Math.max(512, Math.min(geminiTtsInputTokenLimit - 256, Number(process.env.PODCAST_TTS_CHUNK_TOKENS || defaultPodcastTtsChunkTokens)))
const podcastTtsChunkChars = Math.min(20_000, Math.max(1200, Number(process.env.PODCAST_TTS_CHUNK_CHARS || 8000)))
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
  upload: { max: Number(process.env.RATE_LIMIT_UPLOAD_MAX || 8), windowMs: rateLimitWindowMs },
  'generate-unit': { max: Number(process.env.RATE_LIMIT_GENERATE_UNITS_MAX || 20), windowMs: rateLimitWindowMs },
  'define-word': { max: Number(process.env.RATE_LIMIT_DEFINITIONS_MAX || 120), windowMs: rateLimitWindowMs },
  'speech-audio': { max: Number(process.env.RATE_LIMIT_AUDIO_MAX || 30), windowMs: rateLimitWindowMs },
  'generate-podcast': { max: Number(process.env.RATE_LIMIT_PODCAST_EPISODES_MAX || 12), windowMs: rateLimitWindowMs },
  'service-test': { max: Number(process.env.RATE_LIMIT_SERVICE_TEST_MAX || 12), windowMs: rateLimitWindowMs },
}
const loginAttempts = new Map()
const actionRateBuckets = new Map()
const geminiTtsProviderCooldowns = new Map()
const dbSnapshotMeta = Symbol('dbSnapshotMeta')
let writeChain = Promise.resolve()
let activeOcrTasks = 0
let geminiOfficialTtsCursor = 0

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
  serviceChecks: [],
  errorLogs: [],
  aiUsage: [],
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
  const write = async () => {
    if (storageDriver === 'sqlite') {
      await ensureStore()
      writeSqliteChanges(db)
      return
    }
    await writeJsonSnapshot(db)
  }
  const nextWrite = writeChain.then(write, write)
  writeChain = nextWrite.catch(() => undefined)
  await nextWrite
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

function openAiCompatibleBaseUrl(value) {
  const base = String(value || '').replace(/\/+$/, '')
  if (!base) return ''
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function bytesFromMegabytes(value, fallbackMb) {
  const mb = Number(value)
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb
  return Math.round(safeMb * 1024 * 1024)
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function isPdfFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
}

async function isEpubFile(buffer) {
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
  return (
    (process.env.AI_PROVIDER || 'auto') !== 'mock' &&
    Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_TTS_OFFICIAL_API_KEY || process.env.GEMINI_TTS_API_KEY)
  )
}

function canCreateUser(inviteCode) {
  if (signupInviteCode) return inviteCode === signupInviteCode
  return allowSignup
}

function validatePasswordStrength(password) {
  if (String(password || '').length < passwordMinLength) return `密码至少需要 ${passwordMinLength} 个字符`
  return ''
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
    role: user.role || 'user',
    createdAt: user.createdAt,
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
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
      focusStudyMode: true,
      keepSourceFiles: true,
      podcastLexile: podcastLexileDefault,
      podcastVoice: process.env.GEMINI_TTS_VOICE || 'Kore',
    }
    db.settings.push(settings)
  }
  if (settings.focusStudyMode === undefined) settings.focusStudyMode = true
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

function estimateTextTokens(text) {
  const value = String(text || '')
  return Math.max(1, Math.ceil(value.length / 4))
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

function validateEpubZip(zip) {
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

function createMeasuredZipReader(zip) {
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

async function readZipText(zip, name) {
  return zip.file(name)?.async('string')
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

function formatPdfPageRange(startPage, endPage = startPage) {
  const start = Number(startPage || 0)
  const end = Number(endPage || start)
  if (!start) return ''
  return start === end ? `原文页码 ${start}` : `原文页码 ${start}-${end}`
}

function pdfSectionTitle(index) {
  return `PDF 区块 ${index}`
}

function isGenericPdfSectionTitle(title) {
  return /^PDF 区块 \d+$/i.test(String(title || '').trim())
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
      title: '',
      text,
      label: formatPdfPageRange(page.page, page.page),
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
      currentTitle = cleanPdfHeading(line, '')
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
    let sourcePages = usable
    let ocr = null
    if (!sourcePages.length) {
      const ocrResult = await withOcrSlot(() => ocrPdfFallback(buffer, inferPdfPageCount(result)))
      sourcePages = ocrResult.pages
      ocr = {
        provider: ocrResult.provider,
        pages: sourcePages.length,
        pagesAttempted: ocrResult.pagesAttempted,
      }
    }

    const chapters = groupPdfPages(sourcePages)
    if (!chapters.length) {
      throw new Error('PDF 已解析，但可用于生成学习单元的英文正文太少')
    }
    return {
      title: filename.replace(/\.[^.]+$/, ''),
      author: '',
      type: 'pdf',
      chapters,
      ocr,
    }
  } finally {
    await parser.destroy()
  }
}

async function withOcrSlot(task) {
  const maxConcurrent = Math.max(1, Number(process.env.MAX_ACTIVE_OCR_TASKS || 1))
  if (activeOcrTasks >= maxConcurrent) {
    throw new Error('OCR 队列正忙，请稍后再上传扫描版 PDF')
  }
  activeOcrTasks += 1
  try {
    return await task()
  } finally {
    activeOcrTasks -= 1
  }
}

function inferPdfPageCount(result) {
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

async function ocrPdfFallback(buffer, pageCount) {
  if (!pdfOcrEnabled) {
    throw new Error('这个 PDF 可能是扫描版或文字过少，当前服务器未开启 OCR')
  }
  const maxPages = Math.min(pageCount, pdfOcrMaxPages)
  const errors = []

  if (shouldUseVisionOcr()) {
    try {
      const pages = await ocrPdfPagesWithVision(buffer, maxPages)
      const cleaned = cleanPdfPages(pages).filter((page) => page.wordCount >= pdfOcrVisionMinWords)
      if (hasEnoughOcrText(cleaned)) {
        console.info(`PDF OCR completed with ${pdfOcrVisionModel}: ${cleaned.length}/${maxPages} pages`)
        return { pages: cleaned, provider: pdfOcrVisionModel, pagesAttempted: maxPages }
      }
      const message = `${pdfOcrVisionModel} 识别正文不足`
      errors.push(message)
      console.warn(`PDF OCR ${message}; falling back to tesseract`)
    } catch (error) {
      const message = `${pdfOcrVisionModel} 失败：${String(error?.message || error).slice(0, 160)}`
      errors.push(message)
      console.warn(`PDF OCR ${message}; falling back to tesseract`)
    }
  }

  const pages = await ocrPdfPagesWithTesseract(buffer, maxPages)
  const cleaned = cleanPdfPages(pages).filter((page) => page.wordCount >= 40)
  if (!hasEnoughOcrText(cleaned)) {
    const detail = errors.length ? `；${errors.join('；')}` : ''
    throw new Error(`OCR 没能识别出足够的英文正文，请确认 PDF 清晰、方向正确，且内容主要为英文${detail}`)
  }
  console.info(`PDF OCR completed with tesseract: ${cleaned.length}/${maxPages} pages`)
  return { pages: cleaned, provider: 'tesseract-ocr', pagesAttempted: maxPages }
}

function hasEnoughOcrText(pages) {
  return pages.reduce((total, page) => total + Number(page.wordCount || wordCount(page.text)), 0) >= 120
}

function shouldUseVisionOcr() {
  if (['tesseract', 'local', 'local-only'].includes(pdfOcrProvider)) return false
  return Boolean(pdfOcrVisionBaseUrl && pdfOcrVisionApiKey && pdfOcrVisionModel)
}

async function ocrPdfPagesWithVision(buffer, maxPages) {
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
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
  return pages
}

async function ocrPdfPagesWithTesseract(buffer, maxPages) {
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
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
  return pages
}

async function renderPdfPage(pdfPath, tmpDir, page, dpi) {
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

async function runVisionOcr(imagePath) {
  const imageBytes = await fs.readFile(imagePath)
  const response = await fetch(`${pdfOcrVisionBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pdfOcrVisionApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: pdfOcrVisionModel,
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

function messageContentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : item?.text || item?.content || ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

async function runOcrCommand(command, args) {
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

function normalizeOcrText(text) {
  return normalizeText(
    String(text || '')
      .replace(/[|]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  )
}

function groupPdfPages(pages) {
  const chapters = []
  let current = null
  let sequence = 0

  function startChapter(title, text, page) {
    sequence += 1
    const cleanHeading = cleanTitle(title, '')
    current = {
      id: nanoid(),
      title: cleanHeading || pdfSectionTitle(sequence),
      text,
      label: cleanHeading || pdfSectionTitle(sequence),
      startPage: page.page,
      endPage: page.page,
      pageLabel: formatPdfPageRange(page.page, page.page),
      sequence,
      wordCount: wordCount(text),
    }
    chapters.push(current)
  }

  function appendToCurrent(text, page) {
    current.text = normalizeText(`${current.text}\n\n${text}`)
    current.endPage = page.page
    current.pageLabel = formatPdfPageRange(current.startPage, current.endPage)
    current.wordCount = wordCount(current.text)
  }

  for (const page of pages) {
    for (const section of splitPdfPageIntoSections(page)) {
      const text = normalizeText(section.text)
      if (wordCount(text) < 40 && !section.title) continue
      const hasHeading = Boolean(section.title)
      const currentIsFull = current && wordCount(current.text) >= pdfSectionTargetWords
      if (!current || hasHeading || currentIsFull) {
        startChapter(section.title, text, page)
      } else {
        appendToCurrent(text, page)
      }
    }
  }

  return chapters
    .filter((chapter) => wordCount(chapter.text) >= 120)
    .map((chapter) => ({
      ...chapter,
      title: cleanTitle(chapter.title, pdfSectionTitle(chapter.sequence)),
      label: cleanTitle(chapter.label, pdfSectionTitle(chapter.sequence)),
      pageLabel: formatPdfPageRange(chapter.startPage, chapter.endPage),
      wordCount: wordCount(chapter.text),
    }))
}

function pdfUnitSourceLocation(chapter, partCount, partIndex) {
  const title = cleanTitle(chapter.title, chapter.label || '')
  const pageLabel = chapter.pageLabel || formatPdfPageRange(chapter.startPage, chapter.endPage)
  const main = title && !isGenericPdfSectionTitle(title) ? title : chapter.label || title || pdfSectionTitle(chapter.sequence || 1)
  const location = [main, pageLabel].filter(Boolean).join(' · ')
  return partCount > 1 ? `${location}，第 ${partIndex + 1} 部分` : location
}

function unitTitleFallback(chapter, sourceType) {
  if (sourceType === 'pdf' && isGenericPdfSectionTitle(chapter.title)) return 'Reading Unit'
  return chapter.title
}

function combineSourceLocations(parts) {
  const locations = parts.map((part) => part.sourceLocation).filter(Boolean)
  if (!locations.length) return ''
  if (locations.length === 1 || locations[0] === locations[locations.length - 1]) return locations[0]
  return `${locations[0]} → ${locations[locations.length - 1]}`
}

function mergeShortSourceParts(parts, targetWords = sourceWordsPerUnit) {
  const merged = []
  const maxWords = Math.round(targetWords * 1.18)
  let current = null

  function pushCurrent() {
    if (!current) return
    current.sourceLocation = combineSourceLocations(current.parts)
    merged.push(current)
    current = null
  }

  for (const part of parts) {
    const partWords = wordCount(part.sourceText)
    if (!current) {
      current = { ...part, parts: [part] }
      continue
    }
    const currentWords = wordCount(current.sourceText)
    if (currentWords < sourceWordsMergeMin && currentWords + partWords <= maxWords) {
      current.sourceText = normalizeText(`${current.sourceText}\n\n${part.sourceText}`)
      current.parts.push(part)
      current.sourceLocation = combineSourceLocations(current.parts)
    } else {
      pushCurrent()
      current = { ...part, parts: [part] }
    }
  }
  pushCurrent()

  if (merged.length >= 2) {
    const last = merged[merged.length - 1]
    const previous = merged[merged.length - 2]
    const lastWords = wordCount(last.sourceText)
    const previousWords = wordCount(previous.sourceText)
    if (lastWords < sourceWordsMergeMin && previousWords + lastWords <= maxWords) {
      previous.sourceText = normalizeText(`${previous.sourceText}\n\n${last.sourceText}`)
      previous.parts.push(...last.parts)
      previous.sourceLocation = combineSourceLocations(previous.parts)
      merged.pop()
    }
  }

  return merged.map(({ parts, ...part }) => part)
}

function planUnits(bookId, chapters, sourceType) {
  const rawParts = []
  const studyChapters = chapters.filter(isStudyChapter)
  const maxUnits = Number(process.env.MAX_UNITS_PER_BOOK || 240)

  for (const chapter of studyChapters) {
    const parts = splitIntoSourceUnits(chapter.text, sourceWordsPerUnit)
    parts.forEach((sourceText, index) => {
      const location =
        sourceType === 'pdf'
          ? pdfUnitSourceLocation(chapter, parts.length, index)
          : `${chapter.title}${parts.length > 1 ? `, section ${index + 1}` : ''}`

      rawParts.push({
        fallbackTitle: unitTitleFallback(chapter, sourceType),
        sourceLocation: location,
        sourceText,
      })
    })
  }

  const plannedParts = sourceType === 'pdf' ? mergeShortSourceParts(rawParts, sourceWordsPerUnit) : rawParts
  const units = plannedParts.map((part, index) => {
    const sourceText = part.sourceText
    const title = inferEnglishTitle(sourceText, part.fallbackTitle, index)
    return {
      id: nanoid(),
      bookId,
      title,
      status: 'planned',
      sourceLocation: part.sourceLocation,
      sourceText,
      sourceExcerpt: takeWords(sourceText, 180),
      sourceWordCount: wordCount(sourceText),
      createdAt: new Date().toISOString(),
      generatedAt: null,
      content: null,
    }
  })
  return units.slice(0, maxUnits)
}

async function rebuildBookUnitsFromSource(db, book) {
  if (!book?.sourcePath) {
    const error = new Error('这本书没有保留原始文件，无法重建单元')
    error.status = 409
    throw error
  }

  const existingUnits = db.units.filter((unit) => unit.bookId === book.id)
  const unitIds = new Set(existingUnits.map((unit) => unit.id))
  const hasGenerated = existingUnits.some((unit) => unit.content || unit.status !== 'planned')
  const hasProgress = db.progress.some((item) => unitIds.has(item.unitId))
  const hasReports = db.reports.some((item) => item.bookId === book.id || unitIds.has(item.unitId))
  const hasActiveJobs = db.jobs.some(
    (job) => (job.bookId === book.id || unitIds.has(job.unitId)) && ['queued', 'running', 'paused'].includes(job.status)
  )
  if (hasGenerated || hasProgress || hasReports || hasActiveJobs) {
    const error = new Error('这本书已有生成内容、学习进度或任务，暂不自动重建单元')
    error.status = 409
    throw error
  }

  const buffer = await fs.readFile(book.sourcePath)
  const parsed = book.type === 'epub' ? await parseEpub(buffer, book.filename) : await parsePdf(buffer, book.filename)
  const units = planUnits(book.id, parsed.chapters, parsed.type)
  db.units = db.units.filter((unit) => unit.bookId !== book.id)
  db.units.push(...units)
  db.jobs = db.jobs.filter((job) => job.bookId !== book.id && !unitIds.has(job.unitId))
  book.chapterCount = parsed.chapters.length
  book.wordCount = parsed.chapters.reduce((total, chapter) => total + Number(chapter.wordCount || wordCount(chapter.text)), 0)
  book.status = 'ready'
  book.updatedAt = new Date().toISOString()
  return {
    book,
    units,
    previousUnitCount: existingUnits.length,
  }
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
  const strictFidelityPrompt = buildStrictFidelityPrompt(unit, settings)
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
${strictFidelityPrompt}

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

function buildStrictFidelityPrompt(unit, settings = {}) {
  if (settings.fidelityMode !== 'strict') return ''
  const audit = unit?.quality?.fidelity?.audit || {}
  const unsupportedClaims = (audit.unsupportedClaims || []).slice(0, 8)
  const missingImportantIdeas = (audit.missingImportantIdeas || []).slice(0, 8)
  const missingKeywords = (unit?.quality?.fidelity?.missingKeywords || []).slice(0, 10)
  const unmappedParagraphs = (unit?.quality?.sourceMap || [])
    .filter((item) => !item.sourceRefs?.length)
    .map((item) => `reading paragraph ${item.readingParagraph}`)
    .slice(0, 8)
  const explicitRepairNotes = Array.isArray(settings.fidelityRepairNotes) ? settings.fidelityRepairNotes.slice(0, 10) : []

  const repairNotes = []
  if (unsupportedClaims.length) repairNotes.push(`Unsupported claims from the previous audit: ${unsupportedClaims.join(' | ')}`)
  if (missingImportantIdeas.length) repairNotes.push(`Important source ideas possibly missed: ${missingImportantIdeas.join(' | ')}`)
  if (missingKeywords.length) repairNotes.push(`Source keywords or ideas to preserve when genuinely central: ${missingKeywords.join(', ')}`)
  if (unmappedParagraphs.length) repairNotes.push(`Previous reading paragraphs without clear source mapping: ${unmappedParagraphs.join(', ')}`)
  repairNotes.push(...explicitRepairNotes.map((note) => `Latest failed draft issue: ${note}`))

  return `

Strict fidelity repair mode:
- The previous version was flagged for low source fidelity. Produce a more conservative version.
- Every reading paragraph must be traceable to the provided source. If a point is not directly supported, omit it.
- Do not add background facts, dates, motives, evaluations, examples, or causal explanations unless they appear in the source excerpt.
- Prefer cautious wording when the source is cautious. Preserve uncertainty and attribution.
- It is better to be slightly less smooth than to add unsupported content.
- In fidelityNote, explicitly state that this version was regenerated for strict source fidelity and uses only the provided source excerpt.
${repairNotes.map((note) => `- ${note}`).join('\n')}
`
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
    if (!isPathInside(audioPath, audioDir)) continue
    await fs.unlink(audioPath).catch(() => undefined)
  }
}

function isPathInside(targetPath, parentDir) {
  const target = path.resolve(targetPath)
  const parent = path.resolve(parentDir)
  return target === parent || target.startsWith(`${parent}${path.sep}`)
}

async function deleteUnitAudioFiles(unit) {
  const files = new Set()
  if (unit?.audio?.hash && unit?.audio?.format) files.add(`${unit.id}-${unit.audio.hash}.${unit.audio.format}`)
  try {
    const entries = await fs.readdir(audioDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(`${unit.id}-`)) files.add(entry.name)
    }
  } catch {
    // Audio cache may not exist yet.
  }
  for (const file of files) {
    const audioPath = path.resolve(audioDir, file)
    if (!isPathInside(audioPath, audioDir)) continue
    await fs.unlink(audioPath).catch(() => undefined)
  }
}

async function deleteSourceFileIfSafe(sourcePath) {
  if (!sourcePath) return
  const resolved = path.resolve(sourcePath)
  if (!isPathInside(resolved, uploadDir)) return
  await fs.unlink(resolved).catch(() => undefined)
}

function estimateTtsInputTokens(text) {
  const value = String(text || '').trim()
  if (!value) return 0
  const cjkChars = value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  const words = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0
  const nonCjkChars = Math.max(0, value.length - cjkChars)
  return Math.ceil(words * 1.35 + cjkChars + nonCjkChars / 12)
}

function fitsTtsChunk(text, maxChars, maxTokens) {
  const value = String(text || '').trim()
  return value.length <= maxChars && estimateTtsInputTokens(value) <= maxTokens
}

function splitOversizedTtsChunk(text, maxChars, maxTokens) {
  const chunks = []
  let current = ''
  const pieces = String(text || '').match(/\S+\s*/g) || []
  for (const piece of pieces) {
    const candidate = `${current}${piece}`.trim()
    if (current && !fitsTtsChunk(candidate, maxChars, maxTokens)) {
      chunks.push(current.trim())
      current = piece.trim()
    } else {
      current = candidate
    }

    while (current && !fitsTtsChunk(current, maxChars, maxTokens)) {
      const hardLimit = Math.max(1, Math.min(maxChars, Math.floor(current.length * 0.8)))
      let sliceAt = current.lastIndexOf(' ', hardLimit)
      if (sliceAt < Math.floor(hardLimit * 0.6)) sliceAt = hardLimit
      chunks.push(current.slice(0, sliceAt).trim())
      current = current.slice(sliceAt).trim()
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

function chunkTextForTts(text, maxChars = podcastTtsChunkChars, maxTokens = podcastTtsChunkTokens) {
  const sentences = String(text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\S+$/g) || []
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    const value = sentence.trim()
    if (!value) continue
    if (!fitsTtsChunk(value, maxChars, maxTokens)) {
      if (current) chunks.push(current)
      chunks.push(...splitOversizedTtsChunk(value, maxChars, maxTokens))
      current = ''
      continue
    }
    const candidate = current ? `${current} ${value}` : value
    if (current && !fitsTtsChunk(candidate, maxChars, maxTokens)) {
      chunks.push(current)
      current = value
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function mockPodcastPcm(scriptText) {
  const seconds = Math.max(6, Math.min(45, Math.round(wordCount(scriptText) / 2.4)))
  return silencePcm(seconds * 1000)
}

function geminiTtsApiUrl(baseUrl, model) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  const apiBase = normalized.endsWith('/v1beta') ? normalized : `${normalized}/v1beta`
  return `${apiBase}/models/${model}:generateContent`
}

function geminiTtsProviderKey(provider) {
  return `${provider.name}:${provider.keyId || 'default'}:${provider.model}:${provider.baseUrl}`
}

function shouldCooldownOfficialGeminiTts(message) {
  return /location is not supported|user location|FAILED_PRECONDITION|RESOURCE_EXHAUSTED|prepayment credits|quota|rate limit|status 429/i.test(
    String(message || '')
  )
}

function geminiPrimaryTtsLabel(baseUrl) {
  const value = String(baseUrl || '').toLowerCase()
  if (value.includes('yunwu.ai')) return 'Yunwu Gemini 3.1'
  if (value.includes('generativelanguage.googleapis.com')) return '官方 Gemini 3.1'
  return 'Gemini 3.1 主来源'
}

function parseApiKeyList(...values) {
  const keys = values
    .flatMap((value) => String(value || '').split(/[,\s;]+/))
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(keys)]
}

function apiKeyId(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 10)
}

function serviceEndpointHost(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ''))
    return url.host
  } catch {
    return String(baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0] || ''
  }
}

function geminiTtsPrimaryProviders() {
  const officialKeys = parseApiKeyList(process.env.GEMINI_TTS_OFFICIAL_API_KEY)
  const officialBaseUrl = process.env.GEMINI_TTS_OFFICIAL_BASE_URL || 'https://generativelanguage.googleapis.com'
  const primaryLabel = geminiPrimaryTtsLabel(officialBaseUrl)
  return officialKeys.map((apiKey, index) => ({
      name: 'official-gemini',
      label: officialKeys.length > 1 ? `${primaryLabel} #${index + 1}` : primaryLabel,
      baseUrl: officialBaseUrl,
      apiKey,
      keyId: apiKeyId(apiKey),
      model: process.env.GEMINI_TTS_OFFICIAL_MODEL || 'gemini-3.1-flash-tts-preview',
      maxInputTokens: geminiTtsInputTokenLimit,
      official: true,
    }))
}

function geminiTtsFallbackProvider() {
  const fallbackKey = String(process.env.GEMINI_TTS_API_KEY || '').trim()
  if (!fallbackKey) return null
  return {
    name: 'gemini-fallback',
    label: 'Gemini TTS 兜底',
    baseUrl: process.env.GEMINI_TTS_BASE_URL || 'https://api.futureppo.top',
    apiKey: fallbackKey,
    model: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
    maxInputTokens: Number(process.env.GEMINI_TTS_FALLBACK_INPUT_TOKEN_LIMIT || geminiTtsInputTokenLimit),
    official: /generativelanguage\.googleapis\.com/i.test(process.env.GEMINI_TTS_BASE_URL || ''),
  }
}

function geminiTtsProviders(options = {}) {
  const primaryProviders = geminiTtsPrimaryProviders()
  const fallback = geminiTtsFallbackProvider()
  if (options.preferFallback && fallback) {
    const now = Date.now()
    return [fallback, ...primaryProviders].filter((provider) => (geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0) <= now)
  }
  const providers = []
  if (primaryProviders.length > 1) {
    const offset = geminiOfficialTtsCursor % primaryProviders.length
    geminiOfficialTtsCursor += 1
    providers.push(...primaryProviders.slice(offset), ...primaryProviders.slice(0, offset))
  } else {
    providers.push(...primaryProviders)
  }
  if (fallback) providers.push(fallback)
  const now = Date.now()
  return providers.filter((provider) => (geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0) <= now)
}

async function requestGeminiTtsChunk(provider, text, voiceName) {
  const instruction = podcastTtsInstruction(provider)
  const input = `${instruction}\n\n${text}`
  const estimatedTokens = estimateTtsInputTokens(input)
  if (estimatedTokens > provider.maxInputTokens) {
    throw new Error(`${provider.label} 文本块超过输入 token 限制：约 ${estimatedTokens}/${provider.maxInputTokens}`)
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-goog-api-key': provider.apiKey,
  }
  if (!provider.official) headers.Authorization = `Bearer ${provider.apiKey}`

  const response = await fetch(geminiTtsApiUrl(provider.baseUrl, provider.model), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } },
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${provider.label} 失败：${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data || item.inline_data?.data)
  const inlineData = part?.inlineData || part?.inline_data
  if (!inlineData?.data) throw new Error(`${provider.label} 未返回音频数据`)
  return {
    pcm: Buffer.from(inlineData.data, 'base64'),
    provider: provider.label,
    model: provider.model,
    promptProfile: provider.name === 'official-gemini' ? 'gemini-3.1-podcast-director' : 'gemini-tts-fallback-clear',
    mimeType: inlineData.mimeType || inlineData.mime_type || '',
  }
}

function podcastTtsInstruction(provider) {
  if (provider?.name === 'official-gemini') {
    return (
      process.env.GEMINI_TTS_31_INSTRUCTIONS ||
      `You are narrating a serious single-host knowledge podcast for an adult Chinese learner of English.
Use a natural, professional audiobook voice: calm, warm, intelligent, and human.
Keep normal speed. Do not slow down artificially, because the material is already adapted for the learner.
Use subtle emphasis for historical, political, and economic concepts, but avoid theatrical acting.
Make sentence endings natural, with small rises for guiding questions and confident falls for conclusions.
Add short, natural pauses after dense ideas, transitions, names, dates, and lists of two or three key points.
Pronounce names, places, and institutions carefully and consistently.
Keep the tone faithful to the source: documentary, thoughtful, and precise. Do not add jokes, extra comments, or new facts.
Read the script exactly as written, but use prosody to make the structure clear.`
    )
  }

  return (
    process.env.GEMINI_TTS_FALLBACK_INSTRUCTIONS ||
    `Read in a clear, natural audiobook style for an adult English learner.
Use normal speed, careful articulation, and natural pauses.
Keep the tone warm, steady, and professional.
Do not sound robotic. Do not add extra words.`
  )
}

async function geminiTtsChunk(text, voiceName, options = {}) {
  const provider = process.env.AI_PROVIDER || 'auto'
  if (provider === 'mock') return { pcm: mockPodcastPcm(text), provider: 'mock', model: 'mock', mimeType: 'audio/l16; rate=24000; channels=1' }

  const providers = geminiTtsProviders(options)
  if (!providers.length) throw new Error('未配置 Gemini TTS API key')

  const errors = []
  for (const item of providers) {
    try {
      return await requestGeminiTtsChunk(item, text, voiceName)
    } catch (error) {
      const message = error?.message || String(error)
      errors.push(message)
      if (item.official && shouldCooldownOfficialGeminiTts(message)) {
        geminiTtsProviderCooldowns.set(geminiTtsProviderKey(item), Date.now() + 60 * 60 * 1000)
      }
      console.warn(`Gemini TTS provider failed, trying fallback: ${message}`)
    }
  }
  throw new Error(`Gemini TTS 全部来源失败：${errors.join(' | ')}`)
}

async function synthesizePodcastAudio(podcast, onProgress = async () => undefined, options = {}) {
  const voice = podcast.audio?.voice || podcast.voice || process.env.GEMINI_TTS_VOICE || 'Kore'
  const chunks = chunkTextForTts(podcast.scriptText || '')
  if (!chunks.length) throw new Error('脚本为空，无法合成')

  const concurrency = Math.max(1, Math.min(4, podcastTtsConcurrency))
  const pcmParts = new Array(chunks.length)
  const usedProviders = new Set()
  const usedModels = new Set()
  const usedPromptProfiles = new Set()
  let cursor = 0
  let done = 0

  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor
      cursor += 1
      const result = await geminiTtsChunk(chunks[index], voice, options)
      pcmParts[index] = result.pcm
      if (result.provider) usedProviders.add(result.provider)
      if (result.model) usedModels.add(result.model)
      if (result.promptProfile) usedPromptProfiles.add(result.promptProfile)
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
    provider: Array.from(usedProviders).join(' + '),
    model: Array.from(usedModels).join(' + '),
    promptProfile: Array.from(usedPromptProfiles).join(' + '),
    durationSeconds: audioFile.durationSeconds,
    chunkCount: chunks.length,
    generatedAt: new Date().toISOString(),
  }
}

function sanitizeServiceMessage(message) {
  return String(message || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza***')
    .slice(0, 360)
}

function serviceCheckFor(db, userId, serviceId) {
  return db.serviceChecks.find((item) => item.userId === userId && item.serviceId === serviceId) || null
}

function publicServiceCheck(check) {
  if (!check) return null
  return {
    serviceId: check.serviceId,
    status: check.status,
    message: check.message,
    latencyMs: check.latencyMs,
    checkedAt: check.checkedAt,
    provider: check.provider || '',
    model: check.model || '',
    endpointHost: check.endpointHost || '',
    mimeType: check.mimeType || '',
  }
}

function saveServiceCheck(db, userId, serviceId, result) {
  const now = new Date().toISOString()
  let check = serviceCheckFor(db, userId, serviceId)
  if (!check) {
    check = { id: nanoid(), userId, serviceId, createdAt: now }
    db.serviceChecks.push(check)
  }
  Object.assign(check, {
    status: result.status,
    message: sanitizeServiceMessage(result.message),
    latencyMs: Number(result.latencyMs || 0),
    checkedAt: now,
    provider: result.provider || '',
    model: result.model || '',
    endpointHost: result.endpointHost || '',
    mimeType: result.mimeType || '',
    updatedAt: now,
  })
  return publicServiceCheck(check)
}

function serviceStatusFrom(configured, check, warning = '') {
  if (!configured) return 'missing'
  if (check?.status === 'ok') return warning ? 'warning' : 'ok'
  if (check?.status === 'failed') return 'failed'
  return warning ? 'warning' : 'configured'
}

function publicGeminiProvider(provider, role) {
  if (!provider) return null
  const cooldownUntil = geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0
  return {
    role,
    label: provider.label,
    model: provider.model,
    endpointHost: serviceEndpointHost(provider.baseUrl),
    keyId: provider.keyId ? `#${provider.keyId.slice(0, 4)}` : '',
    cooldownUntil: cooldownUntil > Date.now() ? new Date(cooldownUntil).toISOString() : '',
  }
}

function buildAiServicesPayload(db, userId) {
  const textBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const ttsBaseUrl = process.env.OPENAI_TTS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const textConfigured = Boolean(process.env.OPENAI_API_KEY) || process.env.AI_PROVIDER === 'mock'
  const listeningTtsConfigured = Boolean(process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY) || process.env.AI_PROVIDER === 'mock'
  const primaryProviders = geminiTtsPrimaryProviders()
  const fallbackProvider = geminiTtsFallbackProvider()
  const primaryConfigured = primaryProviders.length > 0 || process.env.AI_PROVIDER === 'mock'
  const primaryCooldowns = primaryProviders
    .map((provider) => geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0)
    .filter((time) => time > Date.now())
  const primaryWarning = primaryCooldowns.length > 0 && primaryCooldowns.length >= primaryProviders.length ? '主来源暂时冷却，播客会走兜底来源' : ''
  const visionConfigured = shouldUseVisionOcr()
  const localOcrConfigured = pdfOcrEnabled
  const services = [
    {
      id: 'text-ai',
      title: '文本生成',
      role: '分级阅读、题目、生词解释、播客脚本',
      category: 'text',
      priority: '主服务',
      configured: textConfigured,
      status: serviceStatusFrom(textConfigured, serviceCheckFor(db, userId, 'text-ai')),
      provider: serviceEndpointHost(textBaseUrl),
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      endpointHost: serviceEndpointHost(textBaseUrl),
      details: [`Responses 接口`, `生成质量审稿：${process.env.QUALITY_AUDIT_MODE || 'auto'}`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'text-ai')),
    },
    {
      id: 'listening-tts',
      title: '听力预热 TTS',
      role: '学习单元里的先听后读音频',
      category: 'audio',
      priority: '独立服务',
      configured: listeningTtsConfigured,
      status: serviceStatusFrom(listeningTtsConfigured, serviceCheckFor(db, userId, 'listening-tts')),
      provider: process.env.OPENAI_TTS_PROVIDER || 'openai-speech',
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      endpointHost: serviceEndpointHost(ttsBaseUrl),
      details: [`音色：${String(process.env.OPENAI_TTS_VOICES || process.env.OPENAI_TTS_VOICE || 'marin')}`, `格式：${(process.env.OPENAI_TTS_MODEL || '').startsWith('mimo-') ? 'WAV' : 'MP3'}`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'listening-tts')),
    },
    {
      id: 'podcast-tts-primary',
      title: '播客 TTS 主来源',
      role: '播客 MP3 合成，当前优先使用 Yunwu/Gemini 3.1 兼容源',
      category: 'audio',
      priority: '第一优先',
      configured: primaryConfigured,
      status: serviceStatusFrom(primaryConfigured, serviceCheckFor(db, userId, 'podcast-tts-primary'), primaryWarning),
      provider: geminiPrimaryTtsLabel(process.env.GEMINI_TTS_OFFICIAL_BASE_URL || ''),
      model: process.env.GEMINI_TTS_OFFICIAL_MODEL || 'gemini-3.1-flash-tts-preview',
      endpointHost: serviceEndpointHost(process.env.GEMINI_TTS_OFFICIAL_BASE_URL || 'https://generativelanguage.googleapis.com'),
      details: [
        `Key 数量：${primaryProviders.length}`,
        `输入/输出上限：${formatServiceNumber(geminiTtsInputTokenLimit)} / ${formatServiceNumber(geminiTtsOutputTokenLimit)} tokens`,
        `分块：约 ${formatServiceNumber(podcastTtsChunkTokens)} tokens 或 ${formatServiceNumber(podcastTtsChunkChars)} 字`,
      ],
      providers: primaryProviders.map((provider) => publicGeminiProvider(provider, 'primary')),
      warning: primaryWarning,
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'podcast-tts-primary')),
    },
    {
      id: 'podcast-tts-fallback',
      title: '播客 TTS 兜底',
      role: '主来源失败时自动接手',
      category: 'audio',
      priority: '备用',
      configured: Boolean(fallbackProvider),
      status: serviceStatusFrom(Boolean(fallbackProvider), serviceCheckFor(db, userId, 'podcast-tts-fallback')),
      provider: fallbackProvider?.label || 'Gemini TTS 兜底',
      model: fallbackProvider?.model || process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
      endpointHost: serviceEndpointHost(fallbackProvider?.baseUrl || process.env.GEMINI_TTS_BASE_URL || ''),
      details: [`音色：${process.env.GEMINI_TTS_VOICE || 'Kore'}`, `并发：${Math.max(1, Math.min(4, podcastTtsConcurrency))} 块`],
      providers: fallbackProvider ? [publicGeminiProvider(fallbackProvider, 'fallback')] : [],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'podcast-tts-fallback')),
    },
    {
      id: 'vision-ocr',
      title: 'PDF 视觉 OCR',
      role: '扫描版 PDF 的优先识别来源',
      category: 'ocr',
      priority: 'Hunyuan 优先',
      configured: visionConfigured,
      status: serviceStatusFrom(visionConfigured, serviceCheckFor(db, userId, 'vision-ocr')),
      provider: pdfOcrProvider,
      model: pdfOcrVisionModel,
      endpointHost: serviceEndpointHost(pdfOcrVisionBaseUrl),
      details: [`视觉 DPI：${pdfOcrVisionDpi}`, `最少正文词：${pdfOcrVisionMinWords}`, `最多页数：${pdfOcrMaxPages}`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'vision-ocr')),
    },
    {
      id: 'local-ocr',
      title: '本地 OCR 兜底',
      role: '视觉 OCR 失败后使用 Tesseract',
      category: 'ocr',
      priority: '备用',
      configured: localOcrConfigured,
      status: serviceStatusFrom(localOcrConfigured, serviceCheckFor(db, userId, 'local-ocr')),
      provider: 'tesseract-ocr',
      model: pdfOcrLanguage,
      endpointHost: 'server-local',
      details: [`DPI：${pdfOcrDpi}`, `命令超时：${Math.round(pdfOcrCommandTimeoutMs / 1000)} 秒`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'local-ocr')),
    },
  ]
  const configuredCount = services.filter((service) => service.configured).length
  const healthyCount = services.filter((service) => ['ok', 'configured', 'warning'].includes(service.status)).length
  return {
    updatedAt: new Date().toISOString(),
    overview: {
      configured: configuredCount,
      total: services.length,
      healthy: healthyCount,
      activeCooldowns: primaryCooldowns.length,
      serviceTestLimit: aiRateLimits['service-test'].max,
      serviceTestWindowMinutes: Math.round(aiRateLimits['service-test'].windowMs / 60000),
    },
    services,
  }
}

function formatServiceNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

async function testTextAiService() {
  if (process.env.AI_PROVIDER === 'mock') return { message: 'Mock 文本服务可用', provider: 'mock', model: 'mock' }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('未配置文本生成 API key')
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
      input: 'Return only the word OK.',
      max_output_tokens: 16,
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`文本服务失败：${response.status} ${body.slice(0, 220)}`)
  }
  const data = await response.json()
  if (!getResponsesOutputText(data)) throw new Error('文本服务未返回内容')
  return { message: '文本生成接口可用', provider: serviceEndpointHost(baseUrl), model, endpointHost: serviceEndpointHost(baseUrl) }
}

async function testListeningTtsService() {
  if (process.env.AI_PROVIDER === 'mock') return { message: 'Mock 听力 TTS 可用', provider: 'mock', model: 'mock' }
  const ttsProvider = process.env.OPENAI_TTS_PROVIDER || 'openai-speech'
  const apiKey = process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('未配置听力预热 TTS API key')
  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
  const baseUrl = process.env.OPENAI_TTS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const outputFormat = ttsProvider === 'mimo' || model.startsWith('mimo-') ? 'wav' : 'mp3'
  const bytes =
    ttsProvider === 'mimo' || model.startsWith('mimo-')
      ? await generateMimoSpeech({
          baseUrl,
          apiKey,
          model,
          voice: resolveTtsVoice('service-test'),
          input: 'This is a short LinguaShelf listening warm-up voice check.',
          instructions: process.env.OPENAI_TTS_INSTRUCTIONS || 'Read naturally and clearly.',
          outputFormat,
        })
      : await generateOpenAISpeech({
          baseUrl,
          apiKey,
          model,
          voice: resolveTtsVoice('service-test'),
          input: 'This is a short LinguaShelf listening warm-up voice check.',
          instructions: process.env.OPENAI_TTS_INSTRUCTIONS || 'Read naturally and clearly.',
          outputFormat,
        })
  if (bytes.length < 600) throw new Error('听力预热 TTS 返回的音频过小')
  return { message: `听力预热 TTS 可用，返回 ${bytes.length} bytes`, provider: ttsProvider, model, endpointHost: serviceEndpointHost(baseUrl) }
}

async function testPodcastTtsProvider(provider) {
  if (process.env.AI_PROVIDER === 'mock') return { message: 'Mock 播客 TTS 可用', provider: 'mock', model: 'mock', mimeType: 'audio/l16' }
  if (!provider) throw new Error('未配置播客 TTS 来源')
  const result = await requestGeminiTtsChunk(
    provider,
    'Read this short LinguaShelf podcast voice check in a calm, clear, natural teaching voice.',
    process.env.GEMINI_TTS_VOICE || 'Kore'
  )
  if (result.pcm.length < 600) throw new Error(`${provider.label} 返回的音频过小`)
  return {
    message: `${provider.label} 可用，返回 ${result.pcm.length} bytes`,
    provider: result.provider,
    model: result.model,
    endpointHost: serviceEndpointHost(provider.baseUrl),
    mimeType: result.mimeType,
  }
}

async function commandLooksAvailable(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 5000, maxBuffer: 1024 * 1024 })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    return Boolean(error?.stdout || error?.stderr)
  }
}

async function runAiServiceTest(serviceId) {
  const started = Date.now()
  let result
  if (serviceId === 'text-ai') {
    result = await testTextAiService()
  } else if (serviceId === 'listening-tts') {
    result = await testListeningTtsService()
  } else if (serviceId === 'podcast-tts-primary') {
    const providers = geminiTtsPrimaryProviders()
    const active = providers.find((provider) => (geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0) <= Date.now())
    result = await testPodcastTtsProvider(active || providers[0])
  } else if (serviceId === 'podcast-tts-fallback') {
    result = await testPodcastTtsProvider(geminiTtsFallbackProvider())
  } else if (serviceId === 'vision-ocr') {
    if (!shouldUseVisionOcr()) throw new Error('未配置视觉 OCR 来源')
    result = {
      message: '视觉 OCR 配置完整；实际识别质量会在上传扫描 PDF 时验证',
      provider: pdfOcrProvider,
      model: pdfOcrVisionModel,
      endpointHost: serviceEndpointHost(pdfOcrVisionBaseUrl),
    }
  } else if (serviceId === 'local-ocr') {
    const tesseractOk = await commandLooksAvailable('tesseract', ['--version'])
    const popplerOk = await commandLooksAvailable('pdftoppm', ['-v'])
    if (!tesseractOk || !popplerOk) throw new Error(`本地 OCR 缺少组件：${!tesseractOk ? 'tesseract ' : ''}${!popplerOk ? 'pdftoppm' : ''}`.trim())
    result = { message: '本地 OCR 组件可用', provider: 'tesseract-ocr', model: pdfOcrLanguage, endpointHost: 'server-local' }
  } else {
    throw new Error('未知服务')
  }
  return {
    status: 'ok',
    latencyMs: Date.now() - started,
    ...result,
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

const glossaryCategoryLabels = {
  concept: '概念',
  person: '人名',
  place: '地名',
  institution: '机构/政权',
  term: '术语',
}

function cleanGlossaryTerm(value) {
  return normalizeText(value)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.()' -]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function countTermOccurrences(text, term) {
  const source = String(text || '').toLowerCase()
  const needle = String(term || '').toLowerCase()
  if (!source || !needle) return 0
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = source.match(new RegExp(`\\b${escaped}\\b`, 'g'))
  return matches ? matches.length : 0
}

function classifyProperNoun(term) {
  const value = String(term || '')
  const lower = value.toLowerCase()
  const institutionWords = [
    'government',
    'parliament',
    'congress',
    'council',
    'court',
    'company',
    'bank',
    'party',
    'army',
    'empire',
    'dynasty',
    'kingdom',
    'republic',
    'ministry',
    'committee',
    'university',
    'administration',
  ]
  const placeWords = ['city', 'province', 'state', 'river', 'fort', 'palace', 'gate', 'road', 'street', 'sea', 'bay', 'island', 'delhi', 'india', 'britain', 'england', 'europe', 'asia', 'america']
  if (institutionWords.some((word) => lower.includes(word))) return 'institution'
  if (placeWords.some((word) => lower.includes(word))) return 'place'
  const capitalizedParts = value.match(/\b[A-Z][a-z]+(?:'[a-z]+)?\b/g) || []
  if (capitalizedParts.length >= 2) return 'person'
  return 'place'
}

function extractProperNounCandidates(text, limit = 30) {
  const candidates = new Map()
  const matches = String(text || '').match(/\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:of|and|the|for|de|al|[A-Z][a-z]+|[A-Z]{2,})){0,4}\b/g) || []
  const blocked = new Set([
    'The',
    'This',
    'That',
    'These',
    'Those',
    'When',
    'Where',
    'After',
    'Before',
    'Because',
    'However',
    'English',
    'Reading',
    'Source',
    'Paragraph',
    'Chapter',
    'Section',
  ])

  for (const raw of matches) {
    const term = cleanGlossaryTerm(raw)
    if (!term || term.length < 4 || blocked.has(term)) continue
    if (/^(The|This|That|When|Where|After|Before)\s+[a-z]/.test(term)) continue
    const words = term.split(/\s+/)
    if (words.length === 1 && !/[A-Z]{2,}/.test(term) && countTermOccurrences(text, term) < 2) continue
    const key = term.toLowerCase()
    candidates.set(key, {
      term,
      category: classifyProperNoun(term),
      count: (candidates.get(key)?.count || 0) + 1,
    })
  }

  return [...candidates.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

function buildBookGlossary(book, units) {
  const entries = new Map()
  const addEntry = (termValue, category, unit, extra = {}) => {
    const term = cleanGlossaryTerm(termValue)
    if (!term || term.length < 3) return
    const key = term.toLowerCase()
    const sourceText = `${unit?.sourceText || ''}\n${JSON.stringify(unit?.content || {})}`
    const occurrence = countTermOccurrences(sourceText, term)
    const existing =
      entries.get(key) || {
        id: key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || nanoid(),
        term,
        category,
        categoryLabel: glossaryCategoryLabels[category] || glossaryCategoryLabels.term,
        meaningZh: '',
        simpleEnglish: '',
        occurrenceCount: 0,
        unitCount: 0,
        sources: [],
        sourceTitles: new Set(),
      }
    existing.category = existing.category === 'term' && category !== 'term' ? category : existing.category
    existing.categoryLabel = glossaryCategoryLabels[existing.category] || glossaryCategoryLabels.term
    existing.meaningZh = existing.meaningZh || extra.meaningZh || extra.chinese || ''
    existing.simpleEnglish = existing.simpleEnglish || extra.simpleEnglish || ''
    existing.occurrenceCount += Math.max(1, occurrence)
    if (unit?.id && !existing.sourceTitles.has(unit.id)) {
      existing.sourceTitles.add(unit.id)
      existing.unitCount += 1
      existing.sources.push({
        unitId: unit.id,
        unitTitle: unit.title,
        sourceLocation: unit.sourceLocation,
      })
    }
    entries.set(key, existing)
  }

  for (const unit of units) {
    for (const concept of unit.content?.concepts || []) addEntry(concept.term, 'concept', unit, concept)
    for (const item of unit.content?.vocabulary || []) addEntry(item.term, 'term', unit, item)
    for (const candidate of extractProperNounCandidates(`${unit.sourceText || ''}\n${unit.sourceExcerpt || ''}`, 20)) {
      addEntry(candidate.term, candidate.category, unit)
    }
  }

  const categoryOrder = ['concept', 'person', 'place', 'institution', 'term']
  const items = [...entries.values()]
    .map((item) => {
      const { sourceTitles, ...safeItem } = item
      return {
        ...safeItem,
        sources: safeItem.sources.slice(0, 4),
      }
    })
    .filter((item) => item.occurrenceCount >= 2 || item.category === 'concept' || item.category === 'term')
    .sort((a, b) => {
      const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      if (categoryDiff) return categoryDiff
      return b.occurrenceCount - a.occurrenceCount || a.term.localeCompare(b.term)
    })
    .slice(0, 80)

  return {
    bookId: book.id,
    itemCount: items.length,
    generatedUnitCount: units.filter((unit) => unit.content).length,
    sourceUnitCount: units.length,
    items,
  }
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

function contentMetrics(content) {
  const readingParagraphs = content?.reading?.paragraphs || []
  const readingText = readingParagraphs.map((paragraph) => paragraph.text).join(' ')
  return {
    title: content?.title || '',
    readingLevel: content?.level?.reading || '',
    listeningLevel: content?.level?.listening || '',
    readingWords: wordCount(readingText),
    listeningWords: wordCount(content?.listening?.text || ''),
    paragraphCount: readingParagraphs.length,
    questionCount: content?.questions?.length || 0,
  }
}

function buildVersionDiff(version, unit) {
  const previous = version?.content
  const current = unit?.content
  if (!previous || !current) return null

  const previousMetrics = contentMetrics(previous)
  const currentMetrics = contentMetrics(current)
  const previousParagraphs = previous.reading?.paragraphs || []
  const currentParagraphs = current.reading?.paragraphs || []
  const maxParagraphs = Math.max(previousParagraphs.length, currentParagraphs.length)
  const paragraphDiffs = []
  let changedParagraphs = 0

  for (let index = 0; index < maxParagraphs; index += 1) {
    const previousText = previousParagraphs[index]?.text || ''
    const currentText = currentParagraphs[index]?.text || ''
    const similarity = previousText && currentText ? textKeywordSimilarity(previousText, currentText) : previousText === currentText ? 1 : 0
    const previousWords = wordCount(previousText)
    const currentWords = wordCount(currentText)
    const changed = normalizeClaimText(previousText) !== normalizeClaimText(currentText)
    if (changed) changedParagraphs += 1
    paragraphDiffs.push({
      paragraph: index + 1,
      changed,
      similarity: Number(similarity.toFixed(2)),
      wordDelta: currentWords - previousWords,
      previousPreview: takeWords(previousText, 45),
      currentPreview: takeWords(currentText, 45),
    })
  }

  const previousScore = version.quality?.fidelity?.audit?.score
  const currentScore = unit.quality?.fidelity?.audit?.score
  return {
    previous: previousMetrics,
    current: currentMetrics,
    summary: {
      titleChanged: previousMetrics.title !== currentMetrics.title,
      levelChanged:
        previousMetrics.readingLevel !== currentMetrics.readingLevel || previousMetrics.listeningLevel !== currentMetrics.listeningLevel,
      changedParagraphs,
      wordDelta: currentMetrics.readingWords - previousMetrics.readingWords,
      listeningWordDelta: currentMetrics.listeningWords - previousMetrics.listeningWords,
      questionDelta: currentMetrics.questionCount - previousMetrics.questionCount,
      fidelityScoreDelta:
        previousScore !== undefined && currentScore !== undefined ? Number((Number(currentScore) - Number(previousScore)).toFixed(2)) : null,
    },
    paragraphDiffs,
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
    diff: buildVersionDiff(version, unit),
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
  const failedJobs = db.jobs
    .filter((job) => job.userId === userId && job.status === 'failed')
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, 3)

  return {
    continueBook: continueBook ? summarizeBook(continueBook, userUnits.filter((unit) => unit.bookId === continueBook.id)) : null,
    continueUnit: publicUnit(continueUnit, db, userId),
    recentBooks: userBooks.slice(0, 3).map((book) => summarizeBook(book, userUnits.filter((unit) => unit.bookId === book.id))),
    latestReport: latestReport || null,
    activeJobs: activeJobs.map(publicJob),
    failedJobs: failedJobs.map((job) => publicJobWithContext(job, db)),
  }
}

function computeStats(db, userId) {
  const reports = db.reports
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
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
  const readingMinutes = reports.reduce((total, report) => total + reportStudyMinutes(report, settings), 0)
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
    const item = dailyMap.get(date) || { date, units: 0, words: 0, correctRate: 0, minutes: 0 }
    item.units += 1
    item.words += Number(report.newVocabularyCount || 0)
    item.correctRate += Number(report.correctRate || 0)
    item.minutes += reportStudyMinutes(report, settings)
    dailyMap.set(date, item)
  }
  const calendar = buildDailySeries(dailyMap, now, 14)
  const activity = buildDailySeries(dailyMap, now, 30)
  const vocabularyGrowth = computeVocabularyGrowth(vocabulary, reports, now)
  const difficultyTrend = buildDifficultyTrend(reports, settings)
  const lastDifficulty = difficultyTrend[difficultyTrend.length - 1]
  const previousDifficulty = difficultyTrend.length > 1 ? difficultyTrend[difficultyTrend.length - 2] : null
  const readingDelta = previousDifficulty ? levelIndex(readingLevels, lastDifficulty.readingLevel) - levelIndex(readingLevels, previousDifficulty.readingLevel) : 0
  const listeningDelta = previousDifficulty
    ? levelIndex(listeningLevels, lastDifficulty.listeningLevel) - levelIndex(listeningLevels, previousDifficulty.listeningLevel)
    : 0
  const weeklyReadingMinutes = activity.slice(-7).reduce((total, item) => total + Number(item.minutes || 0), 0)
  const todayCompleted = dailyMap.get(today)?.units || 0
  const todayReadingMinutes = dailyMap.get(today)?.minutes || 0
  const dailyGoalMinutes = Math.max(1, Math.round(Number(settings.studyMinutes || 10)))
  const dailyGoalUnits = Math.max(1, Math.round(dailyGoalMinutes / 10))
  const todayGoalMet = todayReadingMinutes >= dailyGoalMinutes || todayCompleted >= dailyGoalUnits
  const dueTomorrow = vocabulary.filter((item) => {
    const due = Date.parse(item.dueAt || '')
    return Number.isFinite(due) && due > now && due <= now + 24 * 60 * 60 * 1000
  }).length
  const dueThisWeek = vocabulary.filter((item) => {
    const due = Date.parse(item.dueAt || '')
    return !item.dueAt || (Number.isFinite(due) && due <= now + 7 * 24 * 60 * 60 * 1000)
  }).length
  const weakVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) <= 1).length
  const learningVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) < 4).length
  const reviewPlan = {
    dueToday: dueVocabulary,
    dueTomorrow,
    dueThisWeek,
    mastered: masteredVocabulary,
    learning: learningVocabulary,
    weak: weakVocabulary,
    message: dueVocabulary
      ? `今天有 ${dueVocabulary} 个生词到期，先复习会让阅读更轻。`
      : dueTomorrow
        ? `明天有 ${dueTomorrow} 个生词到期，今天可以继续阅读。`
        : '当前没有到期生词，可以把时间留给阅读。'
  }
  const recommendation = dueVocabulary
    ? {
        title: '先复习到期生词',
        body: `有 ${dueVocabulary} 个词已经到复习时间，处理完再读新材料会更稳。`,
        actionLabel: '去生词本',
        view: 'vocabulary',
      }
    : todayGoalMet
      ? {
          title: '今天目标已完成',
          body: '可以轻量听一集播客，或者留到明天继续。',
          actionLabel: '查看数据',
          view: 'dashboard',
        }
      : {
          title: '继续下一篇阅读',
          body: `今日目标 ${dailyGoalMinutes} 分钟，目前约 ${todayReadingMinutes} 分钟。`,
          actionLabel: '回到首页',
          view: 'home',
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
    todayCompleted,
    dailyGoalUnits,
    dailyGoalMinutes,
    todayGoalMet,
    streakDays,
    calendar,
    readingMinutes,
    todayReadingMinutes,
    weeklyReadingMinutes,
    activity,
    vocabularyGrowth,
    reviewPlan,
    recommendation,
    difficultyTrend,
    difficultySummary: {
      readingLevel: lastDifficulty?.readingLevel || settings.readingLevel,
      listeningLevel: lastDifficulty?.listeningLevel || settings.listeningLevel,
      readingDelta,
      listeningDelta,
      message: difficultyTrend.length
        ? difficultySummaryMessage(readingDelta, listeningDelta)
        : '完成单元后会开始记录难度变化。',
    },
  }
}

function reportStudyMinutes(report, settings) {
  return Math.max(1, Math.round(Number(report.studyMinutes || settings.studyMinutes || 10)))
}

function buildDailySeries(dailyMap, now, days) {
  const items = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const item = dailyMap.get(date) || { date, units: 0, words: 0, correctRate: 0, minutes: 0 }
    items.push({ ...item, correctRate: item.units ? item.correctRate / item.units : 0 })
  }
  return items
}

function computeVocabularyGrowth(vocabulary, reports, now) {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000
  const windowStart = now - 29 * 24 * 60 * 60 * 1000
  const dailyAdds = new Map()
  for (const item of vocabulary) {
    const createdAt = Date.parse(item.createdAt || item.lastSeenAt || '')
    if (!createdAt) continue
    const date = new Date(createdAt).toISOString().slice(0, 10)
    dailyAdds.set(date, (dailyAdds.get(date) || 0) + 1)
  }
  let runningTotal = vocabulary.filter((item) => {
    const createdAt = Date.parse(item.createdAt || item.lastSeenAt || '')
    return createdAt && createdAt < windowStart
  }).length
  const daily = []
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const added = dailyAdds.get(date) || 0
    runningTotal += added
    daily.push({ date, added, total: runningTotal })
  }
  const addedThisWeek = vocabulary.filter((item) => Date.parse(item.createdAt || item.lastSeenAt || '') >= weekAgo).length
  const addedThisMonth = vocabulary.filter((item) => Date.parse(item.createdAt || item.lastSeenAt || '') >= monthAgo).length
  return {
    total: vocabulary.length,
    addedThisWeek,
    addedThisMonth,
    averagePerUnit: reports.length ? vocabulary.length / reports.length : 0,
    daily,
  }
}

function buildDifficultyTrend(reports, settings) {
  return reports.slice(-16).map((report) => {
    const readingLevel =
      report.readingLevel ||
      report.levelAdjustment?.from?.readingLevel ||
      report.levelAdjustment?.readingLevel ||
      settings.readingLevel
    const listeningLevel =
      report.listeningLevel ||
      report.levelAdjustment?.from?.listeningLevel ||
      report.levelAdjustment?.listeningLevel ||
      settings.listeningLevel
    return {
      date: String(report.createdAt || '').slice(0, 10),
      unitTitle: report.unitTitle,
      readingLevel: normalizeLevel(readingLevels, readingLevel, settings.readingLevel),
      listeningLevel: normalizeLevel(listeningLevels, listeningLevel, settings.listeningLevel),
      correctRate: Number(report.correctRate || 0),
      newVocabularyCount: Number(report.newVocabularyCount || 0),
    }
  })
}

function levelIndex(levels, level) {
  const index = levels.indexOf(level)
  return index === -1 ? 0 : index
}

function difficultySummaryMessage(readingDelta, listeningDelta) {
  if (readingDelta > 0 || listeningDelta > 0) return '最近难度有上调，继续观察正确率和生词负担。'
  if (readingDelta < 0 || listeningDelta < 0) return '最近难度有下调，先把理解稳定下来。'
  return '最近难度保持稳定。'
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

function matchedKeywordsForSource(readingText, sourceItem, limit = 10) {
  const readingKeywords = new Set(extractKeywords(readingText, 24))
  if (!readingKeywords.size || !sourceItem?.keywords?.size) return []
  const matched = []
  for (const keyword of readingKeywords) {
    if (sourceItem.keywords.has(keyword)) matched.push(keyword)
  }
  return matched.slice(0, limit)
}

function textKeywordSimilarity(a, b) {
  const left = new Set(extractKeywords(a, 24))
  const right = new Set(extractKeywords(b, 24))
  if (!left.size || !right.size) return 0
  let overlap = 0
  for (const word of left) {
    if (right.has(word)) overlap += 1
  }
  return overlap / Math.max(1, Math.min(left.size, right.size))
}

function normalizeClaimText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSuspiciousSentence(item) {
  if (!item) return null
  if (typeof item === 'string') {
    return { readingParagraph: 0, sentence: item, reason: 'AI 审稿认为这句话可能缺少原文支持', sourceParagraphs: [] }
  }
  const sentence = String(item.sentence || item.claim || '').trim()
  if (!sentence) return null
  return {
    readingParagraph: Number(item.readingParagraph || 0),
    sentence,
    reason: String(item.reason || 'AI 审稿认为这句话可能缺少原文支持'),
    sourceParagraphs: Array.isArray(item.sourceParagraphs) ? item.sourceParagraphs.map(String) : [],
  }
}

function suspiciousSentencesForParagraph(content, audit, paragraphIndex) {
  const paragraph = content?.reading?.paragraphs?.[paragraphIndex]
  const sentences = splitSentences(paragraph?.text || '')
  if (!sentences.length) return []

  const candidates = [
    ...((audit?.suspiciousSentences || []).map(normalizeSuspiciousSentence).filter(Boolean)),
    ...((audit?.unsupportedClaims || []).map(normalizeSuspiciousSentence).filter(Boolean)),
  ]
  const output = []
  for (const candidate of candidates) {
    const requestedIndex = Number(candidate.readingParagraph || 0)
    let bestSentence = ''
    let bestScore = 0
    const claim = normalizeClaimText(candidate.sentence)
    for (const sentence of sentences) {
      const normalizedSentence = normalizeClaimText(sentence)
      const direct = claim && normalizedSentence.includes(claim.slice(0, Math.min(80, claim.length))) ? 1 : 0
      const score = Math.max(direct, textKeywordSimilarity(candidate.sentence, sentence))
      if (score > bestScore) {
        bestScore = score
        bestSentence = sentence
      }
    }
    const matchesRequestedParagraph = !requestedIndex || requestedIndex === paragraphIndex + 1
    if (bestSentence && matchesRequestedParagraph && bestScore >= 0.18) {
      output.push({
        sentence: bestSentence,
        reason: candidate.reason,
        sourceParagraphs: candidate.sourceParagraphs,
        confidence: Number(bestScore.toFixed(2)),
      })
    }
  }

  const seen = new Set()
  return output.filter((item) => {
    const key = normalizeClaimText(item.sentence)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    const confidence = ranked[0]?.score || 0
    const suspiciousSentences = suspiciousSentencesForParagraph(content, content?.qualityAudit, index)
    const status = !ranked.length || confidence < 0.12 || suspiciousSentences.length ? 'review' : 'ok'
    const output = {
      readingParagraph: index + 1,
      status,
      confidence: Number(confidence.toFixed(2)),
      generatedExcerpt: takeWords(paragraph.text || '', 90),
      suspiciousSentences,
      sourceRefs: ranked.map(({ source, score }) => ({
        id: `${unit.id}-map-${index + 1}-${source.index + 1}`,
        label: `${unit.sourceLocation}, 段落 ${source.index + 1}`,
        sourceParagraphIndex: source.index + 1,
        excerpt: takeWords(source.text, 110),
        wordCount: source.wordCount,
        keywordOverlap: Number(score.toFixed(2)),
        matchedKeywords: matchedKeywordsForSource(paragraph.text || '', source),
      })),
      coverageNote: ranked.length
        ? confidence >= 0.25
          ? '关键词覆盖较充分，适合快速核对。'
          : '关键词有重合但不强，建议展开来源段落核对。'
        : '未找到明显对应来源段落，建议用更忠实版本重生成。',
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
    suspiciousSentences: [],
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
    suspiciousSentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          sentence: { type: 'string' },
          reason: { type: 'string' },
          sourceParagraphs: { type: 'array', items: { type: 'string' } },
        },
        required: ['readingParagraph', 'sentence', 'reason', 'sourceParagraphs'],
      },
    },
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
  required: ['score', 'verdict', 'risks', 'unsupportedClaims', 'suspiciousSentences', 'missingImportantIdeas', 'sourceAlignedParagraphs'],
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
- In suspiciousSentences, copy the exact generated sentence when a specific sentence is unsupported or weakly supported.
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

function isLowFidelityQuality(quality) {
  const audit = quality?.fidelity?.audit
  const score = audit?.score === undefined ? 1 : Number(audit.score)
  const unsupportedCount = (audit?.unsupportedClaims || []).length
  const suspiciousCount = (audit?.suspiciousSentences || []).length
  const unmappedCount = (quality?.sourceMap || []).filter((item) => !item.sourceRefs?.length).length
  return score < 0.6 || unsupportedCount > 0 || suspiciousCount > 1 || unmappedCount > 1
}

function fidelityRepairNotesFromQuality(quality) {
  const audit = quality?.fidelity?.audit || {}
  const notes = []
  if (audit.score !== undefined) notes.push(`The failed draft received a fidelity score of ${audit.score}. Aim for a clearly higher score by staying closer to the source.`)
  for (const claim of (audit.unsupportedClaims || []).slice(0, 5)) notes.push(`Remove or rewrite this unsupported claim unless it is directly in the source: ${claim}`)
  for (const sentence of (audit.suspiciousSentences || []).slice(0, 5)) {
    notes.push(`Check generated paragraph ${sentence.readingParagraph || '?'} carefully; suspicious sentence: ${sentence.sentence}`)
  }
  const missingKeywords = (quality?.fidelity?.missingKeywords || []).slice(0, 8)
  if (missingKeywords.length) notes.push(`Preserve central source ideas when supported: ${missingKeywords.join(', ')}`)
  const unmapped = (quality?.sourceMap || []).filter((item) => !item.sourceRefs?.length).map((item) => item.readingParagraph).slice(0, 5)
  if (unmapped.length) notes.push(`Make reading paragraphs ${unmapped.join(', ')} directly traceable to the provided source.`)
  return notes
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
  return `"${escapeSpreadsheetFormula(value).replace(/"/g, '""')}"`
}

function tsvCell(value) {
  return escapeSpreadsheetFormula(value)
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function escapeSpreadsheetFormula(value) {
  const text = String(value || '')
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
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
  const fidelityMode = body.fidelityMode === 'strict' || body.qualityFocus === 'fidelity' ? 'strict' : ''
  return {
    ...settings,
    readingLevel: normalizeLevel(readingLevels, body.readingLevel, settings.readingLevel),
    listeningLevel: normalizeLevel(listeningLevels, body.listeningLevel, settings.listeningLevel),
    fidelityMode,
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

const paragraphRepairSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          readingParagraph: { type: 'number' },
          text: { type: 'string' },
          summaryZh: { type: 'string' },
        },
        required: ['readingParagraph', 'text', 'summaryZh'],
      },
    },
  },
  required: ['paragraphs'],
}

function sourceIndexesFromRefs(refs = []) {
  return refs
    .map((ref) => Number(String(ref?.label || '').match(/段落\s*(\d+)/)?.[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value - 1)
}

function sourceContextForReadingParagraph(unit, sourceMapItem, paragraphIndex, totalParagraphs) {
  const paragraphs = sourceParagraphs(unit)
  if (!paragraphs.length) return ''
  const indexSet = new Set(sourceIndexesFromRefs(sourceMapItem?.sourceRefs || []))
  if (!indexSet.size) {
    const approx = Math.min(paragraphs.length - 1, Math.max(0, Math.round((paragraphIndex / Math.max(1, totalParagraphs - 1)) * (paragraphs.length - 1))))
    indexSet.add(approx)
    if (approx > 0) indexSet.add(approx - 1)
    if (approx < paragraphs.length - 1) indexSet.add(approx + 1)
  }
  return [...indexSet]
    .sort((a, b) => a - b)
    .map((index) => {
      const item = paragraphs[index]
      return item ? `Source paragraph ${item.index + 1}:\n${takeWords(item.text, 220)}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function lowQualityParagraphIndexes(unit, requested = []) {
  const paragraphCount = unit?.content?.reading?.paragraphs?.length || 0
  const validRequested = requested
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= paragraphCount)
    .map((value) => value - 1)
  if (validRequested.length) return [...new Set(validRequested)]

  const sourceMap = unit?.quality?.sourceMap || []
  const audit = unit?.quality?.fidelity?.audit || {}
  const suspicious = (audit.suspiciousSentences || [])
    .map((item) => Number(item?.readingParagraph || 0) - 1)
    .filter((value) => value >= 0)
  const fromMap = sourceMap
    .filter((item) => item.status === 'review' || !item.sourceRefs?.length || Number(item.confidence || 0) < 0.12 || item.suspiciousSentences?.length)
    .map((item) => Number(item.readingParagraph || 0) - 1)
    .filter((value) => value >= 0)
  const indexes = [...new Set([...fromMap, ...suspicious])]
  if (indexes.length) return indexes.slice(0, 3)
  if (audit.score !== undefined && Number(audit.score) < 0.55) return [0]
  return []
}

function fallbackRepairParagraph(unit, paragraphIndex) {
  const current = unit.content?.reading?.paragraphs?.[paragraphIndex] || {}
  const sourceMapItem = (unit.quality?.sourceMap || []).find((item) => Number(item.readingParagraph || 0) === paragraphIndex + 1)
  const context = sourceContextForReadingParagraph(unit, sourceMapItem, paragraphIndex, unit.content?.reading?.paragraphs?.length || 1)
  const sentences = splitSentences(context).slice(0, 6)
  const text = sentences.length
    ? sentences.join(' ')
    : takeWords(context || current.text || unit.sourceExcerpt || unit.sourceText, 155)
  return {
    readingParagraph: paragraphIndex + 1,
    text,
    summaryZh: current.summaryZh || '这一段已按原文来源重新整理。',
  }
}

async function repairParagraphsWithOpenAI(unit, indexes, settings) {
  const provider = process.env.AI_PROVIDER || 'auto'
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'mock' || !apiKey) return null

  const sourceMap = unit.quality?.sourceMap || []
  const paragraphCount = unit.content?.reading?.paragraphs?.length || 0
  const targets = indexes.map((index) => {
    const paragraph = unit.content.reading.paragraphs[index]
    const sourceMapItem = sourceMap.find((item) => Number(item.readingParagraph || 0) === index + 1)
    return `
Reading paragraph ${index + 1}
Current generated text:
${paragraph.text}

Known issues:
${(sourceMapItem?.suspiciousSentences || []).map((item) => `- ${item.sentence}: ${item.reason}`).join('\n') || '- Weak or unclear source support.'}

Allowed source context:
${sourceContextForReadingParagraph(unit, sourceMapItem, index, paragraphCount)}
`
  }).join('\n\n---\n\n')

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
      instructions: 'You repair only selected paragraphs of a graded English lesson. Return only schema-valid JSON.',
      input: `
Repair the selected reading paragraphs only.

Rules:
- Keep the same reading paragraph numbers.
- Rewrite only from the allowed source context shown for each paragraph.
- Remove unsupported claims. Do not add background knowledge, opinions, examples, or facts not in the source context.
- Keep adult learner English at CEFR ${settings.readingLevel}.
- Each repaired paragraph should be 120-175 words.
- Return a concise Chinese summary for each repaired paragraph.
- Do not rewrite other parts of the lesson.

${targets}
`,
      text: {
        verbosity: process.env.OPENAI_VERBOSITY || 'medium',
        format: {
          type: 'json_schema',
          name: 'paragraph_repair',
          strict: true,
          schema: paragraphRepairSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`段落修复失败：${response.status} ${text.slice(0, 240)}`)
  }
  const text = getResponsesOutputText(await response.json())
  if (!text) throw new Error('段落修复未返回内容')
  return JSON.parse(text)
}

async function repairLowQualityParagraphs(unit, settings, requestedParagraphs = []) {
  if (!unit?.content?.reading?.paragraphs?.length) throw new Error('这个单元还没有可修复的阅读正文')
  const indexes = lowQualityParagraphIndexes(unit, requestedParagraphs)
  if (!indexes.length) throw new Error('没有检测到需要段落级修复的问题')

  let result = null
  let aiError = ''
  try {
    result = await repairParagraphsWithOpenAI(unit, indexes, settings)
  } catch (error) {
    aiError = error.message || String(error)
  }
  const repairs = result?.paragraphs?.length ? result.paragraphs : indexes.map((index) => fallbackRepairParagraph(unit, index))
  const nextContent = JSON.parse(JSON.stringify(unit.content))
  const repairedIndexes = []
  for (const repair of repairs) {
    const index = Number(repair.readingParagraph || 0) - 1
    if (!indexes.includes(index) || !nextContent.reading.paragraphs[index]) continue
    nextContent.reading.paragraphs[index] = {
      text: String(repair.text || '').trim() || nextContent.reading.paragraphs[index].text,
      summaryZh: String(repair.summaryZh || '').trim() || nextContent.reading.paragraphs[index].summaryZh,
    }
    repairedIndexes.push(index)
  }
  if (!repairedIndexes.length) throw new Error('段落修复结果没有匹配到目标段落')
  nextContent.fidelityNote = `${nextContent.fidelityNote || ''} Paragraph ${repairedIndexes.map((index) => index + 1).join(', ')} was repaired for stricter source fidelity. ${aiError ? `AI repair fallback note: ${aiError}` : ''}`.trim()
  nextContent.qualityAudit = await auditContentFidelity(nextContent, unit)
  return { content: nextContent, repairedParagraphs: repairedIndexes.map((index) => index + 1), aiError }
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
  if (unit.content && options.force) saveUnitVersion(unit, options.versionReason || 'regenerated')
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

function clearJobDiagnosis(job) {
  delete job.errorStage
  delete job.errorCode
  delete job.errorHint
  delete job.retryable
  delete job.provider
  delete job.statusCode
  delete job.diagnosedAt
  delete job.autoRetryAt
  delete job.autoRetryDelaySeconds
  delete job.autoRetryReason
}

function parseStatusCode(message) {
  const match = String(message || '').match(/\b([45]\d{2})\b/)
  return match ? Number(match[1]) : null
}

function stageLabel(stage, job) {
  const normalized = String(stage || '').toLowerCase()
  if (normalized === 'unit-generation') return '学习单元生成'
  if (normalized === 'podcast-script') return '播客脚本生成'
  if (normalized === 'podcast-audio') return '播客音频合成'
  if (normalized === 'podcast-setup') return '播客任务准备'
  if (normalized === 'quality-review') return '生成质量检查'
  if (normalized === 'cancel') return '用户操作'
  if (normalized === 'setup') return '任务准备'
  if (job?.type === 'generate-podcast') return '播客生成'
  return '学习单元生成'
}

function providerLabel(stage, message) {
  const text = String(message || '').toLowerCase()
  const normalized = String(stage || '').toLowerCase()
  if (normalized === 'podcast-audio' || /gemini|tts|语音|音频|mimo/.test(text)) return 'TTS 服务'
  if (/ocr|tesseract|视觉/.test(text)) return /tesseract/.test(text) ? '本地 Tesseract OCR' : 'Hunyuan OCR'
  if (/ai|openai|gpt|模型|脚本|审稿/.test(text) || normalized.includes('script') || normalized.includes('generation')) return 'AI 文本服务'
  return ''
}

function diagnoseJobError(job, errorOrMessage, options = {}) {
  const message = typeof errorOrMessage === 'string' ? errorOrMessage : errorOrMessage?.message || String(errorOrMessage || '')
  const text = message.toLowerCase()
  const statusCode = options.statusCode || parseStatusCode(message)
  let errorCode = options.errorCode || 'unknown'
  let errorHint = '可以稍后重试；如果连续失败，请减少批量数量，或检查对应的 AI/OCR/TTS 配置。'
  let retryable = true

  if (options.stage === 'cancel' || /任务已取消|cancel/.test(text)) {
    errorCode = 'canceled'
    errorHint = '任务是手动取消的；需要继续时可以重新加入队列。'
    retryable = true
  } else if (options.stage === 'setup' || options.stage === 'podcast-setup' || /不存在|未找到/.test(message)) {
    errorCode = 'missing-resource'
    errorHint = '任务关联的书籍、单元或播客已经不存在。请回到书库重新创建任务。'
    retryable = false
  } else if (statusCode === 429 || /rate limit|quota|too many|频繁|限流|额度/.test(text)) {
    errorCode = 'rate-limit'
    errorHint = '外部服务正在限流或额度不足。等待几分钟后重试，或降低批量生成数量。'
    retryable = true
  } else if ([401, 403].includes(statusCode) || /api key|unauthorized|forbidden|鉴权|密钥|未配置|invalid key/.test(text)) {
    errorCode = 'provider-auth'
    errorHint = '外部服务密钥或模型配置不可用。需要先检查服务器环境变量，再重试任务。'
    retryable = false
  } else if ([408, 500, 502, 503, 504].includes(statusCode) || /timeout|timed out|econnreset|enotfound|fetch failed|network|暂时|上游/.test(text)) {
    errorCode = 'upstream-temporary'
    errorHint = '上游服务或网络临时不稳定。稍后点击重试通常可以恢复。'
    retryable = true
  } else if (/ocr|tesseract|视觉/.test(text)) {
    errorCode = 'ocr-failed'
    errorHint = 'OCR 没有得到足够正文。请确认 PDF 清晰、方向正确，或换用非扫描版文件。'
    retryable = false
  } else if (/质量|忠实度|review|source|keyword/.test(text)) {
    errorCode = 'quality-review'
    errorHint = '质量检查认为结果不够稳定。可以点击重试，系统会重新生成一版。'
    retryable = true
  } else if (statusCode && statusCode >= 400 && statusCode < 500) {
    errorCode = 'bad-request'
    errorHint = '上游服务拒绝了这次请求。若重试仍失败，请降低难度或减少本次材料长度。'
    retryable = false
  }

  return {
    errorStage: stageLabel(options.stage, job),
    errorCode,
    errorHint,
    retryable,
    provider: options.provider || providerLabel(options.stage, message),
    statusCode,
  }
}

function applyJobDiagnosis(job, errorOrMessage, options = {}) {
  Object.assign(job, diagnoseJobError(job, errorOrMessage, options), {
    diagnosedAt: new Date().toISOString(),
  })
}

function markJobCanceled(job, message = '任务已取消') {
  job.status = 'canceled'
  job.progress = 100
  job.error = ''
  job.message = message
  job.finishedAt = new Date().toISOString()
  job.updatedAt = job.finishedAt
  applyJobDiagnosis(job, message, { stage: 'cancel' })
}

function markJobFailed(job, errorOrMessage, options = {}) {
  const message = typeof errorOrMessage === 'string' ? errorOrMessage : errorOrMessage?.message || String(errorOrMessage || '')
  job.status = 'failed'
  job.progress = 100
  job.error = message || '任务失败'
  job.message = options.message || '生成失败'
  job.finishedAt = new Date().toISOString()
  job.updatedAt = job.finishedAt
  applyJobDiagnosis(job, job.error, options)
}

function formatRelativeSeconds(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)))
  if (value < 60) return `${value || 1} 秒`
  const minutes = Math.round(value / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.round(minutes / 60)} 小时`
}

function secondsUntil(isoTime) {
  const target = Date.parse(isoTime || '')
  if (!Number.isFinite(target)) return 0
  return Math.max(0, Math.ceil((target - Date.now()) / 1000))
}

function canAutoRetryJob(job) {
  if (!job || maxAutoFailureRetries <= 0 || job.retryable === false || job.cancelRequested) return false
  if (!['rate-limit', 'upstream-temporary'].includes(job.errorCode || '')) return false
  return Number(job.retryCount || 0) < maxAutoFailureRetries
}

function scheduleAutoRetryJob(job) {
  if (!canAutoRetryJob(job)) return false
  const attempt = Number(job.retryCount || 0) + 1
  const delaySeconds = Math.min(30 * 60, autoFailureRetryBaseSeconds * 2 ** Math.max(0, attempt - 1))
  job.autoRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
  job.autoRetryDelaySeconds = delaySeconds
  job.autoRetryReason =
    job.errorCode === 'rate-limit'
      ? '检测到限流或额度暂时不可用，系统会先等待再自动重试。'
      : '检测到上游服务或网络临时异常，系统会自动重试一次。'
  job.message = `${job.message || '生成失败'}，已安排 ${formatRelativeSeconds(delaySeconds)} 后自动重试`
  return true
}

function promoteDueAutoRetryJobs(db) {
  const now = Date.now()
  let changed = false
  let nextDelayMs = 0
  for (const job of db.jobs || []) {
    if (job.status !== 'failed' || !job.autoRetryAt) continue
    const retryAt = Date.parse(job.autoRetryAt)
    if (!Number.isFinite(retryAt)) continue
    if (retryAt > now) {
      const delay = retryAt - now
      nextDelayMs = nextDelayMs ? Math.min(nextDelayMs, delay) : delay
      continue
    }

    const lastError = job.error || job.message || ''
    const lastErrorCode = job.errorCode || ''
    const lastErrorStage = job.errorStage || ''
    const retryCount = Number(job.retryCount || 0) + 1
    clearJobDiagnosis(job)
    job.lastError = lastError
    job.lastErrorCode = lastErrorCode
    job.lastErrorStage = lastErrorStage
    job.retryCount = retryCount
    job.status = 'queued'
    job.progress = 0
    job.error = ''
    job.cancelRequested = false
    job.message = `自动重试 ${retryCount}/${maxAutoFailureRetries}`
    job.finishedAt = null
    job.updatedAt = new Date().toISOString()

    const unit = db.units.find((item) => item.id === job.unitId)
    if (unit) {
      unit.generation = {
        ...(unit.generation || {}),
        jobId: job.id,
        status: 'queued',
        progress: 0,
        message: job.message,
      }
    }
    const podcast = db.podcasts.find((item) => item.id === job.podcastId && item.userId === job.userId)
    if (podcast) {
      podcast.status = 'planned'
      podcast.error = ''
      podcast.updatedAt = job.updatedAt
    }
    changed = true
  }
  return { changed, nextDelayMs }
}

function jobNextAction(job) {
  const retryIn = secondsUntil(job.autoRetryAt)
  if (retryIn > 0) {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待自动重试',
      nextActionDetail: `系统将在约 ${formatRelativeSeconds(retryIn)} 后自动重试。你也可以手动取消或稍后查看结果。`,
    }
  }
  if (job.status === 'running') {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待当前任务',
      nextActionDetail: '任务正在运行，暂时不用操作。长时间卡住时可以取消后重新加入队列。',
    }
  }
  if (job.status === 'queued' || job.status === 'paused') {
    return {
      nextActionKind: job.status === 'paused' ? 'resume' : 'wait',
      nextActionLabel: job.status === 'paused' ? '恢复任务' : '等待排队',
      nextActionDetail: job.status === 'paused' ? '任务已暂停，需要时点击恢复。' : '任务已在队列里，会按顺序执行。',
    }
  }
  if (job.status === 'succeeded') {
    return {
      nextActionKind: 'done',
      nextActionLabel: '无需处理',
      nextActionDetail: '任务已经完成。只有想刷新内容时才需要重新生成。',
    }
  }
  if (job.errorCode === 'provider-auth') {
    return {
      nextActionKind: 'service',
      nextActionLabel: '先检查服务配置',
      nextActionDetail: '密钥、模型或网关配置不可用。先到 AI 服务页测试对应来源，再重试任务。',
    }
  }
  if (job.errorCode === 'rate-limit') {
    return {
      nextActionKind: 'wait',
      nextActionLabel: '等待额度恢复',
      nextActionDetail: '这是限流或额度问题。建议等几分钟，减少批量数量，或切换可用的备用来源。',
    }
  }
  if (job.errorCode === 'upstream-temporary') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '可以直接重试',
      nextActionDetail: '这是上游或网络临时异常。通常等待一下再重试即可。',
    }
  }
  if (job.errorCode === 'ocr-failed') {
    return {
      nextActionKind: 'replace-file',
      nextActionLabel: '换文字版或更清晰 PDF',
      nextActionDetail: 'OCR 没识别出足够正文。优先使用文字版 PDF，或换方向正确、清晰度更高的文件。',
    }
  }
  if (job.errorCode === 'quality-review') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '重新生成更忠实版本',
      nextActionDetail: '质量检查认为内容不够稳。重试会重新生成，并继续做质量检查。',
    }
  }
  if (job.status === 'canceled') {
    return {
      nextActionKind: 'retry',
      nextActionLabel: '需要时重新生成',
      nextActionDetail: '任务是手动取消的，点击重试会重新排队。',
    }
  }
  return {
    nextActionKind: job.retryable === false ? 'fix' : 'retry',
    nextActionLabel: job.retryable === false ? '先处理问题' : '可以重试',
    nextActionDetail: job.retryable === false ? '这个失败通常不是临时波动，需要先处理配置、文件或材料。' : '如果不是连续失败，可以直接重试一次。',
  }
}

function usageText(summary) {
  const parts = []
  if (summary.inputTokens) parts.push(`输入约 ${formatServiceNumber(summary.inputTokens)} tokens`)
  if (summary.outputTokens) parts.push(`输出约 ${formatServiceNumber(summary.outputTokens)} tokens`)
  if (summary.audioSeconds) parts.push(`音频约 ${formatRelativeSeconds(summary.audioSeconds)}`)
  if (summary.audioBytes) parts.push(`音频 ${formatBytes(summary.audioBytes)}`)
  if (summary.pages) parts.push(`OCR ${summary.pages} 页`)
  if (summary.chunks) parts.push(`${summary.chunks} 块`)
  if (summary.failed) parts.push(`失败 ${summary.failed} 次`)
  return parts.join(' · ')
}

function jobUsageSummary(job, db) {
  const records = (db?.aiUsage || []).filter((item) => item.userId === job.userId && item.jobId === job.id)
  if (records.length) {
    const summary = summarizeUsageRecords(records)
    return {
      label: `已记录 ${summary.calls} 次服务调用`,
      detail: usageText(summary) || '这次任务没有记录到明显 token、音频或页数消耗。',
      estimated: false,
    }
  }

  const unit = db?.units?.find((item) => item.id === job.unitId)
  const podcast = db?.podcasts?.find((item) => item.id === job.podcastId)
  if (unit) {
    const inputTokens = estimateTextTokens(unit.sourceText || unit.sourceExcerpt || '')
    return {
      label: '预计文本生成消耗',
      detail: `输入约 ${formatServiceNumber(inputTokens)} tokens；实际用量会在任务运行后记录。`,
      estimated: true,
    }
  }
  if (podcast) {
    const inputTokens = estimateTtsInputTokens(podcast.scriptText || podcast.sourceText || '')
    const chunks = chunkTextForTts(podcast.scriptText || podcast.sourceText || '').length
    return {
      label: '预计播客生成消耗',
      detail: `输入约 ${formatServiceNumber(inputTokens)} tokens · ${chunks || 1} 块；音频合成成功后会记录秒数和文件大小。`,
      estimated: true,
    }
  }
  return {
    label: '暂无消耗记录',
    detail: '任务还没有开始调用外部服务，或旧任务没有记录到用量。',
    estimated: true,
  }
}

function appendErrorLog(db, entry = {}) {
  if (!db) return null
  db.errorLogs = Array.isArray(db.errorLogs) ? db.errorLogs : []
  const now = new Date().toISOString()
  const log = {
    id: nanoid(),
    level: entry.level || 'error',
    scope: entry.scope || 'server',
    message: sanitizeServiceMessage(entry.message || '未知错误'),
    detail: sanitizeServiceMessage(entry.detail || ''),
    userId: entry.userId || '',
    jobId: entry.jobId || '',
    unitId: entry.unitId || '',
    podcastId: entry.podcastId || '',
    statusCode: entry.statusCode || null,
    errorCode: entry.errorCode || '',
    createdAt: now,
  }
  db.errorLogs.push(log)
  if (db.errorLogs.length > 200) db.errorLogs = db.errorLogs.slice(-200)
  return log
}

function publicErrorLog(log) {
  return {
    id: log.id,
    level: log.level || 'error',
    scope: log.scope || 'server',
    message: log.message || '',
    detail: log.detail || '',
    jobId: log.jobId || '',
    unitId: log.unitId || '',
    podcastId: log.podcastId || '',
    statusCode: log.statusCode || null,
    errorCode: log.errorCode || '',
    createdAt: log.createdAt || '',
  }
}

function shouldRecordTextAiUsage() {
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(process.env.OPENAI_API_KEY)
}

function textAiUsageSource() {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  return {
    provider: serviceEndpointHost(baseUrl) || 'text-ai',
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
  }
}

function recordAiUsage(db, entry = {}) {
  if (!db || !entry.userId) return null
  db.aiUsage = Array.isArray(db.aiUsage) ? db.aiUsage : []
  const record = {
    id: nanoid(),
    userId: entry.userId,
    jobId: String(entry.jobId || '').slice(0, 80),
    category: String(entry.category || 'text').slice(0, 32),
    action: String(entry.action || 'unknown').slice(0, 64),
    provider: sanitizeServiceMessage(entry.provider || '').slice(0, 80),
    model: sanitizeServiceMessage(entry.model || '').slice(0, 100),
    inputTokens: Math.max(0, Math.round(Number(entry.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(Number(entry.outputTokens || 0))),
    audioSeconds: Math.max(0, Math.round(Number(entry.audioSeconds || 0))),
    audioBytes: Math.max(0, Math.round(Number(entry.audioBytes || 0))),
    pages: Math.max(0, Math.round(Number(entry.pages || 0))),
    bytes: Math.max(0, Math.round(Number(entry.bytes || 0))),
    chunks: Math.max(0, Math.round(Number(entry.chunks || 0))),
    success: entry.success !== false,
    statusCode: entry.statusCode || null,
    errorCode: String(entry.errorCode || '').slice(0, 60),
    message: sanitizeServiceMessage(entry.message || '').slice(0, 180),
    createdAt: entry.createdAt || new Date().toISOString(),
  }
  db.aiUsage.push(record)
  if (db.aiUsage.length > 3000) db.aiUsage = db.aiUsage.slice(-3000)
  return record
}

async function persistAiUsage(entry = {}) {
  const db = await readDb()
  recordAiUsage(db, entry)
  await writeDb(db)
}

function summarizeUsageRecords(records) {
  return records.reduce(
    (summary, item) => {
      summary.calls += 1
      if (item.success === false) summary.failed += 1
      summary.inputTokens += Number(item.inputTokens || 0)
      summary.outputTokens += Number(item.outputTokens || 0)
      summary.audioSeconds += Number(item.audioSeconds || 0)
      summary.audioBytes += Number(item.audioBytes || 0)
      summary.pages += Number(item.pages || 0)
      summary.bytes += Number(item.bytes || 0)
      summary.chunks += Number(item.chunks || 0)
      return summary
    },
    { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, audioSeconds: 0, audioBytes: 0, pages: 0, bytes: 0, chunks: 0 }
  )
}

function groupUsage(records, keyFn) {
  const map = new Map()
  for (const item of records) {
    const key = keyFn(item)
    if (!key) continue
    const current = map.get(key) || []
    current.push(item)
    map.set(key, current)
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, ...summarizeUsageRecords(items) }))
    .sort((a, b) => b.calls - a.calls)
}

function computeAiUsageSummary(db, userId) {
  const now = Date.now()
  const todayKey = new Date(now).toISOString().slice(0, 10)
  const all = (db.aiUsage || [])
    .filter((item) => item.userId === userId)
    .filter((item) => Number.isFinite(Date.parse(item.createdAt || '')))
  const todayRecords = all.filter((item) => String(item.createdAt || '').slice(0, 10) === todayKey)
  const sevenDayRecords = all.filter((item) => Date.parse(item.createdAt) >= now - 7 * 24 * 60 * 60 * 1000)
  const thirtyDayRecords = all.filter((item) => Date.parse(item.createdAt) >= now - 30 * 24 * 60 * 60 * 1000)
  const byAction = groupUsage(thirtyDayRecords, (item) => item.action).slice(0, 10)
  const byProviderModel = groupUsage(thirtyDayRecords, (item) => {
    const provider = item.provider || 'unknown'
    const model = item.model || 'unknown'
    return `${provider} · ${model}`
  }).slice(0, 8)
  const recentFailures = all
    .filter((item) => item.success === false)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 8)
    .map((item) => ({
      action: item.action,
      provider: item.provider,
      model: item.model,
      message: item.message,
      errorCode: item.errorCode,
      statusCode: item.statusCode,
      createdAt: item.createdAt,
    }))
  const today = summarizeUsageRecords(todayRecords)
  const sevenDays = summarizeUsageRecords(sevenDayRecords)
  const thirtyDays = summarizeUsageRecords(thirtyDayRecords)
  const warnings = []
  if (sevenDays.failed >= 3) warnings.push({ level: 'warning', message: `近 7 天 AI/OCR/TTS 失败 ${sevenDays.failed} 次`, detail: '建议打开服务状态页测试对应来源。' })
  if (today.calls >= 30) warnings.push({ level: 'warning', message: `今天 AI 调用 ${today.calls} 次`, detail: '如果不是主动批量生成，请检查任务中心。' })
  if (today.audioSeconds >= 60 * 45) warnings.push({ level: 'warning', message: `今天 TTS 音频约 ${Math.round(today.audioSeconds / 60)} 分钟`, detail: '播客 TTS 成本通常高于普通文本生成。' })

  return {
    today,
    sevenDays,
    thirtyDays,
    byAction,
    byProviderModel,
    recentFailures,
    warnings,
  }
}

async function computeBackupStatus() {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = path.join(backupDir, entry.name)
          const stat = await fs.stat(fullPath)
          return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, modifiedAt: stat.mtime.toISOString() }
        })
    )
    const backups = files
      .filter((file) => /^linguashelf-.*\.zip(\.enc)?$/.test(file.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const drills = files
      .filter((file) => /^linguashelf-.*\.drill\.json$/.test(file.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    let latestDrill = drills[0] || null
    if (latestDrill) {
      try {
        const report = JSON.parse(await fs.readFile(path.join(backupDir, latestDrill.name), 'utf8'))
        latestDrill = {
          ...latestDrill,
          ok: Boolean(report.ok),
          restoredFiles: Number(report.restoredFiles || 0),
          restoredBytes: Number(report.restoredBytes || 0),
          recordCount: Number(report.recordCount || 0),
        }
      } catch {
        latestDrill = { ...latestDrill, ok: false }
      }
    }
    return {
      configured: true,
      backupDir,
      backupCount: backups.length,
      latestBackup: backups[0] || null,
      latestDrill,
    }
  } catch {
    return {
      configured: false,
      backupDir,
      backupCount: 0,
      latestBackup: null,
      latestDrill: null,
    }
  }
}

async function fileSizeIfExists(filePath) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

async function directoryUsage(dir, maxFiles = 2000) {
  let bytes = 0
  let files = 0
  async function walk(current) {
    if (files >= maxFiles) return
    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= maxFiles) return
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          bytes += stat.size
          files += 1
        } catch {
          // Ignore files that disappear during the scan.
        }
      }
    }
  }
  await walk(dir)
  return { bytes, files, truncated: files >= maxFiles }
}

async function computeStorageUsage() {
  const [uploads, audio, backups] = await Promise.all([
    directoryUsage(uploadDir),
    directoryUsage(audioDir),
    directoryUsage(backupDir),
  ])
  const dbBytes = storageDriver === 'sqlite' ? await fileSizeIfExists(sqlitePath) : await fileSizeIfExists(dbPath)
  const totalBytes = uploads.bytes + audio.bytes + backups.bytes + dbBytes
  return {
    totalBytes,
    dataDir,
    backupDir,
    items: [
      { key: 'database', label: storageDriver === 'sqlite' ? 'SQLite 数据库' : 'JSON 数据库', bytes: dbBytes, files: dbBytes ? 1 : 0 },
      { key: 'uploads', label: '上传原文', ...uploads },
      { key: 'audio', label: '音频缓存', ...audio },
      { key: 'backups', label: '备份文件', ...backups },
    ],
  }
}

function taskSummary(db, userId) {
  const jobs = db.jobs.filter((job) => job.userId === userId)
  const byStatus = {}
  const byType = {}
  const failedByCode = {}
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1
    byType[job.type] = (byType[job.type] || 0) + 1
    if (job.status === 'failed') {
      const code = job.errorCode || diagnoseJobError(job, job.error || job.message).errorCode || 'unknown'
      failedByCode[code] = (failedByCode[code] || 0) + 1
    }
  }
  return {
    total: jobs.length,
    active: jobs.filter((job) => ['queued', 'running', 'paused'].includes(job.status)).length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    byStatus,
    byType,
    failedByCode,
    recent: jobs
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, 8)
      .map((job) => publicJobWithContext(job, db)),
  }
}

function buildAdminWarnings(backup, storage, tasks, aiUsage) {
  const warnings = []
  const now = Date.now()
  const latestBackupAt = backup.latestBackup ? Date.parse(backup.latestBackup.modifiedAt) : 0
  if (!backup.latestBackup) {
    warnings.push({ level: 'critical', scope: 'backup', message: '没有检测到可用备份', detail: '请检查每日备份任务是否正常运行。' })
  } else if (Number.isFinite(latestBackupAt) && now - latestBackupAt > 36 * 60 * 60 * 1000) {
    warnings.push({ level: 'warning', scope: 'backup', message: '最近备份超过 36 小时', detail: `最近一次：${backup.latestBackup.modifiedAt}` })
  }
  if (backup.latestBackup && !String(backup.latestBackup.name || '').endsWith('.enc')) {
    warnings.push({ level: 'warning', scope: 'backup', message: '最近备份不是加密文件', detail: '建议确认 BACKUP_ENCRYPTION_REQUIRED=true。' })
  }
  if (!backup.latestDrill) {
    warnings.push({ level: 'warning', scope: 'backup', message: '还没有恢复演练报告', detail: '备份必须能恢复才算真正可用。' })
  } else if (!backup.latestDrill.ok) {
    warnings.push({ level: 'critical', scope: 'backup', message: '最近恢复演练失败', detail: '请优先检查备份脚本和加密密钥。' })
  }
  if (Number(storage.totalBytes || 0) > 20 * 1024 * 1024 * 1024) {
    warnings.push({ level: 'warning', scope: 'storage', message: '数据目录超过 20GB', detail: '需要清理旧音频或扩容磁盘。' })
  }
  if (Number(tasks.failed || 0) > 0) {
    warnings.push({ level: 'warning', scope: 'tasks', message: `有 ${tasks.failed} 个失败任务`, detail: '打开任务中心查看失败原因并按需重试。' })
  }
  for (const warning of aiUsage.warnings || []) {
    warnings.push({ level: warning.level || 'warning', scope: 'ai', message: warning.message, detail: warning.detail || '' })
  }
  return warnings
}

async function buildAdminStatusPayload(db, userId) {
  const [backup, storage] = await Promise.all([computeBackupStatus(), computeStorageUsage()])
  const services = buildAiServicesPayload(db, userId)
  const tasks = taskSummary(db, userId)
  const aiUsage = computeAiUsageSummary(db, userId)
  const recentErrors = (db.errorLogs || [])
    .filter((log) => !log.userId || log.userId === userId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map(publicErrorLog)
  return {
    updatedAt: new Date().toISOString(),
    warnings: buildAdminWarnings(backup, storage, tasks, aiUsage),
    tasks,
    aiUsage,
    backup,
    services: {
      overview: services.overview,
      items: services.services.map((service) => ({
        id: service.id,
        title: service.title,
        status: service.status,
        configured: service.configured,
        provider: service.provider,
        model: service.model,
        endpointHost: service.endpointHost,
        warning: service.warning || '',
        lastCheck: service.lastCheck || null,
      })),
    },
    storage,
    recentErrors,
  }
}

function publicJob(job, db = null) {
  if (!job) return null
  const fallbackDiagnosis =
    !job.errorHint && ['failed', 'canceled'].includes(job.status) && (job.error || job.message)
      ? diagnoseJobError(job, job.error || job.message, { stage: job.status === 'canceled' ? 'cancel' : '' })
      : null
  const nextAction = jobNextAction({
    ...job,
    errorCode: job.errorCode || fallbackDiagnosis?.errorCode || '',
    retryable: job.retryable === undefined ? fallbackDiagnosis?.retryable !== false : job.retryable !== false,
  })
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
    errorStage: job.errorStage || fallbackDiagnosis?.errorStage || '',
    errorCode: job.errorCode || fallbackDiagnosis?.errorCode || '',
    errorHint: job.errorHint || fallbackDiagnosis?.errorHint || '',
    retryable: job.retryable === undefined ? fallbackDiagnosis?.retryable !== false : job.retryable !== false,
    provider: job.provider || fallbackDiagnosis?.provider || '',
    statusCode: job.statusCode || fallbackDiagnosis?.statusCode || null,
    retryCount: Number(job.retryCount || 0),
    qualityStatus: job.qualityStatus || '',
    autoRetryAt: job.autoRetryAt || '',
    autoRetryDelaySeconds: Number(job.autoRetryDelaySeconds || 0),
    autoRetryReason: job.autoRetryReason || '',
    lastError: job.lastError || '',
    lastErrorCode: job.lastErrorCode || '',
    lastErrorStage: job.lastErrorStage || '',
    canRetryNow: !job.autoRetryAt || secondsUntil(job.autoRetryAt) <= 0,
    usageSummary: db ? jobUsageSummary(job, db) : null,
    ...nextAction,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  }
}

function publicJobWithContext(job, db) {
  const output = publicJob(job, db)
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
    message: generationSettings.fidelityMode === 'strict' ? '已加入忠实度修复队列' : '已加入生成队列',
    unitId: unit.id,
    bookId: unit.bookId,
    force: Boolean(body.force),
    settings: {
      readingLevel: generationSettings.readingLevel,
      listeningLevel: generationSettings.listeningLevel,
      fidelityMode: generationSettings.fidelityMode,
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

async function failPodcastJob(jobId, message, options = {}) {
  const db = await readDb()
  const job = db.jobs.find((item) => item.id === jobId)
  if (!job) return
  const podcast = db.podcasts.find((item) => item.id === job.podcastId)
  if (options.status === 'canceled') {
    markJobCanceled(job, message || '任务已取消')
  } else {
    markJobFailed(job, message || '播客生成失败', { ...options, message: '播客生成失败' })
  }
  const scheduledAutoRetry = job.status === 'failed' ? scheduleAutoRetryJob(job) : false
  if (podcast) {
    podcast.status = 'failed'
    podcast.error = job.error || job.message
    podcast.updatedAt = job.updatedAt
  }
  if (job.status === 'failed') {
    appendErrorLog(db, {
      scope: 'job',
      message: job.error || job.message,
      detail: job.errorHint || '',
      userId: job.userId,
      jobId: job.id,
      podcastId: job.podcastId,
      statusCode: job.statusCode,
      errorCode: job.errorCode,
    })
  }
  await writeDb(db)
  if (scheduledAutoRetry) setTimeout(processJobQueue, Math.min(Number(job.autoRetryDelaySeconds || autoFailureRetryBaseSeconds) * 1000 + 250, 2_147_483_647))
}

async function processPodcastJob(jobId) {
  let db = await readDb()
  let job = db.jobs.find((item) => item.id === jobId)
  let podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  const user = job ? db.users.find((item) => item.id === job.userId) : null
  if (!job) return
  if (!podcast || !user) {
    await failPodcastJob(job.id, '播客或用户不存在', { stage: 'podcast-setup' })
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
    if (shouldRecordTextAiUsage()) {
      const source = textAiUsageSource()
      await persistAiUsage({
        userId: job.userId,
        jobId: job.id,
        category: 'text',
        action: 'generate-podcast-script',
        ...source,
        inputTokens: estimateTextTokens(podcast.sourceText),
        success: false,
        statusCode: parseStatusCode(error.message),
        message: error.message || '播客脚本生成失败',
      }).catch((usageError) => console.error('failed to record ai usage', usageError))
    }
    await failPodcastJob(job.id, error.message || '播客脚本生成失败', { stage: 'podcast-script' })
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return
  if (job.cancelRequested) {
    await failPodcastJob(job.id, '任务已取消', { stage: 'cancel', status: 'canceled' })
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
  if (shouldRecordTextAiUsage()) {
    const source = textAiUsageSource()
    recordAiUsage(db, {
      userId: job.userId,
      jobId: job.id,
      category: 'text',
      action: 'generate-podcast-script',
      ...source,
      inputTokens: estimateTextTokens(podcast.sourceText),
      outputTokens: estimateTextTokens(podcast.scriptText),
      success: String(scriptResult.mode || '').includes('ai'),
      message: String(scriptResult.mode || '').includes('ai') ? '' : '使用本地播客脚本兜底',
    })
  }
  await writeDb(db)

  let audio = null
  try {
    audio = await synthesizePodcastAudio(
      podcast,
      async (percent, done, total) => {
        const progress = 35 + Math.round(percent * 0.6)
        await updatePodcastJobProgress(podcast.id, job.id, progress, `正在合成音频 ${done}/${total}`)
      },
      { preferFallback: Boolean(job.preferTtsFallback || podcast.preferTtsFallback) }
    )
  } catch (error) {
    await persistAiUsage({
      userId: job.userId,
      jobId: job.id,
      category: 'audio',
      action: 'generate-podcast-tts',
      provider: 'Gemini TTS',
      model: process.env.GEMINI_TTS_OFFICIAL_MODEL || process.env.GEMINI_TTS_MODEL || 'gemini-tts',
      inputTokens: estimateTtsInputTokens(podcast.scriptText || ''),
      chunks: chunkTextForTts(podcast.scriptText || '').length,
      success: false,
      statusCode: parseStatusCode(error.message),
      message: error.message || '播客音频合成失败',
    }).catch((usageError) => console.error('failed to record ai usage', usageError))
    await failPodcastJob(job.id, error.message || '播客音频合成失败', { stage: 'podcast-audio' })
    return
  }

  db = await readDb()
  job = db.jobs.find((item) => item.id === jobId)
  podcast = job ? db.podcasts.find((item) => item.id === job.podcastId) : null
  if (!job || !podcast) return

  podcast.audio = audio
  recordAiUsage(db, {
    userId: job.userId,
    jobId: job.id,
    category: 'audio',
    action: 'generate-podcast-tts',
    provider: audio.provider || 'Gemini TTS',
    model: audio.model || '',
    inputTokens: estimateTtsInputTokens(podcast.scriptText || ''),
    audioSeconds: audio.durationSeconds,
    audioBytes: audio.byteLength,
    chunks: audio.chunkCount,
    success: true,
  })
  podcast.status = 'ready'
  podcast.updatedAt = new Date().toISOString()
  job.status = 'succeeded'
  job.progress = 100
  job.message = '播客已生成'
  job.finishedAt = podcast.updatedAt
  job.updatedAt = podcast.updatedAt
  clearJobDiagnosis(job)
  await writeDb(db)
}

async function processJobQueue() {
  if (jobQueueActive) return
  jobQueueActive = true
  try {
    while (true) {
      let db = await readDb()
      const autoRetry = promoteDueAutoRetryJobs(db)
      if (autoRetry.changed) await writeDb(db)
      if (autoRetry.nextDelayMs) setTimeout(processJobQueue, Math.min(autoRetry.nextDelayMs + 250, 2_147_483_647))
      let job = db.jobs.find((item) => ['generate-unit', 'generate-podcast'].includes(item.type) && item.status === 'queued')
      if (!job) break

      if (job.type === 'generate-podcast') {
        await processPodcastJob(job.id)
        continue
      }

      let unit = db.units.find((item) => item.id === job.unitId)
      const user = db.users.find((item) => item.id === job.userId)
      if (!unit || !user) {
        markJobFailed(job, '学习单元或用户不存在', { stage: 'setup' })
        appendErrorLog(db, {
          scope: 'job',
          message: job.error || job.message,
          detail: job.errorHint || '',
          userId: job.userId,
          jobId: job.id,
          unitId: job.unitId,
          statusCode: job.statusCode,
          errorCode: job.errorCode,
        })
        await writeDb(db)
        continue
      }

      job.status = 'running'
      job.progress = 15
      job.message = job.settings?.fidelityMode === 'strict' ? '正在调用 AI 生成更忠实版本' : '正在调用 AI 生成学习单元'
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
          fidelityMode: job.settings?.fidelityMode || '',
          fidelityRepairNotes: job.settings?.fidelityRepairNotes || [],
        })
      } catch (error) {
        failure = error.message || '生成失败'
      }

      db = await readDb()
      job = db.jobs.find((item) => item.id === job.id)
      unit = db.units.find((item) => item.id === job.unitId)
      if (!job || !unit) continue

      if (job.cancelRequested) {
        markJobCanceled(job)
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
        if (shouldRecordTextAiUsage()) {
          const source = textAiUsageSource()
          recordAiUsage(db, {
            userId: job.userId,
            jobId: job.id,
            category: 'text',
            action: 'generate-unit',
            ...source,
            inputTokens: estimateTextTokens(unit.sourceText),
            success: false,
            statusCode: parseStatusCode(failure),
            message: failure || 'AI 未返回学习单元',
          })
        }
        markJobFailed(job, failure || 'AI 未返回学习单元', { stage: 'unit-generation' })
        const scheduledAutoRetry = scheduleAutoRetryJob(job)
        appendErrorLog(db, {
          scope: 'job',
          message: job.error || job.message,
          detail: job.errorHint || '',
          userId: job.userId,
          jobId: job.id,
          unitId: job.unitId,
          statusCode: job.statusCode,
          errorCode: job.errorCode,
        })
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
        if (scheduledAutoRetry) setTimeout(processJobQueue, Math.min(Number(job.autoRetryDelaySeconds || autoFailureRetryBaseSeconds) * 1000 + 250, 2_147_483_647))
        continue
      }

      if (shouldRecordTextAiUsage()) {
        const source = textAiUsageSource()
        const usedAi = content.generationMode !== 'local-demo'
        recordAiUsage(db, {
          userId: job.userId,
          jobId: job.id,
          category: 'text',
          action: 'generate-unit',
          ...source,
          inputTokens: estimateTextTokens(unit.sourceText),
          outputTokens: estimateTextTokens(JSON.stringify(content)),
          success: usedAi,
          message: usedAi ? '' : 'AI 调用失败，学习单元使用本地兜底',
        })
      }

      const quality = assessContentQuality(content, unit)
      const retryCount = Number(job.retryCount || 0)
      const shouldRetryForFidelity = isLowFidelityQuality(quality) && job.settings?.fidelityMode !== 'strict' && retryCount < maxAutoRegenAttempts
      if (shouldRetryForFidelity) {
        job.settings = {
          ...(job.settings || {}),
          fidelityMode: 'strict',
          fidelityRepairNotes: fidelityRepairNotesFromQuality(quality),
        }
        job.force = Boolean(unit.content)
        job.status = 'queued'
        job.progress = 0
        job.retryCount = retryCount + 1
        job.qualityStatus = 'strict-fidelity-auto-retry'
        job.message = `忠实度审稿偏低，正在自动生成更忠实版本 ${job.retryCount}/${maxAutoRegenAttempts}`
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

      applyGeneratedContent(unit, content, {
        force: job.force,
        versionReason: job.settings?.fidelityMode === 'strict' ? 'fidelity-regenerated' : 'regenerated',
      })
      job.status = 'succeeded'
      job.progress = 100
      job.message = '学习单元已生成'
      job.qualityStatus = unit.quality?.status || ''
      job.finishedAt = new Date().toISOString()
      job.updatedAt = job.finishedAt
      clearJobDiagnosis(job)
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
      const passwordError = validatePasswordStrength(password)
      if (passwordError) {
        recordLoginFailure(limit.key)
        res.status(400).json({ error: passwordError })
        return
      }
      user = {
        id: nanoid(),
        email,
        name: email.split('@')[0] || 'Learner',
        passwordHash: hashPassword(password),
        role: 'user',
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
    const allowed = ['readingLevel', 'listeningLevel', 'studyMinutes', 'chineseAssist', 'aiSuggestions', 'focusStudyMode', 'keepSourceFiles', 'podcastLexile', 'podcastVoice']
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

  app.get('/api/security/status', auth, requireAdmin, async (req, res) => {
    const db = req.db
    const activeJobs = db.jobs.filter((job) => job.userId === req.user.id && ['queued', 'running'].includes(job.status)).length
    const backup = await computeBackupStatus()
    res.json({
      security: {
        allowSignup,
        inviteRequired: Boolean(signupInviteCode),
        sessionDays,
        loginWindowMinutes: Math.round(loginWindowMs / 60000),
        loginMaxFailures,
        passwordMinLength,
      },
      deployment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        storageDriver,
        dataDir,
        backupDir,
        backup,
        trustProxy: Boolean(process.env.TRUST_PROXY),
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        ttsConfigured: Boolean(process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY),
        ttsProvider: process.env.OPENAI_TTS_PROVIDER || 'openai-speech',
        podcastTtsConfigured: Boolean(process.env.GEMINI_TTS_OFFICIAL_API_KEY || process.env.GEMINI_TTS_API_KEY),
        podcastTtsPrimary: process.env.GEMINI_TTS_OFFICIAL_API_KEY ? process.env.GEMINI_TTS_OFFICIAL_MODEL || 'gemini-3.1-flash-tts-preview' : process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
        podcastTtsInputTokenLimit: geminiTtsInputTokenLimit,
        podcastTtsOutputTokenLimit: geminiTtsOutputTokenLimit,
        podcastTtsChunkTokens,
        podcastTtsChunkChars,
        maxUnitsPerBook: Number(process.env.MAX_UNITS_PER_BOOK || 240),
        maxPodcastEpisodes,
        maxActivePodcastJobs,
        maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024),
        maxEpubUploadMb: Math.round(maxEpubUploadBytes / 1024 / 1024),
        maxPdfUploadMb: Math.round(maxPdfUploadBytes / 1024 / 1024),
        pdfOcrEnabled,
        pdfOcrProvider,
        pdfOcrVisionConfigured: shouldUseVisionOcr(),
        pdfOcrVisionModel,
        pdfOcrLanguage,
        pdfOcrDpi,
        pdfOcrVisionDpi,
        pdfOcrMaxPages,
        rateLimitWindowMinutes: Math.round(rateLimitWindowMs / 60000),
        rateLimits: {
          generateUnits: aiRateLimits['generate-unit'].max,
          upload: aiRateLimits.upload.max,
          definitions: aiRateLimits['define-word'].max,
          audio: aiRateLimits['speech-audio'].max,
          podcasts: aiRateLimits['generate-podcast'].max,
          serviceTests: aiRateLimits['service-test'].max,
        },
        activeJobs,
      },
    })
  })

  app.get('/api/ai/services', auth, requireAdmin, async (req, res) => {
    res.json(buildAiServicesPayload(req.db, req.user.id))
  })

  app.post('/api/ai/services/:serviceId/test', auth, requireAdmin, async (req, res) => {
    const serviceId = String(req.params.serviceId || '')
    const known = new Set(['text-ai', 'listening-tts', 'podcast-tts-primary', 'podcast-tts-fallback', 'vision-ocr', 'local-ocr'])
    if (!known.has(serviceId)) {
      res.status(404).json({ error: '未知服务' })
      return
    }
    if (!consumeUserQuota(req, res, 'service-test')) return

    let check
    const started = Date.now()
    try {
      check = saveServiceCheck(req.db, req.user.id, serviceId, await runAiServiceTest(serviceId))
    } catch (error) {
      check = saveServiceCheck(req.db, req.user.id, serviceId, {
        status: 'failed',
        message: error?.message || String(error),
        latencyMs: Date.now() - started,
      })
    }
    await writeDb(req.db)
    res.json({ check, ...buildAiServicesPayload(req.db, req.user.id) })
  })

  app.get('/api/admin/status', auth, requireAdmin, async (req, res) => {
    res.json(await buildAdminStatusPayload(req.db, req.user.id))
  })

  app.patch('/api/account/password', auth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '')
    const nextPassword = String(req.body.nextPassword || '')
    const passwordError = validatePasswordStrength(nextPassword)
    if (passwordError) {
      res.status(400).json({ error: passwordError })
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
      if (!consumeUserQuota(req, res, 'upload')) return
      if (!req.file) {
        res.status(400).json({ error: '请选择 EPUB 或 PDF 文件' })
        return
      }

      const original = req.file.originalname || 'book'
      const ext = path.extname(original).toLowerCase()
      if (!['.epub', '.pdf'].includes(ext)) {
        res.status(400).json({ error: '目前支持 EPUB 和 PDF 文件' })
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
      if (ext === '.epub' && !(await isEpubFile(req.file.buffer))) {
        res.status(400).json({ error: '文件内容不像有效的 EPUB，请确认文件没有损坏' })
        return
      }
      if (ext === '.pdf' && !isPdfFile(req.file.buffer)) {
        res.status(400).json({ error: '文件内容不像有效的 PDF，请确认文件没有损坏' })
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
      if (parsed.ocr) {
        recordAiUsage(db, {
          userId: req.user.id,
          category: 'ocr',
          action: 'pdf-ocr',
          provider: parsed.ocr.provider,
          model: parsed.ocr.provider,
          pages: parsed.ocr.pagesAttempted || parsed.ocr.pages,
          bytes: req.file.size,
          success: true,
        })
      }
      await writeDb(db)

      res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) }, units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
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
    res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) }, units: units.map((unit) => publicUnit(unit, db, req.user.id)) })
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
    res.json({ book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) } })
  })

  app.post('/api/books/:bookId/replan', auth, async (req, res, next) => {
    try {
      const db = req.db
      const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
      if (!book) {
        res.status(404).json({ error: '未找到这本书' })
        return
      }
      const result = await rebuildBookUnitsFromSource(db, book)
      await writeDb(db)
      res.json({
        book: { ...summarizeBook(book, result.units), glossary: buildBookGlossary(book, result.units) },
        units: result.units.map((unit) => publicUnit(unit, db, req.user.id)),
        previousUnitCount: result.previousUnitCount,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/books/:bookId', auth, async (req, res, next) => {
    try {
      const db = req.db
      const book = db.books.find((item) => item.id === req.params.bookId && item.userId === req.user.id)
      if (!book) {
        res.status(404).json({ error: '未找到这本书' })
        return
      }

      const units = db.units.filter((unit) => unit.bookId === book.id)
      const unitIds = new Set(units.map((unit) => unit.id))
      const podcasts = db.podcasts.filter((podcast) => podcast.bookId === book.id && podcast.userId === req.user.id)
      const podcastIds = new Set(podcasts.map((podcast) => podcast.id))
      const jobs = db.jobs.filter(
        (job) =>
          job.userId === req.user.id &&
          (job.bookId === book.id || unitIds.has(job.unitId) || podcastIds.has(job.podcastId))
      )
      const runningJobs = jobs.filter((job) => job.status === 'running')
      if (runningJobs.length) {
        res.status(409).json({ error: '这本书还有正在运行的生成任务，请稍后再删除，或先到任务中心取消任务' })
        return
      }
      const jobIds = new Set(jobs.map((job) => job.id))
      const progressCount = db.progress.filter((item) => !item.userId || (item.userId === req.user.id && unitIds.has(item.unitId))).length
      const reportCount = db.reports.filter((report) => report.bookId === book.id || unitIds.has(report.unitId)).length

      await Promise.all([
        ...podcasts.map((podcast) => deletePodcastAudioFiles(podcast)),
        ...units.map((unit) => deleteUnitAudioFiles(unit)),
        deleteSourceFileIfSafe(book.sourcePath),
      ])

      db.books = db.books.filter((item) => item.id !== book.id)
      db.units = db.units.filter((unit) => unit.bookId !== book.id)
      db.progress = db.progress.filter((item) => !unitIds.has(item.unitId))
      db.reports = db.reports.filter((report) => report.bookId !== book.id && !unitIds.has(report.unitId))
      db.jobs = db.jobs.filter((job) => !jobIds.has(job.id))
      db.podcasts = db.podcasts.filter((podcast) => podcast.bookId !== book.id || podcast.userId !== req.user.id)
      db.errorLogs = (db.errorLogs || []).filter((log) => !unitIds.has(log.unitId) && !podcastIds.has(log.podcastId) && !jobIds.has(log.jobId))

      await writeDb(db)
      res.json({
        ok: true,
        deleted: {
          book: 1,
          units: units.length,
          reports: reportCount,
          progress: progressCount,
          jobs: jobs.length,
          podcasts: podcasts.length,
        },
      })
    } catch (error) {
      next(error)
    }
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
      book: { ...summarizeBook(book, units), glossary: buildBookGlossary(book, units) },
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
      active.cancelRequested = true
      markJobCanceled(active)
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
      const generationSettings = generationSettingsFromBody(userSettings(db, req.user.id), req.body)
      const content = await buildGeneratedContent(unit, generationSettings)
      applyGeneratedContent(unit, content, {
        force: req.body.force,
        versionReason: generationSettings.fidelityMode === 'strict' ? 'fidelity-regenerated' : 'regenerated',
      })
      await writeDb(db)
      res.json({ unit: publicUnit(unit, db, req.user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/repair-paragraphs', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book) {
        res.status(404).json({ error: '未找到学习单元' })
        return
      }
      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const requested = Array.isArray(req.body.paragraphs) ? req.body.paragraphs : []
      const settings = generationSettingsFromBody(userSettings(db, req.user.id), req.body)
      const repair = await repairLowQualityParagraphs(unit, settings, requested)
      saveUnitVersion(unit, 'paragraph-repair')
      unit.content = repair.content
      unit.quality = assessContentQuality(unit.content, unit)
      unit.sourceRefs = unit.quality.sourceRefs
      unit.status = 'generated'
      unit.generatedAt = new Date().toISOString()
      unit.generation = {
        ...(unit.generation || {}),
        status: 'succeeded',
        progress: 100,
        message: `已修复阅读第 ${repair.repairedParagraphs.join('、')} 段`,
        finishedAt: unit.generatedAt,
      }
      await writeDb(db)
      res.json({ unit: publicUnit(unit, db, req.user.id), repairedParagraphs: repair.repairedParagraphs })
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
    const type = String(req.query.type || '')
    const errorCode = String(req.query.errorCode || '')
    const jobs = db.jobs
      .filter((job) => {
        if (job.userId !== req.user.id) return false
        if (status && job.status !== status) return false
        if (type && job.type !== type) return false
        if (errorCode && (job.errorCode || diagnoseJobError(job, job.error || job.message).errorCode) !== errorCode) return false
        return true
      })
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
      markJobCanceled(job)
      if (podcast) {
        podcast.status = 'failed'
        podcast.error = job.message
        podcast.updatedAt = job.updatedAt
      }
    } else if (action === 'cancel' && job.status === 'running') {
      job.cancelRequested = true
      job.message = '任务将在当前生成结束后取消'
      job.updatedAt = now
    } else if (['retry', 'retry-fallback'].includes(action) && ['failed', 'canceled'].includes(job.status)) {
      if (job.type === 'generate-podcast' && shouldRateLimitPodcast() && !consumeUserQuota(req, res, 'generate-podcast')) return
      if (job.type !== 'generate-podcast' && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      if (action === 'retry-fallback' && job.type !== 'generate-podcast') {
        res.status(400).json({ error: '只有播客任务支持备用 TTS 来源重试' })
        return
      }
      job.status = 'queued'
      job.progress = 0
      job.error = ''
      clearJobDiagnosis(job)
      job.cancelRequested = false
      job.preferTtsFallback = action === 'retry-fallback'
      job.retryCount = Number(job.retryCount || 0) + 1
      job.message = action === 'retry-fallback' ? '已用备用 TTS 来源重新加入队列' : '已重新加入队列'
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
        podcast.preferTtsFallback = action === 'retry-fallback'
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
          if (shouldRecordTextAiUsage()) {
            const source = textAiUsageSource()
            recordAiUsage(db, {
              userId: req.user.id,
              category: 'text',
              action: 'define-word',
              ...source,
              inputTokens: estimateTextTokens(`${term}\n${sentence}`),
              outputTokens: estimateTextTokens(JSON.stringify(detail)),
              success: true,
            })
          }
        } catch (error) {
          if (shouldRecordTextAiUsage()) {
            const source = textAiUsageSource()
            recordAiUsage(db, {
              userId: req.user.id,
              category: 'text',
              action: 'define-word',
              ...source,
              inputTokens: estimateTextTokens(`${term}\n${sentence}`),
              success: false,
              statusCode: parseStatusCode(error.message),
              message: error.message || '单词释义失败，使用本地兜底',
            })
          }
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

    const currentSettings = userSettings(db, req.user.id)
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
      readingLevel: currentSettings.readingLevel,
      listeningLevel: currentSettings.listeningLevel,
      studyMinutes: Math.max(1, Math.round(Number(currentSettings.studyMinutes || 10))),
      suggestion: adaptiveSuggestion({ correctRate, newVocabularyCount: vocabTerms.size }, currentSettings),
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
      const cachedAudio = await hasCachedSpeechAudio(audioRequest)
      if (!cachedAudio && shouldRateLimitSpeech() && !consumeUserQuota(req, res, 'speech-audio')) return
      let audio
      try {
        audio = await generateSpeechAudio(unit, audioRequest)
      } catch (error) {
        if (!cachedAudio) {
          recordAiUsage(db, {
            userId: req.user.id,
            category: 'audio',
            action: 'speech-audio',
            provider: audioRequest.ttsProvider,
            model: audioRequest.model,
            inputTokens: estimateTextTokens(audioRequest.input),
            success: false,
            statusCode: parseStatusCode(error.message),
            message: error.message || '听力音频生成失败',
          })
          await writeDb(db).catch((usageError) => console.error('failed to record ai usage', usageError))
        }
        throw error
      }
      if (!cachedAudio) {
        const stat = await fs.stat(audio.audioPath).catch(() => null)
        recordAiUsage(db, {
          userId: req.user.id,
          category: 'audio',
          action: 'speech-audio',
          provider: audio.ttsProvider,
          model: audio.model,
          inputTokens: estimateTextTokens(audio.input),
          audioBytes: stat?.size || 0,
          success: true,
        })
      }
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

  app.use((error, req, res, _next) => {
    console.error(error)
    const statusValue = Number(error.status || error.statusCode || 500)
    const status = Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : 500
    if (status >= 500) {
      ;(async () => {
        try {
          const db = req.db || (await readDb())
          appendErrorLog(db, {
            scope: 'server',
            message: error.message || '服务器出现错误',
            detail: `${req.method || ''} ${req.originalUrl || req.url || ''}`.trim(),
            userId: req.user?.id || '',
            statusCode: status,
            errorCode: 'server-error',
          })
          await writeDb(db)
        } catch (logError) {
          console.error('failed to write error log', logError)
        }
      })()
    }
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

function cliArgValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return String(process.argv[index + 1] || '')
}

async function runReplanBookCli() {
  await ensureStore()
  const db = await readDb()
  const bookId = cliArgValue('--book-id')
  const title = cliArgValue('--book-title')
  const book = db.books.find((item) => (bookId && item.id === bookId) || (title && String(item.title || item.filename || '').includes(title)))
  if (!book) throw new Error('未找到要重建单元的书籍，请提供 --book-id 或 --book-title')
  const result = await rebuildBookUnitsFromSource(db, book)
  await writeDb(db)
  const counts = result.units.map((unit) => Number(unit.sourceWordCount || 0)).sort((a, b) => a - b)
  const sum = counts.reduce((total, count) => total + count, 0)
  console.log(
    JSON.stringify(
      {
        bookId: book.id,
        title: book.title,
        previousUnitCount: result.previousUnitCount,
        unitCount: result.units.length,
        sourceWordsPerUnit,
        sourceWordsMergeMin,
        min: counts[0] || 0,
        median: counts[Math.floor(counts.length / 2)] || 0,
        avg: counts.length ? Math.round(sum / counts.length) : 0,
        max: counts[counts.length - 1] || 0,
      },
      null,
      2
    )
  )
  closeStore()
}

if (process.argv.includes('--replan-book')) {
  runReplanBookCli().catch((error) => {
    console.error(error)
    closeStore()
    process.exit(1)
  })
} else {
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
}
