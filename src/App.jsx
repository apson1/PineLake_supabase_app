import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"
import * as XLSX from "xlsx"

function getSundayKey(dateStr) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

function parseTo24h(timeStr) {
  if (!timeStr) return "09:00"
  timeStr = timeStr.trim()
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM|am|pm)?/)
  if (match) {
    let [_, h, m, ampm] = match
    h = parseInt(h, 10)
    if (ampm && ampm.toUpperCase() === "PM" && h < 12) h += 12
    if (ampm && ampm.toUpperCase() === "AM" && h === 12) h = 0
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
  const [employees,setEmployees] = useState([])
  const [schedules,setSchedules] = useState({})
  const [clockedIn,setClockedIn] = useState({})
  const [clockLog,setClockLog] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const [screen,setScreen] = useState("kiosk")
  const [authEmp,setAuthEmp] = useState(null)
  const [portalEmp,setPortalEmp] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [managerSession,setMgrSession] = useState(null)
  const [managerTab,setMgrTab] = useState("employees")
  const [showAddEmp,setShowAddEmp] = useState(false)
  const [editEmp,setEditEmp] = useState(null)
  const [now,setNow] = useState(new Date())

  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0])
  const activeWeekKey = getSundayKey(targetDate)

  useEffect(()=>{
    const iv=setInterval(()=>setNow(new Date()),1000)
    return ()=>clearInterval(iv)
  },[])

  useEffect(()=>{
    async function loadData() {
      const { data: empData } = await supabase.from("employees").select("*").order("id")
      if (empData) {
        const mappedEmps = empData.map(e => ({
          id: e.id, name: e.name, role: e.role, baseRate: e.base_rate,
          bonusRate: e.bonus_rate, pin: e.pin, authMethod: e.auth_method, avatar: e.avatar,
          fedTaxRate: e.fed_tax_rate ?? 12, stateTaxRate: e.state_tax_rate ?? 5.5,
          countyTaxRate: e.county_tax_rate ?? 0, ficaTaxRate: e.fica_tax_rate ?? 7.65
        }))
        setEmployees(mappedEmps)
      }

      const { data: logs } = await supabase.from("clock_logs").select("*").order("created_at", { ascending: false })
      if (logs && empData) {
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
            const emp = empData.find(e => e.id === log.employee_id)
            if (emp) {
              rLogs.push({ empId: emp.id, emp: emp.name, action: log.action, time: new Date(log.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) })
            }
          }
        })
        setClockedIn(cState)
        setClockLog(rLogs)
      }

      const { data: schedData } = await supabase.from("schedules").select("*")
      if (schedData && empData) {
        const mappedSchedules = {}
        schedData.forEach(row => {
          if (!mappedSchedules[row.week_key]) mappedSchedules[row.week_key] = blankWeek(empData)
          if (!mappedSchedules[row.week_key][row.day]) mappedSchedules[row.week_key][row.day] = {}
          mappedSchedules[row.week_key][row.day][row.employee_id] = row.shift_time
        })
        setSchedules(prev => ({ ...prev, ...mappedSchedules }))
      }
    }
    loadData()
  },[])

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

  function checkCanClockIn(emp) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const todayName = days[new Date().getDay()]
    const wk = getSundayKey(new Date().toISOString().split('T')[0])
    
    const currentSchedule = schedules[wk]
    const shiftString = currentSchedule?.[todayName]?.[emp.id]
    
    if (!shiftString || shiftString.trim() === "" || shiftString.toUpperCase() === "OFF") {
      alert(`Schedule Block: ${emp.name} is not scheduled to work today.`)
      return false
    }

    const startStr = shiftString.split("-")[0].trim()
    const match = startStr.match(/(\d+):(\d+)\s*(AM|PM|am|pm)?/)
    
    if (match) {
      let [_, h, m, ampm] = match
      h = parseInt(h, 10)
      m = parseInt(m, 10)
      if (ampm && ampm.toUpperCase() === "PM" && h < 12) h += 12
      if (ampm && ampm.toUpperCase() === "AM" && h === 12) h = 0
      
      const shiftStart = new Date()
      shiftStart.setHours(h, m, 0, 0)
      const diffMinutes = (shiftStart.getTime() - Date.now()) / 60000
      
      if (diffMinutes > 15) {
        alert(`Schedule Block: Too early. Your shift starts at ${formatShiftDisplay(shiftString).split('\n')[0].trim()}. You can clock in 15 minutes before.`)
        return false
      }
    }
    return true
  }

  function getTimesheetSummary() {
    const summary = {}
    employees.forEach(emp => {
      const empLogs = allLogs.filter(l => l.employee_id === emp.id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
      let weekdayMs = 0
      let weekendMs = 0
      let lastIn = null
      
      empLogs.forEach(log => {
        if ((log.action === "IN" || log.action === "BREAK_END") && !lastIn) {
          lastIn = new Date(log.created_at).getTime()
        } 
        else if ((log.action === "OUT" || log.action === "BREAK_START") && lastIn) {
          const shiftStart = new Date(lastIn)
          const dayOfWeek = shiftStart.getDay()
          const duration = new Date(log.created_at).getTime() - lastIn
          
          if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
          else weekdayMs += duration
          
          lastIn = null
        }
      })

      if (lastIn) {
        const shiftStart = new Date(lastIn)
        const dayOfWeek = shiftStart.getDay()
        const duration = Date.now() - lastIn
        if (dayOfWeek === 0 || dayOfWeek === 6) weekendMs += duration
        else weekdayMs += duration
      }

      const weekdayHours = weekdayMs / 3600000
      const weekendHours = weekendMs / 3600000

      // Weekday logic: over 40 is OT
      const weekdayRegH = Math.min(weekdayHours, 40)
      const weekdayOtH = Math.max(0, weekdayHours - 40)
      
      // Weekend logic: all hours are instantly OT
      const totalRegH = weekdayRegH
      const totalOtH = weekendHours + weekdayOtH
      const totalH = totalRegH + totalOtH
      
      const baseRate = parseFloat(emp.baseRate) || 0
      const bonusRate = parseFloat(emp.bonusRate) || 0
      const gross = (totalRegH * baseRate) + (totalOtH * baseRate * 1.5) + (totalH * bonusRate)
      
      const employerTax = gross * 0.1095 
      const totalCost = gross + employerTax

      const fedTax = gross * (parseFloat(emp.fedTaxRate) / 100)
      const stateTax = gross * (parseFloat(emp.stateTaxRate) / 100)
      const countyTax = gross * (parseFloat(emp.countyTaxRate) / 100)
      const ficaTax = gross * (parseFloat(emp.ficaTaxRate) / 100)
      const netPay = gross - fedTax - stateTax - countyTax - ficaTax

      summary[emp.id] = {
        hours: totalH.toFixed(2),
        regH: totalRegH.toFixed(2),
        otH: totalOtH.toFixed(2),
        gross: gross,
        employerTax: employerTax,
        totalCost: totalCost,
        fedTax: fedTax,
        stateTax: stateTax,
        countyTax: countyTax,
        ficaTax: ficaTax,
        netPay: netPay
      }
    })
    return summary
  }
  const timesheets = getTimesheetSummary()

  async function handleFinalizePayroll() {
    const activeWorkers = Object.values(clockedIn).filter(state => state.status === "IN" || state.status === "BREAK").length
    if (activeWorkers > 0) return alert(`Stop: There are ${activeWorkers} employee(s) still on the clock. Everyone must clock out before you can finalize payroll.`)

    const today = new Date().toISOString().split("T")[0]
    const records = employees.map(emp => {
      const stats = timesheets[emp.id] || { hours: "0.00", gross: 0, fedTax: 0, stateTax: 0, countyTax: 0, ficaTax: 0, employerTax: 0, totalCost: 0, netPay: 0 }
      return {
        employee_id: emp.id, week_start_date: today, total_hours: parseFloat(stats.hours),
        pay_rate_at_time: emp.baseRate, gross_pay: stats.gross,
        fed_tax: stats.fedTax, state_tax: stats.stateTax, county_tax: stats.countyTax,
        fica_tax: stats.ficaTax, employer_tax: stats.employerTax, total_cost: stats.totalCost, net_pay: stats.netPay
      }
    }).filter(r => r.total_hours > 0)

    if (records.length === 0) return alert("No hours logged to save")
    const { error } = await supabase.from("payroll_history").insert(records)
    if (!error) alert("Payroll successfully locked into history")
    else alert("Error saving payroll: " + error.message)
  }

  async function handleExportCSV() {
    const { data, error } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (error || !data || data.length === 0) return alert("No payroll history found to export.")

    let csvContent = "Employee Name,Week Start Date,Total Hours,Pay Rate,Gross Pay,Fed Tax,State Tax,County Tax,FICA,Employer Tax,Total Cost,Net Pay\n"
    data.forEach(row => {
      const emp = employees.find(e => e.id === row.employee_id)
      const empName = emp ? emp.name : `Unknown (${row.employee_id})`
      csvContent += `"${empName}",${row.week_start_date},${row.total_hours},${row.pay_rate_at_time},${row.gross_pay},${row.fed_tax},${row.state_tax},${row.county_tax},${row.fica_tax},${row.employer_tax},${row.total_cost},${row.net_pay}\n`
    })

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", `payroll_export_${new Date().toISOString().split("T")[0]}.csv`)
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
  }

  async function handleExportXLSX() {
    const { data, error } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (error || !data || data.length === 0) return alert("No payroll history found to export.")

    const formattedData = data.map(row => {
      const emp = employees.find(e => e.id === row.employee_id)
      return { 
        "Employee Name": emp ? emp.name : `Unknown (${row.employee_id})`, "Week Start Date": row.week_start_date, "Total Hours": row.total_hours, 
        "Pay Rate": row.pay_rate_at_time, "Gross Pay": row.gross_pay, "Fed Tax": row.fed_tax, "State Tax": row.state_tax, "County Tax": row.county_tax,
        "FICA Tax": row.fica_tax, "Employer Tax": row.employer_tax, "Total Cost": row.total_cost, "Net Pay": row.net_pay
      }
    })
    const worksheet = XLSX.utils.json_to_sheet(formattedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payroll History")
    XLSX.writeFile(workbook, `payroll_export_${new Date().toISOString().split("T")[0]}.xlsx`)
  }

  async function handleSaveEmployee(empData) {
    const dbPayload = {
      name: empData.name, role: empData.role, base_rate: empData.baseRate, bonus_rate: empData.bonusRate, 
      pin: empData.pin, auth_method: empData.authMethod, avatar: empData.avatar,
      fed_tax_rate: empData.fedTaxRate, state_tax_rate: empData.stateTaxRate, 
      county_tax_rate: empData.countyTaxRate, fica_tax_rate: empData.ficaTaxRate
    }
    
    if (empData.id && typeof empData.id === "number" && String(empData.id).length < 10) {
      const { error } = await supabase.from("employees").update(dbPayload).eq("id", empData.id)
      if (!error) setEmployees(p => p.map(e => e.id === empData.id ? empData : e))
    } else {
      const { data, error } = await supabase.from("employees").insert([dbPayload]).select()
      if (!error && data) {
        const saved = data[0]
        setEmployees(p => [...p, { id: saved.id, name: saved.name, role: saved.role, baseRate: saved.base_rate, bonusRate: saved.bonus_rate, pin: saved.pin, authMethod: saved.auth_method, avatar: saved.avatar, fedTaxRate: saved.fed_tax_rate, stateTaxRate: saved.state_tax_rate, countyTaxRate: saved.county_tax_rate, ficaTaxRate: saved.fica_tax_rate }])
      }
    }
  }

  function updateScheduleCell(day, empId, value) {
    setSchedules(prev => {
      const next = { ...prev }; if (!next[activeWeekKey]) next[activeWeekKey] = {}; if (!next[activeWeekKey][day]) next[activeWeekKey][day] = {}; next[activeWeekKey][day][empId] = value; return next
    })
  }

  function handleCopyPreviousWeek() {
    const prevWkDate = new Date(targetDate)
    prevWkDate.setDate(prevWkDate.getDate() - 7)
    const prevWkKey = getSundayKey(prevWkDate.toISOString().split('T')[0])
    
    if (!schedules[prevWkKey]) return alert("No schedule found for the previous week to copy.")
    
    setSchedules(prev => {
      const next = { ...prev }
      next[activeWeekKey] = JSON.parse(JSON.stringify(prev[prevWkKey]))
      return next
    })
  }

  async function handleSaveScheduleGrid() {
    const currentGrid = schedules[activeWeekKey] || {}
    const recordsToUpsert = []
    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      for (const emp of employees) {
        const shift = currentGrid[day]?.[emp.id] || ""
        recordsToUpsert.push({ week_key: activeWeekKey, day: day, employee_id: emp.id, shift_time: shift })
      }
    }
    const { error } = await supabase.from("schedules").upsert(recordsToUpsert, { onConflict: "week_key,day,employee_id" })
    if (!error) alert("Schedule saved successfully")
    else alert("Error saving schedule data: " + error.message)
  }

  async function doClockAction(emp, actionType) {
    const { error } = await supabase.from("clock_logs").insert([{ employee_id: emp.id, action: actionType }])
    if (error) return
  }

  function handleEmpAuth(emp) {
    doClockAction(emp, pendingAction)
    setTimeout(() => { setScreen("kiosk"); setPendingAction(null) }, 800)
  }

  const activeWorkers = Object.values(clockedIn).filter(state => state.status === "IN").length

  // ==========================================
  // KIOSK
  // ==========================================
  if(screen==="kiosk") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
      <div className="px-5 sm:px-7 pt-5 border-b border-[#1a2535] mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4 gap-3 sm:gap-0">
          <div>
            <div className="text-[10px] text-[#4a6a8a] tracking-[0.2em] uppercase font-mono mb-1">Pine Lake Recreation</div>
            <h1 className="text-[22px] font-bold text-[#e8f4f8] m-0 leading-none">Time Clock Kiosk</h1>
          </div>
          <div className="text-left sm:text-right">
            <div className="font-mono text-[26px] font-semibold text-[#7ec8e3] leading-none">{now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
            <div className="text-[11px] text-[#4a6a8a] mt-1">{now.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"})}</div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-5 pb-3.5 sm:items-center">
          <div className="text-[11px] text-[#4a6a8a] font-mono">
            <span className="text-[#06d6a0] font-bold">{activeWorkers}</span> active on clock | {employees.length} total staff
          </div>
          <div className="sm:ml-auto flex gap-2">
            <button onClick={()=>setScreen("portal-select")} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#1e2a38] transition-colors">Employee Portal</button>
            <button onClick={()=>setScreen("manager-login")} className="bg-transparent border border-[#1e2a38] text-[#4a6a8a] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#1e2a38] transition-colors">Manager</button>
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-7">
        <div className="text-[12px] text-[#3a5a7a] text-center mb-5 font-mono tracking-[0.08em]">CHOOSE AN ACTION TO AUTHENTICATE</div>
        <div className="flex flex-col gap-3">
          {employees.map(emp=>{
            const rec = clockedIn[emp.id]; const isWorking = rec?.status === "IN"; const isOnBreak = rec?.status === "BREAK"; const isOut = !rec; const elapsed = getElapsed(emp.id); const col = ROLE_COLORS[emp.role]||"#7ec8e3"
            return (
              <div key={emp.id} className={`flex flex-col sm:flex-row items-start sm:items-center gap-3.5 px-4.5 py-3.5 rounded-xl text-left w-full transition-all duration-300 border-[1.5px] ${isWorking ? "bg-[#0d1f14] border-[#06d6a0]" : isOnBreak ? "bg-[#1f1a0d] border-[#fca311]" : "bg-[#131b27] border-[#1e2a38]"}`}>
                <div className="flex items-center gap-3.5 w-full sm:w-auto">
                  <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-[#e8f4f8]">{emp.name}</div>
                    <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role}</div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto justify-start sm:justify-end items-center mt-2 sm:mt-0 border-t border-[#1e2a38] sm:border-t-0 pt-2 sm:pt-0">
                  {isOut && <button onClick={()=>{ if(checkCanClockIn(emp)){ setAuthEmp(emp); setPendingAction("IN"); setScreen("emp-auth") } }} className="bg-[#06d6a0] text-[#0d1117] text-[11px] font-bold py-1.5 px-3.5 rounded-md font-mono hover:opacity-90">CLOCK IN</button>}
                  {isOnBreak && <><div className="text-[#fca311] font-mono text-[14px] font-bold mr-2">{fmtElapsed(elapsed)}</div><button onClick={()=>{setAuthEmp(emp); setPendingAction("BREAK_END"); setScreen("emp-auth")}} className="bg-[#fca311] text-[#0d1117] text-[11px] font-bold py-1.5 px-3.5 rounded-md font-mono hover:opacity-90">END BREAK</button></>}
                  {isWorking && <><div className="text-[#06d6a0] font-mono text-[15px] font-bold mr-2 tracking-wide">{fmtElapsed(elapsed)}</div><button onClick={()=>{setAuthEmp(emp); setPendingAction("BREAK_START"); setScreen("emp-auth")}} className="bg-transparent border border-[#1e2a38] text-[#e8e8e8] text-[11px] font-bold py-1.5 px-3 rounded-md font-mono hover:bg-[#1e2a38]">BREAK</button><button onClick={()=>{setAuthEmp(emp); setPendingAction("OUT"); setScreen("emp-auth")}} className="bg-[#ef476f] text-[#0d1117] text-[11px] font-bold py-1.5 px-3 rounded-md font-mono hover:opacity-90">CLOCK OUT</button></>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ==========================================
  // EMP AUTH & PORTAL SELECTION
  // ==========================================
  if(screen==="emp-auth"&&authEmp){
    const col=ROLE_COLORS[authEmp.role]||"#7ec8e3"
    const actionLabel = pendingAction ? pendingAction.replace("_", " ") : "AUTHENTICATE"
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-5"><div className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-[20px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{authEmp.avatar}</div><div className="text-[18px] font-bold text-[#e8f4f8]">{authEmp.name}</div></div>
          <div className="text-center mb-4"><div className="text-[11px] text-[#7ec8e3] font-mono tracking-widest uppercase">CONFIRM {actionLabel}</div></div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>:<PinPad correctPin={authEmp.pin} label={`PIN TO ${actionLabel}`} onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>}
        </div>
      </div>
    )
  }

  if(screen==="portal-select") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
      <div className="px-5 sm:px-7 pt-5 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center"><h1 className="text-[22px] font-bold text-[#e8f4f8] m-0">Select Profile</h1><button onClick={()=>setScreen("kiosk")} className="text-[#4a6a8a] font-mono text-[10px] hover:text-[#e8e8e8]">Back</button></div>
      <div className="px-5 sm:px-7 flex flex-col gap-2.5">
        {employees.map(emp=>(
          <button key={emp.id} onClick={()=>{setAuthEmp(emp); setScreen("portal-auth")}} className="flex items-center gap-3.5 px-4.5 py-3.5 rounded-xl cursor-pointer text-left w-full bg-[#131b27] border-[1.5px] border-[#1e2a38] hover:border-[#2a4060]">
            <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold text-[#111] font-mono" style={{backgroundColor: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.avatar}</div>
            <div className="flex-1"><div className="text-[15px] font-bold text-[#e8f4f8]">{emp.name}</div><div className="text-[11px] mt-0.5" style={{color: ROLE_COLORS[emp.role]||"#7ec8e3"}}>{emp.role}</div></div>
          </button>
        ))}
      </div>
    </div>
  )

  if(screen==="portal-auth"&&authEmp){
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-7"><div className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-[20px] font-bold text-[#111] font-mono" style={{backgroundColor: ROLE_COLORS[authEmp.role]||"#7ec8e3"}}>{authEmp.avatar}</div><div className="text-[18px] font-bold text-[#e8f4f8]">{authEmp.name}</div></div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>{setPortalEmp(authEmp); setScreen("portal-dashboard")}} onCancel={()=>setScreen("portal-select")}/>:<PinPad correctPin={authEmp.pin} label="PIN FOR PORTAL" onSuccess={()=>{setPortalEmp(authEmp); setScreen("portal-dashboard")}} onCancel={()=>setScreen("portal-select")}/>}
        </div>
      </div>
    )
  }

  // ==========================================
  // EMPLOYEE PORTAL DASHBOARD
  // ==========================================
  if(screen==="portal-dashboard"&&portalEmp) {
    const stats = timesheets[portalEmp.id] || { hours: "0.00", gross: 0, netPay: 0 }
    const currentWk = schedules[getSundayKey(new Date().toISOString().split('T')[0])] || {}
    
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
        <div className="px-5 sm:px-7 pt-5 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center">
           <div><div className="text-[10px] text-[#4a6a8a] tracking-[0.2em] uppercase font-mono mb-1">Employee Portal</div><h1 className="text-[22px] font-bold text-[#e8f4f8] m-0">Welcome, {portalEmp.name.split(" ")[0]}</h1></div>
           <button onClick={()=>{setPortalEmp(null); setScreen("kiosk")}} className="bg-[#1e2a38] border border-[#2a4060] text-[#e8e8e8] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px]">Log Out</button>
        </div>
        
        <div className="px-5 sm:px-7 flex flex-col gap-6">
          <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 shadow-lg">
            <div className="text-[14px] font-semibold text-[#e8f4f8] mb-4">Current Week Summary</div>
            <div className="flex justify-between items-end mb-4 border-b border-[#1a2535] pb-4">
              <div><div className="text-[32px] font-mono font-bold text-[#06d6a0] leading-none">{stats.hours}</div><div className="text-[11px] text-[#4a6a8a] mt-1.5 font-mono uppercase">Total Hours</div></div>
              <div className="text-right"><div className="text-[22px] font-mono font-bold text-[#e8f4f8] leading-none">{fmtMoney(stats.gross)}</div><div className="text-[11px] text-[#4a6a8a] mt-1.5 font-mono uppercase">Est. Gross Pay</div></div>
            </div>
            <div className="flex flex-col sm:flex-row justify-between items-center bg-[#0d1117] p-3 rounded-lg border border-[#1e2a38]">
               <div className="text-[11px] text-[#fca311] font-mono uppercase mb-2 sm:mb-0">Est. Net Take-Home</div>
               <div className="text-[20px] font-mono font-bold text-[#fca311] leading-none">{fmtMoney(stats.netPay)}</div>
            </div>
          </div>

          <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 shadow-lg">
            <div className="text-[14px] font-semibold text-[#e8f4f8] mb-4">My Schedule</div>
            <div className="flex flex-col gap-3">
              <div className="text-[11px] text-[#7ec8e3] font-mono tracking-widest uppercase border-b border-[#1a2535] pb-2">This Week</div>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => {
                const shiftStr = currentWk[day]?.[portalEmp.id] || "OFF"
                const displayShift = formatShiftDisplay(shiftStr)
                return (
                  <div key={day} className={`flex justify-between items-center py-1.5 border-b border-[#1a2535] last:border-0`}>
                    <div className={`text-[13px] ${new Date().getDay() === i ? "text-[#7ec8e3] font-bold" : "text-[#a0b0c0]"}`}>{day}</div>
                    <div className={`text-[11px] text-right font-mono whitespace-pre-wrap ${displayShift === "OFF" ? "text-[#4a6a8a]" : "text-[#e8f4f8]"}`}>{displayShift}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ==========================================
  // MANAGER LOGIN
  // ==========================================
  if(screen==="manager-login") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        <ManagerLogin onSuccess={sess=>{setMgrSession(sess); setScreen("manager-dashboard"); setMgrTab("timesheets")}} onCancel={()=>setScreen("kiosk")}/>
      </div>
    </div>
  )

  // ==========================================
  // MANAGER DASHBOARD
  // ==========================================
  if(screen==="manager-dashboard"&&managerSession) {
    const totalFacilityStats = employees.reduce((a, emp) => {
      const stats = timesheets[emp.id] || { gross: 0, employerTax: 0, totalCost: 0, hours: 0 }
      return { gross: a.gross + parseFloat(stats.gross || 0), employerTax: a.employerTax + parseFloat(stats.employerTax || 0), totalCost: a.totalCost + parseFloat(stats.totalCost || 0), hours: a.hours + parseFloat(stats.hours || 0) }
    }, { gross: 0, employerTax: 0, totalCost: 0, hours: 0 })

    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[1020px] mx-auto pb-15">
        {showAddEmp&&<EmployeeForm title="Add Employee" saveLabel="Add Employee" onSave={handleSaveEmployee} onClose={()=>setShowAddEmp(false)}/>}
        {editEmp&&<EmployeeForm title="Edit Employee" saveLabel="Save Changes" initial={editEmp} onSave={handleSaveEmployee} onClose={()=>setEditEmp(null)}/>}
        
        <div className="px-5 sm:px-7 pt-5 border-b border-[#1a2535]">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4 gap-3 sm:gap-0">
            <div><h1 className="m-0 text-[22px] font-bold text-[#e8f4f8]">Manager Dashboard</h1></div>
            <div className="flex gap-2">
              <button onClick={()=>setScreen("kiosk")} className="bg-transparent border border-[#1e2a38] text-[#4a6a8a] py-1.5 px-3 rounded-md cursor-pointer font-mono text-[10px]">Kiosk</button>
            </div>
          </div>
          <div className="flex overflow-x-auto gap-2 sm:gap-0">
            <button style={managerTab==="employees"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("employees")}>Employees</button>
            <button style={managerTab==="schedules"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("schedules")}>Schedules</button>
            <button style={managerTab==="timesheets"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("timesheets")}>Payroll</button>
          </div>
        </div>
        
        <div className="px-5 sm:px-7 py-6">
          
          {/* SCHEDULES TAB */}
          {managerTab==="schedules"&&(
            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 sm:gap-0 mb-4.5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="text-[14px] font-semibold text-[#e8f4f8]">Schedule Builder</div>
                  <div className="flex gap-3 items-center sm:ml-4 sm:border-l border-[#1e2a38] sm:pl-4">
                    <label className="text-[11px] text-[#4a6a8a] font-mono">Select Week:</label>
                    <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="bg-[#131b27] border border-[#2a4060] text-[#e8f4f8] rounded py-1 px-2 text-[12px] font-mono focus:outline-none" style={{colorScheme: "dark"}} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCopyPreviousWeek} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-2.5 px-4 rounded-lg cursor-pointer font-serif text-[12px] font-bold hover:bg-[#1a2a3a] w-full sm:w-auto">Copy Prev Week</button>
                  <button onClick={handleSaveScheduleGrid} className="bg-[#06d6a0] border-none text-[#0d1117] py-2.5 px-5 rounded-lg cursor-pointer font-serif text-[12px] font-bold hover:opacity-90 w-full sm:w-auto">Save Schedule</button>
                </div>
              </div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr>
                      <th className="p-2.5 border-b border-[#1a2535] text-[#4a6a8a] text-[11px] font-mono tracking-wider">EMPLOYEE</th>
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(d => <th key={d} className="p-2.5 border-b border-[#1a2535] text-[#4a6a8a] text-[11px] font-mono tracking-wider uppercase text-center">{d.substring(0,3)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id} className="border-b border-[#1a2535] last:border-0 hover:bg-[#1a2535]">
                        <td className="p-2.5 text-[13px] font-bold text-[#e8f4f8] whitespace-nowrap">{emp.name}</td>
                        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => {
                          const shiftStr = schedules[activeWeekKey]?.[day]?.[emp.id] || "OFF"
                          const isOff = shiftStr.toUpperCase() === "OFF" || shiftStr === ""
                          const parts = shiftStr.split("-")
                          const start24 = isOff ? "09:00" : parseTo24h(parts[0])
                          const end24 = isOff ? "17:00" : parseTo24h(parts[1])

                          return (
                          <td key={day} className="p-1.5 align-top w-[90px]">
                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between items-center px-1">
                                <span className="text-[9px] text-[#4a6a8a] uppercase font-mono hidden sm:inline">Status</span>
                                <button onClick={() => updateScheduleCell(day, emp.id, isOff ? "09:00-17:00" : "OFF")} className="text-[9px] text-[#7ec8e3] font-mono mx-auto sm:mx-0 bg-transparent border-none p-0">{isOff ? "Set Time" : "Set OFF"}</button>
                              </div>
                              {isOff ? (
                                <div className="bg-[#1f1a0d] border border-[#fca311] text-[#fca311] text-center text-[12px] font-bold py-3 sm:py-2 rounded font-mono">OFF</div>
                              ) : (
                                <div className="flex flex-col items-center gap-1 bg-[#0d1117] border border-[#2a4060] rounded p-1">
                                  <input type="time" value={start24} onChange={(e) => updateScheduleCell(day, emp.id, `${e.target.value}-${end24}`)} className="bg-transparent border-none w-full text-[11px] text-[#e8f4f8] font-mono p-0 text-center" style={{colorScheme: "dark"}} />
                                  <span className="text-[#4a6a8a] text-[10px] leading-none">-</span>
                                  <input type="time" value={end24} onChange={(e) => updateScheduleCell(day, emp.id, `${start24}-${e.target.value}`)} className="bg-transparent border-none w-full text-[11px] text-[#e8f4f8] font-mono p-0 text-center" style={{colorScheme: "dark"}} />
                                </div>
                              )}
                            </div>
                          </td>
                        )})}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TIMESHEETS TAB */}
          {managerTab==="timesheets"&&(
            <div>
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 sm:gap-0 mb-4.5">
                <div><div className="text-[14px] font-semibold text-[#e8f4f8]">Facility Labor Summary</div></div>
                <div className="flex gap-2.5">
                  <button onClick={handleExportCSV} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-2 px-3 sm:px-4 rounded-lg text-[11px] sm:text-[13px] font-bold">CSV</button>
                  <button onClick={handleExportXLSX} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-2 px-3 sm:px-4 rounded-lg text-[11px] sm:text-[13px] font-bold">Excel</button>
                  <button onClick={handleFinalizePayroll} className="bg-[#06d6a0] text-[#0d1117] py-2 px-3 sm:px-5 rounded-lg text-[11px] sm:text-[13px] font-bold">Finalize</button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3 sm:p-4 text-center"><div className="text-[18px] sm:text-[20px] font-mono font-bold text-[#7ec8e3]">{totalFacilityStats.hours.toFixed(2)}h</div><div className="text-[9px] sm:text-[10px] text-[#4a6a8a] uppercase mt-2">Total Hours</div></div>
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3 sm:p-4 text-center"><div className="text-[18px] sm:text-[20px] font-mono font-bold text-[#06d6a0]">{fmtMoney(totalFacilityStats.gross)}</div><div className="text-[9px] sm:text-[10px] text-[#4a6a8a] uppercase mt-2">Gross Wages</div></div>
                <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3 sm:p-4 text-center"><div className="text-[18px] sm:text-[20px] font-mono font-bold text-[#fca311]">{fmtMoney(totalFacilityStats.employerTax)}</div><div className="text-[9px] sm:text-[10px] text-[#4a6a8a] uppercase mt-2">Er. Taxes</div></div>
                <div className="bg-[#131b27] border border-[#ef476f44] rounded-xl p-3 sm:p-4 text-center"><div className="text-[18px] sm:text-[20px] font-mono font-bold text-[#ef476f]">{fmtMoney(totalFacilityStats.totalCost)}</div><div className="text-[9px] sm:text-[10px] text-[#4a6a8a] uppercase mt-2">Total Cost</div></div>
              </div>

              <div className="text-[14px] font-semibold text-[#e8f4f8] mb-4">Detailed Employee Breakdown</div>
              <div className="flex flex-col gap-3">
                {employees.map(emp=>{
                  const stats = timesheets[emp.id] || { hours: "0.00", gross: 0, employerTax: 0, totalCost: 0, netPay: 0, fedTax: 0, stateTax: 0, countyTax: 0, ficaTax: 0 }
                  const col = ROLE_COLORS[emp.role]||"#555"
                  const hoursNum = parseFloat(stats.hours)
                  const isOvertime = parseFloat(stats.otH) > 0
                  const isApproachingOT = hoursNum >= 36 && hoursNum < 40

                  return (
                    <div key={emp.id} className={`bg-[#131b27] border ${isOvertime ? 'border-[#ef476f]' : isApproachingOT ? 'border-[#fca311]' : 'border-[#1e2a38]'} rounded-xl p-4 flex flex-col gap-4`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
                        <div className="flex items-center gap-3.5">
                          <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                          <div>
                            <div className="text-[13px] font-bold text-[#e8f4f8] flex flex-wrap items-center gap-2">
                              {emp.name}
                              {isOvertime && <span className="bg-[#ef476f] text-[#0d1117] text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Overtime ({stats.otH}h)</span>}
                              {isApproachingOT && <span className="bg-[#fca311] text-[#0d1117] text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Near OT</span>}
                            </div>
                            <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role} • ${Number(emp.baseRate).toFixed(2)}/hr</div>
                          </div>
                        </div>
                        <div className="flex justify-between sm:block border-t border-[#1e2a38] sm:border-0 pt-2 sm:pt-0 sm:text-right">
                          <div className={`text-[16px] sm:text-[18px] font-mono font-bold ${isOvertime ? 'text-[#ef476f]' : isApproachingOT ? 'text-[#fca311]' : 'text-[#06d6a0]'}`}>{stats.hours} hrs</div>
                          <div className="text-[11px] text-[#4a6a8a] mt-0.5">Net Pay: <span className="text-[#fca311] font-bold">{fmtMoney(stats.netPay)}</span></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#0d1117] p-2 rounded-lg border border-[#2a4060]">
                        <div className="text-center p-1 sm:p-0"><div className="text-[11px] font-mono font-bold text-[#e8f4f8]">{fmtMoney(stats.gross)}</div><div className="text-[9px] text-[#4a6a8a] uppercase mt-1">Gross Pay</div></div>
                        <div className="text-center sm:border-l border-[#1e2a38] p-1 sm:p-0"><div className="text-[11px] font-mono font-bold text-[#ef476f]">- {fmtMoney(stats.fedTax + stats.stateTax + stats.countyTax + stats.ficaTax)}</div><div className="text-[9px] text-[#4a6a8a] uppercase mt-1">Emp. Taxes</div></div>
                        <div className="text-center border-t sm:border-t-0 sm:border-l border-[#1e2a38] p-1 sm:p-0"><div className="text-[11px] font-mono font-bold text-[#fca311]">+ {fmtMoney(stats.employerTax)}</div><div className="text-[9px] text-[#4a6a8a] uppercase mt-1">Er. Liability</div></div>
                        <div className="text-center border-t sm:border-t-0 sm:border-l border-[#1e2a38] p-1 sm:p-0"><div className="text-[11px] font-mono font-bold text-[#ef476f]">{fmtMoney(stats.totalCost)}</div><div className="text-[9px] text-[#4a6a8a] uppercase mt-1">Total Cost</div></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* EMPLOYEES TAB */}
          {managerTab==="employees"&&(
            <div>
              <div className="flex justify-between items-center mb-4.5">
                <div><div className="text-[14px] font-semibold text-[#e8f4f8]">Employee Roster</div></div>
                <button onClick={()=>setShowAddEmp(true)} className="bg-[#7ec8e3] border-none text-[#0d1117] py-2 px-3 sm:px-5 rounded-lg text-[11px] sm:text-[13px] font-bold">Add Employee</button>
              </div>
              <div className="flex flex-col gap-2.5">
                {employees.map(emp=>{
                  return (
                    <div key={emp.id} className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3.5">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold text-[#111] font-mono" style={{backgroundColor: ROLE_COLORS[emp.role]||"#555"}}>{emp.avatar}</div>
                        <div className="flex-1">
                          <div className="text-[13px] font-bold text-[#e8f4f8]">{emp.name}</div>
                          <div className="text-[11px] mt-0.5" style={{color: ROLE_COLORS[emp.role]||"#555"}}>{emp.role}</div>
                        </div>
                        <button onClick={()=>setEditEmp(emp)} className="bg-[#1a2a3a] border border-[#2a4060] text-[#7ec8e3] w-9 h-9 rounded-lg text-[15px] flex items-center justify-center">✏</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
  return null
}