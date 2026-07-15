# Pine Lake Recreation — Staff Kiosk & Workforce Platform

A production-grade, offline-first **time-clock, scheduling, and payroll platform** purpose-built for recreation parks and aquatics facilities. Pine Lake runs as a wall-mounted **kiosk**, a mobile **employee self-service portal**, and a full **manager dashboard** — all from a single React + Supabase codebase.

> Built for the realities of a seasonal park: spotty Wi-Fi, lifeguards moving between stations, weather-driven safety flags, and managers who need labor costs at a glance.

---

## Highlights

| Capability | What it does |
|---|---|
| 🕐 **Kiosk time clock** | PIN or face-scan check-in with live photo capture, role-colored roster, and running shift timers. |
| 📍 **GPS geofencing** | Multi-station boundaries with live geofence watching and automatic clock-out when staff leave their zone. |
| 📱 **Employee portal** | Self-service clock-in, weekly timesheet, hours gauge, schedule, break-compliance nudges, and one-tap PDF paystubs. |
| 🗓️ **Drag-and-drop scheduler** | Matrix and timeline views, conflict/sync resolution, and per-day staffing visualization. |
| 💵 **Payroll engine** | Overtime (>40h + weekends), bonus rates, fed/state/county/FICA withholding, employer burden, and CSV/XLSX export. |
| 🛟 **Certification tracking** | Lifeguard / CPR / First-Aid expiry tracking with dashboard alerts for lapsing credentials. |
| 📨 **Time-off & swap requests** | Employees request time off; managers approve/deny from an inbox with live pending badges. |
| 🌤️ **Weather safety flags** | Live conditions drive Green/Yellow/Red waterfront flags on the kiosk. |
| 🛜 **Offline-first** | Punches queue locally during outages and sync automatically on reconnect. |
| ⚡ **Real-time** | Supabase subscriptions push clock events to every screen instantly. |

---

## Tech stack

- **React 19** + **Vite 8**
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- **Supabase** (Postgres, Auth, Realtime, Row-Level Security)
- **jsPDF** (paystubs) · **SheetJS / xlsx** (payroll export)

The app ships with a **fully functional mock backend** (LocalStorage) so it runs end-to-end with zero configuration — ideal for demos and local development.

---

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL. With no Supabase credentials configured, the app boots in **mock mode** with seeded staff, schedules, and clock logs.

### Demo logins (mock mode)

| Role | Email | Password / PIN |
|---|---|---|
| Park Admin | `admin@pinelake.com` | `0000` |
| Site Manager | `manager@pinelake.com` | `9999` |
| Employee PINs | — | `1111`–`4444` (see roster) |

### Connecting a real Supabase backend

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor (creates tables + Row-Level Security policies).
2. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```
3. Restart `npm run dev`. The app automatically switches from mock mode to live Supabase.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |

---

## Project structure

```
src/
  App.jsx                 # Root: state, routing, data loading, payroll math
  components/
    KioskView.jsx         # Wall kiosk: roster, weather, announcements
    PortalView.jsx        # Employee mobile self-service portal
    ManagerDashboard.jsx  # Manager console (clock, schedule, payroll, etc.)
    AnalyticsDashboard.jsx# SVG analytics & labor charts
    Forms.jsx             # Employee add/edit form
    PinPad.jsx · FaceScanUI.jsx · WeatherEffects.jsx
  lib/
    supabase.js           # Supabase client + LocalStorage mock backend
    offlineSync.js        # Offline punch queue + sync
    utils.js · sounds.js  # Shared helpers
supabase/
  schema.sql              # Tables + RLS policies for production
```

See [`CLAUDE.md`](CLAUDE.md) for architecture notes and conventions.

---

## License

See [LICENSE](LICENSE).
