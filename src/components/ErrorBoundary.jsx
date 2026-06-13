import { Component } from "react"

/**
 * Top-level error boundary. Prevents a single render error from blanking the
 * entire kiosk — instead shows a recoverable, on-brand fallback screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error:", error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-[#070a13] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#0d131f] border border-white/10 rounded-3xl shadow-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#ef476f]/10 border border-[#ef476f]/30 grid place-items-center text-3xl">
            ⚠️
          </div>
          <h1 className="text-xl font-black font-heading text-white mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-400 font-sans leading-relaxed mb-6">
            The app hit an unexpected error. Your clock data is safe — reloading usually fixes it.
          </p>
          <pre className="text-[11px] text-[#ef476f]/80 font-mono bg-slate-950/60 border border-white/5 rounded-xl p-3 mb-6 text-left overflow-auto max-h-32">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[#7ec8e3] text-[#070a13] py-3.5 rounded-xl font-heading font-black text-xs uppercase tracking-wider hover:bg-[#68b4d0] transition-colors cursor-pointer"
          >
            Reload App
          </button>
        </div>
      </div>
    )
  }
}
