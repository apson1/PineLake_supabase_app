import { useState, useEffect } from "react"
import { supabase, IS_MOCK_DATABASE, MOCK_ADMIN_EMAIL, MOCK_MGR_EMAIL } from "./lib/supabase"
import { ROLE_COLORS, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle } from "./lib/utils"
import { EmployeeForm } from "./components/Forms"
import PinPad from "./components/PinPad"
import FaceScanUI from "./components/FaceScanUI"
import KioskView from "./components/KioskView"
import PortalView from "./components/PortalView"
import ManagerDashboard from "./components/ManagerDashboard"
import WeatherEffects from "./components/WeatherEffects"

function generatePunchSignature(empId, action, timestamp, photo, coords) {
  const inputStr = `${empId}-${action}-${timestamp}-${photo.substring(0, 100)}-${coords ? coords.latitude : 'kiosk'}`;
  let hash = 0;
  for (let i = 0; i < inputStr.length; i++) {
    const char = inputStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0") + "f8a9e2c4b7d105e";
  return "SEC-SIG-" + hex.toUpperCase().substring(0, 24);
}
import {
  cacheEmployees,
  cacheSchedules,
  getCachedEmployees,
  getCachedSchedules,
  queueOfflinePunch,
  getOfflineQueueLength,
  syncOfflinePunches
} from "./lib/offlineSync"
import * as XLSX from "xlsx"

function getSundayKey(dateStr) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split("T")[0]
}

function parseTo24h(timeStr) {
  if (!timeStr || timeStr === "OFF") return "09:00"
  const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM|am|pm)?/)
  if (match) {
    let [_, h, m, ampm] = match
    h = parseInt(h, 10)
    if (ampm?.toUpperCase() === "PM" && h < 12) h += 12
    if (ampm?.toUpperCase() === "AM" && h === 12) h = 0
    return `${h.toString().padStart(2, "0")}:${m}`
  }
  return "09:00"
}

function formatShiftDisplay(shiftStr) {
  if (!shiftStr || shiftStr.toUpperCase() === "OFF") return "OFF"

  const mainParts = shiftStr.split("|")
  const parts = mainParts[0].split("-")

  if (parts.length !== 2) return shiftStr

  const formatTime = (t) => {
    let [h, m] = t.trim().split(":")
    if (!h || !m) return t
    h = parseInt(h, 10)
    const ampm = h >= 12 ? "PM" : "AM"
    h = h % 12 || 12
    return `${h}:${m} ${ampm}`
  }

  const timeText = `${formatTime(parts[0])} - ${formatTime(parts[1])}`
  const roleStr = mainParts[1]

  if (roleStr) {
    return (
      <div className="flex flex-col items-end">
        <div>{timeText}</div>
        <div className="text-[9px] text-[#7ec8e3] mt-0.5 tracking-widest">{roleStr.toUpperCase()}</div>
      </div>
    )
  }

  return timeText
}

