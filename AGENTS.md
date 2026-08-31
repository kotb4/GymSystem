# AGENTS.md — Yassen Mohamed Kotb | 01288536381 (yassen)

Primary AI engineering instruction file. Every AI agent working in this repository MUST read this file first and follow it exactly.

The repository files are the persistent memory shared between coding agents. **Chat history is NOT part of the project's source of truth.** A new agent (OpenCode, Cursor, Claude Code, or any other) must be able to continue the project from the repository files alone.

**Mandatory reading order before any substantive work:**

1. `AGENTS.md` (this file) — the contract.
2. `.ai/project.md` — long-form project profile.
3. `.ai/current-state.md` — live dev-state handoff (where the previous agent stopped, what to do next).
4. `.ai/tasks.md` — task history & roadmap (active / completed / blocked / discovered-followup).
5. `.ai/decisions.md` — Architecture Decision Record (when relevant).
6. Inspect the actual source code before trusting documentation. The docs may lag behind the code by a commit; the code is the source of truth.

Shared context layout:

- `.ai/` — short AI-oriented reference (project / current-state / tasks / decisions / quick-reference architecture & business rules). Maintained by agents.
- `docs/ai/` — long-form human-readable architecture, database, business rules, security, development, testing, roadmap. Maintained by agents and value-level auto-synced (`scripts/sync-docs.mjs`).
- `.opencode/agents/`, `.opencode/commands/` — OpenCode-specific entry points (agents, commands) that all read+write the SAME `.ai/` files; never an OpenCode-only memory.

---

## 1. Project Overview

Yassen Mohamed Kotb | 01288536381 (`yassen`) is a fully Arabic, RTL-first, offline gym-management application for Windows.

**Current architecture:**

```
React SPA (dist/, served by the backend)
        │  HTTP on 0.0.0.0:8890
        ▼
Local Node.js backend (server/index.ts, bundled to dist-server/index.cjs)
        │  whitelisted RPC + REST endpoints, business logic, sessions, backups
        ▼
SQLite (WAL) at %LOCALAPPDATA%\GymSystem\Database\gym.db  + Files\ + Backups\ + Logs\
```

- **No Electron/Tauri.** The "desktop app" is the local Node server plus a browser window (Edge App Mode) launched by `scripts/windows/start-gymsystem.bat`.
- **Single source of truth:** the SQLite file on disk. The browser holds NO business data (no IndexedDB/localStorage for data).
- **Business logic lives ONLY in the backend.** Services from `src/core/services/*.service.ts` execute inside the Node process; the frontend calls them through `/api/rpc` with a strict whitelist registry (`server/rpc.ts`).
- All UI text is Arabic via `src/i18n/ar.ts`; currency is EGP stored as integer minor units (100 piastres = 1 EGP).

## 2. Development Commands

