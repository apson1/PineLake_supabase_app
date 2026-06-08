import { useState, useEffect, useRef } from "react"
import { playClick, playSuccess } from "../lib/sounds"

export default function FaceScanUI({ onSuccess, onCancel }) {
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  
  const [hasWebcam, setHasWebcam] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  // Start webcam on mount
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 300 }, height: { ideal: 300 } } })
      .then((stream) => {
        streamRef.current = stream
        setHasWebcam(true)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      })
      .catch((err) => {
        console.warn("Webcam blocked or not available, using placeholder mockup:", err)
        setHasWebcam(false)
      })

    // Cleanup tracks on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const onSuccessRef = useRef(onSuccess)
  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  // Scan progress simulator
  useEffect(() => {
    const iv = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(iv)
          return 100
        }
        return p + 4
      })
    }, 80)

    const t = setTimeout(() => {
      let capturedImg = ""
      if (videoRef.current && streamRef.current) {
        try {
          const video = videoRef.current
          const canvas = document.createElement("canvas")
          canvas.width = video.videoWidth || 300
          canvas.height = video.videoHeight || 300
          const ctx = canvas.getContext("2d")
          
          // Mirror flip
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          
          // Restore flip for overlay
          ctx.scale(-1, 1)
          ctx.translate(-canvas.width, 0)
          
          // Draw audit targeting circle
          ctx.strokeStyle = "#00b4d8"
          ctx.lineWidth = 4
          ctx.beginPath()
          ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.35, 0, 2 * Math.PI)
          ctx.stroke()
          
          capturedImg = canvas.toDataURL("image/jpeg", 0.7)
        } catch (e) {
          console.error("Frame capture error:", e)
        }
      }
      
      if (!capturedImg) {
        capturedImg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231f2937'/><circle cx='50' cy='45' r='16' fill='%23ef476f'/><path d='M20,90 C20,74 80,74 80,90' fill='%23ef476f'/><text x='50' y='92' font-family='monospace' font-size='8' fill='%239ca3af' text-anchor='middle'>FALLBACK SCAN</text></svg>`
      }

      setDone(true)
      playSuccess()
      
      // Stop webcam immediately upon success
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      
      setTimeout(() => {
        onSuccessRef.current(capturedImg)
      }, 500)
    }, 2200)

    return () => {
      clearInterval(iv)
      clearTimeout(t)
    }
  }, [hasWebcam])

  const r = 68
  const circ = 2 * Math.PI * r

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-[#111827]/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl w-full max-w-[320px] mx-auto text-center">
      <style>{`
        @keyframes scan-laser {
          0%, 100% { transform: translateY(0); opacity: 0.7; }
          50% { transform: translateY(132px); opacity: 1; }
        }
      `}</style>

      <div className="relative w-40 h-40 mb-6 mx-auto flex items-center justify-center">
        {/* Animated Scanning Ring */}
        <svg width="160" height="160" viewBox="0 0 160 160" className="absolute inset-0 z-20 pointer-events-none">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke={done ? "#06d6a0" : "#7ec8e3"}
            strokeWidth="4"
            strokeDasharray={`${(progress / 100) * circ} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 80 80)"
            className="transition-all duration-75"
            style={{
              filter: done
                ? "drop-shadow(0 0 4px rgba(6, 214, 160, 0.4))"
                : "drop-shadow(0 0 4px rgba(126, 200, 227, 0.4))"
            }}
          />
        </svg>
        
        {/* Video Circle Container */}
        <div className="w-[132px] h-[132px] rounded-full overflow-hidden relative bg-slate-950 flex items-center justify-center border-2 border-slate-800 shadow-inner">
          {hasWebcam ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]" // mirror image
            />
          ) : (
            /* Fallback avatar mockup */
            <div className="flex flex-col items-center justify-center">
              <div className={`text-5xl leading-none mb-1.5 transition-transform duration-300 ${done ? "scale-110 text-[#06d6a0]" : "text-gray-300"}`}>
                👤
              </div>
            </div>
          )}

          {/* Red/Green Laser scanner line */}
          {!done && (
            <div
              className={`absolute left-0 w-full h-0.5 z-10`}
              style={{
                background: "linear-gradient(to right, transparent, #7ec8e3, transparent)",
                boxShadow: "0 0 8px #7ec8e3",
                animation: "scan-laser 2s infinite ease-in-out"
              }}
            />
          )}

          {/* Verification badge overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <div
              className={`text-[9px] font-mono tracking-wider font-bold transition-colors duration-300 bg-slate-950/80 px-2 py-0.5 rounded-full border border-white/10 ${
                done ? "text-[#06d6a0] border-[#06d6a0]/30" : "text-[#7ec8e3] border-[#7ec8e3]/30"
              }`}
            >
              {done ? "VERIFIED" : progress < 35 ? "ALIGN FACE" : "SCANNING..."}
            </div>
          </div>
        </div>

        {/* Pulse Effect for Scanner */}
        {!done && (
          <div className="absolute inset-8 rounded-full border border-[#7ec8e3]/20 animate-pulse pointer-events-none" />
        )}
      </div>

      <button
        onClick={() => {
          playClick()
          onCancel()
        }}
        className="text-xs text-gray-400 font-mono tracking-widest uppercase hover:text-white transition-colors duration-150 py-1.5 px-6 rounded border border-transparent hover:border-slate-800 cursor-pointer"
      >
        Cancel
      </button>
    </div>
  )
}
