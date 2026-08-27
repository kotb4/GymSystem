# Yassen Mohamed Kotb | 01288536381 Development Guide

## Prerequisites

- Node.js 24+ (uses built-in `node:sqlite`)
- npm
- Windows (primary target; `.bat` scripts and Edge App Mode)

## Setup

```bash
npm install
```

## Running

| Mode | Command | Notes |
|------|---------|-------|
| Frontend dev | `npm run dev` | Vite at localhost:5173, proxies `/api` → 8890 |
| Backend dev | `npm run dev:server` | Builds server bundle then runs at 127.0.0.1:8890 |
| Both (Windows) | `dev.bat` | Starts backend in new window, waits 4s, opens Vite dev |
| Production | `npm start` | Runs `node dist-server/index.cjs` |
| Production launcher | `scripts/windows/start-gymsystem.bat` | Starts backend, opens Edge App Mode |

## Building

```bash
npm run build    # Full build: typecheck client + server, vite build, esbuild server bundle
npm run typecheck         # Frontend TypeScript only
npm run typecheck:server  # Backend TypeScript only
```

Build output:
- `dist/` — Vite frontend (SPA)
- `dist-server/index.cjs` — esbuild backend bundle (CJS, Node 24 target)

## Testing

```bash
npm test                 # All tests (Vitest, one shot)
npm run test:watch       # Watch mode
npx vitest run tests/<file>.test.ts   # Single file
```

Test architecture:
- 20 test files in `tests/`, node environment
- `createTestDb()` helper creates in-memory SQLite + runs migrations
- `buildActor()` helper creates authenticated test actors
- Tests use their own `NodeSqliteDriver` (`:memory:` SQLite, no WAL)

## E2E

```bash
npm run e2e    # Basic: start → seed → restart → verify
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-audit.ps1   # Full 42-check audit
```

## Database

- **Never open the live database while the server is running.** SQLite WAL mode supports one writer.
- Schema changes: add a new version to `src/db/migrations.ts`. Never modify applied migrations.
- Each migration runs once, tracked in `schema_migrations` table.
- Tests use in-memory SQLite — no disk I/O.

## RPC Consistency

```bash
node scripts/check-rpc-consistency.cjs
```

Validates that every `rpc("service", "fn")` call in `src/api/index.ts` exists in `server/rpc.ts` REGISTRY, and vice versa.

## Data Locations

| Path | Contents |
|------|----------|
| `%LOCALAPPDATA%/GymSystem/Database/gym.db` | SQLite database |
| `%LOCALAPPDATA%/GymSystem/Files/` | Uploaded files (photos, reports, attachments) |
| `%LOCALAPPDATA%/GymSystem/Backups/` | `.gymbak` snapshot files |
| `%LOCALAPPDATA%/GymSystem/Logs/server.log` | Server log |

Override all with `GYMSYSTEM_DATA_DIR` environment variable.

## Debugging

- Server logs to `%LOCALAPPDATA%/GymSystem/Logs/server.log`
- Check for stale server: kill existing `node` processes before restarting
- After code changes: rebuild (`npm run build`) AND restart the server
- Frontend dev mode auto-reloads; backend does NOT

## Common Pitfalls

1. **Stale server:** the most common "missing feature" report is because the running server predates the latest build. Always rebuild + restart.
2. **Forgot to register RPC:** new service functions must be added to `server/rpc.ts` REGISTRY, or the frontend cannot call them.
3. **Missing i18n key:** the `i18n-coverage.test.ts` test catches missing Arabic translations for thrown error keys.
4. **Transaction required:** multi-statement invariants MUST use `db.transaction()`. Without it, partial failures leave inconsistent state.
5. **Permission first:** every protected service function must call `requirePermission()` as its first statement.
6. **No fetch from components:** all API calls go through `src/api/index.ts` typed wrappers.