| Purpose | Command |
| --- | --- |
| Frontend dev server (proxies `/api` → 8890) | `npm run dev` |
| Build + run backend (0.0.0.0:8890) | `npm run dev:server` |
| Both at once (Windows) | `dev.bat` |
| Full build (typecheck client + server, vite build, esbuild server bundle) | `npm run build` |
| Typecheck frontend | `npm run typecheck` |
| Typecheck server | `npm run typecheck:server` |
| Unit tests (Vitest, one shot) | `npm test` |
| Unit tests (watch) | `npm run test:watch` |
| Single test file | `npx vitest run tests/<file>.test.ts` |
| Backend E2E smoke (start → seed → restart → verify) | `npm run e2e` |
| Larger E2E audit (42 checks) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-audit.ps1` |
| Run built backend | `npm start` |
| Value-level doc sync (counts/versions from source) | `npm run sync:docs` (also auto-runs via pre-commit hook) |
| One-shot commit+push (add all → commit "msg" → push) | `git a "commit message"` |

Demo data seeding: set `GYM_SEED_DEMO=1` for the built backend or `VITE_SEED_DEMO=1` (already set in `.env.development`) for dev.

Data locations (override with `GYMSYSTEM_DATA_DIR`):
- `%LOCALAPPDATA%\GymSystem\Database\gym.db`
- `%LOCALAPPDATA%\GymSystem\Files\`
- `%LOCALAPPDATA%\GymSystem\Backups\`
- `%LOCALAPPDATA%\GymSystem\Logs\server.log`

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
    services/               ALL business logic (34 files, backend-only)
    permissions.ts          Roles, 94 permissions, DB-backed grant cache
    audit-actions.ts        Audit action enum (155 actions)
    errors.ts               AppError codes + i18n messageKeys
    dates.ts money.ts       Shared primitives (date keys, minor units)
  db/
    engine.ts               Db wrapper: run/all/first/scalar/count/transaction/onDirty
    migrations.ts           Versioned migrations v1..v20 (applied at every boot)
    seed.ts                 Optional demo seeding
  pages/                    29 route pages
  components/               ui/ layout/ members/ finance/ subscriptions/ cards/ users/ charts/
  contexts/auth-context.tsx Session state + hasPermission()
  routes/                   Route table + permission-gated NAV_ROUTES
  i18n/ar.ts                Arabic dictionary (flat-key lookup)
tests/                      Vitest suites (30 files, node env), createTestDb() helper
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

### Authentication & authorization

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
- **Migrations:** append-only array in `src/db/migrations.ts` (currently v1..v9). Each runs once, tracked in `schema_migrations`, applied inside a transaction at boot. To change schema you MUST add a new version entry. Never edit old migrations; never write destructive statements without explicit human approval.
- **Integrity:** heavy use of CHECK constraints (money non-negative, status enums, `net = base - discount` style arithmetic), UNIQUE indexes (partial unique phone/barcode), FKs with referential enforcement ON. Money columns are `*_minor` INTEGER (piastres; 100 = 1 EGP). Dates are `YYYY-MM-DD` keys; timestamps ISO strings.
- **Transactions:** any multi-statement invariant MUST run inside `db.transaction(() => {...})` (payments, cancels, purge, salary payment, store sale, backup adopt…). Follow that rule for new features.
- **financial_ledger:** append-only cash truth with `UNIQUE(ref_table, ref_id, entry_type)`. Exactly one ledger entry per logical event; reversals must check existence first (double-reversal guard exists in payments/subscriptions services — keep it).
- **Deletion policy:** members are SOFT-deleted (`deleted_at/deleted_by/deletion_reason`), restorable, and hard-purge cascades 17+ child tables in FK-safe order inside one transaction. Never break historical references casually.
- **Seed/demo:** demo seeding only when explicitly enabled by env var and only when `settings.demo_seeded` is unset.

## 5. Business Rules

Confirmed in code — details in `docs/ai/business-rules.md`:

- Subscription overlap rejection with suggested start date.
- Attendance requires active member + live (or session-credit) subscription.
- Duplicate-scan window configurable.
- Freeze extends expiry when `freeze_extends_expiry=1` and writes history.
- Renew creates a successor subscription.
- Cancel marks payments revenue-neutral via reversal entries.
- Void blocked after refunds and vice versa.
- Store credit sale requires a member and creates a debt repaid in installments.
- Class booking enforces capacity and atomically consumes one session for `consumes_session` classes.
- Salary payment generates an expense + ledger entry.
- Cash close stores discrepancies permanently.
- Refund entries reduce revenue; reports account for partial and full refunds.

Anything not covered in `docs/ai/business-rules.md` must be verified in code before relying on it — label it UNKNOWN otherwise.

## 6. Coding Conventions

- **TypeScript strict everywhere** (`noUnusedLocals`, `noUnusedParameters`). Path alias `@/*` → `src/*`.
- **Services:** file per domain `src/core/services/<domain>.service.ts`; exported functions take `(db: Db, actor: ServiceActor, ...)`; pure/sync where possible; async only when needed. Permission check is the FIRST statement of any protected function.
- **Errors:** throw `errValidation / errNotFound / errConflict / errForbidden` from `@/core/errors` with i18n keys under `errors.*`. Never return error strings. Frontend shows them via `describeError(err, t)`.
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
ANALYZE   → inspect code/db/tests affected
PLAN      → files, schema, RPC, UI, tests, risks
IMPLEMENT → smallest correct change following conventions above
TEST      → npx vitest run <affected>; then npm test; typecheck; build if broad
REVIEW    → review the diff
SECURITY  → check authz, validation, injection, IDOR
```

Trivial typo/i18n fixes may compress ANALYZE/PLAN but never skip TEST.

## 9. Completion Requirements

A task is NOT complete merely because code was written. The final report MUST include:

- Files changed (created/modified/deleted)
- Database changes (migration version added or "none")
- Tests executed (exact commands + pass/fail counts)
- Verification performed (typecheck/build/e2e as applicable)
- Remaining risks / known limitations

If verification could not run (e.g., environment lacks Node), say so explicitly — do not imply success.

**Before finishing, the agent MUST update the shared project state** so the next agent can resume from the repository alone (no chat context required):

- If you started or completed a non-trivial task → record it in `.ai/tasks.md` (active / completed / blocked / discovered-followup).
- If you made an architectural / product / security / data / API / permission decision → append an ADR to `.ai/decisions.md`.
- Always update `.ai/current-state.md` to reflect the **current live state**: what was completed, what is in-progress, what remains, files touched, tests run, known issues, next recommended step, and (optionally) the last agent/tool. Keep it concise — the next agent should be able to answer "what happened, where did we stop, what do I do next" by reading this single file.

A task is not complete until `.ai/current-state.md` reflects reality.

## 10. Documentation References

| Document | When to read |
| --- | --- |
| `.ai/current-state.md` | First thing after AGENTS.md — live dev-state handoff (what the previous agent was doing, where it stopped) |
| `.ai/project.md` | Project profile, stack, runtime, major features, known limitations |
| `.ai/tasks.md` | Task history (active / completed / blocked / discovered-followup) |
| `.ai/decisions.md` | Architecture Decision Record (ADRs) — only when the decision affects architecture, DB, security, permissions, business logic, data lifecycle, API/RPC, or major UI |
| `.ai/architecture.md` | Short AI-reference for request flow, startup, file layout |
| `.ai/business-rules.md` | Short AI-reference for subscription/attendance/finance/store/class rules |
| `docs/ai/architecture.md` | Long-form human-readable architecture, request flow, startup, file layout |
| `docs/ai/database.md` | Long-form schema, migrations, table structures (value-level auto-synced) |
| `docs/ai/business-rules.md` | Long-form subscription/attendance/finance/store/class rules |
| `docs/ai/security.md` | Auth, sessions, authorization, RPC whitelist, file handling |
| `docs/ai/development.md` | How to build, test, run, debug |
| `docs/ai/testing.md` | Test architecture, test patterns, test counts |
| `docs/ai/roadmap.md` | Planned vs implemented features |

The two files of the same name (e.g. `.ai/architecture.md` vs `docs/ai/architecture.md`) are NOT duplicates — the `.ai/` one is a short AI quick-reference, the `docs/ai/` one is the full long-form. Use `.ai/` first when starting work, `docs/ai/` when you need the full picture.
