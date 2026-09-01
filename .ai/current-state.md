# Current Development State

- **Last updated:** 2026-09-01
- **Current objective:** TASK-019 (file storage refactor: disk-backed files + backup inclusion + BLOB backfill) complete — all verification green
- **Last agent/tool:** Hermes (this session)

## Active tasks

- None open. TASK-019 is complete and pushed.

## What was most recently completed (handoff context)

### TASK-019 — File storage refactor: filesystem-backed assets, backup inclusion, BLOB backfill (2026-09-01)

Refactored binary file storage (member photos, InBody reports, expense attachments) from SQLite BLOB fields to the existing `%LOCALAPPDATA%\GymSystem\Files\` directory with a centralized registry (`files` table). This closes the last remaining gaps from ADR-018.

**Backend changes:**

1. **`server/files.service.ts`** — hardened the file storage layer:
   - Path-traversal guards on every filesystem access (`resolveSafe`, `normalizeRelative`).
   - Filename sanitization (`sanitizeFilename`): strips control chars, path separators, Windows-forbidden chars, leading dots.
   - Magic-byte sniffing for 4 MIME types (`image/jpeg|png|webp`, `application/pdf`).
   - Crash-safe unlink via `.pending-delete` sidecar markers + `sweepPendingDeletes()` (called on boot and after every restore).
   - New helpers: `relativePathFor`, `saveRawBytes`, `readBytesForMeta`, `purgeTrash`, `sweepPendingDeletes`.

2. **`server/context.ts`** — calls `setFilesRoot(dirs.filesDir)` + `sweepPendingDeletes()` on every boot; runs the expense-attachments BLOB backfill after migrations.

3. **`src/db/migrations.ts`** —
   - v25: adds `files.relative_path` column + backfill with legacy `<kind>/<id><ext>` layout (defensive skip if table missing).
   - v26: no-op DDL marker (BLOB backfill moved to `server/expense-attachments-backfill.ts` to keep `migrations.ts` free of node globals so the frontend tsconfig typechecks).

4. **`server/expense-attachments-backfill.ts` (NEW)** — idempotent backfill that writes legacy `expense_attachments` BLOBs to disk under `Files/expense_attachment/` and inserts matching `files` registry rows. Called from `context.ts` post-migrations.

5. **`server/backups.ts`** — backup/restore now include file assets:
   - **Backup**: appends a hand-rolled archive (length-prefixed name + length-prefixed content, 2-byte end marker) to the `.gymbak` after the SQLite bytes, with a 16-byte magic trailer (`GYMBAK-FILES-V1\n`) + 8-byte LE size.
   - **Restore**: detects trailer, extracts archive into `Files/` using the same path-traversal guard, reports `filesRestored` / `filesMissing` / `fileAssetsIncluded` in the result. Legacy `.gymbak` (no trailer) restores fine with `filesMissing=0` warning.

6. **`server/rpc/members.rpc.ts`** — `setMemberPhoto` / `removeMemberPhoto` / `purgeMember` now delete the registry row inside the transaction and unlink bytes **after** commit, so a rollback never strands a registry row referencing deleted bytes. Crash between commit + unlink is recovered by the boot-time sweep.

**Tests added / updated:**
- Foundation smoke test: `schema_migrations` count 24 → 26.
- Migration-upgrade test still passes (defensive v25 skip).
- Restore-authz tests pass with new `importDatabaseBytes` signature.
- Part4-backup test updated for `migrationVersion` 26.
- All 424 tests pass; typecheck (client + server) clean; build OK; RPC consistency clean.

**i18n additions:**
- `errors.file.rootNotConfigured`, `errors.file.pathEscape`, `errors.file.mimeMismatch`
- `errors.backupNoFilesArchive`, `errors.backupFilesMissing`, `errors.backupRestoreFailed`

**Database changes:**
- Migration v25: `ALTER TABLE files ADD COLUMN relative_path TEXT NOT NULL DEFAULT ''` + index.
- Migration v26: no-op (marker for backfill).

**Verification:**
- `npm test` — 424/424 pass
- `npm run typecheck` — clean
- `npm run typecheck:server` — clean
- `npm run build` — OK (pre-existing seed.ts CJS `import.meta` warning non-fatal)
- `node scripts/check-rpc-consistency.cjs` — 273 entries, no missing client calls
- `npx vitest run tests/i18n-coverage.test.ts` — 3/3 pass

## Known issues / follow-ups

- Browser camera capture still not live-tested (needs real webcam).
- The `.pending-delete` sweep logs to stderr; could be promoted to structured log in future.
- `expense_attachments` legacy table is intentionally not dropped (operators can compare counts before manual drop).

## Blockers

- None.

## Files changed (TASK-019)

**Created:**
- `server/expense-attachments-backfill.ts`

**Modified:**
- `server/files.service.ts` (major additions: pending-delete markers, sweep, saveRawBytes, etc.)
- `server/context.ts` (boot-time sweep + backfill invocation)
- `server/backups.ts` (file-assets archive + trailer format)
- `server/rpc/members.rpc.ts` (photo/purge unlink ordering)
- `src/db/migrations.ts` (v25 relative_path column, v26 no-op marker)
- `src/i18n/ar.ts` (new error keys)
- `tests/foundation.smoke.test.ts` (v26 count)
- `tests/part4-backup.test.ts` (v26 migrationVersion)
- `tests/restore-authz.test.ts` (v26 count)