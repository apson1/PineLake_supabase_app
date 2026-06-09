import { useState } from "react"
import { ROLE_COLORS, fmtMoney } from "../lib/utils"

export default function AnalyticsDashboard({
  now,
  employees,
  schedules,
  allLogs,
  timesheets,
  activeWeekKey
}) {
  const [hoveredRole, setHoveredRole] = useState(null)
  const [hoveredPoint, setHoveredPoint] = useState(null)
  const [selectedDay, setSelectedDay] = useState("Monday")

  // --- 1. Labor Cost calculations & Donut Chart Data ---
  const roleCosts = {}
  let totalFacilityCost = 0

  employees.forEach((emp) => {
    const s = timesheets[emp.id] || { totalCost: 0 }
    const role = emp.role || "General"
    roleCosts[role] = (roleCosts[role] || 0) + s.totalCost
    totalFacilityCost += s.totalCost
  })

  // Format donut chart slices
  const activeSlices = []
  let cumulativePercent = 0

  Object.entries(roleCosts).forEach(([role, cost]) => {
    if (cost > 0) {
      const percentage = totalFacilityCost > 0 ? (cost / totalFacilityCost) * 100 : 0
      activeSlices.push({
        role,
        cost,
        percentage,
        color: ROLE_COLORS[role] || "#7ec8e3"
      })
    }
  })

  // Donut SVG parameters
  const radius = 50
  const strokeWidth = 16
  const circum = 2 * Math.PI * radius // ~314.159

  // Sort slices to keep colors aligned nicely
  activeSlices.sort((a, b) => b.cost - a.cost)

  // --- 2. Compliance calculations ---
  const weekLogs = allLogs.filter((log) => {
    // filter for logs in this active week (approx. 7 days from activeWeekKey)
    if (!activeWeekKey) return true
    const weekStart = new Date(activeWeekKey.replace("week_", "")) // Assuming activeWeekKey format is week_YYYY-MM-DD or standard Date
    const logDate = new Date(log.created_at)
    
    // Fallback: If not week_YYYY-MM-DD format, just parse standard YYYY-MM-DD
    const startStr = activeWeekKey.includes("week_") ? activeWeekKey.replace("week_", "") : activeWeekKey
    const startTime = new Date(startStr).getTime()
    const endTime = startTime + 7 * 24 * 60 * 60 * 1000
    
    return logDate.getTime() >= startTime && logDate.getTime() <= endTime
  })

  const totalPunches = weekLogs.length
  const suspiciousGPSCount = weekLogs.filter((l) => l.suspicious_gps).length
  const geofenceCompliance = totalPunches > 0 ? ((totalPunches - suspiciousGPSCount) / totalPunches) * 100 : 100

  // --- 3. Punctuality Rating ---
  let totalScheduledClockins = 0
  let onTimeClockins = 0

  weekLogs.forEach((log) => {
    if (log.action !== "IN") return

    const logDate = new Date(log.created_at)
    // Find day of week in local time
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const dayName = daysOfWeek[logDate.getDay()]
    
    // Look up schedule for this employee on this day
    const weekSched = schedules[activeWeekKey] || {}
    const daySched = weekSched[dayName] || {}
    const shiftStr = daySched[log.employee_id]

    if (shiftStr && shiftStr !== "OFF") {
      const timePart = shiftStr.split("|")[0]
      const times = timePart.split("-")
      if (times.length === 2) {
        const [schedH, schedM] = times[0].split(":").map(Number)
        const logH = logDate.getHours()
        const logM = logDate.getMinutes()

        const schedMinutes = schedH * 60 + schedM
        const logMinutes = logH * 60 + logM

        const diff = logMinutes - schedMinutes
        totalScheduledClockins++
        if (diff <= 10) {
          // Late only if clocked in more than 10 mins after schedule
          onTimeClockins++
        }
      }
    }
  })

  const punctualityRating = totalScheduledClockins > 0 ? (onTimeClockins / totalScheduledClockins) * 100 : 96 // high default if no records

  // --- 4. Staffing density by hour (selected day) ---
  const hoursRange = Array.from({ length: 11 }, (_, i) => 9 + i) // 9 AM to 7 PM (9 to 19)
  
  const getStaffingCountForHour = (hour) => {
    let count = 0
    const weekSched = schedules[activeWeekKey] || {}
    const daySched = weekSched[selectedDay] || {}

    Object.entries(daySched).forEach(([empId, shiftVal]) => {
      if (shiftVal && shiftVal !== "OFF") {
        const parts = shiftVal.split("|")
        const times = parts[0].split("-")
        if (times.length === 2) {
          const parseDecimal = (tStr) => {
            const [h, m] = tStr.split(":").map(Number)
            return h + m / 60
          }
          const start = parseDecimal(times[0])
          const end = parseDecimal(times[1])
          if (hour >= start && hour < end) {
            count++
          }
        }
      }
    })
    return count
  }

  const densityPoints = hoursRange.map((hour) => ({
    hour,
    label: hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`,
    count: getStaffingCountForHour(hour)
  }))

  const maxDensity = Math.max(...densityPoints.map((p) => p.count), 4)

  // Area Chart SVG geometry
  const chartW = 500
  const chartH = 200
  const marginX = 40
  const marginY = 30
  const drawW = chartW - 2 * marginX
  const drawH = chartH - 2 * marginY

  const getX = (index) => marginX + (index / (densityPoints.length - 1)) * drawW
  const getY = (count) => chartH - marginY - (count / maxDensity) * drawH

  // Build SVG path
  let pathD = ""
  let areaD = ""

  if (densityPoints.length > 0) {
    const startX = getX(0)
    const startY = getY(densityPoints[0].count)
    pathD = `M ${startX} ${startY}`
    areaD = `M ${startX} ${chartH - marginY} L ${startX} ${startY}`

    for (let i = 1; i < densityPoints.length; i++) {
      const x = getX(i)
      const y = getY(densityPoints[i].count)
      pathD += ` L ${x} ${y}`
      areaD += ` L ${x} ${y}`
    }
    areaD += ` L ${getX(densityPoints.length - 1)} ${chartH - marginY} Z`
  }

  // --- 5. Overtime Watchlist ---
  const otWatchlist = employees
    .map((emp) => {
      // Calculate total scheduled hours for this week
      let totalSched = 0
      const weekSched = schedules[activeWeekKey] || {}
      Object.values(weekSched).forEach((dayGrid) => {
        const shiftStr = dayGrid[emp.id]
        if (shiftStr && shiftStr !== "OFF") {
          const parts = shiftStr.split("|")
          const times = parts[0].split("-")
          if (times.length === 2) {
            const [sh, sm] = times[0].split(":").map(Number)
            const [eh, em] = times[1].split(":").map(Number)
            totalSched += (eh * 60 + em - (sh * 60 + sm)) / 60
          }
        }
      })

      // Actual hours from timesheet
      const t = timesheets[emp.id] || { hours: "0.00" }
      const actualHrs = parseFloat(t.hours)
      const projectedTotal = Math.max(totalSched, actualHrs)

      return {
        emp,
        actualHrs,
        projectedHrs: projectedTotal,
        percent: Math.min((projectedTotal / 40) * 100, 100)
      }
    })
    .filter((item) => item.projectedHrs > 25) // show only those working substantial hours
    .sort((a, b) => b.projectedHrs - a.projectedHrs)

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      
      {/* -------------------------------------------------------------
          SECTION: ANCHOR RIBBON STATS
          ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Weekly Payroll */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-3.5 sm:p-5 shadow-xl relative overflow-hidden backdrop-blur-md">
          <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider sm:tracking-widest mb-1.5">
            Wages + Taxes (Period)
          </div>
          <div className="text-2xl font-black font-mono text-[#06d6a0] leading-none mb-1">
            {fmtMoney(totalFacilityCost)}
          </div>
          <div className="text-[10px] text-gray-400 font-sans mt-2">
            Dynamic payroll expense projection
          </div>
          <div className="absolute top-2 right-4 text-xl opacity-20">💰</div>
        </div>

        {/* Card 2: GPS Compliance Gauge */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-3.5 sm:p-5 shadow-xl relative overflow-hidden backdrop-blur-md flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider sm:tracking-widest mb-1.5">
              Geofence Accuracy
            </div>
            <div className="text-2xl font-black font-mono text-[#7ec8e3] leading-none mb-1">
              {geofenceCompliance.toFixed(0)}%
            </div>
            <div className="text-[10px] text-gray-400 font-sans mt-2">
              Punches within boundaries
            </div>
          </div>
          
          {/* Radial Mini Circle */}
          <svg className="w-12 h-12 shrink-0 transform -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="#7ec8e3"
              strokeWidth="3.5"
              strokeDasharray="100.5 100.5"
              strokeDashoffset={100.5 - geofenceCompliance}
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 3px #7ec8e3)" }}
            />
          </svg>
        </div>

        {/* Card 3: Punctuality */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-3.5 sm:p-5 shadow-xl relative overflow-hidden backdrop-blur-md flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider sm:tracking-widest mb-1.5">
              Staff Punctuality
            </div>
            <div className="text-2xl font-black font-mono text-[#fca311] leading-none mb-1">
              {punctualityRating.toFixed(0)}%
            </div>
            <div className="text-[10px] text-gray-400 font-sans mt-2">
              Clockins within grace period
            </div>
          </div>
          
          {/* Radial Mini Circle */}
          <svg className="w-12 h-12 shrink-0 transform -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="#fca311"
              strokeWidth="3.5"
              strokeDasharray="100.5 100.5"
              strokeDashoffset={100.5 - punctualityRating}
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 3px #fca311)" }}
            />
          </svg>
        </div>

        {/* Card 4: Punch Activity */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-3.5 sm:p-5 shadow-xl relative overflow-hidden backdrop-blur-md">
          <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider sm:tracking-widest mb-1.5">
            Total Logs Tracked
          </div>
          <div className="text-2xl font-black font-mono text-[#c77dff] leading-none mb-1">
            {totalPunches}
          </div>
          <div className="text-[10px] text-gray-400 font-sans mt-2">
            Active punches this cycle
          </div>
          <div className="absolute top-2 right-4 text-xl opacity-20">📊</div>
        </div>

      </div>

      {/* -------------------------------------------------------------
          SECTION: CHARTS LAYOUT (DONUT & TRENDS)
          ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* DONUT CHART: Labor Cost Share */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-6 shadow-xl relative backdrop-blur-md flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-300 font-mono tracking-widest uppercase mb-1">
              Labor Share by Role
            </h3>
            <span className="text-[10px] text-gray-500 font-mono">
              Hover slices to inspect detailed department payouts
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-4">
            {/* SVG Donut */}
            <div className="relative w-44 h-44 shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                <defs>
                  <filter id="glow-donut" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Background Track */}
                <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth={strokeWidth} />

                {/* Slices */}
                {(() => {
                  let offsetAccum = 0
                  return activeSlices.map((slice) => {
                    const strokeDashOffset = circum - (slice.percentage / 100) * circum
                    const rotationOffset = (offsetAccum / 100) * circum
                    offsetAccum += slice.percentage

                    const isHovered = hoveredRole === slice.role

                    return (
                      <circle
                        key={slice.role}
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="none"
                        stroke={slice.color}
                        strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                        strokeDasharray={`${(slice.percentage / 100) * circum} ${circum}`}
                        strokeDashoffset={-rotationOffset}
                        strokeLinecap={slice.percentage > 3 ? "round" : "butt"}
                        className="transition-all duration-300 cursor-pointer"
                        onMouseEnter={() => setHoveredRole(slice.role)}
                        onMouseLeave={() => setHoveredRole(null)}
                        style={{
                          transformOrigin: "center",
                          filter: isHovered ? "url(#glow-donut) brightness(1.1)" : "none",
                          opacity: hoveredRole && !isHovered ? 0.45 : 1
                        }}
                      />
                    )
                  })
                })()}
              </svg>

              {/* Text Inside Donut */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none select-none px-4">
                {hoveredRole ? (
                  (() => {
                    const slice = activeSlices.find((s) => s.role === hoveredRole)
                    return (
                      <>
                        <span className="text-[8px] font-mono text-gray-500 uppercase tracking-wider mb-0.5 truncate max-w-full">
                          {slice.role}
                        </span>
                        <span className="text-base font-black text-white font-mono leading-none">
                          {fmtMoney(slice.cost)}
                        </span>
                        <span className="text-[9px] text-[#7ec8e3] font-bold font-mono mt-1">
                          {slice.percentage.toFixed(1)}%
                        </span>
                      </>
                    )
                  })()
                ) : (
                  <>
                    <span className="text-[7px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 leading-none">
                      TOTAL PERIOD
                    </span>
                    <span className="text-lg font-black text-[#06d6a0] font-mono leading-none">
                      {fmtMoney(totalFacilityCost)}
                    </span>
                    <span className="text-[7px] text-gray-500 font-mono mt-1">
                      ALL ROLES
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Donut Legend */}
            <div className="flex flex-col gap-2.5 max-h-48 overflow-y-auto pr-2 flex-1 w-full">
              {activeSlices.map((slice) => (
                <div
                  key={slice.role}
                  className={`flex items-center justify-between transition-all py-1 px-2.5 rounded-xl border ${
                    hoveredRole === slice.role
                      ? "bg-white/5 border-white/10"
                      : "border-transparent opacity-85 hover:opacity-100"
                  }`}
                  onMouseEnter={() => setHoveredRole(slice.role)}
                  onMouseLeave={() => setHoveredRole(null)}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                    <span className="text-[11px] font-medium text-gray-300 font-sans">{slice.role}</span>
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-[11px] font-bold font-mono text-white">{fmtMoney(slice.cost)}</div>
                    <div className="text-[8px] font-mono text-gray-500">{slice.percentage.toFixed(0)}%</div>
                  </div>
                </div>
              ))}
              {activeSlices.length === 0 && (
                <div className="text-xs text-gray-500 font-mono italic text-center py-4">
                  No payroll data recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LINE/AREA CHART: Staffing Density Trends */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-6 shadow-xl relative backdrop-blur-md flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 mb-4">
            <div>
              <h3 className="text-xs font-bold text-gray-300 font-mono tracking-widest uppercase mb-1">
                Coverage Timeline Density
              </h3>
              <span className="text-[10px] text-gray-500 font-mono">
                Scheduled staffing level distribution over operational hours
              </span>
            </div>

            {/* Day Selector pills */}
            <div className="flex bg-slate-950/70 p-1.5 rounded-2xl border border-white/5 gap-1 overflow-x-auto self-start shrink-0 max-w-full">
              {["Monday", "Wednesday", "Friday", "Saturday"].map((day) => (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`text-[9px] font-mono font-black py-1 px-2.5 rounded-xl uppercase transition-all cursor-pointer ${
                    selectedDay === day
                      ? "bg-[#7ec8e3] text-[#070a13]"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* SVG Area Chart */}
          <div className="relative py-2">
            <svg className="w-full h-auto" viewBox={`0 0 ${chartW} ${chartH}`}>
              <defs>
                <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7ec8e3" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#7ec8e3" stopOpacity="0" />
                </linearGradient>
                <filter id="glow-line" x="-10%" y="-10%" width="120%" height="120%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Horizontal Grid lines */}
              {Array.from({ length: 4 }).map((_, i) => {
                const val = (maxDensity / 3) * i
                const y = getY(val)
                return (
                  <g key={i}>
                    <line
                      x1={marginX}
                      y1={y}
                      x2={chartW - marginX}
                      y2={y}
                      stroke="rgba(255,255,255,0.03)"
                      strokeWidth="1"
                    />
                    <text
                      x={marginX - 8}
                      y={y + 3}
                      fill="rgba(156, 163, 175, 0.4)"
                      fontSize="8"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      {Math.round(val)}
                    </text>
                  </g>
                )
              })}

              {/* Dynamic Path and Area Fill */}
              {densityPoints.length > 0 && (
                <>
                  <path d={areaD} fill="url(#area-gradient)" />
                  <path d={pathD} fill="none" stroke="#7ec8e3" strokeWidth="2.5" style={{ filter: "url(#glow-line)" }} />
                </>
              )}

              {/* Vertical ruler & circles on hover */}
              {hoveredPoint !== null && (
                <g>
                  <line
                    x1={getX(hoveredPoint)}
                    y1={marginY}
                    x2={getX(hoveredPoint)}
                    y2={chartH - marginY}
                    stroke="rgba(126, 200, 227, 0.25)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={getX(hoveredPoint)}
                    cy={getY(densityPoints[hoveredPoint].count)}
                    r="5"
                    fill="#070a13"
                    stroke="#7ec8e3"
                    strokeWidth="2"
                    style={{ filter: "drop-shadow(0 0 3px #7ec8e3)" }}
                  />
                </g>
              )}

              {/* Chart X axis Labels */}
              {densityPoints.map((p, idx) => {
                // Show alternate labels to avoid overlap
                if (idx % 2 !== 0 && idx !== densityPoints.length - 1) return null
                return (
                  <text
                    key={idx}
                    x={getX(idx)}
                    y={chartH - marginY + 14}
                    fill="rgba(156, 163, 175, 0.5)"
                    fontSize="7"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {p.label}
                  </text>
                )
              })}

              {/* Transparent interactive vertical bands for easy hover */}
              {densityPoints.map((_, idx) => {
                const startX = getX(idx) - (drawW / (densityPoints.length - 1)) / 2
                const width = drawW / (densityPoints.length - 1)
                return (
                  <rect
                    key={idx}
                    x={startX}
                    y={marginY}
                    width={width}
                    height={drawH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPoint(idx)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                )
              })}
            </svg>

            {/* Density Live Tooltip Overlay */}
            {hoveredPoint !== null && (
              <div
                className="absolute bg-slate-950/90 border border-white/10 rounded-xl px-2.5 py-1.5 shadow-2xl pointer-events-none select-none text-center"
                style={{
                  left: `${(getX(hoveredPoint) / chartW) * 100}%`,
                  transform: "translateX(-50%)",
                  top: "0px"
                }}
              >
                <div className="text-[7px] font-mono text-gray-500 uppercase tracking-widest leading-none">
                  {densityPoints[hoveredPoint].label}
                </div>
                <div className="text-xs font-black text-white font-mono mt-0.5">
                  {densityPoints[hoveredPoint].count} Scheduled
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* -------------------------------------------------------------
          SECTION: COMPLIANCE GAUGES & OVERTIME WATCHLIST
          ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* OVERTIME WATCHLIST */}
        <div className="lg:col-span-2 bg-[#111827]/40 border border-white/5 rounded-3xl p-6 shadow-xl relative backdrop-blur-md">
          <div className="mb-4 flex justify-between items-center">
            <div>
              <h3 className="text-xs font-bold text-gray-300 font-mono tracking-widest uppercase mb-1">
                Overtime Prevention Watchlist
              </h3>
              <span className="text-[10px] text-gray-500 font-mono">
                Projected weekly hours (actual clocked + future scheduled)
              </span>
            </div>
            <span className="text-[9px] font-mono bg-red-950/30 text-[#ef476f] border border-[#ef476f]/20 font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider">
              Limit: 40h
            </span>
          </div>

          <div className="flex flex-col gap-4 max-h-56 overflow-y-auto pr-2">
            {otWatchlist.map((item) => {
              const { emp, projectedHrs, percent } = item
              // Color scale: Green <30, Amber 30-40, Neon Red >40
              const progressColor =
                projectedHrs > 40 ? "#ef476f" : projectedHrs >= 36 ? "#fca311" : "#06d6a0"

              return (
                <div key={emp.id} className="flex flex-col gap-1">
                  <div className="flex justify-between items-end text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-200">{emp.name}</span>
                      <span className="text-[9px] font-mono text-gray-500 uppercase">({emp.role})</span>
                    </div>
                    
                    <div className="text-right">
                      <span className="font-black font-mono text-white">{projectedHrs.toFixed(1)}h</span>
                      {projectedHrs > 40 && (
                        <span className="text-[8px] font-mono font-black text-[#ef476f] ml-1.5 uppercase">
                          (+{(projectedHrs - 40).toFixed(1)}h OT)
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Progress Line */}
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: progressColor,
                        filter: `drop-shadow(0 0 2px ${progressColor})`
                      }}
                    />
                  </div>
                </div>
              )
            })}
            
            {otWatchlist.length === 0 && (
              <div className="text-xs text-gray-500 font-mono italic text-center py-6">
                No active staff approaching the 25h threshold.
              </div>
            )}
          </div>
        </div>

        {/* COMPLIANCE AUDIT FEED (GEO-FLAGGED PUNCHES) */}
        <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-6 shadow-xl relative backdrop-blur-md">
          <div className="mb-4">
            <h3 className="text-xs font-bold text-gray-300 font-mono tracking-widest uppercase mb-1">
              Suspicious Activity Flags
            </h3>
            <span className="text-[10px] text-gray-500 font-mono">
              Geofence warnings flagged by clock satellites
            </span>
          </div>

          <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto pr-1">
            {weekLogs
              .filter((log) => log.suspicious_gps)
              .slice(0, 10)
              .map((log) => {
                const emp = employees.find((e) => e.id === log.employee_id) || { name: "Unknown" }
                const dateStr = new Date(log.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric"
                })
                const timeStr = new Date(log.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })

                return (
                  <div
                    key={log.id}
                    className="p-3 bg-[#ef476f]/5 border border-[#ef476f]/20 rounded-2xl flex flex-col gap-1.5"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-white font-heading">
                        {emp.name}
                      </span>
                      <span className="text-[8px] font-mono font-bold bg-[#ef476f]/15 text-[#ef476f] px-1.5 py-0.5 rounded uppercase border border-[#ef476f]/10">
                        GPS SPOOF?
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center text-[9px] text-gray-400 font-mono">
                      <span>{log.action} Punch</span>
                      <span>
                        {dateStr} &bull; {timeStr}
                      </span>
                    </div>
                  </div>
                )
              })}

            {weekLogs.filter((log) => log.suspicious_gps).length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <span className="text-2xl mb-1.5">🛡️</span>
                <span className="text-[10px] text-gray-400 font-mono font-bold uppercase tracking-wider">
                  No Violations
                </span>
                <span className="text-[9px] text-gray-500 font-sans mt-1">
                  100% geofence boundaries compliant.
                </span>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
