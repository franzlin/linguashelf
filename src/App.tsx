import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Brain,
  Check,
  Clock,
  Download,
  FileText,
  Flame,
  Headphones,
  ListChecks,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Server,
  TrendingUp,
  User,
  Volume2,
  X,
} from 'lucide-react'
import { AppShell } from './components/AppShell'
import { OptionSegment, Segmented, SettingGroup, StatusItem } from './components/ui/Controls'
import { MetricCard, SmallEmpty, Stat } from './components/ui/Metrics'
import { listeningLevelOptions, readingLevelOptions } from './config/learning'
import { ApiError, cookieSessionToken, requestJson, sessionFetch } from './lib/api'
import { abortableDelay } from './lib/async'
import {
  aiUsageActionLabel,
  formatBytes,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTokenCount,
  levelPercent,
  shortDate,
} from './lib/format'
import type { View } from './navigation'
import { BookPage } from './pages/BookPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { StudyPage } from './pages/StudyPage'
import type {
  AppData,
  Book,
  GenerationJob,
  MicroAttempt,
  MicroPractice,
  MicroPracticeTopic,
  MicroPracticeType,
  Report,
  Unit,
  UserSettings,
  VocabularyItem,
} from './types/domain'

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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

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
function isAndroidBrowser() {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

const tokenKey = 'linguashelf-token'

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
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem(tokenKey)
        setToken('')
        setData(null)
        setError('')
      } else {
        setError(err instanceof Error ? err.message : '加载失败')
      }
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
    setError('')
  }

  if (!token) {
    return (
      <LoginScreen
        onLogin={(nextData) => {
          localStorage.removeItem(tokenKey)
          setToken(cookieSessionToken)
          setData(nextData)
          setView('home')
          setError('')
        }}
      />
    )
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (!data) {
    return <LoadingScreen error={error} onRetry={() => refresh()} />
  }

  return (
    <AppShell
      user={data.user}
      isAdmin={Boolean(isAdmin)}
      view={view}
      installAvailable={Boolean(installPrompt)}
      installLabel={isAndroidBrowser() ? '安装到手机' : '安装'}
      onNavigate={setView}
      onInstall={installApp}
      onLogout={logout}
    >
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
          <HomePage
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
          <LibraryPage
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
          <BookPage
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
          <StudyPage
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
    </AppShell>
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

function LoadingScreen({ error = '', onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="loading-screen">
      {error ? (
        <div className="loading-error">
          <X size={28} />
          <strong>暂时无法打开书架</strong>
          <span>{error}</span>
          {onRetry && (
            <button className="primary-button" type="button" onClick={onRetry}>
              <RotateCcw size={17} />
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          <Loader2 className="spin" size={28} />
          <span>正在打开书架</span>
        </>
      )}
    </main>
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
