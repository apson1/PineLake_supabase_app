import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"
import * as XLSX from "xlsx"

// --- UTILS ---
function getSundayKey(dateStr) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

function parseTo24h(timeStr) {
  if (!timeStr || timeStr === "OFF") return "09:00"
  const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM|am|pm)?/)
  if (match) {
    let [_, h, m, ampm] = match
    h = parseInt(h, 10)
    if (ampm?.toUpperCase() === "PM" && h < 12) h += 12
    if (ampm?.toUpperCase() === "AM" && h === 12) h = 0
    return `${h.toString().padStart(2, '0')}:${m}`
  }
  return "09:00"
}

function formatShiftDisplay(shiftStr) {
  if (!shiftStr || shiftStr.toUpperCase() === "OFF") return "OFF"
  const parts = shiftStr.split("-")
  if (parts.length !== 2) return shiftStr
  const formatTime = (t) => {
    let [h, m] = t.trim().split(":")
    if (!h || !m) return t
    h = parseInt(h, 10)
    const ampm = h >= 12 ? "PM" : "AM"
    h = h % 12 || 12
    return `${h}:${m} ${ampm}`
  }
  return `${formatTime(parts[0])}\n${formatTime(parts[1])}`
}

function fmtMoney(n) { 
  return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") 
}

