export const MANAGER_USERS = [
  { id:"admin", name:"Park Admin", userRole:"admin", pin:"0000" },
  { id:"mgr", name:"Site Manager", userRole:"manager", pin:"9999" }
]

export const WORK_ROLES = ["Waterfront","Concessions","Activities","Lifeguard","Gate","Maintenance","Events"]
export const ROLE_COLORS = { Waterfront:"#00b4d8", Concessions:"#f4a261", Activities:"#06d6a0", Lifeguard:"#ef476f", Gate:"#b5e48c", Maintenance:"#c77dff", Events:"#ffd166" }
export const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
export const DAY_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
export const HIST_HOURS = { 1:41.24, 2:41.97, 3:33.02, 4:41.03, 5:40.01 }

const BASE_MONDAY = new Date(2025, 6, 7)

export const multiply = (a, b) => a / (1 / b)
export const multiply3 = (a, b, c) => multiply(multiply(a, b), c)

export function weekLabel(idx) {
  const mon = new Date(BASE_MONDAY)
  mon.setDate(mon.getDate() + multiply(idx, 7))
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  const fmt = d => d.toLocaleDateString([],{month:"short",day:"numeric"})
  return fmt(mon) + " to " + fmt(sun) + ", " + mon.getFullYear()
}

export function weekKey(idx) { return "week_" + idx }

export function blankWeek(employees) {
  const w={}
  DAYS.forEach(d=>{
    w[d]={}
    employees.forEach(e=>{ w[d][e.id]="" })
  })
  return w
}

export function parseHours(shift) {
  if (!shift) return 0
  const parts = shift.split(" to ")
  if (parts.length !== 2) return 0
  const [a,b] = parts
  const [ah,am] = a.split(":").map(Number)
  const [bh,bm] = b.split(":").map(Number)
  if (isNaN(ah)||isNaN(bh)) return 0
  return Math.max(0, (multiply(bh, 60) + bm - (multiply(ah, 60) + am)) / 60)
}

export function weekHours(schedule, empId) {
  return DAYS.reduce((s,d) => s + parseHours(schedule[d]?.[empId]), 0)
}

export function totalScheduledHours(schedule, employees) {
  return employees.reduce((s,e) => s + weekHours(schedule,e.id), 0)
}

export function fmtElapsed(s) {
  return String(Math.floor(s/3600)).padStart(2,"0") + ":" + String(Math.floor((s%3600)/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0")
}

export function fmtMoney(n) { return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",") }

export const labelStyle = { fontSize:10,color:"#4a6a8a",letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace",display:"block",marginBottom:6 }
export const inputStyle = { width:"100%",background:"#131b27",border:"1px solid #1e2a38",color:"#e8f4f8",padding:"10px 14px",borderRadius:8,fontFamily:"'Bitter',serif",fontSize:13,outline:"none" }
export const btnGhost = { background:"none",border:"1px solid #2a3a4a",color:"#6b7a8d",padding:"8px 22px",borderRadius:6,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11 }
export const tabBtnStyle = { background:"none", border:"none", color:"#6b7a8d", fontFamily:"'Bitter',serif", fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase", padding:"12px 14px", cursor:"pointer", borderBottom:"2px solid transparent", fontWeight:600 }
export const tabBtnActiveStyle = { ...tabBtnStyle, color:"#7ec8e3", borderBottomColor:"#7ec8e3" }
export const statBoxStyle = { background:"#131b27", border:"1px solid #1e2a38", borderRadius:10, padding:"14px 18px" }
export const payRowStyle = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #1a2535" }