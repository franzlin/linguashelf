import { BarChart3, Check } from 'lucide-react'
import { Stat } from '../components/ui/Metrics'
import { readingLevelOptions } from '../config/learning'
import { requestJson } from '../lib/api'
import { formatPercent } from '../lib/format'
import type { AppData, Report, UserSettings } from '../types/domain'

export function ReportsPage({
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
