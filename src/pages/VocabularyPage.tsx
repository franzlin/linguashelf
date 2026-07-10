import { useState } from 'react'
import { BookMarked, Brain, Download, Loader2, Volume2 } from 'lucide-react'
import { requestJson, sessionFetch } from '../lib/api'
import type { VocabularyItem } from '../types/domain'

export function VocabularyPage({
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
