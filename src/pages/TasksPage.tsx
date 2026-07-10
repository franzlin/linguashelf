import { useEffect, useState } from 'react'
import { ListChecks, Loader2, Pause, Play, RotateCcw, Server, X } from 'lucide-react'
import { requestJson } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { jobStatusLabel, jobTypeLabel } from '../lib/job-labels'
import type { View } from '../navigation'
import type { GenerationJob } from '../types/domain'

export function TasksPage({ token, isAdmin, onNavigate, onChanged }: { token: string; isAdmin: boolean; onNavigate: (view: View) => void; onChanged: () => void }) {
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
