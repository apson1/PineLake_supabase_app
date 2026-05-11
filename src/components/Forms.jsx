import { useState, useEffect, useCallback } from "react"
import { labelStyle, inputStyle, btnGhost, multiply, multiply3, WORK_ROLES, MANAGER_USERS } from "../lib/utils"

export function Field({ label, error, children }) {
  return (
    <div className="mb-4">
      {label && <label className="block mb-1.5 text-[10px] text-slate-400 tracking-[0.12em] uppercase font-mono">{label}</label>}
      {children}
      {error && <div className="mt-1 text-[11px] text-rose-500">{error}</div>}
    </div>
  )
}

export function FaceScanUI({ onSuccess, onCancel }) {
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

export function PinPad({ onSuccess, onCancel, correctPin, label }) {
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

export function EmployeeForm({ initial, onSave, onClose, title, saveLabel }) {
  const [form, setForm] = useState(initial ? {
    name: initial.name, workRole: initial.role, baseRate: String(initial.baseRate),
    bonusRate: String(initial.bonusRate || ""), pin: initial.pin, authMethod: initial.authMethod,
    fedTaxRate: String(initial.fedTaxRate ?? 12), stateTaxRate: String(initial.stateTaxRate ?? 5.5),
    countyTaxRate: String(initial.countyTaxRate ?? 0), ficaTaxRate: String(initial.ficaTaxRate ?? 7.65)
  } : {
    name: "", workRole: "Waterfront", baseRate: "", bonusRate: "", pin: "", authMethod: "pin",
    fedTaxRate: "12", stateTaxRate: "5.5", countyTaxRate: "0", ficaTaxRate: "7.65"
  })
  const [errors, setErrors] = useState({})
  
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  
  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = "Required"
    if (!form.baseRate || isNaN(form.baseRate) || +form.baseRate <= 0) e.baseRate = "Valid rate required"
    if (form.pin.length !== 4 || isNaN(form.pin)) e.pin = "4-digit PIN required"
    setErrors(e)
    return !Object.keys(e).length
  }
  
  function submit() {
    if (!validate()) return
    const av = form.name.trim().split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    onSave({
      ...(initial || {}), id: initial?.id || Date.now(), name: form.name.trim(), role: form.workRole,
      baseRate: parseFloat(form.baseRate), 
      bonusRate: parseFloat(form.bonusRate || 0),
      pin: form.pin, authMethod: form.authMethod, avatar: av,
      fedTaxRate: parseFloat(form.fedTaxRate || 0), 
      stateTaxRate: parseFloat(form.stateTaxRate || 0),
      countyTaxRate: parseFloat(form.countyTaxRate || 0), 
      ficaTaxRate: parseFloat(form.ficaTaxRate || 0)
    })
  }

  const inputStyle = { width: "100%", background: "#131b27", border: "1px solid #1e2a38", color: "#e8f4f8", padding: "10px 14px", borderRadius: 8, fontFamily: "'Bitter',serif", fontSize: 13, outline: "none" }
  const labelStyle = { fontSize: 10, color: "#4a6a8a", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", display: "block", mb: 6 }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0f1821] border border-[#1e2a38] rounded-2xl p-6 w-full max-w-[440px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <div className="text-[16px] font-bold text-[#e8f4f8]">{title}</div>
          <button onClick={onClose} className="text-[#4a6a8a] text-[20px] hover:text-[#e8f4f8]">✕</button>
        </div>
        
        <div className="mb-4">
          <label style={labelStyle}>Full Name</label>
          <input value={form.name} onChange={e=>f("name",e.target.value)} style={inputStyle} className={errors.name ? "border-[#ef476f]" : ""} />
        </div>

        <div className="mb-4">
          <label style={labelStyle}>Shift Role</label>
          <select value={form.workRole} onChange={e=>f("workRole",e.target.value)} style={inputStyle}>
            {["Park Admin", "Site Manager", "Waterfront", "Concessions", "Activities", "Lifeguard", "Gate", "Maintenance", "Events"].map(r=><option key={r}>{r}</option>)}
          </select>
        </div>

        <div className="bg-[#0a1520] border border-[#1a3050] rounded-xl p-4 mb-4">
          <div className="text-[10px] text-[#4a8a8a] tracking-widest uppercase font-mono mb-3">Compensation</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label style={labelStyle}>Base Rate /hr</label>
              <input type="number" step="0.25" value={form.baseRate} onChange={e=>f("baseRate",e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Bonus /hr</label>
              <input type="number" step="0.25" value={form.bonusRate} onChange={e=>f("bonusRate",e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        <div className="bg-[#0a1520] border border-[#1a3050] rounded-xl p-4 mb-4">
          <div className="text-[10px] text-[#4a8a8a] tracking-widest uppercase font-mono mb-3">Tax Withholding Rates (%)</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label style={labelStyle}>Fed Tax</label><input type="number" step="0.1" value={form.fedTaxRate} onChange={e=>f("fedTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>State Tax</label><input type="number" step="0.1" value={form.stateTaxRate} onChange={e=>f("stateTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>County Tax</label><input type="number" step="0.1" value={form.countyTaxRate} onChange={e=>f("countyTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>FICA</label><input type="number" step="0.1" value={form.ficaTaxRate} onChange={e=>f("ficaTaxRate",e.target.value)} style={inputStyle}/></div>
          </div>
        </div>

        <div className="mb-4">
          <label style={labelStyle}>Clock-In Auth Method</label>
          <div className="flex gap-2">
            <button onClick={()=>f("authMethod","pin")} className={`flex-1 py-2 rounded-lg text-[12px] font-bold ${form.authMethod==="pin" ? "bg-[#1e2a38] text-[#7ec8e3]" : "bg-[#131b27] text-[#4a6a8a]"}`}>PIN</button>
            <button onClick={()=>f("authMethod","face")} className={`flex-1 py-2 rounded-lg text-[12px] font-bold ${form.authMethod==="face" ? "bg-[#1e2a38] text-[#7ec8e3]" : "bg-[#131b27] text-[#4a6a8a]"}`}>Face ID</button>
          </div>
        </div>

        <div className="mb-6">
          <label style={labelStyle}>4-Digit PIN</label>
          <input type="password" maxLength={4} value={form.pin} onChange={e=>f("pin",e.target.value.replace(/\D/,"").slice(0,4))} style={inputStyle} className={`text-center tracking-[0.5em] text-[18px] ${errors.pin ? "border-[#ef476f]" : ""}`} />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border border-[#2a4060] text-[#7ec8e3] hover:bg-[#1a2535] rounded-lg text-[13px] font-bold transition-colors">Cancel</button>
          <button onClick={submit} className="flex-[2] py-3 bg-[#06d6a0] hover:bg-[#05b586] text-[#0d1117] rounded-lg text-[13px] font-bold transition-colors">
            {saveLabel || (initial ? "SAVE CHANGES" : "ADD TO ROSTER")}
          </button>
        </div>
      </div>
    </div>
  )
}export function EmployeeForm({ initial, onSave, onClose, title, saveLabel }) {
  const [form, setForm] = useState(initial ? {
    name: initial.name, workRole: initial.role, baseRate: String(initial.baseRate || 0),
    bonusRate: String(initial.bonusRate || 0), pin: initial.pin, authMethod: initial.authMethod,
    fedTaxRate: String(initial.fedTaxRate ?? 12), stateTaxRate: String(initial.stateTaxRate ?? 5.5),
    countyTaxRate: String(initial.countyTaxRate ?? 0), ficaTaxRate: String(initial.ficaTaxRate ?? 7.65)
  } : {
    name: "", workRole: "Waterfront", baseRate: "", bonusRate: "", pin: "", authMethod: "pin",
    fedTaxRate: "12", stateTaxRate: "5.5", countyTaxRate: "0", ficaTaxRate: "7.65"
  })
  const [errors, setErrors] = useState({})
  
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  
  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = "Required"
    if (form.baseRate === "" || isNaN(form.baseRate) || +form.baseRate < 0) e.baseRate = "Valid rate required"
    if (form.pin.length !== 4 || isNaN(form.pin)) e.pin = "4-digit PIN required"
    setErrors(e)
    return !Object.keys(e).length
  }
  
  function submit() {
    if (!validate()) return
    const av = form.name.trim().split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    onSave({
      ...(initial || {}), id: initial?.id, name: form.name.trim(), role: form.workRole,
      baseRate: parseFloat(form.baseRate), 
      bonusRate: parseFloat(form.bonusRate || 0),
      pin: form.pin, authMethod: form.authMethod, avatar: av,
      fedTaxRate: parseFloat(form.fedTaxRate || 0), 
      stateTaxRate: parseFloat(form.stateTaxRate || 0),
      countyTaxRate: parseFloat(form.countyTaxRate || 0), 
      ficaTaxRate: parseFloat(form.ficaTaxRate || 0)
    })
  }

  const inputStyle = { width: "100%", background: "#131b27", border: "1px solid #1e2a38", color: "#e8f4f8", padding: "10px 14px", borderRadius: 8, fontFamily: "'Bitter',serif", fontSize: 13, outline: "none" }
  const labelStyle = { fontSize: 10, color: "#4a6a8a", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", display: "block", marginBottom: 6 }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0f1821] border border-[#1e2a38] rounded-2xl p-6 w-full max-w-[440px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <div className="text-[16px] font-bold text-[#e8f4f8]">{title}</div>
          <button onClick={onClose} className="text-[#4a6a8a] text-[20px] hover:text-[#e8f4f8]">✕</button>
        </div>
        
        <div className="mb-4">
          <label style={labelStyle}>Full Name</label>
          <input value={form.name} onChange={e=>f("name",e.target.value)} style={inputStyle} className={errors.name ? "border-[#ef476f]" : ""} />
        </div>

        <div className="mb-4">
          <label style={labelStyle}>Shift Role</label>
          <select value={form.workRole} onChange={e=>f("workRole",e.target.value)} style={inputStyle}>
            {["Park Admin", "Site Manager", "Waterfront", "Concessions", "Activities", "Lifeguard", "Gate", "Maintenance", "Events"].map(r=><option key={r}>{r}</option>)}
          </select>
        </div>

        <div className="bg-[#0a1520] border border-[#1a3050] rounded-xl p-4 mb-4">
          <div className="text-[10px] text-[#4a8a8a] tracking-widest uppercase font-mono mb-3">Compensation</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label style={labelStyle}>Base Rate /hr</label>
              <input type="number" step="0.25" value={form.baseRate} onChange={e=>f("baseRate",e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Bonus /hr</label>
              <input type="number" step="0.25" value={form.bonusRate} onChange={e=>f("bonusRate",e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        <div className="bg-[#0a1520] border border-[#1a3050] rounded-xl p-4 mb-4">
          <div className="text-[10px] text-[#4a8a8a] tracking-widest uppercase font-mono mb-3">Tax Withholding Rates (%)</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label style={labelStyle}>Fed Tax</label><input type="number" step="0.1" value={form.fedTaxRate} onChange={e=>f("fedTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>State Tax</label><input type="number" step="0.1" value={form.stateTaxRate} onChange={e=>f("stateTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>County Tax</label><input type="number" step="0.1" value={form.countyTaxRate} onChange={e=>f("countyTaxRate",e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>FICA</label><input type="number" step="0.1" value={form.ficaTaxRate} onChange={e=>f("ficaTaxRate",e.target.value)} style={inputStyle}/></div>
          </div>
        </div>

        <div className="mb-4">
          <label style={labelStyle}>Clock-In Auth Method</label>
          <div className="flex gap-2">
            <button onClick={()=>f("authMethod","pin")} className={`flex-1 py-2 rounded-lg text-[12px] font-bold ${form.authMethod==="pin" ? "bg-[#1e2a38] text-[#7ec8e3]" : "bg-[#131b27] text-[#4a6a8a]"}`}>PIN</button>
            <button onClick={()=>f("authMethod","face")} className={`flex-1 py-2 rounded-lg text-[12px] font-bold ${form.authMethod==="face" ? "bg-[#1e2a38] text-[#7ec8e3]" : "bg-[#131b27] text-[#4a6a8a]"}`}>Face ID</button>
          </div>
        </div>

        <div className="mb-6">
          <label style={labelStyle}>4-Digit PIN</label>
          <input type="password" maxLength={4} value={form.pin} onChange={e=>f("pin",e.target.value.replace(/\D/,"").slice(0,4))} style={inputStyle} className={`text-center tracking-[0.5em] text-[18px] ${errors.pin ? "border-[#ef476f]" : ""}`} />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border border-[#2a4060] text-[#7ec8e3] hover:bg-[#1a2535] rounded-lg text-[13px] font-bold transition-colors">Cancel</button>
          <button onClick={submit} className="flex-[2] py-3 bg-[#06d6a0] text-[#0d1117] rounded-lg text-[13px] font-bold hover:bg-[#05b586] transition-colors">
            {saveLabel || (initial ? "SAVE CHANGES" : "ADD TO ROSTER")}
          </button>
        </div>
      </div>
    </div>
  )
}