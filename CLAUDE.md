# CLAUDE.md

Guidance for working in this repository.

## What this is

Pine Lake is a single-page React app that serves three audiences from one codebase, switched by a `screen` state machine in `src/App.jsx`:

1. **Kiosk** (`KioskView`) — wall-mounted tablet at the park. Staff clock in/out via PIN or face scan.
2. **Employee portal** (`PortalView`) — mobile self-service. GPS-verified clock-in, timesheets, paystubs, requests.
3. **Manager dashboard** (`ManagerDashboard`) — scheduling, payroll, analytics, staff & station management.

## Backend: dual-mode by design

`src/lib/supabase.js` exports either the real Supabase client **or** a `MockSupabaseClient` backed by LocalStorage, decided at load time by whether `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set (`IS_MOCK_DATABASE`).

- The mock client implements a chainable query builder (`select/eq/order/single/insert/update/delete/upsert`) and a simulated realtime channel, so the **entire app runs with no backend**.
- When adding a feature that touches the database, it must work in **both** modes. Test in mock mode (default `npm run dev`) first.
- LocalStorage keys are prefixed `pinelake_*` (e.g. `pinelake_employees`, `pinelake_clock_logs`, `pinelake_offline_queue`).

## Key architectural facts

- **State lives in `App.jsx`** and is passed down by props (no Redux/Context for domain data). `loadData()` is the single fetch+normalize entry point; realtime + offline-sync both call it.
- **Payroll math** is centralized in `getTimesheetSummary()` in `App.jsx`. OT = hours over 40 on weekdays **plus** all weekend hours, at 1.5×. Taxes are percentage rates per employee.
- **Clock state** is derived from `clock_logs` (actions: `IN`, `OUT`, `BREAK_START`, `BREAK_END`, `AUTO-OUT`). The most recent action per employee determines `clockedIn` status.
- **Offline-first**: `src/lib/offlineSync.js` queues punches in LocalStorage and syncs on reconnect via the `online` event and `offline-queue-changed` custom event.
- **Geofencing**: `PortalView` compares device coordinates to `stations` rows (haversine) and auto-clocks-out after 60s out of bounds.

## Conventions

- **Styling**: Tailwind CSS 4 utility classes inline. Theme tokens (fonts, brand colors) are in `src/index.css` under `@theme`. Role colors come from `ROLE_COLORS` in `src/lib/utils.js`.
- **User feedback**: use the toast/confirm helpers in `src/lib/notify.js` (`toast.success/error/info/warning`, `confirmDialog`, `promptDialog`) — **not** native `alert()` / `window.prompt()`. The matching `<NotificationHost />` (in `src/components/`) is mounted once in `App.jsx`.
- **Money/time formatting**: `fmtMoney`, `fmtElapsed` in `utils.js`.
- Keep new components in `src/components/`, shared logic in `src/lib/`.

## Running & verifying

- `npm run dev` — mock mode, no config needed.
- The app uses heavy continuous CSS animations; automated full-page screenshots can stall. Prefer DOM inspection / targeted checks when verifying.
- Production schema + RLS: `supabase/schema.sql`.
