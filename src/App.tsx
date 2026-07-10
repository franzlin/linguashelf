import { useEffect, useRef, useState } from 'react'
import {
  X,
} from 'lucide-react'
import { LoadingScreen, LoginScreen } from './components/AuthScreens'
import { AppShell } from './components/AppShell'
import { ApiError, cookieSessionToken, requestJson } from './lib/api'
import { abortableDelay } from './lib/async'
import type { View } from './navigation'
import { BookPage } from './pages/BookPage'
import { AdminPage } from './pages/AdminPage'
import { DashboardPage } from './pages/DashboardPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { MicroPracticePage } from './pages/MicroPracticePage'
import { ReportsPage } from './pages/ReportsPage'
import { ServicesPage } from './pages/ServicesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StudyPage } from './pages/StudyPage'
import { TasksPage } from './pages/TasksPage'
import { VocabularyPage } from './pages/VocabularyPage'
import type {
  AppData,
  Book,
  GenerationJob,
  Report,
  Unit,
} from './types/domain'


type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isAndroidBrowser() {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

const tokenKey = 'linguashelf-token'


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
          <DashboardPage
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
          <MicroPracticePage
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
          <ReportsPage
            reports={latestReport ? [latestReport, ...data.reports.filter((item) => item.id !== latestReport.id)] : data.reports}
            settings={data.settings}
            stats={data.stats}
            token={token}
            onSettingsUpdated={(settings) => setData({ ...data, settings })}
          />
        )}

        {view === 'vocabulary' && (
          <VocabularyPage
            vocabulary={data.vocabulary}
            token={token}
            onReviewed={() => refresh()}
          />
        )}

        {view === 'tasks' && (
          <TasksPage
            token={token}
            isAdmin={isAdmin}
            onNavigate={setView}
            onChanged={() => refresh()}
          />
        )}

        {view === 'services' && isAdmin && (
          <ServicesPage
            token={token}
            onError={setError}
          />
        )}

        {view === 'admin' && isAdmin && (
          <AdminPage
            token={token}
            onNavigate={setView}
            onError={setError}
          />
        )}

        {view === 'settings' && (
          <SettingsPage
            settings={data.settings}
            token={token}
            onSaved={(settings) => setData({ ...data, settings })}
            onError={setError}
          />
        )}
    </AppShell>
  )
}
