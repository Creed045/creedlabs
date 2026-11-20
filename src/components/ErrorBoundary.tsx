import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

/** Prevents runtime component errors from turning the whole app into a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="page-center" style={{ padding: 24 }}>
        <div className="empty" style={{ maxWidth: 440 }}>
          <h1 className="empty__title">Something interrupted the menu</h1>
          <p className="empty__message">
            {this.state.message || 'An unexpected display error occurred.'}
          </p>
          <div className="empty__action">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                this.setState({ hasError: false, message: '' })
                window.location.reload()
              }}
            >
              Reload menu
            </button>
          </div>
        </div>
      </main>
    )
  }
}
