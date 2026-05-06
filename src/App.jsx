import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, HIST_HOURS, multiply, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle, statBoxStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"

export default function PineLakeApp() {
  const [employees,setEmployees] = useState([])
  const [schedules,setSchedules] = useState({})
  const [clockedIn,setClockedIn] = useState({})
  const [clockLog,setClockLog] = useState([])
  const [screen,setScreen] = useState("kiosk")
  const [authEmp,setAuthEmp] = useState(null)
  const [managerSession,setMgrSession] = useState(null)
  const [managerTab,setMgrTab] = useState("clock")
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
        const cState = {}
        const rLogs = []
        const seen = new Set()
        logs.forEach(log => {
          if (!seen.has(log.employee_id)) {
            seen.add(log.employee_id)
            if (log.action === "IN") {
              cState[log.employee_id] = new Date(log.created_at).getTime()
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
      .channel('live-clock')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clock_logs' },
        (payload) => {
          const log = payload.new
          const emp = employees.find(e => e.id === log.employee_id)
          if (!emp) return

          setClockedIn(prev => {
            const next = { ...prev }
            if (log.action === 'IN') {
              next[emp.id] = new Date(log.created_at).getTime()
            } else {
              delete next[emp.id]
            }
            return next
          })

          const timeString = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: log.action, time: timeString }, ...prev.slice(0, 49)])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [employees])

  function getElapsed(empId){
    const ts=clockedIn[empId]
    if(!ts) return 0
    return Math.floor((Date.now()-ts)/1000)
  }

  async function handleSaveEmployee(empData) {
    if (empData.id && typeof empData.id === "number" && String(empData.id).length < 10) {
      const { error } = await supabase.from("employees").update({
        name: empData.name, role: empData.role, base_rate: empData.baseRate, bonus_rate: empData.bonusRate, pin: empData.pin, auth_method: empData.authMethod, avatar: empData.avatar
      }).eq("id", empData.id)
      if (!error) {
        setEmployees(p => p.map(e => e.id === empData.id ? empData : e))
      }
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

  async function doClockAction(emp) {
    const isIn = !!clockedIn[emp.id]
    const actionType = isIn ? "OUT" : "IN"
    const { error } = await supabase.from("clock_logs").insert([{ employee_id: emp.id, action: actionType }])
    if (error) return
    const t = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
    setClockedIn(prev => {
      const n = { ...prev }
      if (isIn) delete n[emp.id]
      else n[emp.id] = Date.now()
      return n
    })
    setClockLog(prev => [{ empId: emp.id, emp: emp.name, action: actionType, time: t }, ...prev.slice(0, 49)])
  }

  function handleEmpAuth(emp) {
    doClockAction(emp)
    setTimeout(()=>setScreen("kiosk"),800)
  }

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
            <span className="text-[#06d6a0] font-bold">{Object.keys(clockedIn).length}</span> clocked in total {employees.length}
          </div>
          <button onClick={()=>setScreen("manager-login")} className="ml-auto bg-transparent border border-[#1e2a38] text-[#4a6a8a] py-1.5 px-3.5 rounded-md cursor-pointer font-mono text-[10px] hover:bg-[#1e2a38] transition-colors">Manager</button>
        </div>
      </div>
      <div className="px-7">
        <div className="text-[12px] text-[#3a5a7a] text-center mb-5 font-mono tracking-[0.08em]">TAP YOUR NAME TO CLOCK IN OR OUT</div>
        <div className="flex flex-col gap-2.5">
          {employees.map(emp=>{
            const isIn=!!clockedIn[emp.id]
            const elapsed=getElapsed(emp.id)
            const col=ROLE_COLORS[emp.role]||"#7ec8e3"
            return (
              <button key={emp.id} onClick={()=>{setAuthEmp(emp);setScreen("emp-auth")}}
                className={`flex items-center gap-3.5 px-4.5 py-3.5 rounded-xl cursor-pointer text-left w-full transition-all duration-300 border-[1.5px] ${isIn ? "bg-[#0d1f14] border-[#06d6a0]" : "bg-[#131b27] border-[#1e2a38]"}`}>
                <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{emp.avatar}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-[#e8f4f8]">{emp.name}</div>
                  <div className="text-[11px] mt-0.5" style={{color: col}}>{emp.role}</div>
                </div>
                <div className="text-right min-w-[120px]">
                  {isIn ? (
                    <div><div className="font-mono text-[20px] font-bold text-[#06d6a0] tracking-[0.04em] leading-none">{fmtElapsed(elapsed)}</div></div>
                  ) : (
                    <div className="flex items-center gap-2 justify-end"><div className="bg-[#06d6a0] text-[#0d1117] text-[11px] font-bold py-1.5 px-3 rounded-md font-mono">CLOCK IN</div></div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  if(screen==="emp-auth"&&authEmp){
    const isIn=!!clockedIn[authEmp.id]
    const col=ROLE_COLORS[authEmp.role]||"#7ec8e3"
    return (
      <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-7">
            <div className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-[20px] font-bold text-[#111] font-mono" style={{backgroundColor: col}}>{authEmp.avatar}</div>
            <div className="text-[18px] font-bold text-[#e8f4f8]">{authEmp.name}</div>
          </div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>:<PinPad correctPin={authEmp.pin} label="YOUR PIN" onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>}
        </div>
      </div>
    )
  }

  if(screen==="manager-login") return (
    <div className="font-serif bg-[#0d1117] min-h-screen text-[#e8e8e8] flex items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        <ManagerLogin onSuccess={sess=>{setMgrSession(sess);setScreen("manager-dashboard");setMgrTab("employees")}} onCancel={()=>setScreen("kiosk")}/>
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
        </div>
      </div>
      
      <div className="px-7 py-6">
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