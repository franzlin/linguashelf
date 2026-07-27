import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronDown, Loader2, RotateCcw, Save } from 'lucide-react'
import { KEY_CLEARED, buildCapabilityPatch, initialDraft } from '../lib/ai-config-form'
import type { AiConfigField } from '../lib/ai-config-form'
import type { AiCapabilityConfig, AiCapabilityId, AiCustomConfig } from '../types/admin'

type FieldSpec = AiConfigField

type CapabilitySpec = {
  id: AiCapabilityId
  title: string
  role: string
  fields: FieldSpec[]
}

const ENDPOINT_FIELDS: FieldSpec[] = [
  { name: 'baseUrl', label: '接口地址', kind: 'url', hint: '留空则使用服务器 .env 中的地址' },
  { name: 'apiKey', label: 'API Key', kind: 'secret', hint: '保存后不再显示，只能覆盖或清除' },
  { name: 'model', label: '模型名称', kind: 'text' },
]

// The full set of customizable capabilities, in the order they matter for study.
export const AI_CAPABILITIES: CapabilitySpec[] = [
  {
    id: 'text',
    title: '文本生成',
    role: '分级阅读、理解题、生词释义、播客脚本、每日轻练',
    fields: [
      ...ENDPOINT_FIELDS,
      {
        name: 'apiStyle',
        label: '接口风格',
        kind: 'select',
        hint: '自动适配会先试 responses，失败后改用 chat/completions',
        options: [
          { value: 'auto', label: '自动适配' },
          { value: 'responses', label: 'responses' },
          { value: 'chat', label: 'chat/completions' },
        ],
      },
      {
        name: 'jsonMode',
        label: '结构化输出',
        kind: 'select',
        hint: '端点不支持严格 schema 时会自动降级',
        options: [
          { value: 'auto', label: '自动降级' },
          { value: 'schema', label: 'json_schema' },
          { value: 'object', label: 'json_object' },
          { value: 'prompt', label: '写入提示词' },
        ],
      },
      {
        name: 'reasoningEffort',
        label: '推理强度',
        kind: 'select',
        options: [
          { value: '', label: '跟随环境变量' },
          { value: 'none', label: '不发送该参数' },
          { value: 'minimal', label: 'minimal' },
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ],
      },
    ],
  },
  {
    id: 'listeningTts',
    title: '听力预热 TTS',
    role: '学习单元里的先听后读音频',
    fields: [
      ...ENDPOINT_FIELDS,
      {
        name: 'provider',
        label: '接口类型',
        kind: 'select',
        options: [
          { value: '', label: '跟随环境变量' },
          { value: 'openai-speech', label: 'OpenAI 语音接口' },
          { value: 'mimo', label: 'MiMo 语音接口' },
        ],
      },
      { name: 'voice', label: '音色', kind: 'text', hint: '多个音色用逗号分隔时会轮换' },
      { name: 'instructions', label: '朗读风格提示', kind: 'longtext' },
    ],
  },
  {
    id: 'podcastQwen',
    title: 'Qwen 播客 TTS',
    role: 'DashScope 长文本语音合成',
    fields: [...ENDPOINT_FIELDS, { name: 'voice', label: '音色', kind: 'text', placeholder: 'longanlingxin' }],
  },
  {
    id: 'podcastGeminiOfficial',
    title: 'Gemini 3.1 播客 TTS',
    role: '播客语音的第二来源',
    fields: [...ENDPOINT_FIELDS.map((field) => (field.name === 'apiKey' ? { ...field, hint: '多个 key 用逗号分隔可轮换' } : field))],
  },
  {
    id: 'podcastGeminiFallback',
    title: 'Gemini 2.5 播客 TTS',
    role: '播客语音的兜底来源',
    fields: ENDPOINT_FIELDS,
  },
  {
    id: 'ocr',
    title: 'PDF 视觉 OCR',
    role: '扫描版 PDF 的优先识别来源，失败后回退本地 Tesseract',
    fields: ENDPOINT_FIELDS,
  },
]

function effectiveValue(config: AiCapabilityConfig | undefined, field: string) {
  const effective = config?.effective as Record<string, unknown> | undefined
  const value = effective?.[field]
  return typeof value === 'string' ? value : ''
}