function fmtMoney(n) {
  return "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export default function PineLakeApp() {
  // Global States
  const [employees, setEmployees] = useState([])
  const [schedules, setSchedules] = useState({})
  const [clockedIn, setClockedIn] = useState({})
  const [allLogs, setAllLogs] = useState([])
  const [clockLog, setClockLog] = useState([])
  const [screen, setScreen] = useState("kiosk") // 'kiosk' | 'kiosk-auth' | 'kiosk-action-hub' | 'portal-select' | 'portal-auth' | 'portal-dashboard' | 'manager-login' | 'manager-dashboard'
  const [announcements, setAnnouncements] = useState([])
  const [weather, setWeather] = useState({
    code: 0,
    text: "Sunny",
    temp: 82,
    wind: 5,
    waterTemp: 74,
    flag: "GREEN"
  })
  const [capturedPhoto, setCapturedPhoto] = useState(null)

  // Connection states
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [offlineCount, setOfflineCount] = useState(getOfflineQueueLength())

  // Authentication selection states
  const [authEmp, setAuthEmp] = useState(null)
  const [portalEmp, setPortalEmp] = useState(null)

  // Manager access states
  const [managerSession, setMgrSession] = useState(null)
  const [mgrProfile, setMgrProfile] = useState(null)
  const [mgrLoginMode, setMgrLoginMode] = useState("select")
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [editEmp, setEditEmp] = useState(null)

  const [now, setNow] = useState(new Date())
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split("T")[0])

  const activeWeekKey = getSundayKey(targetDate)

  // Listen to network status changes
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      triggerOfflineSync()
    }
    const handleOffline = () => {
      setIsOnline(false)
    }
    const handleQueueChange = () => {
      setOfflineCount(getOfflineQueueLength())
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("offline-queue-changed", handleQueueChange)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("offline-queue-changed", handleQueueChange)
    }
  }, [])

  // Background check/sync loop
  const triggerOfflineSync = async () => {
    if (navigator.onLine && getOfflineQueueLength() > 0) {
      const res = await syncOfflinePunches(supabase)
      if (res.success && res.count > 0) {
        // Refresh data once sync finishes
        await loadData()
      }
    }
  }

  // Set ticking clock
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Fetch weather on mount and schedule periodic updates
  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=40.6503&longitude=-85.0245&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph"
        )
        if (!res.ok) throw new Error("Weather API error")
        const data = await res.json()
        const current = data.current
        const temp = Math.round(current.temperature_2m)
        const wind = Math.round(current.wind_speed_10m)
        const code = current.weather_code

        let text = "Sunny"
        if (code === 0) text = "Sunny"
        else if (code >= 1 && code <= 3) text = "Partly Cloudy"
        else if (code === 45 || code === 48) text = "Foggy"
        else if (code >= 51 && code <= 67) text = "Rainy"
        else if (code >= 71 && code <= 77) text = "Snowy"
        else if (code >= 80 && code <= 82) text = "Showers"
        else if (code >= 95) text = "Thunderstorm"

        const waterTemp = Math.max(55, Math.min(78, temp - 8))

        let flag = "GREEN"
        if (wind > 18 || waterTemp < 60 || code >= 95) {
          flag = "RED"
        } else if (wind > 12 || waterTemp < 68 || (code >= 51 && code <= 82)) {
          flag = "YELLOW"
        }

        setWeather({
          code,
          text,
          temp,
          wind,
          waterTemp,
          flag
        })
      } catch (err) {
        console.error("Failed to fetch weather:", err)
      }
    }

    fetchWeather()
    const iv = setInterval(fetchWeather, 600000) // 10 minutes
    return () => clearInterval(iv)
  }, [])

  // Dynamic body background theme based on time of day
  const currentHour = now.getHours()
  useEffect(() => {
    let bgClasses = []
    if (currentHour >= 5 && currentHour < 8) {
      bgClasses = ["bg-gradient-to-br", "from-[#1d1b32]", "via-[#2c223c]", "to-[#4c3531]", "min-h-screen"]
    } else if (currentHour >= 8 && currentHour < 18) {
      bgClasses = ["bg-[#0c1220]", "min-h-screen"]
    } else if (currentHour >= 18 && currentHour < 20) {
      bgClasses = ["bg-gradient-to-br", "from-[#13112c]", "via-[#2f1b33]", "to-[#4a1c24]", "min-h-screen"]
    } else {
      bgClasses = ["bg-gradient-to-b", "from-[#05070f]", "to-[#0a0f1d]", "min-h-screen"]
    }

    document.body.className = ""
    document.body.classList.add(...bgClasses)
  }, [currentHour])

  // Set recover password hooks
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        const newPassword = window.prompt("Enter your new secure password (minimum 6 characters):")
        if (newPassword) {
          const { error } = await supabase.auth.updateUser({ password: newPassword })
          if (error) {
            alert("Error: " + error.message)
          } else {
            alert("Password updated successfully.")
          }
        }
        await supabase.auth.signOut()
        setScreen("kiosk")
      }
    })
    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  // Core Data Loading
  async function loadData() {
    let empData = []
    let logs = []
    let schedData = []
    let announcementsData = []

    try {
      if (navigator.onLine || IS_MOCK_DATABASE) {
        // Online fetch
        const { data: fetchedEmp } = await supabase.from("employees").select("*").order("id")
        empData = fetchedEmp || []

        const { data: fetchedLogs } = await supabase.from("clock_logs").select("*").order("created_at", { ascending: false })
        logs = fetchedLogs || []

        const { data: fetchedSched } = await supabase.from("schedules").select("*")
        schedData = fetchedSched || []

        const { data: fetchedAnnouncements } = await supabase.from("announcements").select("*").order("created_at", { ascending: false })
        announcementsData = fetchedAnnouncements || []

        // Cache data for offline launch
        cacheEmployees(empData)

        // Structure schedules to cache
        const schedMap = {}
        schedData.forEach(row => {
          if (!schedMap[row.week_key]) schedMap[row.week_key] = {}
          if (!schedMap[row.week_key][row.day]) schedMap[row.week_key][row.day] = {}
          schedMap[row.week_key][row.day][row.employee_id] = row.shift_time
        })
        cacheSchedules(schedMap)
      } else {
        // Offline load from cache
        empData = getCachedEmployees()
        const cachedSchedules = getCachedSchedules()

        // Load offline clock logs from LocalStorage
        logs = JSON.parse(localStorage.getItem("pinelake_clock_logs") || "[]")

        // Load announcements from LocalStorage
        announcementsData = JSON.parse(localStorage.getItem("pinelake_announcements") || "[]")

        // Map cached schedules directly
        setSchedules(cachedSchedules)
      }
    } catch (e) {
      console.error("Failed to fetch database, loading offline cache...", e)
      empData = getCachedEmployees()
      logs = JSON.parse(localStorage.getItem("pinelake_clock_logs") || "[]")
      announcementsData = JSON.parse(localStorage.getItem("pinelake_announcements") || "[]")
      setSchedules(getCachedSchedules())
    }

    if (empData) {
      const mapped = empData.map(e => ({
        id: e.id,
        name: e.name,
        role: e.role,
        baseRate: e.base_rate,
        bonusRate: e.bonus_rate || 0,
        pin: e.pin,
        authMethod: e.auth_method,
        avatar: e.avatar,
        fedTaxRate: e.fed_tax_rate ?? 12,
        stateTaxRate: e.state_tax_rate ?? 5.5,
        countyTaxRate: e.county_tax_rate ?? 0,
        ficaTaxRate: e.fica_tax_rate ?? 7.65
      }))
      setEmployees(mapped)
    }

    if (logs) {
      setAllLogs(logs)
      const cState = {}
      const rLogs = []
      const seen = new Set()

      logs.forEach(log => {
        if (!seen.has(log.employee_id)) {
          seen.add(log.employee_id)
          if (log.action === "IN" || log.action === "BREAK_END") {
            cState[log.employee_id] = { status: "IN", time: new Date(log.created_at).getTime() }
          } else if (log.action === "BREAK_START") {
            cState[log.employee_id] = { status: "BREAK", time: new Date(log.created_at).getTime() }
          }
        }

        if (rLogs.length < 50) {
          const emp = empData?.find(e => e.id === log.employee_id)
          if (emp) {
            rLogs.push({
              empId: emp.id,
              emp: emp.name,
              action: log.action,
              time: new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              photo_base64: log.photo_base64
            })
          }
        }
      })
      setClockedIn(cState)
      setClockLog(rLogs)
    }

    // If schedule mapping was fetched online, map it
    if (schedData.length > 0) {
      const mapped = {}
      schedData.forEach(row => {
        if (!mapped[row.week_key]) mapped[row.week_key] = {}
        if (!mapped[row.week_key][row.day]) mapped[row.week_key][row.day] = {}
        mapped[row.week_key][row.day][row.employee_id] = row.shift_time
      })
      setSchedules(mapped)
    }

    if (announcementsData) {
      setAnnouncements(announcementsData)
    }
  }

  // Initial Boot Load
  useEffect(() => {
    loadData().then(() => {
      triggerOfflineSync()
    })
  }, [])

  // Real-time updates subscription hook
  useEffect(() => {
    if (employees.length === 0) return

    const channel = supabase.channel("live-clock").on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "clock_logs" },
      (payload) => {
        const log = payload.new
        const emp = employees.find(e => e.id === log.employee_id)
        if (!emp) return

        setAllLogs(prev => [log, ...prev])
        setClockedIn(prev => {
          const next = { ...prev }
          if (log.action === "IN" || log.action === "BREAK_END") {
            next[emp.id] = { status: "IN", time: new Date(log.created_at).getTime() }
          } else if (log.action === "BREAK_START") {
            next[emp.id] = { status: "BREAK", time: new Date(log.created_at).getTime() }
          } else {
            delete next[emp.id]
          }
          return next
        })
        const timeString = new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: log.action, time: timeString, photo_base64: log.photo_base64 }, ...prev.slice(0, 49)])
      }
    ).subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [employees])

  // Timer Tick Helper
  function getElapsed(empId) {
    const rec = clockedIn[empId]
    if (!rec) return 0
    return Math.floor((Date.now() - rec.time) / 1000)
  }

  // Paycheck calculator helper
  function getTimesheetSummary() {
    const summary = {}
    employees.forEach(emp => {
      const empLogs = allLogs
        .filter(l => l.employee_id === emp.id)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      let weekdayMs = 0
      let weekendMs = 0
      let lastIn = null

      empLogs.forEach(log => {
        if ((log.action === "IN" || log.action === "BREAK_END") && !lastIn) {
          lastIn = new Date(log.created_at).getTime()
        } else if ((log.action === "OUT" || log.action === "BREAK_START" || log.action === "AUTO-OUT") && lastIn) {
          const shiftStart = new Date(lastIn)
          const dayOfWeek = shiftStart.getDay()
          const duration = new Date(log.created_at).getTime() - lastIn
          if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
          else weekdayMs += duration
          lastIn = null
        }
      })

      if (lastIn) {
        const dayOfWeek = new Date(lastIn).getDay()
        const duration = Date.now() - lastIn
        if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
        else weekdayMs += duration
      }

      const weekdayH = weekdayMs / 3600000
      const weekendH = weekendMs / 3600000
      const regH = Math.min(weekdayH, 40)
      const otH = Math.max(0, weekdayH - 40) + weekendH

      const baseR = Number(emp.baseRate || 0)
      const bonusR = Number(emp.bonusRate || 0)

      const gross = (regH * baseR) + (otH * baseR * 1.5) + ((regH + otH) * bonusR)
      const employerTax = gross * 0.1095
      const fed = gross * (Number(emp.fedTaxRate || 0) / 100)
      const state = gross * (Number(emp.stateTaxRate || 0) / 100)
      const county = gross * (Number(emp.countyTaxRate || 0) / 100)
      const fica = gross * (Number(emp.ficaTaxRate || 0) / 100)
      const totalEmpTaxes = fed + state + county + fica

      const liveMs = clockedIn[emp.id] ? (Date.now() - clockedIn[emp.id].time) : 0

      summary[emp.id] = {
        hours: (regH + otH).toFixed(2),
        regH: regH.toFixed(2),
        otH: otH.toFixed(2),
        liveH: (liveMs / 3600000).toFixed(2),
        gross,
        employerTax,
        totalCost: gross + employerTax,
        empTaxes: totalEmpTaxes,
        netPay: gross - totalEmpTaxes,
        fed,
        state,
        county,
        fica
      }
    })
    return summary
  }
  const timesheets = getTimesheetSummary()

  // Export CSV Action
  async function handleExportCSV() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data || data.length === 0) return alert("No history found.")
    let csv = "Employee,Week Start,Total Hours,Pay Rate,Gross Pay,Fed Tax,State Tax,County Tax,FICA,Employer Tax,Total Cost,Net Pay\n"
    data.forEach(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      csv += `"${e?.name || r.employee_id}",${r.week_start_date},${r.total_hours},${r.pay_rate_at_time},${r.gross_pay},${r.fed_tax},${r.state_tax},${r.county_tax},${r.fica_tax},${r.employer_tax},${r.total_cost},${r.net_pay}\n`
    })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    link.download = `Payroll_${new Date().toISOString().split("T")[0]}.csv`
    link.click()
  }

  // Export Excel Action
  async function handleExportXLSX() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data || data.length === 0) return alert("No history found.")
    const sheet = data.map(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      return {
        Employee: e?.name || r.employee_id,
        Date: r.week_start_date,
        Hours: r.total_hours,
        Rate: r.pay_rate_at_time,
        Gross: r.gross_pay,
        Fed: r.fed_tax,
        State: r.state_tax,
        County: r.county_tax,
        FICA: r.fica_tax,
        "Er Tax": r.employer_tax,
        "Total Cost": r.total_cost,
        Net: r.net_pay
      }
    })
    const ws = XLSX.utils.json_to_sheet(sheet)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Payroll")
    XLSX.writeFile(wb, `Payroll_${new Date().toISOString().split("T")[0]}.xlsx`)
  }

  // Finalize Payroll Action
  async function handleFinalizePayroll() {
    if (Object.values(clockedIn).some(s => s.status === "IN" || s.status === "BREAK")) {
      return alert("Employees must clock out first before finalizing payroll.")
    }
    const records = employees.map(emp => {
      const s = timesheets[emp.id]
      return {
        employee_id: emp.id,
        week_start_date: activeWeekKey,
        total_hours: parseFloat(s.hours),
        pay_rate_at_time: emp.baseRate,
        gross_pay: s.gross,
        fed_tax: s.fed,
        state_tax: s.state,
        county_tax: s.county,
        fica_tax: s.fica,
        employer_tax: s.employerTax,
        total_cost: s.totalCost,
        net_pay: s.netPay
      }
    }).filter(r => r.total_hours > 0)

    if (records.length === 0) return alert("No hours logged to save.")

    const { error } = await supabase.from("payroll_history").insert(records)
    if (error) {
      alert("Failed to finalize payroll: " + error.message)
    } else {
      alert("Payroll finalized and stored successfully.")
    }
  }

  // Save Employee Details
  async function handleSaveEmployee(empData) {
    const dbPayload = {
      name: empData.name,
      role: empData.role || empData.workRole,
      base_rate: parseFloat(empData.baseRate || 0),
      bonus_rate: parseFloat(empData.bonusRate || 0),
      pin: empData.pin,
      auth_method: empData.authMethod || "pin",
      avatar: empData.avatar || empData.name.split(" ").map(n => n[0]).join("").toUpperCase(),
      fed_tax_rate: parseFloat(empData.fedTaxRate || 12),
      state_tax_rate: parseFloat(empData.stateTaxRate || 5.5),
      county_tax_rate: parseFloat(empData.countyTaxRate || 0),
      fica_tax_rate: parseFloat(empData.ficaTaxRate || 7.65)
    }

    try {
      if (empData.id && String(empData.id).length < 10) {
        const { error } = await supabase.from("employees").update(dbPayload).eq("id", empData.id)
        if (error) throw error
        setEmployees(prev => prev.map(e => e.id === empData.id ? { ...empData, ...dbPayload } : e))
      } else {
        const { data, error } = await supabase.from("employees").insert([dbPayload]).select()
        if (error) throw error
        if (data) setEmployees(prev => [...prev, { ...dbPayload, id: data[0].id }])
      }
      setShowAddEmp(false)
      setEditEmp(null)
    } catch (err) {
      console.error("Save Error:", err)
      alert("Save failed: " + err.message)
    }
  }

  // Core Clock Action Trigger (Shared by Kiosk & Portal)
  async function doClockAction(emp, type, bypassKioskCheck = false, coords = null) {
    const isOfficialKiosk = !!localStorage.getItem("official_kiosk_token")
    if (!bypassKioskCheck && !isOfficialKiosk && (type === "IN" || type === "OUT" || type === "BREAK_START" || type === "BREAK_END")) {
      alert("SECURITY ERROR: You can only clock in or out from the designated park tablet kiosk.")
      setCapturedPhoto(null)
      setAuthEmp(null)
      setScreen("kiosk")
      return
    }

    const isOnlineMode = navigator.onLine && !IS_MOCK_DATABASE
    const photo = capturedPhoto || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23111827'/><circle cx='50' cy='45' r='16' fill='%2300b4d8'/><path d='M20,90 C20,74 80,74 80,90' fill='%2300b4d8'/><text x='50' y='92' font-family='monospace' font-size='8' fill='%239ca3af' text-anchor='middle'>PORTAL GPS</text></svg>`

    const finalCoords = coords || { latitude: 40.650318, longitude: -85.024517, accuracy: 5 }
    const isSuspicious = finalCoords && (finalCoords.accuracy === 0 || finalCoords.accuracy > 150)
    const timestamp = new Date().toISOString()
    const signature = generatePunchSignature(emp.id, type, timestamp, photo, finalCoords)

    // OFFLINE QUEUE TRIGGER
    if (!isOnlineMode) {
      const offlineLogRec = queueOfflinePunch(emp.id, type)

      // Update state immediately for local representation
      setClockedIn(prev => {
        const next = { ...prev }
        if (type === "IN" || type === "BREAK_END") {
          next[emp.id] = { status: "IN", time: Date.now() }
        } else if (type === "BREAK_START") {
          next[emp.id] = { status: "BREAK", time: Date.now() }
        } else {
          delete next[emp.id]
        }
        return next
      })

      // Add to clock activity log
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: type, time: timeStr, photo_base64: photo, signature: signature, suspicious_gps: isSuspicious }, ...prev.slice(0, 49)])

      // Save offline punch logs in LocalStorage clock_logs array for offline roster display
      const offlineLogs = JSON.parse(localStorage.getItem("pinelake_clock_logs") || "[]")
      offlineLogs.unshift({
        id: offlineLogRec.id,
        employee_id: emp.id,
        action: type,
        created_at: offlineLogRec.created_at,
        photo_base64: photo,
        signature: signature,
        suspicious_gps: isSuspicious
      })
      localStorage.setItem("pinelake_clock_logs", JSON.stringify(offlineLogs))

      alert(`Offline Punch saved successfully (${type})! It will synchronize once internet is restored.`)
      setCapturedPhoto(null)
      setAuthEmp(null)
      setScreen("kiosk")
      return
    }

    // ONLINE PUNCH TRIGGER
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: `emp_${emp.id}@pinelake.internal`,
        password: emp.pin
      })
      if (authError) {
        setCapturedPhoto(null)
        return alert("Security Error: Identity verification failed.")
      }

      const { error: insertError } = await supabase.from("clock_logs").insert([{
        employee_id: emp.id,
        action: type,
        photo_base64: photo,
        signature: signature,
        suspicious_gps: isSuspicious
      }])
      if (insertError) throw insertError

      await supabase.auth.signOut()
    } catch (err) {
      console.error(err)
      alert("Punch failed: " + err.message)
    }

    setCapturedPhoto(null)
    setAuthEmp(null)
    setScreen("kiosk")
  }

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // SCREEN ROUTER RENDERING
  // -------------------------------------------------------------

  function renderScreen() {
    // View: Main Time Clock Roster Station
    if (screen === "kiosk") {
      return (
        <KioskView
          employees={employees}
          clockedIn={clockedIn}
          getElapsed={getElapsed}
          now={now}
          setAuthEmp={setAuthEmp}
          setScreen={setScreen}
          setMgrLoginMode={setMgrLoginMode}
          offlineCount={offlineCount}
          isOnline={isOnline}
          weather={weather}
          announcements={announcements}
        />
      )
    }

    // View: Kiosk Verification (PINPad or Face Scan)
    if (screen === "kiosk-auth" && authEmp) {
      return (
        <div className="bg-transparent min-h-screen flex items-center justify-center p-6 text-[#f3f4f6]">
          <div className="w-full max-w-[320px]">
            <div className="text-center mb-6">
              <div
                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] font-mono text-lg shadow-md"
                style={{ backgroundColor: ROLE_COLORS[authEmp.role] || "#7ec8e3" }}
              >
                {authEmp.avatar}
              </div>
              <div className="text-lg font-black text-white font-heading">{authEmp.name}</div>
            </div>
            {authEmp.authMethod === "face" ? (
              <FaceScanUI
                onSuccess={(img) => {
                  setCapturedPhoto(img)
                  setScreen("kiosk-action-hub")
                }}
                onCancel={() => {
                  setCapturedPhoto(null)
                  setScreen("kiosk")
                }}
              />
            ) : (
              <PinPad
                correctPin={authEmp.pin}
                label="ENTER KIOSK PIN"
                onSuccess={() => setScreen("kiosk-action-hub")}
                onCancel={() => setScreen("kiosk")}
              />
            )}
          </div>
        </div>
      )
    }

    // View: Kiosk Action Hub (Clock-in options)
    if (screen === "kiosk-action-hub" && authEmp) {
      const s = clockedIn[authEmp.id]
      const isW = s?.status === "IN"
      const isB = s?.status === "BREAK"
      const isO = !s
      const elapsed = getElapsed(authEmp.id)
      return (
        <div className="bg-transparent min-h-screen flex items-center justify-center p-6 text-[#f3f4f6]">
          <div className="w-full max-w-[380px] bg-[#111827]/60 backdrop-blur-xl border border-white/5 rounded-3xl p-6 shadow-2xl text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] font-mono text-lg shadow-md"
              style={{ backgroundColor: ROLE_COLORS[authEmp.role] || "#7ec8e3" }}
            >
              {authEmp.avatar}
            </div>
            <h2 className="text-xl font-black text-white font-heading mb-1">Hello, {authEmp.name.split(" ")[0]}</h2>
            <div className="text-gray-500 text-[10px] mb-6 uppercase tracking-widest font-mono">Select Action</div>

            {isW && <div className="text-4xl font-mono font-black text-[#06d6a0] mb-6">{fmtElapsed(elapsed)}</div>}
            {isB && <div className="text-4xl font-mono font-black text-[#fca311] mb-6">{fmtElapsed(elapsed)}</div>}

            <div className="flex flex-col gap-4">
              {isO && (
                <button
                  onClick={() => doClockAction(authEmp, "IN")}
                  className="bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
                >
                  Clock In
                </button>
              )}
              {isW && (
                <>
                  <button
                    onClick={() => doClockAction(authEmp, "BREAK_START")}
                    className="bg-slate-900 border border-slate-800 text-gray-200 hover:bg-slate-800 w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer font-heading"
                  >
                    Start Break
                  </button>
                  <button
                    onClick={() => doClockAction(authEmp, "OUT")}
                    className="bg-[#ef476f] text-[#070a13] hover:bg-[#d43d5e] w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer font-heading"
                  >
                    Clock Out
                  </button>
                </>
              )}
              {isB && (
                <button
                  onClick={() => doClockAction(authEmp, "BREAK_END")}
                  className="bg-[#fca311] text-[#070a13] hover:bg-[#e0910e] w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
                >
                  End Break
                </button>
              )}
            </div>

            <button
              onClick={() => setScreen("kiosk")}
              className="mt-6 text-gray-500 hover:text-white text-[10px] font-mono tracking-widest uppercase py-1.5 px-4 rounded border border-transparent hover:border-slate-800 cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )
    }

    // View: Portal Employee Selection
    if (screen === "portal-select") {
      return (
        <div className="bg-transparent min-h-screen text-[#f3f4f6] max-w-lg mx-auto px-4 py-8 font-sans">
          <div className="flex justify-between items-center border-b border-white/5 pb-4 mb-6">
            <h1 className="text-lg font-black text-white font-heading">Select Profile</h1>
            <button
              onClick={() => setScreen("kiosk")}
              className="text-[10px] font-mono text-gray-400 uppercase tracking-widest hover:text-white transition-colors cursor-pointer"
            >
              Back
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {employees.map(emp => (
              <button
                key={emp.id}
                onClick={() => {
                  setAuthEmp(emp)
                  setScreen("portal-auth")
                }}
                className="flex items-center gap-4 p-3.5 rounded-2xl border border-white/5 bg-[#111827]/40 hover:border-[#7ec8e3]/30 text-left w-full transition-all duration-200 cursor-pointer"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-xs shadow-md"
                  style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                >
                  {emp.avatar}
                </div>
                <div>
                  <div className="text-sm font-black text-white font-heading">{emp.name}</div>
                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: ROLE_COLORS[emp.role] || "#7ec8e3" }}>
                    {emp.role}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )
    }

    // View: Portal Login Verification (PIN code entry)
    if (screen === "portal-auth" && authEmp) {
      return (
        <div className="bg-transparent min-h-screen flex items-center justify-center p-6 text-[#f3f4f6]">
          <div className="w-full max-w-[320px]">
            <div className="text-center mb-6">
              <div
                className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] font-mono text-sm shadow-md"
                style={{ backgroundColor: ROLE_COLORS[authEmp.role] || "#7ec8e3" }}
              >
                {authEmp.avatar}
              </div>
              <div className="text-base font-black text-white font-heading">{authEmp.name}</div>
            </div>
            <PinPad
              correctPin={authEmp.pin}
              label="ENTER PORTAL PIN"
              onSuccess={() => {
                setPortalEmp(authEmp)
                setScreen("portal-dashboard")
              }}
              onCancel={() => setScreen("portal-select")}
            />
          </div>
        </div>
      )
    }

    // View: Portal Personal Dashboard (GPS verification & hours statement)
    if (screen === "portal-dashboard" && portalEmp) {
      return (
        <PortalView
          portalEmp={portalEmp}
          setPortalEmp={setPortalEmp}
          setScreen={setScreen}
          clockedIn={clockedIn}
          getElapsed={getElapsed}
          activeWeekKey={activeWeekKey}
          schedules={schedules}
          timesheets={timesheets}
          formatShiftDisplay={formatShiftDisplay}
          onClockAction={(actionType, coords) => doClockAction(portalEmp, actionType, true, coords)}
          announcements={announcements}
        />
      )
    }

    // View: Manager Login Form
    if (screen === "manager-login") {
      if (mgrLoginMode === "select") {
        const managerEmployees = employees.filter(e => ["Manager", "Site Manager", "Park Admin"].includes(e.role))
        return (
          <div className="bg-transparent min-h-screen text-[#f3f4f6] flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-[340px]">
              <div className="text-center mb-6">
                <h2 className="text-lg font-black text-white font-heading">Manager Access</h2>
                <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest font-mono">Select Manager Account</div>
              </div>
              <div className="flex flex-col gap-3 mb-6">
                {managerEmployees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => {
                      setAuthEmp(emp)
                      setMgrLoginMode("pin")
                    }}
                    className="flex items-center gap-4 p-4 rounded-2xl border border-white/5 bg-[#111827]/40 hover:border-[#fca311]/40 text-left w-full transition-all duration-200 cursor-pointer"
                  >
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-[#111] font-mono text-xs shadow-md"
                      style={{ backgroundColor: ROLE_COLORS[emp.role] || "#7ec8e3" }}
                    >
                      {emp.avatar}
                    </div>
                    <div>
                      <div className="text-sm font-black text-white font-heading">{emp.name}</div>
                      <div className="text-[10px] font-semibold mt-0.5" style={{ color: ROLE_COLORS[emp.role] || "#7ec8e3" }}>
                        {emp.role}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="border-t border-white/5 pt-6 flex flex-col gap-3">
                <button
                  onClick={() => setMgrLoginMode("email")}
                  className="w-full bg-[#111827] border border-slate-800 text-white py-3 rounded-xl font-heading font-black text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors cursor-pointer active:scale-95"
                >
                  Remote Email Login
                </button>
                <button
                  onClick={() => setScreen("kiosk")}
                  className="w-full bg-transparent border border-slate-800 text-[#7ec8e3] py-3 rounded-xl font-heading font-black text-xs uppercase tracking-wider hover:bg-slate-900 transition-colors cursor-pointer active:scale-95"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      }

      if (mgrLoginMode === "pin" && authEmp) {
        return (
          <div className="bg-transparent min-h-screen flex items-center justify-center p-6 text-[#f3f4f6]">
            <div className="w-full max-w-[320px]">
              <div className="text-center mb-6">
                <div
                  className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] font-mono text-lg shadow-md"
                  style={{ backgroundColor: ROLE_COLORS[authEmp.role] || "#7ec8e3" }}
                >
                  {authEmp.avatar}
                </div>
                <div className="text-lg font-black text-white font-heading">{authEmp.name}</div>
              </div>
              <PinPad
                correctPin={authEmp.pin}
                label="ENTER MANAGER PIN"
                onSuccess={() => {
                  setMgrProfile(authEmp)
                  setScreen("manager-dashboard")
                }}
                onCancel={() => setMgrLoginMode("select")}
              />
            </div>
          </div>
        )
      }

      if (mgrLoginMode === "email") {
        return (
          <div className="bg-transparent min-h-screen flex items-center justify-center p-6 text-[#f3f4f6]">
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const email = e.target.email.value
                const password = e.target.password.value

                const { data, error } = await supabase.auth.signInWithPassword({ email, password })
                if (error) return alert("Login failed: " + error.message)

                let managerUser = null

                if (IS_MOCK_DATABASE) {
                  // In mock database mode, check mock accounts
                  const emps = JSON.parse(localStorage.getItem("pinelake_employees") || "[]")
                  const mockEmp = emps.find(emp => emp.auth_id === data.user.id)
                  managerUser = mockEmp || { name: "Administrator", role: "Park Admin" }
                } else {
                  const { data: empData } = await supabase.from("employees").select("*").eq("auth_id", data.user.id).single()
                  managerUser = empData
                }

                const validRoles = ["Site Manager", "Park Admin", "Manager"]
                if (managerUser && validRoles.includes(managerUser.role)) {
                  setMgrSession(data.session)
                  setMgrProfile(managerUser)
                  setScreen("manager-dashboard")
                } else {
                  alert("Access Denied: Account lacks administrative role privileges.")
                  await supabase.auth.signOut()
                }
              }}
              className="w-full max-w-[340px] bg-[#111827]/60 backdrop-blur-xl border border-white/5 p-6 rounded-3xl shadow-2xl"
            >
              <div className="text-center mb-6">
                <h2 className="text-lg font-black text-white font-heading">Secure Web Login</h2>
                <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest font-mono">Email Credentials</div>
              </div>
              <div className="mb-4">
                <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">
                  Email Address
                </label>
                <input
                  name="email"
                  type="email"
                  defaultValue={IS_MOCK_DATABASE ? MOCK_ADMIN_EMAIL : ""}
                  required
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                />
              </div>
              <div className="mb-6">
                <label className="text-[9px] text-gray-400 uppercase font-mono tracking-wider block mb-1.5">
                  Secure Password
                </label>
                <input
                  name="password"
                  type="password"
                  defaultValue={IS_MOCK_DATABASE ? "0000" : ""}
                  required
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-[#7ec8e3] text-[#070a13] py-3.5 rounded-xl font-heading font-black text-xs uppercase tracking-wider hover:bg-[#68b4d0] transition-colors cursor-pointer mb-3"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMgrLoginMode("select")}
                className="w-full bg-transparent border border-slate-800 text-[#7ec8e3] py-3 rounded-xl font-heading font-black text-xs uppercase tracking-wider hover:bg-slate-900 transition-colors cursor-pointer"
              >
                Back
              </button>
            </form>
          </div>
        )
      }
    }

    if (screen === "manager-dashboard") {
      return (
        <ManagerDashboard
          now={now}
          employees={employees}
          setEmployees={setEmployees}
          schedules={schedules}
          setSchedules={setSchedules}
          clockedIn={clockedIn}
          allLogs={allLogs}
          setAllLogs={setAllLogs}
          clockLog={clockLog}
          managerSession={managerSession}
          mgrProfile={mgrProfile}
          setScreen={setScreen}
          setMgrProfile={setMgrProfile}
          setMgrSession={setMgrSession}
          activeWeekKey={activeWeekKey}
          targetDate={targetDate}
          setTargetDate={setTargetDate}
          timesheets={timesheets}
          handleExportCSV={handleExportCSV}
          handleExportXLSX={handleExportXLSX}
          handleFinalizePayroll={handleFinalizePayroll}
          handleSaveEmployee={handleSaveEmployee}
          setShowAddEmp={setShowAddEmp}
          editEmp={editEmp}
          setEditEmp={setEditEmp}
          EmployeeForm={EmployeeForm}
          getElapsed={getElapsed}
          parseTo24h={parseTo24h}
          announcements={announcements}
          loadData={loadData}
        />
      )
    }

    return null
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <WeatherEffects weather={weather} />
      <div className="relative z-10">
        {showAddEmp && (
          <EmployeeForm title="Add Staff Member" onSave={handleSaveEmployee} onClose={() => setShowAddEmp(false)} />
        )}
        {editEmp && (
          <EmployeeForm
            title="Edit Details"
            initial={editEmp}
            onSave={handleSaveEmployee}
            onClose={() => setEditEmp(null)}
          />
        )}
        {renderScreen()}
      </div>
    </div>
  )
}