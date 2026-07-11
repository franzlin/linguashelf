import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Diff,
  Headphones,
  ListChecks,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Segmented } from '../components/ui/Controls'
import { Stat } from '../components/ui/Metrics'
import { requestJson, sessionFetch } from '../lib/api'
import { formatPercent } from '../lib/format'
import type { Concept, Report, Unit, UnitProgress, UserSettings, VocabularyItem } from '../types/domain'

type SelectedAid =
  | { kind: 'word'; word: string; detail?: VocabularyItem }
  | { kind: 'sentence'; sentence: string; summary: string }
  | { kind: 'concept'; concept: Concept }
  | null

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

export function StudyPage({
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
    releaseListeningAudio()
    setSpeaking(false)
  }, [unit.id, unit.generatedAt])

  useEffect(() => {
    if (!content || currentParagraph <= 0) return
    window.setTimeout(() => {
      document.querySelector(`[data-paragraph-index="${currentParagraph}"]`)?.scrollIntoView({ block: 'center' })
    }, 80)
  }, [content, currentParagraph])

  useEffect(() => {
    return () => {
      releaseListeningAudio()
      if ('mediaSession' in navigator) {
        for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
          navigator.mediaSession.setActionHandler(action, null)
        }
      }
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

  function releaseListeningAudio() {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = ''
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
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
