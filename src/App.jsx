import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import { ROLE_COLORS, HIST_HOURS, multiply, blankWeek, weekKey, fmtElapsed, tabBtnStyle, tabBtnActiveStyle, statBoxStyle } from "./lib/utils"
import { FaceScanUI, PinPad, EmployeeForm, ManagerLogin } from "./components/Forms"

export default function PineLakeApp() {
  const [employees,setEmployees] = useState([])
  const [schedules,setSchedules] = useState({})
  const [weekStatus,setWeekStatus] = useState({})
  const [clockedIn,setClockedIn] = useState({})
  const [clockLog,setClockLog] = useState([])
  const [screen,setScreen] = useState("kiosk")
  const [authEmp,setAuthEmp] = useState(null)
  const [managerSession,setMgrSession] = useState(null)
  const [managerTab,setMgrTab] = useState("clock")
  const [showAddEmp,setShowAddEmp] = useState(false)
  const [editEmp,setEditEmp] = useState(null)
  const [payEmp,setPayEmp] = useState(null)
  const [now,setNow] = useState(new Date())

  const [weekIdx,setWeekIdx] = useState(0)

  useEffect(()=>{
    const iv=setInterval(()=>setNow(new Date()),1000)
    return ()=>clearInterval(iv)
  },[])

  useEffect(()=>{
    if(employees.length&&!payEmp) setPayEmp(employees[0])
  },[employees])

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

  const wk = weekKey(weekIdx)
  const currentSchedule = schedules[wk] || blankWeek(employees)

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

  function empCost(emp) {
    const histH = HIST_HOURS[emp.id] || 0
    const liveH = getElapsed(emp.id) / 3600
    const totalH = histH + liveH
    const regH = Math.min(totalH, 40)
    const otH = Math.max(0, totalH - 40)
    const otRate = multiply(emp.baseRate, 1.5)
    const gross = multiply(regH, emp.baseRate) + multiply(otH, otRate)
    const employer = multiply(gross, 0.0765) + multiply(gross, 0.006) + multiply(gross, 0.027)
    return {histH, liveH, totalH, regH, otH, gross, employer, total: gross + employer}
  }

  const isAdmin = managerSession?.userRole === "admin"

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
      <div style={{padding:"0 28px"}}>
        <div style={{fontSize:12,color:"#3a5a7a",textAlign:"center",marginBottom:20,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.08em"}}>TAP YOUR NAME TO CLOCK IN OR OUT</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {employees.map(emp=>{
            const isIn=!!clockedIn[emp.id]
            const elapsed=getElapsed(emp.id)
            const col=ROLE_COLORS[emp.role]||"#7ec8e3"
            return (
              <button key={emp.id} onClick={()=>{setAuthEmp(emp);setScreen("emp-auth")}}
                style={{display:"flex",alignItems:"center",gap:14,padding:"14px 18px",background:isIn?"#0d1f14":"#131b27",border:"1.5px solid " + (isIn?"#06d6a0":"#1e2a38"),borderRadius:12,cursor:"pointer",textAlign:"left",width:"100%",transition:"all 0.3s"}}>
                <div style={{width:44,height:44,borderRadius:"50%",flexShrink:0,background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#111",fontFamily:"'JetBrains Mono',monospace"}}>{emp.avatar}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:"#e8f4f8"}}>{emp.name}</div><div style={{fontSize:11,color:col,marginTop:2}}>{emp.role}</div></div>
                <div style={{textAlign:"right",minWidth:120}}>
                  {isIn?(
                    <div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:"#06d6a0",letterSpacing:"0.04em",lineHeight:1}}>{fmtElapsed(elapsed)}</div></div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}><div style={{background:"#06d6a0",color:"#0d1117",fontSize:11,fontWeight:700,padding:"5px 12px",borderRadius:6,fontFamily:"'JetBrains Mono',monospace"}}>CLOCK IN</div></div>
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
      <div style={{fontFamily:"'Bitter',Georgia,serif",background:"#0d1117",minHeight:"100vh",color:"#e8e8e8",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
        <div style={{width:"100%",maxWidth:340}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{width:64,height:64,borderRadius:"50%",margin:"0 auto 14px",background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:"#111",fontFamily:"'JetBrains Mono',monospace"}}>{authEmp.avatar}</div>
            <div style={{fontSize:18,fontWeight:700,color:"#e8f4f8"}}>{authEmp.name}</div>
          </div>
          {authEmp.authMethod==="face"?<FaceScanUI onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>:<PinPad correctPin={authEmp.pin} label="YOUR PIN" onSuccess={()=>handleEmpAuth(authEmp)} onCancel={()=>setScreen("kiosk")}/>}
        </div>
      </div>
    )
  }

  if(screen==="manager-login") return (
    <div style={{fontFamily:"'Bitter',Georgia,serif",background:"#0d1117",minHeight:"100vh",color:"#e8e8e8",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:340}}><ManagerLogin onSuccess={sess=>{setMgrSession(sess);setScreen("manager-dashboard");setMgrTab("employees")}} onCancel={()=>setScreen("kiosk")}/></div>
    </div>
  )

  if(screen==="manager-dashboard"&&managerSession) return (
    <div style={{fontFamily:"'Bitter',Georgia,serif",background:"#0d1117",minHeight:"100vh",color:"#e8e8e8",maxWidth:1020,margin:"0 auto",paddingBottom:60}}>
      {showAddEmp&&<EmployeeForm title="Add Employee" saveLabel="Add Employee" onSave={handleSaveEmployee} onClose={()=>setShowAddEmp(false)}/>}
      {editEmp&&<EmployeeForm title="Edit Employee" saveLabel="Save Changes" initial={editEmp} onSave={handleSaveEmployee} onClose={()=>setEditEmp(null)}/>}
      
      <div style={{padding:"22px 30px 0",borderBottom:"1px solid #1a2535"}}>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16}}>
          <div><h1 style={{margin:0,fontSize:22,fontWeight:700,color:"#e8f4f8"}}>Manager Dashboard</h1></div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setScreen("kiosk")} style={{background:"none",border:"1px solid #1e2a38",color:"#4a6a8a",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>Kiosk</button>
          </div>
        </div>
        <div style={{display:"flex"}}>
          <button style={managerTab==="employees"?tabBtnActiveStyle:tabBtnStyle} onClick={()=>setMgrTab("employees")}>Employees</button>
        </div>
      </div>
      
      <div style={{padding:"26px 30px"}}>
        {managerTab==="employees"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div><div style={{fontSize:14,fontWeight:600,color:"#e8f4f8"}}>Employee Roster</div></div>
              <button onClick={()=>setShowAddEmp(true)} style={{background:"#7ec8e3",border:"none",color:"#0d1117",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontFamily:"'Bitter',serif",fontSize:13,fontWeight:700}}>Add Employee</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {employees.map(emp=>{
                const col=ROLE_COLORS[emp.role]||"#555"
                return (
                  <div key={emp.id} style={statBoxStyle}>
                    <div style={{display:"flex",alignItems:"center",gap:14}}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#111",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>{emp.avatar}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#e8f4f8",display:"flex",alignItems:"center",gap:8}}>{emp.name}</div>
                        <div style={{fontSize:11,color:col,marginTop:2}}>{emp.role}</div>
                      </div>
                      <button onClick={()=>setEditEmp(emp)} style={{background:"#1a2a3a",border:"1px solid #2a4060",color:"#7ec8e3",width:36,height:36,borderRadius:8,cursor:"pointer",fontSize:15,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}} title="Edit">EDIT</button>
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