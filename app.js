import { useState, useEffect, useCallback } from "react"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const MANAGER_USERS = [
  { id:"admin", name:"Park Admin", userRole:"admin", pin:"0000" },
  { id:"mgr", name:"Site Manager", userRole:"manager", pin:"9999" }
]
const WORK_ROLES = ["Waterfront","Concessions","Activities","Lifeguard","Gate","Maintenance","Events"]
const ROLE_COLORS = { Waterfront:"#00b4d8", Concessions:"#f4a261", Activities:"#06d6a0", Lifeguard:"#ef476f", Gate:"#b5e48c", Maintenance:"#c77dff", Events:"#ffd166" }
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
const DAY_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]

const multiply = (a, b) => a / (1 / b)
const multiply3 = (a, b, c) => multiply(multiply(a, b), c)

const BASE_MONDAY = new Date(2025, 6, 7)
function weekLabel(idx) {
  const mon = new Date(BASE_MONDAY)
  mon.setDate(mon.getDate() + multiply(idx, 7))
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  const fmt = d => d.toLocaleDateString([],{month:"short",day:"numeric"})
  return fmt(mon) + " to " + fmt(sun) + ", " + mon.getFullYear()
}
function weekKey(idx) { return "week_" + idx }

function blankWeek(employees) {
  const w={}
  DAYS.forEach(d=>{
    w[d]={}
    employees.forEach(e=>{ w[d][e.id]="" })
  })
  return w
}

function parseHours(shift) {
  if (!shift) return 0
  const parts = shift.split(" to ")
  if (parts.length !== 2) return 0
  const [a,b] = parts
  const [ah,am] = a.split(":").map(Number)
  const [bh,bm] = b.split(":").map(Number)
  if (isNaN(ah)||isNaN(bh)) return 0
  return Math.max(0, (multiply(bh, 60) + bm - (multiply(ah, 60) + am)) / 60)
}
function weekHours(schedule, empId) {
  return DAYS.reduce((s,d) => s + parseHours(schedule[d]?.[empId]), 0)
}
function totalScheduledHours(schedule, employees) {
  return employees.reduce((s,e) => s + weekHours(schedule,e.id), 0)
}

