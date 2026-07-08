import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const backupFile = positionalArgs[0]
const reportPath = path.resolve(readArg('--report') || positionalArgs[1] || path.join(root, 'backups', `restore-drill-${stamp()}.json`))

if (!backupFile) {
  console.error('Usage: npm run backup:drill -- <backup.zip> [--report ./backups/report.json]')
  process.exit(1)
}

const resolvedBackup = path.resolve(backupFile)
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-restore-drill-'))
const drillDataDir = path.join(tmpRoot, 'data')
const report = {
  ok: false,
  createdAt: new Date().toISOString(),
  backupFile: resolvedBackup,
  backupBytes: 0,
  hasMeta: false,
  hasDatabase: false,
  dataEntries: 0,
  restoredFiles: 0,
  restoredBytes: 0,
  recordCount: 0,
  collections: {},
  error: '',
}

try {
  const bytes = await fs.readFile(resolvedBackup)
  report.backupBytes = bytes.length
  const zipBytes = decryptBackupIfNeeded(bytes)
  const zip = await JSZip.loadAsync(zipBytes)
  const entries = Object.values(zip.files)
  report.hasMeta = Boolean(zip.files['backup-meta.json'])
  report.hasDatabase = entries.some((entry) => !entry.dir && ['data/app.sqlite', 'data/db.json'].includes(entry.name))
  report.dataEntries = entries.filter((entry) => !entry.dir && entry.name.startsWith('data/')).length

  if (!report.hasMeta) throw new Error('备份缺少 backup-meta.json')
  if (!report.hasDatabase) throw new Error('备份缺少 app.sqlite 或 db.json')
  if (!report.dataEntries) throw new Error('备份中没有 data/ 文件')

  await execFileAsync(process.execPath, [path.join(root, 'scripts', 'restore.mjs'), resolvedBackup], {
    cwd: root,
    env: { ...process.env, DATA_DIR: drillDataDir },
    timeout: Number(process.env.RESTORE_DRILL_TIMEOUT_MS || 180_000),
  })

  const restored = await summarizeDirectory(drillDataDir)
  report.restoredFiles = restored.files
  report.restoredBytes = restored.bytes

  const sqlitePath = path.join(drillDataDir, 'app.sqlite')
  const jsonPath = path.join(drillDataDir, 'db.json')
  if (await exists(sqlitePath)) {
    const sqliteSummary = await summarizeSqlite(sqlitePath)
    report.recordCount = sqliteSummary.recordCount
    report.collections = sqliteSummary.collections
  } else if (await exists(jsonPath)) {
    const jsonSummary = await summarizeJsonDb(jsonPath)
    report.recordCount = jsonSummary.recordCount
    report.collections = jsonSummary.collections
  }

  if (!report.restoredFiles) throw new Error('恢复演练没有生成任何文件')
  if (!report.recordCount) throw new Error('恢复后的数据库没有记录')
  report.ok = true
} catch (error) {
  report.error = error?.message || String(error)
  process.exitCode = 1
} finally {
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (!process.env.KEEP_RESTORE_DRILL_TEMP) await fs.rm(tmpRoot, { recursive: true, force: true })
}

function decryptBackupIfNeeded(bytes) {
  if (bytes.subarray(0, 4).toString('utf8') !== 'LSB1') return bytes
  const passphrase = String(process.env.BACKUP_ENCRYPTION_KEY || '')
  if (!passphrase) throw new Error('备份已加密，请设置 BACKUP_ENCRYPTION_KEY 后再演练恢复')
  const salt = bytes.subarray(4, 20)
  const iv = bytes.subarray(20, 32)
  const tag = bytes.subarray(32, 48)
  const ciphertext = bytes.subarray(48)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

if (report.ok) {
  console.log(`Restore drill passed: ${reportPath}`)
} else {
  console.error(`Restore drill failed: ${report.error}`)
  console.error(`Report written: ${reportPath}`)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return process.argv[index + 1] || ''
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function summarizeDirectory(dir) {
  let files = 0
  let bytes = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const child = await summarizeDirectory(fullPath)
      files += child.files
      bytes += child.bytes
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath)
      files += 1
      bytes += stat.size
    }
  }
  return { files, bytes }
}

async function summarizeSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const collections = {}
    const rows = db.prepare('SELECT collection, COUNT(*) AS count FROM records GROUP BY collection').all()
    for (const row of rows) collections[row.collection] = Number(row.count || 0)
    return {
      collections,
      recordCount: Object.values(collections).reduce((sum, count) => sum + count, 0),
    }
  } finally {
    db.close()
  }
}

async function summarizeJsonDb(file) {
  const db = JSON.parse(await fs.readFile(file, 'utf8'))
  const collections = {}
  for (const [key, value] of Object.entries(db)) {
    if (Array.isArray(value)) collections[key] = value.length
  }
  return {
    collections,
    recordCount: Object.values(collections).reduce((sum, count) => sum + count, 0),
  }
}
