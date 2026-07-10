import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { StatusItem } from '../components/ui/Controls'
import { Stat } from '../components/ui/Metrics'
import { requestJson } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { aiServiceIcon, aiServiceStatusClass, aiServiceStatusLabel } from '../lib/service-presentation'
import type { AiService, AiServiceCheck, AiServicesPayload } from '../types/admin'

export function ServicesPage({ token, onError }: { token: string; onError: (message: string) => void }) {
  const [payload, setPayload] = useState<AiServicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  async function loadServices() {
    const result = await requestJson<AiServicesPayload>('/api/ai/services', token)
    setPayload(result)
  }

  useEffect(() => {
    setLoading(true)
    loadServices()
      .catch((err) => onError(err instanceof Error ? err.message : '服务状态加载失败'))
      .finally(() => setLoading(false))
  }, [token])

  async function testService(service: AiService) {
    setBusyId(service.id)
    try {
      const result = await requestJson<AiServicesPayload & { check: AiServiceCheck }>(`/api/ai/services/${service.id}/test`, token, {
        method: 'POST',
      })
      setPayload(result)
    } catch (err) {
      onError(err instanceof Error ? err.message : '服务测试失败')
    } finally {
      setBusyId('')
    }
  }

  const services = payload?.services || []

  return (
    <section className="page-section services-section">
      <div className="section-head">
        <div>
          <h1>AI 服务</h1>
          <p>主来源、兜底来源和最近检查结果，不显示任何密钥。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadServices().catch(() => undefined)} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
          刷新
        </button>
      </div>

      {payload && (
        <div className="stat-row service-overview">
          <Stat label="已配置服务" value={`${payload.overview.configured}/${payload.overview.total}`} />
          <Stat label="健康/待测" value={String(payload.overview.healthy)} />
          <Stat label="主源冷却" value={String(payload.overview.activeCooldowns)} />
          <Stat label="测试额度" value={`${payload.overview.serviceTestLimit}/${payload.overview.serviceTestWindowMinutes} 分钟`} />
        </div>
      )}

      {loading && !payload ? (
        <div className="empty-state">
          <Loader2 className="spin" size={32} />
          <h2>正在读取服务状态</h2>
          <p>只读取安全的配置摘要。</p>
        </div>
      ) : (
        <div className="service-grid">
          {services.map((service) => {
            const Icon = aiServiceIcon(service)
            const testing = busyId === service.id
            return (
              <article key={service.id} className={`service-card ${service.status}`}>
                <div className="service-card-head">
                  <div className="service-title">
                    <span className="service-icon">
                      <Icon size={20} />
                    </span>
                    <div>
                      <h2>{service.title}</h2>
                      <p>{service.role}</p>
                    </div>
                  </div>
                  <span className={`status-pill ${aiServiceStatusClass(service.status)}`}>{aiServiceStatusLabel(service.status)}</span>
                </div>

                <div className="service-meta">
                  <span>{service.priority}</span>
                  <span>{service.endpointHost || '未配置域名'}</span>
                  <span>{service.model || '未配置模型'}</span>
                </div>

                <div className="service-facts">
                  <StatusItem label="来源" ok={service.configured} value={service.provider || '未配置'} />
                  <StatusItem label="域名" ok={service.configured} value={service.endpointHost || '未配置'} />
                  <StatusItem label="模型" ok={service.configured} value={service.model || '未配置'} />
                </div>

                {service.details.length > 0 && (
                  <div className="service-detail-list">
                    {service.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                )}

                {service.providers && service.providers.length > 0 && (
                  <div className="provider-list">
                    {service.providers.map((provider) => (
                      <div key={`${provider.role}-${provider.label}-${provider.keyId || ''}`}>
                        <strong>{provider.label}</strong>
                        <span>
                          {provider.endpointHost} · {provider.model}
                          {provider.keyId ? ` · key ${provider.keyId}` : ''}
                          {provider.cooldownUntil ? ` · 冷却到 ${formatDateTime(provider.cooldownUntil)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {service.warning && <p className="service-warning">{service.warning}</p>}

                <div className={service.lastCheck?.status === 'failed' ? 'service-check failed' : 'service-check'}>
                  <div>
                    <strong>{service.lastCheck ? (service.lastCheck.status === 'ok' ? '最近测试成功' : '最近测试失败') : '尚未测试'}</strong>
                    <p>
                      {service.lastCheck
                        ? `${formatDateTime(service.lastCheck.checkedAt)} · ${service.lastCheck.latencyMs} ms · ${service.lastCheck.message}`
                        : '点击测试会发起一次轻量检查；TTS 测试会真实生成一小段音频。'}
                    </p>
                  </div>
                  <button type="button" onClick={() => testService(service)} disabled={testing || !service.configured}>
                    {testing ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                    {testing ? '测试中' : '测试'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
