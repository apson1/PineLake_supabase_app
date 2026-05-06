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

export function ManagerLogin({ onSuccess, onCancel }) {
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