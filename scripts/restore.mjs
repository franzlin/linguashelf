import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data')
const backupFile = process.argv[2]

if (!backupFile) {
  console.error('Usage: npm run restore -- <backup.zip>')
  process.exit(1)
}

const resolvedBackup = path.resolve(backupFile)
const backupBytes = await readBackupBytes(resolvedBackup)
const zip = await JSZip.loadAsync(backupBytes)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const safetyDir = `${dataDir}-before-restore-${stamp}`
const stagingDir = `${dataDir}-restore-staging-${stamp}`
let currentMoved = false

await fs.mkdir(path.dirname(dataDir), { recursive: true })
await fs.rm(stagingDir, { recursive: true, force: true })

try {
  await extractData(zip, stagingDir)
  await validateRestoredData(stagingDir)

  try {
    await fs.rename(dataDir, safetyDir)
    currentMoved = true
    console.log(`Current data moved to: ${safetyDir}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  try {
    await fs.rename(stagingDir, dataDir)
  } catch (error) {
    if (currentMoved) {
      try {
        await fs.rename(safetyDir, dataDir)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `恢复切换失败，原数据仍保存在 ${safetyDir}`)
      }
    }
    throw error
  }

  console.log(`Restored data from: ${resolvedBackup}`)
} catch (error) {
  await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
  throw error
}

async function extractData(sourceZip, targetDir) {
  let restoredFiles = 0
  await fs.mkdir(targetDir, { recursive: true })
  for (const entry of Object.values(sourceZip.files)) {
    if (entry.dir || !entry.name.startsWith('data/')) continue
    const relative = entry.name.slice('data/'.length)
    if (!relative) continue
    const target = path.resolve(targetDir, relative)
    const targetRelative = path.relative(targetDir, target)
    if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) throw new Error(`Unsafe backup path: ${entry.name}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, await entry.async('nodebuffer'))
    restoredFiles += 1
  }
  if (!restoredFiles) throw new Error('备份中没有可恢复的 data/ 文件')
}

async function validateRestoredData(targetDir) {
  const sqliteFile = path.join(targetDir, 'app.sqlite')
  const jsonFile = path.join(targetDir, 'db.json')
  try {
    await fs.access(sqliteFile)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(sqliteFile, { readOnly: true })
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get()
      if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok') throw new Error('SQLite 完整性检查失败')
      db.prepare('SELECT COUNT(*) AS count FROM records').get()
    } finally {
      db.close()
    }
    return
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  try {
    const parsed = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('db.json 结构无效')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('备份缺少 app.sqlite 或 db.json')
    throw error
  }
}

async function readBackupBytes(file) {
  const bytes = await fs.readFile(file)
  if (bytes.subarray(0, 4).toString('utf8') !== 'LSB1') return bytes
  const passphrase = String(process.env.BACKUP_ENCRYPTION_KEY || '')
  if (!passphrase) throw new Error('备份已加密，请设置 BACKUP_ENCRYPTION_KEY 后再恢复')
  const salt = bytes.subarray(4, 20)
  const iv = bytes.subarray(20, 32)
  const tag = bytes.subarray(32, 48)
  const ciphertext = bytes.subarray(48)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
