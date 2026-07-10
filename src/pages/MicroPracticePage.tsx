import { useEffect, useRef, useState } from 'react'
import { Activity, BookOpen, Brain, Check, Headphones, Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import { OptionSegment, Segmented } from '../components/ui/Controls'
import { SmallEmpty, Stat } from '../components/ui/Metrics'
import { microDifficultyOptions, microPracticeTopicOptions, microPracticeTypeOptions } from '../config/learning'
import { requestJson, sessionFetch } from '../lib/api'
import { formatDateTime, formatPercent } from '../lib/format'
import type { View } from '../navigation'
import type { AppData, Book, MicroAttempt, MicroPractice, MicroPracticeTopic, MicroPracticeType, UserSettings } from '../types/domain'

export function MicroPracticePage({
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
