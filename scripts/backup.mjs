import fs from 'node:fs/promises'
import crypto from 'node:crypto'
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

const zip = new JSZip()
zip.file('backup-meta.json', JSON.stringify({ createdAt: new Date().toISOString(), app: 'LinguaShelf' }, null, 2))
await addDirectory(zip.folder('data'), dataDir)

const zipBytes = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
})
const bytes = backupKey ? encryptBackup(zipBytes, backupKey) : zipBytes
await fs.writeFile(out, bytes)

console.log(`Backup written: ${out}${backupKey ? ' (encrypted)' : ''}`)

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

async function addDirectory(folder, dir) {
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const source = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await addDirectory(folder.folder(entry.name), source)
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
