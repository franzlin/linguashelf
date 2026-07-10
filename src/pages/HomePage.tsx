import { BookOpen, FileText, Loader2, Upload } from 'lucide-react'
import { Stat } from '../components/ui/Metrics'
import { formatPercent } from '../lib/format'
import type { AppData, Book, Unit } from '../App'
import type { View } from '../navigation'

type HomePageProps = {
  data: AppData
  onOpenUnit: (unit: Unit) => void
  onOpenBook: (book: Book) => void
  onNavigate: (view: View) => void
}

export function HomePage({ data, onOpenUnit, onOpenBook, onNavigate }: HomePageProps) {
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
              <h2>今日 {data.stats.todayMicroPractices || 0}/{data.stats.microDailyGoal ?? 1} 次</h2>
              <p>{data.stats.microTodayGoalMet ? '轻练目标已完成。' : '时间紧的时候，做一轮短练习保持手感。'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('micro')}>开始轻练</button>
          </article>
          <article className="insight-card">
            <div>
              <span className="eyebrow">复习计划</span>
              <h2>{reviewPlan?.message || '暂无复习压力'}</h2>
              <p>今日 {reviewPlan?.dueToday || 0} · 明日 {reviewPlan?.dueTomorrow || 0} · 本周 {reviewPlan?.dueThisWeek || 0}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('vocabulary')}>生词本</button>
          </article>
        </div>

        <section className="page-section compact-section">
          <div className="section-head">
            <div>
              <h2>最近书籍</h2>
              <p>{data.home.recentBooks.length ? '从最近处理的书继续' : '上传书籍后显示'}</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate('library')}>书库</button>
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
                    <div className="progress-line"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
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
                  <div className="progress-line"><span style={{ width: `${job.progress || 0}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          {failedJobs.length > 0 && (
            <div className="task-diagnosis muted">
              <strong>最近有 {failedJobs.length} 个失败任务</strong>
              <p>可以进入任务中心查看原因、重试或取消。</p>
              <button className="ghost-button" type="button" onClick={() => onNavigate('tasks')}>打开任务</button>
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
              <span key={item.date} className={(item.units || item.microPractices) ? 'active' : ''} title={`${item.date} · ${item.units} 单元 · ${item.microPractices || 0} 轻练`} />
            ))}
          </div>
        </section>
      </aside>
    </section>
  )
}
