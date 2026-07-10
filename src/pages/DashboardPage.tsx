import { Activity, BarChart3, BookMarked, Brain, Check, Clock, Flame, TrendingUp } from 'lucide-react'
import { MetricCard, SmallEmpty, Stat } from '../components/ui/Metrics'
import { listeningLevelOptions, readingLevelOptions } from '../config/learning'
import { formatDecimal, formatNumber, formatPercent, levelPercent, shortDate } from '../lib/format'
import type { View } from '../navigation'
import type { AppData } from '../types/domain'

export function DashboardPage({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
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