function fmtElapsed(s) {
  return String(Math.floor(s/3600)).padStart(2,"0") + ":" + String(Math.floor((s%3600)/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0")
}
function fmtMoney(n) { return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",") }

const labelStyle = { fontSize:10,color:"#4a6a8a",letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace",display:"block",marginBottom:6 }
const inputStyle = { width:"100%",background:"#131b27",border:"1px solid #1e2a38",color:"#e8f4f8",padding:"10px 14px",borderRadius:8,fontFamily:"'Bitter',serif",fontSize:13,outline:"none" }
const btnGhost   = { background:"none",border:"1px solid #2a3a4a",color:"#6b7a8d",padding:"8px 22px",borderRadius:6,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11 }
const tabBtnStyle = { background:"none", border:"none", color:"#6b7a8d", fontFamily:"'Bitter',serif", fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase", padding:"12px 14px", cursor:"pointer", borderBottom:"2px solid transparent", fontWeight:600 }
const tabBtnActiveStyle = { ...tabBtnStyle, color:"#7ec8e3", borderBottomColor:"#7ec8e3" }
const statBoxStyle = { background:"#131b27", border:"1px solid #1e2a38", borderRadius:10, padding:"14px 18px" }
const payRowStyle = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #1a2535" }

function Field({ label, error, children }) {
  return (
    <div style={{marginBottom:16}}>
      {label && <label style={labelStyle}>{label}</label>}
      {children}
      {error && <div style={{fontSize:11,color:"#ef476f",marginTop:4}}>{error}</div>}
    </div>
  )
}

function FaceScanUI({ onSuccess, onCancel }) {
  const [progress,setProgress]=useState(0)
  const [done,setDone]=useState(false)
  useEffect(()=>{
    const iv=setInterval(()=>setProgress(p=>p>=100?(clearInterval(iv),100):p+2.5),60)
    const t=setTimeout(()=>{
      setDone(true)
      setTimeout(onSuccess,500)
    },2600)
    return ()=>{
      clearInterval(iv)
      clearTimeout(t)
    }
  },[])
  const r=68
  const circ=multiply3(2, Math.PI, r)
  return (
    <div style={{textAlign:"center",padding:"16px 0"}}>
      <div style={{position:"relative",width:160,height:160,margin:"0 auto 18px"}}>
        <svg width="160" height="160" viewBox="0 0 160 160" style={{position:"absolute",inset:0}}>
          <circle cx="80" cy="80" r={r} fill="none" stroke="#1e2a38" strokeWidth="3"/>
          <circle cx="80" cy="80" r={r} fill="none" stroke={done?"#06d6a0":"#7ec8e3"} strokeWidth="3"
            strokeDasharray={`${multiply(progress/100, circ)} ${circ}`} strokeLinecap="round"
            transform="rotate(-90 80 80)" style={{transition:"stroke-dasharray 0.08s,stroke 0.3s"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:44,lineHeight:1}}>{done?"✓":"👤"}</div>
          <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginTop:6,letterSpacing:"0.1em",color:done?"#06d6a0":"#7ec8e3"}}>
            {done?"VERIFIED":progress<30?"ALIGN FACE":"SCANNING..."}
          </div>
        </div>
      </div>
      <button onClick={onCancel} style={btnGhost}>Cancel</button>
    </div>
  )
}

function PinPad({ onSuccess, onCancel, correctPin, label }) {
  const [entered,setEntered]=useState("")
  const [shake,setShake]=useState(false)
  const [status,setStatus]=useState("idle")
  const press=useCallback(digit=>{
    setEntered(prev=>{
      if(prev.length>=4) return prev
      const next=prev+digit
      if(next.length===4) {
        setTimeout(()=>{
          if(next===correctPin) {
            setStatus("success")
            setTimeout(onSuccess,400)
          } else {
            setStatus("error")
            setShake(true)
            setTimeout(()=>{
              setEntered("")
              setShake(false)
              setStatus("idle")
            },700)
          }
        },80)
      }
      return next
    })
  },[correctPin,onSuccess])
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:11,color:"#6b7a8d",marginBottom:18,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.12em"}}>{label||"ENTER PIN"}</div>
      <div style={{display:"flex",gap:14,justifyContent:"center",marginBottom:26,transform:shake?"translateX(-5px)":"none",transition:"transform 0.08s"}}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{width:14,height:14,borderRadius:"50%",transition:"background 0.15s",
            background:i<entered.length?(status==="success"?"#06d6a0":status==="error"?"#ef476f":"#7ec8e3"):"#1e2a38",
            border:"2px solid " + (i<entered.length?"transparent":"#2a3a4a")}}/>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,maxWidth:210,margin:"0 auto 18px"}}>
        {["1","2","3","4","5","6","7","8","9","","0","X"].map((k,i)=>(
          <button key={i} onClick={()=>{if(k==="X")setEntered(p=>p.slice(0,-1));else if(k)press(k)}} disabled={!k}
            style={{height:54,borderRadius:10,fontSize:18,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",
              background:k?"#131b27":"transparent",border:k?"1px solid #1e2a38":"none",
              color:k?"#e8f4f8":"transparent",cursor:k?"pointer":"default",outline:"none"}}
            onMouseDown={e=>{if(k)e.currentTarget.style.background="#1e2a38"}}
            onMouseUp={e=>{if(k)e.currentTarget.style.background="#131b27"}}>
            {k}
          </button>
        ))}
      </div>
      <button onClick={onCancel} style={btnGhost}>Cancel</button>
    </div>
  )
}

