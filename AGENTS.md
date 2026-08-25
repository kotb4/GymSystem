# AGENTS.md — GymSystem (gympro)

Primary AI engineering instruction file. Every AI agent working in this repository MUST read this file first and follow it exactly.

Supplementary context lives in `.ai/` (project, architecture, business rules, decisions, tasks) and `.opencode/` (agents and commands).

---

## 1. Project Overview

GymSystem (`gympro`) is a fully Arabic, RTL-first, offline gym-management application for Windows.

**Actual current architecture** (verified from the codebase):

```
React SPA (dist/, served by the backend)
        │  HTTP on 127.0.0.1:8890 only
        ▼
Local Node.js backend (server/index.ts, bundled to dist-server/index.cjs)
        │  whitelisted RPC + REST endpoints, business logic, sessions, backups
        ▼
SQLite (WAL) at %LOCALAPPDATA%\GymSystem\Database\gym.db  + Files\ + Backups\ + Logs\
```

- **No Electron/Tauri.** The "desktop app" is the local Node server plus a browser window (Edge App Mode) launched by `scripts/windows/start-gymsystem.bat`.
- **Single source of truth:** the SQLite file on disk. The browser holds NO business data (no IndexedDB/localStorage for data).
- **Business logic lives ONLY in the backend.** Services from `src/core/services/*.service.ts` execute inside the Node process; the frontend calls them through `/api/rpc` with a strict whitelist registry (`server/rpc.ts`).
- All UI text is Arabic via `src/i18n/ar.ts`; currency is EGP stored as integer minor units.

## 2. Development Commands

All commands verified against `package.json`. There is **no lint script and no formatter config** — do not invent one; typecheck + tests are the quality gates.

