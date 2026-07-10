import { useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, Headphones, Library, Loader2, RotateCcw, ShieldCheck, User, X } from 'lucide-react'
import { cookieSessionToken, requestJson } from '../lib/api'
import type { AppData } from '../types/domain'

export function LoginScreen({ onLogin }: { onLogin: (data: AppData) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await requestJson('/api/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({ email, password, inviteCode }),
      })
      const data = await requestJson<AppData>('/api/app', cookieSessionToken)
      onLogin(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-story" aria-label="产品介绍">
        <div className="login-brand">
          <span className="brand-symbol"><BookOpen size={23} /></span>
          <span>
            <strong>LinguaShelf</strong>
            <small>Read with depth</small>
          </span>
        </div>
        <div className="login-story-copy">
          <span className="eyebrow">Your private reading studio</span>
          <h1>把真正想读的英文书，变成每天可以完成的学习。</h1>
          <p>忠于原书观点，按你的阅读和听力水平重新组织；来源、进度和生词会在手机与电脑间同步。</p>
        </div>
        <div className="login-feature-grid">
          <article><Headphones size={19} /><strong>先听后读</strong><span>自然语速建立语境</span></article>
          <article><Library size={19} /><strong>忠于原书</strong><span>逐段保留来源映射</span></article>
          <article><ShieldCheck size={19} /><strong>个人空间</strong><span>账号、进度与书库同步</span></article>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel-head">
          <div className="brand-mark"><BookOpen size={24} /></div>
          <div>
            <span className="eyebrow">Welcome back</span>
            <h2>继续你的阅读</h2>
          </div>
        </div>
        <p>登录已有账号；首次使用时填写邀请码创建账号。</p>
        <form onSubmit={submit} className="login-form">
          <label>
            邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          <label>
            邀请码
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="已有账号可留空" autoComplete="off" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <User size={18} />}
            登录 / 创建账号
          </button>
        </form>
        <div className="login-security-note"><ShieldCheck size={15} /> 会话使用安全 Cookie，页面不会显示任何 AI 服务密钥。</div>
      </section>
    </main>
  )
}

export function LoadingScreen({ error = '', onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="loading-screen">
      {error ? (
        <div className="loading-error">
          <X size={28} />
          <strong>暂时无法打开书架</strong>
          <span>{error}</span>
          {onRetry && (
            <button className="primary-button" type="button" onClick={onRetry}>
              <RotateCcw size={17} />
              重试
            </button>
          )}
        </div>
      ) : (
        <div className="loading-pulse">
          <span className="brand-symbol"><BookOpen size={22} /></span>
          <Loader2 className="spin" size={24} />
          <span>正在打开书架</span>
        </div>
      )}
    </main>
  )
}
