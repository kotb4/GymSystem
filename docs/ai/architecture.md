# Yassen Mohamed Kotb | 01288536381 Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────┐
│  React SPA (Vite, served from dist/)            │
│  HashRouter, Arabic RTL, Tailwind v4 dark theme  │
│  23 pages, 24 UI primitives, 140+ RPC wrappers   │
└──────────────────────┬──────────────────────────┘
                       │ HTTP POST /api/rpc  {service, fn, args}
                       │ Cookie: gymsystem_session (HttpOnly)
                       │
┌──────────────────────▼──────────────────────────┐
│  Node.js Backend (server/index.ts)               │
│  Binds 127.0.0.1:8890             │
│  ┌───────────────────────────────────────────┐   │
│  │ Routes:                                   │   │
│  │  POST /api/rpc         → RPC gateway      │   │
│  │  POST /api/auth/*      → login/setup/me   │   │
│  │  POST /api/backups/*   → backup/download  │   │
│  │  POST /api/system/*    → restore/import   │   │
│  │  POST/GET /api/files/* → file upload/get  │   │
│  │  GET /*                → static dist/ SPA │   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │ RPC Registry (server/rpc.ts)              │   │
│  │  24 service namespaces, ~143 endpoints    │   │
│  │  a() = actor fn, p() = plain fn           │   │
│  │  Unknown = 403 FORBIDDEN                  │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  SQLite (node:sqlite, synchronous, WAL)          │
│  %LOCALAPPDATA%/GymSystem/Database/gym.db        │
│  43 tables, v1..v32 migrations, ~60 indexes       │
│  CHECK constraints, FK enforcement, append-only   │
│  ledger                                         │
└─────────────────────────────────────────────────┘
```

## Frontend Architecture

### Entry Point
`src/main.tsx` → `StrictMode > I18nProvider > ToastProvider > HashRouter > AuthProvider > AppRoutes`

### Routing
- `HashRouter` (URLs like `/#/members`)
- `RequireAuth` wrapper: checks `useAuth().user`, redirects to `/login` if absent
- `RequirePermission` wrapper: checks `hasPermission(perm)`, shows `ForbiddenView` if denied
- 23 protected routes inside `AppLayout`
- Wildcard `*` redirects to `/`

### State Management
- Local component state only (`useState`/`useCallback`/`useMemo`)
- `auth-context.tsx` provides: booting, user, actor, needsSetup, hasPermission, login, setup, logout
- No global state library (Redux, Zustand, etc.)

### API Layer
- `src/api/client.ts`: `rpc<T>()`, `postJson<T>()`, `postRaw<T>()` — all use `fetch` with `credentials: "same-origin"`
- `src/api/index.ts`: 24 typed API namespace objects + `api` export
- File upload: `api.files.upload(kind, file)` — binary POST to `/api/files`
- NEVER call `fetch()` directly from components

### CSS / Design System
Tailwind CSS v4 with `@theme` design tokens in `src/index.css`:
- Dark theme: `--color-base: #080b12`, neon accent `--color-neon: #39ff88`
- RTL-first: uses `ms-/me-/ps-/pe-` logical properties, never `ml-/mr-/pl-/pr-`
- Font: Cairo Variable (Arabic)
- 10 custom animations (fade-up, fade-in, pop, slide-up, breathe, etc.)
- Custom scrollbar, focus-visible styling, selection color

## Backend Architecture

### HTTP Server (`server/index.ts`)
- Hand-rolled body parser (no express/koa)
- `readBody(req, limit)` accumulates chunks; rejects over limit
- Routes checked sequentially; auth enforced via `currentActor(ctx)`
- Static file serving from `dist/` with path traversal protection
- SPA fallback: any non-API, non-file request returns `index.html`

### RPC Gateway (`server/rpc.ts`)
- Single `POST /api/rpc` endpoint
- Request: `{ service: string, fn: string, args: any[] }`
- Response: `{ ok: true, result }` or `{ ok: false, error: {code, messageKey, params} }`
- Registry: `REGISTRY[serviceName][fnName]` lookup; unknown = `errForbidden()` (403)
- `a(fn)` wraps with actor injection: `fn(db, actor, ...args)`
- `p(fn)` wraps without actor: `fn(db, ...args)`
- ~143 registered endpoints across 24 service namespaces

### Session Management (`server/sessions.ts`)
- Token: `crypto.randomBytes(32).toString("hex")` (128-bit)
- Stored: SHA-256 hash in `auth_sessions` table (raw token never touches DB)
- Cookie: `gymsystem_session`, HttpOnly, SameSite=Strict, 12h sliding TTL
- Sliding window: refreshed on every valid session check

### Database Layer
- `server/driver.ts`: `NodeSqliteDriver` wraps `node:sqlite` `DatabaseSync`
- Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`
- `src/db/engine.ts`: `Db` class wraps driver with `run/all/first/scalar/count/transaction/onDirty`
- Transactions: `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, supports nesting via depth counter
- `onDirty` mechanism: fires callbacks after committed writes (used for permission cache refresh)

### File Storage (`server/files.service.ts`)
- Files saved to `Files/<kind>/<uuid><ext>` on disk
- DB `files` table stores metadata (kind, original_name, mime_type, size_bytes, sha256)
- Kinds: `member_photo`, `inbody_report`, `expense_attachment`, `other`
- Max file size: 2 MB
- MIME whitelists per kind
- Permission mapping: member_photo → `members.edit`, inbody_report → `assessments.manage`, etc.

### Backup System (`server/backups.ts`)
- Format: raw SQLite file via `VACUUM INTO`
- Location: `Backups/<timestamp>.gymbak`
- Verify: post-write `PRAGMA integrity_check`
- Restore: validate → protect current → adopt candidate → reopen DB
- Import legacy: optional unauthenticated path for first-run only

### Startup Sequence (`server/context.ts`)
1. `resolveAppDirs()` — determines directory layout
2. `setFilesRoot(dirs.filesDir)` — configures file storage
3. Create `NodeSqliteDriver` → `Db` wrapper
4. `runMigrations(db)` — applies all pending v1..v32
5. `loadPermissionsCache(db)` — populates in-memory role→permissions
6. `db.onDirty(() => loadPermissionsCache(db))` — auto-refresh on writes
7. Optional demo seed (if env enabled AND `settings.demo_seeded` is unset)

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `server/index.ts` | HTTP server, routes, static serving |
| `server/rpc.ts` | RPC whitelist registry + dispatch |
| `server/sessions.ts` | Session create/resolve/destroy |
| `server/driver.ts` | SQLite driver (node:sqlite) |
| `server/context.ts` | DB boot, migrations, adopt |
| `server/backups.ts` | Backup/restore logic |
| `server/files.service.ts` | File upload/download |
| `server/config.ts` | Data directory resolution |
| `src/db/engine.ts` | Db wrapper class |
| `src/db/migrations.ts` | Schema migrations v1..v32 |
| `src/db/seed.ts` | Demo data seeding |
| `src/core/permissions.ts` | 73 permissions, 4 roles, requirePermission |
| `src/core/errors.ts` | AppError factories |
| `src/core/auth/password.ts` | Argon2id hash/verify |
| `src/core/dates.ts` | Date key utilities |
| `src/core/money.ts` | Minor-unit money math |
| `src/core/services/department.ts` | Department isolation |
| `src/api/index.ts` | Frontend typed API layer |
| `src/i18n/ar.ts` | Arabic dictionary (~900 keys) |
| `src/contexts/auth-context.tsx` | Frontend auth state |
