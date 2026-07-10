import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const baseUrl = process.env.BASE_URL || ''
const results = []

await checkRequiredFiles()
await checkDockerignore()
await checkPackageScripts()
await checkEnvExample()
await checkBuildOutput()
await checkForCommittedSecrets()
if (baseUrl) await checkHttpTarget(baseUrl)

const failures = results.filter((item) => item.status === 'fail')
const warnings = results.filter((item) => item.status === 'warn')
for (const item of results) {
  const label = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL'
  console.log(`${label} ${item.message}`)
}

console.log('')
console.log(`Predeploy checks: ${results.length - warnings.length - failures.length} passed, ${warnings.length} warnings, ${failures.length} failures.`)
if (failures.length) process.exit(1)

async function checkRequiredFiles() {
  const files = [
    'server/index.js',
    'src/App.tsx',
    'src/main.tsx',
    'src/style.css',
    'public/manifest.webmanifest',
    'public/sw.js',
    'Dockerfile',
    'docker-compose.yml',
    'deploy/Caddyfile',
    'DEPLOYMENT.md',
    'README.md',
    '.env.example',
  ]
  for (const file of files) {
    const ok = await exists(path.join(root, file))
    record(ok ? 'pass' : 'fail', `${file} ${ok ? 'exists' : 'is missing'}`)
  }
}

async function checkDockerignore() {
  const dockerignorePath = path.join(root, '.dockerignore')
  const text = await readTextIfPresent(dockerignorePath)
  if (!text) {
    record('fail', '.dockerignore is missing')
    return
  }
  for (const pattern of ['.env', 'data', 'node_modules', 'backups', 'work-*.wav', 'sample-*.wav', 'sample-tts.mjs', '*.log']) {
    record(text.includes(pattern) ? 'pass' : 'fail', `.dockerignore excludes ${pattern}`)
  }
}

async function checkPackageScripts() {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  for (const script of ['check', 'build', 'start', 'backup', 'restore']) {
    record(packageJson.scripts?.[script] ? 'pass' : 'fail', `package.json has ${script} script`)
  }
}

async function checkEnvExample() {
  const text = await readTextIfPresent(path.join(root, '.env.example'))
  if (!text) {
    record('fail', '.env.example is missing')
    return
  }
  const required = [
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_BASE_URL',
    'OPENAI_TTS_PROVIDER',
    'OPENAI_TTS_API_KEY',
    'OPENAI_TTS_BASE_URL',
    'OPENAI_TTS_MODEL',
    'OPENAI_TTS_VOICES',
    'NODE_ENV',
    'DATA_DIR',
    'BACKUP_DIR',
    'BACKUP_ENCRYPTION_KEY',
    'BACKUP_ENCRYPTION_REQUIRED',
    'APP_DOMAIN',
    'ALLOW_SIGNUP',
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'PASSWORD_MIN_LENGTH',
    'PASSWORD_PBKDF2_ITERATIONS',
    'STORAGE_DRIVER',
    'MAX_UPLOAD_MB',
    'MAX_ACTIVE_UPLOAD_PARSES',
    'PDF_OCR_ENABLED',
    'PDF_OCR_PROVIDER',
    'PDF_OCR_VISION_MODEL',
    'PDF_OCR_VISION_BASE_URL',
    'PDF_OCR_VISION_API_KEY',
    'PDF_OCR_VISION_DPI',
    'PDF_OCR_VISION_MIN_WORDS',
    'PDF_OCR_LANGUAGE',
    'PDF_OCR_DPI',
    'PDF_OCR_MAX_PAGES',
    'PDF_OCR_COMMAND_TIMEOUT_MS',
    'OCR_HTTP_REQUEST_TIMEOUT_MS',
    'AI_TEXT_REQUEST_TIMEOUT_MS',
    'TTS_REQUEST_TIMEOUT_MS',
    'MAX_ACTIVE_OCR_TASKS',
    'RATE_LIMIT_UPLOAD_MAX',
    'RATE_LIMIT_GENERATE_UNITS_MAX',
    'RATE_LIMIT_DEFINITIONS_MAX',
    'RATE_LIMIT_AUDIO_MAX',
    'RATE_LIMIT_MICRO_PRACTICE_MAX',
    'RATE_LIMIT_SERVICE_TEST_MAX',
    'MAX_AUTO_FAILURE_RETRIES',
    'AUTO_FAILURE_RETRY_BASE_SECONDS',
    'GEMINI_TTS_OFFICIAL_BASE_URL',
    'GEMINI_TTS_OFFICIAL_API_KEY',
    'GEMINI_TTS_OFFICIAL_MODEL',
    'GEMINI_TTS_INPUT_TOKEN_LIMIT',
    'GEMINI_TTS_OUTPUT_TOKEN_LIMIT',
    'GEMINI_TTS_BASE_URL',
    'GEMINI_TTS_API_KEY',
    'GEMINI_TTS_MODEL',
    'GEMINI_TTS_VOICE',
    'GEMINI_TTS_31_INSTRUCTIONS',
    'GEMINI_TTS_FALLBACK_INSTRUCTIONS',
    'PODCAST_LEXILE_DEFAULT',
    'PODCAST_SOURCE_WORDS_PER_EPISODE',
    'MAX_PODCAST_EPISODES',
    'PODCAST_TTS_CHUNK_TOKENS',
    'PODCAST_TTS_CHUNK_CHARS',
    'PODCAST_TTS_CONCURRENCY',
    'PODCAST_AUDIO_FORMAT',
    'PODCAST_MP3_KBPS',
    'PODCAST_SCRIPT_SOURCE_CHUNK_WORDS',
    'MAX_ACTIVE_PODCAST_JOBS',
    'RATE_LIMIT_PODCAST_EPISODES_MAX',
    'QUALITY_AUDIT_MODE',
  ]
  for (const key of required) {
    record(new RegExp(`^${key}=`, 'm').test(text) ? 'pass' : 'fail', `.env.example includes ${key}`)
  }
}