| Purpose | Command |
| --- | --- |
| Frontend dev server (proxies `/api` → 8890) | `npm run dev` |
| Build + run backend (127.0.0.1:8890) | `npm run dev:server` |
| Both at once (Windows) | `dev.bat` |
| Full build (typecheck client + server, vite build, esbuild server bundle) | `npm run build` |
| Typecheck frontend | `npm run typecheck` |
| Typecheck server | `npm run typecheck:server` |
| Unit tests (Vitest, one shot) | `npm test` |
| Unit tests (watch) | `npm run test:watch` |
| Single test file | `npx vitest run tests/<file>.test.ts` |
| Backend E2E smoke (start → seed → restart → verify) | `npm run e2e` |
| Larger E2E audit scenario (42 checks) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-audit.ps1` |
| Run built backend | `npm start` |

Demo data seeding: set `GYM_SEED_DEMO=1` for the built backend or `VITE_SEED_DEMO=1` (already set in `.env.development`) for dev.

Data locations (override with `GYMSYSTEM_DATA_DIR`): `%LOCALAPPDATA%\GymSystem\{Database\gym.db, Files\, Backups\, Logs\server.log}`.

When debugging runtime failures, read `%LOCALAPPDATA%\GymSystem\Logs\server.log`.

## 3. Architecture

### Layout

```
server/                     Local backend (owns the database)
  index.ts                  HTTP routes: /api/auth/*, /api/rpc, /api/backups/*,
                            /api/system/{restore,import-legacy}, /api/files*, static dist/
  rpc.ts                    Whitelisted RPC registry over src/core/services
  driver.ts                 node:sqlite synchronous driver
  context.ts                DB open/migrations/adopt, logs, permissions cache load
  sessions.ts               HttpOnly cookie sessions (hashed tokens in auth_sessions)
  backups.ts                .gymbak snapshots, verify, atomic restore/adopt
  files.service.ts          Filesystem file registry (photos/reports)
  config.ts                 Data-dir resolution
src/
  api/                      Frontend client: fetch/RPC wrappers + shared types
  core/
    services/               ALL business logic (27 services, backend-only)
    permissions.ts          Roles, 68 permissions, DB-backed grant cache
    audit-actions.ts        Audit action enum
    errors.ts               AppError codes + i18n messageKeys
    dates.ts money.ts       Shared primitives (date keys, minor units)
  db/
    engine.ts               Db wrapper: run/all/first/scalar/count/transaction/onDirty
    migrations.ts           Versioned migrations v1..v6 (applied at every boot)
    seed.ts                 Optional demo seeding
  pages/                    24 route pages
  components/               ui/ layout/ members/ finance/ subscriptions/ cards/ users/ charts/
  contexts/auth-context.tsx Session state + hasPermission()
  routes/                   Route table + permission-gated NAV_ROUTES
  i18n/ar.ts                Arabic dictionary (flat-key lookup)
tests/                      Vitest suites (node env), createTestDb() helper
scripts/                    build-server.mjs, e2e-smoke.ps1, e2e-audit.ps1,
                            check-rpc-consistency.cjs, windows/start-gymsystem.bat
```

### Request flow

```
Browser (React)
  → fetch POST /api/rpc {service, fn, args}
  → server/index.ts resolves session cookie → ServiceActor
  → invokeRpc(): REGISTRY[service][fn]  (whitelist; unknown = FORBIDDEN)
       actor fns get (db, actor, ...args); plain fns get (db, ...args)
  → service function: requirePermission(...) → validate → transaction → audit
  → JSON {ok, result} | {ok:false, error:{code, messageKey, params}}
  → frontend describeError() translates messageKey to Arabic toast
```

### Authentication & authorization (verified)

- Passwords: argon2id via hash-wasm (`src/core/auth/password.ts`).
- First-run setup creates the single owner; `POST /api/auth/setup` refuses afterwards.
- Login lockout: 5 failed attempts → 300 s lock (`users.failed_attempts`, `locked_until`).
- Sessions: HttpOnly cookie; token stored SHA-hashed in `auth_sessions`; 12 h sliding TTL.
- Authorization: `requirePermission(actor, perm)` inside EVERY mutating service. The UI hiding buttons is cosmetic only. Owner always passes all checks. Non-owner roles resolve grants from an in-memory cache loaded from the `role_permissions` table (refreshed at boot and on every committed write via `db.onDirty`); editable through the Permissions page.
- Department scoping: members/users carry `department ∈ {general, men, women}`; services enforce `assertDepartmentAccess` so men-section staff cannot touch women-section records.

### Major modules

Members (+trash/restore/purge, photos), Plans & Subscriptions (time/sessions/open kinds, freeze history, renew, cancel), Cards & barcode check-in/out, Payments/refunds/voids + financial ledger, Expenses (+BLOB attachments ≤2 MB) & categories, dual cash boxes (gym/store) with counted-vs-expected discrepancy, financial reports & dashboard, Store/POS (products, stock movements, sales, credit debts, repayments, profit), Classes (sessions, bookings, capacity, session-consuming plans), Trainers & training plans (auto-sweep of expired plans), Employees & salaries (monthly/daily/per_class/custom; pay→expense+ledger), InBody body assessments + custom fitness tests, CRM templates/messages (WhatsApp manual-open flow), Notifications digest, Backups/restore/legacy IndexedDB import, Settings, Users management, Audit log, Permissions editor.

## 4. Database Rules

- **Technology:** SQLite via `node:sqlite`, synchronous, WAL mode. One writer process (the backend). NEVER open the live DB from tooling while the server runs.
- **Access layer:** all SQL goes through `src/db/engine.ts` (`Db`). Raw `db.run/all/first/scalar/count/insert/exec` — no ORM. Server uses `NodeSqliteDriver`; tests use their own driver via `createTestDb()`.
- **Migrations:** append-only array in `src/db/migrations.ts` (currently v1..v6). Each runs once, tracked in `schema_migrations`, applied inside a transaction at boot. To change schema you MUST add a new version entry. Never edit old migrations; never write destructive statements without explicit human approval.
- **Integrity:** heavy use of CHECK constraints (money non-negative, status enums, `net = base - discount` style arithmetic), UNIQUE indexes (partial unique phone/barcode), FKs with referential enforcement ON. Money columns are `*_minor` INTEGER (piastres; 100 = 1 EGP). Dates are `YYYY-MM-DD` keys; timestamps ISO strings.
- **Transactions:** any multi-statement invariant MUST run inside `db.transaction(() => {...})` (payments, cancels, purge, salary payment, store sale, backup adopt…). Follow that rule for new features.
- **financial_ledger:** append-only cash truth with `UNIQUE(ref_table, ref_id, entry_type)`. Exactly one ledger entry per logical event; reversals must check existence first (double-reversal guard exists in payments/subscriptions services — keep it).
- **Deletion policy:** members are SOFT-deleted (`deleted_at/deleted_by/deletion_reason`), restorable, and hard-purge cascades 17 child tables in FK-safe order inside one transaction. Never break historical references casually.
- **Seed/demo:** demo seeding only when explicitly enabled by env var and only when `settings.demo_seeded` is unset.

## 5. Business Rules (confirmed in code — details in .ai/business-rules.md)

Confirmed examples: subscription overlap rejection with suggested start date; attendance requires active member + live (or session-credit) subscription; duplicate-scan window configurable; freeze extends expiry when setting `freeze_extends_expiry=1` and writes history; renew creates a successor subscription; cancel marks payments revenue-neutral via reversal entries; void blocked after refunds and vice versa; store credit sale requires a member and creates a debt repaid in installments; class booking enforces capacity and atomically consumes one session for `consumes_session` classes; salary payment generates an expense + ledger entry; cash close stores discrepancies permanently. Read `.ai/business-rules.md` before touching any of these flows.

Anything not covered there must be verified in code before relying on it — label it UNKNOWN otherwise.

## 6. Coding Conventions

- **TypeScript strict everywhere** (`noUnusedLocals`, `noUnusedParameters`). Path alias `@/*` → `src/*`.
- **Services:** file per domain `src/core/services/<domain>.service.ts`; exported functions take `(db: Db, actor: ServiceActor, ...)`; pure/sync where possible; async only when needed. Permission check is the FIRST statement of any protected function.
- **Errors:** throw `errValidation / errNotFound / errConflict / errForbidden` from `@/core/errors` with i18n keys under `errors.*` (nested objects allowed, e.g. `errors.finance.*`, `errors.store.*`). Never return error strings. Frontend shows them via `describeError(err, t)`.
- **Every user-visible string** must exist in `src/i18n/ar.ts`. A coverage test (`tests/i18n-coverage.test.ts`) fails the build for missing t() keys, missing thrown error keys, or untranslated permissions.
- **RPC exposure:** register new service functions in `server/rpc.ts` (`a()` for actor functions, `p()` for plain) — nothing else is callable. `scripts/check-rpc-consistency.cjs` helps validate wiring.
- **Frontend API:** add typed wrappers in `src/api/index.ts`; never call fetch directly from components.
- **UI:** function components; shared primitives in `src/components/ui` (Card/CardHeader, DataTable, Modal with footer actions, Button, Input, Select, Checkbox, Tabs, Badge, EmptyState which requires an icon, useToast). Styling is Tailwind v4 design tokens (`bg-panel`, `text-subtle`, neon accents); RTL logical properties (`ms-/me-/ps-/pe-`), no emoji icons (use lucide-react).
- **Routes:** register page in `src/routes/index.tsx` + `NAV_ROUTES` with its permission; sidebar icon map in `sidebar.tsx`.
- **Tests:** colocated in `tests/*.test.ts`, node environment, `createTestDb()` + `buildActor()` helpers; cover permission denials and money math, not just happy paths.
- **No comments unless necessary; no console.log in services** (backend logging via `logLine` in server layer only).

## 7. AI Safety Rules

Mandatory for every AI agent in this repo:

1. Inspect before modifying. Read the real code, not memory or summaries.
2. Reuse existing patterns; do not duplicate existing functionality.
3. Do not introduce dependencies without explicit approval (offline-first project).
4. Do not change architecture without written justification.
5. Do not change the database schema without adding a new migration version.
6. No destructive database changes (DROP/DELETE of tables or mass data) without explicit human approval.
7. Do not move or rename major modules (`server/`, `src/core/services/`, `src/db/`, `tests/`) without explicit approval.
8. Do not silently remove functionality; removal requires stating it in the plan and report.
9. Never bypass authentication or authorization; never weaken `requirePermission` calls.
10. Never treat frontend validation as a security boundary — the backend is the only enforcement point.
11. Validate all external input (HTTP bodies, query params, file uploads) in the backend.
12. Preserve database integrity: FK-safe delete order, CHECK constraints, ledger uniqueness.
13. Use transactions whenever multiple related writes must succeed together.
14. Run relevant verification after implementation (typecheck + targeted tests + full `npm test` + `npm run build` for wide changes).
15. Never claim success without actually executing verification.

## 8. Required AI Workflow

For any non-trivial change:

```
ANALYZE   → inspect code/db/tests affected (use /analyze or planner agent)
PLAN      → files, schema, RPC, UI, tests, risks (planner agent output format)
IMPLEMENT → smallest correct change following conventions above
TEST      → npx vitest run <affected>; then npm test; typecheck; build if broad
REVIEW    → reviewer agent pass over the diff
SECURITY AUDIT → security agent pass (authz, validation, injection, IDOR)
DOCUMENT  → update .ai/* via docs agent if behavior/architecture changed
```

Trivial typo/i18n fixes may compress ANALYZE/PLAN but never skip TEST and REVIEW.

## 9. Completion Requirements

A task is NOT complete merely because code was written. The final report MUST include:

- Files changed (created/modified/deleted)
- Database changes (migration version added or "none")
- Tests executed (exact commands + pass/fail counts)
- Verification performed (typecheck/build/e2e as applicable)
- Remaining risks / known limitations
- Anything that could not be verified and why

If verification could not run (e.g., environment lacks Node), say so explicitly — do not imply success.
