import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"
import * as XLSX from "xlsx"

// --- CORE UTILITIES ---
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
  return `${formatTime(parts[0])} - ${formatTime(parts[1])}`
}

function fmtMoney(n) { 
  return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") 
}

export default function PineLakeApp() {
  const [employees, setEmployees] = useState([])
  const [schedules, setSchedules] = useState({})
  const [clockedIn, setClockedIn] = useState({})
  const [allLogs, setAllLogs] = useState([])
  const [screen, setScreen] = useState("kiosk")
  const [authEmp, setAuthEmp] = useState(null)
  const [portalEmp, setPortalEmp] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [managerSession, setMgrSession] = useState(null)
  const [managerTab, setMgrTab] = useState("employees")
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [editEmp, setEditEmp] = useState(null)
  const [now, setNow] = useState(new Date())
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0])

  const activeWeekKey = getSundayKey(targetDate)

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    async function loadData() {
      const { data: empData } = await supabase.from("employees").select("*").order("id")
      if (empData) {
        setEmployees(empData.map(e => ({
          id: e.id, name: e.name, role: e.role, baseRate: e.base_rate,
          bonusRate: e.bonus_rate, pin: e.pin, authMethod: e.auth_method, avatar: e.avatar,
          fedTaxRate: e.fed_tax_rate ?? 12, stateTaxRate: e.state_tax_rate ?? 5.5,
          countyTaxRate: e.county_tax_rate ?? 0, ficaTaxRate: e.fica_tax_rate ?? 7.65
        })))
      }

      const { data: logs } = await supabase.from("clock_logs").select("*").order("created_at", { ascending: false })
      if (logs) {
        setAllLogs(logs)
        const cState = {}
        logs.forEach(log => {
          if (!cState[log.employee_id]) {
            if (log.action === "IN" || log.action === "BREAK_END") {
              cState[log.employee_id] = { status: "IN", time: new Date(log.created_at).getTime() }
            } else if (log.action === "BREAK_START") {
              cState[log.employee_id] = { status: "BREAK", time: new Date(log.created_at).getTime() }
            }
          }
        })
        setClockedIn(cState)
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

      summary[emp.id] = {
        hours: (regH + otH).toFixed(2), regH: regH.toFixed(2), otH: otH.toFixed(2),
        gross, employerTax, totalCost: gross + employerTax, 
        empTaxes: totalEmpTaxes, netPay: gross - totalEmpTaxes,
        fed, state, county, fica
      }
    })
    return summary
  }
  const timesheets = getTimesheetSummary()

  // --- ACTIONS ---
  async function handleExportCSV() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data?.length) return alert("No history.")
    let csv = "Employee,Week,Hours,Rate,Gross,Fed,State,County,FICA,Er Tax,Total Cost,Net\n"
    data.forEach(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      csv += `"${e?.name}",${r.week_start_date},${r.total_hours},${r.pay_rate_at_time},${r.gross_pay},${r.fed_tax},${r.state_tax},${r.county_tax},${r.fica_tax},${r.employer_tax},${r.total_cost},${r.net_pay}\n`
    })
    const blob = new Blob([csv], { type: "text/csv" })
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Payroll_${new Date().toISOString().split('T')[0]}.csv`; link.click()
  }

  async function handleExportXLSX() {
    const { data } = await supabase.from("payroll_history").select("*").order("week_start_date", { ascending: false })
    if (!data) return
    const sheet = data.map(r => {
      const e = employees.find(emp => emp.id === r.employee_id)
      return { Employee: e?.name, Date: r.week_start_date, Hours: r.total_hours, Rate: r.pay_rate_at_time, Gross: r.gross_pay, Net: r.net_pay }
    })
    const ws = XLSX.utils.json_to_sheet(sheet), wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Payroll")
    XLSX.writeFile(wb, `Payroll_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  async function handleFinalizePayroll() {
    if (Object.values(clockedIn).some(s => s.status === "IN")) return alert("Employees must clock out first.")
    const records = employees.map(emp => {
      const s = timesheets[emp.id]
      return {
        employee_id: emp.id, week_start_date: activeWeekKey, total_hours: parseFloat(s.hours),
        pay_rate_at_time: emp.baseRate, gross_pay: s.gross, fed_tax: s.fed, state_tax: s.state,
        county_tax: s.county, fica_tax: s.fica, employer_tax: s.employerTax, total_cost: s.totalCost, net_pay: s.netPay
      }
    }).filter(r => r.total_hours > 0)
    await supabase.from("payroll_history").insert(records)
    alert("Payroll finalized and historical record created.")
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
    await supabase.auth.signInWithPassword({ email: `emp_${emp.id}@pinelake.internal`, password: emp.pin })
    await supabase.from("clock_logs").insert([{ employee_id: emp.id, action: type }])
    await supabase.auth.signOut()
    window.location.reload()
  }

  const activeCount = Object.values(clockedIn).filter(s => s.status === "IN").length

  // --- SCREENS ---
  if(screen === "kiosk") return (
    <div className="bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[800px] mx-auto pb-10 px-5 sm:px-8">
      <div className="pt-6 border-b border-[#1a2535] mb-8 pb-4 flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div><h1 className="text-[26px] font-bold m-0">Time Clock Kiosk</h1><div className="text-[11px] text-[#4a6a8a] mt-1 font-mono uppercase tracking-widest">{activeCount} Currently Working</div></div>
        <div className="text-left sm:text-right font-mono text-[28px] text-[#7ec8e3]">{now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
        <div className="flex gap-2"><button onClick={()=>setScreen("portal-select")} className="tab-btn">Portal</button><button onClick={()=>setScreen("manager-login")} className="tab-btn">Manager</button></div>
      </div>
      <div className="flex flex-col gap-4">
        {employees.map(emp => {
          const s = clockedIn[emp.id], isW = s?.status === "IN"
          return (
            <div key={emp.id} className={`flex flex-col sm:flex-row items-center gap-5 p-5 rounded-2xl border-2 ${isW ? "bg-[#0d1f14] border-[#06d6a0]" : "bg-[#131b27] border-[#1e2a38]"}`}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-[#111] text-lg" style={{backgroundColor: ROLE_COLORS[emp.role]}}>{emp.avatar}</div>
              <div className="flex-1 text-center sm:text-left">
                <div className="text-lg font-bold">{emp.name}</div>
                <div className="text-[12px] font-mono" style={{color: ROLE_COLORS[emp.role]}}>{emp.role.toUpperCase()}</div>
              </div>
              <div className="flex gap-3">
                {!s ? <button onClick={()=>{setAuthEmp(emp);setPendingAction("IN");setScreen("emp-auth")}} className="bg-[#06d6a0] text-[#0d1117] text-[12px] font-bold py-2.5 px-6 rounded-lg uppercase">Clock In</button> :
                  <><button onClick={()=>{setAuthEmp(emp);setPendingAction("BREAK_START");setScreen("emp-auth")}} className="border border-[#1e2a38] py-2.5 px-5 rounded-lg text-[12px] font-mono">BREAK</button>
                    <button onClick={()=>{setAuthEmp(emp);setPendingAction("OUT");setScreen("emp-auth")}} className="bg-[#ef476f] text-[#0d1117] py-2.5 px-5 rounded-lg text-[12px] font-bold uppercase">Clock Out</button></>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  if(screen === "emp-auth") return (
    <div className="bg-[#0d1117] min-h-screen flex items-center justify-center p-6 text-[#e8e8e8]">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-6"><div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center font-bold text-[#111] text-xl" style={{backgroundColor: ROLE_COLORS[authEmp.role]}}>{authEmp.avatar}</div><div className="text-xl font-bold">{authEmp.name}</div></div>
        {authEmp.authMethod === "face" ? <FaceScanUI onSuccess={()=>doClockAction(authEmp, pendingAction)} onCancel={()=>setScreen("kiosk")}/> : 
          <PinPad correctPin={authEmp.pin} label={pendingAction} onSuccess={()=>doClockAction(authEmp, pendingAction)} onCancel={()=>setScreen("kiosk")}/>}
      </div>
    </div>
  )

  if(screen === "manager-dashboard") {
    const total = employees.reduce((a, e) => {
      const s = timesheets[e.id] || { gross: 0, employerTax: 0, totalCost: 0, hours: 0 }
      return { g: a.g + s.gross, t: a.t + s.employerTax, c: a.c + s.totalCost, h: a.h + parseFloat(s.hours) }
    }, { g: 0, t: 0, c: 0, h: 0 })

    return (
      <div className="bg-[#0d1117] min-h-screen text-[#e8e8e8] max-w-[1100px] mx-auto pb-20 px-6">
        {showAddEmp && <EmployeeForm title="Add Employee" onSave={handleSaveEmployee} onClose={()=>setShowAddEmp(false)}/>}
        {editEmp && <EmployeeForm title="Edit Details" initial={editEmp} onSave={handleSaveEmployee} onClose={()=>setEditEmp(null)}/>}
        
        <div className="pt-8 border-b border-[#1a2535] mb-8 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex gap-4">
            <button style={managerTab === "employees" ? tabBtnActiveStyle : tabBtnStyle} onClick={()=>setMgrTab("employees")}>Employees</button>
            <button style={managerTab === "schedules" ? tabBtnActiveStyle : tabBtnStyle} onClick={()=>setMgrTab("schedules")}>Schedules</button>
            <button style={managerTab === "timesheets" ? tabBtnActiveStyle : tabBtnStyle} onClick={()=>setMgrTab("timesheets")}>Payroll & Cost</button>
          </div>
          <button onClick={()=>setScreen("kiosk")} className="bg-[#1e2a38] text-[11px] px-4 py-1.5 rounded-lg border border-[#2a4060]">Back to Kiosk</button>
        </div>

        {managerTab === "schedules" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} className="bg-[#131b27] border border-[#2a4060] text-[#7ec8e3] rounded-lg p-2 font-mono" style={{colorScheme:"dark"}}/>
              <div className="flex gap-3"><button onClick={()=>{
                const prev = new Date(targetDate); prev.setDate(prev.getDate()-7)
                const pk = getSundayKey(prev.toISOString().split('T')[0])
                if(schedules[pk]) setSchedules(p=>({...p, [activeWeekKey]: JSON.parse(JSON.stringify(p[pk]))}))
              }} className="border border-[#2a4060] px-4 py-2 rounded-lg text-[12px]">Copy Prev Week</button>
              <button onClick={async ()=>{
                const recs = []
                const grid = schedules[activeWeekKey] || {}
                for(const d of ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]){
                  employees.forEach(e => recs.push({ week_key: activeWeekKey, day: d, employee_id: e.id, shift_time: grid[d]?.[e.id] || "" }))
                }
                await supabase.from("schedules").upsert(recs, { onConflict: "week_key,day,employee_id" })
                alert("Saved")
              }} className="bg-[#06d6a0] text-[#0d1117] px-6 py-2 rounded-lg font-bold text-[12px]">Save Schedule</button></div>
            </div>
            <div className="overflow-x-auto bg-[#131b27] border border-[#1e2a38] rounded-2xl p-4">
              <table className="w-full text-left min-w-[900px] border-separate border-spacing-y-2">
                <thead><tr><th className="p-2 text-[11px] text-[#4a6a8a] font-mono">STAFF MEMBER</th>{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><th key={d} className="p-2 text-[11px] text-[#4a6a8a] text-center font-mono">{d}</th>)}</tr></thead>
                <tbody>{employees.map(e => (
                  <tr key={e.id} className="bg-[#0d1117] rounded-lg">
                    <td className="p-3 font-bold text-[13px] border-l-2" style={{borderLeftColor: ROLE_COLORS[e.role]}}>{e.name}</td>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(d => {
                      const val = schedules[activeWeekKey]?.[d]?.[e.id] || "OFF", isO = val === "OFF"
                      return (
                        <td key={d} className="p-1.5">
                          <button onClick={()=>{
                            const next = { ...schedules }; if(!next[activeWeekKey]) next[activeWeekKey] = {}
                            if(!next[activeWeekKey][d]) next[activeWeekKey][d] = {}
                            next[activeWeekKey][d][e.id] = isO ? "09:00-17:00" : "OFF"
                            setSchedules(next)
                          }} className="text-[9px] text-[#7ec8e3] block mx-auto mb-1 font-mono uppercase">{isO ? "Set" : "Off"}</button>
                          {isO ? <div className="bg-[#1a140a] border border-[#fca31133] text-[#fca311] text-center text-[11px] font-bold py-3 rounded-lg font-mono">OFF</div> :
                            <div className="flex flex-col bg-[#131b27] border border-[#2a4060] p-1.5 rounded-lg gap-1">
                              <input type="time" value={parseTo24h(val.split('-')[0])} onChange={ev=>{
                                const next = { ...schedules }; next[activeWeekKey][d][e.id] = `${ev.target.value}-${val.split('-')[1]}`
                                setSchedules(next)
                              }} className="bg-transparent text-[11px] text-center font-mono" style={{colorScheme:"dark"}}/>
                              <input type="time" value={parseTo24h(val.split('-')[1])} onChange={ev=>{
                                const next = { ...schedules }; next[activeWeekKey][d][e.id] = `${val.split('-')[0]}-${ev.target.value}`
                                setSchedules(next)
                              }} className="bg-transparent text-[11px] text-center font-mono" style={{colorScheme:"dark"}}/>
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

        {managerTab === "timesheets" && (
          <div className="flex flex-col gap-8">
            <div className="flex justify-between items-center"><div className="text-lg font-bold">Facility Labor Summary</div>
              <div className="flex gap-2"><button onClick={handleExportCSV} className="border border-[#2a4060] text-[#7ec8e3] px-4 py-2 rounded-lg text-xs font-bold">CSV</button>
              <button onClick={handleExportXLSX} className="border border-[#2a4060] text-[#7ec8e3] px-4 py-2 rounded-lg text-xs font-bold">EXCEL</button>
              <button onClick={handleFinalizePayroll} className="bg-[#06d6a0] text-[#0d1117] px-6 py-2 rounded-lg font-bold text-xs uppercase">Finalize Payroll</button></div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-2xl p-6 text-center shadow-xl"><div className="text-[28px] font-mono text-[#7ec8e3] font-bold">{total.h.toFixed(2)}</div><div className="text-[10px] text-[#4a6a8a] mt-2 font-mono tracking-widest uppercase">Total Hours</div></div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-2xl p-6 text-center shadow-xl"><div className="text-[28px] font-mono text-[#06d6a0] font-bold">{fmtMoney(total.g)}</div><div className="text-[10px] text-[#4a6a8a] mt-2 font-mono tracking-widest uppercase">Gross Wages</div></div>
              <div className="bg-[#131b27] border border-[#1e2a38] rounded-2xl p-6 text-center shadow-xl"><div className="text-[28px] font-mono text-[#fca311] font-bold">{fmtMoney(total.t)}</div><div className="text-[10px] text-[#4a6a8a] mt-2 font-mono tracking-widest uppercase">Employer Taxes</div></div>
              <div className="bg-[#131b27] border border-[#ef476f] rounded-2xl p-6 text-center shadow-xl"><div className="text-[28px] font-mono text-[#ef476f] font-bold">{fmtMoney(total.c)}</div><div className="text-[10px] text-[#4a6a8a] mt-2 font-mono tracking-widest uppercase">Total Labor Cost</div></div>
            </div>
            <div className="flex flex-col gap-5">
              <div className="text-lg font-bold">Detailed Employee Breakdown</div>
              {employees.map(e => {
                const s = timesheets[e.id]
                return (
                  <div key={e.id} className="bg-[#131b27] border border-[#ef476f44] rounded-3xl p-6 shadow-2xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-5 mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-[#111] text-lg" style={{backgroundColor: ROLE_COLORS[e.role]}}>{e.avatar}</div>
                        <div><div className="text-xl font-bold flex items-center gap-3">{e.name} <span className="bg-[#ef476f] text-[#0d1117] text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">OVERTIME</span></div><div className="text-[13px] text-[#4a6a8a] font-mono">{e.role} • {fmtMoney(e.baseRate)}/hr</div></div>
                      </div>
                      <div className="text-right w-full md:w-auto border-t md:border-0 border-[#1e2a38] pt-4 md:pt-0"><div className="text-[28px] font-mono font-bold leading-none">{s.hours} hrs</div><div className="text-[13px] text-[#4a6a8a] mt-1 font-mono">Est. Net Pay: <span className="text-[#fca311] font-bold">{fmtMoney(s.netPay)}</span></div></div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#0d1117] p-5 rounded-2xl border border-[#1e2a38]">
                      <div className="text-center border-r border-[#1e2a38] last:border-0"><div className="text-lg font-mono font-bold text-[#e8f4f8]">{fmtMoney(s.gross)}</div><div className="text-[9px] text-[#4a6a8a] font-mono uppercase tracking-widest mt-1">Gross Pay</div></div>
                      <div className="text-center md:border-r border-[#1e2a38] last:border-0"><div className="text-lg font-mono font-bold text-[#ef476f]">- {fmtMoney(s.empTaxes)}</div><div className="text-[9px] text-[#4a6a8a] font-mono uppercase tracking-widest mt-1">Emp. Taxes</div></div>
                      <div className="text-center border-r border-[#1e2a38] last:border-0"><div className="text-lg font-mono font-bold text-[#fca311]">+ {fmtMoney(s.employerTax)}</div><div className="text-[9px] text-[#4a6a8a] font-mono uppercase tracking-widest mt-1">Er. Liability</div></div>
                      <div className="text-center"><div className="text-lg font-mono font-bold text-[#ef476f]">{fmtMoney(s.totalCost)}</div><div className="text-[9px] text-[#4a6a8a] font-mono uppercase tracking-widest mt-1">Total Cost</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {managerTab === "employees" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Staff Roster</h2><button onClick={()=>setShowAddEmp(true)} className="bg-[#7ec8e3] text-[#0d1117] px-6 py-2.5 rounded-xl font-bold text-sm">+ Add Employee</button></div>
            {employees.map(e => (
              <div key={e.id} className="bg-[#131b27] border border-[#1e2a38] rounded-2xl p-5 flex justify-between items-center shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-[#111] text-lg" style={{backgroundColor: ROLE_COLORS[e.role]}}>{e.avatar}</div>
                  <div><div className="text-lg font-bold">{e.name}</div><div className="text-[12px] text-[#4a6a8a] font-mono">{e.role.toUpperCase()} • {fmtMoney(e.baseRate)}/hr</div></div>
                </div>
                <button onClick={()=>setEditEmp(e)} className="bg-[#1a2a3a] border border-[#2a4060] text-[#7ec8e3] w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all hover:scale-105">✏</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  return null
}