import { ROLE_COLORS, fmtElapsed } from "../lib/utils"

export default function KioskView({
  employees,
  clockedIn,
  getElapsed,
  now,
  setAuthEmp,
  setScreen,
  setMgrLoginMode,
  offlineCount,
  isOnline,
  weather,
  announcements // array of announcements
}) {
  const isOfficialKiosk = !!localStorage.getItem("official_kiosk_token")
  const activeCount = Object.values(clockedIn).filter((s) => s.status === "IN").length

  // Helper for flag styling
  const getFlagColors = (flag) => {
    if (flag === "RED") return "bg-[#ef476f] text-black shadow-[0_0_10px_rgba(239,71,111,0.4)]"
    if (flag === "YELLOW") return "bg-[#fca311] text-black shadow-[0_0_10px_rgba(252,163,17,0.4)]"
    return "bg-[#06d6a0] text-black shadow-[0_0_10px_rgba(6,214,160,0.4)]"
  }

  // Active notices
  const activeNotices = announcements && announcements.length > 0
    ? announcements.map(a => a.text).join("  •  ")
    : "Welcome to Pine Lake Recreation! Please remember to log out after punching your time."

  return (
    <div className="bg-transparent text-[#f3f4f6] selection:bg-[#7ec8e3]/30 selection:text-white font-sans antialiased min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        
        {/* Offline & Queue Sync Banner */}
        {(!isOnline || offlineCount > 0) && (
          <div className={`mb-6 p-3 rounded-xl border flex items-center justify-between transition-all duration-300 ${
            !isOnline 
              ? "bg-[#270d18] border-[#ef476f]/30 text-[#ef476f] shadow-[0_0_15px_rgba(239,71,111,0.15)]"
              : "bg-[#271d0d] border-[#fca311]/30 text-[#fca311] shadow-[0_0_15px_rgba(252,163,17,0.15)]"
          }`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${!isOnline ? "bg-[#ef476f]" : "bg-[#fca311]"}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${!isOnline ? "bg-[#ef476f]" : "bg-[#fca311]"}`}></span>
              </span>
              <span>{!isOnline ? "Device is Offline" : "Online - Connecting..."}</span>
            </div>
            {offlineCount > 0 && (
              <span className="text-xs font-mono bg-black/40 px-2.5 py-1 rounded-md border border-white/5">
                {offlineCount} punch{offlineCount > 1 ? "es" : ""} queued offline
              </span>
            )}
          </div>
        )}

        {/* Dynamic Weather & Water Conditions Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="text-3xl select-none">
              {weather.code === 0 && "☀️"}
              {weather.code >= 1 && weather.code <= 3 && "⛅"}
              {(weather.code === 45 || weather.code === 48) && "🌫️"}
              {weather.code >= 51 && weather.code <= 67 && "🌧️"}
              {weather.code >= 71 && weather.code <= 77 && "🌨️"}
              {weather.code >= 80 && weather.code <= 82 && "🌦️"}
              {weather.code >= 95 && "⛈️"}
            </div>
            <div>
              <div className="text-xs font-bold text-white font-heading">{weather.text}</div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{weather.temp}°F Air Temp</div>
            </div>
          </div>
          <div className="flex items-center gap-3 border-y border-white/5 md:border-y-0 md:border-x md:px-4 py-2 md:py-0">
            <div className="text-2xl select-none">💨</div>
            <div>
              <div className="text-xs font-bold text-white font-heading">{weather.wind} mph Wind</div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{weather.waterTemp}°F Est. Water</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white font-heading">Waterfront Flag</span>
              <span className="text-[8px] font-mono text-gray-400 uppercase tracking-wider mt-0.5">Safety Status</span>
            </div>
            <span className={`text-[10px] font-mono font-black tracking-widest px-3 py-1.5 rounded-lg ${getFlagColors(weather.flag)}`}>
              {weather.flag} FLAG
            </span>
          </div>
        </div>

        {/* Live Notices Marquee Ticker */}
        <div className="mb-6 p-2 rounded-xl border border-white/5 bg-slate-950/65 overflow-hidden flex items-center gap-3">
          <span className="text-[9px] font-mono bg-slate-900 border border-white/10 text-[#7ec8e3] font-bold px-2 py-0.5 rounded shrink-0 uppercase tracking-widest">
            Notice
          </span>
          <div className="w-full overflow-hidden relative">
            <marquee className="text-[11px] text-gray-300 font-sans tracking-wide pt-0.5" scrollamount="4">
              {activeNotices}
            </marquee>
          </div>
        </div>

        {/* Kiosk Header */}
        <div className="text-center pt-2 pb-8 mb-6 border-b border-white/5">
          <div className="text-[10px] font-heading font-black text-[#7ec8e3] uppercase tracking-[0.25em] mb-2">
            Pine Lake Recreation
          </div>
          <h1 className="text-3xl font-black text-white leading-tight mb-2 font-heading tracking-tight">
            Station Time Clock
          </h1>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-gray-300 tracking-wider">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-1">
              {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
            </span>
          </div>
        </div>

        {/* Portal & Manager Quick Entry */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => setScreen("portal-select")}
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-white/5 bg-[#111827]/40 hover:bg-[#1f2937]/75 hover:border-[#7ec8e3]/40 active:scale-[0.98] transition-all duration-200 group cursor-pointer"
          >
            <span className="text-3xl mb-2.5 group-hover:scale-110 transition-transform duration-200">👤</span>
            <span className="text-sm font-black text-white font-heading">Employee Portal</span>
            <span className="text-[10px] text-gray-500 font-mono mt-1 uppercase tracking-wider">
              View Schedules & Pay
            </span>
          </button>
          
          <button
            onClick={() => {
              setMgrLoginMode("select")
              setScreen("manager-login")
            }}
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-white/5 bg-[#111827]/40 hover:bg-[#1f2937]/75 hover:border-[#fca311]/40 active:scale-[0.98] transition-all duration-200 group cursor-pointer"
          >
            <span className="text-3xl mb-2.5 group-hover:scale-110 transition-transform duration-200">🔐</span>
            <span className="text-sm font-black text-white font-heading">Manager Access</span>
            <span className="text-[10px] text-gray-500 font-mono mt-1 uppercase tracking-wider">
              Dashboard Control
            </span>
          </button>
        </div>

        {/* Staff Roster for Registered Kiosk Device */}
        {isOfficialKiosk ? (
          <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
              <div className="text-xs text-gray-400 font-mono tracking-widest uppercase">
                Staff Roster
              </div>
              <div className="text-xs text-[#06d6a0] font-mono flex items-center gap-1.5 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#06d6a0] animate-pulse"></span>
                {activeCount} Active on Clock
              </div>
            </div>
            
            <div className="flex flex-col gap-3">
              {employees.length === 0 ? (
                <div className="p-8 text-center text-gray-500 border border-dashed border-white/5 rounded-2xl bg-[#111827]/20 font-mono text-sm">
                  Loading employee roster...
                </div>
              ) : (
                employees.map((emp) => {
                  const s = clockedIn[emp.id]
                  const isWorking = s?.status === "IN"
                  const isOnBreak = s?.status === "BREAK"
                  const elapsed = getElapsed(emp.id)
                  
                  let cardStyle = "bg-[#111827]/30 border-white/5 hover:border-[#7ec8e3]/30"
                  let timerStyle = "text-gray-500"
                  
                  if (isWorking) {
                    cardStyle = "bg-[#06d6a0]/5 border-[#06d6a0]/20 hover:border-[#06d6a0]/40 shadow-[0_0_15px_rgba(6,214,160,0.02)]"
                    timerStyle = "text-[#06d6a0] font-bold"
                  } else if (isOnBreak) {
                    cardStyle = "bg-[#fca311]/5 border-[#fca311]/20 hover:border-[#fca311]/40"
                    timerStyle = "text-[#fca311] font-bold"
                  }

                  return (
                    <button
                      key={emp.id}
                      onClick={() => {
                        setAuthEmp(emp)
                        setScreen("kiosk-auth")
                      }}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 hover:scale-[1.015] active:scale-[0.99] text-left cursor-pointer ${cardStyle}`}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-sm shadow-md shrink-0 transition-transform duration-200 group-hover:scale-105"
                          style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                        >
                          {emp.avatar}
                        </div>
                        <div>
                          <div className="text-[15px] font-black text-white font-heading">
                            {emp.name}
                          </div>
                          <div
                            className="text-xs font-semibold mt-0.5"
                            style={{ color: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                          >
                            {emp.role}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        {isWorking && (
                          <>
                            <span className="font-mono text-lg tracking-wider leading-none">
                              {fmtElapsed(elapsed)}
                            </span>
                            <span className="text-[8px] font-mono text-[#06d6a0]/70 uppercase tracking-widest mt-1 block">
                              Working
                            </span>
                          </>
                        )}
                        {isOnBreak && (
                          <>
                            <span className="font-mono text-lg tracking-wider leading-none">
                              {fmtElapsed(elapsed)}
                            </span>
                            <span className="text-[8px] font-mono text-[#fca311]/70 uppercase tracking-widest mt-1 block">
                              On Break
                            </span>
                          </>
                        )}
                        {!isWorking && !isOnBreak && (
                          <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#7ec8e3] transition-colors">
                            Select ➔
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          /* Locked Personal Device Screen */
          <div className="mt-8 p-8 rounded-2xl border border-slate-800 bg-[#111827]/30 backdrop-blur-md text-center shadow-xl max-w-md mx-auto">
            <div className="text-4xl mb-4 select-none">📱</div>
            <h2 className="text-lg font-black text-white font-heading mb-2">
              Using a Personal Device?
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed mb-6 max-w-[280px] mx-auto font-sans">
              The station roster is locked to the park tablet. Please open the Employee Portal to submit clock punches verified by your GPS location.
            </p>
            <button
              onClick={() => setScreen("portal-select")}
              className="bg-[#7ec8e3] text-[#070a13] font-bold text-xs px-6 py-3 rounded-xl uppercase tracking-wider hover:bg-[#68b4d0] active:scale-95 transition-all w-full cursor-pointer font-heading"
            >
              Open Employee Portal
            </button>
          </div>
        )}
        
      </div>
    </div>
  )
}
