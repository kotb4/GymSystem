# Yassen Mohamed Kotb | 01288536381 Security

## Network

- **Loopback only:** server binds to `127.0.0.1:8890`. Never exposed to the network.
- No reverse proxy, no cloud endpoint, no external access.

## Authentication

- **Password hashing:** Argon2id via `hash-wasm` (19 MiB memory, 2 iterations, parallelism 1, 32-byte hash, 16-byte salt).
- **Lockout:** 5 failed login attempts → 300 seconds locked. Stored in `users.failed_attempts` / `users.locked_until`.
- **First-run setup:** `POST /api/auth/setup` creates the single owner. Refuses once an active owner exists.

## Sessions

- **Token:** `crypto.randomBytes(32).toString("hex")` — 128-bit cryptographically random.
- **Storage:** SHA-256 hash stored in `auth_sessions` table. Raw token never touches the database.
- **Cookie:** `gymsystem_session`, HttpOnly, SameSite=Strict, Path=/, Max-Age=43200 (12h).
- **Sliding window:** session refreshed on every valid check. Lives as long as user is active within any 12-hour window.
- **Secure flag:** opt-in via `GYMSYSTEM_SECURE_COOKIES=1` (for HTTPS environments).
- **Pruning:** expired sessions deleted at boot and after every login.

## Authorization

- **RPC whitelist:** `server/rpc.ts` REGISTRY maps `service.fn` → function reference. Unknown service/function = 403 FORBIDDEN. No information leak about what exists.
- **`requirePermission(actor, perm)`:** called as the FIRST statement in every protected service function. Owner always passes (hardcoded bypass). Non-owner roles check DB-backed `role_permissions` cache.
- **Frontend permission checks are cosmetic only** (`hasPermission()` in auth-context.tsx). The backend is the sole enforcement point.
- **UI hides buttons/tabs** based on permissions, but the backend independently validates every operation.

## Department Isolation

- Members and users carry `department ∈ {general, men, women}`.
- `assertDepartmentAccess(actor, memberDept)`: blocks cross-section access for men/women-scoped users.
- `departmentScopeCondition(actor)`: adds SQL WHERE clause to list queries.
- Bypass: owner, `members.view_all_departments`, or actor's department is `general`.

## Input Validation

- **Body size limits:** 8 MB (default), 3 MB (file upload), 256 MB (restore/import).
- **MIME whitelists:** per file kind (e.g., member_photo: JPEG/PNG/WebP).
- **File size:** max 2 MB stored on disk.
- **Path traversal:** static file serving normalizes paths and checks against `DIST_DIR`. Backup filenames validated against regex.
- **SQL safety:** parameterized queries throughout via `node:sqlite` prepared statements.
- **External input:** all HTTP bodies, query params, file uploads validated in backend services.

## IDOR Protection

- Every member operation validates: authenticated user → `requirePermission` → department access check.
- `assertDepartmentAccess` blocks horizontal privilege escalation (men-section staff accessing women-section records).
- Subscription, payment, card operations all verify the member belongs to the requesting user's scope.
- File downloads verify the requesting user has the required permission for the file kind.

## Backup & Restore

- Backup: `VACUUM INTO` produces consistent SQLite snapshot. Post-write `PRAGMA integrity_check` verification.
- Restore: validate bytes → probe integrity → protect current DB → adopt candidate → reopen.
- Restore requires `backup.restore` permission (enforced server-side, not by body size check alone).
- Protective snapshot: current DB backed up before any restore operation.
- Import legacy: may run unauthenticated ONLY when zero active owners exist.

## Prohibited Patterns

The following MUST NEVER exist in this codebase:

- Hardcoded passwords or credentials
- Private keys in client-side code
- Universal unlock codes
- License server / heartbeat / remote administration
- Remote shell / arbitrary command execution
- Hidden backdoor
- Business data in browser localStorage/sessionStorage/IndexedDB (except legacy migration code)
- Cloud storage / external API dependencies (offline-first)
- WhatsApp Web scraping or arbitrary automation

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GYMSYSTEM_DATA_DIR` | Override data directory | `%LOCALAPPDATA%/GymSystem` |
| `GYMSYSTEM_PORT` | Server port | `8890` |
| `GYMSYSTEM_HOST` | Bind address | `127.0.0.1` |
| `GYMSYSTEM_SECURE_COOKIES` | Enable Secure flag on cookies | off |
| `GYMSYSTEM_DIST` | Frontend dist directory | `<cwd>/dist` |
| `GYM_SEED_DEMO` | Seed demo data (built backend) | off |
| `VITE_SEED_DEMO` | Seed demo data (dev server) | `1` in `.env.development` |
