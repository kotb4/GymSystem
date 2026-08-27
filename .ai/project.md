# Yassen Mohamed Kotb | 01288536381 — Project Profile

Verified against the repository on 2026-08-25. If code changes, run `/docs` to re-sync.

## Identity

- **Name:** Yassen Mohamed Kotb | 01288536381
- **Purpose:** Fully Arabic, RTL-first, offline gym-management application for a single Windows machine.
- **Status:** Feature-complete for single-club operation; actively developed; all work happens on `master` (repo has no remote and no commits yet — everything untracked at inspection time).

## Technology Stack (verified)

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + React Router 7, TypeScript strict, Tailwind CSS v4, lucide-react, Cairo variable font (local) |
| Build | Vite 8 (client → `dist/`), esbuild (server → `dist-server/index.cjs`) |
| Backend | Node.js ≥24, `node:http`, `node:sqlite` (synchronous driver), no web framework |
| Database | SQLite in WAL mode, file on disk, FK enforcement ON |
| Auth | argon2id via hash-wasm, HttpOnly cookie sessions in DB |
| Tests | Vitest 4 (node environment) + PowerShell E2E scripts |

## Runtime

- No Electron/Tauri. Desktop experience = local Node backend + browser window in Edge App Mode launched by `scripts/windows/start-gymsystem.bat`.
- Backend listens on `0.0.0.0:8890` by default (override: `GYMSYSTEM_HOST`/`GYMSYSTEM_PORT`; LAN exposure enabled — binds all interfaces).
- Data under `%LOCALAPPDATA%\GymSystem\`: `Database\gym.db`, `Files\`, `Backups\`, `Logs\server.log`. Override root with `GYMSYSTEM_DATA_DIR`.

## Important Commands

See AGENTS.md §2. Quick reference: `npm run dev`, `npm run dev:server`, `dev.bat`, `npm run build`, `npm test`, `npm run typecheck[:server]`, `npm run e2e`.

## Current Major Features (all verified in code + tests)

Members & trash/purge/photos · Plans & subscriptions (time/sessions/open kinds, freeze history, renew, cancel) · Barcode cards & check-in/out · Payments/refunds/voids + financial ledger · Expenses (+BLOB attachments ≤2 MB) & categories · Dual cash boxes (gym/store) with discrepancy tracking · Financial reports & dashboard · Store/POS (products, stock movements, sales, credit debts, repayments, profit) · Classes (sessions, bookings, capacity, session-consuming plans) · Trainers & training plans · Employees & salaries (4 salary types; pay→expense+ledger) · InBody assessments + custom fitness tests · CRM templates/messages (WhatsApp manual-open flow) · Notifications digest · Backups/restore/legacy IndexedDB import · Settings · Users · Audit log · Permissions editor.

## Known Limitations

- Arabic-only UI (single locale by design).
- Single-machine deployment; no LAN/multi-device support yet.
- WhatsApp sending is manual-open flow; no automated provider transport.
- Expense attachments stored as BLOBs inside SQLite (roadmap: move to `Files\`).
- No EXE/installer packaging yet (bat launcher only).
- README.md "known limitations" section is outdated (claims Store/Classes/InBody/CRM missing — they are implemented).

## NOT IMPLEMENTED (verified absent)

NFC check-in · Printing/receipts · Multi-user LAN · Automated messaging transport · Installer packaging.
