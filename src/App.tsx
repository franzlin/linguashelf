import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookMarked,
  BookOpen,
  Brain,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Diff,
  Download,
  FileText,
  Flame,
  Headphones,
  Home,
  ListChecks,
  Loader2,
  LogOut,
  MapPin,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  Settings,
  Tags,
  TrendingUp,
  Trash2,
  Upload,
  User,
  Volume2,
  X,
} from 'lucide-react'

type View = 'home' | 'library' | 'book' | 'study' | 'micro' | 'dashboard' | 'reports' | 'vocabulary' | 'tasks' | 'services' | 'admin' | 'settings'
type PodcastKind = 'preview' | 'review' | 'topic' | 'walkthrough'

type UserProfile = {
  id: string
  email: string
  name: string
  role?: string
  createdAt: string
}

type UserSettings = {
  userId: string
  readingLevel: string
  listeningLevel: string
  studyMinutes: number
  chineseAssist: string
  aiSuggestions: boolean
  focusStudyMode?: boolean
  keepSourceFiles: boolean
  podcastLexile: number
  podcastVoice: string
  microPracticeType: MicroPracticeType
  microPracticeTopic: MicroPracticeTopic
  microPracticeDifficulty: string
  microPracticeDailyGoal: number
  microPracticeMonthlyGoal: number
  microPracticeCustomTopic?: string
  lastLevelAdjustedAt?: string
  lastLevelCheckReportId?: string
}

type Book = {
  id: string
  title: string
  author: string
  type: 'epub' | 'pdf'
  filename: string
  chapterCount: number
  wordCount: number
  totalUnits: number
  generatedUnits: number
  completedUnits: number
  status?: 'ready' | 'processing' | 'failed'
  error?: string
  processingJobId?: string
  createdAt: string
  glossary?: BookGlossary
}

type BookGlossary = {
  bookId: string
  itemCount: number
  generatedUnitCount: number
  sourceUnitCount: number
  items: BookGlossaryItem[]
}

type BookGlossaryItem = {
  id: string
  term: string
  category: 'concept' | 'person' | 'place' | 'institution' | 'term'
  categoryLabel: string
  meaningZh?: string
  simpleEnglish?: string
  occurrenceCount: number
  unitCount: number
  sources: Array<{
    unitId: string
    unitTitle: string
    sourceLocation: string
  }>
}

type Concept = {
  term: string
  simpleEnglish: string
  chinese: string
}

type VocabularyItem = {
  id?: string
  term: string
  meaningZh: string
  simpleEnglish: string
  exampleSentence?: string
  sourceBookTitle?: string
  seenCount?: number
  mastery?: number
  dueAt?: string
  reviewCount?: number
  lastSeenAt?: string
}

type Question = {
  id: string
  prompt: string
  options: string[]
  answerIndex: number
  explanationZh: string
  relatedTerms?: string[]
}

type MicroPracticeType = 'reading' | 'listening' | 'random'
type MicroPracticeTopic = 'book' | 'weak-vocabulary' | 'history' | 'politics' | 'economics' | 'technology' | 'random' | 'custom'

type MicroPractice = {
  id: string
  type: 'reading' | 'listening'
  typeLabel: string
  topic: MicroPracticeTopic
  topicLabel: string
  difficulty: string
  sourceMode: 'book' | 'vocabulary' | 'general' | 'custom' | string
  sourceBookId?: string
  sourceBookTitle?: string
  sourceSummary: string
  keyTerms: string[]
  content: {
    title: string
    body: string
    transcriptHiddenByDefault: boolean
    sourceSummary: string
    concepts: Concept[]
    vocabulary: VocabularyItem[]
    questions: Question[]
  }
  audio?: {
    model?: string
    voice?: string
    format?: string
    generatedAt?: string
  } | null
  status: 'ready' | 'completed'
  generatedBy?: string
  completedAt?: string
  createdAt: string
}

type MicroAttempt = {
  id: string
  practiceId: string
  type: 'reading' | 'listening'
  topicLabel: string
  difficulty: string
  correctCount: number
  questionCount: number
  correctRate: number
  studyMinutes: number
  savedVocabularyCount: number
  wrongQuestions?: Array<{
    id: string
    prompt: string
    explanationZh: string
    relatedTerms?: string[]
  }>
  suggestion?: string
  createdAt: string
}

type ReadingParagraph = {
  text: string
  summaryZh: string
}

type UnitContent = {
  title: string
  level: {
    reading: string
    listening: string
  }
  sourceLocation: string
  background: string
  concepts: Concept[]
  listening: {
    text: string
    transcriptHiddenByDefault: boolean
  }
  reading: {
    paragraphs: ReadingParagraph[]
  }
  vocabulary: VocabularyItem[]
  questions: Question[]
  generationMode: string
  fidelityNote: string
}

type Unit = {
  id: string
  bookId: string
  title: string
  status: 'planned' | 'generated' | 'completed'
  sourceLocation: string
  sourceText?: string
  sourceExcerpt: string
  sourceWordCount: number
  content: UnitContent | null
  quality?: {
    readingWords: number
    listeningWords: number
    paragraphCount: number
    questionCount: number
    status: 'good' | 'review'
    warnings: string[]
    sourceRefs?: Array<{
      id: string
      label: string
      excerpt: string
      wordCount: number
    }>
    sourceMap?: Array<{
      readingParagraph: number
      status?: 'ok' | 'review'
      confidence?: number
      generatedExcerpt?: string
      coverageNote?: string
      suspiciousSentences?: Array<{
        sentence: string
        reason: string
        sourceParagraphs?: string[]
        confidence?: number
      }>
      sourceRefs: Array<{
        id: string
        label: string
        sourceParagraphIndex?: number
        excerpt: string
        wordCount: number
        keywordOverlap?: number
        matchedKeywords?: string[]
      }>
      note?: string
    }>
    fidelity?: {
      keywordCoverage: number
      coveredKeywords: string[]
      missingKeywords: string[]
      sourceLocation: string
      audit?: {
        mode: string
        score: number
        verdict: string
        risks: string[]
        unsupportedClaims: string[]
        suspiciousSentences?: Array<{
          readingParagraph: number
          sentence: string
          reason: string
          sourceParagraphs: string[]
        }>
        missingImportantIdeas: string[]
        error?: string
      }
    }
  }
  audio?: {
    voice: string
    format: string
  } | null
  generation?: {
    jobId?: string
    status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
    progress?: number
    message?: string
    error?: string
    requestedAt?: string
    finishedAt?: string
    readingLevel?: string
    listeningLevel?: string
  }
  progress?: UnitProgress | null
  versions?: Array<{
    id: string
    title: string
    reason: string
    savedAt: string
    generatedAt: string
    level?: {
      reading: string
      listening: string
    } | null
    quality?: Unit['quality'] | null
    diff?: UnitVersionDiff | null
  }>
  createdAt: string
  generatedAt: string | null
}

type UnitVersionDiff = {
  previous: VersionMetrics
  current: VersionMetrics
  summary: {
    titleChanged: boolean
    levelChanged: boolean
    changedParagraphs: number
    wordDelta: number
    listeningWordDelta: number
    questionDelta: number
    fidelityScoreDelta: number | null
  }
  paragraphDiffs: Array<{
    paragraph: number
    changed: boolean
    similarity: number
    wordDelta: number
    previousPreview: string
    currentPreview: string
  }>
}

type VersionMetrics = {
  title: string
  readingLevel: string
  listeningLevel: string
  readingWords: number
  listeningWords: number
  paragraphCount: number
  questionCount: number
}

type UnitProgress = {
  paragraphIndex: number
  listeningCompleted: boolean
  answers: Record<string, number>
  completed: boolean
  updatedAt?: string
}

