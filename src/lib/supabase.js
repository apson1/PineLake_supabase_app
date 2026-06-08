import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Verify if credentials exist. If not, fallback to a robust mock client.
const isMockMode = !supabaseUrl || !supabaseKey

// -------------------------------------------------------------
// LOCALSTORAGE MOCK DATABASE INITIALIZER
// -------------------------------------------------------------
const defaultEmployees = [
  { id: 1, name: "Park Admin", role: "Park Admin", base_rate: 25.0, bonus_rate: 0.0, pin: "0000", auth_method: "pin", avatar: "PA", fed_tax_rate: 12.0, state_tax_rate: 5.5, county_tax_rate: 0.0, fica_tax_rate: 7.65, auth_id: "mock-admin-uid" },
  { id: 2, name: "Site Manager", role: "Site Manager", base_rate: 20.0, bonus_rate: 0.0, pin: "9999", auth_method: "pin", avatar: "SM", fed_tax_rate: 12.0, state_tax_rate: 5.5, county_tax_rate: 0.0, fica_tax_rate: 7.65, auth_id: "mock-mgr-uid" },
  { id: 3, name: "John Waterfront", role: "Waterfront", base_rate: 14.5, bonus_rate: 1.5, pin: "1111", auth_method: "pin", avatar: "JW", fed_tax_rate: 10.0, state_tax_rate: 5.0, county_tax_rate: 0.5, fica_tax_rate: 7.65 },
  { id: 4, name: "Sarah Concessions", role: "Concessions", base_rate: 13.0, bonus_rate: 0.0, pin: "2222", auth_method: "face", avatar: "SC", fed_tax_rate: 10.0, state_tax_rate: 5.0, county_tax_rate: 0.5, fica_tax_rate: 7.65 },
  { id: 5, name: "Mike Lifeguard", role: "Lifeguard", base_rate: 16.0, bonus_rate: 2.0, pin: "3333", auth_method: "pin", avatar: "ML", fed_tax_rate: 12.0, state_tax_rate: 5.5, county_tax_rate: 0.0, fica_tax_rate: 7.65 },
  { id: 6, name: "Emma Gate", role: "Gate", base_rate: 12.5, bonus_rate: 0.0, pin: "4444", auth_method: "pin", avatar: "EG", fed_tax_rate: 8.0, state_tax_rate: 4.5, county_tax_rate: 0.0, fica_tax_rate: 7.65 }
]

function getSundayKey(dateStr) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

const activeWeekKey = getSundayKey(new Date().toISOString().split('T')[0])

const defaultSchedules = [
  { week_key: activeWeekKey, day: "Monday", employee_id: 3, shift_time: "09:00-17:00|Waterfront", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Tuesday", employee_id: 3, shift_time: "09:00-17:00|Waterfront", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Wednesday", employee_id: 3, shift_time: "09:00-17:00|Waterfront", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Thursday", employee_id: 3, shift_time: "09:00-17:00|Waterfront", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Friday", employee_id: 3, shift_time: "09:00-17:00|Waterfront", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Saturday", employee_id: 5, shift_time: "10:00-18:00|Lifeguard", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Sunday", employee_id: 5, shift_time: "10:00-18:00|Lifeguard", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Monday", employee_id: 4, shift_time: "09:00-15:00|Concessions", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Wednesday", employee_id: 4, shift_time: "09:00-15:00|Concessions", version_ts: 1717800000000 },
  { week_key: activeWeekKey, day: "Friday", employee_id: 4, shift_time: "09:00-15:00|Concessions", version_ts: 1717800000000 }
]

const defaultStations = [
  { id: 1, name: "Waterfront Dock A", latitude: 40.650318, longitude: -85.024517, radius: 50 },
  { id: 2, name: "Main Gate", latitude: 40.651520, longitude: -85.025530, radius: 30 },
  { id: 3, name: "Concessions Stand", latitude: 40.649210, longitude: -85.023810, radius: 40 }
]

