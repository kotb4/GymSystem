# Yassen Mohamed Kotb | 01288536381 Architecture (verified)

Last synced 2026-08-25. Diagrams reflect the real implementation, not plans.

## High-level

```
React SPA (dist/, static files)
        │  fetch  POST /api/rpc  + REST /api/*
        ▼
Node backend (server/index.ts) — loopback 127.0.0.1:8890 only
        │
        ├── server/rpc.ts      whitelist registry → src/core/services/*
        ├── server/sessions.ts HttpOnly cookie sessions → auth_sessions table
        ├── server/backups.ts  .gymbak snapshots / atomic adopt
        ├── server/files.service.ts  Files\ on disk + files table
        ▼
SQLite WAL  %LOCALAPPDATA%\GymSystem\Database\gym.db
```

One process owns the database. The browser stores no business data.

## Backend (`server/`)

| File | Responsibility |
| --- | --- |
| `index.ts` | All routes: `/api/ping`, `/api/auth/{setup,login,logout,me}`, `/api/rpc`, `/api/backups/{create,download,list?}`, `/api/system/{restore,import-legacy}`, `/api/files{,/:id,-meta}`, static `dist/` with SPA fallback. Body limit 256 MB; JSON error shape `{ok:false,error:{code,messageKey,params}}`. |
| `rpc.ts` | `REGISTRY[service][fn]`; `a(fn)` injects `(db, actor, ...args)`, `p(fn)` injects `(db, ...args)`; unknown service/fn → FORBIDDEN. 26 service groups exposed. |
| `driver.ts` | Synchronous `node:sqlite` wrapper implementing the driver interface. |
| `context.ts` | Opens DB, runs migrations, loads permissions cache, registers `db.onDirty(refresh)`, logging to `Logs\server.log`, atomic DB-file adoption for restore/import. |
| `sessions.ts` | SHA-hashed tokens in `auth_sessions`, 12 h sliding expiry, prune helper. |
| `backups.ts` | Snapshot creation with integrity check, download, import (restore or legacy IndexedDB migration) with pre-restore safety snapshot. |
| `files.service.ts` | Saves bytes under `Files\`, records row in `files` (sha256, kind), per-kind permission mapping. |
| `config.ts` | Resolves data dirs from `GYMSYSTEM_DATA_DIR` / `%LOCALAPPDATA%`. |

## Service layer (`src/core/services/` — backend-only)

27 domain services: auth, users, members, plans, subscriptions, cards, attendance, attendance-analytics, payments, expenses, cash-session, finance, financial-report, dashboard, notifications, trainers, training-plans, classes, employees, store, inbody, crm, settings, backup, audit, staff-activity, permissions.

Shared kernel (`src/core/`): `permissions.ts` (73 perms, 4 roles, DB-grant cache), `errors.ts` (AppError + i18n keys), `dates.ts` (YYYY-MM-DD keys), `money.ts` (minor units), `audit-actions.ts`.

## Database (`src/db/`)

- `engine.ts`: `Db` class — run/all/first/scalar/count/insert/exec, re-entrant `transaction()` (BEGIN IMMEDIATE), `onDirty` listeners fired after COMMIT.
- `migrations.ts`: append-only v1..v6 applied at every boot inside transactions; tracked in `schema_migrations`.
- `seed.ts`: optional demo data when `GYM_SEED_DEMO=1` (backend env var; the only trigger) and `settings.demo_seeded` unset. Note: the frontend `VITE_SEED_DEMO` in `.env.development` does not reach the Node backend, so it does not seed.
- Tests use an in-memory/file driver via `tests/helpers/test-db.ts` (`createTestDb()`).

### Schema map (40+ tables, migrations v1..v6)

```
v1 core     roles, permissions, role_permissions, users, settings,
            membership_plans, members(+unique phone), cards(unique barcode),
            member_subscriptions, attendance, audit_logs, counters
v2 money    payment_methods(seed), expense_categories(seed), payments(strict CHECKs),
            payment_refunds, expenses, cash_sessions(single-open), financial_ledger(UNIQUE ref)
v3 people   trainers(partial unique phone), training_plans, backups_log
v4 growth   plan kinds time|sessions|open (+sessions_total/used, freeze cols),
            subscription_freezes, member profile+department+trash cols, users.department,
            attendance.checkout_at, body_assessments, fitness_test_defs/results,
            product_categories(seed), products, stock_movements, store_sales,
            store_sale_items, store_debts, store_debt_payments, classes, class_sessions,
            class_bookings, employees, salaries, expense_attachments(BLOB≤2MB; dropped v15, backfilled v26 to Files/),
            dual box on cash_sessions+ledger, crm_templates(seed), crm_messages
v5 sessions auth_sessions
v6 files    files(kind registry), members.photo_file_id, employees.salary_type/base,
            allow_negative_stock setting
```

Key integrity rules: money CHECKs (`net = base - discount`, non-negative), partial UNIQUE indexes (member phone, trainer phone, one open session per box), ledger `UNIQUE(ref_table, ref_id, entry_type)`, FK enforcement ON, `class_bookings UNIQUE(session_id, member_id)`, `salaries UNIQUE(employee_id, period_month)`.

## Frontend (`src/`)

```
main.tsx → routes/index.tsx (RequireAuth + RequirePermission wrappers)
             ├─ pages/*.tsx (24 pages)
             ├─ components/ui/* shared primitives; layout/app-layout + sidebar
             ├─ contexts/auth-context.tsx (session, hasPermission via actor role grants)
             └─ api/index.ts (typed RPC wrappers; only place calling fetch)
```

State: local component state + auth context; no global store library. Server state fetched per page via `src/api`.

## Request flow (write path example: record payment)

```
PaymentFormModal → api.payments.create()
  → POST /api/rpc {service:"payments", fn:"create", args}
  → cookie → ServiceActor {userId, username, roleId, department}
  → invokeRpc → paymentsService.create(db, actor, ...)
       requirePermission("payments.create") → validate input
       db.transaction: insert payment (CHECKs) + financial_ledger entry + audit log
  → COMMIT fires onDirty → permissions cache refresh (no-op cost)
  → {ok:true,result} → toast + list reload
```

## Important dependencies

Runtime only: react, react-dom, react-router-dom, lucide-react, hash-wasm, @fontsource-variable/cairo. Everything else is dev tooling. Offline-first: no runtime network calls except user-initiated WhatsApp deep link.