type GenerationJob = {
  id: string
  type: string
  status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
  unitId?: string
  podcastId?: string
  bookId: string
  processedPages?: number
  totalPages?: number
  progress: number
  message: string
  error: string
  errorStage?: string
  errorCode?: string
  errorHint?: string
  retryable?: boolean
  provider?: string
  statusCode?: number | null
  retryCount?: number
  qualityStatus?: string
  autoRetryAt?: string
  autoRetryDelaySeconds?: number
  autoRetryReason?: string
  lastError?: string
  lastErrorCode?: string
  lastErrorStage?: string
  canRetryNow?: boolean
  nextActionKind?: string
  nextActionLabel?: string
  nextActionDetail?: string
  usageSummary?: {
    label: string
    detail: string
    estimated?: boolean
  } | null
  unitTitle?: string
  podcastTitle?: string
  bookTitle?: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

type Podcast = {
  id: string
  bookId: string
  kind?: PodcastKind
  kindLabel?: string
  index: number
  title: string
  status: 'planned' | 'scripting' | 'synthesizing' | 'ready' | 'failed'
  sourceUnitIds: string[]
  sourceWordCount: number
  lexile: number
  voice?: string
  scriptText?: string | null
  scriptMode?: string
  audio?: {
    file: string
    format: string
    contentType?: string
    byteLength?: number
    voice: string
    provider?: string
    model?: string
    promptProfile?: string
    durationSeconds: number
    chunkCount: number
    generatedAt: string
  } | null
  progress?: {
    positionSeconds: number
    completed: boolean
    updatedAt?: string
  }
  jobId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

type Report = {
  id: string
  bookId: string
  unitId: string
  bookTitle: string
  unitTitle: string
  correctCount: number
  questionCount: number
  correctRate: number
  newVocabularyCount: number
  suggestion: {
    reading: string
    listening: string
    action: string
  }
  readingLevel?: string
  listeningLevel?: string
  studyMinutes?: number
  levelAdjustment?: {
    applied: boolean
    readingLevel: string
    listeningLevel: string
    message: string
    from?: {
      readingLevel: string
      listeningLevel: string
    }
    to?: {
      readingLevel: string
      listeningLevel: string
    }
  }
  createdAt: string
}

type AppData = {
  user: UserProfile
  settings: UserSettings
  home: {
    continueBook: Book | null
    continueUnit: Unit | null
    recentBooks: Book[]
    latestReport: Report | null
    activeJobs: GenerationJob[]
    failedJobs: GenerationJob[]
  }
  books: Book[]
  vocabulary: VocabularyItem[]
  reports: Report[]
  micro: {
    recentPractices: MicroPractice[]
    recentAttempts: MicroAttempt[]
  }
  stats: {
    completedUnits: number
    microPracticeCount: number
    microMonthPractices: number
    averageCorrectRate: number
    microCorrectRate: number
    vocabularyCount: number
    dueVocabulary: number
    masteredVocabulary: number
    readingMinutes: number
    microPracticeMinutes: number
    studyMinutesTotal: number
    todayReadingMinutes: number
    todayStudyMinutes: number
    weeklyReadingMinutes: number
    weeklyStudyMinutes: number
    recentReports: Array<{
      date: string
      correctRate: number
      words: number
    }>
    todayCompleted: number
    todayMicroPractices: number
    dailyGoalUnits: number
    dailyGoalMinutes: number
    microDailyGoal: number
    microMonthlyGoal: number
    microTodayGoalMet: boolean
    microMonthGoalMet: boolean
    todayGoalMet: boolean
    streakDays: number
    calendar: Array<{
      date: string
      units: number
      microPractices: number
      words: number
      correctRate: number
      minutes: number
    }>
    activity: Array<{
      date: string
      units: number
      microPractices: number
      words: number
      correctRate: number
      minutes: number
    }>
    recentMicroPractices: MicroAttempt[]
    vocabularyGrowth: {
      total: number
      addedThisWeek: number
      addedThisMonth: number
      averagePerUnit: number
      daily: Array<{
        date: string
        added: number
        total: number
      }>
    }
    reviewPlan: {
      dueToday: number
      dueTomorrow: number
      dueThisWeek: number
      mastered: number
      learning: number
      weak: number
      message: string
    }
    recommendation: {
      title: string
      body: string
      actionLabel: string
      view: View
    }
    difficultyTrend: Array<{
      date: string
      unitTitle: string
      readingLevel: string
      listeningLevel: string
      correctRate: number
      newVocabularyCount: number
    }>
    difficultySummary: {
      readingLevel: string
      listeningLevel: string
      readingDelta: number
      listeningDelta: number
      message: string
    }
  }
}

type SecurityStatus = {
  security: {
    allowSignup: boolean
    inviteRequired: boolean
    sessionDays: number
    loginWindowMinutes: number
    loginMaxFailures: number
  }
  deployment: {
    nodeEnv: string
    storageDriver: string
    dataDir: string
    backupDir: string
    backup: {
      configured: boolean
      backupDir: string
      backupCount: number
      latestBackup: {
        name: string
        size: number
        modifiedAt: string
      } | null
      latestDrill: {
        name: string
        size: number
        modifiedAt: string
        ok?: boolean
        restoredFiles?: number
        restoredBytes?: number
        recordCount?: number
      } | null
    }
    trustProxy: boolean
    aiConfigured: boolean
    ttsConfigured: boolean
    ttsProvider: string
    podcastTtsConfigured: boolean
    podcastTtsPrimary?: string
    podcastTtsInputTokenLimit?: number
    podcastTtsOutputTokenLimit?: number
    podcastTtsChunkTokens?: number
    podcastTtsChunkChars?: number
    maxUnitsPerBook: number
    maxPodcastEpisodes: number
    maxActivePodcastJobs: number
    pdfOcrEnabled: boolean
    pdfOcrProvider: string
    pdfOcrVisionConfigured: boolean
    pdfOcrVisionModel: string
    pdfOcrLanguage: string
    pdfOcrDpi: number
    pdfOcrVisionDpi: number
    pdfOcrMaxPages: number
    activeJobs: number
  }
}

type AiServiceCheck = {
  serviceId: string
  status: 'ok' | 'failed'
  message: string
  latencyMs: number
  checkedAt: string
  provider?: string
  model?: string
  endpointHost?: string
  mimeType?: string
}

type AiService = {
  id: string
  title: string
  role: string
  category: 'text' | 'audio' | 'ocr'
  priority: string
  configured: boolean
  status: 'ok' | 'configured' | 'warning' | 'failed' | 'missing'
  provider: string
  model: string
  endpointHost: string
  details: string[]
  warning?: string
  providers?: Array<{
    role: string
    label: string
    model: string
    endpointHost: string
    keyId?: string
    cooldownUntil?: string
  }>
  lastCheck?: AiServiceCheck | null
}

type AiServicesPayload = {
  updatedAt: string
  overview: {
    configured: number
    total: number
    healthy: number
    activeCooldowns: number
    serviceTestLimit: number
    serviceTestWindowMinutes: number
  }
  services: AiService[]
}

type AdminStatus = {
  updatedAt: string
  warnings: Array<{
    level: 'warning' | 'critical' | string
    scope: string
    message: string
    detail?: string
  }>
  tasks: {
    total: number
    active: number
    failed: number
    byStatus: Record<string, number>
    byType: Record<string, number>
    failedByCode: Record<string, number>
    recent: GenerationJob[]
  }
  backup: SecurityStatus['deployment']['backup']
  services: {
    overview: AiServicesPayload['overview']
    items: Array<{
      id: string
      title: string
      status: AiService['status']
      configured: boolean
      provider: string
      model: string
      endpointHost: string
      warning?: string
      lastCheck?: AiServiceCheck | null
    }>
  }
  aiUsage: {
    today: UsageSummary
    sevenDays: UsageSummary
    thirtyDays: UsageSummary
    byAction: Array<UsageSummary & { key: string }>
    byProviderModel: Array<UsageSummary & { key: string }>
    recentFailures: Array<{
      action: string
      provider: string
      model: string
      message: string
      errorCode?: string
      statusCode?: number | null
      createdAt: string
    }>
    warnings: Array<{
      level: string
      message: string
      detail?: string
    }>
  }
  storage: {
    totalBytes: number
    dataDir: string
    backupDir: string
    items: Array<{
      key: string
      label: string
      bytes: number
      files: number
      truncated?: boolean
    }>
  }
  recentErrors: Array<{
    id: string
    level: string
    scope: string
    message: string
    detail: string
    jobId?: string
    unitId?: string
    podcastId?: string
    statusCode?: number | null
    errorCode?: string
    createdAt: string
  }>
}

type UsageSummary = {
  calls: number
  failed: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  audioBytes: number
  pages: number
  bytes: number
  chunks: number
}

type SelectedAid =
  | { kind: 'word'; word: string; detail?: VocabularyItem }
  | { kind: 'sentence'; sentence: string; summary: string }
  | { kind: 'concept'; concept: Concept }
  | null

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const readingLevelOptions = ['A2', 'A2+', 'B1', 'B1+', 'B2']
const listeningLevelOptions = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']
const microPracticeTypeOptions: Array<{ value: MicroPracticeType; label: string }> = [
  { value: 'random', label: '随机' },
  { value: 'reading', label: '短文阅读' },
  { value: 'listening', label: '听力轻练' },
]
const microPracticeTopicOptions: Array<{ value: MicroPracticeTopic; label: string }> = [
  { value: 'book', label: '最近书籍' },
  { value: 'weak-vocabulary', label: '近期生词' },
  { value: 'history', label: '历史' },
  { value: 'politics', label: '政治' },
  { value: 'economics', label: '经济' },
  { value: 'technology', label: '科技' },
  { value: 'random', label: '随机主题' },
  { value: 'custom', label: '自定义' },
]
const microDifficultyOptions = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']
const podcastLexileOptions = ['500', '600', '700', '800', '900', '1000', '1100', '1200', '1300', '1400', '1500']
const podcastKindOrder: PodcastKind[] = ['preview', 'review', 'topic', 'walkthrough']
const podcastKindLabels: Record<PodcastKind, string> = {
  preview: '读前导入',
  review: '读后复盘',
  topic: '全书专题',
  walkthrough: '全书分集讲解',
}
const podcastKindDescriptions: Record<PodcastKind, string> = {
  preview: '阅读前先听，铺垫背景、人物、概念和关键词。',
  review: '阅读后再听，复盘因果链、重点观点和自测问题。',
  topic: '跨全书抽主题，把大问题和长期脉络串起来。',
  walkthrough: '按原书顺序分集精讲，详细解释每段来源内容。',
}
const podcastKindOptions = podcastKindOrder.map((kind) => podcastKindLabels[kind])

function normalizePodcastKind(value?: string): PodcastKind {
  return podcastKindOrder.includes(value as PodcastKind) ? (value as PodcastKind) : 'walkthrough'
}

function podcastKindFromLabel(label: string): PodcastKind {
  return (podcastKindOrder.find((kind) => podcastKindLabels[kind] === label) || 'walkthrough') as PodcastKind
}

function podcastKindLabel(kind?: string) {
  return podcastKindLabels[normalizePodcastKind(kind)]
}

function podcastPromptProfileLabel(profile?: string) {
  if (!profile) return ''
  if (profile.includes('gemini-3.1-podcast-director')) return '3.1 播客导演'
  if (profile.includes('gemini-tts-fallback-clear')) return '兜底清晰朗读'
  return profile
}

function sortPodcastList(items: Podcast[]) {
  return [...items].sort((a, b) => {
    const kindDiff = podcastKindOrder.indexOf(normalizePodcastKind(a.kind)) - podcastKindOrder.indexOf(normalizePodcastKind(b.kind))
    if (kindDiff) return kindDiff
    return Number(a.index || 0) - Number(b.index || 0)
  })
}

function isAndroidBrowser() {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

const tokenKey = 'linguashelf-token'
const cookieSessionToken = 'cookie-session'

async function requestJson<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token && token !== cookieSessionToken) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(payload.error || '请求失败')
  return payload as T
}

function sessionFetch(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (token && token !== cookieSessionToken) headers.set('Authorization', `Bearer ${token}`)
  return fetch(path, { ...options, headers, credentials: 'same-origin' })
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function formatDecimal(value: number) {
  return Number(value || 0).toFixed(1)
}

function shortDate(value: string) {
  if (!value) return ''
  const [, month, day] = value.split('-')
  return month && day ? `${Number(month)}/${Number(day)}` : value
}

function levelPercent(options: string[], value: string) {
  const index = Math.max(0, options.indexOf(value))
  if (options.length <= 1) return 0
  return Math.round((index / (options.length - 1)) * 100)
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0))
  const minutes = Math.floor(safe / 60)
  const rest = String(safe % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function formatBytes(bytes?: number) {
  const value = Number(bytes || 0)
  if (!value) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatTokenCount(tokens?: number) {
  const value = Number(tokens || 0)
  if (!value) return '0'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(Math.round(value))
}

function aiUsageActionLabel(action: string) {
  const labels: Record<string, string> = {
    'generate-unit': '分级单元',
    'define-word': '单词释义',
    'speech-audio': '听力音频',
    'generate-podcast-script': '播客脚本',
    'generate-podcast-tts': '播客 TTS',
    'pdf-ocr': 'PDF OCR',
  }
  return labels[action] || action
}

function formatDateTime(value?: string | null) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function aiServiceStatusLabel(status: AiService['status']) {
  const labels: Record<AiService['status'], string> = {
    ok: '已通过',
    configured: '已配置',
    warning: '需关注',
    failed: '失败',
    missing: '未配置',
  }
  return labels[status] || status
}

function aiServiceStatusClass(status: AiService['status']) {
  if (status === 'ok') return 'completed'
  if (status === 'configured') return 'queued'
  if (status === 'warning') return 'running'
  if (status === 'failed' || status === 'missing') return 'failed'
  return ''
}

function aiServiceIcon(service: AiService) {
  if (service.id === 'podcast-tts-primary' || service.id === 'podcast-tts-fallback') return Headphones
  if (service.id === 'listening-tts') return Volume2
  if (service.category === 'ocr') return FileText
  return Brain
}

function normalizeSentenceKey(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s'-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function sourceMapForParagraph(unit: Unit, paragraphIndex: number) {
  return (unit.quality?.sourceMap || []).find((item) => Number(item.readingParagraph || 0) === paragraphIndex + 1)
}

function suspiciousMatch(sentence: string, sourceMapItem?: NonNullable<NonNullable<Unit['quality']>['sourceMap']>[number]) {
  const normalized = normalizeSentenceKey(sentence)
  return (sourceMapItem?.suspiciousSentences || []).find((item) => {
    const suspect = normalizeSentenceKey(item.sentence)
    return Boolean(suspect && (normalized.includes(suspect) || suspect.includes(normalized) || normalized.split(' ').filter((word) => suspect.includes(word) && word.length > 4).length >= 3))
  })
}

function formatSigned(value: number) {
  if (!value) return '0'
  return value > 0 ? `+${value}` : String(value)
}

function versionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    regenerated: '重生成前版本',
    'fidelity-regenerated': '忠实重生成前版本',
    'paragraph-repair': '段落修复前版本',
    'restore-point': '恢复前版本',
  }
  return labels[reason] || reason || '历史版本'
}

function glossaryIcon(category: BookGlossaryItem['category']) {
  if (category === 'person') return User
  if (category === 'place') return MapPin
  if (category === 'institution') return Building2
  if (category === 'concept') return Brain
  return Tags
}

type SourceMapItem = NonNullable<NonNullable<Unit['quality']>['sourceMap']>[number]

function SourceMapDetail({ item, generatedText }: { item: SourceMapItem; generatedText?: string }) {
  const generated = generatedText || item.generatedExcerpt || ''
  return (
    <div className="source-map-detail">
      {generated && (
        <div className="source-compare-grid">
          <div className="source-compare-pane generated">
            <span>生成段落</span>
            <p>{generated}</p>
          </div>
          <div className="source-compare-pane source">
            <span>最相关来源</span>
            {item.sourceRefs.length ? (
              item.sourceRefs.map((ref) => (
                <div key={ref.id} className="source-ref-block">
                  <strong>{ref.label} · 匹配 {formatPercent(ref.keywordOverlap || 0)}</strong>
                  <p>{ref.excerpt}</p>
                  {(ref.matchedKeywords || []).length > 0 && (
                    <div className="keyword-chip-row">
                      {(ref.matchedKeywords || []).map((keyword) => (
                        <span key={`${ref.id}-${keyword}`}>{keyword}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p>{item.note || '未找到明显对应来源段落'}</p>
            )}
          </div>
        </div>
      )}
      {item.coverageNote && <p className="coverage-note">{item.coverageNote}</p>}
      {(item.suspiciousSentences || []).length > 0 && (
        <div className="suspicious-list">
          {(item.suspiciousSentences || []).map((sentence, index) => (
            <p key={`${sentence.sentence}-${index}`}>可疑句子：{sentence.sentence}（{sentence.reason}）</p>
          ))}
        </div>
      )}
    </div>
  )
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function abortableDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function fallbackMeaning(word: string) {
  return {
    term: word,
    meaningZh: '点击保存的阅读词',
    simpleEnglish: 'A word from the reading text. Check how it works in this sentence.',
  }
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) || cookieSessionToken)
  const [data, setData] = useState<AppData | null>(null)
  const [view, setView] = useState<View>('home')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [bookUnits, setBookUnits] = useState<Unit[]>([])
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)
  const [latestReport, setLatestReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const jobWatchAbortRef = useRef<AbortController | null>(null)
  const bookRequestAbortRef = useRef<AbortController | null>(null)
  const isAdmin = data?.user.role === 'admin'

  async function refresh(activeToken = token) {
    if (!activeToken) return
    if (!data) setLoading(true)
    try {
      const next = await requestJson<AppData>('/api/app', activeToken)
      setData(next)
      setError('')
      if (activeToken !== cookieSessionToken) {
        localStorage.removeItem(tokenKey)
        setToken(cookieSessionToken)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      localStorage.removeItem(tokenKey)
      setToken('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const processingBookKey = data?.books.filter((book) => book.status === 'processing').map((book) => book.id).join(',') || ''

  useEffect(() => {
    if (view !== 'library' || !token || !processingBookKey) return
    const timer = window.setInterval(() => refresh(token), 5000)
    return () => window.clearInterval(timer)
  }, [view, token, processingBookKey])

  useEffect(() => {
    return () => {
      jobWatchAbortRef.current?.abort()
      bookRequestAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    function handleInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    function handleInstalled() {
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    const prompt = installPrompt
    setInstallPrompt(null)
    await prompt.prompt()
    await prompt.userChoice.catch(() => undefined)
  }

  async function openBook(book: Book) {
    bookRequestAbortRef.current?.abort()
    const controller = new AbortController()
    bookRequestAbortRef.current = controller
    setSelectedBook(book)
    setSelectedUnit(null)
    setLatestReport(null)
    setView('book')
    try {
      const detail = await requestJson<{ book: Book; units: Unit[] }>(`/api/books/${book.id}`, token, { signal: controller.signal })
      if (controller.signal.aborted) return
      setSelectedBook(detail.book)
      setBookUnits(detail.units)
      setError('')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : '无法打开书籍')
    } finally {
      if (bookRequestAbortRef.current === controller) bookRequestAbortRef.current = null
    }
  }

  async function openUnit(unit: Unit) {
    setSelectedUnit(unit)
    setLatestReport(null)
    setView('study')
    if (unit.content) return

    try {
      await runGenerationJob(unit, {})
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    }
  }

  async function regenerateUnit(unit: Unit, levels?: { readingLevel?: string; listeningLevel?: string; fidelityMode?: 'strict' }) {
    try {
      const result = await runGenerationJob(unit, { force: true, ...levels })
      setError('')
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : '重生成失败')
      return null
    }
  }

  async function repairUnitParagraphs(unit: Unit, paragraphs?: number[]) {
    try {
      const result = await requestJson<{ unit: Unit; repairedParagraphs: number[] }>(`/api/units/${unit.id}/repair-paragraphs`, token, {
        method: 'POST',
        body: JSON.stringify({ paragraphs }),
      })
      updateUnitState(result.unit)
      setError('')
      return result.unit
    } catch (err) {
      setError(err instanceof Error ? err.message : '段落修复失败')
      return null
    }
  }

  async function preGenerateBook(book: Book, options: { count: number; readingLevel?: string; listeningLevel?: string }) {
    try {
      const result = await requestJson<{ book: Book; units: Unit[]; jobs: GenerationJob[]; enqueued: number }>(`/api/books/${book.id}/pre-generate`, token, {
        method: 'POST',
        body: JSON.stringify(options),
      })
      setSelectedBook(result.book)
      setBookUnits(result.units)
      if (result.jobs.length) watchJobs(result.jobs)
      setError('')
      return result.enqueued
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量预生成失败')
      return 0
    }
  }

  async function renameBook(book: Book, title: string) {
    try {
      const result = await requestJson<{ book: Book }>(`/api/books/${book.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      setSelectedBook((current) => (current?.id === book.id ? result.book : current))
      setData((current) => {
        if (!current) return current
        return {
          ...current,
          books: current.books.map((item) => (item.id === book.id ? result.book : item)),
          home: {
            ...current.home,
            continueBook: current.home.continueBook?.id === book.id ? result.book : current.home.continueBook,
            recentBooks: current.home.recentBooks.map((item) => (item.id === book.id ? result.book : item)),
          },
          reports: current.reports.map((report) => (report.bookId === book.id ? { ...report, bookTitle: result.book.title } : report)),
        }
      })
      setError('')
      return result.book
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败')
      return null
    }
  }

  async function deleteBook(book: Book) {
    const confirmed = window.confirm(`确定删除《${book.title}》吗？\n\n会删除这本书的学习单元、进度、报告、任务和播客音频。生词本会保留。`)
    if (!confirmed) return false
    try {
      await requestJson(`/api/books/${book.id}`, token, { method: 'DELETE' })
      if (selectedBook?.id === book.id) {
        setSelectedBook(null)
        setBookUnits([])
        setSelectedUnit(null)
        setLatestReport(null)
        setView('library')
      }
      await refresh(token)
      setError('')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除书籍失败')
      return false
    }
  }

  async function runGenerationJob(unit: Unit, body: Record<string, unknown>) {
    jobWatchAbortRef.current?.abort()
    const controller = new AbortController()
    jobWatchAbortRef.current = controller
    const started = await requestJson<{ job: GenerationJob; unit: Unit }>(`/api/units/${unit.id}/generate-job`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    updateUnitState(started.unit)

    let current = started
    for (let attempt = 0; attempt < 240 && !controller.signal.aborted; attempt += 1) {
      if (current.job.status === 'succeeded' && current.unit?.content) {
        updateUnitState(current.unit)
        return current.unit
      }
      if (current.job.status === 'failed') {
        throw new Error(current.job.error || '生成任务失败')
      }
      if (current.job.status === 'canceled') {
        throw new Error('生成任务已取消')
      }
      await abortableDelay(1500, controller.signal)
      if (controller.signal.aborted) throw new Error('生成轮询已取消')
      current = await requestJson<{ job: GenerationJob; unit: Unit }>(`/api/jobs/${started.job.id}`, token)
      if (current.unit) updateUnitState(current.unit)
    }

    throw new Error('生成仍在进行，请稍后刷新查看')
  }

  function updateUnitState(unit: Unit) {
    setBookUnits((items) => items.map((item) => (item.id === unit.id ? unit : item)))
    setSelectedUnit((current) => (current?.id === unit.id ? unit : current))
  }

  async function restoreUnitVersion(unit: Unit, versionId: string) {
    const result = await requestJson<{ unit: Unit }>(`/api/units/${unit.id}/versions/${versionId}/restore`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    updateUnitState(result.unit)
    return result.unit
  }

  async function watchJobs(jobs: GenerationJob[]) {
    jobWatchAbortRef.current?.abort()
    const controller = new AbortController()
    jobWatchAbortRef.current = controller
    const pending = new Map(jobs.map((job) => [job.id, job]))
    for (let attempt = 0; attempt < 240 && pending.size > 0 && !controller.signal.aborted; attempt += 1) {
      await abortableDelay(1500, controller.signal)
      if (controller.signal.aborted) break
      for (const jobId of [...pending.keys()]) {
        try {
          const result = await requestJson<{ job: GenerationJob; unit: Unit }>(`/api/jobs/${jobId}`, token)
          if (result.unit) updateUnitState(result.unit)
          if (['succeeded', 'failed', 'canceled'].includes(result.job.status)) pending.delete(jobId)
        } catch {
          pending.delete(jobId)
        }
      }
    }
    if (!controller.signal.aborted) refresh()
  }

  async function logout() {
    jobWatchAbortRef.current?.abort()
    bookRequestAbortRef.current?.abort()
    try {
      await requestJson('/api/logout', token, { method: 'POST', body: JSON.stringify({}) })
    } catch {
      undefined
    }
    localStorage.removeItem(tokenKey)
    setToken('')
    setData(null)
  }

  if (!token) {
    return (
      <LoginScreen
        onLogin={(nextData) => {
          localStorage.removeItem(tokenKey)
          setToken(cookieSessionToken)
          setData(nextData)
          setView('home')
        }}
      />
    )
  }

  if (loading || !data) {
    return <LoadingScreen />
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={data.user}
        isAdmin={isAdmin}
        view={view}
        onNavigate={setView}
        onLogout={logout}
      />
      <main className="workspace">
        <TopBar
          view={view}
          user={data.user}
          isAdmin={isAdmin}
          onNavigate={setView}
          installPrompt={installPrompt}
          onInstall={installApp}
        />
        {error && (
          <div className="notice danger">
            <X size={18} />
            <span>{error}</span>
            <button className="icon-button" type="button" onClick={() => setError('')} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        )}

        {view === 'home' && (
          <HomeView
            data={data}
            onOpenUnit={(unit) => {
              setSelectedBook(null)
              openUnit(unit)
            }}
            onOpenBook={openBook}
            onNavigate={setView}
          />
        )}

        {view === 'library' && (
          <LibraryView
            books={data.books}
            token={token}
            onUploaded={(book) => {
              refresh()
              if (book.status === 'processing') {
                setView('library')
                return
              }
              openBook(book)
            }}
            onOpenBook={openBook}
            onDeleteBook={deleteBook}
            onError={setError}
          />
        )}

        {view === 'dashboard' && (
          <DashboardView
            data={data}
            onNavigate={setView}
          />
        )}

        {view === 'book' && selectedBook && (
          <BookView
            book={selectedBook}
            units={bookUnits}
            settings={data.settings}
            token={token}
            onBack={() => setView('library')}
            onOpenUnit={openUnit}
            onRegenerateUnit={regenerateUnit}
            onPreGenerateBook={preGenerateBook}
            onRenameBook={renameBook}
            onDeleteBook={deleteBook}
            onError={setError}
          />
        )}

        {view === 'study' && selectedUnit && (
          <StudyView
            unit={selectedUnit}
            settings={data.settings}
            token={token}
            onBack={() => (selectedBook ? setView('book') : setView('home'))}
            onCompleted={(report) => {
              setLatestReport(report)
              setView('reports')
              refresh()
            }}
            onRegenerateUnit={regenerateUnit}
            onRepairUnitParagraphs={repairUnitParagraphs}
            onUnitUpdated={updateUnitState}
            onRestoreVersion={restoreUnitVersion}
            onError={setError}
          />
        )}

        {view === 'micro' && (
          <MicroPracticeView
            token={token}
            settings={data.settings}
            stats={data.stats}
            books={data.books}
            initialPractices={data.micro?.recentPractices || []}
            initialAttempts={data.micro?.recentAttempts || []}
            onChanged={() => refresh()}
            onOpenBook={openBook}
            onNavigate={setView}
            onError={setError}
          />
        )}

        {view === 'reports' && (
          <ReportsView
            reports={latestReport ? [latestReport, ...data.reports.filter((item) => item.id !== latestReport.id)] : data.reports}
            settings={data.settings}
            stats={data.stats}
            token={token}
            onSettingsUpdated={(settings) => setData({ ...data, settings })}
          />
        )}

        {view === 'vocabulary' && (
          <VocabularyView
            vocabulary={data.vocabulary}
            token={token}
            onReviewed={() => refresh()}
          />
        )}

        {view === 'tasks' && (
          <TasksView
            token={token}
            isAdmin={isAdmin}
            onNavigate={setView}
            onChanged={() => refresh()}
          />
        )}

        {view === 'services' && isAdmin && (
          <ServicesView
            token={token}
            onError={setError}
          />
        )}

        {view === 'admin' && isAdmin && (
          <AdminView
            token={token}
            onNavigate={setView}
            onError={setError}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            settings={data.settings}
            token={token}
            onSaved={(settings) => setData({ ...data, settings })}
            onError={setError}
          />
        )}
      </main>
    </div>
  )
}

function LoginScreen({ onLogin }: { onLogin: (data: AppData) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await requestJson('/api/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({ email, password, inviteCode }),
      })
      const data = await requestJson<AppData>('/api/app', cookieSessionToken)
      onLogin(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="brand-mark">
          <BookOpen size={26} />
        </div>
        <h1>LinguaShelf</h1>
        <p>AI 英语分级阅读器</p>
        <form onSubmit={submit} className="login-form">
          <label>
            邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          <label>
            邀请码
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="已有账号可留空" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <User size={18} />}
            登录 / 创建账号
          </button>
        </form>
      </section>
    </main>
  )
}

function HomeView({
  data,
  onOpenUnit,
  onOpenBook,
  onNavigate,
}: {
  data: AppData
  onOpenUnit: (unit: Unit) => void
  onOpenBook: (book: Book) => void
  onNavigate: (view: View) => void
}) {
  const continueUnit = data.home.continueUnit
  const continueBook = data.home.continueBook
  const recommendation = data.stats.recommendation
  const reviewPlan = data.stats.reviewPlan
  const failedJobs = data.home.failedJobs || []

  return (
    <section className="home-grid">
      <div className="home-main">
        <article className="continue-panel">
          <div>
            <span className="eyebrow">继续学习</span>
            <h1>{continueUnit ? continueUnit.title : '还没有学习单元'}</h1>
            <p>{continueBook ? `${continueBook.title} · ${continueUnit?.sourceLocation || ''}` : '上传一本书后，系统会在这里放下一篇最适合开始的材料。'}</p>
          </div>
          <div className="continue-actions">
            {continueUnit ? (
              <button className="primary-button" type="button" onClick={() => onOpenUnit(continueUnit)}>
                {continueUnit.content ? <BookOpen size={18} /> : <Loader2 size={18} />}
                {continueUnit.content ? '继续阅读' : '生成并学习'}
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={() => onNavigate('library')}>
                <Upload size={18} />
                上传书籍
              </button>
            )}
            {continueBook && (
              <button className="ghost-button" type="button" onClick={() => onOpenBook(continueBook)}>
                打开书籍
              </button>
            )}
          </div>
        </article>

        <div className="stat-row">
          <Stat label="完成单元" value={String(data.stats.completedUnits)} />
          <Stat label="每日轻练" value={String(data.stats.microPracticeCount || 0)} />
          <Stat label="平均正确率" value={formatPercent(data.stats.averageCorrectRate)} />
          <Stat label="到期生词" value={String(data.stats.dueVocabulary)} />
          <Stat label="连续学习" value={`${data.stats.streakDays || 0} 天`} />
        </div>

        <div className="insight-grid">
          <article className="insight-card">
            <div>
              <span className="eyebrow">今日推荐</span>
              <h2>{recommendation?.title || '继续学习'}</h2>
              <p>{recommendation?.body || '根据你的学习进度选择下一步。'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate(recommendation?.view || 'home')}>
              {recommendation?.actionLabel || '开始'}
            </button>
          </article>
          <article className="insight-card">
            <div>
              <span className="eyebrow">每日轻练</span>
              <h2>
                今日 {data.stats.todayMicroPractices || 0}/{data.stats.microDailyGoal ?? 1} 次
              </h2>
              <p>{data.stats.microTodayGoalMet ? '轻练目标已完成。' : '时间紧的时候，做一轮短练习保持手感。'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('micro')}>
              开始轻练
            </button>
          </article>
          <article className="insight-card">
            <div>
              <span className="eyebrow">复习计划</span>
              <h2>{reviewPlan?.message || '暂无复习压力'}</h2>
              <p>今日 {reviewPlan?.dueToday || 0} · 明日 {reviewPlan?.dueTomorrow || 0} · 本周 {reviewPlan?.dueThisWeek || 0}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('vocabulary')}>
              生词本
            </button>
          </article>
        </div>

        <section className="page-section compact-section">
          <div className="section-head">
            <div>
              <h2>最近书籍</h2>
              <p>{data.home.recentBooks.length ? '从最近处理的书继续' : '上传书籍后显示'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('library')}>
              书库
            </button>
          </div>
          {data.home.recentBooks.length === 0 ? (
            <div className="empty-state mini-empty">
              <FileText size={28} />
              <p>暂无书籍</p>
            </div>
          ) : (
            <div className="mini-book-list">
              {data.home.recentBooks.map((book) => {
                const progress = book.totalUnits ? book.completedUnits / book.totalUnits : 0
                return (
                  <button key={book.id} type="button" onClick={() => onOpenBook(book)}>
                    <span>{book.title}</span>
                    <strong>{book.completedUnits}/{book.totalUnits}</strong>
                    <div className="progress-line">
                      <span style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="home-side">
        <section className="page-section compact-section">
          <h2>生成任务</h2>
          {data.home.activeJobs.length === 0 ? (
            <p>当前没有后台任务。</p>
          ) : (
            <div className="job-list">
              {data.home.activeJobs.map((job) => (
                <div key={job.id} className="job-item">
                  <span>{job.message || (job.status === 'queued' ? '排队中' : '生成中')}</span>
                  <div className="progress-line">
                    <span style={{ width: `${job.progress || 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {failedJobs.length > 0 && (
            <div className="task-diagnosis muted">
              <strong>最近有 {failedJobs.length} 个失败任务</strong>
              <p>可以进入任务中心查看原因、重试或取消。</p>
              <button className="ghost-button" type="button" onClick={() => onNavigate('tasks')}>
                打开任务
              </button>
            </div>
          )}
        </section>

        <section className="page-section compact-section">
          <h2>学习节奏</h2>
          <p>今日 {data.stats.todayCompleted || 0}/{data.stats.dailyGoalUnits || 1} 单元</p>
          <p>轻练 {data.stats.todayMicroPractices || 0}/{data.stats.microDailyGoal ?? 1} 次</p>
          <p>{data.settings.studyMinutes} 分钟 / 单元</p>
          {data.home.latestReport && <p>上次正确率 {formatPercent(data.home.latestReport.correctRate)}</p>}
          <div className="calendar-strip">
            {(data.stats.calendar || []).map((item) => (
              <span
                key={item.date}
                className={(item.units || item.microPractices) ? 'active' : ''}
                title={`${item.date} · ${item.units} 单元 · ${item.microPractices || 0} 轻练`}
              />
            ))}
          </div>
        </section>
      </aside>
    </section>
  )
}

function DashboardView({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
  const stats = data.stats
  const activity = stats.activity || []
  const vocabularyDaily = stats.vocabularyGrowth?.daily || []
  const difficultyTrend = stats.difficultyTrend || []
  const maxActivityMinutes = Math.max(1, ...activity.map((item) => Number(item.minutes || 0)))
  const maxVocabularyAdded = Math.max(1, ...vocabularyDaily.map((item) => Number(item.added || 0)))
  const goalPercent = Math.min(100, Math.round(((stats.todayStudyMinutes || 0) / Math.max(1, stats.dailyGoalMinutes || 10)) * 100))

  return (
    <section className="dashboard-page">
      <div className="page-section dashboard-hero">
        <div>
          <span className="eyebrow">学习数据</span>
          <h1>你的英语学习仪表盘</h1>
          <p>把书籍阅读和每日轻练放在一起看，观察学习节奏、生词和难度变化。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => onNavigate('reports')}>
          <BarChart3 size={17} />
          查看报告
        </button>
      </div>

      <div className="stat-row dashboard-kpis">
        <MetricCard icon={Flame} label="连续学习" value={`${stats.streakDays || 0} 天`} detail={stats.todayGoalMet ? '今日目标已完成' : `今日 ${stats.todayCompleted || 0} 单元 · ${stats.todayMicroPractices || 0} 轻练`} />
        <MetricCard icon={Clock} label="学习分钟数" value={`${formatNumber(stats.studyMinutesTotal || stats.readingMinutes || 0)} 分钟`} detail={`近 7 天 ${formatNumber(stats.weeklyStudyMinutes || stats.weeklyReadingMinutes || 0)} 分钟`} />
        <MetricCard icon={Check} label="完成单元" value={String(stats.completedUnits || 0)} detail={`平均正确率 ${formatPercent(stats.averageCorrectRate || 0)}`} />
        <MetricCard icon={Brain} label="每日轻练" value={String(stats.microPracticeCount || 0)} detail={`轻练正确率 ${formatPercent(stats.microCorrectRate || 0)}`} />
        <MetricCard icon={BookMarked} label="生词增长" value={`${stats.vocabularyGrowth?.total || stats.vocabularyCount || 0} 个`} detail={`本周 +${stats.vocabularyGrowth?.addedThisWeek || 0}`} />
      </div>

      <div className="dashboard-grid">
        <article className="page-section dashboard-panel">
          <div className="section-head">
            <div>
              <h2>今日目标</h2>
              <p>{stats.recommendation?.body || '保持稳定节奏，不靠突击。'}</p>
            </div>
            <strong>{goalPercent}%</strong>
          </div>
          <div className="goal-progress" aria-label="今日目标进度">
            <span style={{ width: `${goalPercent}%` }} />
          </div>
          <div className="dashboard-note">
            <Clock size={16} />
            今日 {formatNumber(stats.todayStudyMinutes || 0)} / {formatNumber(stats.dailyGoalMinutes || 10)} 分钟 · 轻练 {stats.todayMicroPractices || 0}/{stats.microDailyGoal ?? 1}
          </div>
        </article>

        <article className="page-section dashboard-panel">
          <div className="section-head">
            <div>
              <h2>每日轻练</h2>
              <p>短文阅读和听力轻练会计入连续学习。</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('micro')}>
              开始轻练
            </button>
          </div>
          <div className="review-plan-grid">
            <Stat label="今日完成" value={`${stats.todayMicroPractices || 0}/${stats.microDailyGoal ?? 1}`} />
            <Stat label="本月目标" value={`${stats.microMonthPractices || 0}/${stats.microMonthlyGoal ?? 30}`} />
            <Stat label="轻练正确率" value={formatPercent(stats.microCorrectRate || 0)} />
            <Stat label="轻练分钟" value={String(stats.microPracticeMinutes || 0)} />
          </div>
        </article>

        <article className="page-section dashboard-panel">
          <div className="section-head">
            <div>
              <h2>复习计划</h2>
              <p>{stats.reviewPlan?.message || '当前没有到期生词。'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('vocabulary')}>
              生词本
            </button>
          </div>
          <div className="review-plan-grid">
            <Stat label="今日到期" value={String(stats.reviewPlan?.dueToday || 0)} />
            <Stat label="明日到期" value={String(stats.reviewPlan?.dueTomorrow || 0)} />
            <Stat label="薄弱词" value={String(stats.reviewPlan?.weak || 0)} />
            <Stat label="已掌握" value={String(stats.reviewPlan?.mastered || 0)} />
          </div>
        </article>

        <article className="page-section dashboard-panel">
          <div className="section-head">
            <div>
              <h2>学习分钟趋势</h2>
              <p>最近 30 天，包含书籍阅读和每日轻练。</p>
            </div>
            <strong>{formatNumber(stats.todayStudyMinutes || 0)} 分钟/今日</strong>
          </div>
          {activity.some((item) => item.minutes > 0) ? (
            <div className="bar-chart activity-chart" aria-label="学习分钟趋势">
              {activity.map((item) => (
                <div key={item.date} title={`${shortDate(item.date)} · ${item.minutes} 分钟 · ${item.units} 单元 · ${item.microPractices || 0} 轻练`}>
                  <span style={{ height: `${Math.max(6, Math.round((item.minutes / maxActivityMinutes) * 96))}px` }} />
                  <small>{(item.units || item.microPractices) ? `${item.units || 0}/${item.microPractices || 0}` : ''}</small>
                </div>
              ))}
            </div>
          ) : (
            <SmallEmpty icon={Clock} text="完成单元或每日轻练后会显示学习分钟趋势。" />
          )}
        </article>

        <article className="page-section dashboard-panel">
          <div className="section-head">
            <div>
              <h2>生词增长</h2>
              <p>新增生词越多，通常说明材料负担越高。</p>
            </div>
            <strong>本月 +{stats.vocabularyGrowth?.addedThisMonth || 0}</strong>
          </div>
          {vocabularyDaily.some((item) => item.added > 0) ? (
            <>
              <div className="bar-chart vocab-chart" aria-label="生词增长">
                {vocabularyDaily.map((item) => (
                  <div key={item.date} title={`${shortDate(item.date)} · 新增 ${item.added} · 累计 ${item.total}`}>
                    <span style={{ height: `${Math.max(5, Math.round((item.added / maxVocabularyAdded) * 86))}px` }} />
                  </div>
                ))}
              </div>
              <div className="dashboard-note">
                <TrendingUp size={16} />
                平均每单元 {formatDecimal(stats.vocabularyGrowth?.averagePerUnit || 0)} 个生词
              </div>
            </>
          ) : (
            <SmallEmpty icon={BookMarked} text="点击阅读中的单词或完成单元后会积累生词。" />
          )}
        </article>

        <article className="page-section dashboard-panel wide-panel">
          <div className="section-head">
            <div>
              <h2>难度变化趋势</h2>
              <p>{stats.difficultySummary?.message || '完成单元后会开始记录难度变化。'}</p>
            </div>
            <strong>{stats.difficultySummary?.readingLevel || data.settings.readingLevel} / {stats.difficultySummary?.listeningLevel || data.settings.listeningLevel}</strong>
          </div>
          {difficultyTrend.length ? (
            <div className="difficulty-trend">
              {difficultyTrend.map((item, index) => (
                <div key={`${item.date}-${index}`} className="difficulty-step" title={`${shortDate(item.date)} · 阅读 ${item.readingLevel} · 听力 ${item.listeningLevel}`}>
                  <div className="difficulty-date">{shortDate(item.date)}</div>
                  <div className="difficulty-rails">
                    <span
                      className="reading-dot"
                      style={{ bottom: `${levelPercent(readingLevelOptions, item.readingLevel)}%` }}
                    />
                    <span
                      className="listening-dot"
                      style={{ bottom: `${levelPercent(listeningLevelOptions, item.listeningLevel)}%` }}
                    />
                  </div>
                  <div className="difficulty-labels">
                    <span>读 {item.readingLevel}</span>
                    <span>听 {item.listeningLevel}</span>
                  </div>
                  <small>{formatPercent(item.correctRate)} · {item.newVocabularyCount} 词</small>
                </div>
              ))}
            </div>
          ) : (
            <SmallEmpty icon={Activity} text="完成第一个学习单元后，会出现阅读和听力难度趋势。" />
          )}
        </article>
      </div>
    </section>
  )
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <Loader2 className="spin" size={28} />
      <span>正在打开书架</span>
    </main>
  )
}

function Sidebar({
  user,
  isAdmin,
  view,
  onNavigate,
  onLogout,
}: {
  user: UserProfile
  isAdmin: boolean
  view: View
  onNavigate: (view: View) => void
  onLogout: () => void
}) {
  const allItems: Array<{ view: View; label: string; icon: typeof Home; adminOnly?: boolean }> = [
    { view: 'home', label: '首页', icon: Home },
    { view: 'library', label: '书库', icon: BookOpen },
    { view: 'micro', label: '轻练', icon: Brain },
    { view: 'dashboard', label: '数据', icon: Activity },
    { view: 'reports', label: '报告', icon: BarChart3 },
    { view: 'vocabulary', label: '生词', icon: BookMarked },
    { view: 'tasks', label: '任务', icon: ListChecks },
    { view: 'services', label: '服务', icon: Server, adminOnly: true },
    { view: 'admin', label: '后台', icon: ShieldCheck, adminOnly: true },
    { view: 'settings', label: '设置', icon: Settings },
  ]
  const items = allItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BookOpen size={24} />
        <span>LinguaShelf</span>
      </div>
      <nav className="side-nav" aria-label="主导航">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.view}
              className={view === item.view ? 'active' : ''}
              type="button"
              onClick={() => onNavigate(item.view)}
            >
              <Icon size={18} />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="sidebar-user">
        <span>{user.email}</span>
        <button type="button" onClick={onLogout}>
          <LogOut size={17} />
          退出
        </button>
      </div>
    </aside>
  )
}

function TopBar({
  view,
  user,
  isAdmin,
  onNavigate,
  installPrompt,
  onInstall,
}: {
  view: View
  user: UserProfile
  isAdmin: boolean
  onNavigate: (view: View) => void
  installPrompt: BeforeInstallPromptEvent | null
  onInstall: () => void
}) {
  const titles: Record<View, string> = {
    home: '首页',
    library: '书库',
    book: '学习单元',
    study: '阅读训练',
    micro: '每日轻练',
    dashboard: '学习数据',
    reports: '学习报告',
    vocabulary: '生词本',
    tasks: '任务',
    services: 'AI 服务',
    admin: '管理后台',
    settings: '设置',
  }
  const allItems: Array<{ view: View; label: string; icon: typeof Home; adminOnly?: boolean }> = [
    { view: 'home', label: '首页', icon: Home },
    { view: 'library', label: '书库', icon: BookOpen },
    { view: 'micro', label: '轻练', icon: Brain },
    { view: 'dashboard', label: '数据', icon: Activity },
    { view: 'reports', label: '报告', icon: BarChart3 },
    { view: 'vocabulary', label: '生词', icon: BookMarked },
    { view: 'tasks', label: '任务', icon: ListChecks },
    { view: 'services', label: '服务', icon: Server, adminOnly: true },
    { view: 'admin', label: '后台', icon: ShieldCheck, adminOnly: true },
    { view: 'settings', label: '设置', icon: Settings },
  ]
  const items = allItems.filter((item) => !item.adminOnly || isAdmin)
  const installLabel = isAndroidBrowser() ? '安装到手机' : '安装'

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">{user.name}</span>
          <h2>{titles[view]}</h2>
        </div>
        {installPrompt && (
          <div className="topbar-actions">
            <button className="secondary-button install-button" type="button" onClick={onInstall}>
              <Download size={17} />
              {installLabel}
            </button>
          </div>
        )}
      </header>
      <nav className="mobile-nav" aria-label="移动端导航">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.view}
              className={view === item.view ? 'active' : ''}
              type="button"
              onClick={() => onNavigate(item.view)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}

function LibraryView({
  books,
  token,
  onUploaded,
  onOpenBook,
  onDeleteBook,
  onError,
}: {
  books: Book[]
  token: string
  onUploaded: (book: Book) => void
  onOpenBook: (book: Book) => void
  onDeleteBook: (book: Book) => Promise<boolean>
  onError: (message: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState('')
  const [uploadNotice, setUploadNotice] = useState('')

  async function uploadFile(file: File) {
    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.epub') && !lowerName.endsWith('.pdf')) {
      onError('请选择 EPUB 或 PDF 文件')
      return
    }
    if (uploading) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await requestJson<{ book: Book; job?: GenerationJob }>('/api/books/upload', token, {
        method: 'POST',
        body: form,
      })
      setUploadNotice(
        result.book.status === 'processing'
          ? `《${result.book.title}》已上传，扫描 PDF 正在后台 OCR。可以离开本页，进度会保存在任务中心。`
          : `《${result.book.title}》已导入。`
      )
      onUploaded(result.book)
    } catch (err) {
      onError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    const file = files.find((item) => {
      const name = item.name.toLowerCase()
      return name.endsWith('.epub') || name.endsWith('.pdf')
    })
    if (!file) {
      onError('请拖入 EPUB 或 PDF 文件')
      return
    }
    uploadFile(file)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
    if (!uploading) setDragActive(true)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    setDragActive(false)
  }

  function handleUploadKey(event: KeyboardEvent<HTMLElement>) {
    if (uploading) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    inputRef.current?.click()
  }

  async function deleteFromLibrary(book: Book) {
    setDeletingBookId(book.id)
    try {
      await onDeleteBook(book)
    } finally {
      setDeletingBookId('')
    }
  }

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <h1>我的书库</h1>
          <p>{books.length ? `${books.length} 本书正在学习` : '上传一本书开始训练'}</p>
        </div>
        <div className="upload-actions">
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
            上传 EPUB/PDF
          </button>
          <span>PDF 支持文字抽取，扫描版会自动 OCR</span>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) uploadFile(file)
          }}
        />
      </div>

      {uploadNotice && (
        <div className="notice success">
          <Check size={18} />
          <span>{uploadNotice}</span>
          <button className="icon-button" type="button" onClick={() => setUploadNotice('')} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
      )}

      <section
        className={`upload-dropzone${dragActive ? ' active' : ''}${uploading ? ' busy' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="上传 EPUB 或 PDF"
        onClick={() => {
          if (!uploading) inputRef.current?.click()
        }}
        onKeyDown={handleUploadKey}
        onDrop={handleDrop}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="upload-drop-icon">
          {uploading ? <Loader2 className="spin" size={24} /> : <Upload size={24} />}
        </div>
        <div>
          <h2>{uploading ? '正在上传解析' : '拖放 EPUB/PDF 到这里'}</h2>
          <p>也可以点击此区域选择文件。</p>
        </div>
      </section>

      {books.length === 0 ? (
        <div className="empty-state">
          <FileText size={32} />
          <h2>还没有书</h2>
          <p>支持 EPUB、文字版 PDF 和清晰的英文扫描版 PDF。</p>
        </div>
      ) : (
        <div className="book-grid">
          {books.map((book) => {
            const progress = book.totalUnits ? book.completedUnits / book.totalUnits : 0
            return (
              <article key={book.id} className="book-card">
                <div className="book-card-status">
                  <div className="book-type">{book.type.toUpperCase()}</div>
                  {book.status === 'processing' && <span className="status-pill running">OCR 处理中</span>}
                  {book.status === 'failed' && <span className="status-pill failed">解析失败</span>}
                </div>
                <h2>{book.title}</h2>
                <p>{book.author || book.filename}</p>
                {book.status === 'processing' && <p className="book-processing-note">后台识别中，可在任务中心查看页数进度。</p>}
                {book.status === 'failed' && book.error && <p className="book-error-note">{book.error}</p>}
                <div className="book-meta">
                  <span>{formatNumber(book.wordCount)} 词</span>
                  <span>{book.totalUnits} 个单元</span>
                </div>
                <div className="progress-line" aria-label="学习进度">
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="book-actions">
                  <span>{book.completedUnits}/{book.totalUnits} 完成</span>
                  <div className="book-action-buttons">
                    <button type="button" onClick={() => onOpenBook(book)} disabled={book.status !== undefined && book.status !== 'ready'}>
                      {book.status === 'processing' ? '解析中' : book.status === 'failed' ? '待重试' : '打开'}
                    </button>
                    <button className="danger-button" type="button" onClick={() => deleteFromLibrary(book)} disabled={deletingBookId === book.id}>
                      {deletingBookId === book.id ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                      删除
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function isUnitGenerating(unit: Unit) {
  return unit.generation?.status === 'queued' || unit.generation?.status === 'running'
}

function unitStatusClass(unit: Unit) {
  if (unit.generation?.status === 'queued') return 'queued'
  if (unit.generation?.status === 'running') return 'running'
  if (unit.generation?.status === 'paused') return 'queued'
  if (unit.generation?.status === 'failed') return 'failed'
  if (unit.generation?.status === 'canceled') return 'failed'
  return unit.status
}

function unitStatusLabel(unit: Unit) {
  if (unit.generation?.status === 'queued') return '排队中'
  if (unit.generation?.status === 'running') return '生成中'
  if (unit.generation?.status === 'paused') return '已暂停'
  if (unit.generation?.status === 'failed') return '生成失败'
  if (unit.generation?.status === 'canceled') return '已取消'
  if (unit.status === 'planned') return '待生成'
  if (unit.status === 'completed') return '已完成'
  return '可学习'
}

function podcastStatusLabel(podcast: Podcast) {
  if (podcast.status === 'planned') return '排队中'
  if (podcast.status === 'scripting') return '写脚本'
  if (podcast.status === 'synthesizing') return '合成中'
  if (podcast.status === 'ready') return '可播放'
  if (podcast.status === 'failed') return '失败'
  return podcast.status
}

function podcastStatusClass(podcast: Podcast) {
  if (podcast.status === 'ready') return 'completed'
  if (podcast.status === 'failed') return 'failed'
  if (['planned', 'scripting', 'synthesizing'].includes(podcast.status)) return 'running'
  return 'planned'
}

function podcastProgressPercent(podcast: Podcast) {
  if (podcast.progress?.completed) return 100
  const duration = Number(podcast.audio?.durationSeconds || 0)
  const position = Number(podcast.progress?.positionSeconds || 0)
  if (!duration || !position) return 0
  return Math.max(0, Math.min(100, Math.round((position / duration) * 100)))
}

function BookView({
  book,
  units,
  settings,
  token,
  onBack,
  onOpenUnit,
  onRegenerateUnit,
  onPreGenerateBook,
  onRenameBook,
  onDeleteBook,
  onError,
}: {
  book: Book
  units: Unit[]
  settings: UserSettings
  token: string
  onBack: () => void
  onOpenUnit: (unit: Unit) => void
  onRegenerateUnit: (unit: Unit, levels?: { readingLevel?: string; listeningLevel?: string; fidelityMode?: 'strict' }) => Promise<Unit | null>
  onPreGenerateBook: (book: Book, options: { count: number; readingLevel?: string; listeningLevel?: string }) => Promise<number>
  onRenameBook: (book: Book, title: string) => Promise<Book | null>
  onDeleteBook: (book: Book) => Promise<boolean>
  onError: (message: string) => void
}) {
  const [regeneratingId, setRegeneratingId] = useState('')
  const [renamingBook, setRenamingBook] = useState(false)
  const [bookTitleDraft, setBookTitleDraft] = useState(book.title)
  const [savingBookTitle, setSavingBookTitle] = useState(false)
  const [deletingBook, setDeletingBook] = useState(false)
  const [batching, setBatching] = useState(false)
  const [batchCount, setBatchCount] = useState(3)
  const [readingLevel, setReadingLevel] = useState(settings.readingLevel)
  const [listeningLevel, setListeningLevel] = useState(settings.listeningLevel)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [selectedPodcastKind, setSelectedPodcastKind] = useState<PodcastKind>('preview')
  const [podcastBusy, setPodcastBusy] = useState(false)
  const [loadingAudioId, setLoadingAudioId] = useState('')
  const [downloadingId, setDownloadingId] = useState('')
  const [deletingPodcastId, setDeletingPodcastId] = useState('')
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [scriptTexts, setScriptTexts] = useState<Record<string, string>>({})
  const [loadingScriptId, setLoadingScriptId] = useState('')
  const audioUrlsRef = useRef<Record<string, string>>({})
  const podcastAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const podcastProgressSyncRef = useRef<Record<string, number>>({})

  useEffect(() => {
    loadPodcasts()
    return () => {
      for (const url of Object.values(audioUrlsRef.current)) URL.revokeObjectURL(url)
      audioUrlsRef.current = {}
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
        for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
          navigator.mediaSession.setActionHandler(action, null)
        }
      }
    }
  }, [book.id])

  useEffect(() => {
    setBookTitleDraft(book.title)
  }, [book.id, book.title])

  async function regenerate(unit: Unit) {
    setRegeneratingId(unit.id)
    await onRegenerateUnit(unit, { readingLevel, listeningLevel })
    setRegeneratingId('')
  }

  async function preGenerate() {
    setBatching(true)
    try {
      await onPreGenerateBook(book, { count: batchCount, readingLevel, listeningLevel })
    } finally {
      setBatching(false)
    }
  }

  async function saveBookTitle() {
    const title = bookTitleDraft.trim().replace(/\s+/g, ' ')
    if (!title) {
      onError('书名不能为空')
      return
    }
    if (title === book.title) {
      setRenamingBook(false)
      return
    }
    setSavingBookTitle(true)
    try {
      const renamed = await onRenameBook(book, title)
      if (renamed) setRenamingBook(false)
    } finally {
      setSavingBookTitle(false)
    }
  }

  async function deleteCurrentBook() {
    setDeletingBook(true)
    try {
      await onDeleteBook(book)
    } finally {
      setDeletingBook(false)
    }
  }

  async function loadPodcasts() {
    try {
      const result = await requestJson<{ podcasts: Podcast[] }>(`/api/books/${book.id}/podcasts`, token)
      setPodcasts(sortPodcastList(result.podcasts))
    } catch (err) {
      onError(err instanceof Error ? err.message : '无法加载播客')
    }
  }

  function updatePodcastState(podcast: Podcast) {
    setPodcasts((items) => {
      const exists = items.some((item) => item.id === podcast.id)
      const next = exists ? items.map((item) => (item.id === podcast.id ? podcast : item)) : [...items, podcast]
      return sortPodcastList(next)
    })
  }

  function replacePodcastKind(kind: PodcastKind, nextPodcasts: Podcast[]) {
    setPodcasts((items) => sortPodcastList([...items.filter((item) => normalizePodcastKind(item.kind) !== kind), ...nextPodcasts]))
  }

  async function pollPodcastJobs(jobs: GenerationJob[]) {
    const pending = new Map(jobs.map((job) => [job.id, job]))
    for (let attempt = 0; attempt < 720 && pending.size > 0; attempt += 1) {
      await delay(1500)
      for (const jobId of [...pending.keys()]) {
        try {
          const result = await requestJson<{ job: GenerationJob; podcast?: Podcast }>(`/api/jobs/${jobId}`, token)
          if (result.podcast) updatePodcastState(result.podcast)
          if (['succeeded', 'failed', 'canceled'].includes(result.job.status)) pending.delete(jobId)
        } catch {
          pending.delete(jobId)
        }
      }
    }
    await loadPodcasts()
  }

  async function generatePodcasts(options: { force?: boolean; count?: number } = {}) {
    setPodcastBusy(true)
    try {
      const result = await requestJson<{ podcasts: Podcast[]; jobs: GenerationJob[]; enqueued: number }>(`/api/books/${book.id}/podcasts/generate`, token, {
        method: 'POST',
        body: JSON.stringify({ force: Boolean(options.force), count: options.count || 0, kind: selectedPodcastKind }),
      })
      replacePodcastKind(selectedPodcastKind, result.podcasts)
      if (result.jobs.length) pollPodcastJobs(result.jobs)
    } catch (err) {
      onError(err instanceof Error ? err.message : '播客生成失败')
    } finally {
      setPodcastBusy(false)
    }
  }

  async function retryPodcast(podcast: Podcast) {
    setPodcastBusy(true)
    try {
      const result = await requestJson<{ podcast: Podcast; job: GenerationJob }>(`/api/podcasts/${podcast.id}/retry`, token, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      updatePodcastState(result.podcast)
      pollPodcastJobs([result.job])
    } catch (err) {
      onError(err instanceof Error ? err.message : '播客重试失败')
    } finally {
      setPodcastBusy(false)
    }
  }

  async function loadPodcastAudio(podcast: Podcast) {
    if (audioUrls[podcast.id]) return
    setLoadingAudioId(podcast.id)
    try {
      const response = await sessionFetch(`/api/podcasts/${podcast.id}/audio?t=${Date.now()}`, token, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('音频还不可用')
      const blob = await response.blob()
      if (audioUrlsRef.current[podcast.id]) URL.revokeObjectURL(audioUrlsRef.current[podcast.id])
      const url = URL.createObjectURL(blob)
      audioUrlsRef.current[podcast.id] = url
      setAudioUrls((items) => ({ ...items, [podcast.id]: url }))
    } catch (err) {
      onError(err instanceof Error ? err.message : '无法加载播客音频')
    } finally {
      setLoadingAudioId('')
    }
  }

  async function downloadPodcastAudio(podcast: Podcast) {
    setDownloadingId(podcast.id)
    try {
      const response = await sessionFetch(`/api/podcasts/${podcast.id}/audio?download=1&t=${Date.now()}`, token, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('音频还不可下载')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const format = podcast.audio?.format || 'mp3'
      link.href = url
      link.download = `${podcastKindLabel(podcast.kind)}-${podcast.title || `Podcast ${podcast.index}`}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      onError(err instanceof Error ? err.message : '下载播客失败')
    } finally {
      setDownloadingId('')
    }
  }

  async function deletePodcast(podcast: Podcast) {
    setDeletingPodcastId(podcast.id)
    try {
      await requestJson(`/api/podcasts/${podcast.id}`, token, {
        method: 'DELETE',
      })
      if (audioUrlsRef.current[podcast.id]) URL.revokeObjectURL(audioUrlsRef.current[podcast.id])
      delete audioUrlsRef.current[podcast.id]
      delete podcastAudioRefs.current[podcast.id]
      setAudioUrls((items) => {
        const next = { ...items }
        delete next[podcast.id]
        return next
      })
      setPodcasts((items) => items.filter((item) => item.id !== podcast.id))
    } catch (err) {
      onError(err instanceof Error ? err.message : '删除播客失败')
    } finally {
      setDeletingPodcastId('')
    }
  }

  async function savePodcastProgress(podcast: Podcast, audio: HTMLAudioElement, completed = false, force = false) {
    const now = Date.now()
    if (!force && now - Number(podcastProgressSyncRef.current[podcast.id] || 0) < 8000) return
    podcastProgressSyncRef.current[podcast.id] = now
    try {
      const result = await requestJson<{ podcast: Podcast }>(`/api/podcasts/${podcast.id}/progress`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          positionSeconds: completed ? audio.duration || audio.currentTime || 0 : audio.currentTime || 0,
          completed,
        }),
      })
      updatePodcastState(result.podcast)
    } catch {
      undefined
    }
  }

  function configurePodcastMediaSession(podcast: Podcast, audio: HTMLAudioElement) {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${podcastKindLabel(podcast.kind)} · ${podcast.title || `Podcast ${podcast.index}`}`,
      artist: 'LinguaShelf',
      album: book.title,
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    })

    function updatePositionState() {
      if (!('setPositionState' in navigator.mediaSession)) return
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      })
    }

    function seekBy(seconds: number) {
      if (!Number.isFinite(audio.duration)) return
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
      updatePositionState()
    }

    navigator.mediaSession.setActionHandler('play', () => {
      audio.play().then(() => {
        navigator.mediaSession.playbackState = 'playing'
        updatePositionState()
      }).catch(() => undefined)
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause()
      navigator.mediaSession.playbackState = 'paused'
      updatePositionState()
    })
    navigator.mediaSession.setActionHandler('stop', () => {
      audio.pause()
      audio.currentTime = 0
      navigator.mediaSession.playbackState = 'none'
      updatePositionState()
    })
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-15))
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(15))
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime !== 'number' || !Number.isFinite(audio.duration)) return
      audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime))
      updatePositionState()
    })
    updatePositionState()
  }

  function bindPodcastAudio(podcast: Podcast, element: HTMLAudioElement | null) {
    podcastAudioRefs.current[podcast.id] = element
    if (!element) return
    element.onloadedmetadata = () => {
      const position = Number(podcast.progress?.positionSeconds || 0)
      if (position > 2 && Number.isFinite(element.duration) && position < element.duration - 3) {
        element.currentTime = position
      }
    }
    element.onplay = () => {
      for (const [id, other] of Object.entries(podcastAudioRefs.current)) {
        if (id !== podcast.id) other?.pause()
      }
      configurePodcastMediaSession(podcast, element)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }
    element.onpause = () => {
      if (!element.ended) {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
        savePodcastProgress(podcast, element, false, true)
      }
    }
    element.ontimeupdate = () => {
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && Number.isFinite(element.duration)) {
        navigator.mediaSession.setPositionState({
          duration: element.duration,
          playbackRate: element.playbackRate || 1,
          position: Math.min(element.currentTime || 0, element.duration),
        })
      }
      savePodcastProgress(podcast, element)
    }
    element.onended = () => {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
      savePodcastProgress(podcast, element, true, true)
    }
  }

  async function loadTranscript(podcast: Podcast) {
    if (scriptTexts[podcast.id]) return
    setLoadingScriptId(podcast.id)
    try {
      const result = await requestJson<{ podcast: Podcast }>(`/api/podcasts/${podcast.id}`, token)
      setScriptTexts((items) => ({ ...items, [podcast.id]: result.podcast.scriptText || '' }))
    } catch (err) {
      onError(err instanceof Error ? err.message : '无法加载脚本')
    } finally {
      setLoadingScriptId('')
    }
  }

  const visiblePodcasts = podcasts.filter((podcast) => normalizePodcastKind(podcast.kind) === selectedPodcastKind)
  const selectedPodcastLabel = podcastKindLabels[selectedPodcastKind]
  const podcastCounts = podcastKindOrder.reduce<Record<PodcastKind, number>>((counts, kind) => {
    counts[kind] = podcasts.filter((podcast) => normalizePodcastKind(podcast.kind) === kind).length
    return counts
  }, { preview: 0, review: 0, topic: 0, walkthrough: 0 })
  const visiblePodcastHasActiveJob = visiblePodcasts.some((podcast) => ['planned', 'scripting', 'synthesizing'].includes(podcast.status))
  const nextPodcastButtonLabel = selectedPodcastKind === 'topic' ? (visiblePodcasts.length ? '专题已生成' : '生成专题') : '生成下一集'
  const nextPodcastDisabled = podcastBusy || visiblePodcastHasActiveJob || (selectedPodcastKind === 'topic' && visiblePodcasts.length > 0)
  const generateAllButtonLabel = visiblePodcasts.length ? '生成剩余全部' : '生成全部'
  const generateAllDisabled = podcastBusy || visiblePodcastHasActiveJob || (selectedPodcastKind === 'topic' && visiblePodcasts.length > 0)
  const estimatedPodcastTotal = selectedPodcastKind === 'topic' ? 1 : Math.max(1, Math.ceil((book.wordCount || 0) / 2200))
  const estimatedPodcastRemaining = Math.max(0, estimatedPodcastTotal - visiblePodcasts.length)
  const nextPodcastEstimate = selectedPodcastKind === 'topic'
    ? '预计 1 集，约 1-3 分钟脚本与 TTS。'
    : '按顺序生成 1 集，通常约 1-3 分钟。'
  const allPodcastEstimate = selectedPodcastKind === 'topic'
    ? '全书专题只保留 1 集。'
    : `预计还剩约 ${estimatedPodcastRemaining || estimatedPodcastTotal} 集，会按队列逐集生成。`
  const glossaryItems = book.glossary?.items || []
  const glossaryCounts = glossaryItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.categoryLabel || item.category] = (counts[item.categoryLabel || item.category] || 0) + 1
    return counts
  }, {})

  return (
    <section className="page-section">
      <div className="detail-head">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回书库
        </button>
        <div>
          <span className="eyebrow">{book.type.toUpperCase()}</span>
          {renamingBook ? (
            <div className="book-title-edit">
              <input
                aria-label="书名"
                value={bookTitleDraft}
                onChange={(event) => setBookTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveBookTitle()
                  if (event.key === 'Escape') {
                    setBookTitleDraft(book.title)
                    setRenamingBook(false)
                  }
                }}
                autoFocus
              />
              <button className="primary-button" type="button" onClick={saveBookTitle} disabled={savingBookTitle}>
                {savingBookTitle ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                保存
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setBookTitleDraft(book.title)
                  setRenamingBook(false)
                }}
              >
                <X size={18} />
                取消
              </button>
            </div>
          ) : (
            <div className="book-title-line">
              <h1>{book.title}</h1>
              <button className="icon-button title-edit-button" type="button" onClick={() => setRenamingBook(true)} aria-label="重命名书籍" title="重命名">
                <Pencil size={18} />
              </button>
            </div>
          )}
          <p>{book.author || book.filename}</p>
        </div>
        <button className="ghost-button danger-button" type="button" onClick={deleteCurrentBook} disabled={deletingBook}>
          {deletingBook ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
          删除书籍
        </button>
      </div>

      <div className="stat-row">
        <Stat label="单元" value={String(book.totalUnits)} />
        <Stat label="已生成" value={String(book.generatedUnits)} />
        <Stat label="已完成" value={String(book.completedUnits)} />
        <Stat label="词数" value={formatNumber(book.wordCount)} />
      </div>

      {glossaryItems.length > 0 && (
        <details className="book-glossary">
          <summary>
            <span>
              <Tags size={18} />
              术语与人名地名表
            </span>
            <small>
              {book.glossary?.itemCount || glossaryItems.length} 项 · {Object.entries(glossaryCounts).map(([label, count]) => `${label} ${count}`).join(' · ')}
            </small>
          </summary>
          <div className="glossary-grid">
            {glossaryItems.slice(0, 48).map((item) => {
              const Icon = glossaryIcon(item.category)
              return (
                <article key={item.id} className={`glossary-item ${item.category}`}>
                  <div className="glossary-title">
                    <Icon size={16} />
                    <strong>{item.term}</strong>
                    <span>{item.categoryLabel}</span>
                  </div>
                  {(item.simpleEnglish || item.meaningZh) && (
                    <p>{item.simpleEnglish || item.meaningZh}</p>
                  )}
                  <div className="glossary-meta">
                    <span>出现 {item.occurrenceCount} 次</span>
                    <span>涉及 {item.unitCount} 个单元</span>
                  </div>
                  {item.sources.length > 0 && (
                    <small>{item.sources.map((source) => source.sourceLocation || source.unitTitle).join('；')}</small>
                  )}
                </article>
              )
            })}
          </div>
        </details>
      )}

      <div className="unit-toolbar">
        <div className="unit-difficulty-controls">
          <span className="toolbar-label">单元生成难度</span>
          <div className="difficulty-picker">
            <span>阅读文本</span>
            <Segmented ariaLabel="阅读文本难度" options={readingLevelOptions} value={readingLevel} onChange={setReadingLevel} />
          </div>
          <div className="difficulty-picker">
            <span>听力预热</span>
            <Segmented ariaLabel="听力预热难度" options={listeningLevelOptions} value={listeningLevel} onChange={setListeningLevel} />
          </div>
        </div>
        <div className="batch-control">
          <input
            aria-label="预生成数量"
            min={1}
            max={5}
            type="number"
            value={batchCount}
            onChange={(event) => setBatchCount(Math.max(1, Math.min(5, Number(event.target.value || 1))))}
          />
          <button type="button" onClick={preGenerate} disabled={batching}>
            {batching ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
            批量预生成
          </button>
        </div>
      </div>

      <section className="podcast-section">
        <div className="block-title">
          <div>
            <span className="eyebrow">AI Podcast</span>
            <h2>AI 播客讲解</h2>
            <p>{podcastKindDescriptions[selectedPodcastKind]}</p>
          </div>
          <div className="podcast-kind-control">
            <Segmented
              options={podcastKindOptions}
              value={selectedPodcastLabel}
              onChange={(label) => setSelectedPodcastKind(podcastKindFromLabel(label))}
            />
            <span>{podcastKindOrder.map((kind) => `${podcastKindLabels[kind]} ${podcastCounts[kind]}`).join(' · ')}</span>
          </div>
          <button className="primary-button" type="button" onClick={() => generatePodcasts({ count: 1 })} disabled={nextPodcastDisabled}>
            {podcastBusy ? <Loader2 className="spin" size={18} /> : <Headphones size={18} />}
            {nextPodcastButtonLabel}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => generatePodcasts(visiblePodcasts.length ? { count: 999 } : {})}
            disabled={generateAllDisabled}
          >
            {podcastBusy ? <Loader2 className="spin" size={18} /> : <ListChecks size={18} />}
            {generateAllButtonLabel}
          </button>
          {visiblePodcasts.length > 0 && (
            <button className="ghost-button" type="button" onClick={() => generatePodcasts({ force: true })} disabled={podcastBusy}>
              {podcastBusy ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
              重生成当前类型
            </button>
          )}
        </div>
        <div className="podcast-generate-hints">
          <span>{nextPodcastEstimate}</span>
          <span>{allPodcastEstimate}</span>
        </div>
        {visiblePodcasts.length > 0 ? (
          <div className="podcast-list">
            {visiblePodcasts.map((podcast) => {
              const busy = ['planned', 'scripting', 'synthesizing'].includes(podcast.status)
              const progress = busy ? (podcast.status === 'planned' ? 8 : podcast.status === 'scripting' ? 30 : 70) : podcast.status === 'ready' ? 100 : 100
              const podcastTtsLabel = podcast.audio?.provider
                ? `TTS ${podcast.audio.provider}`
                : podcast.status === 'ready'
                  ? 'TTS 来源未记录'
                  : busy
                    ? 'TTS 合成中'
                    : 'TTS 待生成'
              const heardPercent = podcastProgressPercent(podcast)
              const remainingSeconds = Math.max(0, Number(podcast.audio?.durationSeconds || 0) - Number(podcast.progress?.positionSeconds || 0))
              return (
                <article key={podcast.id} className="podcast-row">
                  <div className="unit-index">{String(podcast.index).padStart(2, '0')}</div>
                  <div className="podcast-main">
                    <div className="podcast-title-line">
                      <h3>{podcast.title || `Podcast ${podcast.index}`}</h3>
                      <span className={`status-pill ${podcastStatusClass(podcast)}`}>{podcastStatusLabel(podcast)}</span>
                    </div>
                    <div className="podcast-meta">
                      <span>{podcastKindLabel(podcast.kind)} · {formatNumber(podcast.sourceWordCount)} 源文本词数</span>
                      <span>Lexile {podcast.lexile}L · 声音 {podcast.audio?.voice || podcast.voice || settings.podcastVoice}</span>
                      {podcast.audio && (
                        <span>
                          {String(podcast.audio.format || 'audio').toUpperCase()} · {formatDuration(podcast.audio.durationSeconds)} · {formatBytes(podcast.audio.byteLength)} · {podcast.audio.chunkCount} 块
                        </span>
                      )}
                      <span className={podcast.audio?.provider ? 'tts-source-chip' : 'tts-source-chip muted'}>
                        <Headphones size={14} />
                        {podcastTtsLabel}
                      </span>
                      {podcast.audio?.model && <span>模型 {podcast.audio.model}</span>}
                      {podcast.audio?.promptProfile && <span>朗读策略 {podcastPromptProfileLabel(podcast.audio.promptProfile)}</span>}
                      {heardPercent > 0 ? <span>已听 {heardPercent}% · 剩余 {formatDuration(remainingSeconds)}</span> : null}
                    </div>
                    {busy && <div className="progress-line task-progress"><span style={{ width: `${progress}%` }} /></div>}
                    {podcast.error && <p className="podcast-error">{podcast.error}</p>}
                    {audioUrls[podcast.id] && (
                      <audio
                        ref={(element) => bindPodcastAudio(podcast, element)}
                        className="podcast-audio"
                        controls
                        src={audioUrls[podcast.id]}
                        preload="metadata"
                      />
                    )}
                    {scriptTexts[podcast.id] && <p className="transcript podcast-transcript">{scriptTexts[podcast.id]}</p>}
                  </div>
                  <div className="unit-actions podcast-actions">
                    {podcast.status === 'ready' && (
                      <button type="button" onClick={() => loadPodcastAudio(podcast)} disabled={loadingAudioId === podcast.id}>
                        {loadingAudioId === podcast.id ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                        {audioUrls[podcast.id] ? '已加载' : '播放'}
                      </button>
                    )}
                    {podcast.status === 'ready' && (
                      <button type="button" onClick={() => downloadPodcastAudio(podcast)} disabled={downloadingId === podcast.id}>
                        {downloadingId === podcast.id ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                        下载
                      </button>
                    )}
                    {podcast.scriptMode && (
                      <button type="button" onClick={() => loadTranscript(podcast)} disabled={loadingScriptId === podcast.id}>
                        {loadingScriptId === podcast.id ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
                        脚本
                      </button>
                    )}
                    {['failed', 'ready'].includes(podcast.status) && (
                      <button type="button" onClick={() => retryPodcast(podcast)} disabled={podcastBusy}>
                        <RotateCcw size={16} />
                        {podcast.status === 'failed' ? '重试' : '重生成'}
                      </button>
                    )}
                    {!busy && (
                      <button type="button" onClick={() => deletePodcast(podcast)} disabled={deletingPodcastId === podcast.id}>
                        {deletingPodcastId === podcast.id ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                        删除
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="empty-state podcast-empty">
            <Headphones size={30} />
            <h2>暂无{selectedPodcastLabel}</h2>
            <p>{podcastKindDescriptions[selectedPodcastKind]}</p>
          </div>
        )}
      </section>

      <div className="unit-list">
        {units.map((unit, index) => {
          const generating = isUnitGenerating(unit)
          return (
            <article key={unit.id} className="unit-row">
              <div className="unit-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="unit-main">
                <h2>{unit.title}</h2>
                <p>{unit.sourceLocation}</p>
                <span>
                  {formatNumber(unit.sourceWordCount)} 源文本词数
                  {unit.quality
                    ? ` · 阅读 ${unit.quality.readingWords} 词 · 听力 ${unit.quality.listeningWords} 词 · ${
                        unit.quality.status === 'good' ? '质量正常' : `需复核：${unit.quality.warnings.join('、')}`
                      } · ${unit.audio?.voice ? `声音 ${unit.audio.voice}` : '未生成音频'}`
                    : ''}
                  {unit.generation?.message ? ` · ${unit.generation.message}` : ''}
                </span>
              </div>
              <div className={`status-pill ${unitStatusClass(unit)}`}>{unitStatusLabel(unit)}</div>
              <div className="unit-actions">
                <button type="button" onClick={() => onOpenUnit(unit)} disabled={generating && !unit.content}>
                  {generating && !unit.content ? <Loader2 className="spin" size={16} /> : null}
                  {unit.status === 'planned' ? (generating ? '生成中' : '生成') : '学习'}
                </button>
                {unit.content && (
                  <button type="button" onClick={() => regenerate(unit)} disabled={regeneratingId === unit.id || generating}>
                    {regeneratingId === unit.id || generating ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                    重生成
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function StudyView({
  unit,
  settings,
  token,
  onBack,
  onCompleted,
  onRegenerateUnit,
  onRepairUnitParagraphs,
  onUnitUpdated,
  onRestoreVersion,
  onError,
}: {
  unit: Unit
  settings: UserSettings
  token: string
  onBack: () => void
  onCompleted: (report: Report) => void
  onRegenerateUnit: (unit: Unit, levels?: { readingLevel?: string; listeningLevel?: string; fidelityMode?: 'strict' }) => Promise<Unit | null>
  onRepairUnitParagraphs: (unit: Unit, paragraphs?: number[]) => Promise<Unit | null>
  onUnitUpdated: (unit: Unit) => void
  onRestoreVersion: (unit: Unit, versionId: string) => Promise<Unit>
  onError: (message: string) => void
}) {
  const [answers, setAnswers] = useState<Record<string, number>>(unit.progress?.answers || {})
  const [listeningCompleted, setListeningCompleted] = useState(Boolean(unit.progress?.listeningCompleted))
  const [currentParagraph, setCurrentParagraph] = useState(Number(unit.progress?.paragraphIndex || 0))
  const [viewedWords, setViewedWords] = useState<Set<string>>(new Set())
  const [aid, setAid] = useState<SelectedAid>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showSummaries, setShowSummaries] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState('')
  const [regeneratingFaithful, setRegeneratingFaithful] = useState(false)
  const [repairingParagraphs, setRepairingParagraphs] = useState(false)
  const [showQualityIssues, setShowQualityIssues] = useState(false)
  const [studyMode, setStudyMode] = useState<'learn' | 'review'>(settings.focusStudyMode === false ? 'review' : 'learn')
  const [dynamicDefinitions, setDynamicDefinitions] = useState<Record<string, VocabularyItem>>({})
  const [progressSyncStatus, setProgressSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef('')
  const qualityIssuesRef = useRef<HTMLDivElement | null>(null)
  const progressSaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const progressPendingRef = useRef(0)
  const progressMountedRef = useRef(true)
  const activeUnitIdRef = useRef(unit.id)
  const latestProgressRef = useRef<UnitProgress>({
    paragraphIndex: Number(unit.progress?.paragraphIndex || 0),
    listeningCompleted: Boolean(unit.progress?.listeningCompleted),
    answers: unit.progress?.answers || {},
    completed: Boolean(unit.progress?.completed),
    updatedAt: unit.progress?.updatedAt,
  })
  const content = unit.content
  const qualityAudit = unit.quality?.fidelity?.audit
  const unsupportedClaims = qualityAudit?.unsupportedClaims || []
  const missingImportantIdeas = qualityAudit?.missingImportantIdeas || []
  const lowFidelityScore = qualityAudit?.score !== undefined && Number(qualityAudit.score) < 0.6
  const lowQualitySourceMapItems = (unit.quality?.sourceMap || []).filter(
    (item) => item.status === 'review' || !item.sourceRefs.length || Number(item.confidence || 0) < 0.12 || Boolean(item.suspiciousSentences?.length)
  )
  const lowQualityParagraphNumbers = lowQualitySourceMapItems.map((item) => Number(item.readingParagraph || 0)).filter(Boolean)
  const needsFidelityReview = Boolean(lowFidelityScore || unsupportedClaims.length || lowQualitySourceMapItems.length)
  const latestVersion = (unit.versions || [])[unit.versions?.length ? unit.versions.length - 1 : -1]
  const reviewMode = studyMode === 'review'

  useEffect(() => {
    activeUnitIdRef.current = unit.id
    setAnswers(unit.progress?.answers || {})
    setListeningCompleted(Boolean(unit.progress?.listeningCompleted))
    setCurrentParagraph(Number(unit.progress?.paragraphIndex || 0))
    latestProgressRef.current = {
      paragraphIndex: Number(unit.progress?.paragraphIndex || 0),
      listeningCompleted: Boolean(unit.progress?.listeningCompleted),
      answers: unit.progress?.answers || {},
      completed: Boolean(unit.progress?.completed),
      updatedAt: unit.progress?.updatedAt,
    }
    setProgressSyncStatus('saved')
    setShowQualityIssues(false)
    setStudyMode(settings.focusStudyMode === false ? 'review' : 'learn')
  }, [unit.id, unit.progress?.updatedAt, settings.focusStudyMode])

  useEffect(() => {
    progressMountedRef.current = true
    return () => {
      progressMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!content || currentParagraph <= 0) return
    window.setTimeout(() => {
      document.querySelector(`[data-paragraph-index="${currentParagraph}"]`)?.scrollIntoView({ block: 'center' })
    }, 80)
  }, [content, currentParagraph])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
        for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
          navigator.mediaSession.setActionHandler(action, null)
        }
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  const vocabularyMap = useMemo(() => {
    const map = new Map<string, VocabularyItem>()
    for (const item of content?.vocabulary || []) map.set(item.term.toLowerCase(), item)
    for (const item of Object.values(dynamicDefinitions)) map.set(item.term.toLowerCase(), item)
    return map
  }, [content, dynamicDefinitions])

  if (!content) {
    const generation = unit.generation
    const failed = generation?.status === 'failed'
    const canceled = generation?.status === 'canceled'
    return (
      <section className="page-section">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回
        </button>
        <div className={failed || canceled ? 'empty-state failed-state' : 'empty-state'}>
          {failed || canceled ? <X size={32} /> : <Loader2 className="spin" size={32} />}
          <h2>
            {failed
              ? '生成失败'
              : canceled
                ? '生成已取消'
                : generation?.status === 'queued'
                  ? '已加入生成队列'
                  : generation?.status === 'paused'
                    ? '生成已暂停'
                    : '正在生成学习单元'}
          </h2>
          <p>{failed ? generation?.error || '可以返回单元列表后重试。' : generation?.message || '通常需要 30-90 秒。'}</p>
          {!failed && !canceled && generation?.progress !== undefined && <div className="progress-line task-progress"><span style={{ width: `${generation.progress}%` }} /></div>}
        </div>
      </section>
    )
  }

  const answeredAll = content.questions.every((question) => answers[question.id] !== undefined)

  function saveProgress(partial: Partial<UnitProgress>) {
    const snapshot = { ...latestProgressRef.current, ...partial }
    latestProgressRef.current = snapshot
    progressPendingRef.current += 1
    setProgressSyncStatus('saving')
    const unitId = unit.id
    const operation = progressSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await requestJson<{ progress: UnitProgress }>(`/api/units/${unitId}/progress`, token, {
          method: 'PATCH',
          body: JSON.stringify(snapshot),
        })
        if (activeUnitIdRef.current === unitId) latestProgressRef.current = { ...snapshot, ...result.progress }
      })
      .then(
        () => {
          progressPendingRef.current = Math.max(0, progressPendingRef.current - 1)
          if (progressMountedRef.current && activeUnitIdRef.current === unitId && progressPendingRef.current === 0) setProgressSyncStatus('saved')
        },
        () => {
          progressPendingRef.current = Math.max(0, progressPendingRef.current - 1)
          if (progressMountedRef.current && activeUnitIdRef.current === unitId) setProgressSyncStatus('error')
        }
      )
    progressSaveChainRef.current = operation
    return operation
  }

  function retryProgressSync() {
    saveProgress(latestProgressRef.current)
  }

  function markParagraph(index: number) {
    setCurrentParagraph(index)
    saveProgress({ paragraphIndex: index, answers, listeningCompleted })
  }

  function selectAnswer(questionId: string, optionIndex: number) {
    const next = { ...answers, [questionId]: optionIndex }
    setAnswers(next)
    saveProgress({ answers: next, paragraphIndex: currentParagraph, listeningCompleted })
  }

  function markListeningCompleted() {
    setListeningCompleted(true)
    saveProgress({ listeningCompleted: true, paragraphIndex: currentParagraph, answers })
  }

  function getAudioElement() {
    const audio = audioElementRef.current || audioRef.current || new Audio()
    audio.preload = 'auto'
    audio.setAttribute('playsinline', 'true')
    audioRef.current = audio
    return audio
  }

  function playBrowserSpeech(listeningText: string) {
    if (!listeningText) return
    if (!('speechSynthesis' in window)) {
      setShowTranscript(true)
      return
    }
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(listeningText)
    utterance.lang = 'en-US'
    utterance.rate = 1
    utterance.onend = () => {
      setSpeaking(false)
      markListeningCompleted()
    }
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  function configureMediaSession(audio: HTMLAudioElement) {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: content?.title || unit.title,
      artist: 'LinguaShelf',
      album: unit.sourceLocation,
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    })

    function updatePositionState() {
      if (!('setPositionState' in navigator.mediaSession)) return
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      })
    }

    function seekBy(seconds: number) {
      if (!Number.isFinite(audio.duration)) return
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
      updatePositionState()
    }

    navigator.mediaSession.setActionHandler('play', () => {
      audio.play().then(() => {
        setSpeaking(true)
        navigator.mediaSession.playbackState = 'playing'
        updatePositionState()
      }).catch(() => undefined)
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause()
      setSpeaking(false)
      navigator.mediaSession.playbackState = 'paused'
      updatePositionState()
    })
    navigator.mediaSession.setActionHandler('stop', () => {
      audio.pause()
      audio.currentTime = 0
      setSpeaking(false)
      navigator.mediaSession.playbackState = 'none'
      updatePositionState()
    })
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10))
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10))
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime !== 'number' || !Number.isFinite(audio.duration)) return
      audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime))
      updatePositionState()
    })

    audio.ontimeupdate = updatePositionState
    audio.ondurationchange = updatePositionState
  }

  async function playListening() {
    const listeningText = content?.listening.text
    if (!listeningText) return

    if (speaking) {
      if (audioRef.current) audioRef.current.pause()
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
      setSpeaking(false)
      return
    }

    if (audioRef.current && audioRef.current.src) {
      audioRef.current.currentTime = 0
      configureMediaSession(audioRef.current)
      await audioRef.current.play()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
      setSpeaking(true)
      return
    }

    setAudioLoading(true)
    try {
      const response = await sessionFetch(`/api/units/${unit.id}/audio?t=${Date.now()}`, token, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('audio unavailable')
      const blob = await response.blob()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = URL.createObjectURL(blob)
      const audio = getAudioElement()
      audio.src = audioUrlRef.current
      audioRef.current = audio
      configureMediaSession(audio)
      audio.onended = () => {
        setSpeaking(false)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
        markListeningCompleted()
      }
      audio.onpause = () => {
        if (!audio.ended) {
          setSpeaking(false)
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
        }
      }
      audio.onplay = () => {
        setSpeaking(true)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
      }
      audio.onerror = () => {
        setSpeaking(false)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
      }
      await audio.play()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
      setSpeaking(true)
    } catch {
      playBrowserSpeech(listeningText)
    } finally {
      setAudioLoading(false)
    }
  }

  async function openWord(event: MouseEvent<HTMLButtonElement>, word: string, sentence: string) {
    event.stopPropagation()
    const normalized = word.toLowerCase()
    setViewedWords((items) => new Set(items).add(normalized))
    const existing = vocabularyMap.get(normalized)
    if (existing) {
      setAid({ kind: 'word', word, detail: existing })
      return
    }

    const loadingDetail = {
      term: word,
      meaningZh: '正在查询释义',
      simpleEnglish: 'Looking up this word with sentence context...',
    }
    setAid({ kind: 'word', word, detail: loadingDetail })

    try {
      const result = await requestJson<{ definition: VocabularyItem }>('/api/words/define', token, {
        method: 'POST',
        body: JSON.stringify({ term: word, sentence }),
      })
      const definition = result.definition
      setDynamicDefinitions((items) => ({ ...items, [normalized]: definition }))
      setAid((current) => {
        if (current?.kind !== 'word' || current.word.toLowerCase() !== normalized) return current
        return { kind: 'word', word, detail: definition }
      })
    } catch {
      const fallback = fallbackMeaning(word)
      setDynamicDefinitions((items) => ({ ...items, [normalized]: fallback }))
      setAid((current) => {
        if (current?.kind !== 'word' || current.word.toLowerCase() !== normalized) return current
        return { kind: 'word', word, detail: fallback }
      })
    }
  }

  async function completeUnit() {
    setBusy(true)
    try {
      await progressSaveChainRef.current
      const result = await requestJson<{ report: Report }>(`/api/units/${unit.id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ answers, viewedWords: [...viewedWords], listeningCompleted }),
      })
      onCompleted(result.report)
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function restoreVersion(versionId: string) {
    setRestoringVersionId(versionId)
    try {
      const restored = await onRestoreVersion(unit, versionId)
      onUnitUpdated(restored)
    } catch (err) {
      onError(err instanceof Error ? err.message : '恢复历史版本失败')
    } finally {
      setRestoringVersionId('')
    }
  }

  function revealQualityIssues() {
    setStudyMode('review')
    setShowQualityIssues(true)
    window.setTimeout(() => qualityIssuesRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }

  async function regenerateFaithfulVersion() {
    if (!content) return
    setRegeneratingFaithful(true)
    try {
      const regenerated = await onRegenerateUnit(unit, {
        readingLevel: content.level.reading,
        listeningLevel: content.level.listening,
        fidelityMode: 'strict',
      })
      if (regenerated) {
        onUnitUpdated(regenerated)
        setShowQualityIssues(false)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '重新生成更忠实版本失败')
    } finally {
      setRegeneratingFaithful(false)
    }
  }

  async function repairQualityParagraphs(paragraphs = lowQualityParagraphNumbers) {
    if (!content) return
    setRepairingParagraphs(true)
    try {
      const repaired = await onRepairUnitParagraphs(unit, paragraphs)
      if (repaired) {
        onUnitUpdated(repaired)
        setShowQualityIssues(false)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '段落修复失败')
    } finally {
      setRepairingParagraphs(false)
    }
  }

  async function restoreLatestVersion() {
    if (!latestVersion?.id) return
    await restoreVersion(latestVersion.id)
  }

  return (
    <section className="study-layout">
      <div className="study-main">
        <div className="detail-head">
          <button className="ghost-button" type="button" onClick={onBack}>
            <ArrowLeft size={18} />
            返回单元
          </button>
          <div>
            <span className="eyebrow">
              阅读 {content.level.reading} · 听力 {content.level.listening}
            </span>
            <h1>{content.title}</h1>
            <p>{content.sourceLocation}</p>
          </div>
          <div className="study-head-tools">
            <button
              className={`progress-sync ${progressSyncStatus}`}
              type="button"
              onClick={progressSyncStatus === 'error' ? retryProgressSync : undefined}
              disabled={progressSyncStatus !== 'error'}
              title={progressSyncStatus === 'error' ? '点击重试同步' : '学习进度同步状态'}
            >
              {progressSyncStatus === 'saving' ? <Loader2 className="spin" size={14} /> : progressSyncStatus === 'error' ? <RotateCcw size={14} /> : <Check size={14} />}
              {progressSyncStatus === 'saving' ? '保存中' : progressSyncStatus === 'error' ? '同步失败，重试' : '已同步'}
            </button>
            <div className="study-mode-switch">
              <Segmented
                ariaLabel="学习页模式"
                options={['学习模式', '审稿模式']}
                value={reviewMode ? '审稿模式' : '学习模式'}
                onChange={(value) => {
                  setStudyMode(value === '审稿模式' ? 'review' : 'learn')
                  if (value === '学习模式') setShowQualityIssues(false)
                }}
              />
            </div>
          </div>
        </div>

        {!reviewMode && needsFidelityReview && (
          <div className="focus-quality-notice">
            <ShieldCheck size={17} />
            <span>这个单元有质量复核提示。你可以先继续学习，或切换到审稿模式查看细节。</span>
            <button type="button" onClick={revealQualityIssues}>查看</button>
          </div>
        )}

        {reviewMode && (
          <details className="source-box">
            <summary>
              <ChevronDown size={18} />
              查看来源
            </summary>
            <p>{unit.sourceExcerpt}</p>
          </details>
        )}

        {reviewMode && unit.quality && (
          <details className="source-box quality-box" open={needsFidelityReview || showQualityIssues}>
            <summary>
              <ChevronDown size={18} />
              生成质量
            </summary>
            <div className="quality-grid">
              <Stat label="阅读词数" value={String(unit.quality.readingWords)} />
              <Stat label="听力词数" value={String(unit.quality.listeningWords)} />
              <Stat label="关键词覆盖" value={formatPercent(unit.quality.fidelity?.keywordCoverage || 0)} />
              <Stat label="忠实度审稿" value={unit.quality.fidelity?.audit ? formatPercent(unit.quality.fidelity.audit.score || 0) : '未审稿'} />
            </div>
            {needsFidelityReview && (
              <div className="quality-actions" aria-label="忠实度处理">
                <button type="button" className="ghost-button" onClick={revealQualityIssues}>
                  <ListChecks size={16} />
                  查看疑点
                </button>
                <button type="button" className="primary-button" onClick={() => repairQualityParagraphs()} disabled={repairingParagraphs || !lowQualityParagraphNumbers.length}>
                  {repairingParagraphs ? <Loader2 className="spin" size={16} /> : <Pencil size={16} />}
                  只修复低质量段落
                </button>
                <button type="button" className="primary-button" onClick={regenerateFaithfulVersion} disabled={regeneratingFaithful}>
                  {regeneratingFaithful ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                  重新生成更忠实版本
                </button>
                <button type="button" className="ghost-button" onClick={restoreLatestVersion} disabled={!latestVersion?.id || restoringVersionId === latestVersion?.id}>
                  {restoringVersionId === latestVersion?.id ? <Loader2 className="spin" size={16} /> : <Clock size={16} />}
                  恢复上一版
                </button>
              </div>
            )}
            {unit.quality.warnings.length > 0 && <p>{unit.quality.warnings.join('；')}</p>}
            {unit.quality.fidelity?.audit && (
              <div className="quality-note">
                <strong>{unit.quality.fidelity.audit.mode === 'ai' ? 'AI 审稿' : '本地审稿'}：{unit.quality.fidelity.audit.verdict}</strong>
                {unit.quality.fidelity.audit.error && <p>{unit.quality.fidelity.audit.error}</p>}
                {(unit.quality.fidelity.audit.risks || []).length > 0 && <p>风险：{unit.quality.fidelity.audit.risks.join('；')}</p>}
                {(unit.quality.fidelity.audit.unsupportedClaims || []).length > 0 && <p>疑似未受原文支持：{unit.quality.fidelity.audit.unsupportedClaims.join('；')}</p>}
              </div>
            )}
            {(showQualityIssues || needsFidelityReview) && (
              <div ref={qualityIssuesRef} className="quality-issues">
                <strong>需要优先核对的疑点</strong>
                {unsupportedClaims.length > 0 && <p>疑似未受原文支持：{unsupportedClaims.join('；')}</p>}
                {missingImportantIdeas.length > 0 && <p>可能遗漏原文重点：{missingImportantIdeas.join('；')}</p>}
                {lowQualitySourceMapItems.some((item) => item.suspiciousSentences?.length) && (
                  <p>
                    具体可疑句子：
                    {lowQualitySourceMapItems
                      .flatMap((item) => (item.suspiciousSentences || []).map((sentence) => `第 ${item.readingParagraph} 段：${sentence.sentence}`))
                      .slice(0, 6)
                      .join('；')}
                  </p>
                )}
                {(unit.quality.sourceMap || []).some((item) => !item.sourceRefs.length) && (
                  <p>
                    缺少明确来源映射：
                    {(unit.quality.sourceMap || [])
                      .filter((item) => !item.sourceRefs.length)
                      .map((item) => `阅读第 ${item.readingParagraph} 段`)
                      .join('、')}
                  </p>
                )}
                {!unsupportedClaims.length && !missingImportantIdeas.length && <p>审稿分数偏低，建议先查看逐段来源映射，再决定是否继续学习。</p>}
              </div>
            )}
            {(unit.quality.fidelity?.missingKeywords || []).length > 0 && (
              <p>缺失关键词：{(unit.quality.fidelity?.missingKeywords || []).slice(0, 10).join('、')}</p>
            )}
            {(unit.quality.fidelity?.audit?.missingImportantIdeas || []).length > 0 && (
              <p>审稿提示可能遗漏：{(unit.quality.fidelity?.audit?.missingImportantIdeas || []).slice(0, 8).join('；')}</p>
            )}
            {(unit.quality.sourceRefs || []).map((ref) => (
              <p key={ref.id}>{ref.label}：{ref.excerpt}</p>
            ))}
            {(unit.quality.sourceMap || []).length > 0 && (
              <details className="nested-details">
                <summary>逐段来源映射</summary>
                {(unit.quality.sourceMap || []).map((item) => (
                  <div key={`source-map-${item.readingParagraph}`} className={item.status === 'review' ? 'source-map-item review' : 'source-map-item'}>
                    <div className="source-map-head">
                      <strong>阅读第 {item.readingParagraph} 段</strong>
                      <span className={`status-pill ${item.status === 'review' ? 'failed' : 'completed'}`}>{item.status === 'review' ? '需复核' : '已映射'}</span>
                      {item.confidence !== undefined && <span>置信度 {formatPercent(item.confidence || 0)}</span>}
                      {item.status === 'review' && (
                        <button type="button" onClick={() => repairQualityParagraphs([item.readingParagraph])} disabled={repairingParagraphs}>
                          {repairingParagraphs ? <Loader2 className="spin" size={16} /> : <Pencil size={16} />}
                          修复本段
                        </button>
                      )}
                    </div>
                    <SourceMapDetail item={item} generatedText={content.reading.paragraphs[item.readingParagraph - 1]?.text} />
                  </div>
                ))}
              </details>
            )}
            {(unit.versions || []).length > 0 && (
              <details className="nested-details">
                <summary>历史版本</summary>
                <div className="version-list">
                  {(unit.versions || []).slice().reverse().map((version) => (
                    <div key={version.id} className="version-item">
                      <div className="version-main">
                        <div className="version-title-line">
                          <strong>{version.title}</strong>
                          <span className="status-pill queued">{versionReasonLabel(version.reason)}</span>
                        </div>
                        <span>
                          {version.savedAt ? new Date(version.savedAt).toLocaleString() : '历史版本'}
                          {version.level ? ` · 阅读 ${version.level.reading} · 听力 ${version.level.listening}` : ''}
                          {version.quality?.fidelity?.audit?.score !== undefined ? ` · 原忠实度 ${formatPercent(version.quality.fidelity.audit.score)}` : ''}
                        </span>
                        {version.diff && (
                          <details className="version-diff">
                            <summary>
                              <Diff size={15} />
                              差异：改动 {version.diff.summary.changedParagraphs} 段 · 阅读 {formatSigned(version.diff.summary.wordDelta)} 词 · 听力 {formatSigned(version.diff.summary.listeningWordDelta)} 词
                              {version.diff.summary.fidelityScoreDelta !== null ? ` · 忠实度 ${formatSigned(Math.round(version.diff.summary.fidelityScoreDelta * 100))}%` : ''}
                            </summary>
                            <div className="version-diff-grid">
                              <span>旧版阅读 {version.diff.previous.readingWords} 词</span>
                              <span>当前阅读 {version.diff.current.readingWords} 词</span>
                              <span>题目 {formatSigned(version.diff.summary.questionDelta)}</span>
                              <span>{version.diff.summary.levelChanged ? '难度有变化' : '难度未变'}</span>
                            </div>
                            <div className="version-paragraph-diffs">
                              {version.diff.paragraphDiffs.filter((item) => item.changed).slice(0, 5).map((item) => (
                                <div key={`${version.id}-${item.paragraph}`}>
                                  <strong>第 {item.paragraph} 段 · 相似度 {formatPercent(item.similarity)} · {formatSigned(item.wordDelta)} 词</strong>
                                  <p>旧：{item.previousPreview || '无'}</p>
                                  <p>新：{item.currentPreview || '无'}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                      <button type="button" onClick={() => restoreVersion(version.id)} disabled={restoringVersionId === version.id}>
                        {restoringVersionId === version.id ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </details>
        )}

        <section className="learning-block">
          <h2>概念预习</h2>
          <div className="concept-grid">
            {content.concepts.map((concept) => (
              <button key={concept.term} type="button" onClick={() => setAid({ kind: 'concept', concept })}>
                <strong>{concept.term}</strong>
                <span>{concept.simpleEnglish}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="learning-block listening-block">
          <div className="block-title">
            <div>
              <span className="eyebrow">先听后读</span>
              <h2>听力预热</h2>
            </div>
            <button className="primary-button" type="button" onClick={playListening}>
              {audioLoading ? <Loader2 className="spin" size={18} /> : speaking ? <Pause size={18} /> : <Play size={18} />}
              {audioLoading ? '生成音频' : speaking ? '停止' : '播放'}
            </button>
          </div>
          <button className="ghost-button" type="button" onClick={() => setShowTranscript((value) => !value)}>
            <Headphones size={18} />
            {showTranscript ? '隐藏文本' : '显示文本'}
          </button>
          <audio ref={audioElementRef} className="audio-anchor" preload="auto" playsInline />
          <span className={listeningCompleted ? 'listen-state done' : 'listen-state'}>{listeningCompleted ? '听力已完成' : '尚未完成听力'}</span>
          {showTranscript && <p className="transcript">{content.listening.text}</p>}
        </section>

        <section className="learning-block reading-block">
          <div className="block-title">
            <div>
              <span className="eyebrow">Reading</span>
              <h2>分级阅读</h2>
            </div>
          </div>
          {content.reading.paragraphs.map((paragraph, paragraphIndex) => {
            const sourceMapItem = sourceMapForParagraph(unit, paragraphIndex)
            const needsParagraphReview = reviewMode && sourceMapItem?.status === 'review'
            return (
              <article
                key={`${paragraph.text}-${paragraphIndex}`}
                className={`${paragraphIndex === currentParagraph ? 'reading-paragraph current' : paragraphIndex < currentParagraph ? 'reading-paragraph seen' : 'reading-paragraph'}${needsParagraphReview ? ' needs-review' : ''}`}
                data-paragraph-index={paragraphIndex}
              >
                <p>
                  {splitSentences(paragraph.text).map((sentence, sentenceIndex) => {
                    const suspicious = reviewMode ? suspiciousMatch(sentence, sourceMapItem) : undefined
                    return (
                      <span
                        key={`${sentence}-${sentenceIndex}`}
                        role="button"
                        tabIndex={0}
                        className={suspicious ? 'sentence suspicious' : 'sentence'}
                        title={suspicious?.reason}
                        onClick={() => setAid({ kind: 'sentence', sentence, summary: suspicious ? `${paragraph.summaryZh}\n\n疑点：${suspicious.reason}` : paragraph.summaryZh })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') setAid({ kind: 'sentence', sentence, summary: suspicious ? `${paragraph.summaryZh}\n\n疑点：${suspicious.reason}` : paragraph.summaryZh })
                        }}
                      >
                        {renderWords(sentence, vocabularyMap, openWord)}
                        {' '}
                      </span>
                    )
                  })}
                </p>
                <button
                  className="summary-button"
                  type="button"
                  onClick={() => setShowSummaries((value) => ({ ...value, [paragraphIndex]: !value[paragraphIndex] }))}
                >
                  {showSummaries[paragraphIndex] ? '隐藏段落摘要' : '段落摘要'}
                </button>
                <button className="summary-button progress-button" type="button" onClick={() => markParagraph(paragraphIndex)}>
                  读到这里
                </button>
                {reviewMode && needsParagraphReview && (
                  <button className="summary-button repair-button" type="button" onClick={() => repairQualityParagraphs([paragraphIndex + 1])} disabled={repairingParagraphs}>
                    {repairingParagraphs ? '修复中' : '修复本段'}
                  </button>
                )}
                {showSummaries[paragraphIndex] && <div className="summary-text">{paragraph.summaryZh}</div>}
                {reviewMode && sourceMapItem && (
                  <details className="paragraph-source-map" open={needsParagraphReview}>
                    <summary>
                      来源映射 · {sourceMapItem.status === 'review' ? '需复核' : '已匹配'}
                      {sourceMapItem.confidence !== undefined ? ` · ${formatPercent(sourceMapItem.confidence || 0)}` : ''}
                    </summary>
                    <SourceMapDetail item={sourceMapItem} generatedText={paragraph.text} />
                  </details>
                )}
              </article>
            )
          })}
        </section>

        <section className="learning-block">
          <h2>理解题</h2>
          <div className="question-list">
            {content.questions.map((question, questionIndex) => (
              <article key={question.id} className="question-item">
                <h3>
                  {questionIndex + 1}. {question.prompt}
                </h3>
                <div className="options-grid">
                  {question.options.map((option, optionIndex) => (
                    <button
                      key={`${question.id}-${option}`}
                      type="button"
                      className={answers[question.id] === optionIndex ? 'selected' : ''}
                      onClick={() => selectAnswer(question.id, optionIndex)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {answers[question.id] !== undefined && answers[question.id] !== question.answerIndex && (
                  <details className="answer-help">
                    <summary>中文解释</summary>
                    <p>{question.explanationZh}</p>
                  </details>
                )}
              </article>
            ))}
          </div>
          <button className="primary-button submit-button" type="button" disabled={!answeredAll || busy} onClick={completeUnit}>
            {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            完成单元
          </button>
        </section>
      </div>

      <aside className="assist-panel">
        <h2>学习辅助</h2>
        {!aid && <p>点击单词、句子或概念查看中文辅助。</p>}
        {aid?.kind === 'word' && (
          <div>
            <span className="eyebrow">单词</span>
            <h3>{aid.word}</h3>
            <p>{aid.detail?.meaningZh}</p>
            <p>{aid.detail?.simpleEnglish}</p>
          </div>
        )}
        {aid?.kind === 'sentence' && (
          <div>
            <span className="eyebrow">句子</span>
            <p className="sentence-preview">{aid.sentence}</p>
            <p>{aid.summary}</p>
          </div>
        )}
        {aid?.kind === 'concept' && (
          <div>
            <span className="eyebrow">概念</span>
            <h3>{aid.concept.term}</h3>
            <p>{aid.concept.simpleEnglish}</p>
            <p>{aid.concept.chinese}</p>
          </div>
        )}
        <div className="mini-list">
          <span>已点生词</span>
          <strong>{viewedWords.size}</strong>
        </div>
        <p className="fidelity-note">{content.fidelityNote}</p>
      </aside>
    </section>
  )
}

function renderWords(
  sentence: string,
  vocabularyMap: Map<string, VocabularyItem>,
  onWord: (event: MouseEvent<HTMLButtonElement>, word: string, sentence: string) => void,
) {
  return sentence.split(/([A-Za-z][A-Za-z'-]*)/g).map((part, index) => {
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(part)) return <span key={`${part}-${index}`}>{part}</span>
    const known = vocabularyMap.has(part.toLowerCase())
    return (
      <button
        key={`${part}-${index}`}
        type="button"
        className={known ? 'word-token known' : 'word-token'}
        onClick={(event) => onWord(event, part, sentence)}
      >
        {part}
      </button>
    )
  })
}

function OptionSegment<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

function MicroPracticeView({
  token,
  settings,
  stats,
  books,
  initialPractices,
  initialAttempts,
  onChanged,
  onOpenBook,
  onNavigate,
  onError,
}: {
  token: string
  settings: UserSettings
  stats: AppData['stats']
  books: Book[]
  initialPractices: MicroPractice[]
  initialAttempts: MicroAttempt[]
  onChanged: () => void
  onOpenBook: (book: Book) => void
  onNavigate: (view: View) => void
  onError: (message: string) => void
}) {
  const [practiceType, setPracticeType] = useState<MicroPracticeType>(settings.microPracticeType || 'random')
  const [topic, setTopic] = useState<MicroPracticeTopic>(settings.microPracticeTopic || 'book')
  const [difficulty, setDifficulty] = useState(settings.microPracticeDifficulty || settings.readingLevel || 'A2+')
  const [customTopic, setCustomTopic] = useState(settings.microPracticeCustomTopic || '')
  const [bookId, setBookId] = useState(books[0]?.id || '')
  const [practices, setPractices] = useState(initialPractices)
  const [attempts, setAttempts] = useState(initialAttempts)
  const [current, setCurrent] = useState<MicroPractice | null>(initialPractices.find((item) => item.status !== 'completed') || null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [generating, setGenerating] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [resultAttempt, setResultAttempt] = useState<MicroAttempt | null>(null)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [showCompletion, setShowCompletion] = useState(false)
  const [statsSnapshot, setStatsSnapshot] = useState(stats)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef('')
  const recentLowScore = attempts.slice(0, 3).some((item) => item.correctRate < 0.7)
  const hasReviewVocabulary = Number(statsSnapshot?.vocabularyCount || 0) > 0
  const recommendedTopic: MicroPracticeTopic = recentLowScore && hasReviewVocabulary ? 'weak-vocabulary' : books.length ? 'book' : hasReviewVocabulary ? 'weak-vocabulary' : 'history'
  const recommendedLabel = recommendedTopic === 'book' ? '最近书籍' : recommendedTopic === 'weak-vocabulary' ? '近期生词' : '历史'
  const microDailyGoal = statsSnapshot?.microDailyGoal ?? 1
  const microTodayGoalMet = microDailyGoal > 0 && (statsSnapshot?.todayMicroPractices || 0) >= microDailyGoal
  const recommendationText =
    microTodayGoalMet
      ? '今日轻练已完成，可以再用近期生词做一轮复盘。'
      : recommendedTopic === 'weak-vocabulary'
        ? '最近的答题说明有些词还不够稳，今天先做一轮生词轻练。'
        : recommendedTopic === 'book'
          ? '从最近书籍抽一个短练习，保持阅读主线不断。'
          : '先用通用历史主题开始，建立每日输入节奏。'

  useEffect(() => {
    setPractices(initialPractices)
    setAttempts(initialAttempts)
    setCurrent((item) => item || initialPractices.find((practice) => practice.status !== 'completed') || null)
  }, [initialPractices, initialAttempts])

  useEffect(() => {
    setStatsSnapshot(stats)
  }, [stats])

  useEffect(() => {
    return () => {
      const audio = audioRef.current
      audio?.pause()
      audio?.removeAttribute('src')
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  const answeredAll = Boolean(current?.content.questions.every((question) => answers[question.id] !== undefined))

  async function loadRecent() {
    const result = await requestJson<{ practices: MicroPractice[]; attempts: MicroAttempt[]; stats: AppData['stats'] }>('/api/micro-practices/recent', token)
    setPractices(result.practices)
    setAttempts(result.attempts)
    setStatsSnapshot(result.stats)
  }

  async function generatePractice() {
    setGenerating(true)
    setResultAttempt(null)
    setShowCompletion(false)
    try {
      const result = await requestJson<{ practice: MicroPractice; stats: AppData['stats'] }>('/api/micro-practices/generate', token, {
        method: 'POST',
        body: JSON.stringify({
          type: practiceType,
          topic,
          difficulty,
          customTopic,
          bookId: topic === 'book' ? bookId : '',
        }),
      })
      resetMicroAudio()
      setCurrent(result.practice)
      setPractices((items) => [result.practice, ...items.filter((item) => item.id !== result.practice.id)].slice(0, 20))
      setAnswers({})
      setStartedAt(Date.now())
      setTranscriptVisible(result.practice.type === 'reading')
      setStatsSnapshot(result.stats)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : '每日轻练生成失败')
    } finally {
      setGenerating(false)
    }
  }

  async function playAudio() {
    if (!current || current.type !== 'listening') return
    const audio = audioRef.current
    if (!audio) return
    if (audioPlaying) {
      audio.pause()
      setAudioPlaying(false)
      return
    }
    if (audio.dataset.practiceId === current.id && audio.src) {
      await audio.play()
      setAudioPlaying(true)
      return
    }

    setAudioLoading(true)
    try {
      const response = await sessionFetch(`/api/micro-practices/${current.id}/audio?t=${Date.now()}`, token)
      if (!response.ok) throw new Error('音频生成失败')
      const blob = await response.blob()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      audio.preload = 'auto'
      audio.setAttribute('playsinline', 'true')
      audio.dataset.practiceId = current.id
      audio.src = url
      await audio.play()
    } catch (err) {
      onError(err instanceof Error ? err.message : '音频播放失败')
    } finally {
      setAudioLoading(false)
    }
  }

  function resetMicroAudio() {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.removeAttribute('data-practice-id')
      audio.load()
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = ''
    setAudioUrl('')
    setAudioPlaying(false)
  }

  async function completePractice() {
    if (!current || !answeredAll) return
    setCompleting(true)
    try {
      const result = await requestJson<{ attempt: MicroAttempt; practice: MicroPractice; stats: AppData['stats'] }>(`/api/micro-practices/${current.id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({
          answers,
          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        }),
      })
      setResultAttempt(result.attempt)
      setCurrent(result.practice)
      setPractices((items) => items.map((item) => (item.id === result.practice.id ? result.practice : item)))
      setAttempts((items) => [result.attempt, ...items.filter((item) => item.id !== result.attempt.id)].slice(0, 30))
      setStatsSnapshot(result.stats)
      setShowCompletion(true)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交轻练失败')
    } finally {
      setCompleting(false)
    }
  }

  function openPractice(practice: MicroPractice) {
    resetMicroAudio()
    setCurrent(practice)
    setAnswers({})
    setResultAttempt(null)
    setShowCompletion(false)
    setTranscriptVisible(practice.type === 'reading' || practice.status === 'completed')
    setStartedAt(Date.now())
  }

  return (
    <section className="micro-page">
      <div className="page-section dashboard-hero micro-hero">
        <div>
          <span className="eyebrow">每日轻练</span>
          <h1>忙的时候，也留一点英语输入</h1>
          <p>生成一段短文或听力，答几道理解题，并把结果计入学习数据。</p>
        </div>
        <button className="primary-button" type="button" onClick={generatePractice} disabled={generating}>
          {generating ? <Loader2 className="spin" size={18} /> : <Brain size={18} />}
          {generating ? '生成中' : '开始新轻练'}
        </button>
      </div>

      <div className="micro-layout">
        <div className="micro-main">
          <section className="page-section compact-section micro-controls">
            <div className="micro-control-row">
              <div>
                <span className="eyebrow">类型</span>
                <OptionSegment options={microPracticeTypeOptions} value={practiceType} onChange={setPracticeType} ariaLabel="轻练类型" />
              </div>
              <div>
                <span className="eyebrow">难度</span>
                <Segmented options={microDifficultyOptions} value={difficulty} onChange={setDifficulty} ariaLabel="轻练难度" />
              </div>
            </div>
            <div className="micro-control-row">
              <div>
                <span className="eyebrow">主题</span>
                <OptionSegment options={microPracticeTopicOptions} value={topic} onChange={setTopic} ariaLabel="轻练主题" />
              </div>
            </div>
            {topic === 'custom' && (
              <input className="search-input" value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder="输入一个你想练习的主题" />
            )}
            {topic === 'book' && books.length > 0 && (
              <select className="micro-select" value={bookId} onChange={(event) => setBookId(event.target.value)} aria-label="选择书籍">
                <option value="">自动选择最近书籍</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>{book.title}</option>
                ))}
              </select>
            )}
          </section>

          {!current ? (
            <div className="empty-state micro-empty">
              <Brain size={32} />
              <h2>还没有轻练</h2>
              <p>选择类型、主题和难度后开始。</p>
            </div>
          ) : (
            <section className="page-section micro-practice-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">{current.typeLabel} · {current.difficulty}</span>
                  <h1>{current.content.title}</h1>
                  <p>{current.topicLabel} · {current.sourceSummary}</p>
                </div>
                {current.sourceBookId && (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      const book = books.find((item) => item.id === current.sourceBookId)
                      if (book) onOpenBook(book)
                    }}
                    disabled={!books.some((item) => item.id === current.sourceBookId)}
                  >
                    <BookOpen size={17} />
                    来源书籍
                  </button>
                )}
              </div>

              {current.content.concepts.length > 0 && (
                <div className="micro-concepts">
                  {current.content.concepts.map((concept) => (
                    <div key={`${current.id}-${concept.term}`}>
                      <strong>{concept.term}</strong>
                      <span>{concept.simpleEnglish}</span>
                    </div>
                  ))}
                </div>
              )}

              {current.type === 'listening' ? (
                <div className="micro-listening">
                  <button className="primary-button" type="button" onClick={playAudio} disabled={audioLoading}>
                    {audioLoading ? <Loader2 className="spin" size={18} /> : audioPlaying ? <Pause size={18} /> : <Play size={18} />}
                    {audioLoading ? '生成音频' : audioPlaying ? '暂停' : '播放'}
                  </button>
                  <audio
                    ref={audioRef}
                    className={audioUrl ? 'podcast-audio' : 'audio-anchor'}
                    src={audioUrl || undefined}
                    controls={Boolean(audioUrl)}
                    playsInline
                    onPlay={() => setAudioPlaying(true)}
                    onPause={() => setAudioPlaying(false)}
                    onEnded={() => setAudioPlaying(false)}
                    onError={() => setAudioPlaying(false)}
                  />
                  <button className="ghost-button" type="button" onClick={() => setTranscriptVisible((value) => !value)}>
                    <Headphones size={18} />
                    {transcriptVisible ? '隐藏文本' : '显示文本'}
                  </button>
                </div>
              ) : null}

              {(current.type === 'reading' || transcriptVisible) && (
                <article className="micro-text">
                  <p>{current.content.body}</p>
                </article>
              )}

              {current.content.vocabulary.length > 0 && (
                <div className="micro-vocab-row">
                  {current.content.vocabulary.slice(0, 7).map((item) => (
                    <span key={`${current.id}-${item.term}`}>{item.term} · {item.meaningZh}</span>
                  ))}
                </div>
              )}

              <div className="question-list">
                {current.content.questions.map((question, questionIndex) => (
                  <article key={question.id} className="question-item">
                    <h3>{questionIndex + 1}. {question.prompt}</h3>
                    <div className="options-grid">
                      {question.options.map((option, optionIndex) => {
                        const selected = answers[question.id] === optionIndex
                        const isCorrect = resultAttempt && optionIndex === question.answerIndex
                        const isWrong = resultAttempt && selected && optionIndex !== question.answerIndex
                        return (
                          <button
                            key={`${question.id}-${option}`}
                            type="button"
                            className={`${selected ? 'selected' : ''}${isCorrect ? ' correct' : ''}${isWrong ? ' wrong' : ''}`}
                            onClick={() => {
                              if (!resultAttempt) setAnswers((items) => ({ ...items, [question.id]: optionIndex }))
                            }}
                          >
                            {option}
                          </button>
                        )
                      })}
                    </div>
                    {resultAttempt && <p className="answer-help">{question.explanationZh}</p>}
                  </article>
                ))}
              </div>

              <div className="micro-actions">
                <button className="primary-button" type="button" onClick={completePractice} disabled={!answeredAll || completing || Boolean(resultAttempt)}>
                  {completing ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                  {resultAttempt ? '已完成' : '提交答案'}
                </button>
                <button className="ghost-button" type="button" onClick={generatePractice} disabled={generating}>
                  <RotateCcw size={18} />
                  换一题
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="micro-side">
          <section className="page-section compact-section">
            <div className="section-head">
              <div>
                <span className="eyebrow">今日推荐</span>
                <h2>{recommendedLabel}</h2>
                <p>{recommendationText}</p>
              </div>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setTopic(recommendedTopic)
                setPracticeType(settings.microPracticeType || 'random')
                setDifficulty(settings.microPracticeDifficulty || settings.readingLevel || 'A2+')
              }}
            >
              <Brain size={17} />
              使用推荐
            </button>
          </section>

          <section className="page-section compact-section">
            <h2>轻练目标</h2>
            <div className="review-plan-grid micro-goal-grid">
              <Stat label="今日" value={`${statsSnapshot.todayMicroPractices || 0}/${statsSnapshot.microDailyGoal ?? 1}`} />
              <Stat label="本月" value={`${statsSnapshot.microMonthPractices || 0}/${statsSnapshot.microMonthlyGoal ?? 30}`} />
            </div>
          </section>

          <section className="page-section compact-section">
            <div className="section-head">
              <div>
                <h2>最近记录</h2>
                <p>{attempts.length ? `${attempts.length} 次轻练` : '完成后显示'}</p>
              </div>
              <button className="ghost-button" type="button" onClick={() => loadRecent().catch(() => undefined)}>
                <RotateCcw size={16} />
                刷新
              </button>
            </div>
            {attempts.length ? (
              <div className="micro-history">
                {attempts.slice(0, 10).map((attempt) => (
                  <div key={attempt.id}>
                    <strong>{attempt.topicLabel}</strong>
                    <span>{attempt.type === 'listening' ? '听力' : '阅读'} · {attempt.difficulty} · {attempt.correctCount}/{attempt.questionCount} · {formatDateTime(attempt.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <SmallEmpty icon={Brain} text="完成每日轻练后会记录正确率、难度和用时。" />
            )}
          </section>

          {practices.length > 0 && (
            <section className="page-section compact-section">
              <h2>最近生成</h2>
              <div className="micro-practice-list">
                {practices.slice(0, 6).map((practice) => (
                  <button key={practice.id} type="button" onClick={() => openPractice(practice)}>
                    <strong>{practice.content.title}</strong>
                    <span>{practice.typeLabel} · {practice.topicLabel} · {practice.difficulty}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {showCompletion && resultAttempt && (
        <div className="completion-overlay" role="dialog" aria-modal="true">
          <div className="completion-panel">
            <span className="eyebrow">完成报告</span>
            <h2>{resultAttempt.correctCount}/{resultAttempt.questionCount} 正确 · {formatPercent(resultAttempt.correctRate)}</h2>
            <p>{resultAttempt.suggestion || '这次轻练已记录。'}</p>
            <div className="report-metrics">
              <Stat label="学习时长" value={`${resultAttempt.studyMinutes} 分钟`} />
              <Stat label="关联生词" value={String(resultAttempt.savedVocabularyCount || 0)} />
            </div>
            <div className="completion-actions">
              <button className="primary-button" type="button" onClick={() => setShowCompletion(false)}>
                <Check size={18} />
                查看详情
              </button>
              <button className="ghost-button" type="button" onClick={() => onNavigate('dashboard')}>
                <Activity size={18} />
                看数据
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ReportsView({
  reports,
  settings,
  stats,
  token,
  onSettingsUpdated,
}: {
  reports: Report[]
  settings: UserSettings
  stats: AppData['stats']
  token: string
  onSettingsUpdated: (settings: UserSettings) => void
}) {
  async function acceptSuggestion() {
    const currentIndex = readingLevelOptions.indexOf(settings.readingLevel)
    const nextReading = readingLevelOptions[Math.min(readingLevelOptions.length - 1, currentIndex + 1)] || settings.readingLevel
    const result = await requestJson<{ settings: UserSettings }>('/api/settings', token, {
      method: 'PATCH',
      body: JSON.stringify({ readingLevel: nextReading }),
    })
    onSettingsUpdated(result.settings)
  }

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <h1>学习报告</h1>
          <p>{reports.length ? `${reports.length} 次完成记录` : '完成单元后生成报告'}</p>
        </div>
      </div>
      <div className="stat-row">
        <Stat label="完成单元" value={String(stats.completedUnits)} />
        <Stat label="平均正确率" value={formatPercent(stats.averageCorrectRate)} />
        <Stat label="到期生词" value={String(stats.dueVocabulary)} />
        <Stat label="已掌握词" value={String(stats.masteredVocabulary)} />
      </div>
      {stats.recentReports.length > 0 && (
        <div className="trend-strip">
          {stats.recentReports.slice(-10).map((item, index) => (
            <div key={`${item.date}-${index}`} title={`${item.date} · ${formatPercent(item.correctRate)}`}>
              <span style={{ height: `${Math.max(12, Math.round(item.correctRate * 72))}px` }} />
            </div>
          ))}
        </div>
      )}
      {reports.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={32} />
          <h2>暂无报告</h2>
          <p>完成一个单元后会显示正确率、生词和难度建议。</p>
        </div>
      ) : (
        <div className="report-list">
          {reports.map((report, index) => (
            <article key={report.id} className={index === 0 ? 'report-card featured' : 'report-card'}>
              <div>
                <span className="eyebrow">{report.bookTitle}</span>
                <h2>{report.unitTitle}</h2>
              </div>
              <div className="report-metrics">
                <Stat label="理解题正确率" value={formatPercent(report.correctRate)} />
                <Stat label="正确题数" value={`${report.correctCount}/${report.questionCount}`} />
                <Stat label="生词数量" value={String(report.newVocabularyCount)} />
              </div>
              {report.levelAdjustment?.message && (
                <p className={report.levelAdjustment.applied ? 'level-adjustment applied' : 'level-adjustment'}>
                  {report.levelAdjustment.message}
                </p>
              )}
              <details className="report-details">
                <summary>AI 难度建议</summary>
                <div className="suggestion-box">
                  <p>{report.suggestion.reading}</p>
                  <p>{report.suggestion.listening}</p>
                </div>
              </details>
              {report.suggestion.action === 'consider-up' && index === 0 && (
                <button className="primary-button" type="button" onClick={acceptSuggestion}>
                  <Check size={18} />
                  接受阅读难度建议
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function TasksView({ token, isAdmin, onNavigate, onChanged }: { token: string; isAdmin: boolean; onNavigate: (view: View) => void; onChanged: () => void }) {
  const [jobs, setJobs] = useState<GenerationJob[]>([])
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [errorFilter, setErrorFilter] = useState('all')
  const [busyId, setBusyId] = useState('')

  async function loadJobs() {
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (errorFilter !== 'all') params.set('errorCode', errorFilter)
    const query = params.toString() ? `?${params.toString()}` : ''
    const result = await requestJson<{ jobs: GenerationJob[] }>(`/api/jobs${query}`, token)
    setJobs(result.jobs)
  }

  useEffect(() => {
    loadJobs().catch(() => undefined)
    const timer = window.setInterval(() => loadJobs().catch(() => undefined), 5000)
    return () => window.clearInterval(timer)
  }, [filter, typeFilter, errorFilter, token])

  async function act(job: GenerationJob, action: string) {
    setBusyId(job.id)
    try {
      await requestJson(`/api/jobs/${job.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      await loadJobs()
      onChanged()
    } finally {
      setBusyId('')
    }
  }

  function showFallbackRetry(job: GenerationJob) {
    return job.type === 'generate-podcast' && ['failed', 'canceled'].includes(job.status)
  }

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <h1>任务</h1>
          <p>{jobs.length ? `${jobs.length} 个生成任务` : '生成和重试记录'}</p>
        </div>
        <div className="segmented">
          {[
            ['all', '全部'],
            ['queued', '排队'],
            ['running', '运行'],
            ['failed', '失败'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {[
            ['all', '全部类型'],
            ['generate-unit', '分级阅读'],
            ['generate-podcast', '播客'],
            ['parse-pdf-ocr', 'PDF OCR'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={typeFilter === value ? 'active' : ''} onClick={() => setTypeFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {[
            ['all', '全部失败'],
            ['provider-auth', '配置'],
            ['rate-limit', '限流'],
            ['upstream-temporary', '上游'],
            ['quality-review', '质量'],
            ['ocr-failed', 'OCR'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={errorFilter === value ? 'active' : ''} onClick={() => setErrorFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <ListChecks size={32} />
          <h2>暂无任务</h2>
          <p>批量预生成或单元生成后会显示在这里。</p>
        </div>
      ) : (
        <div className="task-list">
          {jobs.map((job) => (
            <article key={job.id} className="task-card">
              <div className="task-card-head">
                <div>
                  <span className={`status-pill ${job.status}`}>{jobStatusLabel(job.status)}</span>
                  <h2>{job.unitTitle || job.podcastTitle || jobTypeLabel(job.type)}</h2>
                  <p>{job.bookTitle || '阅读材料'} · {job.message || job.status}</p>
                </div>
                <div className="task-meta">
                  <span>{jobTypeLabel(job.type)}</span>
                  {job.provider && <span>{job.provider}</span>}
                  {Boolean(job.totalPages) && <span>页数 {job.processedPages || 0}/{job.totalPages}</span>}
                  {job.createdAt && <span>{formatDateTime(job.createdAt)}</span>}
                  {Number(job.retryCount || 0) > 0 && <span>已重试 {job.retryCount} 次</span>}
                </div>
              </div>
              <div className="progress-line">
                <span style={{ width: `${job.progress || 0}%` }} />
              </div>
              {(job.errorHint || job.errorStage || job.errorCode) && (
                <div className={job.status === 'canceled' ? 'task-diagnosis muted' : 'task-diagnosis'}>
                  <strong>{job.errorStage || '任务诊断'}</strong>
                  {job.errorHint && <p>{job.errorHint}</p>}
                  <div className="task-diagnosis-meta">
                    {job.errorCode && <span>代码：{job.errorCode}</span>}
                    {job.statusCode && <span>上游状态：{job.statusCode}</span>}
                    {job.retryable === false && <span>需要先处理配置或材料</span>}
                  </div>
                </div>
              )}
              {(job.nextActionLabel || job.nextActionDetail || job.autoRetryAt) && (
                <div className="task-next-action">
                  <strong>{job.nextActionLabel || '下一步'}</strong>
                  {job.nextActionDetail && <p>{job.nextActionDetail}</p>}
                  {job.autoRetryAt && (
                    <p>
                      自动重试：{formatDateTime(job.autoRetryAt)}
                      {job.autoRetryReason ? ` · ${job.autoRetryReason}` : ''}
                    </p>
                  )}
                </div>
              )}
              {job.usageSummary && (
                <div className={job.usageSummary.estimated ? 'task-usage estimated' : 'task-usage'}>
                  <strong>{job.usageSummary.label}</strong>
                  <p>{job.usageSummary.detail}</p>
                </div>
              )}
              {job.lastError && (
                <div className="task-last-error">
                  <strong>上次失败</strong>
                  <span>{job.lastErrorStage || job.lastErrorCode || '失败记录'}</span>
                </div>
              )}
              {job.error && (
                <details className="task-error-details">
                  <summary>查看原始错误</summary>
                  <p>{job.error}</p>
                </details>
              )}
              <div className="unit-actions">
                {job.status === 'queued' && (
                  <button type="button" disabled={busyId === job.id} onClick={() => act(job, 'pause')}>
                    <Pause size={16} />
                    暂停
                  </button>
                )}
                {job.status === 'paused' && (
                  <button type="button" disabled={busyId === job.id} onClick={() => act(job, 'resume')}>
                    <Play size={16} />
                    恢复
                  </button>
                )}
                {['queued', 'paused', 'running'].includes(job.status) && (
                  <button type="button" disabled={busyId === job.id} onClick={() => act(job, 'cancel')}>
                    <X size={16} />
                    取消
                  </button>
                )}
                {['failed', 'canceled', 'succeeded'].includes(job.status) && (
                  <button
                    type="button"
                    disabled={busyId === job.id || (job.status === 'failed' && job.retryable === false)}
                    title={job.retryable === false ? '需要先处理配置或材料后再重试' : undefined}
                    onClick={() => act(job, 'retry')}
                  >
                    {busyId === job.id ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                    {job.status === 'succeeded' ? '重新生成' : job.retryable === false ? '需先处理' : '重试任务'}
                  </button>
                )}
                {showFallbackRetry(job) && (
                  <button type="button" disabled={busyId === job.id} onClick={() => act(job, 'retry-fallback')}>
                    {busyId === job.id ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                    用备用源重试
                  </button>
                )}
                {isAdmin && ['provider-auth', 'rate-limit', 'upstream-temporary'].includes(job.errorCode || '') && (
                  <button type="button" onClick={() => onNavigate('services')}>
                    <Server size={16} />
                    查看服务状态
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ServicesView({ token, onError }: { token: string; onError: (message: string) => void }) {
  const [payload, setPayload] = useState<AiServicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  async function loadServices() {
    const result = await requestJson<AiServicesPayload>('/api/ai/services', token)
    setPayload(result)
  }

  useEffect(() => {
    setLoading(true)
    loadServices()
      .catch((err) => onError(err instanceof Error ? err.message : '服务状态加载失败'))
      .finally(() => setLoading(false))
  }, [token])

  async function testService(service: AiService) {
    setBusyId(service.id)
    try {
      const result = await requestJson<AiServicesPayload & { check: AiServiceCheck }>(`/api/ai/services/${service.id}/test`, token, {
        method: 'POST',
      })
      setPayload(result)
    } catch (err) {
      onError(err instanceof Error ? err.message : '服务测试失败')
    } finally {
      setBusyId('')
    }
  }

  const services = payload?.services || []

  return (
    <section className="page-section services-section">
      <div className="section-head">
        <div>
          <h1>AI 服务</h1>
          <p>主来源、兜底来源和最近检查结果，不显示任何密钥。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadServices().catch(() => undefined)} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
          刷新
        </button>
      </div>

      {payload && (
        <div className="stat-row service-overview">
          <Stat label="已配置服务" value={`${payload.overview.configured}/${payload.overview.total}`} />
          <Stat label="健康/待测" value={String(payload.overview.healthy)} />
          <Stat label="主源冷却" value={String(payload.overview.activeCooldowns)} />
          <Stat label="测试额度" value={`${payload.overview.serviceTestLimit}/${payload.overview.serviceTestWindowMinutes} 分钟`} />
        </div>
      )}

      {loading && !payload ? (
        <div className="empty-state">
          <Loader2 className="spin" size={32} />
          <h2>正在读取服务状态</h2>
          <p>只读取安全的配置摘要。</p>
        </div>
      ) : (
        <div className="service-grid">
          {services.map((service) => {
            const Icon = aiServiceIcon(service)
            const testing = busyId === service.id
            return (
              <article key={service.id} className={`service-card ${service.status}`}>
                <div className="service-card-head">
                  <div className="service-title">
                    <span className="service-icon">
                      <Icon size={20} />
                    </span>
                    <div>
                      <h2>{service.title}</h2>
                      <p>{service.role}</p>
                    </div>
                  </div>
                  <span className={`status-pill ${aiServiceStatusClass(service.status)}`}>{aiServiceStatusLabel(service.status)}</span>
                </div>

                <div className="service-meta">
                  <span>{service.priority}</span>
                  <span>{service.endpointHost || '未配置域名'}</span>
                  <span>{service.model || '未配置模型'}</span>
                </div>

                <div className="service-facts">
                  <StatusItem label="来源" ok={service.configured} value={service.provider || '未配置'} />
                  <StatusItem label="域名" ok={service.configured} value={service.endpointHost || '未配置'} />
                  <StatusItem label="模型" ok={service.configured} value={service.model || '未配置'} />
                </div>

                {service.details.length > 0 && (
                  <div className="service-detail-list">
                    {service.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                )}

                {service.providers && service.providers.length > 0 && (
                  <div className="provider-list">
                    {service.providers.map((provider) => (
                      <div key={`${provider.role}-${provider.label}-${provider.keyId || ''}`}>
                        <strong>{provider.label}</strong>
                        <span>
                          {provider.endpointHost} · {provider.model}
                          {provider.keyId ? ` · key ${provider.keyId}` : ''}
                          {provider.cooldownUntil ? ` · 冷却到 ${formatDateTime(provider.cooldownUntil)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {service.warning && <p className="service-warning">{service.warning}</p>}

                <div className={service.lastCheck?.status === 'failed' ? 'service-check failed' : 'service-check'}>
                  <div>
                    <strong>{service.lastCheck ? (service.lastCheck.status === 'ok' ? '最近测试成功' : '最近测试失败') : '尚未测试'}</strong>
                    <p>
                      {service.lastCheck
                        ? `${formatDateTime(service.lastCheck.checkedAt)} · ${service.lastCheck.latencyMs} ms · ${service.lastCheck.message}`
                        : '点击测试会发起一次轻量检查；TTS 测试会真实生成一小段音频。'}
                    </p>
                  </div>
                  <button type="button" onClick={() => testService(service)} disabled={testing || !service.configured}>
                    {testing ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                    {testing ? '测试中' : '测试'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AdminView({ token, onNavigate, onError }: { token: string; onNavigate: (view: View) => void; onError: (message: string) => void }) {
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadStatus() {
    const result = await requestJson<AdminStatus>('/api/admin/status', token)
    setStatus(result)
  }

  useEffect(() => {
    setLoading(true)
    loadStatus()
      .catch((err) => onError(err instanceof Error ? err.message : '后台状态加载失败'))
      .finally(() => setLoading(false))
  }, [token])

  const taskStatusItems = status ? Object.entries(status.tasks.byStatus) : []
  const failedCodeItems = status ? Object.entries(status.tasks.failedByCode) : []
  const adminWarnings = status?.warnings || []

  return (
    <section className="page-section admin-section">
      <div className="section-head">
        <div>
          <h1>管理后台</h1>
          <p>{status ? `更新于 ${formatDateTime(status.updatedAt)}` : '任务、服务、备份和存储概览'}</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadStatus().catch(() => undefined)} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
          刷新
        </button>
      </div>

      {loading && !status ? (
        <div className="empty-state">
          <Loader2 className="spin" size={32} />
          <h2>正在读取后台状态</h2>
          <p>正在汇总服务器运行数据。</p>
        </div>
      ) : status ? (
        <>
          {adminWarnings.length > 0 && (
            <div className="admin-warning-list">
              {adminWarnings.map((warning, index) => (
                <div key={`${warning.scope}-${index}`} className={warning.level === 'critical' ? 'critical' : ''}>
                  <strong>{warning.message}</strong>
                  {warning.detail && <span>{warning.detail}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="admin-grid">
            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="eyebrow">Tasks</span>
                  <h2>任务中心</h2>
                </div>
                <button type="button" onClick={() => onNavigate('tasks')}>打开任务</button>
              </div>
              <div className="stat-row compact">
                <Stat label="总任务" value={String(status.tasks.total)} />
                <Stat label="运行中" value={String(status.tasks.active)} />
                <Stat label="失败" value={String(status.tasks.failed)} />
              </div>
              <div className="admin-chips">
                {taskStatusItems.map(([key, value]) => <span key={key}>{jobStatusLabel(key)} {value}</span>)}
                {failedCodeItems.map(([key, value]) => <span key={key}>{errorCodeLabel(key)} {value}</span>)}
              </div>
              <div className="admin-list">
                {status.tasks.recent.slice(0, 4).map((job) => (
                  <div key={job.id}>
                    <strong>{job.unitTitle || job.podcastTitle || jobTypeLabel(job.type)}</strong>
                    <span>{jobTypeLabel(job.type)} · {jobStatusLabel(job.status)} · {job.message || job.error || '无消息'}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="eyebrow">Backup</span>
                  <h2>备份状态</h2>
                </div>
              </div>
              <div className="deployment-grid admin-status-grid">
                <StatusItem label="备份数量" ok={status.backup.backupCount > 0} value={`${status.backup.backupCount} 个`} />
                <StatusItem
                  label="最近备份"
                  ok={Boolean(status.backup.latestBackup)}
                  value={status.backup.latestBackup ? `${formatDateTime(status.backup.latestBackup.modifiedAt)} · ${formatBytes(status.backup.latestBackup.size)}` : '未检测到'}
                />
                <StatusItem
                  label="恢复演练"
                  ok={Boolean(status.backup.latestDrill?.ok)}
                  value={status.backup.latestDrill ? (status.backup.latestDrill.ok ? `${status.backup.latestDrill.recordCount || 0} 条` : '最近失败') : '未执行'}
                />
              </div>
            </article>

            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="eyebrow">AI Services</span>
                  <h2>AI 服务状态</h2>
                </div>
                <button type="button" onClick={() => onNavigate('services')}>打开服务</button>
              </div>
              <div className="stat-row compact">
                <Stat label="已配置" value={`${status.services.overview.configured}/${status.services.overview.total}`} />
                <Stat label="健康/待测" value={String(status.services.overview.healthy)} />
                <Stat label="冷却" value={String(status.services.overview.activeCooldowns)} />
              </div>
              <div className="admin-list">
                {status.services.items.map((service) => (
                  <div key={service.id}>
                    <strong>{service.title}</strong>
                    <span>{aiServiceStatusLabel(service.status)} · {service.endpointHost || '未配置'} · {service.model || '未配置模型'}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="eyebrow">AI Usage</span>
                  <h2>AI 用量估算</h2>
                </div>
              </div>
              <div className="stat-row compact">
                <Stat label="今日调用" value={String(status.aiUsage.today.calls)} />
                <Stat label="今日失败" value={String(status.aiUsage.today.failed)} />
                <Stat label="7 天调用" value={String(status.aiUsage.sevenDays.calls)} />
              </div>
              <div className="usage-grid">
                <div>
                  <span>30 天输入</span>
                  <strong>{formatTokenCount(status.aiUsage.thirtyDays.inputTokens)} tokens</strong>
                </div>
                <div>
                  <span>30 天输出</span>
                  <strong>{formatTokenCount(status.aiUsage.thirtyDays.outputTokens)} tokens</strong>
                </div>
                <div>
                  <span>TTS 音频</span>
                  <strong>{formatDuration(status.aiUsage.thirtyDays.audioSeconds)}</strong>
                </div>
                <div>
                  <span>OCR 页数</span>
                  <strong>{formatNumber(status.aiUsage.thirtyDays.pages)}</strong>
                </div>
              </div>
              <div className="admin-list compact-list">
                {status.aiUsage.byAction.slice(0, 4).map((item) => (
                  <div key={item.key}>
                    <strong>{aiUsageActionLabel(item.key)}</strong>
                    <span>{item.calls} 次 · 失败 {item.failed} · {formatTokenCount(item.inputTokens + item.outputTokens)} tokens</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="eyebrow">Storage</span>
                  <h2>存储占用</h2>
                </div>
                <strong>{formatBytes(status.storage.totalBytes)}</strong>
              </div>
              <div className="storage-list">
                {status.storage.items.map((item) => (
                  <div key={item.key}>
                    <span>{item.label}</span>
                    <strong>{formatBytes(item.bytes) || '0 KB'}</strong>
                    <small>{item.files} 个文件{item.truncated ? '，已截断统计' : ''}</small>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <article className="admin-panel error-log-panel">
            <div className="admin-panel-head">
              <div>
                <span className="eyebrow">Errors</span>
                <h2>最近错误日志</h2>
              </div>
            </div>
            {status.recentErrors.length ? (
              <div className="error-log-list">
                {status.recentErrors.map((item) => (
                  <div key={item.id}>
                    <span className={`status-pill ${item.level === 'error' ? 'failed' : 'queued'}`}>{item.scope}</span>
                    <strong>{item.message}</strong>
                    <p>{formatDateTime(item.createdAt)}{item.errorCode ? ` · ${errorCodeLabel(item.errorCode)}` : ''}{item.statusCode ? ` · ${item.statusCode}` : ''}</p>
                    {item.detail && <p>{item.detail}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty">
                <Check size={28} />
                <h2>暂无错误</h2>
                <p>任务失败或服务器异常会记录在这里。</p>
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  )
}

function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队',
    running: '运行',
    paused: '暂停',
    failed: '失败',
    canceled: '取消',
    succeeded: '完成',
  }
  return labels[status] || status
}

function jobTypeLabel(type: string) {
  const labels: Record<string, string> = {
    'generate-unit': '分级阅读',
    'generate-podcast': '播客',
    'parse-pdf-ocr': 'PDF OCR',
  }
  return labels[type] || type
}

function errorCodeLabel(code: string) {
  const labels: Record<string, string> = {
    'provider-auth': '配置问题',
    'rate-limit': '限流/额度',
    'upstream-temporary': '上游临时错误',
    'ocr-failed': 'OCR 失败',
    'quality-review': '质量复核',
    'bad-request': '请求被拒绝',
    'missing-resource': '资源缺失',
    'server-error': '服务器错误',
    unknown: '未知错误',
  }
  return labels[code] || code
}

function VocabularyView({
  vocabulary,
  token,
  onReviewed,
}: {
  vocabulary: VocabularyItem[]
  token: string
  onReviewed: () => void
}) {
  const [query, setQuery] = useState('')
  const [reviewingId, setReviewingId] = useState('')
  const [mode, setMode] = useState<'due' | 'all'>('due')
  const [masteryFilter, setMasteryFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const now = Date.now()
  const due = vocabulary.filter((item) => !item.dueAt || Date.parse(item.dueAt) <= now)
  const source = mode === 'due' ? due : vocabulary
  const filtered = source
    .filter((item) => item.term.toLowerCase().includes(query.toLowerCase()))
    .filter((item) => {
      if (masteryFilter === 'mastered') return Number(item.mastery || 0) >= 4
      if (masteryFilter === 'learning') return Number(item.mastery || 0) < 4
      return true
    })

  async function review(item: VocabularyItem, result: 'known' | 'again') {
    if (!item.id) return
    setReviewingId(item.id)
    try {
      await requestJson(`/api/vocabulary/${item.id}/review`, token, {
        method: 'PATCH',
        body: JSON.stringify({ result }),
      })
      onReviewed()
    } finally {
      setReviewingId('')
    }
  }

  function speak(term: string) {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(term)
    utterance.lang = 'en-US'
    utterance.rate = 1
    window.speechSynthesis.speak(utterance)
  }

  async function exportVocabulary() {
    const response = await sessionFetch('/api/vocabulary/export', token)
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'linguashelf-vocabulary.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <h1>生词本</h1>
          <p>{vocabulary.length ? `${vocabulary.length} 个词 · ${due.length} 个到期` : '学习时自动保存'}</p>
        </div>
        <div className="toolbar-inline">
          <div className="segmented">
            <button type="button" className={mode === 'due' ? 'active' : ''} onClick={() => setMode('due')}>
              今日复习
            </button>
            <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
              全部
            </button>
          </div>
          <div className="segmented">
            <button type="button" className={masteryFilter === 'all' ? 'active' : ''} onClick={() => setMasteryFilter('all')}>
              所有掌握度
            </button>
            <button type="button" className={masteryFilter === 'learning' ? 'active' : ''} onClick={() => setMasteryFilter('learning')}>
              学习中
            </button>
            <button type="button" className={masteryFilter === 'mastered' ? 'active' : ''} onClick={() => setMasteryFilter('mastered')}>
              已掌握
            </button>
          </div>
          <input className="search-input" placeholder="搜索单词" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="ghost-button" type="button" onClick={exportVocabulary}>
            <Download size={18} />
            导出
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <BookMarked size={32} />
          <h2>暂无生词</h2>
          <p>点击阅读里的单词或完成练习后会保存。</p>
        </div>
      ) : (
        <div className="vocab-grid">
          {filtered.map((item) => (
            <article key={`${item.term}-${item.id || item.sourceBookTitle}`} className="vocab-card">
              <div>
                <h2>
                  {item.term}
                  <button className="icon-button" type="button" onClick={() => speak(item.term)} aria-label="发音">
                    <Volume2 size={16} />
                  </button>
                </h2>
                <p>{item.meaningZh}</p>
              </div>
              <p>{item.simpleEnglish}</p>
              {item.exampleSentence && <p className="example-sentence">{item.exampleSentence}</p>}
              <span>
                {item.sourceBookTitle || '阅读材料'} · {item.seenCount || 1} 次 · 掌握度 {item.mastery || 0}/5
              </span>
              <div className="review-actions">
                <button type="button" onClick={() => review(item, 'again')} disabled={reviewingId === item.id}>
                  再复习
                </button>
                <button type="button" onClick={() => review(item, 'known')} disabled={reviewingId === item.id}>
                  {reviewingId === item.id ? <Loader2 className="spin" size={16} /> : <Brain size={16} />}
                  认识
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function SettingsView({
  settings,
  token,
  onSaved,
  onError,
}: {
  settings: UserSettings
  token: string
  onSaved: (settings: UserSettings) => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', nextPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    requestJson<SecurityStatus>('/api/security/status', token)
      .then(setSecurity)
      .catch(() => undefined)
  }, [token])

  async function save() {
    setSaving(true)
    try {
      const result = await requestJson<{ settings: UserSettings }>('/api/settings', token, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      })
      onSaved(result.settings)
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setChangingPassword(true)
    try {
      await requestJson('/api/account/password', token, {
        method: 'PATCH',
        body: JSON.stringify(passwordDraft),
      })
      setPasswordDraft({ currentPassword: '', nextPassword: '' })
      setPasswordMessage('密码已更新')
    } catch (err) {
      onError(err instanceof Error ? err.message : '密码修改失败')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <section className="page-section settings-section">
      <div className="section-head">
        <div>
          <h1>设置</h1>
          <p>阅读和听力分开调节</p>
        </div>
        <button className="primary-button" type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          保存
        </button>
      </div>

      <SettingGroup title="阅读难度">
        <Segmented
          options={readingLevelOptions}
          value={draft.readingLevel}
          onChange={(readingLevel) => setDraft({ ...draft, readingLevel })}
        />
      </SettingGroup>

      <SettingGroup title="听力难度">
        <Segmented
          options={listeningLevelOptions}
          value={draft.listeningLevel}
          onChange={(listeningLevel) => setDraft({ ...draft, listeningLevel })}
        />
      </SettingGroup>

      <SettingGroup title="播客难度">
        <Segmented
          options={podcastLexileOptions}
          value={String(draft.podcastLexile || 900)}
          onChange={(podcastLexile) => setDraft({ ...draft, podcastLexile: Number(podcastLexile) })}
        />
      </SettingGroup>

      <SettingGroup title="播客音色">
        <Segmented
          options={['Kore', 'Puck', 'Charon', 'Aoede']}
          value={draft.podcastVoice || 'Kore'}
          onChange={(podcastVoice) => setDraft({ ...draft, podcastVoice })}
        />
      </SettingGroup>

      <SettingGroup title="学习时长">
        <div className="stepper">
          <button type="button" onClick={() => setDraft({ ...draft, studyMinutes: Math.max(5, draft.studyMinutes - 5) })}>
            -
          </button>
          <span>{draft.studyMinutes} 分钟</span>
          <button type="button" onClick={() => setDraft({ ...draft, studyMinutes: Math.min(30, draft.studyMinutes + 5) })}>
            +
          </button>
        </div>
      </SettingGroup>

      <SettingGroup title="每日轻练类型">
        <OptionSegment
          options={microPracticeTypeOptions}
          value={draft.microPracticeType || 'random'}
          onChange={(microPracticeType) => setDraft({ ...draft, microPracticeType })}
          ariaLabel="默认轻练类型"
        />
      </SettingGroup>

      <SettingGroup title="每日轻练主题">
        <div className="setting-stack">
          <OptionSegment
            options={microPracticeTopicOptions}
            value={draft.microPracticeTopic || 'book'}
            onChange={(microPracticeTopic) => setDraft({ ...draft, microPracticeTopic })}
            ariaLabel="默认轻练主题"
          />
          {(draft.microPracticeTopic || 'book') === 'custom' && (
            <input
              className="search-input"
              value={draft.microPracticeCustomTopic || ''}
              onChange={(event) => setDraft({ ...draft, microPracticeCustomTopic: event.target.value })}
              placeholder="自定义主题"
            />
          )}
        </div>
      </SettingGroup>

      <SettingGroup title="每日轻练难度">
        <Segmented
          options={microDifficultyOptions}
          value={draft.microPracticeDifficulty || draft.readingLevel}
          onChange={(microPracticeDifficulty) => setDraft({ ...draft, microPracticeDifficulty })}
          ariaLabel="默认轻练难度"
        />
      </SettingGroup>

      <SettingGroup title="轻练目标">
        <div className="target-steppers">
          <div className="stepper">
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeDailyGoal: Math.max(0, (draft.microPracticeDailyGoal ?? 1) - 1) })}>
              -
            </button>
            <span>日 {draft.microPracticeDailyGoal ?? 1} 次</span>
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeDailyGoal: Math.min(10, (draft.microPracticeDailyGoal ?? 1) + 1) })}>
              +
            </button>
          </div>
          <div className="stepper">
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeMonthlyGoal: Math.max(0, (draft.microPracticeMonthlyGoal ?? 30) - 5) })}>
              -
            </button>
            <span>月 {draft.microPracticeMonthlyGoal ?? 30} 次</span>
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeMonthlyGoal: Math.min(300, (draft.microPracticeMonthlyGoal ?? 30) + 5) })}>
              +
            </button>
          </div>
        </div>
      </SettingGroup>

      <SettingGroup title="自动难度调整">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.aiSuggestions}
            onChange={(event) => setDraft({ ...draft, aiSuggestions: event.target.checked })}
          />
          <span>开启</span>
        </label>
      </SettingGroup>

      <SettingGroup title="专注学习模式">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.focusStudyMode !== false}
            onChange={(event) => setDraft({ ...draft, focusStudyMode: event.target.checked })}
          />
          <span>默认隐藏审稿信息</span>
        </label>
      </SettingGroup>

      <SettingGroup title="原书文件保留">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.keepSourceFiles}
            onChange={(event) => setDraft({ ...draft, keepSourceFiles: event.target.checked })}
          />
          <span>保留</span>
        </label>
      </SettingGroup>

      <article className="setting-row password-row">
        <div>
          <h2>修改密码</h2>
          <p>{passwordMessage || '更新后其他设备需要重新登录。'}</p>
        </div>
        <div className="password-form">
          <input
            type="password"
            placeholder="当前密码"
            value={passwordDraft.currentPassword}
            onChange={(event) => setPasswordDraft({ ...passwordDraft, currentPassword: event.target.value })}
          />
          <input
            type="password"
            placeholder="新密码，至少 8 位"
            value={passwordDraft.nextPassword}
            onChange={(event) => setPasswordDraft({ ...passwordDraft, nextPassword: event.target.value })}
          />
          <button className="ghost-button" type="button" onClick={changePassword} disabled={changingPassword}>
            {changingPassword ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            更新
          </button>
        </div>
      </article>

      {security && (
        <article className="setting-row deployment-row">
          <div>
            <h2>部署检查</h2>
            <p>{security.deployment.nodeEnv} · {security.deployment.storageDriver}</p>
          </div>
          <div className="deployment-grid">
            <StatusItem label="开放注册" ok={!security.security.allowSignup} value={security.security.allowSignup ? '开启' : '关闭'} />
            <StatusItem label="邀请码" ok={security.security.inviteRequired || !security.security.allowSignup} value={security.security.inviteRequired ? '需要' : '未配置'} />
            <StatusItem label="AI 文本" ok={security.deployment.aiConfigured} value={security.deployment.aiConfigured ? '已配置' : '未配置'} />
            <StatusItem label="TTS" ok={security.deployment.ttsConfigured} value={security.deployment.ttsConfigured ? security.deployment.ttsProvider : '未配置'} />
            <StatusItem
              label="播客 TTS"
              ok={security.deployment.podcastTtsConfigured}
              value={security.deployment.podcastTtsConfigured ? security.deployment.podcastTtsPrimary || 'Gemini' : '未配置'}
            />
            <StatusItem
              label="TTS 分块"
              ok
              value={`${formatNumber(security.deployment.podcastTtsChunkChars || 0)} 字 / ${formatNumber(security.deployment.podcastTtsChunkTokens || 0)} tokens`}
            />
            <StatusItem
              label="TTS 限制"
              ok
              value={`${formatNumber(security.deployment.podcastTtsInputTokenLimit || 0)} in / ${formatNumber(security.deployment.podcastTtsOutputTokenLimit || 0)} out`}
            />
            <StatusItem
              label="PDF OCR"
              ok={security.deployment.pdfOcrEnabled}
              value={
                security.deployment.pdfOcrEnabled
                  ? security.deployment.pdfOcrVisionConfigured
                    ? `Hunyuan 优先/${security.deployment.pdfOcrVisionDpi}dpi`
                    : `本地 ${security.deployment.pdfOcrLanguage}/${security.deployment.pdfOcrDpi}dpi`
                  : '关闭'
              }
            />
            <StatusItem label="会话" ok value={`${security.security.sessionDays} 天`} />
            <StatusItem label="任务" ok value={`${security.deployment.activeJobs} 个运行中`} />
            <StatusItem
              label="最近备份"
              ok={Boolean(security.deployment.backup.latestBackup)}
              value={
                security.deployment.backup.latestBackup
                  ? `${formatDateTime(security.deployment.backup.latestBackup.modifiedAt)} · ${formatBytes(security.deployment.backup.latestBackup.size)}`
                  : '未检测到'
              }
            />
            <StatusItem
              label="恢复演练"
              ok={Boolean(security.deployment.backup.latestDrill?.ok)}
              value={
                security.deployment.backup.latestDrill
                  ? security.deployment.backup.latestDrill.ok
                    ? `${formatDateTime(security.deployment.backup.latestDrill.modifiedAt)} · ${security.deployment.backup.latestDrill.recordCount || 0} 条`
                    : '最近失败'
                  : '未执行'
              }
            />
          </div>
        </article>
      )}
    </section>
  )
}

function StatusItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className={ok ? 'status-item ok' : 'status-item'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="setting-row">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  )
}

function Segmented({ options, value, onChange, ariaLabel }: { options: string[]; value: string; onChange: (value: string) => void; ariaLabel?: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Home; label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function SmallEmpty({ icon: Icon, text }: { icon: typeof Home; text: string }) {
  return (
    <div className="small-empty">
      <Icon size={24} />
      <p>{text}</p>
    </div>
  )
}