function EmployeeForm({ initial, onSave, onClose, title, saveLabel }) {
  const [form,setForm]=useState(initial?{name:initial.name,workRole:initial.role,baseRate:String(initial.baseRate),bonusRate:String(initial.bonusRate||""),pin:initial.pin,authMethod:initial.authMethod}:{name:"",workRole:"Waterfront",baseRate:"",bonusRate:"",pin:"",authMethod:"pin"})
  const [errors,setErrors]=useState({})
  const f=(k,v)=>setForm(p=>({...p,[k]:v}))
  function validate(){
    const e={}
    if(!form.name.trim()) e.name="Required"
    if(!form.baseRate||isNaN(form.baseRate)||Number(form.baseRate)<=0) e.baseRate="Valid rate required"
    if(form.pin.length!==4||isNaN(form.pin)) e.pin="4-digit PIN required"
    setErrors(e)
    return Object.keys(e).length === 0
  }
  function submit(){
    if(!validate()) return
    const av=form.name.trim().split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)
    onSave({
      id: initial?.id || Date.now(),
      name: form.name.trim(),
      role: form.workRole,
      baseRate: parseFloat(form.baseRate),
      bonusRate: parseFloat(form.bonusRate||0),
      pin: form.pin,
      authMethod: form.authMethod,
      avatar: av
    })
    onClose()
  }
  const base=parseFloat(form.baseRate)||0
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#0f1821",border:"1px solid #1e2a38",borderRadius:16,padding:"26px 26px 22px",width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div><div style={{fontSize:16,fontWeight:700,color:"#e8f4f8"}}>{title}</div><div style={{fontSize:11,color:"#4a6a8a",marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>Rate data is manager only</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>X</button>
        </div>
        <Field label="Full Name" error={errors.name}><input placeholder="e.g. Sam Torres" value={form.name} onChange={e=>f("name",e.target.value)} style={{...inputStyle,border:"1px solid " + (errors.name?"#ef476f":"#1e2a38")}}/></Field>
        <Field label="Work Role"><select value={form.workRole} onChange={e=>f("workRole",e.target.value)} style={{...inputStyle,outline:"none"}}>{WORK_ROLES.map(r=><option key={r}>{r}</option>)}</select></Field>
        <div style={{background:"#0a1520",border:"1px solid #1a3050",borderRadius:10,padding:16,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}><span style={{fontSize:12}}>LOCKED</span><span style={{fontSize:10,color:"#4a8a8a",letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>Compensation Manager Admin Only</span></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={labelStyle}>Base Rate /hr</label><div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#4a6a8a",fontSize:13}}>$</span><input type="number" step="0.25" min="0" placeholder="0.00" value={form.baseRate} onChange={e=>f("baseRate",e.target.value)} style={{...inputStyle,paddingLeft:26,border:"1px solid " + (errors.baseRate?"#ef476f":"#1e2a38")}}/></div>{errors.baseRate&&<div style={{fontSize:11,color:"#ef476f",marginTop:4}}>{errors.baseRate}</div>}</div>
            <div><label style={labelStyle}>OT Rate /hr</label><div style={{background:"#0d1117",border:"1px solid #1e2a38",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:6}}><span style={{color:"#4a6a8a",fontSize:13}}>$</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:base>0?"#f4a261":"#3a4a5a"}}>{base>0?multiply(base, 1.5).toFixed(2):"none"}</span><span style={{fontSize:9,color:"#3a4a5a",marginLeft:"auto"}}>auto 1.5x</span></div></div>
          </div>
          <Field label="Bonus Rate /hr (optional)"><div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#4a6a8a",fontSize:13}}>$</span><input type="number" step="0.25" min="0" placeholder="0.00" value={form.bonusRate} onChange={e=>f("bonusRate",e.target.value)} style={{...inputStyle,paddingLeft:26}}/></div></Field>
        </div>
        <label style={{...labelStyle,display:"block",marginBottom:8}}>Clock In Authentication</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          {[{val:"pin",icon:"NUM",label:"PIN Code",sub:"4 digit"},{val:"face",icon:"FACE",label:"Face ID",sub:"Apple biometric"}].map(opt=>(
            <button key={opt.val} onClick={()=>f("authMethod",opt.val)} style={{padding:"12px",borderRadius:8,cursor:"pointer",textAlign:"center",background:form.authMethod===opt.val?"#0e2030":"#131b27",border:"1px solid " + (form.authMethod===opt.val?"#7ec8e3":"#1e2a38")}}>
              <div style={{fontSize:12,fontWeight:600,color:form.authMethod===opt.val?"#7ec8e3":"#a0b8d0"}}>{opt.label}</div><div style={{fontSize:10,color:"#4a6a8a",marginTop:2}}>{opt.sub}</div>
            </button>
          ))}
        </div>
        <Field label={form.authMethod==="face"?"Backup PIN (required)":"PIN Code"} error={errors.pin}><input type="password" maxLength={4} placeholder="4 digit PIN" value={form.pin} onChange={e=>f("pin",e.target.value.replace(/\D/,"").slice(0,4))} style={{...inputStyle,fontSize:18,letterSpacing:"0.3em",border:"1px solid " + (errors.pin?"#ef476f":"#1e2a38")}}/></Field>
        <div style={{display:"flex",gap:10,marginTop:4}}>
          <button onClick={onClose} style={{flex:1,padding:"12px",background:"none",border:"1px solid #2a3a4a",color:"#6b7a8d",borderRadius:8,cursor:"pointer",fontFamily:"'Bitter',serif",fontSize:13}}>Cancel</button>
          <button onClick={submit} style={{flex:2,padding:"12px",background:"#7ec8e3",border:"none",color:"#0d1117",borderRadius:8,cursor:"pointer",fontFamily:"'Bitter',serif",fontSize:13,fontWeight:700}}>{saveLabel||"Save"}</button>
        </div>
      </div>
    </div>
  )
}

