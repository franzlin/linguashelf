// Every environment-derived constant, in one leaf module.
//
// `parseBoolean` and `bytesFromMegabytes` live here rather than with the other
// helpers because several constants below call them at module-evaluation time;
// in the single-file version that worked through function hoisting, which does
// not survive being split across modules.
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(__dirname, '..')

export function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

export function bytesFromMegabytes(value, fallbackMb) {
  const mb = Number(value)
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb
  return Math.round(safeMb * 1024 * 1024)
}

export function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

export function readDeployRevision() {
  const fromEnv = String(process.env.GIT_REVISION || '').trim()
  if (fromEnv) return fromEnv
  try {
    const filed = fsSync.readFileSync(path.join(root, '.deployed-revision'), 'utf8').trim()
    if (filed) return filed.split(/\s+/)[0]
  } catch {
    // no revision file in this checkout
  }
  return 'unknown'
}

export const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data')

export const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(root, 'backups')

export const uploadDir = path.join(dataDir, 'uploads')

export const uploadTempDir = path.join(dataDir, 'upload-tmp')

export const audioDir = path.join(dataDir, 'audio')

export const dbPath = path.join(dataDir, 'db.json')

export const sqlitePath = path.join(dataDir, 'app.sqlite')

export const storageDriver = String(process.env.STORAGE_DRIVER || 'sqlite').toLowerCase()

export const deployRevision = readDeployRevision()


export const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'

export const port = Number(process.env.PORT || 5173)

export const signupInviteCode = String(process.env.SIGNUP_INVITE_CODE || '')

export const allowSignup = parseBoolean(process.env.ALLOW_SIGNUP, false)

export const sessionDays = Number(process.env.SESSION_DAYS || 30)

export const sessionCookieName = 'linguashelf_session'

export const loginWindowMs = Number(process.env.LOGIN_WINDOW_MINUTES || 10) * 60 * 1000

export const loginMaxFailures = Number(process.env.LOGIN_MAX_FAILURES || 8)

export const passwordMinLength = Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH || 8))

export const passwordPbkdf2Iterations = Math.max(600_000, Number(process.env.PASSWORD_PBKDF2_ITERATIONS) || 600_000)

export const maxAutoRegenAttempts = Number(process.env.MAX_AUTO_REGEN_ATTEMPTS || 1)

export const maxAutoFailureRetries = Math.max(0, Number(process.env.MAX_AUTO_FAILURE_RETRIES || 2))

export const autoFailureRetryBaseSeconds = Math.max(30, Number(process.env.AUTO_FAILURE_RETRY_BASE_SECONDS || 180))

export const maxUploadBytes = bytesFromMegabytes(process.env.MAX_UPLOAD_MB, 50)

export const maxActiveUploadParses = Math.max(1, Number(process.env.MAX_ACTIVE_UPLOAD_PARSES) || 1)

export const maxEpubUploadBytes = bytesFromMegabytes(process.env.MAX_EPUB_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))

export const maxPdfUploadBytes = bytesFromMegabytes(process.env.MAX_PDF_UPLOAD_MB, Math.min(50, maxUploadBytes / 1024 / 1024))

export const maxEpubExpandedBytes = bytesFromMegabytes(process.env.MAX_EPUB_EXPANDED_MB, 200)

export const maxEpubEntries = Number(process.env.MAX_EPUB_ENTRIES || 2000)

export const sourceWordsPerUnit = Math.max(600, Math.min(3500, Number(process.env.SOURCE_WORDS_PER_UNIT || 1700)))

export const sourceWordsMergeMin = Math.max(300, Math.min(sourceWordsPerUnit, Number(process.env.SOURCE_WORDS_MIN_PER_UNIT || Math.round(sourceWordsPerUnit * 0.7))))

export const pdfOcrEnabled = parseBoolean(process.env.PDF_OCR_ENABLED, true)

export const pdfOcrProvider = String(process.env.PDF_OCR_PROVIDER || 'hunyuan-first').toLowerCase()

export const pdfOcrLanguage = String(process.env.PDF_OCR_LANGUAGE || 'eng')

export const pdfOcrDpi = Math.max(120, Math.min(350, Number(process.env.PDF_OCR_DPI || 220)))

export const pdfOcrMaxPages = Math.max(1, Number(process.env.PDF_OCR_MAX_PAGES || 120))

export const pdfOcrCommandTimeoutMs = Math.max(10_000, Number(process.env.PDF_OCR_COMMAND_TIMEOUT_MS || 120_000))

