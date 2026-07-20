import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { OptionSegment, Segmented, SettingGroup, StatusItem } from '../components/ui/Controls'
import {
  listeningLevelOptions,
  microDifficultyOptions,
  microPracticeTopicOptions,
  microPracticeTypeOptions,
  podcastLexileOptions,
  readingLevelOptions,
} from '../config/learning'
import { requestJson } from '../lib/api'
import { formatBytes, formatDateTime, formatNumber } from '../lib/format'
import type { SecurityStatus } from '../types/admin'
import type { UserSettings } from '../types/domain'

const podcastVoiceOptions = [
  { value: 'longanlingxin', label: '温暖知性' },
  { value: 'longanlufeng', label: '明亮开朗' },
] as const

export function SettingsPage({
  settings,
  token,
  onSaved,
  onError,
}: {
  settings: UserSettings
  token: string
  onSaved: (settings: UserSettings) => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', nextPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    requestJson<SecurityStatus>('/api/security/status', token)
      .then(setSecurity)
      .catch(() => undefined)
  }, [token])

  async function save() {
    setSaving(true)
    try {
      const result = await requestJson<{ settings: UserSettings }>('/api/settings', token, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      })
      onSaved(result.settings)
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setChangingPassword(true)
    try {
      await requestJson('/api/account/password', token, {
        method: 'PATCH',
        body: JSON.stringify(passwordDraft),
      })
      setPasswordDraft({ currentPassword: '', nextPassword: '' })
      setPasswordMessage('密码已更新')
    } catch (err) {
      onError(err instanceof Error ? err.message : '密码修改失败')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <section className="page-section settings-section">
      <div className="section-head">
        <div>
          <h1>设置</h1>
          <p>阅读和听力分开调节</p>
        </div>
        <button className="primary-button" type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          保存
        </button>
      </div>

      <SettingGroup title="阅读难度">
        <Segmented
          options={readingLevelOptions}
          value={draft.readingLevel}
          onChange={(readingLevel) => setDraft({ ...draft, readingLevel })}
        />
      </SettingGroup>

      <SettingGroup title="听力难度">
        <Segmented
          options={listeningLevelOptions}
          value={draft.listeningLevel}
          onChange={(listeningLevel) => setDraft({ ...draft, listeningLevel })}
        />
      </SettingGroup>

      <SettingGroup title="播客难度">
        <Segmented
          options={podcastLexileOptions}
          value={String(draft.podcastLexile || 900)}
          onChange={(podcastLexile) => setDraft({ ...draft, podcastLexile: Number(podcastLexile) })}
        />
      </SettingGroup>

      <SettingGroup title="播客音色">
        <OptionSegment
          options={[...podcastVoiceOptions]}
          value={draft.podcastVoice === 'longanlufeng' ? 'longanlufeng' : 'longanlingxin'}
          onChange={(podcastVoice) => setDraft({ ...draft, podcastVoice })}
          ariaLabel="播客音色"
        />
      </SettingGroup>

      <SettingGroup title="学习时长">
        <div className="stepper">
          <button type="button" onClick={() => setDraft({ ...draft, studyMinutes: Math.max(5, draft.studyMinutes - 5) })}>
            -
          </button>
          <span>{draft.studyMinutes} 分钟</span>
          <button type="button" onClick={() => setDraft({ ...draft, studyMinutes: Math.min(30, draft.studyMinutes + 5) })}>
            +
          </button>
        </div>
      </SettingGroup>

      <SettingGroup title="每日轻练类型">
        <OptionSegment
          options={microPracticeTypeOptions}
          value={draft.microPracticeType || 'random'}
          onChange={(microPracticeType) => setDraft({ ...draft, microPracticeType })}
          ariaLabel="默认轻练类型"
        />
      </SettingGroup>

      <SettingGroup title="每日轻练主题">
        <div className="setting-stack">
          <OptionSegment
            options={microPracticeTopicOptions}
            value={draft.microPracticeTopic || 'book'}
            onChange={(microPracticeTopic) => setDraft({ ...draft, microPracticeTopic })}
            ariaLabel="默认轻练主题"
          />
          {(draft.microPracticeTopic || 'book') === 'custom' && (
            <input
              className="search-input"
              value={draft.microPracticeCustomTopic || ''}
              onChange={(event) => setDraft({ ...draft, microPracticeCustomTopic: event.target.value })}
              placeholder="自定义主题"
            />
          )}
        </div>
      </SettingGroup>

      <SettingGroup title="每日轻练难度">
        <Segmented
          options={microDifficultyOptions}
          value={draft.microPracticeDifficulty || draft.readingLevel}
          onChange={(microPracticeDifficulty) => setDraft({ ...draft, microPracticeDifficulty })}
          ariaLabel="默认轻练难度"
        />
      </SettingGroup>

      <SettingGroup title="轻练目标">
        <div className="target-steppers">
          <div className="stepper">
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeDailyGoal: Math.max(0, (draft.microPracticeDailyGoal ?? 1) - 1) })}>
              -
            </button>
            <span>日 {draft.microPracticeDailyGoal ?? 1} 次</span>
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeDailyGoal: Math.min(10, (draft.microPracticeDailyGoal ?? 1) + 1) })}>
              +
            </button>
          </div>
          <div className="stepper">
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeMonthlyGoal: Math.max(0, (draft.microPracticeMonthlyGoal ?? 30) - 5) })}>
              -
            </button>
            <span>月 {draft.microPracticeMonthlyGoal ?? 30} 次</span>
            <button type="button" onClick={() => setDraft({ ...draft, microPracticeMonthlyGoal: Math.min(300, (draft.microPracticeMonthlyGoal ?? 30) + 5) })}>
              +
            </button>
          </div>
        </div>
      </SettingGroup>

      <SettingGroup title="自动难度调整">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.aiSuggestions}
            onChange={(event) => setDraft({ ...draft, aiSuggestions: event.target.checked })}
          />
          <span>开启</span>
        </label>
      </SettingGroup>

      <SettingGroup title="专注学习模式">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.focusStudyMode !== false}
            onChange={(event) => setDraft({ ...draft, focusStudyMode: event.target.checked })}
          />
          <span>默认隐藏审稿信息</span>
        </label>
      </SettingGroup>

      <SettingGroup title="原书文件保留">
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.keepSourceFiles}
            onChange={(event) => setDraft({ ...draft, keepSourceFiles: event.target.checked })}
          />
          <span>保留</span>
        </label>
      </SettingGroup>

      <article className="setting-row password-row">
        <div>
          <h2>修改密码</h2>
          <p>{passwordMessage || '更新后其他设备需要重新登录。'}</p>
        </div>
        <div className="password-form">
          <input
            type="password"
            placeholder="当前密码"
            value={passwordDraft.currentPassword}
            onChange={(event) => setPasswordDraft({ ...passwordDraft, currentPassword: event.target.value })}
          />
          <input
            type="password"
            placeholder="新密码，至少 8 位"
            value={passwordDraft.nextPassword}
            onChange={(event) => setPasswordDraft({ ...passwordDraft, nextPassword: event.target.value })}
          />
          <button className="ghost-button" type="button" onClick={changePassword} disabled={changingPassword}>
            {changingPassword ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            更新
          </button>
        </div>
      </article>

      {security && (
        <article className="setting-row deployment-row">
          <div>
            <h2>部署检查</h2>
            <p>{security.deployment.nodeEnv} · {security.deployment.storageDriver}</p>
          </div>
          <div className="deployment-grid">
            <StatusItem label="开放注册" ok={!security.security.allowSignup} value={security.security.allowSignup ? '开启' : '关闭'} />
            <StatusItem label="邀请码" ok={security.security.inviteRequired || !security.security.allowSignup} value={security.security.inviteRequired ? '需要' : '未配置'} />
            <StatusItem label="AI 文本" ok={security.deployment.aiConfigured} value={security.deployment.aiConfigured ? '已配置' : '未配置'} />
            <StatusItem label="TTS" ok={security.deployment.ttsConfigured} value={security.deployment.ttsConfigured ? security.deployment.ttsProvider : '未配置'} />
            <StatusItem
              label="播客 TTS"
              ok={security.deployment.podcastTtsConfigured}
              value={security.deployment.podcastTtsConfigured ? security.deployment.podcastTtsPrimary || 'Gemini' : '未配置'}
            />
            <StatusItem
              label="TTS 分块"
              ok
              value={`${formatNumber(security.deployment.podcastTtsChunkChars || 0)} 字 / ${formatNumber(security.deployment.podcastTtsChunkTokens || 0)} tokens`}
            />
            <StatusItem
              label="TTS 限制"
              ok
              value={`${formatNumber(security.deployment.podcastTtsInputTokenLimit || 0)} in / ${formatNumber(security.deployment.podcastTtsOutputTokenLimit || 0)} out`}
            />
            <StatusItem
              label="PDF OCR"
              ok={security.deployment.pdfOcrEnabled}
              value={
                security.deployment.pdfOcrEnabled
                  ? security.deployment.pdfOcrVisionConfigured
                    ? `Hunyuan 优先/${security.deployment.pdfOcrVisionDpi}dpi`
                    : `本地 ${security.deployment.pdfOcrLanguage}/${security.deployment.pdfOcrDpi}dpi`
                  : '关闭'
              }
            />
            <StatusItem label="会话" ok value={`${security.security.sessionDays} 天`} />
            <StatusItem label="任务" ok value={`${security.deployment.activeJobs} 个运行中`} />
            <StatusItem
              label="最近备份"
              ok={Boolean(security.deployment.backup.latestBackup)}
              value={
                security.deployment.backup.latestBackup
                  ? `${formatDateTime(security.deployment.backup.latestBackup.modifiedAt)} · ${formatBytes(security.deployment.backup.latestBackup.size)}`
                  : '未检测到'
              }
            />
            <StatusItem
              label="恢复演练"
              ok={Boolean(security.deployment.backup.latestDrill?.ok)}
              value={
                security.deployment.backup.latestDrill
                  ? security.deployment.backup.latestDrill.ok
                    ? `${formatDateTime(security.deployment.backup.latestDrill.modifiedAt)} · ${security.deployment.backup.latestDrill.recordCount || 0} 条`
                    : '最近失败'
                  : '未执行'
              }
            />
          </div>
        </article>
      )}
    </section>
  )
}