export default function PineLakeApp() {
  const [employees, setEmployees] = useState([])
  const [schedules, setSchedules] = useState({})
  const [clockedIn, setClockedIn] = useState({})
  const [allLogs, setAllLogs] = useState([])
  const [clockLog, setClockLog] = useState([])
  const [screen, setScreen] = useState("kiosk")
  const [authEmp, setAuthEmp] = useState(null)
  const [portalEmp, setPortalEmp] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [managerSession, setMgrSession] = useState(null)
  
  // 5-Tab Dashboard State
  const [managerTab, setMgrTab] = useState("clock")
  const [payEmp, setPayEmp] = useState(null)
  
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [editEmp, setEditEmp] = useState(null)
  const [now, setNow] = useState(new Date())
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0])

  const activeWeekKey = getSundayKey(targetDate)

  // Clock Ticker
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    async function loadData() {
      const { data: empData } = await supabase.from("employees").select("*").order("id")
      if (empData) {
        const mapped = empData.map(e => ({
          id: e.id, name: e.name, role: e.role, baseRate: e.base_rate,
          bonusRate: e.bonus_rate, pin: e.pin, authMethod: e.auth_method, avatar: e.avatar,
          fedTaxRate: e.fed_tax_rate ?? 12, stateTaxRate: e.state_tax_rate ?? 5.5,
          countyTaxRate: e.county_tax_rate ?? 0, ficaTaxRate: e.fica_tax_rate ?? 7.65
        }))
        setEmployees(mapped)
        if (mapped.length > 0) setPayEmp(mapped[0])
      }

      const { data: logs } = await supabase.from("clock_logs").select("*").order("created_at", { ascending: false })
      if (logs) {
        setAllLogs(logs)
        const cState = {}; const rLogs = []; const seen = new Set()
        logs.forEach(log => {
          if (!seen.has(log.employee_id)) {
            seen.add(log.employee_id)
            if (log.action === "IN" || log.action === "BREAK_END") cState[log.employee_id] = { status: "IN", time: new Date(log.created_at).getTime() }
            else if (log.action === "BREAK_START") cState[log.employee_id] = { status: "BREAK", time: new Date(log.created_at).getTime() }
          }
          if (rLogs.length < 50) {
            const emp = empData?.find(e => e.id === log.employee_id)
            if (emp) rLogs.push({ empId: emp.id, emp: emp.name, action: log.action, time: new Date(log.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) })
          }
        })
        setClockedIn(cState)
        setClockLog(rLogs)
      }

      const { data: schedData } = await supabase.from("schedules").select("*")
      if (schedData) {
        const mapped = {}
        schedData.forEach(row => {
          if (!mapped[row.week_key]) mapped[row.week_key] = {}
          if (!mapped[row.week_key][row.day]) mapped[row.week_key][row.day] = {}
          mapped[row.week_key][row.day][row.employee_id] = row.shift_time
        })
        setSchedules(mapped)
      }
    }
    loadData()
  }, [])

  useEffect(() => {
    if (employees.length === 0) return
    const channel = supabase.channel("live-clock").on("postgres_changes", { event: "INSERT", schema: "public", table: "clock_logs" }, (payload) => {
      const log = payload.new
      const emp = employees.find(e => e.id === log.employee_id)
      if (!emp) return
      setAllLogs(prev => [log, ...prev])
      setClockedIn(prev => {
        const next = { ...prev }
        if (log.action === "IN" || log.action === "BREAK_END") next[emp.id] = { status: "IN", time: new Date(log.created_at).getTime() }
        else if (log.action === "BREAK_START") next[emp.id] = { status: "BREAK", time: new Date(log.created_at).getTime() }
        else delete next[emp.id]
        return next
      })
      const timeString = new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: log.action, time: timeString }, ...prev.slice(0, 49)])
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [employees])

  function getElapsed(empId){
    const rec = clockedIn[empId]
    if(!rec) return 0
    return Math.floor((Date.now()-rec.time)/1000)
  }

  function getTimesheetSummary() {
    const summary = {}
    employees.forEach(emp => {
      const empLogs = allLogs.filter(l => l.employee_id === emp.id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
      let weekdayMs = 0, weekendMs = 0, lastIn = null
      
      empLogs.forEach(log => {
        if ((log.action === "IN" || log.action === "BREAK_END") && !lastIn) lastIn = new Date(log.created_at).getTime()
        else if ((log.action === "OUT" || log.action === "BREAK_START") && lastIn) {
          const shiftStart = new Date(lastIn), dayOfWeek = shiftStart.getDay()
          const duration = new Date(log.created_at).getTime() - lastIn
          if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
          else weekdayMs += duration
          lastIn = null
        }
      })
      if (lastIn) {
        const dayOfWeek = new Date(lastIn).getDay(), duration = Date.now() - lastIn
        if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
        else weekdayMs += duration
      }
      
      const weekdayH = weekdayMs / 3600000, weekendH = weekendMs / 3600000
      const regH = Math.min(weekdayH, 40), otH = Math.max(0, weekdayH - 40) + weekendH
      const gross = (regH * emp.baseRate) + (otH * emp.baseRate * 1.5) + ((regH + otH) * (emp.bonusRate || 0))
      const employerTax = gross * 0.1095
      const fed = gross * (emp.fedTaxRate / 100), state = gross * (emp.stateTaxRate / 100)
      const county = gross * (emp.countyTaxRate / 100), fica = gross * (emp.ficaTaxRate / 100)
      const totalEmpTaxes = fed + state + county + fica

      const liveMs = clockedIn[emp.id] ? (Date.now() - clockedIn[emp.id].time) : 0

      summary[emp.id] = {
        hours: (regH + otH).toFixed(2), regH: regH.toFixed(2), otH: otH.toFixed(2), liveH: (liveMs / 3600000).toFixed(2),
        gross, employerTax, totalCost: gross + employerTax, 
        empTaxes: totalEmpTaxes, netPay: gross - totalEmpTaxes,
        fed, state, county, fica
      }
    })
    return summary
  }
  const timesheets = getTimesheetSummary()

  async function handleExportCSV() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data || data.length === 0) return alert("No history found.")
    let csv = "Employee,Week Start,Total Hours,Pay Rate,Gross Pay,Fed Tax,State Tax,County Tax,FICA,Employer Tax,Total Cost,Net Pay\n"
    data.forEach(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      csv += `"${e?.name || r.employee_id}",${r.week_start_date},${r.total_hours},${r.pay_rate_at_time},${r.gross_pay},${r.fed_tax},${r.state_tax},${r.county_tax},${r.fica_tax},${r.employer_tax},${r.total_cost},${r.net_pay}\n`
    })
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a"); link.href = url; link.download = `Payroll_${new Date().toISOString().split('T')[0]}.csv`; link.click()
  }

  async function handleExportXLSX() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data || data.length === 0) return alert("No history found.")
    const sheet = data.map(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      return { Employee: e?.name || r.employee_id, Date: r.week_start_date, Hours: r.total_hours, Rate: r.pay_rate_at_time, Gross: r.gross_pay, Fed: r.fed_tax, State: r.state_tax, County: r.county_tax, FICA: r.fica_tax, "Er Tax": r.employer_tax, "Total Cost": r.total_cost, Net: r.net_pay }
    })
    const ws = XLSX.utils.json_to_sheet(sheet)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Payroll")
    XLSX.writeFile(wb, `Payroll_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  async function handleFinalizePayroll() {
    if (Object.values(clockedIn).some(s => s.status === "IN" || s.status === "BREAK")) return alert("Employees must clock out first.")
    const records = employees.map(emp => {
      const s = timesheets[emp.id]
      return {
        employee_id: emp.id, week_start_date: activeWeekKey, total_hours: parseFloat(s.hours),
        pay_rate_at_time: emp.baseRate, gross_pay: s.gross, fed_tax: s.fed, state_tax: s.state,
        county_tax: s.county, fica_tax: s.fica, employer_tax: s.employerTax, total_cost: s.totalCost, net_pay: s.netPay
      }
    }).filter(r => r.total_hours > 0)
    if(records.length === 0) return alert("No hours logged to save.")
    await supabase.from("payroll_history").insert(records)
    alert("Payroll finalized.")
  }

  async function handleSaveEmployee(empData) {
    const payload = {
      name: empData.name, role: empData.role, base_rate: empData.baseRate, bonus_rate: empData.bonusRate, 
      pin: empData.pin, auth_method: empData.authMethod, avatar: empData.avatar,
      fed_tax_rate: empData.fedTaxRate, state_tax_rate: empData.stateTaxRate, 
      county_tax_rate: empData.countyTaxRate, fica_tax_rate: empData.ficaTaxRate
    }
    if (empData.id && String(empData.id).length < 10) {
      await supabase.from("employees").update(payload).eq("id", empData.id)
      setEmployees(p => p.map(e => e.id === empData.id ? { ...empData } : e))
    } else {
      const { data } = await supabase.from("employees").insert([payload]).select()
      if (data) setEmployees(p => [...p, { ...empData, id: data[0].id }])
    }
  }

  async function doClockAction(emp, type) {
    const { error: authError } = await supabase.auth.signInWithPassword({ email: `emp_${emp.id}@pinelake.internal`, password: emp.pin })
    if (authError) return alert("Security Error: Identity could not be verified.")
    await supabase.from("clock_logs").insert([{ employee_id: emp.id, action: type }])
    await supabase.auth.signOut()
    window.location.reload()
  }

  const activeCount = Object.values(clockedIn).filter(s => s.status === "IN").length

  // --- KIOSK HOME SCREEN ---
  if(screen === "kiosk") return (
    <div className="bg-[#0d1117] font-sans min-h-screen text-[#e8e8e8] antialiased selection:bg-[#7ec8e3] selection:text-[#0d1117]">
      <div className="max-w-[700px] mx-auto pb-10 px-4 sm:px-6">
        <div className="pt-8 pb-6 mb-4 border-b border-[#1a2535] flex flex-col items-center text-center">
          <div className="text-[10px] text-[#7ec8e3] uppercase tracking-[0.2em] font-bold mb-2">Pine Lake Recreation</div>
          <h1 className="text-[24px] font-bold text-[#e8f4f8] leading-tight mb-2">Time Clock Kiosk</h1>
          <div className="font-mono text-[16px] font-semibold text-[#a0b8d0]">{now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit", second:"2-digit"})}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button onClick={()=>setScreen("portal-select")} className="bg-[#131b27] border border-[#1e2a38] hover:border-[#7ec8e3] p-4 rounded-xl flex flex-col items-center justify-center transition-all group">
            <span className="text-[20px] mb-2 group-hover:scale-110 transition-transform">👤</span>
            <span className="text-[12px] font-bold text-[#e8f4f8]">Employee Portal</span>
            <span className="text-[9px] text-[#4a6a8a] mt-1">View schedules & pay</span>
          </button>
          <button onClick={()=>setScreen("manager-login")} className="bg-[#131b27] border border-[#1e2a38] hover:border-[#fca311] p-4 rounded-xl flex flex-col items-center justify-center transition-all group">
            <span className="text-[20px] mb-2 group-hover:scale-110 transition-transform">🔐</span>
            <span className="text-[12px] font-bold text-[#e8f4f8]">Manager Access</span>
            <span className="text-[9px] text-[#4a6a8a] mt-1">System administration</span>
          </button>
        </div>
        <div className="text-[10px] text-[#4a6a8a] uppercase tracking-widest mb-3 font-bold border-b border-[#1a2535] pb-2">
          Staff Roster <span className="text-[#06d6a0] ml-1">({activeCount} on clock)</span>
        </div>
        <div className="flex flex-col gap-3">
          {employees.map(emp => {
            const s = clockedIn[emp.id], isW = s?.status === "IN", isB = s?.status === "BREAK", isO = !s
            const elapsed = getElapsed(emp.id)
            return (
              <div key={emp.id} className={`flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl border transition-all ${isW ? "bg-[#0d1f14] border-[#06d6a0] shadow-[0_0_15px_rgba(6,214,160,0.1)]" : isB ? "bg-[#1f1a0d] border-[#fca311]" : "bg-[#131b27] border-[#1e2a38]"}`}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] text-[12px]" style={{backgroundColor: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.avatar}</div>
                <div className="flex-1 text-center sm:text-left">
                  <div className="text-[13px] font-bold text-[#e8f4f8]">{emp.name}</div>
                  <div className="text-[10px] mt-0.5" style={{color: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.role}</div>
                </div>
                <div className="flex flex-wrap justify-center sm:justify-end items-center gap-2">
                  {isO && <button onClick={()=>{setAuthEmp(emp);setPendingAction("IN");setScreen("emp-auth")}} className="bg-[#06d6a0] text-[#0d1117] text-[10px] font-bold py-2 px-5 rounded-lg">CLOCK IN</button>}
                  {isB && <><div className="text-[#fca311] font-mono font-bold text-[13px] mr-2">{fmtElapsed(elapsed)}</div><button onClick={()=>{setAuthEmp(emp);setPendingAction("BREAK_END");setScreen("emp-auth")}} className="bg-[#fca311] text-[#0d1117] py-2 px-4 rounded-lg text-[10px] font-bold uppercase">End Break</button></>}
                  {isW && <><div className="text-[#06d6a0] font-mono font-bold text-[13px] mr-2">{fmtElapsed(elapsed)}</div><button onClick={()=>{setAuthEmp(emp);setPendingAction("BREAK_START");setScreen("emp-auth")}} className="border border-[#1e2a38] text-[#e8e8e8] py-2 px-4 rounded-lg text-[10px] font-mono">BREAK</button><button onClick={()=>{setAuthEmp(emp);setPendingAction("OUT");setScreen("emp-auth")}} className="bg-[#ef476f] text-[#0d1117] py-2 px-4 rounded-lg text-[10px] font-bold uppercase">Clock Out</button></>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  if(screen === "emp-auth") return (
    <div className="bg-[#0d1117] font-sans min-h-screen flex items-center justify-center p-6 text-[#e8e8e8]">
      <div className="w-full max-w-[300px]">
        <div className="text-center mb-6"><div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] text-[16px]" style={{backgroundColor: ROLE_COLORS[authEmp.role]||"#7ec8e3"}}>{authEmp.avatar}</div><div className="text-[16px] font-bold">{authEmp.name}</div></div>
        {authEmp.authMethod === "face" ? <FaceScanUI onSuccess={()=>doClockAction(authEmp, pendingAction)} onCancel={()=>setScreen("kiosk")}/> : 
          <PinPad correctPin={authEmp.pin} label={pendingAction} onSuccess={()=>doClockAction(authEmp, pendingAction)} onCancel={()=>setScreen("kiosk")}/>}
      </div>
    </div>
  )

  if(screen === "portal-select") return (
    <div className="bg-[#0d1117] font-sans min-h-screen text-[#e8e8e8] max-w-[600px] mx-auto pb-10 px-4 sm:px-6">
      <div className="pt-6 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center"><h1 className="text-[18px] font-bold">Select Profile</h1><button onClick={()=>setScreen("kiosk")} className="text-[10px] text-[#4a6a8a] font-mono uppercase tracking-widest hover:text-[#e8e8e8] transition-colors">Back</button></div>
      <div className="flex flex-col gap-3">
        {employees.map(emp=>(
          <button key={emp.id} onClick={()=>{setAuthEmp(emp); setScreen("portal-auth")}} className="flex items-center gap-4 p-3.5 rounded-xl border border-[#1e2a38] bg-[#131b27] hover:border-[#2a4060] text-left w-full transition-all">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] text-[12px]" style={{backgroundColor: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.avatar}</div>
            <div><div className="font-bold text-[13px] text-[#e8f4f8]">{emp.name}</div><div className="text-[10px] mt-0.5" style={{color: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.role}</div></div>
          </button>
        ))}
      </div>
    </div>
  )

  if(screen === "portal-auth") return (
    <div className="bg-[#0d1117] font-sans min-h-screen flex items-center justify-center p-6 text-[#e8e8e8]">
      <div className="w-full max-w-[300px]">
        <div className="text-center mb-6"><div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] text-[16px]" style={{backgroundColor: ROLE_COLORS[authEmp.role]||"#7ec8e3"}}>{authEmp.avatar}</div><div className="text-[16px] font-bold">{authEmp.name}</div></div>
        <PinPad correctPin={authEmp.pin} label="PIN FOR PORTAL" onSuccess={()=>{setPortalEmp(authEmp); setScreen("portal-dashboard")}} onCancel={()=>setScreen("portal-select")}/>
      </div>
    </div>
  )

  if(screen === "portal-dashboard" && portalEmp) {
    const s = timesheets[portalEmp.id] || { hours: "0.00", gross: 0, netPay: 0 }
    const wk = schedules[activeWeekKey] || {}
    return (
      <div className="bg-[#0d1117] font-sans min-h-screen text-[#e8e8e8] max-w-[600px] mx-auto pb-10 px-4 sm:px-6">
        <div className="pt-6 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center">
          <div><div className="text-[9px] text-[#4a6a8a] font-mono uppercase tracking-widest mb-1">Employee Portal</div><h1 className="text-[18px] font-bold">Hello, {portalEmp.name.split(" ")[0]}</h1></div>
          <button onClick={()=>{setPortalEmp(null); setScreen("kiosk")}} className="bg-[#1e2a38] text-[#e8e8e8] py-1.5 px-4 rounded-md text-[10px] hover:bg-[#ef476f] transition-colors">Log Out</button>
        </div>
        <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 mb-5 shadow-lg">
          <div className="flex justify-between items-end mb-4 border-b border-[#1a2535] pb-4">
            <div><div className="text-[26px] font-mono font-bold text-[#06d6a0] leading-none">{s.hours}</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 uppercase tracking-widest">Total Hours</div></div>
            <div className="text-right"><div className="text-[18px] font-mono font-bold text-[#e8f4f8] leading-none">{fmtMoney(s.gross)}</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 uppercase tracking-widest">Est. Gross</div></div>
          </div>
          <div className="flex justify-between items-center bg-[#0d1117] p-3 rounded-lg border border-[#1e2a38]">
             <div className="text-[9px] text-[#fca311] uppercase font-mono tracking-widest">Net Take-Home</div>
             <div className="text-[16px] font-mono font-bold text-[#fca311]">{fmtMoney(s.netPay)}</div>
          </div>
        </div>
        <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 shadow-lg">
          <div className="text-[12px] font-bold mb-4 border-b border-[#1a2535] pb-2 text-[#e8f4f8]">My Schedule</div>
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => (
            <div key={day} className="flex justify-between py-2 border-b border-[#1a2535] last:border-0">
              <div className="text-[11px] text-[#a0b0c0]">{day}</div>
              <div className="text-[10px] text-right font-mono whitespace-pre-wrap">{formatShiftDisplay(wk[day]?.[portalEmp.id] || "OFF")}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if(screen === "manager-login") return (
    <div className="bg-[#0d1117] font-sans min-h-screen flex items-center justify-center p-6 text-[#e8e8e8]">
      <div className="w-full max-w-[300px]"><ManagerLogin onSuccess={sess=>{setMgrSession(sess); setScreen("manager-dashboard")}} onCancel={()=>setScreen("kiosk")}/></div>
    </div>
  )

  // --- MANAGER DASHBOARD (5-TAB SYSTEM) ---
  if(screen === "manager-dashboard") {
    const totalFacility = employees.reduce((a, e) => {
      const s = timesheets[e.id] || { gross: 0, employerTax: 0, totalCost: 0, hours: 0 }
      return { gross: a.gross + s.gross, taxes: a.taxes + s.employerTax, total: a.total + s.totalCost, hours: a.hours + parseFloat(s.hours) }
    }, { gross: 0, taxes: 0, total: 0, hours: 0 })

    return (
      <div className="bg-[#0d1117] font-sans min-h-screen text-[#e8e8e8] max-w-[1000px] mx-auto pb-20 px-4 sm:px-6">
        {showAddEmp && <EmployeeForm title="Add Employee" onSave={handleSaveEmployee} onClose={()=>setShowAddEmp(false)}/>}
        {editEmp && <EmployeeForm title="Edit Details" initial={editEmp} onSave={handleSaveEmployee} onClose={()=>setEditEmp(null)}/>}
        
        {/* Header & Navigation */}
        <div className="pt-6 border-b border-[#1a2535] mb-6">
          <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4">
            <div><div className="text-[9px] text-[#4a6a8a] tracking-[0.2em] uppercase font-mono mb-1">Pine Lake Recreation</div><h1 className="text-[20px] font-bold m-0 text-[#e8f4f8]">Manager Dashboard</h1></div>
            <div className="flex items-center gap-4">
              <div className="text-right"><div className="font-mono text-[16px] font-bold text-[#7ec8e3]">{now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div></div>
              <button onClick={()=>setScreen("kiosk")} className="bg-[#1e2a38] text-[10px] px-3 py-1.5 rounded border border-[#2a4060] hover:bg-[#2a4060] transition-colors w-fit">Kiosk</button>
            </div>
          </div>
          <div className="flex overflow-x-auto gap-1 sm:gap-4 pb-1">
            {[["clock","LIVE CLOCK"],["labor","LABOR COST"],["schedule","SCHEDULER"],["payroll","PAY CALC"],["employees","EMPLOYEES"]].map(([id, label]) => (
              <button key={id} style={managerTab === id ? tabBtnActiveStyle : tabBtnStyle} onClick={()=>setMgrTab(id)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 1. LIVE CLOCK */}
        {managerTab === "clock" && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[22px] font-bold font-mono text-[#06d6a0]">{activeCount}</div><div className="text-[9px] text-[#4a6a8a] uppercase tracking-[0.1em] mt-1.5">Clocked In</div></div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[22px] font-bold font-mono text-[#7ec8e3]">{employees.length}</div><div className="text-[9px] text-[#4a6a8a] uppercase tracking-[0.1em] mt-1.5">Total Staff</div></div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[22px] font-bold font-mono text-[#fca311]">{Object.keys(clockedIn).reduce((acc, id) => acc + getElapsed(parseInt(id))/3600, 0).toFixed(1)}h</div><div className="text-[9px] text-[#4a6a8a] uppercase tracking-[0.1em] mt-1.5">Hours On-Clock</div></div>
            </div>
            <div className="flex flex-col gap-3">
              {employees.map(emp => {
                const isIN = !!clockedIn[emp.id], elapsed = getElapsed(emp.id), col = ROLE_COLORS[emp.role]||"#7ec8e3"
                return (
                  <div key={emp.id} className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl border ${isIN ? "bg-[#0d1f14] border-[#06d6a0]" : "bg-[#131b27] border-[#1e2a38]"}`}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] text-[12px]" style={{backgroundColor: col}}>{emp.avatar}</div>
                    <div className="flex-1"><div className="font-bold text-[13px]">{emp.name}</div><div className="text-[10px] mt-1" style={{color: col}}>{emp.role}</div></div>
                    {isIN ? <div className="text-right w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-0 border-[#1e2a38] pt-2 sm:pt-0"><div className="font-mono text-[18px] font-bold text-[#06d6a0]">{fmtElapsed(elapsed)}</div><div className="text-[9px] text-[#4a8a5a] font-mono mt-1">Live Shift</div></div> : <div className="text-[10px] text-[#3a4a5a] font-mono">— not clocked in</div>}
                  </div>
                )
              })}
            </div>
            {clockLog.length > 0 && (
              <div className="mt-2"><div className="text-[9px] text-[#3a4a5a] tracking-[0.15em] uppercase font-mono mb-2">Activity Log</div>
                {clockLog.slice(0,6).map((l, i) => (
                  <div key={i} className="flex justify-between items-center bg-[#0d1117] p-2 rounded-lg mb-1.5 font-mono text-[10px]">
                    <div className="flex gap-3"><span className={l.action==="IN" ? "text-[#06d6a0] font-bold" : "text-[#ef476f] font-bold"}>{l.action}</span><span className="text-[#a0b8d0]">{l.emp}</span></div>
                    <span className="text-[#4a6a8a]">{l.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. LABOR COST */}
        {managerTab === "labor" && (
          <div className="flex flex-col gap-6">
            <div>
              <div className="flex justify-between items-center mb-4"><div className="text-[10px] text-[#4a6a8a] tracking-[0.15em] uppercase font-mono">Period To Date Summary</div>
              <div className="flex gap-2"><button onClick={handleExportCSV} className="border border-[#2a4060] text-[#7ec8e3] px-3 py-1.5 rounded text-[10px] font-bold">CSV</button><button onClick={handleExportXLSX} className="border border-[#2a4060] text-[#7ec8e3] px-3 py-1.5 rounded text-[10px] font-bold">EXCEL</button><button onClick={handleFinalizePayroll} className="bg-[#06d6a0] text-[#0d1117] px-4 py-1.5 rounded font-bold text-[10px] uppercase">Finalize</button></div></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[18px] font-mono text-[#7ec8e3] font-bold">{totalFacility.hours.toFixed(1)}h</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 font-mono tracking-widest uppercase">Total Hours</div></div>
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[18px] font-mono text-[#06d6a0] font-bold">{fmtMoney(totalFacility.gross)}</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 font-mono tracking-widest uppercase">Gross Wages</div></div>
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 text-center"><div className="text-[18px] font-mono text-[#fca311] font-bold">{fmtMoney(totalFacility.taxes)}</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 font-mono tracking-widest uppercase">Employer Taxes</div></div>
                <div className="bg-[#131b27] border border-[#ef476f] rounded-xl p-4 text-center"><div className="text-[18px] font-mono text-[#ef476f] font-bold">{fmtMoney(totalFacility.total)}</div><div className="text-[9px] text-[#4a6a8a] mt-1.5 font-mono tracking-widest uppercase">Total Labor Cost</div></div>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#4a6a8a] tracking-[0.15em] uppercase font-mono mb-3">Per Employee Breakdown</div>
              <div className="flex flex-col gap-3">
                {employees.map(emp => {
                  const s = timesheets[emp.id] || { regH:"0", otH:"0", liveH:"0", gross:0, employerTax:0, totalCost:0 }
                  const maxC = Math.max(...employees.map(e => timesheets[e.id]?.totalCost || 0), 1)
                  const col = ROLE_COLORS[emp.role]||"#7ec8e3"
                  const isIN = !!clockedIn[emp.id]
                  return (
                    <div key={emp.id} className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#111] text-[10px]" style={{backgroundColor: col}}>{emp.avatar}</div>
                          <div><div className="font-bold text-[12px] flex items-center gap-2">{emp.name} {isIN && <span className="bg-[#0a2a1a] text-[#06d6a0] text-[8px] px-1.5 py-0.5 rounded-full font-mono">⏱ LIVE</span>}</div><div className="text-[10px]" style={{color:col}}>{emp.role} • ${emp.baseRate}/hr</div></div>
                        </div>
                        <div className="text-right"><div className="font-mono text-[16px] font-bold text-[#ef476f]">{fmtMoney(s.totalCost)}</div><div className="text-[9px] text-[#4a6a8a]">total cost</div></div>
                      </div>
                      <div className="h-1.5 bg-[#0d1117] rounded-full overflow-hidden mb-3"><div className="h-full rounded-full bg-gradient-to-r from-[#06d6a0] to-[#f4a261]" style={{width: `${(s.totalCost/maxC)*100}%`}}></div></div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#7ec8e3]">{s.regH}h</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">Reg Hrs</div></div>
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#fca311]">{s.otH}h</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">OT Hrs</div></div>
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#06d6a0]">{s.liveH}h</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">Live</div></div>
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#e8f4f8]">{fmtMoney(s.gross)}</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">Gross</div></div>
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#fca311]">{fmtMoney(s.employerTax)}</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">Er. Tax</div></div>
                        <div className="bg-[#0d1117] rounded-lg p-2 text-center"><div className="font-mono text-[10px] font-bold text-[#ef476f]">{fmtMoney(s.totalCost)}</div><div className="text-[8px] text-[#3a4a5a] uppercase mt-1">Total</div></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* 3. SCHEDULER */}
        {managerTab === "schedule" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} className="bg-[#131b27] border border-[#2a4060] text-[#7ec8e3] rounded-lg p-1.5 px-3 text-[12px] font-mono" style={{colorScheme:"dark"}}/>
              <div className="flex gap-2">
                <button onClick={()=>{
                  const prev = new Date(targetDate); prev.setDate(prev.getDate()-7)
                  const pk = getSundayKey(prev.toISOString().split('T')[0])
                  if(schedules[pk]) setSchedules(p=>({...p, [activeWeekKey]: JSON.parse(JSON.stringify(p[pk]))}))
                }} className="border border-[#2a4060] text-[#7ec8e3] px-3 py-1.5 rounded-lg text-[11px] hover:bg-[#1a2535]">Copy Prev Week</button>
                <button onClick={async ()=>{
                  const recs = []
                  const grid = schedules[activeWeekKey] || {}
                  for(const d of ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]){
                    employees.forEach(e => recs.push({ week_key: activeWeekKey, day: d, employee_id: e.id, shift_time: grid[d]?.[e.id] || "" }))
                  }
                  await supabase.from("schedules").upsert(recs, { onConflict: "week_key,day,employee_id" })
                  alert("Schedule Saved")
                }} className="bg-[#06d6a0] text-[#0d1117] px-4 py-1.5 rounded-lg font-bold text-[11px] hover:opacity-90">Save Schedule</button>
              </div>
            </div>
            <div className="overflow-x-auto bg-[#131b27] border border-[#1e2a38] rounded-xl p-3">
              <table className="w-full text-left min-w-[800px] border-separate border-spacing-y-1.5">
                <thead><tr><th className="p-2 text-[10px] text-[#4a6a8a] font-mono uppercase tracking-widest">Staff Member</th>{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><th key={d} className="p-2 text-[10px] text-[#4a6a8a] text-center font-mono tracking-widest">{d}</th>)}</tr></thead>
                <tbody>{employees.map(e => (
                  <tr key={e.id} className="bg-[#0d1117]">
                    <td className="p-2.5 font-bold text-[12px] border-l-[3px] rounded-l-md" style={{borderLeftColor: ROLE_COLORS[e.role]}}>{e.name}</td>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(d => {
                      const val = schedules[activeWeekKey]?.[d]?.[e.id] || "OFF", isO = val === "OFF"
                      return (
                        <td key={d} className="p-1">
                          <button onClick={()=>{
                            const next = { ...schedules }; if(!next[activeWeekKey]) next[activeWeekKey] = {}
                            if(!next[activeWeekKey][d]) next[activeWeekKey][d] = {}
                            next[activeWeekKey][d][e.id] = isO ? "09:00-17:00" : "OFF"
                            setSchedules(next)
                          }} className="text-[9px] text-[#7ec8e3] block mx-auto mb-1 font-mono uppercase">{isO ? "Set" : "Off"}</button>
                          {isO ? <div className="bg-[#1a140a] border border-[#fca31133] text-[#fca311] text-center text-[10px] font-bold py-2.5 rounded-md font-mono">OFF</div> :
                            <div className="flex flex-col bg-[#131b27] border border-[#2a4060] p-1 rounded-md gap-0.5">
                              <input type="time" value={parseTo24h(val.split('-')[0])} onChange={ev=>{
                                const next = { ...schedules }; next[activeWeekKey][d][e.id] = `${ev.target.value}-${val.split('-')[1]}`
                                setSchedules(next)
                              }} className="bg-transparent text-[10px] text-center font-mono focus:outline-none" style={{colorScheme:"dark"}}/>
                              <input type="time" value={parseTo24h(val.split('-')[1])} onChange={ev=>{
                                const next = { ...schedules }; next[activeWeekKey][d][e.id] = `${val.split('-')[0]}-${ev.target.value}`
                                setSchedules(next)
                              }} className="bg-transparent text-[10px] text-center font-mono focus:outline-none" style={{colorScheme:"dark"}}/>
                            </div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. PAY CALC */}
        {managerTab === "payroll" && payEmp && (
          <div className="flex flex-col md:flex-row gap-5">
            <div className="w-full md:w-1/3 flex flex-col gap-2">
              <div className="text-[9px] text-[#4a6a8a] tracking-[0.15em] uppercase font-mono mb-1.5">Employee</div>
              {employees.map(emp => (
                <button key={emp.id} onClick={()=>setPayEmp(emp)} className={`flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all ${payEmp.id === emp.id ? "bg-[#0e2030] border-[#7ec8e3]" : "bg-[#131b27] border-[#1e2a38] hover:border-[#2a4060]"}`}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[#111] text-[9px]" style={{backgroundColor: ROLE_COLORS[emp.role]}}>{emp.avatar}</div>
                  <div className="flex-1"><div className={`text-[12px] font-bold ${payEmp.id===emp.id?"text-[#7ec8e3]":"text-[#a0b8d0]"}`}>{emp.name}</div><div className="text-[9px] text-[#4a6a8a]">${emp.baseRate}/hr</div></div>
                  {clockedIn[emp.id] && <div className="text-[10px] text-[#06d6a0]">●</div>}
                </button>
              ))}
            </div>
            <div className="w-full md:w-2/3 flex flex-col gap-4">
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4">
                <div className="flex gap-5 flex-wrap">
                  <div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em]">Base</div><div className="text-[14px] font-bold font-mono text-[#7ec8e3] mt-1">${payEmp.baseRate.toFixed(2)}/hr</div></div>
                  <div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em]">OT (1.5x)</div><div className="text-[14px] font-bold font-mono text-[#fca311] mt-1">${(payEmp.baseRate*1.5).toFixed(2)}/hr</div></div>
                  <div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em]">Bonus</div><div className="text-[14px] font-bold font-mono text-[#06d6a0] mt-1">{payEmp.bonusRate>0?`$${payEmp.bonusRate.toFixed(2)}/hr`:"—"}</div></div>
                </div>
                {clockedIn[payEmp.id] && <div className="mt-3 bg-[#0a1a0a] border border-[#1a4a2a] rounded-lg p-2 font-mono text-[11px] text-[#06d6a0]">⏱ Live Shift Active: {fmtElapsed(getElapsed(payEmp.id))}</div>}
              </div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4">
                <div className="text-[10px] text-[#4a6a8a] mb-3 font-mono tracking-[0.1em] uppercase">Pay Statement · {payEmp.name}</div>
                {(() => {
                  const s = timesheets[payEmp.id] || { hours:"0.00", regH:"0.00", otH:"0.00", gross:0, fed:0, state:0, fica:0, county:0, netPay:0 }
                  return (
                    <>
                      <div className="flex gap-5 mb-4">
                        <div><div className="text-[18px] font-bold font-mono text-[#7ec8e3] leading-none">{s.hours}</div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em] mt-1.5">Total</div></div>
                        <div><div className="text-[18px] font-bold font-mono text-[#06d6a0] leading-none">{s.regH}</div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em] mt-1.5">Regular</div></div>
                        <div><div className="text-[18px] font-bold font-mono text-[#fca311] leading-none">{s.otH}</div><div className="text-[8px] text-[#4a6a8a] uppercase font-mono tracking-[0.1em] mt-1.5">Overtime</div></div>
                      </div>
                      
                      <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">Regular Pay</span><span className="text-[11px] font-mono text-[#4a6a8a]">{s.regH}h × ${payEmp.baseRate.toFixed(2)}</span><span className="text-[13px] font-mono font-bold text-[#e8f4f8]">${(s.regH*payEmp.baseRate).toFixed(2)}</span></div>
                      {parseFloat(s.otH) > 0 && <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">Overtime Pay</span><span className="text-[11px] font-mono text-[#4a6a8a]">{s.otH}h × ${(payEmp.baseRate*1.5).toFixed(2)}</span><span className="text-[13px] font-mono font-bold text-[#fca311]">${(s.otH*payEmp.baseRate*1.5).toFixed(2)}</span></div>}
                      <div className="flex justify-between items-center py-2.5 border-t border-[#2a3a4a] mt-1"><span className="text-[13px] font-bold text-[#e8f4f8]">Gross Pay</span><span className="text-[15px] font-mono font-bold text-[#7ec8e3]">{fmtMoney(s.gross)}</span></div>
                      
                      <div className="h-3"></div>
                      <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">Federal Tax</span><span className="text-[11px] font-mono text-[#4a6a8a]">{payEmp.fedTaxRate}%</span><span className="text-[12px] font-mono text-[#ef476f]">-{fmtMoney(s.fed)}</span></div>
                      <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">State Tax</span><span className="text-[11px] font-mono text-[#4a6a8a]">{payEmp.stateTaxRate}%</span><span className="text-[12px] font-mono text-[#ef476f]">-{fmtMoney(s.state)}</span></div>
                      <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">FICA</span><span className="text-[11px] font-mono text-[#4a6a8a]">{payEmp.ficaTaxRate}%</span><span className="text-[12px] font-mono text-[#ef476f]">-{fmtMoney(s.fica)}</span></div>
                      {payEmp.countyTaxRate > 0 && <div className="flex justify-between items-center py-1.5 border-b border-[#1a2535]"><span className="text-[12px] text-[#8090a0]">County Tax</span><span className="text-[11px] font-mono text-[#4a6a8a]">{payEmp.countyTaxRate}%</span><span className="text-[12px] font-mono text-[#ef476f]">-{fmtMoney(s.county)}</span></div>}
                      
                      <div className="mt-3 p-3 rounded-lg bg-gradient-to-br from-[#0a2a1a] to-[#0d2030] border border-[#1a4a2a] flex justify-between items-center">
                        <div className="text-[11px] text-[#4a6a8a] uppercase tracking-[0.15em] font-mono">Net Pay</div>
                        <div className="text-[20px] font-mono font-bold text-[#06d6a0]">{fmtMoney(s.netPay)}</div>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* 5. EMPLOYEES */}
        {managerTab === "employees" && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center mb-2"><h2 className="text-[13px] font-bold text-[#e8f4f8]">Employee Roster</h2><button onClick={()=>setShowAddEmp(true)} className="bg-[#7ec8e3] text-[#0d1117] px-4 py-2 rounded-lg font-bold text-[11px]">+ Add Employee</button></div>
            {employees.map(e => (
              <div key={e.id} className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#111] text-[12px]" style={{backgroundColor: ROLE_COLORS[e.role]}}>{e.avatar}</div>
                  <div><div className="text-[13px] font-bold flex items-center gap-2">{e.name} {clockedIn[e.id] && <span className="text-[9px] bg-[#0a2a1a] text-[#06d6a0] px-1.5 py-0.5 rounded font-mono">⏱ LIVE</span>}</div><div className="text-[10px] text-[#4a6a8a] mt-0.5">{e.role} • {e.authMethod==="face"?"👤 Face ID":"🔢 PIN"}</div></div>
                </div>
                <div className="flex items-center gap-3 bg-[#0a1520] border border-[#1a3050] rounded-lg p-2 w-full sm:w-auto">
                  <div className="text-center"><div className="text-[12px] font-bold font-mono text-[#7ec8e3]">${e.baseRate.toFixed(2)}</div><div className="text-[8px] text-[#4a6a8a] uppercase tracking-widest mt-1">Base</div></div>
                  <div className="w-px h-5 bg-[#1a3050]"></div>
                  <div className="text-center"><div className="text-[12px] font-bold font-mono text-[#fca311]">${(e.baseRate*1.5).toFixed(2)}</div><div className="text-[8px] text-[#4a6a8a] uppercase tracking-widest mt-1">OT</div></div>
                  <div className="w-px h-5 bg-[#1a3050]"></div>
                  <div className="text-center"><div className="text-[12px] font-bold font-mono text-[#06d6a0]">{e.bonusRate>0?`$${e.bonusRate.toFixed(2)}`:"—"}</div><div className="text-[8px] text-[#4a6a8a] uppercase tracking-widest mt-1">Bonus</div></div>
                </div>
                <button onClick={()=>setEditEmp(e)} className="bg-[#1a2a3a] border border-[#2a4060] text-[#7ec8e3] w-full sm:w-8 h-8 rounded-lg flex items-center justify-center text-[14px] transition-colors hover:bg-[#2a4060]">✏</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  return null
}