export const pdfOcrVisionDpi = Math.max(90, Math.min(220, Number(process.env.PDF_OCR_VISION_DPI || 110)))

export const pdfOcrVisionMinWords = Math.max(10, Number(process.env.PDF_OCR_VISION_MIN_WORDS || 40))

export const pdfSectionTargetWords = Math.max(1200, Number(process.env.PDF_SECTION_TARGET_WORDS || 3400))

export const aiTextRequestTimeoutMs = Math.max(1_000, Number(process.env.AI_TEXT_REQUEST_TIMEOUT_MS) || 120_000)

export const ttsRequestTimeoutMs = Math.max(1_000, Number(process.env.TTS_REQUEST_TIMEOUT_MS) || 180_000)

export const ocrHttpRequestTimeoutMs = Math.max(1_000, Number(process.env.OCR_HTTP_REQUEST_TIMEOUT_MS) || 120_000)

export const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 60) * 60 * 1000

export const podcastLexileDefault = Number(process.env.PODCAST_LEXILE_DEFAULT || 900)

export const podcastLexileMin = 500

export const podcastLexileMax = 1500

export const maxPodcastEpisodes = Number(process.env.MAX_PODCAST_EPISODES || 12)

export const maxActivePodcastJobs = Number(process.env.MAX_ACTIVE_PODCAST_JOBS || 2)

export const geminiTtsInputTokenLimit = Math.max(1024, Number(process.env.GEMINI_TTS_INPUT_TOKEN_LIMIT || 8192))

export const geminiTtsOutputTokenLimit = Math.max(1024, Number(process.env.GEMINI_TTS_OUTPUT_TOKEN_LIMIT || 16384))

export const defaultPodcastTtsChunkTokens = Math.min(5500, Math.max(512, geminiTtsInputTokenLimit - 512))

export const podcastTtsChunkTokens = Math.max(512, Math.min(geminiTtsInputTokenLimit - 256, Number(process.env.PODCAST_TTS_CHUNK_TOKENS || defaultPodcastTtsChunkTokens)))

export const podcastTtsChunkChars = Math.min(20_000, Math.max(1200, Number(process.env.PODCAST_TTS_CHUNK_CHARS || 2800)))

export const podcastTtsConcurrency = Number(process.env.PODCAST_TTS_CONCURRENCY || 2)

export const dashscopeTtsVoices = new Set(['longanlingxin', 'longanlufeng'])

export const legacyPodcastVoices = new Set(['Kore', 'Puck', 'Charon', 'Aoede'])

export const podcastAudioFormat = String(process.env.PODCAST_AUDIO_FORMAT || 'mp3').toLowerCase()

export const podcastMp3Kbps = Number(process.env.PODCAST_MP3_KBPS || 64)

export const podcastScriptSourceChunkWords = Number(process.env.PODCAST_SCRIPT_SOURCE_CHUNK_WORDS || 2600)

export const podcastKindOrder = ['preview', 'review', 'topic', 'walkthrough']

export const podcastKindLabels = {
  preview: '读前导入',
  review: '读后复盘',
  topic: '全书专题',
  walkthrough: '全书分集讲解',
}

export const podcastTtsProviderOrder = ['dashscope-qwen', 'official-gemini', 'gemini-fallback']

export const podcastTtsProviderLabels = {
  'dashscope-qwen': 'Qwen TTS（DashScope）',
  'official-gemini': 'Gemini 3.1',
  'gemini-fallback': 'Gemini 2.5',
}

export const aiRateLimits = {
  upload: { max: Number(process.env.RATE_LIMIT_UPLOAD_MAX || 8), windowMs: rateLimitWindowMs },
  'generate-unit': { max: Number(process.env.RATE_LIMIT_GENERATE_UNITS_MAX || 20), windowMs: rateLimitWindowMs },
  'define-word': { max: Number(process.env.RATE_LIMIT_DEFINITIONS_MAX || 120), windowMs: rateLimitWindowMs },
  'speech-audio': { max: Number(process.env.RATE_LIMIT_AUDIO_MAX || 30), windowMs: rateLimitWindowMs },
  'generate-podcast': { max: Number(process.env.RATE_LIMIT_PODCAST_EPISODES_MAX || 12), windowMs: rateLimitWindowMs },
  'generate-micro-practice': { max: Number(process.env.RATE_LIMIT_MICRO_PRACTICE_MAX || 40), windowMs: rateLimitWindowMs },
  'service-test': { max: Number(process.env.RATE_LIMIT_SERVICE_TEST_MAX || 12), windowMs: rateLimitWindowMs },
}



