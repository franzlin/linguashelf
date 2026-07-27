// Persistence: SQLite (default) and the legacy JSON snapshot, behind one
// read-whole-snapshot / write-changes interface.
//
// `progressKey` lives here because the change-tracking layer needs it to derive
// a stable row id for progress records.
import fs from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { audioDir, dataDir, dbPath, sqlitePath, storageDriver, uploadDir, uploadTempDir } from './config.js'

export const dbSnapshotMeta = Symbol('dbSnapshotMeta')

export let writeChain = Promise.resolve()

export const defaultDb = {
  users: [],
  sessions: [],
  books: [],
  units: [],
  reports: [],
  progress: [],
  vocabulary: [],
  definitions: [],
  settings: [],
  appSettings: [],
  jobs: [],
  podcasts: [],
  microPractices: [],
  microAttempts: [],
  serviceChecks: [],
  errorLogs: [],
  aiUsage: [],
}

export let sqliteDb = null

export async function ensureStore() {
  await fs.mkdir(uploadDir, { recursive: true })
  await fs.mkdir(uploadTempDir, { recursive: true })
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

export async function readDb() {
  await ensureStore()
  if (storageDriver === 'sqlite') return readSqliteSnapshot()
  const raw = await fs.readFile(dbPath, 'utf8')
  return normalizeDb(JSON.parse(raw))
}

export async function writeDb(db) {
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

export async function withKeyedLock(lockMap, key, work) {
  const previous = lockMap.get(key) || Promise.resolve()
  let release = () => undefined
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  lockMap.set(key, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (lockMap.get(key) === tail) lockMap.delete(key)
  }
}

export async function writeJsonSnapshot(db) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(dbPath, JSON.stringify(normalizeDb(db), null, 2), 'utf8')
}

export async function readJsonSnapshotIfPresent() {
  try {
    const raw = await fs.readFile(dbPath, 'utf8')
    return normalizeDb(JSON.parse(raw))
  } catch {
    return null
  }
}

export function normalizeDb(db) {
  const next = {}
  for (const key of Object.keys(defaultDb)) {
    next[key] = Array.isArray(db?.[key]) ? db[key] : []
  }
  return next
}

export async function openSqlite() {
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

export function readSqliteSnapshot() {
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

export function writeSqliteSnapshot(db) {
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

export function writeSqliteChanges(db) {
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

export function createSnapshotMeta() {
  const records = new Map()
  for (const collection of Object.keys(defaultDb)) records.set(collection, new Map())
  return { records }
}

export function buildSnapshotMeta(snapshot) {
  const meta = createSnapshotMeta()
  for (const [collection, items] of Object.entries(normalizeDb(snapshot))) {
    items.forEach((item, index) => {
      meta.records.get(collection).set(recordId(collection, item, index), JSON.stringify(item))
    })
  }
  return meta
}

export function attachSnapshotMeta(db, meta) {
  Object.defineProperty(db, dbSnapshotMeta, {
    value: meta,
    enumerable: false,
    configurable: true,
  })
}

export function recordId(collection, item, index) {
  if (item?.id) return String(item.id)
  if (collection === 'sessions' && (item?.tokenHash || item?.token)) return String(item.tokenHash || item.token)
  if (collection === 'settings' && item?.userId) return String(item.userId)
  if (collection === 'progress' && item?.userId && item?.unitId) return progressKey(item.userId, item.unitId)
  if (collection === 'definitions' && item?.key) return `${item.userId || 'global'}:${item.key}`
  return `${collection}:${index}`
}

export async function storageHealth() {
  await ensureStore()
  await readDb()
  return { ok: true }
}

export function closeStore() {
  if (!sqliteDb) return
  sqliteDb.close()
  sqliteDb = null
}

export function progressKey(userId, unitId) {
  return `${userId}:${unitId}`
}
