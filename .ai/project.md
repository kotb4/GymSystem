# Yassen Mohamed Kotb | 01288536381 — Project Profile

> **Commercial Showcase & Marketing Guide:** See [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md) for full marketing descriptions, feature catalogs, and AI onboarding prompts.

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
- Backend listens on `127.0.0.1:8890` by default (override: `GYMSYSTEM_HOST`/`GYMSYSTEM_PORT`; the default is loopback-only — LAN exposure is opt-in via `GYMSYSTEM_HOST`, ADR-023).
- Data under `%LOCALAPPDATA%\GymSystem\`: `Database\gym.db`, `Files\`, `Backups\`, `Logs\server.log`. Override root with `GYMSYSTEM_DATA_DIR`.

## Important Commands

See AGENTS.md §2. Quick reference: `npm run dev`, `npm run dev:server`, `dev.bat`, `npm run build`, `npm test`, `npm run typecheck[:server]`, `npm run e2e`.

## Current Major Features (all verified in code + tests)

Members & trash/purge/photos · Plans & subscriptions (time/sessions/open kinds, freeze history, renew, cancel) · Virtual cards (auto per member, barcode = member code) + printed barcode cards & check-in/out · WhatsApp QR card delivery (local gateway, batched send) · Payments/refunds/voids + financial ledger · Expenses (+filesystem attachments ≤2 MB) & categories · Dual cash boxes (gym/store) with discrepancy tracking · Financial reports & dashboard · Store/POS (products, stock movements, sales, credit debts, repayments, profit) · Classes (sessions, bookings, capacity, session-consuming plans) · Trainers & training plans · Employees & salaries (4 salary types; pay→expense+ledger) · InBody assessments + custom fitness tests · Leads/trials tracking · Notifications digest · Backups/restore/legacy IndexedDB import · Settings · Users · Audit log · Permissions editor · Multi-Branch Synchronization (Primary hub on 8890, Replicas on 8895+, Cloudflare Tunnel / Tailscale / LAN pairing, push/pull API with secret auth, collision-safe branch prefixes) · Developer Console & Offline Cryptographic Licensing (HWID binding, grace periods, /developer route).

## Known Limitations

- Arabic-only UI (single locale by design).
- Single-machine app or multi-branch hub-and-spoke; the primary backend binds `0.0.0.0:8890` and replicas bind `8895+` syncing periodically or on demand.
- WhatsApp QR-card delivery works via the optional local gateway (`whatsapp-gateway/`, `127.0.0.1:8891`, Playwright, paired once). Bulk CRM messaging was removed in TASK-044 (leads/trials kept). Sending is off until the gym installs + pairs the gateway (`npm run setup-whatsapp-gateway`).
- File assets (member photos, InBody reports, expense attachments) live on disk under `Files\` and are registered in the `files` table; they are included in `.gymbak` backups (ADR-018).
- Packaging (ADR-029): `npm run build:exe` produces `dist-exe/GymSystem.exe` (Node SEA, embedded frontend, auto-opens Edge App-Mode, double-launch-guarded) + portable `runtime/node.exe` + bundled `gateway/`.

## NOT IMPLEMENTED (verified absent)

NFC check-in · Thermal receipt printing · Physical PVC card printing · Bulk WhatsApp marketing campaigns (ToS/ban risk) · Advanced analytics / AI insights
