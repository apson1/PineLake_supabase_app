import { useState, useCallback } from "react"
import { playClick, playSuccess, playError } from "../lib/sounds"

export default function PinPad({ onSuccess, onCancel, correctPin, label }) {
  const [entered, setEntered] = useState("")
  const [shake, setShake] = useState(false)
  const [status, setStatus] = useState("idle") // 'idle' | 'success' | 'error'

  const press = useCallback((digit) => {
    if (status !== "idle") return
    
    // Play touch click sound
    playClick()
    
    setEntered((prev) => {
      if (prev.length >= 4) return prev
      const next = prev + digit
      
      // Auto-validate once 4 digits are typed
      if (next.length === 4) {
        if (next === correctPin) {
          setStatus("success")
          playSuccess()
          setTimeout(() => {
            onSuccess()
          }, 300)
        } else {
          setStatus("error")
          playError()
          setShake(true)
          setTimeout(() => {
            setEntered("")
            setShake(false)
            setStatus("idle")
          }, 600)
        }
      }
      return next
    })
  }, [correctPin, onSuccess, status])

  const handleBackspace = () => {
    if (status !== "idle") return
    playClick()
    setEntered((prev) => prev.slice(0, -1))
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-[#111827]/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl w-full max-w-[320px] mx-auto">
      <div className="text-[11px] text-gray-400 font-mono tracking-widest uppercase mb-4 text-center">
        {label || "ENTER PIN"}
      </div>
      
      {/* Indicator dots */}
      <div className={`flex gap-4 justify-center mb-6 ${shake ? "animate-shake" : ""}`}>
        {[0, 1, 2, 3].map((i) => {
          const filled = i < entered.length
          let dotColor = "bg-slate-700 border-slate-600"
          if (filled) {
            if (status === "success") dotColor = "bg-[#06d6a0] border-[#06d6a0] shadow-[0_0_10px_rgba(6,214,160,0.5)]"
            else if (status === "error") dotColor = "bg-[#ef476f] border-[#ef476f] shadow-[0_0_10px_rgba(239,71,111,0.5)]"
            else dotColor = "bg-[#7ec8e3] border-[#7ec8e3] shadow-[0_0_10px_rgba(126,200,227,0.5)]"
          }
          return (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${dotColor}`}
            />
          )
        })}
      </div>
      
      {/* Number grid */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[240px] mb-6">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "X"].map((k, i) => {
          if (k === "") {
            return <div key={i} />
          }
          if (k === "X") {
            return (
              <button
                key={i}
                onClick={handleBackspace}
                className="h-14 rounded-xl font-mono text-base font-bold text-gray-400 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 active:scale-95 transition-all duration-100 flex items-center justify-center cursor-pointer"
              >
                ⌫
              </button>
            )
          }
          return (
            <button
              key={i}
              onClick={() => press(k)}
              className="h-14 rounded-xl font-heading text-lg font-bold text-gray-200 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 active:scale-95 transition-all duration-100 flex items-center justify-center cursor-pointer"
            >
              {k}
            </button>
          )
        })}
      </div>
      
      {/* Cancel button */}
      <button
        onClick={() => {
          playClick()
          onCancel()
        }}
        className="text-xs text-gray-400 font-mono tracking-widest uppercase hover:text-white transition-colors duration-150 py-1.5 px-4 rounded border border-transparent hover:border-slate-800"
      >
        Cancel
      </button>
    </div>
  )
}
