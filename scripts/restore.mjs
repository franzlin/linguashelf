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
const safetyDir = `${dataDir}-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`

try {
  await fs.rename(dataDir, safetyDir)
  console.log(`Current data moved to: ${safetyDir}`)
} catch {
  await fs.mkdir(path.dirname(dataDir), { recursive: true })
}

await fs.mkdir(dataDir, { recursive: true })

for (const entry of Object.values(zip.files)) {
  if (entry.dir || !entry.name.startsWith('data/')) continue
  const relative = entry.name.slice('data/'.length)
  if (!relative) continue
  const target = path.resolve(dataDir, relative)
  const targetRelative = path.relative(dataDir, target)
  if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) throw new Error(`Unsafe backup path: ${entry.name}`)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, await entry.async('nodebuffer'))
}

console.log(`Restored data from: ${resolvedBackup}`)

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
