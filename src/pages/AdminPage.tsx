import { useEffect, useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { StatusItem } from '../components/ui/Controls'
import { Stat } from '../components/ui/Metrics'
import { requestJson } from '../lib/api'
import { aiUsageActionLabel, formatBytes, formatDateTime, formatDuration, formatNumber, formatTokenCount } from '../lib/format'
import { errorCodeLabel, jobStatusLabel, jobTypeLabel } from '../lib/job-labels'
import { aiServiceStatusLabel } from '../lib/service-presentation'
import type { View } from '../navigation'
import type { AdminStatus } from '../types/admin'

export function AdminPage({ token, onNavigate, onError }: { token: string; onNavigate: (view: View) => void; onError: (message: string) => void }) {
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
