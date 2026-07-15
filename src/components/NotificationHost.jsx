import { useState, useEffect, useRef } from "react"
import { subscribe, getState, dismissToast, closeDialog } from "../lib/notify"

const TOAST_STYLES = {
  success: { ring: "border-[#06d6a0]/30", bar: "bg-[#06d6a0]", icon: "✓", iconBg: "bg-[#06d6a0]/15 text-[#06d6a0]" },
  error: { ring: "border-[#ef476f]/30", bar: "bg-[#ef476f]", icon: "✕", iconBg: "bg-[#ef476f]/15 text-[#ef476f]" },
  warning: { ring: "border-[#fca311]/30", bar: "bg-[#fca311]", icon: "!", iconBg: "bg-[#fca311]/15 text-[#fca311]" },
  info: { ring: "border-[#7ec8e3]/30", bar: "bg-[#7ec8e3]", icon: "i", iconBg: "bg-[#7ec8e3]/15 text-[#7ec8e3]" },
}

function Toast({ t }) {
  const s = TOAST_STYLES[t.type] || TOAST_STYLES.info
  return (
    <div
      role="status"
      className={`pointer-events-auto relative flex items-start gap-3 w-[320px] max-w-[88vw] overflow-hidden rounded-2xl border ${s.ring} bg-[#0d131f]/95 backdrop-blur-xl shadow-2xl px-4 py-3.5 animate-[toastIn_0.25s_ease-out]`}
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${s.bar}`} />
      <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-black font-mono ${s.iconBg}`}>
        {s.icon}
      </span>
      <p className="flex-1 text-[13px] leading-snug text-slate-100 font-sans">{t.message}</p>
      <button
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-slate-500 hover:text-white transition-colors text-sm leading-none cursor-pointer"
      >
        ✕
      </button>
    </div>
  )
}

function Dialog({ dialog }) {
  const [value, setValue] = useState(dialog.kind === "prompt" ? dialog.defaultValue : "")
  const inputRef = useRef(null)

  useEffect(() => {
    if (dialog.kind === "prompt" && inputRef.current) inputRef.current.focus()
  }, [dialog])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeDialog(dialog.kind === "confirm" ? false : null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dialog])

  const matchFailed = dialog.match != null && value !== dialog.match

  const submit = () => {
    if (dialog.kind === "confirm") closeDialog(true)
    else {
      if (matchFailed) return
      closeDialog(value)
    }
  }
  const cancel = () => closeDialog(dialog.kind === "confirm" ? false : null)

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
    >
      <div className="w-full max-w-[380px] bg-[#0d131f] border border-white/10 rounded-3xl shadow-2xl p-6 animate-[dialogIn_0.2s_ease-out]">
        <h2 className="text-lg font-black text-white font-heading mb-2">{dialog.title}</h2>
        {dialog.message && (
          <p className="text-[13px] text-slate-400 leading-relaxed font-sans mb-5 whitespace-pre-line">{dialog.message}</p>
        )}

        {dialog.kind === "prompt" && (
          <div className="mb-5">
            <input
              ref={inputRef}
              type={dialog.password ? "password" : "text"}
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
              }}
              className="w-full bg-slate-900 border border-slate-800 text-sm text-white rounded-xl px-3.5 py-3 focus:outline-none focus:border-[#7ec8e3]/70 transition-colors"
            />
            {dialog.match != null && (
              <p className="text-[10px] text-slate-500 font-mono mt-2 uppercase tracking-wider">
                Type <span className="text-[#ef476f] font-bold">{dialog.match}</span> to confirm
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={cancel}
            className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider font-heading border border-slate-800 text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors cursor-pointer active:scale-95"
          >
            {dialog.cancelText}
          </button>
          <button
            onClick={submit}
            disabled={matchFailed}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider font-heading transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              dialog.danger
                ? "bg-[#ef476f] text-white hover:bg-[#d43d5e]"
                : "bg-[#7ec8e3] text-[#070a13] hover:bg-[#68b4d0]"
            }`}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function NotificationHost() {
  const [snap, setSnap] = useState(getState)
  useEffect(() => subscribe(setSnap), [])

  return (
    <>
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes dialogIn { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className="fixed top-4 right-4 z-[1001] flex flex-col gap-3 items-end pointer-events-none">
        {snap.toasts.map((t) => (
          <Toast key={t.id} t={t} />
        ))}
      </div>

      {snap.dialog && <Dialog dialog={snap.dialog} />}
    </>
  )
}