function CapabilityForm({
  spec,
  config,
  busy,
  onSave,
}: {
  spec: CapabilitySpec
  config: AiCapabilityConfig | undefined
  busy: boolean
  onSave: (capability: AiCapabilityId, patch: Record<string, string | null>) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const initial = useMemo(
    () => initialDraft(spec.fields, config as unknown as Record<string, unknown> | undefined),
    [config, spec.fields],
  )
  const [draft, setDraft] = useState(initial)
  const [dirty, setDirty] = useState(false)

  const custom = config?.effective.source === 'custom'
  const configured = Boolean(config?.effective.configured)

  function update(name: string, value: string) {
    setDraft((current) => ({ ...current, [name]: value }))
    setDirty(true)
  }

  function reset() {
    setDraft(initial)
    setDirty(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const patch = buildCapabilityPatch(spec.fields, draft, initial)
    if (!Object.keys(patch).length) {
      setDirty(false)
      return
    }
    await onSave(spec.id, patch)
    setDraft((current) => ({ ...current, apiKey: '' }))
    setDirty(false)
  }

  return (
    <article className={`ai-config-card ${open ? 'open' : ''}`}>
      <button type="button" className="ai-config-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div>
          <strong>{spec.title}</strong>
          <span>{spec.role}</span>
        </div>
        <div className="ai-config-summary-meta">
          <span className={`status-pill ${configured ? 'ok' : 'muted'}`}>{configured ? '已配置' : '未配置'}</span>
          <span className="ai-config-source">{custom ? '网页自定义' : '环境变量'}</span>
          <ChevronDown size={18} className="ai-config-chevron" />
        </div>
      </button>

      {open && (
        <form className="ai-config-form" onSubmit={submit}>
          {spec.fields.map((field) => {
            const inherited = effectiveValue(config, field.name)
            const value = draft[field.name] ?? ''
            const controlId = `${spec.id}-${field.name}`

            if (field.kind === 'select') {
              return (
                <label key={field.name} htmlFor={controlId}>
                  <span>{field.label}</span>
                  <select id={controlId} value={value} onChange={(event) => update(field.name, event.target.value)} disabled={busy}>
                    {(field.options || []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {field.hint && <small>{field.hint}</small>}
                </label>
              )
            }

            if (field.kind === 'secret') {
              const cleared = value === KEY_CLEARED
              return (
                <label key={field.name} htmlFor={controlId}>
                  <span>{field.label}</span>
                  <input
                    id={controlId}
                    type="password"
                    autoComplete="off"
                    value={cleared ? '' : value}
                    placeholder={cleared ? '保存后改用环境变量' : config?.hasCustomKey ? config.apiKeyMask : '未设置，使用环境变量'}
                    onChange={(event) => update(field.name, event.target.value)}
                    disabled={busy}
                  />
                  <div className="ai-config-key-actions">
                    <small>{field.hint}</small>
                    {config?.hasCustomKey && !cleared && (
                      <button type="button" onClick={() => update(field.name, KEY_CLEARED)} disabled={busy}>
                        清除自定义 key
                      </button>
                    )}
                    {cleared && (
                      <button type="button" onClick={() => update(field.name, '')} disabled={busy}>
                        取消清除
                      </button>
                    )}
                  </div>
                </label>
              )
            }

            if (field.kind === 'longtext') {
              return (
                <label key={field.name} htmlFor={controlId} className="ai-config-wide">
                  <span>{field.label}</span>
                  <textarea
                    id={controlId}
                    rows={3}
                    value={value}
                    placeholder={inherited || '留空则使用默认提示'}
                    onChange={(event) => update(field.name, event.target.value)}
                    disabled={busy}
                  />
                  {field.hint && <small>{field.hint}</small>}
                </label>
              )
            }

            return (
              <label key={field.name} htmlFor={controlId}>
                <span>{field.label}</span>
                <input
                  id={controlId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  placeholder={field.placeholder || inherited || '留空则使用环境变量'}
                  onChange={(event) => update(field.name, event.target.value)}
                  disabled={busy}
                />
                {field.hint && <small>{field.hint}</small>}
              </label>
            )
          })}

          <div className="ai-config-actions">
            <p>当前生效：{effectiveValue(config, 'baseUrl') || '未配置地址'} · {effectiveValue(config, 'model') || '未配置模型'}</p>
            <div>
              <button type="button" className="ghost-button" onClick={reset} disabled={busy || !dirty}>
                <RotateCcw size={16} />
                还原
              </button>
              <button type="submit" className="primary-button" disabled={busy || !dirty}>
                {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                保存
              </button>
            </div>
          </div>
        </form>
      )}
    </article>
  )
}

export function AiServiceConfigPanel({
  config,
  busyId,
  onSave,
}: {
  config: AiCustomConfig | undefined
  busyId: string
  onSave: (capability: AiCapabilityId, patch: Record<string, string | null>) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="ai-config-panel" aria-labelledby="ai-config-title">
      <button type="button" className="ai-config-panel-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div>
          <span>Custom endpoints</span>
          <h2 id="ai-config-title">自定义 API</h2>
          <p>为每类能力单独填写接口地址、key 和模型；留空的字段继续使用服务器 .env。保存后立即生效，无需重启。</p>
        </div>
        <ChevronDown size={20} className="ai-config-chevron" />
      </button>

      {open && (
        <div className="ai-config-list">
          {AI_CAPABILITIES.map((spec) => (
            <CapabilityForm
              key={spec.id}
              spec={spec}
              config={config?.[spec.id]}
              busy={busyId === `config-${spec.id}`}
              onSave={onSave}
            />
          ))}
        </div>
      )}
    </section>
  )
}