function ManagerLogin({ onSuccess, onCancel }) {
  const [step,setStep]=useState("select")
  const [selected,setSelected]=useState(null)
  if(step==="select") return (
    <div>
      <div style={{fontSize:11,color:"#4a6a8a",letterSpacing:"0.15em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace",marginBottom:16,textAlign:"center"}}>Select Account</div>
      {MANAGER_USERS.map(u=>(
        <button key={u.id} onClick={()=>{setSelected(u);setStep("pin")}}
          style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"14px 18px",background:"#131b27",border:"1px solid #1e2a38",borderRadius:10,cursor:"pointer",marginBottom:10,textAlign:"left"}}
          onMouseEnter={e=>e.currentTarget.style.borderColor="#2a4060"}
          onMouseLeave={e=>e.currentTarget.style.borderColor="#1e2a38"}>
          <div><div style={{fontSize:14,fontWeight:600,color:"#e8f4f8"}}>{u.name}</div><div style={{fontSize:11,color:"#4a6a8a",marginTop:2,textTransform:"capitalize"}}>{u.userRole}</div></div>
        </button>
      ))}
      <button onClick={onCancel} style={{width:"100%",background:"none",border:"none",color:"#4a6a8a",padding:"10px",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>Back to Kiosk</button>
    </div>
  )
  return (
    <div>
      <div style={{textAlign:"center",marginBottom:20}}><div style={{fontSize:14,fontWeight:600,color:"#e8f4f8"}}>{selected?.name}</div></div>
      <PinPad correctPin={selected?.pin} label="MANAGER PIN" onSuccess={()=>onSuccess({userRole:selected.userRole,name:selected.name})} onCancel={()=>setStep("select")}/>
    </div>
  )
}

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
    <div style={{fontFamily:"'Bitter',Georgia,serif",background:"#0d1117",minHeight:"100vh",color:"#e8e8e8",maxWidth:780,margin:"0 auto",paddingBottom:40}}>
      <div style={{padding:"22px 28px 0",borderBottom:"1px solid #1a2535",marginBottom:24}}>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16}}>
          <div><div style={{fontSize:10,color:"#4a6a8a",letterSpacing:"0.2em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>Pine Lake Recreation</div><h1 style={{margin:0,fontSize:22,fontWeight:700,color:"#e8f4f8"}}>Time Clock Kiosk</h1></div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:26,fontWeight:600,color:"#7ec8e3"}}>{now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
            <div style={{fontSize:11,color:"#4a6a8a",marginTop:1}}>{now.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"})}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,paddingBottom:14,alignItems:"center"}}>
          <div style={{fontSize:11,color:"#4a6a8a",fontFamily:"'JetBrains Mono',monospace"}}><span style={{color:"#06d6a0",fontWeight:700}}>{Object.keys(clockedIn).length}</span> clocked in total {employees.length}</div>
          <button onClick={()=>setScreen("manager-login")} style={{marginLeft:"auto",background:"none",border:"1px solid #1e2a38",color:"#4a6a8a",padding:"5px 14px",borderRadius:6,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>Manager</button>
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