import { useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, Download, LogOut, MoreHorizontal, Sparkles, X } from 'lucide-react'
import { navigationGroups, viewMeta, visibleNavigationItems } from '../navigation'
import type { View } from '../navigation'

type ShellUser = {
  email: string
  name: string
}

type AppShellProps = {
  children: ReactNode
  user: ShellUser
  isAdmin: boolean
  view: View
  installAvailable: boolean
  installLabel: string
  onNavigate: (view: View) => void
  onInstall: () => void
  onLogout: () => void
}

function Sidebar({
  user,
  isAdmin,
  view,
  onNavigate,
  onLogout,
}: Pick<AppShellProps, 'user' | 'isAdmin' | 'view' | 'onNavigate' | 'onLogout'>) {
  const initial = (user.name || user.email || 'L').trim().slice(0, 1).toUpperCase()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand" aria-label="LinguaShelf">
        <span className="brand-symbol"><BookOpen size={22} /></span>
        <span className="brand-copy">
          <strong>LinguaShelf</strong>
          <small>Read with depth</small>
        </span>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {navigationGroups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || isAdmin)
          if (!items.length) return null
          return (
            <section className="nav-group" key={group.label} aria-label={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {items.map((item) => {
                const Icon = item.icon
                const active = view === item.view
                return (
                  <button
                    key={item.view}
                    className={active ? 'active' : ''}
                    type="button"
                    data-nav-view={item.view}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    <span className="nav-icon"><Icon size={18} /></span>
                    <span className="nav-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                )
              })}
            </section>
          )
        })}
      </nav>

      <div className="sidebar-user">
        <div className="user-summary">
          <span className="user-avatar">{initial}</span>
          <span className="user-copy">
            <strong>{user.name || '学习者'}</strong>
            <small>{user.email}</small>
          </span>
        </div>
        <button type="button" onClick={onLogout} aria-label="退出登录">
          <LogOut size={17} />
          <span>退出</span>
        </button>
      </div>
    </aside>
  )
}

function WorkspaceHeader({
  view,
  isAdmin,
  installAvailable,
  installLabel,
  onNavigate,
  onInstall,
}: Pick<AppShellProps, 'view' | 'isAdmin' | 'installAvailable' | 'installLabel' | 'onNavigate' | 'onInstall'>) {
  const meta = viewMeta[view]
  const [moreOpen, setMoreOpen] = useState(false)
  const allMobileItems = visibleNavigationItems(isAdmin)
  const mobileItems = allMobileItems.filter((item) => item.mobile)
  const moreItems = allMobileItems.filter((item) => !item.mobile)
  const moreActive = moreItems.some((item) => item.view === view)

  function navigate(nextView: View) {
    setMoreOpen(false)
    onNavigate(nextView)
  }

  return (
    <>
      <header className="topbar">
        <div className="page-intro">
          <span className="eyebrow">{meta.eyebrow}</span>
          <h2>{meta.title}</h2>
          <p>{meta.description}</p>
        </div>
        <div className="topbar-actions">
          <span className="focus-chip"><Sparkles size={15} /> 专注学习</span>
          {installAvailable && (
            <button className="secondary-button install-button" type="button" onClick={onInstall}>
              <Download size={17} />
              {installLabel}
            </button>
          )}
        </div>
      </header>

      <nav className="mobile-nav" aria-label="移动端导航">
        {mobileItems.map((item) => {
          const Icon = item.icon
          const active = view === item.view
          return (
            <button
              key={item.view}
              className={active ? 'active' : ''}
              type="button"
              data-mobile-nav-view={item.view}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.view)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <button
          className={moreOpen || moreActive ? 'active' : ''}
          type="button"
          aria-label="更多"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((current) => !current)}
        >
          <MoreHorizontal size={19} />
          <span>更多</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-more-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
          <section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="更多导航" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-more-head">
              <div>
                <span className="eyebrow">Navigation</span>
                <h2>更多功能</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setMoreOpen(false)} aria-label="关闭更多导航">
                <X size={18} />
              </button>
            </div>
            <div className="mobile-more-grid">
              {moreItems.map((item) => {
                const Icon = item.icon
                const active = item.view === view
                return (
                  <button
                    key={item.view}
                    className={active ? 'active' : ''}
                    type="button"
                    aria-label={item.label}
                    onClick={() => navigate(item.view)}
                  >
                    <span className="nav-icon"><Icon size={19} /></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export function AppShell({
  children,
  user,
  isAdmin,
  view,
  installAvailable,
  installLabel,
  onNavigate,
  onInstall,
  onLogout,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Sidebar user={user} isAdmin={isAdmin} view={view} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="workspace">
        <WorkspaceHeader
          view={view}
          isAdmin={isAdmin}
          installAvailable={installAvailable}
          installLabel={installLabel}
          onNavigate={onNavigate}
          onInstall={onInstall}
        />
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  )
}
