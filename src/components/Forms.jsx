import { useState } from "react"

export function Field({ label, error, children }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block mb-1.5 text-[10px] text-gray-400 tracking-wider uppercase font-mono">
          {label}
        </label>
      )}
      {children}
      {error && <div className="mt-1 text-[11px] text-[#ef476f] font-mono">{error}</div>}
    </div>
  )
}

export function EmployeeForm({ initial, onSave, onClose, title, saveLabel }) {
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          workRole: initial.role,
          baseRate: String(initial.baseRate || 0),
          bonusRate: String(initial.bonusRate || 0),
          pin: initial.pin,
          authMethod: initial.authMethod || "pin",
          fedTaxRate: String(initial.fedTaxRate ?? 12),
          stateTaxRate: String(initial.stateTaxRate ?? 5.5),
          countyTaxRate: String(initial.countyTaxRate ?? 0),
          ficaTaxRate: String(initial.ficaTaxRate ?? 7.65)
        }
      : {
          name: "",
          workRole: "Waterfront",
          baseRate: "",
          bonusRate: "0",
          pin: "",
          authMethod: "pin",
          fedTaxRate: "12",
          stateTaxRate: "5.5",
          countyTaxRate: "0",
          ficaTaxRate: "7.65"
        }
  )
  
  const [errors, setErrors] = useState({})

  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = "Full name is required"
    if (form.baseRate === "" || isNaN(form.baseRate) || parseFloat(form.baseRate) < 0) {
      e.baseRate = "Valid base hourly rate is required"
    }
    if (form.pin.length !== 4 || isNaN(form.pin)) {
      e.pin = "4-digit PIN required"
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function submit() {
    if (!validate()) return
    const av = form.name
      .trim()
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)

    onSave({
      ...(initial || {}),
      id: initial?.id,
      name: form.name.trim(),
      role: form.workRole,
      baseRate: parseFloat(form.baseRate),
      bonusRate: parseFloat(form.bonusRate || 0),
      pin: form.pin,
      authMethod: form.authMethod,
      avatar: av,
      fedTaxRate: parseFloat(form.fedTaxRate || 0),
      stateTaxRate: parseFloat(form.stateTaxRate || 0),
      countyTaxRate: parseFloat(form.countyTaxRate || 0),
      ficaTaxRate: parseFloat(form.ficaTaxRate || 0)
    })
  }

  const selectRoles = [
    "Park Admin",
    "Site Manager",
    "Waterfront",
    "Concessions",
    "Activities",
    "Lifeguard",
    "Gate",
    "Maintenance",
    "Events"
  ]

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#0f172a] border border-white/5 rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar shadow-2xl">
        <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-2">
          <div className="text-base font-black text-white font-heading">{title}</div>
          <button
            onClick={onClose}
            className="text-gray-400 text-xl hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* Full Name */}
          <Field label="Full Name" error={errors.name}>
            <input
              type="text"
              value={form.name}
              onChange={(e) => f("name", e.target.value)}
              placeholder="e.g. John Doe"
              className={`w-full bg-slate-900 border text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 ${
                errors.name ? "border-[#ef476f]" : "border-slate-800"
              }`}
            />
          </Field>

          {/* Shift Role */}
          <Field label="Shift Role">
            <select
              value={form.workRole}
              onChange={(e) => f("workRole", e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none cursor-pointer"
            >
              {selectRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          {/* Compensation Card */}
          <div className="bg-slate-950 border border-white/5 rounded-2xl p-4">
            <div className="text-[9px] text-gray-500 tracking-widest uppercase font-mono mb-3">
              Compensation ($ / hour)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base Rate" error={errors.baseRate}>
                <input
                  type="number"
                  step="0.25"
                  value={form.baseRate}
                  onChange={(e) => f("baseRate", e.target.value)}
                  placeholder="0.00"
                  className={`w-full bg-slate-900 border text-xs text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 ${
                    errors.baseRate ? "border-[#ef476f]" : "border-slate-800"
                  }`}
                />
              </Field>
              <Field label="Role Bonus">
                <input
                  type="number"
                  step="0.25"
                  value={form.bonusRate}
                  onChange={(e) => f("bonusRate", e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none"
                />
              </Field>
            </div>
          </div>

          {/* Taxes Rates Card */}
          <div className="bg-slate-950 border border-white/5 rounded-2xl p-4">
            <div className="text-[9px] text-gray-500 tracking-widest uppercase font-mono mb-3">
              Tax Withholding Rates (%)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Federal Tax">
                <input
                  type="number"
                  step="0.1"
                  value={form.fedTaxRate}
                  onChange={(e) => f("fedTaxRate", e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none"
                />
              </Field>
              <Field label="State Tax">
                <input
                  type="number"
                  step="0.1"
                  value={form.stateTaxRate}
                  onChange={(e) => f("stateTaxRate", e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none"
                />
              </Field>
              <Field label="County Tax">
                <input
                  type="number"
                  step="0.1"
                  value={form.countyTaxRate}
                  onChange={(e) => f("countyTaxRate", e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none"
                />
              </Field>
              <Field label="FICA">
                <input
                  type="number"
                  step="0.1"
                  value={form.ficaTaxRate}
                  onChange={(e) => f("ficaTaxRate", e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded-xl p-3 focus:outline-none"
                />
              </Field>
            </div>
          </div>

          {/* Auth Method */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-gray-400 tracking-wider uppercase font-mono">
              Clock-In Authorization Method
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => f("authMethod", "pin")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  form.authMethod === "pin"
                    ? "bg-[#7ec8e3]/10 border border-[#7ec8e3] text-[#7ec8e3]"
                    : "bg-slate-900 border border-slate-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                PIN
              </button>
              <button
                type="button"
                onClick={() => f("authMethod", "face")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  form.authMethod === "face"
                    ? "bg-[#7ec8e3]/10 border border-[#7ec8e3] text-[#7ec8e3]"
                    : "bg-slate-900 border border-slate-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                Face ID
              </button>
            </div>
          </div>

          {/* PIN input */}
          <Field label="4-Digit Numerical PIN" error={errors.pin}>
            <input
              type="password"
              maxLength={4}
              value={form.pin}
              onChange={(e) => f("pin", e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              className={`w-full bg-slate-900 border text-center font-mono tracking-[0.7em] text-base text-white rounded-xl p-3 focus:outline-none focus:border-[#7ec8e3]/80 ${
                errors.pin ? "border-[#ef476f]" : "border-slate-800"
              }`}
            />
          </Field>
        </div>

        {/* Form Actions */}
        <div className="flex gap-3 mt-8 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 border border-slate-800 text-gray-400 hover:text-white hover:bg-slate-900 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={submit}
            className="flex-[2] py-3 bg-[#06d6a0] text-[#070a13] hover:bg-[#05b586] rounded-xl text-xs font-black tracking-wider transition-colors cursor-pointer"
          >
            {saveLabel || (initial ? "SAVE CHANGES" : "ADD TO ROSTER")}
          </button>
        </div>
      </div>
    </div>
  )
}