async function checkBuildOutput() {
  const distIndex = path.join(root, 'dist/index.html')
  const manifest = path.join(root, 'dist/manifest.webmanifest')
  const serviceWorker = path.join(root, 'dist/sw.js')
  record((await exists(distIndex)) ? 'pass' : 'warn', 'dist/index.html is present')
  record((await exists(manifest)) ? 'pass' : 'warn', 'dist/manifest.webmanifest is present')
  record((await exists(serviceWorker)) ? 'pass' : 'warn', 'dist/sw.js is present')
}

async function checkForCommittedSecrets() {
  const findings = []
  const secretPatterns = [
    new RegExp('sk-' + '[A-Za-z0-9_-]{20,}'),
    /(?<!EXAMPLE_)OPENAI_API_KEY=(?!\s*$|你的|your)[^\s]+/i,
    /(?<!EXAMPLE_)OPENAI_TTS_API_KEY=(?!\s*$|你的|your)[^\s]+/i,
    /(?<!EXAMPLE_)GEMINI_TTS_OFFICIAL_API_KEY=(?!\s*$|你的|your)[^\s]+/i,
    /(?<!EXAMPLE_)GEMINI_TTS_API_KEY=(?!\s*$|你的|your)[^\s]+/i,
    /(?<!EXAMPLE_)PDF_OCR_VISION_API_KEY=(?!\s*$|你的|your)[^\s]+/i,
  ]
  const excludedDirs = new Set(['node_modules', 'data', 'backups', 'dist', '.git', 'work-screenshots'])
  const excludedFiles = new Set(['.env'])
  const textExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.css', '.html', '.md', '.json', '.yml', '.yaml', '.example', '.txt', '.service', ''])

  await walk(root, async (file, dirent) => {
    if (!dirent.isFile()) return
    if (path.relative(root, file) === path.join('scripts', 'predeploy-check.mjs')) return
    const name = path.basename(file)
    if (excludedFiles.has(name) || name.endsWith('.log') || name.endsWith('.wav') || name.endsWith('.sqlite')) return
    const ext = path.extname(file)
    if (!textExtensions.has(ext) && !name.startsWith('.')) return
    const stat = await fs.stat(file)
    if (stat.size > 1024 * 1024) return
    const text = await fs.readFile(file, 'utf8')
    if (secretPatterns.some((pattern) => pattern.test(text))) findings.push(path.relative(root, file))
  }, excludedDirs)

  record(findings.length ? 'fail' : 'pass', findings.length ? `possible committed secrets in ${findings.join(', ')}` : 'no committed API-key-like secrets found outside ignored data')
}

async function checkHttpTarget(rawUrl) {
  const url = rawUrl.replace(/\/$/, '')
  try {
    const health = await fetch(`${url}/api/health`)
    record(health.ok, `${url}/api/health returns HTTP ${health.status}`)
    const ready = await fetch(`${url}/api/ready`)
    record(ready.ok, `${url}/api/ready returns HTTP ${ready.status}`)
    const home = await fetch(`${url}/`)
    const csp = home.headers.get('content-security-policy')
    record(home.ok, `${url}/ returns HTTP ${home.status}`)
    record(Boolean(csp), 'Content-Security-Policy header is present')
    const manifest = await fetch(`${url}/manifest.webmanifest`)
    record(manifest.ok, `${url}/manifest.webmanifest returns HTTP ${manifest.status}`)
    const sw = await fetch(`${url}/sw.js`)
    record(sw.ok, `${url}/sw.js returns HTTP ${sw.status}`)
  } catch (error) {
    record('fail', `HTTP target check failed: ${error.message}`)
  }
}

async function walk(dir, visit, excludedDirs) {
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(fullPath, visit, excludedDirs)
    else await visit(fullPath, entry)
  }
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function readTextIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

function record(status, message) {
  results.push({ status: status === true ? 'pass' : status === false ? 'fail' : status, message })
}
