import { IS_MOCK_DATABASE } from "./supabase"

/**
 * Caches employees list locally in LocalStorage
 */
export function cacheEmployees(employees) {
  if (Array.isArray(employees)) {
    localStorage.setItem("pinelake_cached_employees", JSON.stringify(employees))
  }
}

/**
 * Caches schedules list locally in LocalStorage
 */
export function cacheSchedules(schedules) {
  if (schedules && typeof schedules === "object") {
    localStorage.setItem("pinelake_cached_schedules", JSON.stringify(schedules))
  }
}

/**
 * Gets cached employees or returns an empty array
 */
export function getCachedEmployees() {
  const data = localStorage.getItem("pinelake_cached_employees")
  return data ? JSON.parse(data) : []
}

/**
 * Gets cached schedules or returns an empty object
 */
export function getCachedSchedules() {
  const data = localStorage.getItem("pinelake_cached_schedules")
  return data ? JSON.parse(data) : {}
}

/**
 * Queues a clock punch offline with the exact current timestamp
 */
export function queueOfflinePunch(employeeId, action) {
  const punch = {
    id: Math.floor(Math.random() * 1000000) + "_" + Date.now(),
    employee_id: employeeId,
    action: action,
    created_at: new Date().toISOString()
  }

  const queue = JSON.parse(localStorage.getItem("pinelake_offline_queue") || "[]")
  queue.push(punch)
  localStorage.setItem("pinelake_offline_queue", JSON.stringify(queue))

  console.log(`[OfflineSync] Queued punch offline: ${action} for employee ${employeeId}`)
  
  // Dispatch a custom event to notify components of queue change
  window.dispatchEvent(new CustomEvent("offline-queue-changed", { detail: queue }))
  
  return punch
}

/**
 * Gets the length of the offline punch queue
 */
export function getOfflineQueueLength() {
  const queue = JSON.parse(localStorage.getItem("pinelake_offline_queue") || "[]")
  return queue.length
}

/**
 * Synchronizes queued offline punches to Supabase
 */
export async function syncOfflinePunches(supabaseClient) {
  if (IS_MOCK_DATABASE) {
    // In mock mode, the mock database uses LocalStorage directly, so there's no remote server.
    // Clean queue if any exists
    localStorage.removeItem("pinelake_offline_queue")
    return { success: true, count: 0 }
  }

  const queue = JSON.parse(localStorage.getItem("pinelake_offline_queue") || "[]")
  if (queue.length === 0) return { success: true, count: 0 }

  console.log(`[OfflineSync] Starting synchronization of ${queue.length} punches...`)
  let syncCount = 0
  const failedPunches = []

  for (const punch of queue) {
    try {
      const { error } = await supabaseClient.from("clock_logs").insert([{
        employee_id: punch.employee_id,
        action: punch.action,
        created_at: punch.created_at
      }])
      
      if (error) {
        console.error(`[OfflineSync] Failed to sync punch ${punch.id}:`, error.message)
        failedPunches.push(punch)
      } else {
        syncCount++
        console.log(`[OfflineSync] Successfully synced punch: ${punch.action} at ${punch.created_at}`)
      }
    } catch (err) {
      console.error(`[OfflineSync] Connection error during sync of punch ${punch.id}:`, err)
      failedPunches.push(punch)
    }
  }

  // Update queue with only the failed punches
  localStorage.setItem("pinelake_offline_queue", JSON.stringify(failedPunches))
  window.dispatchEvent(new CustomEvent("offline-queue-changed", { detail: failedPunches }))

  return {
    success: failedPunches.length === 0,
    count: syncCount,
    remaining: failedPunches.length
  }
}
