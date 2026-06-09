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
  announcements
}) {
  const isOfficialKiosk = !!localStorage.getItem("official_kiosk_token")
  const activeCount = Object.values(clockedIn).filter((s) => s.status === "IN").length

  // Safety status color styling
  const getFlagStyles = (flag) => {
    if (flag === "RED") {
      return {
        badge: "bg-red-500/10 border-red-500/20 text-red-400 shadow-[0_0_15px_rgba(239,71,111,0.05)]",
        dot: "bg-red-500 shadow-[0_0_8px_rgba(239,71,111,0.6)]"
      }
    }
    if (flag === "YELLOW") {
      return {
        badge: "bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-[0_0_15px_rgba(252,163,17,0.05)]",
        dot: "bg-amber-500 shadow-[0_0_8px_rgba(252,163,17,0.6)]"
      }
    }
    return {
      badge: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(6,214,160,0.05)]",
      dot: "bg-emerald-500 shadow-[0_0_8px_rgba(6,214,160,0.6)]"
    }
  }

  const timeString = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const dateString = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })

  return (
    <div className="bg-transparent text-[#f3f4f6] selection:bg-[#7ec8e3]/30 selection:text-white font-sans antialiased min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Offline & Queue Sync Banner */}
        {(!isOnline || offlineCount > 0) && (
          <div className={`mb-6 p-3.5 rounded-2xl border flex items-center justify-between transition-all duration-300 ${
            !isOnline 
              ? "bg-[#270d18] border-[#ef476f]/30 text-[#ef476f] shadow-[0_0_15px_rgba(239,71,111,0.15)] animate-pulse"
              : "bg-[#271d0d] border-[#fca311]/30 text-[#fca311] shadow-[0_0_15px_rgba(252,163,17,0.15)]"
          }`}>
            <div className="flex items-center gap-2.5 text-sm font-semibold">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${!isOnline ? "bg-[#ef476f]" : "bg-[#fca311]"}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${!isOnline ? "bg-[#ef476f]" : "bg-[#fca311]"}`}></span>
              </span>
              <span>{!isOnline ? "Device is Offline" : "Online - Connecting..."}</span>
            </div>
            {offlineCount > 0 && (
              <span className="text-xs font-mono bg-black/40 px-3 py-1.5 rounded-xl border border-white/5 font-semibold text-slate-300">
                {offlineCount} punch{offlineCount > 1 ? "es" : ""} queued offline
              </span>
            )}
          </div>
        )}

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT SIDEBAR COLUMN: Brand, Time Clock, Weather, Announcements */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Branding Hero Banner */}
            <div className="relative w-full rounded-3xl overflow-hidden shadow-2xl border border-white/10 group">
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f19] via-[#0b0f19]/30 to-transparent z-10"></div>
              <img 
                src="/assets/hero_visual.png" 
                alt="Pine Lake Recreation Hero" 
                className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-700 ease-out select-none" 
              />
              <div className="absolute bottom-4 left-0 w-full text-center z-20">
                <div className="text-[9px] font-mono font-bold text-[#7ec8e3] uppercase tracking-[0.22em] drop-shadow-md leading-none mb-2">
                  PINE LAKE RECREATION
                </div>
                <h1 className="text-xl font-black text-white leading-tight font-heading tracking-tight drop-shadow-lg uppercase">
                  Station Time Clock
                </h1>
              </div>
            </div>

            {/* Glowing System Time Clock (Smaller) */}
            <div className="flex flex-col items-center justify-center p-5 rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-md shadow-xl text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-b from-[#7ec8e3]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
              <span className="text-[8px] font-bold text-slate-500 font-mono tracking-[0.2em] uppercase mb-1.5 select-none">SYSTEM TIME</span>
              <div className="text-3xl font-black font-heading tracking-widest bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent filter drop-shadow-[0_2px_6px_rgba(255,255,255,0.1)] select-none">
                {timeString}
              </div>
              <div className="text-[10px] text-[#7ec8e3] font-semibold tracking-widest uppercase font-mono mt-1.5 select-none">
                {dateString}
              </div>
            </div>

            {/* Weather / Water Conditions Banner */}
            <div className="p-5 rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-md shadow-xl">
              <div className="text-[10px] font-bold text-slate-500 font-mono tracking-[0.2em] uppercase mb-4 border-b border-white/5 pb-2">
                PARK CONDITIONS
              </div>
              
              <div className="grid grid-cols-3 gap-3.5">
                {/* Weather Info */}
                <div className="flex flex-col items-center text-center p-2.5 rounded-2xl bg-slate-950/20 border border-white/5">
                  <span className="text-2xl mb-1.5 select-none">
                    {weather.code === 0 && "☀️"}
                    {weather.code >= 1 && weather.code <= 3 && "⛅"}
                    {(weather.code === 45 || weather.code === 48) && "🌫️"}
                    {weather.code >= 51 && weather.code <= 67 && "🌧️"}
                    {weather.code >= 71 && weather.code <= 77 && "🌨️"}
                    {weather.code >= 80 && weather.code <= 82 && "🌦️"}
                    {weather.code >= 95 && "⛈️"}
                  </span>
                  <span className="text-[10px] font-black text-white leading-tight font-heading truncate max-w-full">{weather.text}</span>
                  <span className="text-[9px] text-slate-400 font-mono mt-1 font-semibold">{weather.temp}°F Air</span>
                </div>

                {/* Wind / Water Info */}
                <div className="flex flex-col items-center text-center p-2.5 rounded-2xl bg-slate-950/20 border border-white/5">
                  <span className="text-2xl mb-1.5 select-none">💨</span>
                  <span className="text-[10px] font-black text-white leading-tight font-heading">{weather.wind} mph Wind</span>
                  <span className="text-[9px] text-slate-400 font-mono mt-1 font-semibold">{weather.waterTemp}°F Water</span>
                </div>

                {/* Safety flag */}
                <div className="flex flex-col items-center justify-between text-center p-2.5 rounded-2xl bg-slate-950/20 border border-white/5">
                  <span className="text-[8px] font-mono text-slate-500 uppercase tracking-widest">Waterfront</span>
                  
                  <div className="my-1 flex items-center justify-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getFlagStyles(weather.flag).dot}`}></span>
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${getFlagStyles(weather.flag).dot.split(" ")[0]}`}></span>
                    </span>
                    <span className={`text-[9px] font-mono font-black tracking-widest px-2 py-0.5 rounded-lg border ${getFlagStyles(weather.flag).badge}`}>
                      {weather.flag}
                    </span>
                  </div>
                  
                  <span className="text-[8px] font-mono text-slate-500 uppercase tracking-widest">Flag Status</span>
                </div>
              </div>
            </div>

            {/* Custom Announcements Feed */}
            <div className="p-5 rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-md shadow-xl flex flex-col min-h-[160px]">
              <div className="text-[10px] font-bold text-slate-500 font-mono tracking-[0.2em] uppercase mb-3.5 border-b border-white/5 pb-2 flex items-center justify-between">
                <span>Announcements</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              </div>
              
              <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto max-h-[160px] pr-1">
                {announcements && announcements.length > 0 ? (
                  announcements.map((ann, idx) => (
                    <div key={idx} className="p-3 rounded-2xl bg-slate-950/15 border border-white/5 flex gap-2.5 items-start transition-all hover:bg-slate-950/25">
                      <span className="text-xs text-cyan-400 select-none mt-0.5">📢</span>
                      <p className="text-xs text-slate-300 leading-normal font-sans">{ann.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 font-sans text-xs py-4">
                    <span className="text-xl mb-1 select-none">🌿</span>
                    No active announcements today.
                  </div>
                )}
              </div>
            </div>
            
          </div>

          {/* RIGHT COLUMN: Quick Navigation & Staff Roster or Device Lock */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Quick Portal Access and Manager buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setScreen("portal-select")}
                className="flex flex-col items-center justify-center p-5 rounded-3xl border border-white/5 bg-slate-900/35 backdrop-blur-xl hover:bg-slate-800/40 hover:border-[#7ec8e3]/30 active:scale-[0.98] transition-all duration-300 group cursor-pointer shadow-lg hover:shadow-[#7ec8e3]/5"
              >
                <span className="text-3xl mb-2.5 group-hover:scale-110 transition-transform duration-300 select-none">👤</span>
                <span className="text-sm font-black text-white font-heading">Employee Portal</span>
                <span className="text-[9px] text-slate-400 font-mono mt-1 uppercase tracking-wider font-semibold">
                  Personal Dashboard
                </span>
              </button>
              
              <button
                onClick={() => {
                  setMgrLoginMode("select")
                  setScreen("manager-login")
                }}
                className="flex flex-col items-center justify-center p-5 rounded-3xl border border-white/5 bg-slate-900/35 backdrop-blur-xl hover:bg-slate-800/40 hover:border-[#fca311]/30 active:scale-[0.98] transition-all duration-300 group cursor-pointer shadow-lg hover:shadow-[#fca311]/5"
              >
                <span className="text-3xl mb-2.5 group-hover:scale-110 transition-transform duration-300 select-none">🔐</span>
                <span className="text-sm font-black text-white font-heading">Manager Access</span>
                <span className="text-[9px] text-slate-400 font-mono mt-1 uppercase tracking-wider font-semibold">
                  Station Admin panel
                </span>
              </button>
            </div>

            {/* Staff Roster or Personal Device Message */}
            {isOfficialKiosk ? (
              <div className="p-6 rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-md shadow-2xl">
                
                {/* Roster Header */}
                <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-3">
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] font-bold text-slate-500 font-mono tracking-[0.2em] uppercase">
                      STAFF ROSTER
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono mt-1.5 uppercase tracking-wide">
                      Select name to clock-in or break
                    </span>
                  </div>
                  <div className="text-xs text-[#06d6a0] font-mono flex items-center gap-1.5 font-bold bg-[#06d6a0]/10 px-3.5 py-1.5 rounded-full border border-[#06d6a0]/25 shadow-inner">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#06d6a0] animate-pulse"></span>
                    {activeCount} active
                  </div>
                </div>
                
                {/* Roster List Grid */}
                <div className="flex flex-col gap-3 max-h-[460px] overflow-y-auto pr-1">
                  {employees.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 border border-dashed border-white/5 rounded-2xl bg-slate-950/25 font-mono text-xs">
                      Loading roster database...
                    </div>
                  ) : (
                    employees.map((emp) => {
                      const s = clockedIn[emp.id]
                      const isWorking = s?.status === "IN"
                      const isOnBreak = s?.status === "BREAK"
                      const elapsed = getElapsed(emp.id)
                      
                      let cardStyle = "bg-slate-950/20 border-white/5 hover:border-[#7ec8e3]/30 hover:bg-slate-800/20 shadow-sm"
                      
                      if (isWorking) {
                        cardStyle = "bg-[#06d6a0]/5 border-[#06d6a0]/30 hover:border-[#06d6a0]/50 hover:bg-[#06d6a0]/10 shadow-[0_0_15px_rgba(6,214,160,0.03)]"
                      } else if (isOnBreak) {
                        cardStyle = "bg-[#fca311]/5 border-[#fca311]/30 hover:border-[#fca311]/50 hover:bg-[#fca311]/10 shadow-[0_0_15px_rgba(252,163,17,0.03)]"
                      }

                      return (
                        <button
                          key={emp.id}
                          onClick={() => {
                            setAuthEmp(emp)
                            setScreen("kiosk-auth")
                          }}
                          className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 hover:scale-[1.012] active:scale-[0.99] text-left cursor-pointer group ${cardStyle}`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div
                              className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-slate-950 font-heading text-sm shadow-md shrink-0 transition-transform duration-200 group-hover:scale-105"
                              style={{ 
                                backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3",
                                boxShadow: `0 0 10px ${(ROLE_COLORS[emp.role] || "#7ec8e3")}35` 
                              }}
                            >
                              {emp.avatar}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-black text-white font-heading truncate">
                                {emp.name}
                              </div>
                              <div
                                className="text-[10px] font-bold tracking-wider mt-1 uppercase"
                                style={{ color: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                              >
                                {emp.role}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end shrink-0 pl-3">
                            {isWorking && (
                              <>
                                <span className="font-mono text-base font-black text-[#06d6a0] tracking-wider leading-none">
                                  {fmtElapsed(elapsed)}
                                </span>
                                <div className="flex items-center gap-1 mt-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#06d6a0] animate-pulse"></span>
                                  <span className="text-[8px] font-mono text-[#06d6a0]/80 uppercase tracking-widest font-black">
                                    Working
                                  </span>
                                </div>
                              </>
                            )}
                            {isOnBreak && (
                              <>
                                <span className="font-mono text-base font-black text-[#fca311] tracking-wider leading-none">
                                  {fmtElapsed(elapsed)}
                                </span>
                                <div className="flex items-center gap-1 mt-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#fca311] animate-pulse"></span>
                                  <span className="text-[8px] font-mono text-[#fca311]/80 uppercase tracking-widest font-black">
                                    On Break
                                  </span>
                                </div>
                              </>
                            )}
                            {!isWorking && !isOnBreak && (
                              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-cyan-400 transition-colors">
                                Punch In ➔
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
              <div className="p-8 rounded-3xl border border-white/5 bg-slate-900/35 backdrop-blur-xl text-center shadow-2xl max-w-md mx-auto w-full">
                <div className="w-16 h-16 mx-auto mb-5 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 rounded-2xl border border-white/5 flex items-center justify-center text-3xl shadow-inner select-none">
                  📱
                </div>
                
                <h2 className="text-xl font-black text-white font-heading mb-2">
                  Personal Device Mode
                </h2>
                
                <p className="text-xs text-slate-400 leading-relaxed mb-6 font-sans">
                  The time clock roster is locked to the park kiosk tablet. Please log in to your personal account on the Employee Portal below to clock in via GPS.
                </p>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => setScreen("portal-select")}
                    className="bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-black text-xs px-6 py-3.5 rounded-2xl uppercase tracking-wider hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer font-heading shadow-lg shadow-cyan-400/15"
                  >
                    Access Employee Portal
                  </button>
                  
                  <button
                    onClick={() => {
                      setMgrLoginMode("select")
                      setScreen("manager-login")
                    }}
                    className="bg-transparent border border-white/5 text-slate-300 font-bold text-xs px-6 py-3 rounded-2xl uppercase tracking-wider hover:bg-white/5 hover:text-white active:scale-[0.98] transition-all cursor-pointer font-heading"
                  >
                    Manager Login
                  </button>
                </div>
                
                <div className="mt-8 border-t border-white/5 pt-4 text-center">
                  <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">
                    Pine Lake Recreation Security System
                  </span>
                </div>
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  )
}
