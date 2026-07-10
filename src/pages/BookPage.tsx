import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Brain,
  Building2,
  Check,
  Download,
  FileText,
  Headphones,
  ListChecks,
  Loader2,
  MapPin,
  Pencil,
  Play,
  RotateCcw,
  Tags,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Segmented } from '../components/ui/Controls'
import { Stat } from '../components/ui/Metrics'
import { listeningLevelOptions, readingLevelOptions } from '../config/learning'
import { requestJson, sessionFetch } from '../lib/api'
import { delay } from '../lib/async'
import { formatBytes, formatDuration, formatNumber } from '../lib/format'
import type { Book, BookGlossaryItem, GenerationJob, Podcast, PodcastKind, Unit, UserSettings } from '../types/domain'

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

function glossaryIcon(category: BookGlossaryItem['category']) {
  if (category === 'person') return User
  if (category === 'place') return MapPin
  if (category === 'institution') return Building2
  if (category === 'concept') return Brain
  return Tags
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

export function BookPage({
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
