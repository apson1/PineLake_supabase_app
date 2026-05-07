import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, HIST_HOURS, multiply, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle, statBoxStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"
import * as XLSX from "xlsx"

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

  const [weekIdx,setWeekIdx] = useState(0)

  useEffect(()=>{
    const iv=setInterval(()=>setNow(new Date()),1000)
    return ()=>clearInterval(iv)
  },[])

  useEffect(()=>{
    async function loadData() {
      const { data: empData } = await supabase.from("employees").select("id, name, role, base_rate, bonus_rate, pin, auth_method, avatar").order("id")
      if (empData) {
        const mappedEmps = empData.map(e => ({
          id: e.id, name: e.name, role: e.role, baseRate: e.base_rate,
          bonusRate: e.bonus_rate, pin: e.pin, authMethod: e.auth_method, avatar: e.avatar
        }))
        setEmployees(mappedEmps)
      }

      const { data: logs } = await supabase.from("clock_logs").select("id, employee_id, action, created_at").order("created_at", { ascending: false })
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

      const { data: schedData } = await supabase.from("schedules").select("id, week_key, day, employee_id, shift_time")
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

    const channel = supabase
      .channel("live-clock")
      .on(
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
          setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: log.action, time: timeString }, ...prev.slice(0, 49)])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [employees])

  function getElapsed(empId){
    const rec = clockedIn[empId]
    if(!rec) return 0
    return Math.floor((Date.now()-rec.time)/1000)
  }

  function checkCanClockIn(emp) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const todayName = days[new Date().getDay()]
    const wk = weekKey(0) 
    
    const currentSchedule = schedules[wk]
    const shiftString = currentSchedule?.[todayName]?.[emp.id]
    
    if (!shiftString || shiftString.trim() === "" || shiftString.toLowerCase() === "off") {
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
        alert(`Schedule Block: Too early. Your shift starts at ${startStr}. You can clock in 15 minutes before.`)
        return false
      }
    }
    return true
  }

  function getTimesheetSummary() {
    const summary = {}
    employees.forEach(emp => {
      const empLogs = allLogs.filter(l => l.employee_id === emp.id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
      let msTotal = 0
      let lastIn = null
      
      empLogs.forEach(log => {
        if ((log.action === "IN" || log.action === "BREAK_END") && !lastIn) {
          lastIn = new Date(log.created_at).getTime()
        } 
        else if ((log.action === "OUT" || log.action === "BREAK_START") && lastIn) {
          msTotal += (new Date(log.created_at).getTime() - lastIn)
          lastIn = null
        }
      })

      if (lastIn) {
        msTotal += (Date.now() - lastIn)
      }

      summary[emp.id] = {
        hours: (msTotal / 3600000).toFixed(2),
        pay: ((msTotal / 3600000) * (emp.baseRate || 0)).toFixed(2)
      }
    })
    return summary
  }
  const timesheets = getTimesheetSummary()

  async function handleFinalizePayroll() {
    const today = new Date().toISOString().split("T")[0]
    const records = employees.map(emp => {
      const stats = timesheets[emp.id] || { hours: "0.00", pay: "0.00" }
      return {
        employee_id: emp.id,
        week_start_date: today,
        total_hours: parseFloat(stats.hours),
        pay_rate_at_time: emp.baseRate,
        gross_pay: parseFloat(stats.pay)
      }
    })

    const activeRecords = records.filter(r => r.total_hours > 0)

    if (activeRecords.length === 0) {
      alert("No hours logged to save")
      return
    }

    const { error } = await supabase.from("payroll_history").insert(activeRecords)
    if (!error) {
      alert("Payroll successfully locked into history")
    } else {
      alert("Error saving payroll: " + error.message)
    }
  }

  async function handleExportCSV() {
    const { data, error } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (error || !data || data.length === 0) return alert("No payroll history found to export.")

    let csvContent = "Employee Name,Week Start Date,Total Hours,Pay Rate,Gross Pay\n"
    data.forEach(row => {
      const emp = employees.find(e => e.id === row.employee_id)
      const empName = emp ? emp.name : `Unknown (${row.employee_id})`
      csvContent += `"${empName}",${row.week_start_date},${row.total_hours},${row.pay_rate_at_time},${row.gross_pay}\n`
    })

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.setAttribute("href", URL.createObjectURL(blob))
    link.setAttribute("download", `payroll_export_${new Date().toISOString().split("T")[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function handleExportXLSX() {
    const { data, error } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (error || !data || data.length === 0) return alert("No payroll history found to export.")

    const formattedData = data.map(row => {
      const emp = employees.find(e => e.id === row.employee_id)
      return { "Employee Name": emp ? emp.name : `Unknown (${row.employee_id})`, "Week Start Date": row.week_start_date, "Total Hours": row.total_hours, "Pay Rate": row.pay_rate_at_time, "Gross Pay": row.gross_pay }
    })
    const worksheet = XLSX.utils.json_to_sheet(formattedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payroll History")
    XLSX.writeFile(workbook, `payroll_export_${new Date().toISOString().split("T")[0]}.xlsx`)
  }

  async function handleSaveEmployee(empData) {
    if (empData.id && typeof empData.id === "number" && String(empData.id).length < 10) {
      const { error } = await supabase.from("employees").update({
        name: empData.name, role: empData.role, base_rate: empData.baseRate, bonus_rate: empData.bonusRate, pin: empData.pin, auth_method: empData.authMethod, avatar: empData.avatar
      }).eq("id", empData.id)
      if (!error) setEmployees(p => p.map(e => e.id === empData.id ? empData : e))
    } else {
      const { data, error } = await supabase.from("employees").insert([{
        name: empData.name, role: empData.role, base_rate: empData.baseRate, bonus_rate: empData.bonusRate, pin: empData.pin, auth_method: empData.authMethod, avatar: empData.avatar
      }]).select()
      if (!error && data) {
        const saved = data[0]
        setEmployees(p => [...p, { id: saved.id, name: saved.name, role: saved.role, baseRate: saved.base_rate, bonusRate: saved.bonus_rate, pin: saved.pin, authMethod: saved.auth_method, avatar: saved.avatar }])
      }
    }
  }

  function updateScheduleCell(day, empId, value) {
    const wk = weekKey(weekIdx)
    setSchedules(prev => {
      const next = { ...prev }
      if (!next[wk]) next[wk] = {}
      if (!next[wk][day]) next[wk][day] = {}
      next[wk][day][empId] = value
      return next
    })
  }

  async function handleSaveScheduleGrid() {
    const wk = weekKey(weekIdx)
    const currentGrid = schedules[wk] || {}
    const recordsToUpsert = []
    
    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      for (const emp of employees) {
        const shift = currentGrid[day]?.[emp.id] || ""
        recordsToUpsert.push({
          week_key: wk,
          day: day,
          employee_id: emp.id,
          shift_time: shift
        })
      }
    }

    const { error } = await supabase.from("schedules").upsert(recordsToUpsert, { onConflict: "week_key,day,employee_id" })
    if (!error) {
      alert("Schedule saved successfully")
    } else {
      alert("Error saving schedule data: " + error.message)
    }
  }

  async function doClockAction(emp, actionType) {
    const { error } = await supabase.from("clock_logs").insert([{ employee_id: emp.id, action: actionType }])
    if (error) return
    
    const t = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
    const newLog = { employee_id: emp.id, action: actionType, created_at: new Date().toISOString() }
    
    setAllLogs(prev => [newLog, ...prev])
    setClockedIn(prev => {
      const n = { ...prev }
      if (actionType === "OUT") delete n[emp.id]
      else if (actionType === "BREAK_START") n[emp.id] = { status: "BREAK", time: Date.now() }
      else n[emp.id] = { status: "IN", time: Date.now() }
      return n
    })
    setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: actionType, time: t }, ...prev.slice(0, 49)])
  }

  function handleEmpAuth(emp) {
    doClockAction(emp, pendingAction)
    setTimeout(()=>{
      setScreen("kiosk")
      setPendingAction(null)
    }, 800)
  }

  const activeWorkers = Object.values(clockedIn).filter(state => state.status === "IN").length

  if(screen==="kiosk") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
      <div className="px-7 pt-5 border-b border-[#1a2535] mb-6">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[10px] text-[#4a6a8a] tracking-[0.2em] uppercase font-mono mb-1">Pine Lake Recreation</div>
            <h1 className="text-[22px] font-bold text-[#e8f4f8] m-0 leading-none">Time Clock Kiosk</h1>
          </div>
          <div className="text-right">
            <div className="font-mono text-[26px] font-semibold text-[#7ec8e3] leading-none">
              {now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            </div>
            <div className="text-[11px] text-[#4a6a8a] mt-1">
              {now.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"})}
            </div>
          </div>
        </div>
        <div className="flex gap-5 pb-3.5 items-center">
          <div className="text-[11px] text-[#4a6a8a] font-mono">
            <span className="text-[#06d6a0] font-bold">{activeWorkers}</span> active on clock | {employees.length} total staff
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={()=>setScreen("portal-select")} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#1e2a38] transition-colors">Employee Portal</button>
            <button onClick={()=>setScreen("manager-login")} className="bg-transparent border border-[#1e2a38] text-[#4a6a8a] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#1e2a38] transition-colors">Manager</button>
          </div>
        </div>
      </div>
      <div className="px-7">
        <div className="text-[12px] text-[#3a5a7a] text-center mb-5 font-mono tracking-[0.08em]">CHOOSE AN ACTION TO AUTHENTICATE</div>
        <div className="flex flex-col gap-2.5">
          {employees.map(emp=>{
            const rec = clockedIn[emp.id]
            const isWorking = rec?.status === "IN"
            const isOnBreak = rec?.status === "BREAK"
            const isOut = !rec
            
            const elapsed = getElapsed(emp.id)
            const col = ROLE_COLORS[emp.role]||"#7ec8e3"
            
            return (
              <div key={emp.id} className={`flex items-center gap-3.5 px-4.5 py-3.5 rounded-xl text-left w-full transition-all duration-300 border-[1.5px] ${isWorking ? "bg-[#0d1f14] border-[#06d6a0]" : isOnBreak ? "bg-[#1f1a0d] border-[#fca311]" : "bg-[#131b27] border-[#1e2a38]"}`}>
                <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-[#e8f4f8]">{emp.name}</div>
                  <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role}</div>
                </div>
                
                <div className="flex gap-2 min-w-[120px] justify-end items-center">
                  {isOut && (
                    <button onClick={()=>{
                      if (checkCanClockIn(emp)) {
                        setAuthEmp(emp)
                        setPendingAction("IN")
                        setScreen("emp-auth")
                      }
                    }} className="bg-[#06d6a0] text-[#0d1117] text-[11px] font-bold py-1.5 px-3.5 rounded-md font-mono hover:opacity-90">CLOCK IN</button>
                  )}
                  
                  {isOnBreak && (
                    <>
                      <div className="text-[#fca311] font-mono text-[14px] font-bold mr-2">{fmtElapsed(elapsed)}</div>
                      <button onClick={()=>{setAuthEmp(emp); setPendingAction("BREAK_END"); setScreen("emp-auth")}} className="bg-[#fca311] text-[#0d1117] text-[11px] font-bold py-1.5 px-3.5 rounded-md font-mono hover:opacity-90">END BREAK</button>
                    </>
                  )}
                  
                  {isWorking && (
                    <>
                      <div className="text-[#06d6a0] font-mono text-[15px] font-bold mr-2 tracking-wide">{fmtElapsed(elapsed)}</div>
                      <button onClick={()=>{setAuthEmp(emp); setPendingAction("BREAK_START"); setScreen("emp-auth")}} className="bg-transparent border border-[#1e2a38] text-[#e8e8e8] text-[11px] font-bold py-1.5 px-3 rounded-md font-mono hover:bg-[#1e2a38]">BREAK</button>
                      <button onClick={()=>{setAuthEmp(emp); setPendingAction("OUT"); setScreen("emp-auth")}} className="bg-[#ef476f] text-[#0d1117] text-[11px] font-bold py-1.5 px-3 rounded-md font-mono hover:opacity-90">CLOCK OUT</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  if(screen==="emp-auth"&&authEmp){
    const col=ROLE_COLORS[authEmp.role]||"#7ec8e3"
    const actionLabel = pendingAction ? pendingAction.replace("_", " ") : "AUTHENTICATE"
    const currentWk = schedules[weekKey(0)] || {}

    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-5">
            <div className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-[20px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{authEmp.avatar}</div>
            <div className="text-[18px] font-bold text-[#e8f4f8]">{authEmp.name}</div>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mt-4 mb-6 bg-[#131b27] p-2 rounded-lg border border-[#1e2a38]">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, i) => {
              const fullDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]
              let shift = currentWk[fullDay]?.[authEmp.id] || "OFF"
              if (shift.toUpperCase() === "OFF" || shift === "") shift = "-"
              else shift = shift.split("-")[0].trim().replace(":00", "")
              
              const isToday = new Date().getDay() === i
              return (
                <div key={day} className={`flex flex-col items-center ${isToday ? "bg-[#1e2a38] rounded py-1 border border-[#2a4060]" : "py-1"}`}>
                  <div className="text-[9px] text-[#4a6a8a] font-mono uppercase">{day}</div>
                  <div className="text-[9px] text-[#e8f4f8] font-mono mt-1 font-bold">{shift}</div>
                </div>
              )
            })}
          </div>

          <div className="text-center mb-4">
            <div className="text-[11px] text-[#7ec8e3] font-mono tracking-widest uppercase">CONFIRM {actionLabel}</div>
          </div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>:<PinPad correctPin={authEmp.pin} label={`PIN TO ${actionLabel}`} onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>}
        </div>
      </div>
    )
  }

  if(screen==="portal-select") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
      <div className="px-7 pt-5 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center">
        <h1 className="text-[22px] font-bold text-[#e8f4f8] m-0">Select Your Profile</h1>
        <button onClick={()=>setScreen("kiosk")} className="text-[#4a6a8a] font-mono text-[10px] hover:text-[#e8e8e8]">Back to Kiosk</button>
      </div>
      <div className="px-7 flex flex-col gap-2.5">
        {employees.map(emp=>{
           const col = ROLE_COLORS[emp.role]||"#7ec8e3"
           return (
             <button key={emp.id} onClick={()=>{setAuthEmp(emp); setScreen("portal-auth")}} className="flex items-center gap-3.5 px-4.5 py-3.5 rounded-xl cursor-pointer text-left w-full bg-[#131b27] border-[1.5px] border-[#1e2a38] hover:border-[#2a4060]">
               <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
               <div className="flex-1">
                 <div className="text-[15px] font-bold text-[#e8f4f8]">{emp.name}</div>
                 <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role}</div>
               </div>
             </button>
           )
        })}
      </div>
    </div>
  )

  if(screen==="portal-auth"&&authEmp){
    const col=ROLE_COLORS[authEmp.role]||"#7ec8e3"
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-7">
            <div className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-[20px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{authEmp.avatar}</div>
            <div className="text-[18px] font-bold text-[#e8f4f8]">{authEmp.name}</div>
            <div className="text-[11px] text-[#7ec8e3] font-mono tracking-widest mt-1.5 uppercase">PORTAL ACCESS</div>
          </div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>{setPortalEmp(authEmp); setScreen("portal-dashboard")}} onCancel={()=>setScreen("portal-select")}/>:<PinPad correctPin={authEmp.pin} label="PIN FOR PORTAL" onSuccess={()=>{setPortalEmp(authEmp); setScreen("portal-dashboard")}} onCancel={()=>setScreen("portal-select")}/>}
        </div>
      </div>
    )
  }

  if(screen==="portal-dashboard"&&portalEmp) {
    const stats = timesheets[portalEmp.id] || { hours: "0.00", pay: "0.00" }
    const currentWk = schedules[weekKey(0)] || {}
    
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[780px] mx-auto pb-10">
        <div className="px-7 pt-5 border-b border-[#1a2535] mb-6 pb-4 flex justify-between items-center">
           <div>
             <div className="text-[10px] text-[#4a6a8a] tracking-[0.2em] uppercase font-mono mb-1">Employee Portal</div>
             <h1 className="text-[22px] font-bold text-[#e8f4f8] m-0">Welcome, {portalEmp.name.split(" ")[0]}</h1>
           </div>
           <button onClick={()=>{setPortalEmp(null); setScreen("kiosk")}} className="bg-[#1e2a38] border border-[#2a4060] text-[#e8e8e8] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#ef476f] hover:border-[#ef476f] transition-colors">Log Out</button>
        </div>
        
        <div className="px-7 flex flex-col gap-6">
          <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 shadow-lg">
            <div className="text-[14px] font-semibold text-[#e8f4f8] mb-4">Current Week Summary</div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-[32px] font-mono font-bold text-[#06d6a0] leading-none">{stats.hours}</div>
                <div className="text-[11px] text-[#4a6a8a] mt-1.5 font-mono uppercase">Total Hours</div>
              </div>
              <div className="text-right">
                <div className="text-[22px] font-mono font-bold text-[#e8f4f8] leading-none">${stats.pay}</div>
                <div className="text-[11px] text-[#4a6a8a] mt-1.5 font-mono uppercase">Est. Gross Pay</div>
              </div>
            </div>
          </div>

          <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-5 shadow-lg">
            <div className="text-[14px] font-semibold text-[#e8f4f8] mb-4">My Schedule</div>
            <div className="flex flex-col gap-3">
              <div className="text-[11px] text-[#7ec8e3] font-mono tracking-widest uppercase border-b border-[#1a2535] pb-2">This Week</div>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => {
                const shift = currentWk[day]?.[portalEmp.id] || "OFF"
                const isToday = new Date().getDay() === i
                return (
                  <div key={day} className={`flex justify-between items-center ${isToday ? "bg-[#1e2a38] -mx-2 px-2 py-1.5 rounded border border-[#2a4060]" : ""}`}>
                    <div className={`text-[13px] ${isToday ? "text-[#7ec8e3] font-bold" : "text-[#a0b0c0]"}`}>{day}</div>
                    <div className={`text-[13px] font-mono ${shift === "OFF" || shift === "" ? "text-[#4a6a8a]" : "text-[#e8f4f8]"}`}>{shift === "" ? "OFF" : shift}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if(screen==="manager-login") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        <ManagerLogin onSuccess={sess=>{setMgrSession(sess); setScreen("manager-dashboard"); setMgrTab("timesheets")}} onCancel={()=>setScreen("kiosk")}/>
      </div>
    </div>
  )

  if(screen==="manager-dashboard"&&managerSession) return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[1020px] mx-auto pb-15">
      {showAddEmp&&<EmployeeForm title="Add Employee" saveLabel="Add Employee" onSave={handleSaveEmployee} onClose={()=>setShowAddEmp(false)}/>}
      {editEmp&&<EmployeeForm title="Edit Employee" saveLabel="Save Changes" initial={editEmp} onSave={handleSaveEmployee} onClose={()=>setEditEmp(null)}/>}
      
      <div className="px-7 pt-5 border-b border-[#1a2535]">
        <div className="flex items-end justify-between mb-4">
          <div><h1 className="m-0 text-[22px] font-bold text-[#e8f4f8]">Manager Dashboard</h1></div>
          <div className="flex gap-2">
            <button onClick={()=>setScreen("kiosk")} className="bg-transparent border border-[#1e2a38] text-[#4a6a8a] py-1.5 px-3 rounded-md cursor-pointer font-mono text-[10px]">Kiosk</button>
          </div>
        </div>
        <div className="flex">
          <button style={managerTab==="employees"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("employees")}>Employees</button>
          <button style={managerTab==="schedules"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("schedules")}>Schedules</button>
          <button style={managerTab==="timesheets"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("timesheets")}>Timesheets</button>
        </div>
      </div>
      
      <div className="px-7 py-6">
        
        {managerTab==="schedules"&&(
          <div>
            <div className="flex justify-between items-center mb-4.5">
              <div className="flex items-center gap-4">
                <div className="text-[14px] font-semibold text-[#e8f4f8]">Schedule Builder</div>
                <div className="flex gap-2 items-center ml-4 border-l border-[#1e2a38] pl-4">
                  <button onClick={() => setWeekIdx(p => p - 1)} className="bg-[#1e2a38] text-[#7ec8e3] py-1 px-2.5 rounded text-[11px] font-mono hover:bg-[#2a4060]">Prev Week</button>
                  <div className="text-[11px] text-[#4a6a8a] font-mono w-24 text-center">Offset: {weekIdx === 0 ? "Current" : weekIdx > 0 ? `+${weekIdx}` : weekIdx}</div>
                  <button onClick={() => setWeekIdx(p => p + 1)} className="bg-[#1e2a38] text-[#7ec8e3] py-1 px-2.5 rounded text-[11px] font-mono hover:bg-[#2a4060]">Next Week</button>
                </div>
              </div>
              <button onClick={handleSaveScheduleGrid} className="bg-[#06d6a0] border-none text-[#0d1117] py-2.5 px-5 rounded-lg cursor-pointer font-serif text-[13px] font-bold hover:opacity-90 transition-opacity">Save Schedule</button>
            </div>
            <div className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-4 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr>
                    <th className="p-2.5 border-b border-[#1a2535] text-[#4a6a8a] text-[11px] font-mono tracking-wider">EMPLOYEE</th>
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(d => <th key={d} className="p-2.5 border-b border-[#1a2535] text-[#4a6a8a] text-[11px] font-mono tracking-wider uppercase">{d.substring(0,3)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} className="border-b border-[#1a2535] last:border-0">
                      <td className="p-2.5 text-[13px] font-bold text-[#e8f4f8] whitespace-nowrap">{emp.name}</td>
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => (
                        <td key={day} className="p-1.5">
                          <input
                            type="text"
                            value={schedules[weekKey(weekIdx)]?.[day]?.[emp.id] || ""}
                            onChange={(e) => updateScheduleCell(day, emp.id, e.target.value)}
                            className="bg-[#0d1117] border border-[#2a4060] rounded w-full p-2 text-[11px] text-[#e8f4f8] font-mono focus:border-[#7ec8e3] focus:outline-none transition-colors"
                            placeholder="OFF"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {managerTab==="timesheets"&&(
          <div>
            <div className="flex justify-between items-center mb-4.5">
              <div><div className="text-[14px] font-semibold text-[#e8f4f8]">Payroll & Timesheets</div></div>
              <div className="flex gap-2.5">
                <button onClick={handleExportCSV} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-2.5 px-4 rounded-lg cursor-pointer font-serif text-[13px] font-bold hover:bg-[#1a2a3a] transition-colors">CSV</button>
                <button onClick={handleExportXLSX} className="bg-transparent border border-[#2a4060] text-[#7ec8e3] py-2.5 px-4 rounded-lg cursor-pointer font-serif text-[13px] font-bold hover:bg-[#1a2a3a] transition-colors">Excel</button>
                <button onClick={handleFinalizePayroll} className="bg-[#06d6a0] border-none text-[#0d1117] py-2.5 px-5 rounded-lg cursor-pointer font-serif text-[13px] font-bold hover:opacity-90 transition-opacity">Finalize Payroll</button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              {employees.map(emp=>{
                const stats = timesheets[emp.id] || { hours: "0.00", pay: "0.00" }
                const col = ROLE_COLORS[emp.role]||"#555"
                const hoursNum = parseFloat(stats.hours)
                const isOvertime = hoursNum >= 40
                const isApproachingOT = hoursNum >= 36 && hoursNum < 40

                return (
                  <div key={emp.id} className={`bg-[#131b27] border ${isOvertime ? 'border-[#ef476f]' : isApproachingOT ? 'border-[#fca311]' : 'border-[#1e2a38]'} rounded-xl p-4 flex items-center justify-between`}>
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                      <div>
                        <div className="text-[13px] font-bold text-[#e8f4f8] flex items-center gap-2">
                          {emp.name}
                          {isOvertime && <span className="bg-[#ef476f] text-[#0d1117] text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Overtime</span>}
                          {isApproachingOT && <span className="bg-[#fca311] text-[#0d1117] text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Near OT</span>}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role} • ${Number(emp.baseRate).toFixed(2)}/hr</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[18px] font-mono font-bold ${isOvertime ? 'text-[#ef476f]' : isApproachingOT ? 'text-[#fca311]' : 'text-[#06d6a0]'}`}>{stats.hours} hrs</div>
                      <div className="text-[11px] text-[#4a6a8a] mt-0.5">Est Pay: ${stats.pay}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {managerTab==="employees"&&(
          <div>
            <div className="flex justify-between items-center mb-4.5">
              <div><div className="text-[14px] font-semibold text-[#e8f4f8]">Employee Roster</div></div>
              <button onClick={()=>setShowAddEmp(true)} className="bg-[#7ec8e3] border-none text-[#0d1117] py-2.5 px-5 rounded-lg cursor-pointer font-serif text-[13px] font-bold">Add Employee</button>
            </div>
            <div className="flex flex-col gap-2.5">
              {employees.map(emp=>{
                const col=ROLE_COLORS[emp.role]||"#555"
                return (
                  <div key={emp.id} className="bg-[#131b27] border border-[#1e2a38] rounded-xl p-3.5">
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                      <div className="flex-1">
                        <div className="text-[13px] font-bold text-[#e8f4f8] flex items-center gap-2">{emp.name}</div>
                        <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role}</div>
                      </div>
                      <button onClick={()=>setEditEmp(emp)} className="bg-[#1a2a3a] border border-[#2a4060] text-[#7ec8e3] w-9 h-9 rounded-lg cursor-pointer text-[15px] shrink-0 flex items-center justify-center" title="Edit">EDIT</button>
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
  return null
}