const defaultLogs = [
  { id: 101, employee_id: 3, action: "IN", created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), photo_base64: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23111827'/><circle cx='50' cy='40' r='18' fill='%2300b4d8'/><path d='M20,85 C20,68 80,68 80,85' fill='%2300b4d8'/><text x='50' y='92' font-family='monospace' font-size='8' fill='%234b5563' text-anchor='middle'>AUDIT PASS</text></svg>" },
  { id: 102, employee_id: 3, action: "BREAK_START", created_at: new Date(Date.now() - 2.5 * 3600 * 1000).toISOString(), photo_base64: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23111827'/><circle cx='50' cy='40' r='18' fill='%2300b4d8'/><path d='M20,85 C20,68 80,68 80,85' fill='%2300b4d8'/><text x='50' y='92' font-family='monospace' font-size='8' fill='%234b5563' text-anchor='middle'>AUDIT PASS</text></svg>" },
  { id: 103, employee_id: 3, action: "BREAK_END", created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), photo_base64: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23111827'/><circle cx='50' cy='40' r='18' fill='%2300b4d8'/><path d='M20,85 C20,68 80,68 80,85' fill='%2300b4d8'/><text x='50' y='92' font-family='monospace' font-size='8' fill='%234b5563' text-anchor='middle'>AUDIT PASS</text></svg>" }
]

if (isMockMode) {
  if (!localStorage.getItem("pinelake_employees")) {
    localStorage.setItem("pinelake_employees", JSON.stringify(defaultEmployees))
  }
  if (!localStorage.getItem("pinelake_schedules")) {
    localStorage.setItem("pinelake_schedules", JSON.stringify(defaultSchedules))
  }
  if (!localStorage.getItem("pinelake_stations")) {
    localStorage.setItem("pinelake_stations", JSON.stringify(defaultStations))
  }
  if (!localStorage.getItem("pinelake_clock_logs")) {
    localStorage.setItem("pinelake_clock_logs", JSON.stringify(defaultLogs))
  }
  if (!localStorage.getItem("pinelake_payroll_history")) {
    localStorage.setItem("pinelake_payroll_history", JSON.stringify([]))
  }
  if (!localStorage.getItem("pinelake_announcements")) {
    const defaultAnnouncements = [
      { id: 1, text: "Waterfront team meeting at 5 PM today near Dock A. Please be on time!", created_at: new Date().toISOString() },
      { id: 2, text: "High UV index forecast today. Wear sunscreen and stay hydrated! ☀️", created_at: new Date().toISOString() }
    ]
    localStorage.setItem("pinelake_announcements", JSON.stringify(defaultAnnouncements))
  }
}

// -------------------------------------------------------------
// MOCK SUPABASE CLIENT CLASS
// -------------------------------------------------------------
class MockSupabaseClient {
  constructor() {
    this.listeners = []
    
    this.auth = {
      user: null,
      
      signInWithPassword: async ({ email, password }) => {
        // Mock login
        // Managers: admin / mgr
        const emps = JSON.parse(localStorage.getItem("pinelake_employees") || "[]")
        
        // Employee quick pin clocks use email format: emp_<id>@pinelake.internal
        const isInternalClock = email.startsWith("emp_")
        if (isInternalClock) {
          const match = email.match(/emp_(\d+)@pinelake.internal/)
          if (match) {
            const id = parseInt(match[1], 10)
            const emp = emps.find(e => e.id === id)
            if (emp && emp.pin === password) {
              const user = { id: emp.auth_id || `mock-user-${emp.id}`, email }
              return { data: { user, session: { access_token: "mock-jwt" } }, error: null }
            }
          }
          return { data: { user: null, session: null }, error: { message: "Invalid PIN code." } }
        }
        
        // Remote Manager Login
        const mgrRoles = ["Site Manager", "Park Admin", "Manager"]
        const emp = emps.find(e => e.name.toLowerCase().replace(" ", "") === email.split("@")[0].toLowerCase() || e.role.toLowerCase() === email.split("@")[0].replace("_", " "))
        
        // General email fallback: admin@pinelake.com (pin 0000) or manager@pinelake.com (pin 9999)
        if (email === "admin@pinelake.com" && password === "0000") {
          const user = { id: "mock-admin-uid", email }
          this.auth.user = user
          this.triggerAuthStateChange("SIGNED_IN", { user, access_token: "mock" })
          return { data: { user, session: { access_token: "mock-jwt" } }, error: null }
        }
        if (email === "manager@pinelake.com" && password === "9999") {
          const user = { id: "mock-mgr-uid", email }
          this.auth.user = user
          this.triggerAuthStateChange("SIGNED_IN", { user, access_token: "mock" })
          return { data: { user, session: { access_token: "mock-jwt" } }, error: null }
        }
        
        // Match specific employee credential
        if (emp && mgrRoles.includes(emp.role) && emp.pin === password) {
          const user = { id: emp.auth_id || `mock-uid-${emp.id}`, email }
          this.auth.user = user
          this.triggerAuthStateChange("SIGNED_IN", { user, access_token: "mock" })
          return { data: { user, session: { access_token: "mock-jwt" } }, error: null }
        }
        
        return { data: { user: null, session: null }, error: { message: "Invalid credentials." } }
      },
      
      signOut: async () => {
        this.auth.user = null
        this.triggerAuthStateChange("SIGNED_OUT", null)
        return { error: null }
      },
      
      onAuthStateChange: (callback) => {
        const id = Math.random().toString(36).substring(2)
        this.listeners.push({ id, callback })
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                this.listeners = this.listeners.filter(l => l.id !== id)
              }
            }
          }
        }
      },
      
      updateUser: async ({ password }) => {
        // Simple update PIN for logged-in user
        return { error: null }
      }
    }
  }

  triggerAuthStateChange(event, session) {
    this.listeners.forEach(l => l.callback(event, session))
  }

  from(table) {
    const lsKey = `pinelake_${table}`
    let rawData = JSON.parse(localStorage.getItem(lsKey) || "[]")
    if (table === "stations" && rawData.length === 0) {
      rawData = defaultStations
      localStorage.setItem(lsKey, JSON.stringify(defaultStations))
    }
    if (table === "schedules") {
      rawData = rawData.map(s => ({ version_ts: 1717800000000, ...s }))
    }
    
    // Create query builder chain
    const builder = {
      data: rawData,
      filters: [],
      sortField: null,
      sortAsc: true,
      isSingle: false,

      select: function(fields = "*") {
        return this
      },

      eq: function(field, val) {
        this.filters.push(row => row[field] === val)
        return this
      },

      order: function(field, options = { ascending: true }) {
        this.sortField = field
        this.sortAsc = options.ascending ?? true
        return this
      },

      single: function() {
        this.isSingle = true
        return this
      },

      // Executing queries
      then: function(resolve) {
        let result = [...this.data]
        
        // Apply filters
        this.filters.forEach(filterFn => {
          result = result.filter(filterFn)
        })
        
        // Apply sorting
        if (this.sortField) {
          result.sort((a, b) => {
            let valA = a[this.sortField]
            let valB = b[this.sortField]
            if (typeof valA === "string") {
              return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
            }
            return this.sortAsc ? valA - valB : valB - valA
          })
        }
        
        // Single row
        if (this.isSingle) {
          resolve({ data: result.length > 0 ? result[0] : null, error: null })
        } else {
          resolve({ data: result, error: null })
        }
      },

      insert: function(records) {
        const payload = Array.isArray(records) ? records : [records]
        const currentData = JSON.parse(localStorage.getItem(lsKey) || "[]")
        
        const newRecords = payload.map(rec => ({
          id: rec.id || Math.floor(Math.random() * 1000000),
          created_at: rec.created_at || new Date().toISOString(),
          ...rec
        }))
        
        const updated = [...newRecords, ...currentData]
        localStorage.setItem(lsKey, JSON.stringify(updated))
        
        // Trigger simulated realtime event
        mockRealtimeChannel.triggerChange("INSERT", table, newRecords[0])

        return {
          then: (resolve) => resolve({ data: newRecords, error: null })
        }
      },

      update: function(updates) {
        return {
          eq: (field, val) => {
            const currentData = JSON.parse(localStorage.getItem(lsKey) || "[]")
            let updatedRecord = null
            
            const updated = currentData.map(row => {
              if (row[field] === val) {
                updatedRecord = { ...row, ...updates }
                return updatedRecord
              }
              return row
            })
            
            localStorage.setItem(lsKey, JSON.stringify(updated))
            if (updatedRecord) {
              mockRealtimeChannel.triggerChange("UPDATE", table, updatedRecord)
            }
            return {
              then: (resolve) => resolve({ data: updatedRecord ? [updatedRecord] : [], error: null })
            }
          }
        }
      },

      delete: function() {
        return {
          eq: (field, val) => {
            const currentData = JSON.parse(localStorage.getItem(lsKey) || "[]")
            const filtered = currentData.filter(row => row[field] !== val)
            localStorage.setItem(lsKey, JSON.stringify(filtered))
            return {
              then: (resolve) => resolve({ data: null, error: null })
            }
          }
        }
      },

      upsert: function(records, options = {}) {
        const payload = Array.isArray(records) ? records : [records]
        const currentData = JSON.parse(localStorage.getItem(lsKey) || "[]")
        
        const updated = [...currentData]
        payload.forEach(rec => {
          // Check for conflicts: in schedules conflict is on week_key,day,employee_id
          let index = -1
          if (table === "schedules") {
            index = updated.findIndex(row => row.week_key === rec.week_key && row.day === rec.day && row.employee_id === rec.employee_id)
          } else {
            index = updated.findIndex(row => row.id === rec.id)
          }

          if (index > -1) {
            updated[index] = { ...updated[index], ...rec }
          } else {
            updated.push({
              id: rec.id || Math.floor(Math.random() * 1000000),
              created_at: rec.created_at || new Date().toISOString(),
              ...rec
            })
          }
        })
        
        localStorage.setItem(lsKey, JSON.stringify(updated))
        return {
          then: (resolve) => resolve({ data: updated, error: null })
        }
      }
    }
    
    return builder
  }

  channel(name) {
    return mockRealtimeChannel
  }

  removeChannel(channel) {
    mockRealtimeChannel.unsubscribe()
  }
}

// -------------------------------------------------------------
// MOCK REALTIME CHANNEL SIMULATOR
// -------------------------------------------------------------
class MockRealtimeChannel {
  constructor() {
    this.callbacks = []
  }

  on(event, filter, callback) {
    this.callbacks.push({ event, filter, callback })
    return this
  }

  subscribe() {
    return this
  }

  unsubscribe() {
    this.callbacks = []
  }

  triggerChange(event, table, record) {
    this.callbacks.forEach(cb => {
      if (cb.filter.table === table) {
        cb.callback({
          new: record,
          old: {}
        })
      }
    })
  }
}

const mockRealtimeChannel = new MockRealtimeChannel()

// Export the active client instance
export const supabase = isMockMode ? new MockSupabaseClient() : createClient(supabaseUrl, supabaseKey)
export const IS_MOCK_DATABASE = isMockMode
export const MOCK_ADMIN_EMAIL = "admin@pinelake.com"
export const MOCK_MGR_EMAIL = "manager@pinelake.com"