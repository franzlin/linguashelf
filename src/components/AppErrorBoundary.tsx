import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

type AppErrorBoundaryState = {
  failed: boolean
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LinguaShelf render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="loading-screen">
        <div className="loading-error">
          <TriangleAlert size={28} />
          <strong>这个页面暂时无法显示</strong>
          <span>学习数据仍然保留。重新加载后如果问题持续，请返回书库选择其他单元。</span>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            <RotateCcw size={17} />
            重新加载
          </button>
        </div>
      </main>
    )
  }
}
