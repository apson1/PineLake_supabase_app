/**
 * Imperative toast + confirm/prompt store.
 *
 * Usage (works from any module, not just React components):
 *   import { toast, confirmDialog, promptDialog } from "../lib/notify"
 *   toast.success("Saved!")
 *   if (await confirmDialog({ title: "Delete?", message: "...", danger: true })) { ... }
 *   const pin = await promptDialog({ title: "New PIN", password: true })
 *
 * The matching <NotificationHost /> component (src/components/NotificationHost.jsx)
 * subscribes to this store and renders the UI. Mount it once near the app root.
 */

let nextId = 1
const listeners = new Set()
let state = { toasts: [], dialog: null }

function emit() {
  for (const l of listeners) l(state)
}

export function subscribe(fn) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

export function getState() {
  return state
}

// ---- Toasts ----------------------------------------------------------------

function pushToast(type, message, opts = {}) {
  const id = nextId++
  const item = { id, type, message, duration: opts.duration ?? 4000 }
  state = { ...state, toasts: [...state.toasts, item] }
  emit()
  if (item.duration > 0) {
    setTimeout(() => dismissToast(id), item.duration)
  }
  return id
}

export function dismissToast(id) {
  state = { ...state, toasts: state.toasts.filter((t) => t.id !== id) }
  emit()
}

export const toast = {
  success: (m, o) => pushToast("success", m, o),
  error: (m, o) => pushToast("error", m, o),
  info: (m, o) => pushToast("info", m, o),
  warning: (m, o) => pushToast("warning", m, o),
}

// ---- Confirm / Prompt dialogs ---------------------------------------------

export function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    state = {
      ...state,
      dialog: {
        kind: "confirm",
        title: opts.title || "Are you sure?",
        message: opts.message || "",
        confirmText: opts.confirmText || "Confirm",
        cancelText: opts.cancelText || "Cancel",
        danger: !!opts.danger,
        resolve,
      },
    }
    emit()
  })
}

export function promptDialog(opts = {}) {
  return new Promise((resolve) => {
    state = {
      ...state,
      dialog: {
        kind: "prompt",
        title: opts.title || "Enter a value",
        message: opts.message || "",
        confirmText: opts.confirmText || "Submit",
        cancelText: opts.cancelText || "Cancel",
        defaultValue: opts.defaultValue || "",
        placeholder: opts.placeholder || "",
        password: !!opts.password,
        match: opts.match || null, // require the typed value to equal this string
        resolve,
      },
    }
    emit()
  })
}

export function closeDialog(value) {
  const d = state.dialog
  state = { ...state, dialog: null }
  emit()
  if (d) d.resolve(value)
}
