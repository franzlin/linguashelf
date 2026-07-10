import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data')
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(root, 'backups')
const backupKey = String(process.env.BACKUP_ENCRYPTION_KEY || '')
const encryptionRequired = ['1', 'true', 'yes', 'on'].includes(String(process.env.BACKUP_ENCRYPTION_REQUIRED || '').toLowerCase())
const out = resolveOutputPath()

if (encryptionRequired && !backupKey) {
  console.error('BACKUP_ENCRYPTION_REQUIRED is enabled but BACKUP_ENCRYPTION_KEY is empty')
  process.exit(1)
}

await fs.mkdir(path.dirname(out), { recursive: true })
const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-backup-'))

try {
  const sqliteSnapshot = await createSqliteSnapshotIfPresent(snapshotRoot)
  const skippedDataEntries = new Set(['upload-tmp'])
  if (sqliteSnapshot) {
    skippedDataEntries.add('app.sqlite')
    skippedDataEntries.add('app.sqlite-wal')
    skippedDataEntries.add('app.sqlite-shm')
  }
  const zip = new JSZip()
  zip.file(
    'backup-meta.json',
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        app: 'LinguaShelf',
        databaseSnapshot: sqliteSnapshot ? 'sqlite-vacuum-into' : 'file-copy',
      },
      null,
      2
    )
  )
  await addDirectory(zip.folder('data'), dataDir, skippedDataEntries)
  if (sqliteSnapshot) zip.folder('data').file('app.sqlite', await fs.readFile(sqliteSnapshot))

  const zipBytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const bytes = backupKey ? encryptBackup(zipBytes, backupKey) : zipBytes
  await fs.writeFile(out, bytes)

  console.log(`Backup written: ${out}${backupKey ? ' (encrypted)' : ''}`)
} finally {
  await fs.rm(snapshotRoot, { recursive: true, force: true })
}

function resolveOutputPath() {
  const explicit = readArg('--out')
  if (explicit) return path.resolve(explicit)
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  if (positional) return path.resolve(positional)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(backupDir, `linguashelf-${stamp}.zip${backupKey ? '.enc' : ''}`)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return process.argv[index + 1] || ''
}

async function createSqliteSnapshotIfPresent(snapshotRoot) {
  const source = path.join(dataDir, 'app.sqlite')
  try {
    await fs.access(source)
  } catch {
    return ''
  }
  const target = path.join(snapshotRoot, 'app.sqlite')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
  return target
}

async function addDirectory(folder, dir, skipRootEntries = new Set(), atRoot = true) {
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (atRoot && skipRootEntries.has(entry.name)) continue
    const source = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await addDirectory(folder.folder(entry.name), source, skipRootEntries, false)
    } else if (entry.isFile()) {
      folder.file(entry.name, await fs.readFile(source))
    }
  }
}

function encryptBackup(bytes, passphrase) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from('LSB1'), salt, iv, tag, ciphertext])
}
