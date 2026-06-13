import { useState, useEffect } from "react"
import { ROLE_COLORS, fmtElapsed, fmtMoney, WORK_ROLES, certStatus, CERT_STATUS_STYLES, getCertAlerts, fmtDate, getSundayKey } from "../lib/utils"
import { supabase } from "../lib/supabase"
import { toast, confirmDialog, promptDialog } from "../lib/notify"
import AnalyticsDashboard from "./AnalyticsDashboard"

// Shared read-only guard message for PIN (non-email) manager sessions
function denyReadOnly(action) {
  toast.error(`PIN login is read-only. Sign in with email to ${action}.`)
}

const availableRoles = ["Park Admin", "Site Manager", ...WORK_ROLES]
export default function ManagerDashboard({
  now,
  employees,
  setEmployees,
  schedules,
  setSchedules,
  clockedIn,
  allLogs,
  setAllLogs,
  clockLog,
  managerSession,
  mgrProfile,
  setScreen,
  setMgrProfile,
  setMgrSession,
  setMgrLoginMode,
  activeWeekKey,
  targetDate,
  setTargetDate,
  timesheets,
  handleExportCSV,
  handleExportXLSX,
  handleFinalizePayroll,
  handleSaveEmployee,
  setShowAddEmp,
  editEmp,
  setEditEmp,
  EmployeeForm,
  getElapsed,
  parseTo24h,
  announcements = [],
  loadData
}) {
  const [managerTab, setMgrTab] = useState("clock")
  const [scheduleView, setScheduleView] = useState("matrix") // 'matrix' | 'timeline'
  const [selectedDay, setSelectedDay] = useState("Monday")
  const [editingShift, setEditingShift] = useState(null)
  const [newNotice, setNewNotice] = useState("")

  // Tracks which async toolbar action is in flight, so its button can show a
  // busy/disabled state instead of firing silently.
  const [busyAction, setBusyAction] = useState(null)
  const runAction = async (key, fn) => {
    if (busyAction) return
    setBusyAction(key)
    try {
      await fn()
    } finally {
      setBusyAction(null)
    }
  }

  const getStaffingCountForHour = (hour) => {
    let count = 0
    const dayScheds = schedules[activeWeekKey]?.[selectedDay] || {}
    Object.entries(dayScheds).forEach(([empId, val]) => {
      if (val && val !== "OFF") {
        const parts = val.split("|")
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

  const getScheduledHoursForWeek = (empId) => {
    let total = 0
    const weekSched = schedules[activeWeekKey] || {}
    Object.values(weekSched).forEach((dayGrid) => {
      const shiftStr = dayGrid[empId]
      if (shiftStr && shiftStr !== "OFF") {
        const parts = shiftStr.split("|")
        const times = parts[0].split("-")
        if (times.length === 2) {
          const parseDecimal = (tStr) => {
            const [h, m] = tStr.split(":").map(Number)
            return h + m / 60
          }
          const start = parseDecimal(times[0])
          const end = parseDecimal(times[1])
          if (end > start) {
            total += (end - start)
          }
        }
      }
    })
    return total
  }

  const handleDragStart = (ev, sourceEmpId, shiftVal) => {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ sourceEmpId, shiftVal }))
  }

  const handleDrop = async (ev, targetEmpId) => {
    ev.preventDefault()
    if (!managerSession) {
      denyReadOnly("modify schedules")
      return
    }
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain"))
      if (!data || !data.sourceEmpId || !data.shiftVal) return
      
      const { sourceEmpId, shiftVal } = data
      if (sourceEmpId === targetEmpId) return // Dropped on same employee, do nothing

      // 1. Update local state
      const next = { ...schedules }
      if (!next[activeWeekKey]) next[activeWeekKey] = {}
      if (!next[activeWeekKey][selectedDay]) next[activeWeekKey][selectedDay] = {}
      
      // Move shift from source to target
      next[activeWeekKey][selectedDay][targetEmpId] = shiftVal
      next[activeWeekKey][selectedDay][sourceEmpId] = "OFF"
      setSchedules(next)

      // 2. Persist to DB immediately
      const targetRec = {
        week_key: activeWeekKey,
        day: selectedDay,
        employee_id: targetEmpId,
        shift_time: shiftVal
      }
      const sourceRec = {
        week_key: activeWeekKey,
        day: selectedDay,
        employee_id: sourceEmpId,
        shift_time: "OFF"
      }
      
      const { error } = await supabase.from("schedules").upsert([targetRec, sourceRec], { onConflict: "week_key,day,employee_id" })
      if (error) {
        console.error("Failed to save dragged shift to database:", error)
      }
    } catch (err) {
      console.error("Error during drag-drop handle:", err)
    }
  }

  // Stations & Conflict Resolver States
  const [stations, setStations] = useState([])
  const [conflicts, setConflicts] = useState([])
  const [editingStation, setEditingStation] = useState(null)
  const [showAddStation, setShowAddStation] = useState(false)
  const [stationFormData, setStationFormData] = useState({ name: "", latitude: "", longitude: "", radius: "" })

  const loadStations = async () => {
    const { data } = await supabase.from("stations").select("*")
    if (data) setStations(data)
  }

  // Time-off / shift-swap request inbox
  const [timeOffRequests, setTimeOffRequests] = useState([])
  const loadTimeOff = async () => {
    const { data } = await supabase
      .from("time_off_requests")
      .select("*")
      .order("created_at", { ascending: false })
    if (data) setTimeOffRequests(data)
  }
  useEffect(() => {
    loadTimeOff()
  }, [])

  const reviewRequest = async (req, status) => {
    if (!managerSession) return denyReadOnly("review time-off requests")
    const { error } = await supabase
      .from("time_off_requests")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", req.id)
    if (error) {
      toast.error("Could not update request: " + error.message)
      return
    }

    const emp = employees.find((e) => e.id === req.employee_id)
    const firstName = emp?.name?.split(" ")[0] || "request"

    // Approving a shift swap actually exchanges the two employees' shifts for that day.
    if (status === "approved" && req.type === "Shift Swap" && req.swap_with && req.swap_day) {
      // start_date holds the schedule week key (Sunday) the swap belongs to.
      const weekKey = req.start_date
      const day = req.swap_day
      const grid = schedules[weekKey]?.[day] || {}
      const aShift = grid[req.employee_id] ?? "OFF"
      const bShift = grid[req.swap_with] ?? "OFF"

      setSchedules((prev) => {
        const next = { ...prev }
        if (!next[weekKey]) next[weekKey] = {}
        if (!next[weekKey][day]) next[weekKey][day] = {}
        next[weekKey][day] = { ...next[weekKey][day], [req.employee_id]: bShift, [req.swap_with]: aShift }
        return next
      })

      const { error: swapErr } = await supabase.from("schedules").upsert(
        [
          { week_key: weekKey, day, employee_id: req.employee_id, shift_time: bShift },
          { week_key: weekKey, day, employee_id: req.swap_with, shift_time: aShift }
        ],
        { onConflict: "week_key,day,employee_id" }
      )
      if (swapErr) {
        toast.error("Approved, but the schedule swap failed to save: " + swapErr.message)
        loadTimeOff()
        return
      }
      const coworker = employees.find((e) => e.id === req.swap_with)
      toast.success(`Swap approved — ${firstName} ↔ ${coworker?.name?.split(" ")[0] || "coworker"} on ${day}.`)
      loadTimeOff()
      return
    }

    toast.success(`${status === "approved" ? "Approved" : "Denied"} ${firstName}'s ${req.type.toLowerCase()}.`)
    loadTimeOff()
  }

  const checkConflicts = async () => {
    const { data: serverSchedules } = await supabase.from("schedules").select("*")
    if (!serverSchedules) return
    const localGrid = schedules[activeWeekKey] || {}
    const conflictList = []
    serverSchedules.forEach(srv => {
      if (srv.week_key !== activeWeekKey) return
      const localVal = localGrid[srv.day]?.[srv.employee_id] || "OFF"
      if (localVal !== srv.shift_time && srv.version_ts > 1717800000000) {
        const emp = employees.find(e => e.id === srv.employee_id)
        conflictList.push({
          employee_id: srv.employee_id,
          employee_name: emp?.name || `Employee #${srv.employee_id}`,
          day: srv.day,
          local_val: localVal,
          server_val: srv.shift_time,
          server_version_ts: srv.version_ts
        })
      }
    })
    setConflicts(conflictList)
  }

  useEffect(() => {
    loadStations()
    checkConflicts()
  }, [schedules, activeWeekKey])

  const handleAddStation = async (station) => {
    if (!managerSession) return denyReadOnly("add stations")
    const { error } = await supabase.from("stations").insert([station])
    if (error) {
      toast.error("Failed to add station: " + error.message)
    } else {
      toast.success(`Station "${station.name}" added.`)
      loadStations()
    }
  }

  const handleEditStation = async (id, updates) => {
    if (!managerSession) return denyReadOnly("edit stations")
    const { error } = await supabase.from("stations").update(updates).eq("id", id)
    if (error) {
      toast.error("Failed to edit station: " + error.message)
    } else {
      toast.success("Station updated.")
      loadStations()
    }
  }

  const handleDeleteStation = async (id) => {
    if (!managerSession) return denyReadOnly("delete stations")
    if (!(await confirmDialog({ title: "Delete station?", message: "Staff will no longer be able to clock in from this geofenced zone.", confirmText: "Delete", danger: true }))) return
    const { error } = await supabase.from("stations").delete().eq("id", id)
    if (error) {
      toast.error("Failed to delete station: " + error.message)
    } else {
      toast.success("Station deleted.")
      loadStations()
    }
  }

  const simulateCollision = async () => {
    const rec = {
      week_key: activeWeekKey,
      day: "Monday",
      employee_id: 4, // Sarah Concessions
      shift_time: "10:00-18:00|Concessions",
      version_ts: Date.now()
    }
    await supabase.from("schedules").upsert(rec)
    checkConflicts()
    toast.info("Collision simulated — open the Sync Center tab to resolve it.")
  }

  const resolveKeepLocal = async (conflict) => {
    if (!managerSession) return denyReadOnly("resolve conflicts")
    const rec = {
      week_key: activeWeekKey,
      day: conflict.day,
      employee_id: conflict.employee_id,
      shift_time: conflict.local_val,
      version_ts: 1717800000000
    }
    await supabase.from("schedules").upsert(rec)
    checkConflicts()
    toast.success(`Kept local shift (${conflict.local_val}) for ${conflict.employee_name}.`)
  }

  const resolveAcceptServer = (conflict) => {
    if (!managerSession) return denyReadOnly("resolve conflicts")
    setSchedules(prev => {
      const next = { ...prev }
      if (!next[activeWeekKey]) next[activeWeekKey] = {}
      if (!next[activeWeekKey][conflict.day]) next[activeWeekKey][conflict.day] = {}
      next[activeWeekKey][conflict.day][conflict.employee_id] = conflict.server_val
      return next
    })
    toast.success(`Accepted server shift (${conflict.server_val}) for ${conflict.employee_name}.`)
  }

  // Sync selected day with target date
  useEffect(() => {
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    setSelectedDay(daysOfWeek[new Date(targetDate).getDay()]);
  }, [targetDate])

  const handleAddAnnouncement = async (e) => {
    e.preventDefault()
    if (!managerSession) return denyReadOnly("post announcements")
    if (!newNotice.trim()) return

    const record = {
      text: newNotice.trim(),
      created_at: new Date().toISOString()
    }

    const { data, error } = await supabase.from("announcements").insert(record)
    if (error) {
      toast.error("Failed to post announcement: " + error.message)
    } else {
      toast.success("Announcement posted.")
      setNewNotice("")
      if (typeof loadData === "function") {
        loadData()
      }
    }
  }

  const handleDeleteAnnouncement = async (id) => {
    if (!managerSession) return denyReadOnly("delete announcements")
    if (!(await confirmDialog({ title: "Delete announcement?", message: "This will remove it from the kiosk and employee portals.", confirmText: "Delete", danger: true }))) return
    const { error } = await supabase.from("announcements").delete().eq("id", id)
    if (error) {
      toast.error("Failed to delete announcement: " + error.message)
    } else {
      toast.success("Announcement deleted.")
      if (typeof loadData === "function") {
        loadData()
      }
    }
  }
  const [payEmp, setPayEmp] = useState(null)
  const [tsEmp, setTsEmp] = useState(null)
  
  // Timesheet punch editor states
  const [editLog, setEditLog] = useState(null)
  const [logEditData, setLogEditData] = useState({ time: "", action: "" })

  // Initialize selected employees if lists aren't empty
  if (!payEmp && employees.length > 0) setPayEmp(employees[0])
  if (!tsEmp && employees.length > 0) setTsEmp(employees[0])

  const activeCount = Object.values(clockedIn).filter((s) => s.status === "IN").length

  const totalFacility = employees.reduce(
    (a, e) => {
      const s = timesheets[e.id] || { gross: 0, employerTax: 0, totalCost: 0, hours: 0 }
      return {
        gross: a.gross + s.gross,
        taxes: a.taxes + s.employerTax,
        total: a.total + s.totalCost,
        hours: a.hours + parseFloat(s.hours)
      }
    },
    { gross: 0, taxes: 0, total: 0, hours: 0 }
  )

  // Certification compliance alerts (expiring within 30 days or already expired)
  const certAlerts = getCertAlerts(employees, now)
  const expiredCount = certAlerts.filter((a) => a.status === "expired").length

  const pendingRequests = timeOffRequests.filter((r) => r.status === "pending").length

  const availableTabs = [
    { id: "clock", label: "LIVE CLOCK" },
    { id: "stations", label: "STATIONS" },
    { id: "sync", label: conflicts.length > 0 ? "SYNC CENTER ⚠️" : "SYNC CENTER" },
    { id: "labor", label: "LABOR COST" },
    { id: "analytics", label: "ANALYTICS 📊" },
    { id: "schedule", label: "SCHEDULER" },
    { id: "payroll", label: "PAY CALC" },
    { id: "employees", label: "EMPLOYEES" },
    { id: "certs", label: certAlerts.length > 0 ? `CERTS ⚠️` : "CERTS" },
    { id: "requests", label: pendingRequests > 0 ? `REQUESTS (${pendingRequests})` : "REQUESTS" },
    { id: "timesheets", label: "TIMESHEETS" }
  ]

  // Helper to convert UTC to Local for datetime-local input
  function getLocalDatetimeString(dateObj) {
    const pad = (n) => n.toString().padStart(2, "0")
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}T${pad(
      dateObj.getHours()
    )}:${pad(dateObj.getMinutes())}`
  }

  // Handle register kiosk
  const isKioskRegistered = !!localStorage.getItem("official_kiosk_token")
  const toggleKioskRegistration = () => {
    if (!managerSession) {
      denyReadOnly("register or unregister this kiosk device")
      return
    }
    if (isKioskRegistered) {
      localStorage.removeItem("official_kiosk_token")
      toast.warning("This device is no longer the official kiosk. Roster clock-in disabled.")
    } else {
      localStorage.setItem("official_kiosk_token", "kiosk-token-" + Math.random().toString(36).substring(2))
      toast.success("This device is now the official kiosk. Roster clock-in enabled.")
    }
    setScreen("manager-dashboard") // force re-render
  }

  return (
    <div className="bg-transparent min-h-screen text-[#f3f4f6] selection:bg-[#7ec8e3]/30 selection:text-white font-sans antialiased">
      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {!managerSession && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 rounded-3xl border border-amber-500/20 bg-amber-500/5 text-amber-400 text-[11px] sm:text-xs font-mono flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_15px_rgba(252,163,17,0.05)] animate-pulse">
            <span className="text-center sm:text-left">⚠️ READ-ONLY ACCESS: You are logged in via PIN code. Full modification privileges require Secure Email Login.</span>
            <button
              onClick={() => {
                setMgrProfile(null)
                setMgrLoginMode("email")
                setScreen("manager-login")
              }}
              className="text-[10px] font-mono bg-amber-500 text-slate-950 px-3 py-1.5 rounded-xl border border-transparent hover:bg-amber-400 font-bold transition-all cursor-pointer shrink-0"
            >
              Email Login
            </button>
          </div>
        )}

        {/* Top Header */}
        <div className="border-b border-white/5 pb-4 mb-6">
          <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
            <div>
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest leading-none mb-1">
                Pine Lake Recreation
              </div>
              <h1 className="text-xl font-black text-white font-heading">
                {mgrProfile?.role || "Manager"} Dashboard
              </h1>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right mr-2">
                <span className="font-mono text-base font-bold text-[#7ec8e3]">
                  {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
              
              <button
                onClick={toggleKioskRegistration}
                className={`text-[10px] font-mono font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  isKioskRegistered
                    ? "bg-[#ef476f]/10 border-[#ef476f]/30 text-[#ef476f] hover:bg-[#ef476f]/20"
                    : "bg-[#fca311]/10 border-[#fca311]/30 text-[#fca311] hover:bg-[#fca311]/20"
                }`}
              >
                {isKioskRegistered ? "Unregister Kiosk" : "Register Kiosk"}
              </button>

              <button
                onClick={() => setScreen("kiosk")}
                className="bg-slate-900 border border-slate-800 text-gray-400 hover:text-white hover:bg-slate-800 text-[10px] font-mono font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
              >
                Go to Kiosk
              </button>

              <button
                onClick={async () => {
                  if (await confirmDialog({ title: "Log out of management?", message: "You'll return to the kiosk home screen.", confirmText: "Log out" })) {
                    if (managerSession) await supabase.auth.signOut()
                    setMgrProfile(null)
                    setMgrSession(null)
                    setScreen("kiosk")
                  }
                }}
                className="bg-[#ef476f] text-[#070a13] font-bold text-[10px] font-mono px-3 py-1.5 rounded-lg cursor-pointer hover:bg-[#d43d5e] transition-colors"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-1 overflow-x-auto mt-6 border-b border-white/5 scrollbar-none">
            {availableTabs.map((tab) => {
              const active = managerTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setMgrTab(tab.id)}
                  className={`py-3 px-4 text-xs font-black tracking-wider border-b-2 font-heading transition-all shrink-0 cursor-pointer ${
                    active
                      ? "text-[#7ec8e3] border-[#7ec8e3]"
                      : "text-gray-500 border-transparent hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Certification compliance banner (visible on every tab when action is needed) */}
        {certAlerts.length > 0 && managerTab !== "certs" && (
          <button
            onClick={() => setMgrTab("certs")}
            className={`w-full mb-6 p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-all hover:scale-[1.005] cursor-pointer ${
              expiredCount > 0
                ? "bg-[#ef476f]/10 border-[#ef476f]/30 text-[#ef476f]"
                : "bg-[#fca311]/10 border-[#fca311]/30 text-[#fca311]"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg shrink-0">🛟</span>
              <div className="min-w-0">
                <div className="text-xs font-black font-heading uppercase tracking-wider">
                  {expiredCount > 0
                    ? `${expiredCount} expired credential${expiredCount === 1 ? "" : "s"} — staff may be working uncertified`
                    : `${certAlerts.length} credential${certAlerts.length === 1 ? "" : "s"} expiring soon`}
                </div>
                <div className="text-[11px] text-slate-300 font-sans mt-0.5 truncate">
                  {certAlerts.slice(0, 3).map((a) => `${a.emp.name.split(" ")[0]}: ${a.cert.type}`).join(" · ")}
                  {certAlerts.length > 3 ? ` +${certAlerts.length - 3} more` : ""}
                </div>
              </div>
            </div>
            <span className="shrink-0 text-[10px] font-mono uppercase tracking-widest bg-black/30 px-3 py-1.5 rounded-lg border border-white/10">
              Review →
            </span>
          </button>
        )}

        {/* -------------------------------------------------------------
            TAB: LIVE CLOCK
            ------------------------------------------------------------- */}
        {managerTab === "clock" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            {/* Left: Summary cards and roster */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-black font-mono text-[#06d6a0]">{activeCount}</div>
                  <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">Clocked In</div>
                </div>
                <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-black font-mono text-[#7ec8e3]">{employees.length}</div>
                  <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1 font-sans">Total Staff</div>
                </div>
                <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-black font-mono text-[#fca311]">
                    {Object.keys(clockedIn)
                      .reduce((acc, id) => acc + getElapsed(parseInt(id)) / 3600, 0)
                      .toFixed(1)}h
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">Hours Today</div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {employees.map((emp) => {
                  const s = clockedIn[emp.id]
                  const isIN = s?.status === "IN"
                  const isBreak = s?.status === "BREAK"
                  const elapsed = getElapsed(emp.id)
                  const col = ROLE_COLORS[emp.role] || "#7ec8e3"

                  return (
                    <div
                      key={emp.id}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 ${
                        isIN 
                          ? "bg-[#06d6a0]/5 border-[#06d6a0]/20" 
                          : isBreak
                          ? "bg-[#fca311]/5 border-[#fca311]/20"
                          : "bg-[#111827]/40 border-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[11px] shrink-0"
                          style={{ backgroundColor: col }}
                        >
                          {emp.avatar}
                        </div>
                        <div>
                          <div className="font-black text-sm text-white font-heading">{emp.name}</div>
                          <div className="text-[10px] font-semibold mt-0.5" style={{ color: col }}>
                            {emp.role}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {isIN && (
                          <>
                            <div className="font-mono text-base font-bold text-[#06d6a0] leading-none">
                              {fmtElapsed(elapsed)}
                            </div>
                            <span className="text-[8px] font-mono text-[#06d6a0]/70 uppercase tracking-widest mt-1 block">
                              Active Shift
                            </span>
                          </>
                        )}
                        {isBreak && (
                          <>
                            <div className="font-mono text-base font-bold text-[#fca311] leading-none">
                              {fmtElapsed(elapsed)}
                            </div>
                            <span className="text-[8px] font-mono text-[#fca311]/70 uppercase tracking-widest mt-1 block">
                              On Break
                            </span>
                          </>
                        )}
                        {!isIN && !isBreak && (
                          <div className="text-[10px] text-gray-600 font-mono uppercase tracking-wider">— Off Clock</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right: Activity Logs & Announcements Board */}
            <div className="flex flex-col gap-6 h-fit">
              {/* Activity Logs */}
              <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
                <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                  Recent Activity Log
                </div>
                
                <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto pr-1">
                  {clockLog.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 font-mono text-xs">
                      No recent activity logs.
                    </div>
                  ) : (
                    clockLog.slice(0, 8).map((l, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center bg-[#070a13] p-2.5 rounded-xl border border-white/5 font-mono text-[10px]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-black uppercase tracking-wider ${
                              l.action === "IN" || l.action === "BREAK_END"
                                ? "text-[#06d6a0]"
                                : l.action === "AUTO-OUT"
                                ? "text-[#fca311]"
                                : "text-[#ef476f]"
                            }`}
                          >
                            {l.action}
                          </span>
                          <span className="text-gray-300 font-semibold">{l.emp}</span>
                          
                          {/* Hover Audit Photo */}
                          {l.photo_base64 && (
                            <div className="relative group/audit ml-2 shrink-0">
                              <span className="cursor-pointer text-xs hover:scale-110 transition-transform block">📷</span>
                              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/audit:block z-50 p-2 bg-slate-950/95 border border-white/10 rounded-xl shadow-2xl w-36 text-center backdrop-blur-md">
                                <img src={l.photo_base64} alt="Audit snapshot" className="w-32 h-32 object-cover rounded-lg border border-white/5 mx-auto" />
                                <div className="text-[8px] text-gray-400 mt-1 font-mono uppercase tracking-wider">Audit Pass</div>
                              </div>
                            </div>
                          )}
                        </div>
                        <span className="text-gray-500 text-[9px]">{l.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Announcements Creator & Manager Ticker */}
              <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
                <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                  Announcements Board
                </div>
                
                {/* Active Notices List */}
                <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto mb-4 pr-1">
                  {announcements.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 font-mono text-xs border border-dashed border-white/5 rounded-xl bg-[#070a13]/30">
                      No active announcements.
                    </div>
                  ) : (
                    announcements.map((ann) => (
                      <div
                        key={ann.id}
                        className="flex justify-between items-start gap-2 bg-[#070a13] p-2.5 rounded-xl border border-white/5 text-[11px]"
                      >
                        <div className="flex-1 text-gray-300 break-words leading-relaxed">
                          {ann.text}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAnnouncement(ann.id)}
                          className="text-[#ef476f] hover:text-[#d43d5e] text-[9px] font-mono uppercase tracking-widest shrink-0 cursor-pointer hover:underline ml-2"
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Post Form */}
                <form onSubmit={handleAddAnnouncement} className="flex flex-col gap-2.5">
                  <textarea
                    rows="2"
                    value={newNotice}
                    onChange={(e) => setNewNotice(e.target.value)}
                    placeholder="Broadcast news to staff portal & kiosk..."
                    className="w-full bg-[#070a13] border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 resize-none font-sans"
                    maxLength={150}
                  />
                  <button
                    type="submit"
                    className="w-full bg-[#7ec8e3] text-[#070a13] font-bold text-xs uppercase tracking-wider py-2.5 rounded-xl hover:bg-[#68b4d0] cursor-pointer transition-all active:scale-[0.98] font-heading"
                  >
                    Post Notice
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: STATIONS (GEOFENCE STATION CONFIGURATION)
            ------------------------------------------------------------- */}
        {managerTab === "stations" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex justify-between items-center mb-2">
              <div>
                <h2 className="text-sm font-black text-white font-heading">Geofenced Work Stations</h2>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">Define location boundaries where staff are permitted to punch clock.</p>
              </div>
              <button
                onClick={() => {
                  setStationFormData({ name: "", latitude: "40.650318", longitude: "-85.024517", radius: "50" })
                  setEditingStation(null)
                  setShowAddStation(true)
                }}
                className="bg-[#7ec8e3] text-[#070a13] hover:bg-[#68b4d0] font-heading font-black text-xs py-2.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95"
              >
                + Add Station
              </button>
            </div>

            {/* Stations list grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {stations.map(st => (
                <div key={st.id} className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl hover:border-white/10 transition-all">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-lg">📍</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingStation(st)
                          setStationFormData({ name: st.name, latitude: st.latitude.toString(), longitude: st.longitude.toString(), radius: st.radius.toString() })
                          setShowAddStation(true)
                        }}
                        className="text-[#7ec8e3] bg-[#111827] border border-slate-800 hover:bg-slate-800 w-8 h-8 rounded-xl flex items-center justify-center text-xs transition-colors cursor-pointer"
                        title="Edit station"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteStation(st.id)}
                        className="text-[#ef476f] bg-[#ef476f]/5 border border-[#ef476f]/15 hover:bg-[#ef476f]/15 w-8 h-8 rounded-xl flex items-center justify-center text-xs transition-colors cursor-pointer"
                        title="Delete station"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <h3 className="font-heading font-black text-sm text-white mb-2">{st.name}</h3>
                  <div className="space-y-1 text-xs font-mono text-gray-400">
                    <div className="flex justify-between">
                      <span>Latitude:</span>
                      <span className="text-white">{st.latitude}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Longitude:</span>
                      <span className="text-white">{st.longitude}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-1 mt-1 font-sans">
                      <span className="text-gray-500 font-medium">Radius:</span>
                      <span className="text-[#06d6a0] font-bold">{st.radius} meters</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal station form */}
            {showAddStation && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
                <div className="bg-[#111827] border border-white/10 p-6 rounded-3xl w-full max-w-sm shadow-2xl relative">
                  <h3 className="font-heading font-black text-sm text-white uppercase tracking-wider mb-6">
                    {editingStation ? "Edit Station" : "Create New Station"}
                  </h3>
                  
                  <div className="flex flex-col gap-4 mb-6">
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">Station Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Boat House"
                        value={stationFormData.name}
                        onChange={(e) => setStationFormData(p => ({ ...p, name: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">Latitude</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="40.650318"
                        value={stationFormData.latitude}
                        onChange={(e) => setStationFormData(p => ({ ...p, latitude: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">Longitude</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="-85.024517"
                        value={stationFormData.longitude}
                        onChange={(e) => setStationFormData(p => ({ ...p, longitude: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">Radius boundary (meters)</label>
                      <input
                        type="number"
                        placeholder="50"
                        value={stationFormData.radius}
                        onChange={(e) => setStationFormData(p => ({ ...p, radius: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!stationFormData.name.trim() || !stationFormData.latitude || !stationFormData.longitude || !stationFormData.radius) {
                          toast.warning("Please fill out all station parameters.")
                          return
                        }
                        const p = {
                          name: stationFormData.name.trim(),
                          latitude: parseFloat(stationFormData.latitude),
                          longitude: parseFloat(stationFormData.longitude),
                          radius: parseFloat(stationFormData.radius)
                        }
                        if (editingStation) {
                          await handleEditStation(editingStation.id, p)
                        } else {
                          await handleAddStation(p)
                        }
                        setShowAddStation(false)
                      }}
                      className="flex-1 bg-[#06d6a0] text-[#070a13] font-bold text-xs uppercase tracking-wider py-3 rounded-xl hover:bg-[#05b586] transition-all cursor-pointer font-heading"
                    >
                      Save Station
                    </button>
                    <button
                      onClick={() => setShowAddStation(false)}
                      className="flex-1 bg-slate-900 border border-slate-800 text-gray-400 hover:text-white py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: SYNC CENTER (CONFLICT RESOLVER)
            ------------------------------------------------------------- */}
        {managerTab === "sync" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="p-6 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-1">
                  Offline Sync & Conflict Resolver
                </h2>
                <p className="text-[10px] text-gray-500 font-mono">
                  Resolve scheduling collisions where local manager drafts collide with remote server updates.
                </p>
              </div>
              <button
                onClick={simulateCollision}
                className="bg-[#fca311] text-[#070a13] hover:bg-[#e0910e] font-heading font-black text-xs py-2.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95 shadow-md shadow-[#fca311]/5"
              >
                ⚠️ Simulate Server Schedule Collision
              </button>
            </div>

            {conflicts.length === 0 ? (
              <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-8 text-center text-gray-400 text-xs font-mono">
                ✅ All schedules are fully synchronized. No draft conflicts found.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="bg-[#ef476f]/10 border border-[#ef476f]/30 p-4 rounded-2xl flex items-center gap-3">
                  <span className="text-xl">⚠️</span>
                  <div className="text-xs">
                    <span className="font-bold text-[#ef476f] block uppercase tracking-wider font-mono">COLLISION WARNING</span>
                    <span className="text-gray-300">We detected {conflicts.length} scheduling cells modified concurrently in the cloud. Resolve below to sync.</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {conflicts.map((c, i) => (
                    <div key={i} className="bg-[#111827]/60 border border-white/5 rounded-3xl p-5 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <div className="font-black text-white font-heading text-sm">{c.employee_name}</div>
                        <div className="text-[10px] font-mono text-gray-400 mt-1 uppercase tracking-wider">{c.day} shift schedule</div>
                      </div>

                      {/* Versions comparison columns */}
                      <div className="flex gap-4 items-center">
                        <div className="bg-slate-900 border border-white/5 p-3 rounded-2xl text-center w-32 shrink-0">
                          <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mb-1.5">Local Edition</div>
                          <div className="text-xs font-bold text-[#7ec8e3] font-mono">
                            {c.local_val === "OFF" ? "OFF" : c.local_val.split("|")[0]}
                          </div>
                          <div className="text-[8px] text-gray-400 mt-0.5 font-sans truncate">
                            {c.local_val === "OFF" ? "—" : c.local_val.split("|")[1]}
                          </div>
                        </div>

                        <div className="text-gray-500 text-xs">vs</div>

                        <div className="bg-slate-900 border border-[#ef476f]/20 p-3 rounded-2xl text-center w-32 shrink-0 shadow-[0_0_10px_rgba(239,71,111,0.03)]">
                          <div className="text-[8px] text-[#ef476f] font-mono uppercase tracking-widest mb-1.5">Cloud Server</div>
                          <div className="text-xs font-bold text-[#06d6a0] font-mono">
                            {c.server_val === "OFF" ? "OFF" : c.server_val.split("|")[0]}
                          </div>
                          <div className="text-[8px] text-gray-400 mt-0.5 font-sans truncate">
                            {c.server_val === "OFF" ? "—" : c.server_val.split("|")[1]}
                          </div>
                        </div>
                      </div>

                      {/* Resolver action button choices */}
                      <div className="flex gap-2.5 w-full md:w-auto">
                        <button
                          onClick={() => resolveKeepLocal(c)}
                          className="flex-1 md:flex-initial bg-[#7ec8e3] text-[#070a13] hover:bg-[#68b4d0] font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95 font-heading"
                        >
                          Keep Local
                        </button>
                        <button
                          onClick={() => resolveAcceptServer(c)}
                          className="flex-1 md:flex-initial bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95 font-heading"
                        >
                          Accept Server
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: ANALYTICS
            ------------------------------------------------------------- */}
        {managerTab === "analytics" && (
          <AnalyticsDashboard
            now={now}
            employees={employees}
            schedules={schedules}
            allLogs={allLogs}
            timesheets={timesheets}
            activeWeekKey={activeWeekKey}
          />
        )}

        {/* -------------------------------------------------------------
            TAB: LABOR COST
            ------------------------------------------------------------- */}
        {managerTab === "labor" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            {/* Cost Dashboard Metrics */}
            <div className="p-6 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
                <div>
                  <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-1">
                    Period To Date Summary
                  </h2>
                  <p className="text-[10px] text-gray-500 font-mono">
                    Current active payroll period (starts Sunday {activeWeekKey})
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => runAction("csv", handleExportCSV)}
                    disabled={!!busyAction}
                    className="bg-slate-900 border border-slate-800 text-gray-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[10px] font-bold py-2 px-3.5 rounded-xl cursor-pointer transition-all active:scale-95"
                  >
                    {busyAction === "csv" ? "EXPORTING…" : "CSV EXPORT"}
                  </button>
                  <button
                    onClick={() => runAction("xlsx", handleExportXLSX)}
                    disabled={!!busyAction}
                    className="bg-slate-900 border border-slate-800 text-gray-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[10px] font-bold py-2 px-3.5 rounded-xl cursor-pointer transition-all active:scale-95"
                  >
                    {busyAction === "xlsx" ? "EXPORTING…" : "EXCEL EXPORT"}
                  </button>
                  <button
                    onClick={() => runAction("finalize", handleFinalizePayroll)}
                    disabled={!!busyAction}
                    className="bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] disabled:opacity-50 disabled:cursor-not-allowed font-heading text-[10px] font-black tracking-wider py-2 px-4 rounded-xl cursor-pointer transition-all active:scale-95 shadow-md shadow-[#06d6a0]/5"
                  >
                    {busyAction === "finalize" ? "FINALIZING…" : "FINALIZE PAYROLL"}
                  </button>
                </div>
              </div>

              {/* Cost Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#070a13]/55 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-xl font-black font-mono text-[#7ec8e3]">{totalFacility.hours.toFixed(1)}h</div>
                  <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-1">Total Hours</div>
                </div>
                <div className="bg-[#070a13]/55 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-xl font-black font-mono text-[#06d6a0]">{fmtMoney(totalFacility.gross)}</div>
                  <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-1">Gross Wages</div>
                </div>
                <div className="bg-[#070a13]/55 border border-white/5 rounded-2xl p-4 text-center">
                  <div className="text-xl font-black font-mono text-[#fca311]">{fmtMoney(totalFacility.taxes)}</div>
                  <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-1">Employer Taxes</div>
                </div>
                <div className="bg-[#070a13]/55 border border-[#ef476f]/20 rounded-2xl p-4 text-center shadow-[0_0_15px_rgba(239,71,111,0.02)]">
                  <div className="text-xl font-black font-mono text-[#ef476f]">{fmtMoney(totalFacility.total)}</div>
                  <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-1">Total Labor Cost</div>
                </div>
              </div>
            </div>

            {/* Custom Visual Bar Chart comparison */}
            <div className="p-5 rounded-3xl border border-white/5 bg-[#111827]/40 backdrop-blur-md shadow-xl">
              <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-6">
                Visual Labor Cost Share
              </div>
              <div className="flex flex-col gap-4">
                {employees.map((emp) => {
                  const s = timesheets[emp.id] || { totalCost: 0 }
                  const maxCost = Math.max(...employees.map((e) => timesheets[e.id]?.totalCost || 0), 1)
                  const percentage = (s.totalCost / maxCost) * 100
                  const color = ROLE_COLORS[emp.role] || "#7ec8e3"
                  
                  return (
                    <div key={emp.id} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-gray-300">{emp.name}</span>
                        <span className="font-mono text-[#ef476f] font-bold">{fmtMoney(s.totalCost)}</span>
                      </div>
                      <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: color,
                            filter: `drop-shadow(0 0 3px ${color})`
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Detailed per-employee stats list */}
            <div className="flex flex-col gap-4">
              {employees.map((emp) => {
                const s = timesheets[emp.id] || { regH: "0.00", otH: "0.00", liveH: "0.00", gross: 0, employerTax: 0, totalCost: 0 }
                const col = ROLE_COLORS[emp.role] || "#7ec8e3"
                const isWorking = !!clockedIn[emp.id]

                return (
                  <div key={emp.id} className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-lg">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[10px]"
                          style={{ backgroundColor: col }}
                        >
                          {emp.avatar}
                        </div>
                        <div>
                          <div className="font-black text-sm flex items-center gap-2 font-heading">
                            {emp.name}
                            {isWorking && (
                              <span className="bg-[#06d6a0]/15 text-[#06d6a0] text-[9px] px-2 py-0.5 rounded-full font-mono uppercase font-semibold border border-[#06d6a0]/10 tracking-widest animate-pulse">
                                ⏱ LIVE
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                            {emp.role} &bull; ${Number(emp.baseRate || 0).toFixed(2)}/hr
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="font-mono text-base font-black text-[#ef476f]">
                          {fmtMoney(s.totalCost)}
                        </div>
                        <span className="text-[8px] text-gray-500 font-mono uppercase tracking-widest">Employee Cost</span>
                      </div>
                    </div>

                    {/* Cost Grid details */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-[#7ec8e3]">{s.regH}h</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">Reg Hrs</div>
                      </div>
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-[#fca311]">{s.otH}h</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">OT Hrs</div>
                      </div>
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-[#06d6a0]">{s.liveH}h</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">Live</div>
                      </div>
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-white">{fmtMoney(s.gross)}</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">Gross</div>
                      </div>
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-gray-400">{fmtMoney(s.employerTax)}</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">Er. Tax</div>
                      </div>
                      <div className="bg-[#070a13]/60 rounded-xl p-2.5 text-center border border-white/5">
                        <div className="font-mono text-xs font-black text-[#ef476f]">{fmtMoney(s.totalCost)}</div>
                        <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider mt-1">Total</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: SCHEDULER
            ------------------------------------------------------------- */}
        {managerTab === "schedule" && (
          <div className="flex flex-col gap-5 animate-fade-in">
            {/* Live Staffing Density HUD */}
            <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-1">
                    Live Staffing Density HUD &bull; {selectedDay}
                  </h3>
                  <p className="text-[10px] text-gray-500 font-mono">
                    Hourly coverage density (Green: Optimal 3-5, Amber: Understaffed &lt;3, Blue: Overstaffed &gt;5)
                  </p>
                </div>
              </div>
              <div className="flex md:grid md:grid-cols-11 gap-2 text-center overflow-x-auto pb-2 scrollbar-none">
                {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((hour) => {
                  const count = getStaffingCountForHour(hour)
                  let colorClass = "bg-[#06d6a0]/10 border-[#06d6a0]/30 text-[#06d6a0] shadow-[#06d6a0]/10" // optimal
                  let statusText = "Optimal"
                  if (count < 3) {
                    colorClass = "bg-[#fca311]/10 border-[#fca311]/30 text-[#fca311] shadow-[#fca311]/10" // under
                    statusText = "Under"
                  } else if (count > 5) {
                    colorClass = "bg-[#7ec8e3]/10 border-[#7ec8e3]/30 text-[#7ec8e3] shadow-[#7ec8e3]/10" // over
                    statusText = "Over"
                  }
                  const displayHour = hour > 12 ? `${hour - 12} PM` : hour === 12 ? "12 PM" : `${hour} AM`
                  return (
                    <div key={hour} className="flex flex-col items-center min-w-[50px] shrink-0">
                      <div className="text-[9px] text-gray-400 font-mono font-bold mb-1.5">{displayHour}</div>
                      <div 
                        className={`w-12 h-12 rounded-full flex flex-col items-center justify-center border font-mono shadow-[0_0_12px] transition-all duration-300 hover:scale-105 ${colorClass}`}
                      >
                        <span className="text-sm font-black">{count}</span>
                        <span className="text-[7px] uppercase font-semibold leading-none opacity-80">{statusText}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono tracking-widest uppercase">Target Date:</span>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-[#7ec8e3] rounded-xl p-2 px-3 text-xs font-mono focus:outline-none w-full sm:w-auto min-w-[150px]"
                    style={{ colorScheme: "dark" }}
                  />
                </div>

                {/* View Mode Toggle */}
                <div className="flex bg-[#070a13] border border-white/5 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setScheduleView("matrix")}
                    className={`px-3 py-1.5 text-[9px] font-mono font-black rounded-lg transition-all cursor-pointer ${
                      scheduleView === "matrix"
                        ? "bg-[#7ec8e3] text-[#070a13] shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    MATRIX
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleView("timeline")}
                    className={`px-3 py-1.5 text-[9px] font-mono font-black rounded-lg transition-all cursor-pointer ${
                      scheduleView === "timeline"
                        ? "bg-[#7ec8e3] text-[#070a13] shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    TIMELINE
                  </button>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const prev = new Date(targetDate)
                    prev.setDate(prev.getDate() - 7)
                    const prevKey = getSundayKey(prev)
                    if (schedules[prevKey]) {
                      setSchedules((p) => ({
                        ...p,
                        [activeWeekKey]: JSON.parse(JSON.stringify(p[prevKey]))
                      }))
                      toast.success("Copied schedule layout from the previous week.")
                    } else {
                      toast.info("No schedule found for the previous week.")
                    }
                  }}
                  className="bg-slate-900 border border-slate-800 text-[#7ec8e3] hover:text-white hover:bg-slate-800 py-2.5 px-4 rounded-xl text-xs font-mono font-bold cursor-pointer transition-all active:scale-95"
                >
                  Copy Prev Week
                </button>
                
                <button
                  disabled={!!busyAction}
                  onClick={() => runAction("saveSched", async () => {
                    if (!managerSession) { denyReadOnly("save schedules"); return }
                    const recs = []
                    const grid = schedules[activeWeekKey] || {}
                    for (const d of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
                      employees.forEach((e) => {
                        recs.push({
                          week_key: activeWeekKey,
                          day: d,
                          employee_id: e.id,
                          shift_time: grid[d]?.[e.id] || ""
                        })
                      })
                    }
                    const { error } = await supabase.from("schedules").upsert(recs, { onConflict: "week_key,day,employee_id" })
                    if (error) {
                      toast.error("Save failed: " + error.message)
                    } else {
                      toast.success("Schedule changes saved.")
                    }
                  })}
                  className="bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] disabled:opacity-50 disabled:cursor-not-allowed py-2.5 px-5 rounded-xl text-xs font-heading font-black tracking-wider cursor-pointer transition-all active:scale-95 shadow-md shadow-[#06d6a0]/5"
                >
                  {busyAction === "saveSched" ? "Saving…" : "Save Schedule"}
                </button>
              </div>
            </div>

            {scheduleView === "matrix" ? (
              /* Matrix Calendar Table */
              <div className="overflow-x-auto w-full bg-[#111827]/40 border border-white/5 rounded-3xl p-4 shadow-xl">
                <table className="w-full text-left min-w-[850px] border-separate border-spacing-y-2">
                  <thead>
                    <tr>
                      <th className="p-2.5 text-xs text-gray-500 font-mono uppercase tracking-widest">Staff</th>
                      {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                        <th key={d} className="p-2 text-xs text-gray-500 text-center font-mono tracking-widest">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.id} className="bg-[#070a13]/70 rounded-xl overflow-hidden">
                        <td
                          className="p-3 font-heading font-black text-xs border-l-4 rounded-l-xl text-white"
                          style={{ borderLeftColor: ROLE_COLORS[e.role] || "#7ec8e3" }}
                        >
                          <div>{e.name}</div>
                          {(() => {
                            const hrs = getScheduledHoursForWeek(e.id)
                            if (hrs > 40) {
                              return (
                                <div className="text-[8px] text-[#fca311] font-mono mt-1 font-bold uppercase tracking-wider animate-pulse">
                                  ⚠️ OT ({hrs.toFixed(1)}h)
                                </div>
                              )
                            }
                            return null
                          })()}
                        </td>
                        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => {
                          const val = schedules[activeWeekKey]?.[d]?.[e.id] || "OFF"
                          const isOff = val === "OFF"
                          let start = "09:00", end = "17:00", shiftRole = e.role
                          
                          if (!isOff) {
                            const parts = val.split("|")
                            const times = parts[0].split("-")
                            start = times[0] || "09:00"
                            end = times[1] || "17:00"
                            shiftRole = parts[1] || e.role
                          }

                          return (
                            <td key={d} className="p-1.5 text-center">
                              <button
                                onClick={() => {
                                  const next = { ...schedules }
                                  if (!next[activeWeekKey]) next[activeWeekKey] = {}
                                  if (!next[activeWeekKey][d]) next[activeWeekKey][d] = {}
                                  next[activeWeekKey][d][e.id] = isOff ? `09:00-17:00|${e.role}` : "OFF"
                                  setSchedules(next)
                                }}
                                className="text-[9px] text-[#7ec8e3] hover:text-white uppercase tracking-widest font-mono cursor-pointer block mx-auto mb-1"
                              >
                                {isOff ? "Assign" : "Set Off"}
                              </button>
                              
                              {isOff ? (
                                <div className="bg-[#fca311]/5 border border-[#fca311]/10 text-[#fca311] text-center text-[10px] font-black py-2 rounded-xl font-mono uppercase tracking-widest">
                                  OFF
                                </div>
                              ) : (
                                <div className="flex flex-col bg-[#111827]/90 border border-slate-800 p-1.5 rounded-xl gap-1">
                                  <input
                                    type="time"
                                    value={parseTo24h(start)}
                                    onChange={(ev) => {
                                      const next = { ...schedules }
                                      next[activeWeekKey][d][e.id] = `${ev.target.value}-${end}|${shiftRole}`
                                      setSchedules(next)
                                    }}
                                    className="bg-transparent text-[10px] text-center font-mono focus:outline-none text-gray-200"
                                    style={{ colorScheme: "dark" }}
                                  />
                                  <input
                                    type="time"
                                    value={parseTo24h(end)}
                                    onChange={(ev) => {
                                      const next = { ...schedules }
                                      next[activeWeekKey][d][e.id] = `${start}-${ev.target.value}|${shiftRole}`
                                      setSchedules(next)
                                    }}
                                    className="bg-transparent text-[10px] text-center font-mono focus:outline-none text-gray-200"
                                    style={{ colorScheme: "dark" }}
                                  />
                                  <select
                                    value={shiftRole}
                                    onChange={(ev) => {
                                      const next = { ...schedules }
                                      next[activeWeekKey][d][e.id] = `${start}-${end}|${ev.target.value}`
                                      setSchedules(next)
                                    }}
                                    className="bg-transparent text-[9px] text-[#7ec8e3] text-center mt-0.5 focus:outline-none cursor-pointer w-full border-t border-slate-800/60 pt-1"
                                  >
                                    {availableRoles.map((r) => (
                                      <option key={r} value={r} className="bg-slate-900 text-gray-300">
                                        {r}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Timeline Gantt view */
              <div className="flex flex-col gap-4 animate-fade-in">
                {/* Day selector row */}
                <div className="flex flex-wrap gap-1.5 pb-2 border-b border-white/5">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => {
                    const active = selectedDay === d
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSelectedDay(d)}
                        className={`py-1.5 px-3 rounded-lg border text-[10px] font-mono font-bold transition-all cursor-pointer ${
                          active
                            ? "bg-[#7ec8e3]/15 border-[#7ec8e3]/30 text-[#7ec8e3]"
                            : "bg-slate-900/40 border-white/5 text-gray-500 hover:text-gray-300"
                        }`}
                      >
                        {d.toUpperCase().slice(0, 3)}
                      </button>
                    )
                  })}
                </div>

                <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-4 shadow-xl overflow-x-auto w-full">
                  <div className="min-w-[760px] flex flex-col">
                    
                    {/* Time Grid Header */}
                    <div className="flex border-b border-white/5 pb-2 mb-2 font-mono text-[9px] text-gray-500 uppercase tracking-wider font-bold">
                      <div className="w-[160px] shrink-0 pl-2">Staff Member</div>
                      <div className="flex-1 grid grid-cols-12 text-center">
                        <div>8 AM</div>
                        <div>9 AM</div>
                        <div>10 AM</div>
                        <div>11 AM</div>
                        <div>12 PM</div>
                        <div>1 PM</div>
                        <div>2 PM</div>
                        <div>3 PM</div>
                        <div>4 PM</div>
                        <div>5 PM</div>
                        <div>6 PM</div>
                        <div>7 PM</div>
                      </div>
                      <div className="w-8 text-center shrink-0">8 PM</div>
                    </div>

                    {/* Timeline Rows */}
                    <div className="flex flex-col gap-2">
                      {employees.map((emp) => {
                        const shiftStr = schedules[activeWeekKey]?.[selectedDay]?.[emp.id] || "OFF"
                        const isOff = shiftStr === "OFF"
                        
                        let shift = null
                        let leftPercent = 0
                        let widthPercent = 0
                        
                        if (!isOff) {
                          const parts = shiftStr.split("|")
                          const times = parts[0].split("-")
                          const start = times[0] || "09:00"
                          const end = times[1] || "17:00"
                          const role = parts[1] || emp.role
                          
                          shift = { start, end, role }
                          
                          const parseDecimal = (tStr) => {
                            const [h, m] = tStr.split(":").map(Number)
                            return h + m / 60
                          }
                          
                          const dStart = parseDecimal(start)
                          const dEnd = parseDecimal(end)
                          
                          const cStart = Math.max(8, Math.min(20, dStart))
                          const cEnd = Math.max(8, Math.min(20, dEnd))
                          
                          if (cEnd > cStart) {
                            leftPercent = ((cStart - 8) / 12) * 100
                            widthPercent = ((cEnd - cStart) / 12) * 100
                          }
                        }

                        return (
                          <div
                            key={emp.id}
                            onDragOver={(ev) => ev.preventDefault()}
                            onDrop={(ev) => handleDrop(ev, emp.id)}
                            onClick={() => {
                              if (isOff) {
                                setEditingShift({
                                  employee: emp,
                                  day: selectedDay,
                                  start: "09:00",
                                  end: "17:00",
                                  role: emp.role,
                                  isNew: true
                                })
                              }
                            }}
                            className="flex items-center bg-[#070a13]/70 hover:bg-[#070a13]/90 rounded-xl overflow-hidden min-h-[56px] relative border border-white/5 cursor-pointer group"
                          >
                            <div
                              className="w-[160px] shrink-0 flex items-center gap-2.5 p-2 border-r border-white/5 font-heading text-xs font-black text-white"
                              style={{ borderLeft: `4px solid ${ROLE_COLORS[emp.role] || "#7ec8e3"}` }}
                            >
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[10px] shrink-0"
                                style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                              >
                                {emp.avatar}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{emp.name}</span>
                                <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest font-semibold">{emp.role}</span>
                                {(() => {
                                  const hrs = getScheduledHoursForWeek(emp.id)
                                  if (hrs > 40) {
                                    return (
                                      <span className="text-[8px] text-[#fca311] font-mono mt-0.5 font-bold uppercase tracking-wider animate-pulse">
                                        ⚠️ OT ({hrs.toFixed(1)}h)
                                      </span>
                                    )
                                  }
                                  return null
                                })()}
                              </div>
                            </div>

                            <div className="flex-1 h-14 relative px-1">
                              <div className="absolute inset-0 grid grid-cols-12 pointer-events-none border-l border-white/5">
                                {Array.from({ length: 12 }).map((_, idx) => (
                                  <div key={idx} className="border-r border-white/5 h-full" />
                                ))}
                              </div>

                              {shift ? (
                                <div
                                  draggable={true}
                                  onDragStart={(ev) => handleDragStart(ev, emp.id, shiftStr)}
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    setEditingShift({
                                      employee: emp,
                                      day: selectedDay,
                                      start: shift.start,
                                      end: shift.end,
                                      role: shift.role,
                                      isNew: false
                                    })
                                  }}
                                  style={{
                                    left: `${leftPercent}%`,
                                    width: `${widthPercent}%`,
                                    backgroundColor: ROLE_COLORS[shift.role] || "#7ec8e3",
                                    boxShadow: `0 0 10px ${(ROLE_COLORS[shift.role] || "#7ec8e3")}40`
                                  }}
                                  className="absolute top-1/2 -translate-y-1/2 h-10 rounded-xl flex items-center px-2.5 text-[#070a13] font-bold select-none cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all overflow-hidden"
                                >
                                  <div className="w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[9px] font-mono font-black mr-2 shrink-0">
                                    {emp.avatar}
                                  </div>
                                  <div className="flex flex-col min-w-0 text-left">
                                    <span className="text-[10px] leading-tight font-black font-heading truncate">
                                      {emp.name.split(" ")[0]}
                                    </span>
                                    <span className="text-[8px] leading-none opacity-80 font-mono tracking-wider font-semibold mt-0.5">
                                      {shift.start} - {shift.end}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/10 pointer-events-none">
                                  <span className="text-[9px] font-mono font-black text-gray-500 uppercase tracking-widest">
                                    + Assign Shift
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: PAY CALC
            ------------------------------------------------------------- */}
        {managerTab === "payroll" && payEmp && (
          <div className="flex flex-col md:flex-row gap-6 animate-fade-in">
            {/* Left: Staff Selector */}
            <div className="w-full md:w-1/3 flex flex-col gap-2">
              <div className="text-[10px] text-gray-500 tracking-widest uppercase font-mono mb-2">
                Select Employee
              </div>
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => setPayEmp(emp)}
                  className={`flex items-center gap-3 p-3 rounded-2xl border text-left cursor-pointer transition-all active:scale-[0.98] ${
                    payEmp.id === emp.id
                      ? "bg-[#7ec8e3]/10 border-[#7ec8e3]"
                      : "bg-[#111827]/40 border-white/5 hover:border-white/10"
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[10px] shrink-0"
                    style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                  >
                    {emp.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black truncate text-white font-heading">{emp.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono truncate mt-0.5">
                      ${Number(emp.baseRate || 0).toFixed(2)}/hr
                    </div>
                  </div>
                  {clockedIn[emp.id] && <div className="text-[10px] text-[#06d6a0] shrink-0 font-mono">●</div>}
                </button>
              ))}
            </div>

            {/* Right: Statement Stub */}
            <div className="w-full md:w-2/3 flex flex-col gap-4">
              <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Base Rate</div>
                    <div className="text-base font-black font-mono text-[#7ec8e3] mt-0.5">
                      ${Number(payEmp.baseRate || 0).toFixed(2)}/hr
                    </div>
                  </div>
                  <div>
                    <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">OT Rate</div>
                    <div className="text-base font-black font-mono text-[#fca311] mt-0.5">
                      ${(Number(payEmp.baseRate || 0) * 1.5).toFixed(2)}/hr
                    </div>
                  </div>
                  <div>
                    <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Bonus Rate</div>
                    <div className="text-base font-black font-mono text-[#06d6a0] mt-0.5">
                      {payEmp.bonusRate > 0 ? `$${Number(payEmp.bonusRate).toFixed(2)}/hr` : "—"}
                    </div>
                  </div>
                </div>
                {clockedIn[payEmp.id] && (
                  <div className="mt-4 bg-[#06d6a0]/5 border border-[#06d6a0]/25 rounded-2xl p-3 font-mono text-xs text-[#06d6a0] flex items-center justify-between">
                    <span>⏱ Live Shift Active:</span>
                    <span className="font-bold">{fmtElapsed(getElapsed(payEmp.id))}</span>
                  </div>
                )}
              </div>

              {/* Pay statement stub */}
              <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                <div className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                  Earnings Statement Detail &bull; {payEmp.name}
                </div>
                
                {(() => {
                  const s = timesheets[payEmp.id] || {
                    hours: "0.00",
                    regH: "0.00",
                    otH: "0.00",
                    gross: 0,
                    fed: 0,
                    state: 0,
                    fica: 0,
                    county: 0,
                    netPay: 0
                  }
                  
                  return (
                    <div className="flex flex-col">
                      <div className="flex gap-6 mb-4">
                        <div>
                          <div className="text-xl font-black font-mono text-[#7ec8e3] leading-none">
                            {s.hours}
                          </div>
                          <span className="text-[8px] text-gray-500 uppercase font-mono tracking-widest mt-1 block">
                            Total Hours
                          </span>
                        </div>
                        <div>
                          <div className="text-xl font-black font-mono text-white leading-none">
                            {s.regH}
                          </div>
                          <span className="text-[8px] text-gray-500 uppercase font-mono tracking-widest mt-1 block">
                            Regular
                          </span>
                        </div>
                        <div>
                          <div className="text-xl font-black font-mono text-[#fca311] leading-none">
                            {s.otH}
                          </div>
                          <span className="text-[8px] text-gray-500 uppercase font-mono tracking-widest mt-1 block">
                            Overtime
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center py-2 border-b border-white/5 text-xs font-sans">
                        <span className="text-gray-400">Regular Wages</span>
                        <span className="font-mono text-gray-500">
                          {s.regH}h &times; ${Number(payEmp.baseRate || 0).toFixed(2)}
                        </span>
                        <span className="font-mono text-white font-bold">
                          ${(parseFloat(s.regH) * Number(payEmp.baseRate || 0)).toFixed(2)}
                        </span>
                      </div>
                      
                      {parseFloat(s.otH) > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-white/5 text-xs font-sans">
                          <span className="text-gray-400">Overtime Wages</span>
                          <span className="font-mono text-gray-500">
                            {s.otH}h &times; ${(Number(payEmp.baseRate || 0) * 1.5).toFixed(2)}
                          </span>
                          <span className="font-mono text-[#fca311] font-bold">
                            ${(parseFloat(s.otH) * Number(payEmp.baseRate || 0) * 1.5).toFixed(2)}
                          </span>
                        </div>
                      )}
                      
                      {payEmp.bonusRate > 0 && parseFloat(s.hours) > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-white/5 text-xs font-sans">
                          <span className="text-gray-400">Role Bonus</span>
                          <span className="font-mono text-gray-500">
                            {s.hours}h &times; ${Number(payEmp.bonusRate).toFixed(2)}
                          </span>
                          <span className="font-mono text-[#06d6a0] font-bold">
                            ${(parseFloat(s.hours) * Number(payEmp.bonusRate)).toFixed(2)}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center py-3 border-t-2 border-slate-800/80 mt-2 text-sm">
                        <span className="font-black text-white font-heading">Gross Wages</span>
                        <span className="font-mono text-[#7ec8e3] font-black">{fmtMoney(s.gross)}</span>
                      </div>

                      <div className="h-4"></div>

                      <div className="flex justify-between items-center py-1.5 border-b border-white/5 text-xs">
                        <span className="text-gray-400">Federal Tax</span>
                        <span className="font-mono text-gray-500">{Number(payEmp.fedTaxRate || 0).toFixed(1)}%</span>
                        <span className="font-mono text-[#ef476f] font-semibold">-{fmtMoney(s.fed)}</span>
                      </div>
                      
                      <div className="flex justify-between items-center py-1.5 border-b border-white/5 text-xs">
                        <span className="text-gray-400">State Tax</span>
                        <span className="font-mono text-gray-500">{Number(payEmp.stateTaxRate || 0).toFixed(1)}%</span>
                        <span className="font-mono text-[#ef476f] font-semibold">-{fmtMoney(s.state)}</span>
                      </div>

                      <div className="flex justify-between items-center py-1.5 border-b border-white/5 text-xs">
                        <span className="text-gray-400">FICA Tax</span>
                        <span className="font-mono text-gray-500">{Number(payEmp.ficaTaxRate || 0).toFixed(2)}%</span>
                        <span className="font-mono text-[#ef476f] font-semibold">-{fmtMoney(s.fica)}</span>
                      </div>

                      {Number(payEmp.countyTaxRate) > 0 && (
                        <div className="flex justify-between items-center py-1.5 border-b border-white/5 text-xs">
                          <span className="text-gray-400">County Tax</span>
                          <span className="font-mono text-gray-500">{Number(payEmp.countyTaxRate || 0).toFixed(1)}%</span>
                          <span className="font-mono text-[#ef476f] font-semibold">-{fmtMoney(s.county)}</span>
                        </div>
                      )}

                      <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-[#06d6a0]/5 to-[#7ec8e3]/5 border border-[#06d6a0]/15 flex justify-between items-center shadow-md">
                        <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">Net Pay Stub</span>
                        <span className="text-xl font-mono font-black text-[#06d6a0]">{fmtMoney(s.netPay)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: EMPLOYEES
            ------------------------------------------------------------- */}
        {managerTab === "employees" && (
          <div className="flex flex-col gap-4 animate-fade-in">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-black text-white font-heading">Staff Roster</h2>
              <button
                onClick={() => {
                  if (!managerSession) return denyReadOnly("add employees")
                  setShowAddEmp(true)
                }}
                className="bg-[#7ec8e3] text-[#070a13] hover:bg-[#68b4d0] font-heading font-black text-xs py-2.5 px-4 rounded-xl cursor-pointer transition-all active:scale-95"
              >
                + Add Employee
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {employees.map((e) => (
                <div
                  key={e.id}
                  className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 flex justify-between items-center shadow-md hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[13px] shrink-0"
                      style={{ backgroundColor: ROLE_COLORS[e.role] || "#7ec8e3" }}
                    >
                      {e.avatar}
                    </div>
                    <div>
                      <div className="text-sm font-black text-white font-heading">{e.name}</div>
                      <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mt-0.5">
                        {e.role}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Hourly summaries */}
                    <div className="hidden sm:flex items-center gap-3 bg-[#070a13] border border-white/5 rounded-xl p-2 font-mono text-[11px]">
                      <div className="text-center">
                        <div className="font-bold text-[#7ec8e3]">${Number(e.baseRate || 0).toFixed(2)}</div>
                        <div className="text-[7px] text-gray-500 uppercase tracking-widest mt-0.5">Base</div>
                      </div>
                      <div className="w-px h-5 bg-white/5"></div>
                      <div className="text-center">
                        <div className="font-bold text-[#fca311]">${(Number(e.baseRate || 0) * 1.5).toFixed(2)}</div>
                        <div className="text-[7px] text-gray-500 uppercase tracking-widest mt-0.5">OT</div>
                      </div>
                      <div className="w-px h-5 bg-white/5"></div>
                      <div className="text-center">
                        <div className="font-bold text-[#06d6a0]">
                          {Number(e.bonusRate) > 0 ? `$${Number(e.bonusRate).toFixed(2)}` : "—"}
                        </div>
                        <div className="text-[7px] text-gray-500 uppercase tracking-widest mt-0.5">Bonus</div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (!managerSession) return denyReadOnly("edit employee details")
                        setEditEmp(e)
                      }}
                      className="bg-[#111827] border border-slate-800 text-[#7ec8e3] hover:text-white w-8 h-8 rounded-xl flex items-center justify-center text-xs cursor-pointer hover:bg-slate-800 transition-colors"
                      aria-label={`Edit ${e.name}`}
                      title="Edit employee"
                    >
                      ✏️
                    </button>
                    
                    <button
                      onClick={async () => {
                        if (!managerSession) return denyReadOnly("remove employees")
                        const confirmation = await promptDialog({
                          title: `Delete ${e.name}?`,
                          message: "This permanently removes the employee and cannot be undone.",
                          placeholder: "Type DELETE",
                          match: "DELETE",
                          confirmText: "Delete Permanently",
                        })
                        if (confirmation === "DELETE") {
                          const { error } = await supabase.from("employees").delete().eq("id", e.id)
                          if (error) {
                            toast.error("Deletion failed: " + error.message)
                          } else {
                            setEmployees((prev) => prev.filter((emp) => emp.id !== e.id))
                            toast.success(`${e.name} has been removed.`)
                          }
                        }
                      }}
                      className="bg-[#ef476f] text-[#070a13] hover:bg-[#d43d5e] w-8 h-8 rounded-xl flex items-center justify-center text-xs cursor-pointer transition-colors"
                      aria-label={`Delete ${e.name}`}
                      title="Delete employee"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: CERTIFICATIONS (COMPLIANCE)
            ------------------------------------------------------------- */}
        {managerTab === "certs" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            {(() => {
              const allCerts = employees.flatMap((e) =>
                (e.certifications || []).map((c) => ({ emp: e, cert: c, ...certStatus(c.expires, now) }))
              )
              const counts = {
                valid: allCerts.filter((c) => c.status === "valid").length,
                expiring: allCerts.filter((c) => c.status === "expiring").length,
                expired: allCerts.filter((c) => c.status === "expired").length,
              }
              return (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                      <div className="text-2xl font-black font-mono text-[#06d6a0]">{counts.valid}</div>
                      <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">Valid</div>
                    </div>
                    <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                      <div className="text-2xl font-black font-mono text-[#fca311]">{counts.expiring}</div>
                      <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">Expiring ≤30d</div>
                    </div>
                    <div className="bg-[#111827]/40 border border-white/5 rounded-2xl p-4 text-center">
                      <div className="text-2xl font-black font-mono text-[#ef476f]">{counts.expired}</div>
                      <div className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">Expired</div>
                    </div>
                  </div>

                  {/* Action-needed list */}
                  <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                    <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                      Needs Attention
                    </h2>
                    {certAlerts.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <div className="text-3xl mb-2">✅</div>
                        <p className="text-xs font-sans">All staff credentials are current. Nothing expiring in the next 30 days.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {certAlerts.map((a, i) => {
                          const style = CERT_STATUS_STYLES[a.status]
                          return (
                            <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-950/30 border border-white/5">
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[11px] shrink-0"
                                  style={{ backgroundColor: ROLE_COLORS[a.emp.role] || "#7ec8e3" }}
                                >
                                  {a.emp.avatar}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-black text-white font-heading truncate">{a.emp.name}</div>
                                  <div className="text-[11px] text-slate-400 font-sans">
                                    {a.cert.type} · expires {fmtDate(a.cert.expires)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[9px] font-mono font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${style.chip}`}>
                                  {a.status === "expired" ? `${Math.abs(a.days)}d ago` : `${a.days}d left`}
                                </span>
                                <button
                                  onClick={() => {
                                    if (!managerSession) return denyReadOnly("update certifications")
                                    setEditEmp(a.emp)
                                  }}
                                  className="text-[10px] font-black uppercase tracking-wider bg-[#7ec8e3]/10 text-[#7ec8e3] hover:bg-[#7ec8e3]/20 border border-[#7ec8e3]/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                                >
                                  Update
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Full roster credentials */}
                  <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                    <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                      All Staff Credentials
                    </h2>
                    <div className="flex flex-col gap-3">
                      {employees.map((e) => (
                        <div key={e.id} className="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                          <div className="flex items-center gap-3 min-w-0 shrink-0 w-40">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[10px] shrink-0"
                              style={{ backgroundColor: ROLE_COLORS[e.role] || "#7ec8e3" }}
                            >
                              {e.avatar}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-black text-white font-heading truncate">{e.name}</div>
                              <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider truncate">{e.role}</div>
                            </div>
                          </div>
                          <div className="flex-1 flex flex-wrap gap-1.5 justify-end">
                            {(e.certifications || []).length === 0 ? (
                              <span className="text-[10px] text-slate-600 font-sans italic">No credentials on file</span>
                            ) : (
                              e.certifications.map((c, idx) => {
                                const st = certStatus(c.expires, now)
                                const style = CERT_STATUS_STYLES[st.status]
                                return (
                                  <span
                                    key={idx}
                                    className={`text-[9px] font-mono font-bold px-2 py-1 rounded-lg border ${style.chip}`}
                                    title={`Expires ${fmtDate(c.expires)}`}
                                  >
                                    {c.type}
                                  </span>
                                )
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: REQUESTS (TIME OFF / SHIFT SWAP INBOX)
            ------------------------------------------------------------- */}
        {managerTab === "requests" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            {(() => {
              const pending = timeOffRequests.filter((r) => r.status === "pending")
              const reviewed = timeOffRequests.filter((r) => r.status !== "pending")
              const RequestRow = ({ r, actionable }) => {
                const emp = employees.find((e) => e.id === r.employee_id)
                const sc = r.status === "approved"
                  ? "bg-[#06d6a0]/10 border-[#06d6a0]/30 text-[#06d6a0]"
                  : r.status === "denied"
                  ? "bg-[#ef476f]/10 border-[#ef476f]/30 text-[#ef476f]"
                  : "bg-[#fca311]/10 border-[#fca311]/30 text-[#fca311]"
                return (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950/30 border border-white/5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[11px] shrink-0"
                        style={{ backgroundColor: ROLE_COLORS[emp?.role] || "#7ec8e3" }}
                      >
                        {emp?.avatar || "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-black text-white font-heading truncate">
                          {emp?.name || `Employee #${r.employee_id}`}
                          <span className="ml-2 text-[10px] font-mono font-bold text-[#7ec8e3] uppercase tracking-wider">{r.type}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-sans">
                          {r.type === "Shift Swap" && r.swap_with && r.swap_day ? (() => {
                            const wk = r.start_date
                            const grid = schedules[wk]?.[r.swap_day] || {}
                            const aShift = (grid[r.employee_id] || "OFF").split("|")[0]
                            const bShift = (grid[r.swap_with] || "OFF").split("|")[0]
                            const coworker = employees.find((e) => e.id === r.swap_with)
                            return (
                              <span>
                                {r.swap_day}: <span className="text-[#06d6a0] font-mono">{aShift}</span>
                                {" ⇄ "}
                                <span className="text-[#7ec8e3]">{coworker?.name?.split(" ")[0] || `#${r.swap_with}`}</span>{" "}
                                <span className="text-[#7ec8e3] font-mono">{bShift}</span>
                                {r.reason ? ` · ${r.reason}` : ""}
                              </span>
                            )
                          })() : (
                            <>
                              {fmtDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ""}
                              {r.reason ? ` · ${r.reason}` : ""}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {actionable ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => reviewRequest(r, "approved")}
                          className="text-[10px] font-black uppercase tracking-wider bg-[#06d6a0]/10 text-[#06d6a0] hover:bg-[#06d6a0]/20 border border-[#06d6a0]/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reviewRequest(r, "denied")}
                          className="text-[10px] font-black uppercase tracking-wider bg-[#ef476f]/10 text-[#ef476f] hover:bg-[#ef476f]/20 border border-[#ef476f]/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          Deny
                        </button>
                      </div>
                    ) : (
                      <span className={`shrink-0 text-[9px] font-mono font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${sc}`}>
                        {r.status}
                      </span>
                    )}
                  </div>
                )
              }
              return (
                <>
                  <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                    <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2 flex items-center justify-between">
                      <span>Pending Approval</span>
                      {pending.length > 0 && (
                        <span className="text-[#fca311] bg-[#fca311]/10 border border-[#fca311]/30 px-2 py-0.5 rounded-lg">{pending.length}</span>
                      )}
                    </h2>
                    {pending.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <div className="text-3xl mb-2">📭</div>
                        <p className="text-xs font-sans">No pending requests. You're all caught up.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {pending.map((r) => <RequestRow key={r.id} r={r} actionable />)}
                      </div>
                    )}
                  </div>

                  {reviewed.length > 0 && (
                    <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                      <h2 className="text-xs font-bold text-gray-400 font-mono tracking-widest uppercase mb-4 border-b border-white/5 pb-2">
                        Reviewed
                      </h2>
                      <div className="flex flex-col gap-2.5">
                        {reviewed.map((r) => <RequestRow key={r.id} r={r} actionable={false} />)}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* -------------------------------------------------------------
            TAB: TIMESHEETS (PUNCH LOGS)
            ------------------------------------------------------------- */}
        {managerTab === "timesheets" && (
          <div className="flex flex-col md:flex-row gap-6 animate-fade-in">
            {/* Left: Selector */}
            <div className="w-full md:w-1/3 flex flex-col gap-2">
              <div className="text-[10px] text-gray-500 tracking-widest uppercase font-mono mb-2">
                Select Staff
              </div>
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setTsEmp(emp)
                    setEditLog(null)
                  }}
                  className={`flex items-center gap-3 p-3 rounded-2xl border text-left cursor-pointer transition-all active:scale-[0.98] ${
                    tsEmp?.id === emp.id
                      ? "bg-[#7ec8e3]/10 border-[#7ec8e3]"
                      : "bg-[#111827]/40 border-white/5 hover:border-white/10"
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-[10px] shrink-0"
                    style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                  >
                    {emp.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black truncate text-white font-heading">{emp.name}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Right: Punch History & Editor */}
            <div className="w-full md:w-2/3 flex flex-col gap-4">
              {!tsEmp ? (
                <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-8 text-center text-gray-500 text-xs font-mono">
                  Select an employee to manage punches.
                </div>
              ) : (
                <div className="bg-[#111827]/40 border border-white/5 rounded-3xl p-5 shadow-xl">
                  <div className="flex justify-between items-center mb-5 border-b border-white/5 pb-3">
                    <div className="text-xs font-bold text-white font-heading">
                      Punch History: {tsEmp.name}
                    </div>
                    <button
                      onClick={() => {
                        setEditLog({ id: "draft" })
                        const defaultDate = new Date()
                        defaultDate.setHours(9, 0, 0, 0)
                        setLogEditData({
                          time: getLocalDatetimeString(defaultDate),
                          action: "IN"
                        })
                      }}
                      className="bg-slate-900 border border-slate-800 text-[#7ec8e3] hover:text-white hover:bg-slate-800 font-mono text-[10px] font-bold py-1.5 px-3 rounded-lg cursor-pointer transition-all active:scale-95"
                    >
                      Add Missing Punch
                    </button>
                  </div>

                  <div className="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                    {/* Inline Form for Adding New Draft Punch */}
                    {editLog?.id === "draft" && (
                      <div className="bg-[#06d6a0]/5 border border-[#06d6a0]/30 p-3.5 rounded-2xl flex flex-col sm:flex-row gap-3 items-center mb-3">
                        <div className="text-[10px] font-mono font-black text-[#06d6a0] tracking-widest sm:w-16 text-center uppercase">
                          NEW
                        </div>
                        <input
                          type="datetime-local"
                          value={logEditData.time}
                          onChange={(e) => setLogEditData({ ...logEditData, time: e.target.value })}
                          className="bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-2 font-mono focus:outline-none w-full sm:w-auto flex-1"
                          style={{ colorScheme: "dark" }}
                        />
                        <select
                          value={logEditData.action}
                          onChange={(e) => setLogEditData({ ...logEditData, action: e.target.value })}
                          className="bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-2 font-mono focus:outline-none w-full sm:w-auto cursor-pointer"
                        >
                          <option value="IN">IN</option>
                          <option value="OUT">OUT</option>
                          <option value="BREAK_START">BREAK_START</option>
                          <option value="BREAK_END">BREAK_END</option>
                        </select>
                        <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                          <button
                            onClick={async () => {
                              const utcDate = new Date(logEditData.time).toISOString()
                              const { data, error } = await supabase.from("clock_logs").insert([
                                {
                                  employee_id: tsEmp.id,
                                  action: logEditData.action,
                                  created_at: utcDate
                                }
                              ])
                              if (error) {
                                toast.error("Insert failed: " + error.message)
                              } else {
                                if (data) {
                                  setAllLogs((prev) => [data[0], ...prev])
                                }
                                setEditLog(null)
                                toast.success("Time punch added.")
                              }
                            }}
                            className="bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] font-heading font-black text-[10px] py-2 px-3 rounded-lg flex-1 cursor-pointer"
                          >
                            Save New
                          </button>
                          <button
                            onClick={() => setEditLog(null)}
                            className="bg-slate-900 text-gray-300 py-2 px-3 rounded-lg text-[10px] flex-1 cursor-pointer border border-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Punch History List */}
                    {allLogs
                      .filter((l) => l.employee_id === tsEmp.id)
                      .slice(0, 30)
                      .map((log) => {
                        const isEditing = editLog?.id === log.id
                        const logDate = new Date(log.created_at)

                        if (isEditing) {
                          return (
                            <div
                              key={log.id}
                              className="bg-[#7ec8e3]/5 border border-[#7ec8e3]/45 p-3.5 rounded-2xl flex flex-col sm:flex-row gap-3 items-center"
                            >
                              <input
                                type="datetime-local"
                                value={logEditData.time}
                                onChange={(e) => setLogEditData({ ...logEditData, time: e.target.value })}
                                className="bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-2 font-mono focus:outline-none w-full sm:w-auto flex-1"
                                style={{ colorScheme: "dark" }}
                              />
                              <select
                                value={logEditData.action}
                                onChange={(e) => setLogEditData({ ...logEditData, action: e.target.value })}
                                className="bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-2 font-mono focus:outline-none w-full sm:w-auto cursor-pointer"
                              >
                                <option value="IN">IN</option>
                                <option value="OUT">OUT</option>
                                <option value="BREAK_START">BREAK_START</option>
                                <option value="BREAK_END">BREAK_END</option>
                                <option value="AUTO-OUT">AUTO-OUT</option>
                              </select>
                              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                                <button
                                  onClick={async () => {
                                    const utcDate = new Date(logEditData.time).toISOString()
                                    const { error } = await supabase
                                      .from("clock_logs")
                                      .update({ action: logEditData.action, created_at: utcDate })
                                      .eq("id", log.id)
                                      
                                    if (error) {
                                      toast.error("Update failed: " + error.message)
                                    } else {
                                      setAllLogs((prev) =>
                                        prev.map((l) =>
                                          l.id === log.id
                                            ? { ...l, action: logEditData.action, created_at: utcDate }
                                            : l
                                        )
                                      )
                                      setEditLog(null)
                                      toast.success("Time punch updated.")
                                    }
                                  }}
                                  className="bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] font-heading font-black text-[10px] py-2 px-3 rounded-lg flex-1 cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditLog(null)}
                                  className="bg-slate-900 text-gray-300 py-2 px-3 rounded-lg text-[10px] flex-1 cursor-pointer border border-slate-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={log.id}
                            className="bg-[#070a13]/70 border border-white/5 p-3 rounded-2xl flex justify-between items-center hover:border-white/10 transition-colors gap-2"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <span
                                className={`w-16 text-[10px] font-black tracking-widest font-mono shrink-0 ${
                                  log.action === "IN" || log.action === "BREAK_END"
                                    ? "text-[#06d6a0]"
                                    : log.action === "AUTO-OUT"
                                    ? "text-[#fca311]"
                                    : "text-[#ef476f]"
                                }`}
                              >
                                {log.action}
                              </span>
                              
                              <div className="truncate flex items-center gap-2">
                                <div>
                                  <div className="text-xs font-semibold text-white truncate font-sans">
                                    {logDate.toLocaleDateString([], {
                                      weekday: "short",
                                      month: "short",
                                      day: "numeric"
                                    })}
                                  </div>
                                  <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                                    {logDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </div>
                                  {log.signature && (
                                    <div className="text-[9px] text-[#06d6a0] font-mono mt-1 flex items-center gap-1 bg-[#06d6a0]/5 px-2 py-0.5 rounded border border-[#06d6a0]/15 w-fit">
                                      <span>🛡️ Verified Sign:</span>
                                      <span className="font-bold">{log.signature}</span>
                                    </div>
                                  )}
                                  {log.suspicious_gps && (
                                    <div className="text-[9px] text-[#ef476f] font-mono mt-1 font-bold flex items-center gap-1 bg-[#ef476f]/5 px-2 py-0.5 rounded border border-[#ef476f]/15 w-fit animate-pulse">
                                      ⚠️ SUSPICIOUS GPS accuracy: Spoofing tool suspected
                                    </div>
                                  )}
                                </div>
                                
                                {/* Hover Audit Photo */}
                                {log.photo_base64 && (
                                  <div className="relative group/audit shrink-0 ml-2">
                                    <span className="cursor-pointer text-xs hover:scale-110 transition-transform block">📷</span>
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/audit:block z-50 p-2 bg-slate-950/95 border border-white/10 rounded-xl shadow-2xl w-36 text-center backdrop-blur-md">
                                      <img src={log.photo_base64} alt="Audit snapshot" className="w-32 h-32 object-cover rounded-lg border border-white/5 mx-auto" />
                                      <div className="text-[8px] text-gray-400 mt-1 font-mono uppercase tracking-wider">Audit Pass</div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  setEditLog(log)
                                  setLogEditData({ time: getLocalDatetimeString(logDate), action: log.action })
                                }}
                                className="text-[#7ec8e3] bg-[#111827] border border-slate-800 hover:bg-slate-800 w-8 h-8 rounded-xl flex items-center justify-center text-xs transition-colors cursor-pointer"
                                aria-label="Edit time punch"
                                title="Edit log"
                              >
                                ✏️
                              </button>
                              
                              <button
                                onClick={async () => {
                                  if (await confirmDialog({ title: "Delete this time punch?", message: "This permanently removes the punch from the record.", confirmText: "Delete", danger: true })) {
                                    const { error } = await supabase.from("clock_logs").delete().eq("id", log.id)
                                    if (error) {
                                      toast.error("Delete failed: " + error.message)
                                    } else {
                                      setAllLogs((prev) => prev.filter((l) => l.id !== log.id))
                                      toast.success("Time punch deleted.")
                                    }
                                  }
                                }}
                                className="text-[#ef476f] bg-[#ef476f]/5 border border-[#ef476f]/15 hover:bg-[#ef476f]/15 w-8 h-8 rounded-xl flex items-center justify-center text-xs transition-colors cursor-pointer"
                                aria-label="Delete time punch"
                                title="Delete log"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Editing Shift Modal Overlay */}
        {editingShift && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-[#111827] border border-white/10 p-6 rounded-3xl w-full max-w-sm shadow-2xl relative">
              <h3 className="font-heading font-black text-sm text-white uppercase tracking-wider mb-1">
                {editingShift.isNew ? "Assign Shift" : "Modify Shift"}
              </h3>
              <p className="text-[10px] text-gray-400 font-mono mb-6">
                {editingShift.employee.name} &bull; {editingShift.day}
              </p>
              
              <div className="flex flex-col gap-4 mb-6">
                <div>
                  <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={editingShift.start}
                    onChange={(e) => setEditingShift(p => ({ ...p, start: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                    style={{ colorScheme: "dark" }}
                  />
                </div>

                <div>
                  <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={editingShift.end}
                    onChange={(e) => setEditingShift(p => ({ ...p, end: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                    style={{ colorScheme: "dark" }}
                  />
                </div>

                <div>
                  <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">
                    Shift Role
                  </label>
                  <select
                    value={editingShift.role}
                    onChange={(e) => setEditingShift(p => ({ ...p, role: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                  >
                    {availableRoles.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!managerSession) {
                      denyReadOnly("modify schedules")
                      setEditingShift(null)
                      return
                    }
                    const next = { ...schedules }
                    if (!next[activeWeekKey]) next[activeWeekKey] = {}
                    if (!next[activeWeekKey][editingShift.day]) next[activeWeekKey][editingShift.day] = {}

                    next[activeWeekKey][editingShift.day][editingShift.employee.id] = `${editingShift.start}-${editingShift.end}|${editingShift.role}`
                    setSchedules(next)
                    setEditingShift(null)
                  }}
                  className="w-full bg-[#06d6a0] text-[#070a13] font-bold text-xs uppercase tracking-wider py-3 rounded-xl hover:bg-[#05b586] transition-all cursor-pointer font-heading"
                >
                  Save Shift
                </button>
                
                {!editingShift.isNew && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!managerSession) {
                        denyReadOnly("modify schedules")
                        setEditingShift(null)
                        return
                      }
                      const next = { ...schedules }
                      if (next[activeWeekKey]?.[editingShift.day]) {
                        delete next[activeWeekKey][editingShift.day][editingShift.employee.id]
                      }
                      setSchedules(next)
                      setEditingShift(null)
                    }}
                    className="w-full bg-[#ef476f]/15 hover:bg-[#ef476f]/25 text-[#ef476f] font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition-all cursor-pointer font-heading"
                  >
                    Remove Shift (Set OFF)
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setEditingShift(null)}
                  className="w-full bg-transparent border border-slate-800 text-gray-400 hover:text-white py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer mt-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
