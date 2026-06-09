import { useState, useEffect, useRef } from "react"
import { ROLE_COLORS, fmtElapsed, fmtMoney } from "../lib/utils"
import { jsPDF } from "jspdf"
import { supabase } from "../lib/supabase"

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export default function PortalView({
  portalEmp,
  setPortalEmp,
  setScreen,
  clockedIn,
  getElapsed,
  activeWeekKey,
  schedules,
  timesheets,
  formatShiftDisplay,
  onClockAction, // callback (actionType) -> returns promise
  announcements
}) {
  const [gpsStatus, setGpsStatus] = useState("unverified") // 'unverified' | 'checking' | 'verified' | 'error'
  const [gpsDistance, setGpsDistance] = useState(null)
  const [gpsError, setGpsError] = useState("")
  const [punchPending, setPunchPending] = useState(false)

  // Stations & Auto-out boundary states
  const [stations, setStations] = useState([])
  const [activeStation, setActiveStation] = useState(null)
  const [outOfBounds, setOutOfBounds] = useState(false)
  const [outOfBoundsTime, setOutOfBoundsTime] = useState(60)

  const watchIdRef = useRef(null)
  const outOfBoundsTimerRef = useRef(null)

  // Fetch statement data
  const s = timesheets[portalEmp.id] || { hours: "0.00", regH: "0.00", otH: "0.00", gross: 0, fed: 0, state: 0, county: 0, fica: 0, netPay: 0 }
  const wk = schedules[activeWeekKey] || {}
  const statusRec = clockedIn[portalEmp.id]
  const isWorking = statusRec?.status === "IN"
  const isOnBreak = statusRec?.status === "BREAK"
  const isOff = !statusRec
  
  const elapsed = getElapsed(portalEmp.id)

  const verifyGPS = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        const errMsg = "GPS location is not supported by your browser."
        setGpsStatus("error")
        setGpsError(errMsg)
        reject(errMsg)
        return
      }

      setGpsStatus("checking")
      setGpsError("")

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          let activeStations = stations
          if (activeStations.length === 0) {
            const { data } = await supabase.from("stations").select("*")
            if (data) {
              activeStations = data
              setStations(data)
            }
          }

          if (activeStations.length === 0) {
            setGpsStatus("error")
            setGpsError("No stations configured in the database.")
            reject("No stations configured.")
            return
          }

          let nearest = null
          let minDistance = Infinity
          let insideStation = null

          activeStations.forEach(st => {
            const dist = getDistanceFromLatLonInMeters(
              st.latitude,
              st.longitude,
              position.coords.latitude,
              position.coords.longitude
            )
            if (dist < minDistance) {
              minDistance = dist
              nearest = st
            }
            if (dist <= st.radius) {
              insideStation = st
            }
          })

          const roundedDist = Math.round(minDistance)
          setGpsDistance(roundedDist)

          if (insideStation) {
            setGpsStatus("verified")
            setActiveStation(insideStation)
            resolve({ distance: roundedDist, station: insideStation, coords: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } })
          } else {
            setGpsStatus("error")
            setActiveStation(null)
            const msg = `Outside all boundaries. Nearest: ${nearest?.name} (${roundedDist}m away, limit ${nearest?.radius}m).`
            setGpsError(msg)
            reject(msg)
          }
        },
        (err) => {
          setGpsStatus("error")
          const msg = "Location permission denied or timed out. Please allow GPS access."
          setGpsError(msg)
          reject(msg)
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      )
    })
  }

  // Fetch stations on mount
  useEffect(() => {
    const fetchStations = async () => {
      const { data } = await supabase.from("stations").select("*")
      if (data) setStations(data)
    }
    fetchStations()
  }, [])

  // Verify GPS automatically on mount
  useEffect(() => {
    verifyGPS().catch(() => {})
  }, [stations])

  // Geofence active boundary watcher
  useEffect(() => {
    if (isWorking) {
      if (navigator.geolocation) {
        const handleWatchSuccess = (position) => {
          let activeStations = stations
          let isInsideAny = false
          
          if (activeStations.length > 0) {
            activeStations.forEach(st => {
              const dist = getDistanceFromLatLonInMeters(
                st.latitude,
                st.longitude,
                position.coords.latitude,
                position.coords.longitude
              )
              if (dist <= st.radius) {
                isInsideAny = true
              }
            })
            
            if (isInsideAny) {
              setOutOfBounds(false)
            } else {
              setOutOfBounds(true)
            }
          }
        }
        
        const handleWatchError = (err) => {
          console.warn("Watch position error:", err)
          setOutOfBounds(true)
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
          handleWatchSuccess,
          handleWatchError,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        )
      }
    } else {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      setOutOfBounds(false)
    }

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [isWorking, stations])

  // Out of bounds countdown and auto-out logger
  useEffect(() => {
    if (outOfBounds && isWorking) {
      setOutOfBoundsTime(60)
      
      outOfBoundsTimerRef.current = setInterval(() => {
        setOutOfBoundsTime(prev => {
          if (prev <= 1) {
            clearInterval(outOfBoundsTimerRef.current)
            triggerAutoOut()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (outOfBoundsTimerRef.current) {
        clearInterval(outOfBoundsTimerRef.current)
      }
      setOutOfBoundsTime(60)
    }

    return () => {
      if (outOfBoundsTimerRef.current) {
        clearInterval(outOfBoundsTimerRef.current)
      }
    }
  }, [outOfBounds, isWorking])

  const triggerAutoOut = async () => {
    alert("AUTO-OUT: You have been automatically clocked out for leaving your work boundary for more than 60 seconds.")
    await onClockAction("AUTO-OUT")
  }

  // PDF stub compiler and download trigger
  const generatePDFStub = () => {
    const doc = new jsPDF()
    
    // Theme Colors
    const primaryColor = [12, 18, 32] 
    const accentColor = [0, 180, 216] 
    const lightBg = [245, 247, 250] 
    
    // Header Branding
    doc.setFillColor(...primaryColor)
    doc.rect(0, 0, 210, 40, "F")
    
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(22)
    doc.text("PINE LAKE RECREATION", 15, 22)
    
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(180, 200, 220)
    doc.text("Official Employee Pay Statement", 15, 30)
    
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.text(`Issued: ${new Date().toLocaleDateString()}`, 155, 22)
    doc.text(`Period Start: ${activeWeekKey}`, 155, 30)

    doc.setTextColor(50, 50, 50)
    
    // Employee Info
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("EMPLOYEE INFORMATION", 15, 55)
    
    doc.setDrawColor(220, 220, 220)
    doc.line(15, 58, 195, 58)
    
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    doc.text(`Name: ${portalEmp.name}`, 15, 68)
    doc.text(`Role: ${portalEmp.role}`, 15, 76)
    doc.text(`Base Rate: $${Number(portalEmp.baseRate || 0).toFixed(2)}/hr`, 15, 84)
    
    doc.text(`Employee ID: #100${portalEmp.id}`, 110, 68)
    doc.text(`Tax Rate (Fed/State): ${Number(portalEmp.fedTaxRate || 0)}% / ${Number(portalEmp.stateTaxRate || 0)}%`, 110, 76)
    doc.text(`FICA Rate: ${Number(portalEmp.ficaTaxRate || 0)}%`, 110, 84)

    // Earnings Summary Table
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("EARNINGS SUMMARY", 15, 102)
    doc.line(15, 105, 195, 105)
    
    doc.setFillColor(...lightBg)
    doc.rect(15, 110, 180, 8, "F")
    doc.setFontSize(10)
    doc.text("Description", 20, 115)
    doc.text("Hours", 90, 115)
    doc.text("Rate", 130, 115)
    doc.text("Total", 170, 115)
    
    doc.setFont("helvetica", "normal")
    doc.text("Regular Hours Worked", 20, 126)
    doc.text(s.regH.toString(), 90, 126)
    doc.text(`$${Number(portalEmp.baseRate || 0).toFixed(2)}`, 130, 126)
    const regTotal = parseFloat(s.regH) * parseFloat(portalEmp.baseRate || 0)
    doc.text(`$${regTotal.toFixed(2)}`, 170, 126)
    
    doc.text("Overtime Hours (x1.5)", 20, 134)
    doc.text(s.otH.toString(), 90, 134)
    doc.text(`$${(Number(portalEmp.baseRate || 0) * 1.5).toFixed(2)}`, 130, 134)
    const otTotal = parseFloat(s.otH) * parseFloat(portalEmp.baseRate || 0) * 1.5
    doc.text(`$${otTotal.toFixed(2)}`, 170, 134)
    
    const bonusRate = Number(portalEmp.bonusRate || 0)
    doc.text("Role Bonus Allowance", 20, 142)
    doc.text(s.hours.toString(), 90, 142)
    doc.text(`$${bonusRate.toFixed(2)}`, 130, 142)
    const bonusTotal = parseFloat(s.hours) * bonusRate
    doc.text(`$${bonusTotal.toFixed(2)}`, 170, 142)
    
    doc.setFont("helvetica", "bold")
    doc.text("Gross Earnings", 20, 152)
    doc.text(`$${Number(s.gross || 0).toFixed(2)}`, 170, 152)
    doc.line(15, 155, 195, 155)

    // Deductions Section
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("TAXES & DEDUCTIONS", 15, 168)
    doc.line(15, 171, 195, 171)
    
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    doc.text("Federal Income Tax Withholding", 20, 181)
    doc.text(`-$${Number(s.fed || 0).toFixed(2)}`, 170, 181)
    
    doc.text("State Income Tax Withholding", 20, 189)
    doc.text(`-$${Number(s.state || 0).toFixed(2)}`, 170, 189)
    
    doc.text("FICA Social Security & Medicare", 20, 197)
    doc.text(`-$${Number(s.fica || 0).toFixed(2)}`, 170, 197)
    
    if (Number(portalEmp.countyTaxRate || 0) > 0) {
      doc.text("Local County Tax", 20, 205)
      doc.text(`-$${Number(s.county || 0).toFixed(2)}`, 170, 205)
    }
    
    doc.line(15, 212, 195, 212)

    // Net pay card
    doc.setFillColor(...lightBg)
    doc.rect(15, 218, 180, 18, "F")
    doc.setDrawColor(...accentColor)
    doc.rect(15, 218, 180, 18, "S")
    
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.text("ESTIMATED NET TAKE-HOME PAY", 25, 230)
    
    doc.setTextColor(0, 150, 100) 
    doc.setFontSize(15)
    doc.text(`$${Number(s.netPay || 0).toFixed(2)}`, 160, 230)
    
    doc.setFont("helvetica", "italic")
    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text("Thank you for your service at Pine Lake Recreation. Have a week!", 105, 260, null, null, "center")
    
    doc.save(`Paystub_${portalEmp.name.replace(" ", "_")}_${activeWeekKey}.pdf`)
  }

  const handlePunch = async (actionType) => {
    if (punchPending) return
    setPunchPending(true)

    try {
      // Step 1: Force GPS check
      const dist = await verifyGPS()
      
      // Step 2: Invoke clock action
      await onClockAction(actionType, dist?.coords)
    } catch (err) {
      alert(err || "Punch verification failed.")
    } finally {
      setPunchPending(false)
    }
  }

  return (
    <div className="bg-transparent min-h-screen text-[#f3f4f6] selection:bg-[#7ec8e3]/30 selection:text-white font-sans antialiased">
      <div className="max-w-3xl mx-auto px-4 py-8">
        
        {/* Top Header */}
        <div className="flex items-center justify-between pb-6 mb-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-xs shadow-md"
              style={{ backgroundColor: ROLE_COLORS[portalEmp.role] || "#7ec8e3" }}
            >
              {portalEmp.avatar}
            </div>
            <div>
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest leading-none mb-1">
                Employee Portal
              </div>
              <h1 className="text-lg font-black text-white leading-none font-heading">
                {portalEmp.name}
              </h1>
            </div>
          </div>
          
          <button
            onClick={() => {
              setPortalEmp(null)
              setScreen("kiosk")
            }}
            className="text-xs bg-slate-900 border border-slate-800 text-gray-400 hover:text-white hover:bg-slate-800 py-1.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95"
          >
            Sign Out
          </button>
        </div>

        {outOfBounds && isWorking && (
          <div className="mb-6 p-4 bg-[#ef476f]/20 border border-[#ef476f] text-[#ef476f] rounded-2xl animate-pulse flex flex-col items-center justify-center text-center">
            <span className="text-sm font-bold uppercase tracking-wider font-mono">⚠️ OUT OF BOUNDS WARNING</span>
            <span className="text-xs text-white mt-1">Return to a work station in <span className="font-mono text-sm font-black text-[#ef476f] bg-slate-950/80 px-2 py-0.5 rounded border border-[#ef476f]/30">{outOfBoundsTime}s</span> to avoid automatic clock-out.</span>
          </div>
        )}

        {isWorking && elapsed >= 18000 && (
          <div 
            onClick={() => handlePunch("BREAK_START")}
            className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 hover:border-amber-500/60 text-amber-300 rounded-3xl cursor-pointer transition-all duration-300 hover:scale-[1.01] shadow-lg shadow-amber-500/5 flex items-center gap-4 animate-pulse"
          >
            <div className="text-3xl">☕</div>
            <div className="text-left">
              <div className="text-xs font-bold uppercase tracking-wider font-heading text-amber-400">Compliance Alert: Break Required</div>
              <div className="text-xs text-gray-300 mt-0.5">
                You've logged <span className="font-mono font-bold text-white bg-slate-900/60 px-1.5 py-0.5 rounded border border-white/5">{(elapsed / 3600).toFixed(1)}h</span> of continuous work. Tap here to start your mandatory break.
              </div>
            </div>
          </div>
        )}

        {/* Live Notices Banner */}
        {announcements && announcements.length > 0 ? (
          <div className="mb-6 p-4 rounded-3xl border border-cyan-500/10 bg-cyan-500/5 backdrop-blur-md shadow-lg flex items-start gap-3.5">
            <div className="text-xl select-none mt-0.5 animate-bounce">📢</div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-mono text-[#7ec8e3] font-bold uppercase tracking-widest">
                Active Announcements
              </div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {announcements.map((ann, idx) => (
                  <div key={idx} className="text-xs text-slate-300 leading-normal font-sans">
                    • {ann.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 p-4 rounded-3xl border border-white/5 bg-slate-900/20 backdrop-blur-md flex items-center gap-3.5">
            <div className="text-xl select-none">🌿</div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-widest">
                No active announcements
              </div>
              <p className="text-xs text-slate-400 leading-normal font-sans mt-0.5">
                Welcome to Pine Lake Employee Portal! Be safe and have a great shift.
              </p>
            </div>
          </div>
        )}

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Column Left: Time clock & GPS */}
          <div className="flex flex-col gap-6">
            
            {/* Clocking Card */}
            <div className="p-6 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl text-center relative overflow-hidden">
              <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4">
                Punch Time Clock
              </div>
              
              {/* Ticking live duration */}
              <div className="h-20 flex flex-col justify-center mb-6">
                {!isOff ? (
                  <>
                    <div className={`text-4xl font-mono font-black tracking-widest ${isWorking ? "text-[#06d6a0]" : "text-[#fca311]"}`}>
                      {fmtElapsed(elapsed)}
                    </div>
                    <span className="text-[9px] font-mono text-gray-500 uppercase tracking-[0.2em] mt-1">
                      Time on {isWorking ? "Shift" : "Break"}
                    </span>
                  </>
                ) : (
                  <div className="text-2xl font-bold text-gray-500 font-heading uppercase tracking-widest">
                    Off Clock
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                {isOff && (
                  <button
                    disabled={punchPending}
                    onClick={() => handlePunch("IN")}
                    className="w-full bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] disabled:opacity-50 py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] font-heading cursor-pointer shadow-lg shadow-[#06d6a0]/5"
                  >
                    {punchPending ? "Verifying..." : "Clock In"}
                  </button>
                )}
                {isWorking && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled={punchPending}
                      onClick={() => handlePunch("BREAK_START")}
                      className="bg-slate-900 border border-slate-800 text-gray-200 hover:bg-slate-800 disabled:opacity-50 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all active:scale-[0.98] font-heading cursor-pointer"
                    >
                      Start Break
                    </button>
                    <button
                      disabled={punchPending}
                      onClick={() => handlePunch("OUT")}
                      className="bg-[#ef476f] text-[#070a13] hover:bg-[#d43d5e] disabled:opacity-50 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all active:scale-[0.98] font-heading cursor-pointer"
                    >
                      Clock Out
                    </button>
                  </div>
                )}
                {isOnBreak && (
                  <button
                    disabled={punchPending}
                    onClick={() => handlePunch("BREAK_END")}
                    className="w-full bg-[#fca311] text-[#070a13] hover:bg-[#e0910e] disabled:opacity-50 py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] font-heading cursor-pointer shadow-lg"
                  >
                    {punchPending ? "Verifying..." : "End Break"}
                  </button>
                )}
              </div>
            </div>

            {/* GPS Geofencing Widget */}
            <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase">
                  GPS Geofencing
                </span>
                <button
                  onClick={verifyGPS}
                  disabled={gpsStatus === "checking"}
                  className="text-[10px] font-mono text-[#7ec8e3] hover:text-white uppercase tracking-widest bg-slate-900/50 hover:bg-slate-800 py-1 px-2.5 rounded-md border border-white/5 cursor-pointer disabled:opacity-50"
                >
                  {gpsStatus === "checking" ? "Verifying..." : "Verify GPS"}
                </button>
              </div>

              {/* Geofencing Interface */}
              <div className="flex items-center gap-4">
                <div className="relative w-14 h-14 flex items-center justify-center bg-slate-950 rounded-2xl border border-white/5 shrink-0 overflow-hidden">
                  {/* Rotating radar graphic */}
                  {gpsStatus === "checking" && (
                    <div className="absolute inset-0 border-2 border-[#7ec8e3]/30 rounded-full animate-radar" />
                  )}
                  <div className={`text-2xl select-none ${
                    gpsStatus === "verified" ? "text-[#06d6a0]" : gpsStatus === "error" ? "text-[#ef476f]" : "text-gray-500"
                  }`}>
                    {gpsStatus === "verified" ? "📡" : gpsStatus === "error" ? "❌" : "🛰️"}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black text-white font-heading">
                    {gpsStatus === "checking" && "Querying Satellites..."}
                    {gpsStatus === "verified" && `Inside ${activeStation?.name || "Station"}`}
                    {gpsStatus === "error" && "Location Denied"}
                    {gpsStatus === "unverified" && "Awaiting Check"}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 leading-normal font-sans">
                    {gpsStatus === "checking" && "Retrieving device coordinates..."}
                    {gpsStatus === "verified" && `Verified: ${gpsDistance}m from station center (limit ${activeStation?.radius}m).`}
                    {gpsStatus === "error" && gpsError}
                    {gpsStatus === "unverified" && "Click check to verify coordinate bounds."}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Column Right: Payroll & Schedules */}
          <div className="flex flex-col gap-6">
            
            {/* Wages Statement Stub */}
            <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
              <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4">
                Week Statement Summary
              </div>
              
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4 gap-4">
                <div className="flex-1 flex flex-col gap-4">
                  <div>
                    <div className="text-2xl font-mono font-black text-[#06d6a0] leading-none">
                      {s.hours}
                    </div>
                    <span className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1.5 block">
                      Logged Hours
                    </span>
                  </div>
                  <div>
                    <div className="text-lg font-mono font-bold text-white leading-none">
                      {fmtMoney(s.gross)}
                    </div>
                    <span className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1.5 block">
                      Gross Pay
                    </span>
                  </div>
                </div>

                {/* Circular Hours Gauge */}
                {(() => {
                  const hrs = parseFloat(s.hours) || 0
                  const limit = 40
                  const radius = 28
                  const stroke = 5.5
                  const circumference = 2 * Math.PI * radius // ~175.929
                  
                  // Standard vs Overtime calculations
                  const stdHours = Math.min(hrs, limit)
                  const stdPercent = (stdHours / limit) * 100
                  const strokeOffset = circumference - (stdPercent / 100) * circumference
                  
                  // Color selection: Standard gets glowing cyan/green, Overtime gets hot pink
                  const ringColor = hrs > limit ? "#ef476f" : "#06d6a0"
                  
                  return (
                    <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 72 72">
                        {/* Background ring */}
                        <circle
                          cx="36"
                          cy="36"
                          r={radius}
                          fill="none"
                          stroke="rgba(255, 255, 255, 0.03)"
                          strokeWidth={stroke}
                        />
                        {/* Progress ring */}
                        <circle
                          cx="36"
                          cy="36"
                          r={radius}
                          fill="none"
                          stroke={ringColor}
                          strokeWidth={stroke}
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeOffset}
                          strokeLinecap="round"
                          className="transition-all duration-500"
                          style={{
                            filter: `drop-shadow(0 0 3px ${ringColor}80)`
                          }}
                        />
                      </svg>
                      {/* Hours Center Text */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-center">
                        <span className="text-sm font-black font-mono text-white leading-none">
                          {hrs.toFixed(1)}h
                        </span>
                        <span className="text-[8px] text-gray-500 font-mono leading-none mt-1">
                          {hrs > limit ? "OVERTIME" : `of ${limit}h`}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Tax Breakdowns */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs py-1 text-gray-400 font-sans border-b border-white/5">
                  <span>Fed Tax Withholding</span>
                  <span className="font-mono text-gray-200">-{fmtMoney(s.fed)}</span>
                </div>
                <div className="flex justify-between text-xs py-1 text-gray-400 font-sans border-b border-white/5">
                  <span>State Tax Withholding</span>
                  <span className="font-mono text-gray-200">-{fmtMoney(s.state)}</span>
                </div>
                <div className="flex justify-between text-xs py-1 text-gray-400 font-sans border-b border-white/5">
                  <span>FICA Withholding</span>
                  <span className="font-mono text-gray-200">-{fmtMoney(s.fica)}</span>
                </div>
                {Number(portalEmp.countyTaxRate || 0) > 0 && (
                  <div className="flex justify-between text-xs py-1 text-gray-400 font-sans border-b border-white/5">
                    <span>County Tax</span>
                    <span className="font-mono text-gray-200">-{fmtMoney(s.county)}</span>
                  </div>
                )}
              </div>

              {/* Net pay summary */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl flex justify-between items-center">
                <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">
                  Estimated Take-Home
                </span>
                <span className="text-lg font-mono font-black text-[#fca311]">
                  {fmtMoney(s.netPay)}
                </span>
              </div>
              <button
                onClick={generatePDFStub}
                className="mt-4 w-full bg-[#7ec8e3]/10 border border-[#7ec8e3]/30 text-[#7ec8e3] hover:bg-[#7ec8e3]/20 font-heading font-black text-xs uppercase tracking-wider py-3 rounded-2xl transition-all active:scale-[0.98] cursor-pointer"
              >
                📄 Download PDF Paystub
              </button>
            </div>

            {/* My Weekly Schedules */}
            <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
              <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                My Weekly Shifts
              </div>
              
              <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto pr-1">
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => {
                  const shift = wk[day]?.[portalEmp.id] || "OFF"
                  const isOffDay = shift === "OFF"
                  
                  return (
                    <div key={day} className="flex justify-between items-center py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-xs text-gray-400 font-sans">{day}</span>
                      <div className="text-right text-xs font-mono">
                        {isOffDay ? (
                          <span className="text-gray-500 font-bold uppercase text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-white/5">OFF</span>
                        ) : (
                          formatShiftDisplay(shift)
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
