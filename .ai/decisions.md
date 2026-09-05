# Architecture Decision Log

## ADR-024: Backup file-archive integrity & safe restore (TASK-040)
- Date: 2026-09-05
- Status: accepted (supersedes ADR-018 §7's restore behavior for trailer-less legacy acceptance)
- Context: ADR-018 §7 appended a `Files/` tar archive to `.gymbak` snapshots (trailer `GYMBAK-FILES-V1\n` + 8-byte LE size + archive). Two defects made the integration fragile:
  1. **The reader never found the trailer** — it looked at a fixed `bytes.length - 24`, but the writer emits `[sqliteBytes][magic 16B][size 8B][archive]`, so the magic actually sits at `bytes.length - 8 - archiveLength - 16`. Every trailer-bearing `.gymbak` was misclassified as legacy and its file assets were **silently dropped** on restore.
  2. **The size field was written with broken arithmetic** — `value >>> (8 * i)` wraps modulo 32 in JS for `i >= 4`, so writers stored `L + (L << 32)` (both 32-bit halves equal L) instead of L. Debug hexdump confirmed `[magic][02 00 00 00][02 00 00 00][00 00]`.
- Decision:
  1. **Robust trailer reader.** `extractFilesArchive` now locates the magic with `Buffer.lastIndexOf(FILES_TRAILER_MAGIC)` and reads the full 64-bit LE size without bitwise wrap; it recovers the true size `L` whenever the high half is 0 (spec-correct writers) or equals the low half (old-writer artifact), then **validates the exact EOF boundary** so a wrongly recovered size can never be accepted as a good trailer. Writer now emits the size as two `writeUInt32LE` halves.
  2. **Verification is real.** `createServerBackup` reads `Files/` (excluding `.trash/`), records expected/archived/skipped counts, and returns `formatVersion:1`, `fileAssetsIncluded/Expected/Count/Missing`, `fullyVerified`. New pure `verifyBackupSnapshot(bytes)` classifies any buffer as `ok | missing_files | corrupt` without touching live state (DB integrity via the sealed-copy probe, manifest `sha256` verify, file-presence check).
  3. **Restore refuses corruption.** `importDatabaseBytes` validates the snapshot BEFORE any mutation: trailer parse → sealed-copy integrity probe → manifest sha256 → files-present; failures throw `VALIDATION errors.backupArchiveCorrupt` (or `errors.backupFilesIncomplete` when the DB references files that are absent — the previous "restore DB only, warn" behavior is dropped). `isSafeRelativePath` (exported from `server/files.service.ts`) gates every stored entry name to prevent extraction escapes.
  4. **Fail-safe swap.** Restore stages the extracted tree, snapshots the CURRENT DB+Files as a protective `.gymbak`, then swaps the **Files** tree first (`rename` to `.restore-old-<ts>`, failure ⇒ abort with the DB untouched) and only then adopts the DB — the protected snapshot is the recovery point if the DB swap itself fails. A rejected restore leaves zero staging/leftover artifacts and the live DB untouched (asserted in tests).
  5. **Backward compatibility.** Format unchanged, trailer-bearing V1 layout identical; old-writer backups whose size field duplicated L are parsed via the recovery rule. Pure-V1 legacy `.gymbak` (no trailer) still imports when its DB references **no** files (report `fileAssetsIncluded:false`, `fullyVerified:true`). A legacy DB referencing files is refused (the bytes genuinely don't exist).
- Consequences: end-to-end round trip (backup → destroy data dir incl. `Files/` → restore → member/photo/report bytes identical) is covered in `tests/backup-restore-integration.test.ts` (4 tests), plus refusal tests for truncated/corrupt content/mismatched-manifest archives. New i18n keys `errors.backupArchiveCorrupt`/`errors.backupFilesIncomplete`. No schema, permission, or audit-action change; tests 450 → 454. Remaining risks: an adopt-failure edge after the DB swap (the pre-restore snapshot covers it), and a legacy file whose BLOB happens to embed the trailer magic near the end (byte-exact EOF + schema size checks gate that path).

## ADR-023: Revert LAN binding — secure loopback-only default (host + first-run hardening)
- Date: 2026-09-05
- Status: accepted (security task; supersedes ADR-010's `0.0.0.0` default, keeps its env override + doc-sync machinery)
- Context: The app is a **local desktop application** (`scripts/windows/start-gymsystem.bat` opens `127.0.0.1`). ADR-010 made the backend bind `0.0.0.0` by default for LAN/Tailscale reachability, putting the HTTP API — including the **unauthenticated** first-run `/api/auth/setup` and legacy-import routes — on the wire by default. A security review made these the highest-priority fixes: default binding must be loopback-only, and first-setup/import must be race-safe and non-abusable post-initialization.
- Decision:
  1. **Loopback-only default.** `server/config.ts` gains `DEFAULT_HTTP_HOST = "127.0.0.1"` + `resolveHttpHost(override?)`; `server/index.ts` binds `127.0.0.1` unless `GYMSYSTEM_HOST` is explicitly set (override still supported, now documented as an opt-in to LAN exposure). `scripts/sync-docs.mjs` reads the default from `config.ts`.
  2. **First-setup is transactional and race-safe.** `auth.service.setup()` re-checks `countActiveOwners(db)` **inside** the `BEGIN IMMEDIATE` write transaction (mirrors the existing pre-check) so two concurrent requests cannot both create owners; exactly one wins, the other fails with `CONFLICT errors.setupAlreadyDone`. No schema change (a partial-UNIQUE on active owners was rejected: `users.manage` legitimately supports additional active owner users).
  3. **Legacy import is one-time only.** `server/backups.ts::importDatabaseBytes` now rejects `kind: "legacy_import"` whenever the live DB already has an active owner (`CONFLICT errors.setupAlreadyDone`), checked synchronously before any heavy work — closing the TOCTOU where a setup could finish during the upload and the stale unauthenticated import would still adopt over it. The route fast-fails unauth `POST /api/system/import-legacy` with 401 once an owner exists.
- Consequences: Out-of-the-box the API is only reachable on the loopback interface; LAN exposure requires an explicit `GYMSYSTEM_HOST`. First-run setup is single-winner and legacy import cannot run after initialization (restore is unaffected — still permission-gated/authenticated). Docs normalized to loopback. No schema, permission, audit-action, or i18n changes.

## ADR-022: Remove the license grace period — expiry = total lockdown
- Date: 2026-09-05
- Status: accepted (TASK-038, supersedes ADR-019 §5 grace window; owner decision in Arabic: «لو التفعيل 10 أيام يقفل بالظبط في اليوم الأخير»)
- Context: ADR-019 §5 granted a `GRACE_DAYS` (5) window after `expiresAt`, then a read-only lockdown. The owner decided there is no grace: the system must lock **exactly at `expiresAt`**, and it must be a **total lockdown** (قفل كامل تمامًا) — no read-only app access and no login, only the activation screen — because a persistent countdown banner already warns the client. Separately, `license.activate`/`deactivate` were actor-gated, so activation required a login, which contradicts "no login".
- Decision:
  1. **`GRACE_DAYS`/`graceDeadline`/`graceDaysRemaining` and the `"grace"` state are deleted** from `server/license/policy.ts`. `expiryState()` is now `now >= expiresAt` ⇒ `"expired"`, else `"active"` — the license locks on the exact boundary. `CLOCK_ROLLBACK_GRACE_MS` (the boot-tolerance for the tamper guard) is unrelated and stays.
  2. **Expired = total lockdown, not read-only.** `server/license/session.ts` keeps the existing `READONLY_ALLOWLIST` for `tampered`/`invalid` only; a new strict `FULL_LOCK_ALLOWLIST` (only `license.status/activate/deactivate` + `auth.needsSetup`) applies when state is `expired`, so NOTHING (not even pure reads) is dispatched past expiry — the whole journal of the app is sealed except the activation surface. `rpcBlockReason`'s expired reason changes `"expired_readonly"` → `"expired"`.
  3. **Activation works without a login.** `license.activate` and `license.deactivate` are converted from `a()` (actor-gated) to `p()` (plain) functions in `server/rpc/license.rpc.ts`. Safe locally: activation only accepts an Ed25519-verified `.lic` whose HWID matches this machine. The SPA locked-branch now renders ONLY `LicensePage` (login/setup removed from the locked routes).
  4. **Countdown banner kept.** `license.bannerActive` ("تبقّى {days} يوم…") remains during `active`; the `grace` banner and `graceDaysRemaining` field are removed from frontend `LicenseStatus`, `app-layout`, `license-page`, and `src/i18n/ar.ts`. `errors.license.blocked` + `bannerExpired` reworded from "قراءة فقط" to total-lock ("مقفل").
- Consequences: no read-only escape after expiry — the license now gates reads too, enforced in the same single `invokeRpc()` gate (ADR-019 §6). On-the-boundary behavior is deterministic (tested). No schema change (v29 untouched); `LOCKED` AppError code unaffected (`errAccountLocked` still uses it). The anti-rollback marker (ADR-021) keeps working and now enforces the plain expiry window.

## ADR-021: License activation marker (license_activation) — anti-rollback hardening
- Date: 2026-09-05
- Status: accepted (TASK-036-F1, extends ADR-019)
- Context: ADR-019's Phase-1+2 gate had a known gap: in state `unlicensed` the system is fully writable with no expiry ceiling, so an actor could simply delete `configDir/license.json` + `license.lic` and revert a previously-granted license to untracked full-write mode. The fix must survive deletion of both license files, must stay offline/dependency-free, and must not re-issue any grant on its own.
- Decision:
  1. **A SQLite marker written from VERIFIED payloads only.** New table `license_activation` (migration v29: `hwid` PK, `activated_at`, `issued_at`, `expires_at`, `gym`, `tier`, `last_active`, timestamps) inside `gym.db`. It is written ONLY when a signature-verified `.lic`/`license.json` payload has passed `_activateWithPublicKey` (also reflected on every boot). It can never itself mint a license — it only records that one existed.
  2. **Marker is the fallback, not the primary.** If the signed/license-state files are missing at boot, the session synthesizes a state payload from the marker (with the marker's expiry window — grace removed by ADR-022 — and the `last_active` clock-rollback guard still enforced, wall-clock-based). Deleting license files therefore can no longer escape the grant period; a user who wants read-only-escape still needs an in-app deactivation, which explicitly clears the marker (`deleteMarker`).
  3. **Marker upkeep is monotonic + best-effort.** `last_active` advances via `MAX(old, new)` (never rewinds); upsert preserves `activated_at`. Marker upkeep failures never break boot (log-only). In the cross-machine copy case the marker HWID mismatches so it stays inert on the new box.
  4. **Test seam:** `_overrideHwIdForTest(hwid)` pins the expected HWID across consecutive `initLicenseSession` calls so the marker path is testable deterministically.
- Consequences: `unlicensed`-only machines (never activated) are unchanged. Restoring a `.gymbak` older than the activation drops the marker from the DB, but the `.lic`/`license.json` files (outside the DB, per ADR-019 §3) would still persist, so the grant cannot be lost in practice. Schema version 29.

## ADR-020: Class hub merge + weekly recurring sessions (class_recurrences)
- Date: 2026-09-05
- Status: accepted (TASK-035, per user's explicit three answers)
- Context: The users wanted the التدريب section to manage gym group classes (MMA/كراتيه…) "more advanced", with trainer data. Open questions were settled by the user: (1) structure = merge trainers into one Classes hub page (تبويبات), (2) features = **weekly recurring sessions** + a **weekly timetable**, (3) trainers = full data + already-existing linking to classes. Constraints: recurring classes must not reinvent booking/attendance/consumption; must follow the append-only migration rule; must survive the legacy-adopt re-run path (migration DDL `IF NOT EXISTS` like all v6+ tables).
- Decision:
  1. **Template + materialization.** A recurrence is a lightweight template row in new table `class_recurrences` (fields: days_of_week as comma-separated JS weekday numbers 0..6 [Sun=0], start_date, start_time, duration_min≥5, optional capacity, is_active). Creating/accepting a recurrence **materializes real `class_sessions` rows** for the selected weekdays over `weeks` (clamped 1..12). Bookings/attendance/session-credit consumption therefore work unchanged on plain sessions — no branchy "recurring session" logic anywhere else.
  2. **Duplicate guard reuse.** Generation reuses the same `(class_id, session_date, start_time)` UNIQUE constraint as `createClassSession`; conflicting dates are skipped and counted, never overwritten.
  3. **Extend advances.** «توريع إضافي» (`generateRecurrenceWeeks`) starts from the day AFTER the latest existing session for that `(class_id, start_time)` (MAX(session_date)), so it adds the *following* weeks instead of re-skipping the initial window. Inactive templates reject generation (VALIDATION `classRecurrenceInactive`); stopping sets `is_active=0` and keeps already-materialized sessions.
  4. **Permissions & single audit.** create/extend/stop require `classes.manage`; list requires `classes.view` (trainer role keeps `classes.view` only). Exactly one audit action per operation (`CLASS_RECURRENCE_CREATED/EXTENDED/STOPPED`).
  5. **Hub merge.** `/classes` is a 4-tab page: الحصص + الجدول الأسبوعي (both `classes.view`), المدربون + خطط التدريب (both `trainers.view`). `/trainers` route, nav entry, and `pages/trainers-page.tsx` removed (its logic moved into `src/components/classes/` tabs unchanged — no silent removal; training plans tab preserved; member-profile training tab untouched). Route+nav gate is any-of `["classes.view","trainers.view"]` so trainer-only users keep access. Week grid is a fixed 7-column Saturday-first layout (order [6,0,1,2,3,4,5]) over `listSessions(fromDate,toDate)`; the day-name keys reuse the existing `dow.day0..6`.
- Consequences: real recurring history is just sessions (reportable, cancelable individually, editable); a stopped template is inert but auditable; the trainer role sees the catalog + schedule but not the trainers/plans tabs. No permission grants changed. Schema version 28. Follow-ups NOT chosen by the user: sport/category field, per-session trainer override, class KPI cards.

## ADR-019: Offline licensing — HWID binding + Ed25519-signed license + clock guard + read-only lockdown
- Date: 2026-09-04
- Status: accepted
- Context: The product must stop a client from (a) copying the app/database to another machine and (b) skipping annual/monthly renewals while the machine is offline. All four mechanisms the owner asked for must work with **zero internet** and **zero new dependencies** (offline-first rule / AI Safety §3). The enforcement point must be server-side (the browser holds no business data and is cosmetic-only; the backend is the only gate).
- Decision:
  1. **Asymmetric signature (Ed25519, `node:crypto` — built-in).** The developer machine holds a private key; the shipped app embeds only the corresponding public key and verifies a client-supplied `.lic` file. An attacker who inspects the public key cannot forge or re-date a license (Ed25519 unforgeability). Bundled `scripts/license-tool.mjs` generates the key pair and issues `.lic` files. Ed25519 is chosen over RSA for smaller sigs + no padding pitfalls; `node:crypto` needs no dependency.
  2. **HWID binding (dependency-free).** The `.lic` payload carries the client HWID; the app verifies the file signature AND that the payload HWID equals the *running machine's* HWID. HWID = SHA-256 over a compact JSON of stable, cheap-to-read Windows identifiers: the `MachineGuid` from `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography` (read via `reg query`, stable across NIC/CPU changes), plus MAC addresses and `hostname`/`platform`/`arch` from `node:os`, truncated to `GYM-XXXX-XXXX-XXXX-XXXX`. Copying `dist`/the DB to another PC yields a different HWID → verification fails.
  3. **License state file (not in SQLite).** Active license state + `lastActiveStamp` are held in `configDir/license.json`, deliberately OUTSIDE `gym.db` so (a) it survives backups/restores, and (b) copying the DB alone is insufficient — the state+public-key check still pins the HWID. The signed `.lic` payload is re-verified on every boot.
  4. **Clock-tamper / anti-rollback (monotonic last-seen).** `lastActiveStamp` is persisted and advanced as the app runs. At boot and periodically, if the current system time is **behind** `lastActiveStamp` by more than `CLOCK_ROLLBACK_TOLERANCE_MS` (1 h), the license is flagged **tampered** → the app refuses mutating operations and shows a "time tampering detected" screen. Day-to-day drift is tolerated; a deliberate rewind to beat `expiresAt` trips the guard.
  5. ~~Grace period + read-only lockdown.~~ **SUPERSEDED BY ADR-022.** After `expiresAt` passes, the license is now **totally locked** on the exact boundary (no grace window, no read-only mode): only `license.*` + `auth.needsSetup` are dispatched by `invokeRpc()` (HTTP 423/LOCKED, `errors.license.blocked`), and the SPA shows the activation screen only. The `tampered`/`invalid` states still use a read-only allowlist.
  6. **Single enforcement gate.** The mutation gate lives in exactly one place — `server/rpc/registry.ts::invokeRpc()` — because ALL business mutation travels through RPC (the HTTP layer has no other mutation path except the auth/backup/file endpoints which stay allowed in read-only where safe). The license session object (`server/license/session.ts`) is loaded once at boot (`server/context.ts`) and refreshed on activation/deactivation and on the periodic clock sweep.
  7. ~~Activation UX (in-app, no manual file placement).~~ When unlicensed / expired / tampered, the SPA shows a setup-style **activation screen** (à la `SetupPage`): it displays the `HWID` copyable, accepts an `.lic` file upload (or pasted base64), and posts it to `license.activate` — now a plain unauthenticated function (ADR-022 §3) so activation works without any login even under total lockdown. The server re-verifies signature + HWID + expiry, computes the state, writes the state file, and the app resumes. The developer's private key never leaves the developer machine.
- Consequences:
  - No internet and no new dependencies; all crypto is `node:crypto`.
  - A machine whose hardware changes (new mainboard/drive) may need a re-issue — the tool re-issues `.lic` for the new HWID.
  - `lastActiveStamp` moves monotonically; a legitimate user who rolls the clock back for unrelated reasons beyond 1 h gets locked to read-only and must contact the developer (the state JSON can be reset by the developer with the private key).
  - Read-only/locked classification is by explicit RPC allowlist (phase 1 now); the allowlist lives in `server/license/session.ts` (expired = `FULL_LOCK_ALLOWLIST`, tampered/invalid = `READONLY_ALLOWLIST` since ADR-022) and can be extended without schema changes.
  - Testability: all policy logic (state machine, expiry math, clock rollback, gate allowlists) is pure and unit-tested; HWID/signature primitives are tested with an ephemeral Ed25519 keypair so no real intramachine identifiers leak into CI.

## ADR-018: File storage hardening + backup inclusion + BLOB backfill
- Date: 2026-08-31
- Status: accepted
- Context: Binary assets (member photos, InBody reports, expense attachments) were already filesystem-backed via `server/files.service.ts` + the `files` registry table since v6, with `members.photo_path` and `expense_attachments` (BLOB) removed in v14/v15. However the implementation had six concrete gaps that this ADR closes: (a) the default `filesRoot` pointed at `os.tmpdir()/gymsystem-files` until `setFilesRoot` was called, so any error path before `openDatabase` could write to a discardable temp location; (b) `readFileBytes`/`deleteFile`/`unlinkFileBytes` did not assert that the resolved path remained inside `filesRoot`, leaving a path-traversal hole if a stored `original_name` ever leaked `..`; (c) there was no `relative_path` column, so the on-disk filename was re-derived from `kind` + `id` + `extname` on every read — any future re-layout required backfilling every existing file; (d) there was no real MIME sniffing beyond trusting the client-supplied `Content-Type`, so a malicious upload could declare `image/png` while shipping arbitrary bytes; (e) `purgeMember` deleted the registry row inside the transaction but unlinked the bytes **after** commit, leaving orphans if the process crashed between commit and unlink, and failing loudly if `unlink` raised; (f) `.gymbak` snapshots contained the SQLite export only — the `Files/` directory was not archived and not restored, so a restore from backup silently lost every photo/attachment.
- Decision:
  1. **Defensive defaults (no DB migration).** `setFilesRoot` is the only way to set the root; if no root is configured, `saveFile`/`readFileBytes`/`deleteFile` throw `errors.file.rootNotConfigured` instead of writing to `os.tmpdir()`. The boot path (`server/context.ts::openDatabase`) already calls `setFilesRoot(dirs.filesDir)` immediately, so normal startup is unaffected. A regression test asserts the throw.
  2. **Path-traversal guards.** Every filesystem access computes `resolved = path.resolve(filesRoot, relativePath)` and rejects (`errors.file.pathEscape`) unless `resolved === filesRoot || resolved.startsWith(filesRoot + path.sep)`. Stored `relative_path` values are normalized POSIX (`/` separators) and re-checked on read.
  3. **Stored `relative_path` (migration v25).** New column `files.relative_path TEXT NOT NULL DEFAULT ''`; the v25 callback fills it for every existing row using the legacy layout `<kind>/<id><ext>` so legacy files stay reachable. New writes always store the path explicitly. The service computes paths **only** from `relative_path` going forward — `extname(original_name)` is no longer used for resolution.
  4. **Magic-byte sniffing.** `saveFile` now requires the first bytes to match the declared MIME for `image/jpeg` (`FF D8 FF`), `image/png` (`89 50 4E 47 0D 0A 1A 0A`), `image/webp` (`RIFF....WEBP`), `application/pdf` (`%PDF-`). The check runs after the size cap; rejection is `errors.file.mimeMismatch`. The MIME whitelist per `kind` is unchanged.
  5. **Filename sanitization.** `originalName` is trimmed, capped at 200 chars, stripped of control characters and path separators (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, `\0`), then had leading dots collapsed. The cleaned name is stored for display only; the on-disk filename is still `id + sanitizedExt`.
  6. **In-transaction byte unlink.** `purgeMember` no longer deletes bytes from the registry row inside the DB transaction. Instead it (a) reads the `relative_path` of the photo, (b) records a `pending_delete` row inside the transaction, (c) commits, then (d) the `files.service` `unlinkFileBytes(meta)` function unlinks after commit using best-effort `try/catch`. A periodic sweep (`sweepPendingDeletes()` is also exported and safe to run on boot) catches any leftovers from crashes between commit and unlink. The pattern is named `.pending-delete` files in the same directory, moved to `<root>/.trash/<ts>/<basename>` until they exist there.
  7. **Backup inclusion (no schema change, just bytes).** `createServerBackup` now also tarballs `Files/` (excluding `.trash/`) into a `.tar.gz` and appends it to the `.gymbak` after a magic trailer that records the archive size. `importDatabaseBytes` reads the trailer, extracts the archive into a staging dir under `Files/.restore-staging-<ts>/`, then atomically moves every file into its `relative_path` location, overwriting only when sizes+sha256 match. Missing files are reported in the response as `filesMissing` (warning, not error). The legacy `.gymbak` without trailer is still accepted (no files restored, warning reported).
  8. **Backfill (migration v26).** The v26 callback (lives in `server/expense-attachments-backfill.ts`) inspects `expense_attachments` if it still exists; for every legacy row it (a) writes the BLOB bytes to `Files/expense_attachment/<id>.<ext>`, (b) inserts a corresponding row into `files` with `kind='expense_attachment'`, the legacy `file_name`, and the legacy `created_by`/`created_at`, (c) leaves `expense_attachments` intact (migration v15 drops it only when empty). No destructive statement runs without an explicit log line.
- Consequences: Existing on-disk photos keep working (path is computed the same way during v20 callback). New backups are larger (≈bytes of `Files/`). Legacy `.gymbak` files still restore fine but report a warning that no file assets were included. The in-transaction unlink pattern means a crash during purge leaves `.pending-delete` siblings that are swept on next boot — never lost, never blocked. Magic-byte checks add ~50 lines of hand-written sniffing and zero dependencies, in line with the project's offline-first posture.

## ADR-017: Configurable Loyalty/Rewards system
- Date: 2026-08-31
- Status: accepted (product feature)
- Context: The owner wants to reward member activity (check-ins, renewals, referrals, store purchases) with points redeemable for configurable rewards (discount credit, free days, PT sessions, products, custom). Points must be auditable and non-falsifiable from the client, and operators need an admin surface to tune rules and the reward catalog.
- Decision:
  1. **Data model (migration v24):** `loyalty_earn_rules` (action, points, points_per_minor, min_minor, enabled), `loyalty_redemption_catalog` (reward_type free_days/discount/product/pt_session/custom, title, points_cost, value_minor, days, sessions, product_id, active), `loyalty_transactions` (member_id, kind earn/redeem/adjust/void, source checkin/renewal/referral/store_purchase/manual/redemption, ref_id, delta_minor, reason, created_*), `loyalty_credit_transactions` (redemption-credit movements when a discount reward is claimed), and dedicated `loyalty_settings` (reward_enabled, store_points_per_egp). Unique partial index `uq_loyalty_tx_source_ref (source, ref_id)` prevents double-award per underlying event (void/reversal path guarded).
  2. **Permissions:** `loyalty.view` (read balances/transactions/catalog) and `loyalty.manage` (settings/rules/catalog/adjust/redeem). Manager + reception get view; manage is manager/owner. `applyEarnRule`/`earnPoints` are **not** RPC-exposed — hooks live inside each business service (check-in, renewal, referral convert, store paid-cash sale; store void reverses) so clients cannot forge points. A dedicated `loyalty.adjust` fn exists for manual operator corrections under `loyalty.manage`.
  3. **Redemption credit:** a `discount` reward claims tracked member credit (minor units) that reduces **displayed** outstanding only via `memberOutstandingMinor` in `attendance.service.ts` (`max(0, subs + store - credit)`). It does NOT rewrite `financial_ledger`/payment math; full payments/ledger integration is deferred (would need a ledger entry per ADR conventions if pursued).
  4. **Store earn scope:** points earned on **paid cash member sales** only (not walk-ins, not credit sales); voiding the sale reverses earned points.
  5. **UI:** standalone `/loyalty` admin page (`NAV_ROUTES`, `loyalty.manage`) for settings + earn-rule CRUD + reward-catalog CRUD, plus a member-profile `Loyalty` tab (balance/earned/redeemed/adjust/credit cards, transaction table, redeem + adjust modals).
- Consequences: points ledger is append-only and event-duplicate-guarded; no client one can grant themselves points. Discount redemption currently affects display only, so reports/finance figures remain untouched. Default earn rules seeded in v24 (checkin=5, renewal=50, referral=100, store_purchase=10, min spend 10000 minor). Browser UI not yet manually verified end-to-end.

## ADR-016: Member Referral System (profile tab + configurable rewards)
- Date: 2026-08-31
- Status: accepted (product feature)
- Context: The owner wants to grow the member base by rewarding existing members who refer new ones. Requires tracking referral intents (pending), converting them to joined members, granting a reward, and surfacing per-referrer stats and a leaderboard.
- Decision:
  1. **Data model (migration v23):** `members.referral_code` (nullable, generated on first referral, idempotent guarded ALTER); `referrals` (referrer_member_id, referred_name, referred_phone, status pending/joined/cancelled, converted_member_id, converted_at, notes, timestamps); `referral_rewards` (referrer_member_id, referred_member_id, referral_id, reward_amount_minor, reward_type, status granted/cancelled, granted_at); `referral_settings` (reward_amount_minor, reward_type, enabled). Money in integer piastres per project convention.
  2. **Permissions:** two new codes `referrals.view` (read list/stats) and `referrals.manage` (create/cancel/convert/settings). Granted to manager + reception by default. Owner always passes.
  3. **Business rules:** self-referral rejected (referred_phone == referrer's own phone); a referral can only be converted once (already-processed rejected); no duplicate reward for a member already converted from a referral; cancel only while pending. Rewards recorded with an audit trail; no ledger/cash impact (reward is a configurable record, not an automatic cash movement). Referrer's `referral_code` auto-generated on first create and reused.
  4. **UI:** new `ReferralsTab` inside the member profile (list + create + convert + cancel + stats + top referrers + settings). No standalone nav page in this scope.
- Consequences: Referral metadata and rewards persist across restarts; no destructive changes. Rewards do not touch `financial_ledger`/cash boxes (a future feature may make them real cash movements — would then need a ledger entry per ADR conventions). Standalone Referrals page is a possible follow-up. Browser UI not yet manually verified.

## ADR-001: Member hard-purge intentionally cascades all history
- Date: 2026-08-25
- Status: accepted (product-owner request during UAT)
- Context: The original design refused hard-delete whenever any financial/attendance record referenced a member, leaving trashed members undeletable forever. Owner explicitly requested full deletion from the trash.
- Decision: `purgeMember` (requires `members.purge`) cascades all 17 related tables in FK-safe order inside one transaction — including payments, refunds, financial_ledger rows, attendance, subscriptions/freezes, cards, store sales/items/debts/repayments, CRM messages, bookings, training plans, assessments, fitness results — then deletes the member and audits `MEMBER_PURGED` with the cascade count.
- Consequences: Financial/cash-trail rows for that member are permanently destroyed; reports reflect their absence. Supersedes the refuse-on-history guard and its docstring. Follow-up audit F-05 (purge orphaned `files` rows/disk bytes) is **CLOSED**: the registry row is deleted inside the transaction and the disk bytes are unlinked post-commit in `server/rpc/members.rpc.ts::purgeMember` (regression-tested in `tests/members.subscriptions.test.ts`).

## ADR-002: RPC authorization policy for plain reads
- Date: 2026-08-25
- Status: accepted
- Context: Several RPC entries were registered `p()` (no actor) and could not enforce permissions; audit trail, settings dumps, and a state-mutating sweep were callable by every authenticated role.
- Decision: Actor-gated (`a()` + first-statement `requirePermission`): `audit.listAuditLogs`→`audit.view`, `settings.readAllSettings`/`getBackupConfig`→`settings.view`, `trainingPlans.sweepExpiredPlans`→`training.manage`, `permissions.getRolePermissions`/`getAllPermissions`→`users.view`. Deliberately left open to all staff (catalog/config reads with no sensitive payload): payment methods list, expense categories, product categories, scanner/sound/working-days/inactive-days/checkout/freeze-extenders flags, subscriptions counters, barcode preview, `auth.needsSetup`. Dead exposure removed outright (no frontend caller): `settings.getWhatsAppConfig`, `settings.getExpiryThresholds` (remain internal service helpers).
- Consequences: Unknown-RPC behavior unchanged for whitelisted callers; frontend wrappers untouched (server injects actor). Any future `p()` registration must be justified in this log.

## ADR-003: Cash-box tagging and per-box sessions
- Date: 2026-08-25
- Status: accepted
- Context: Migration v4 introduced `cash_sessions.box` / `financial_ledger.box` with a per-box unique-open index, but services ignored the column: all ledger rows defaulted to 'gym', a second (store) session could open while arithmetic mixed both drawers.
- Decision: `insertLedgerEntry` persists `box` (default 'gym'); store sale payments, credit-sale reversals, and store-debt installments are tagged `'store'`. Sessions accept optional `box` (default 'gym'), uniqueness is enforced per box, and expected-closing math filters the ledger by the session's own box. Existing historical rows remain 'gym'.
- Consequences: Gym drawer counts no longer include store revenue. UI drawer selection is not built yet — the cash page operates on the gym box via defaults; exposing the store drawer is future UI work.

## ADR-004: Department isolation enforced across all member-scoped services
- Date: 2026-08-25
- Status: accepted
- Context: First audit (F-04) showed men/women section isolation existed only inside members.service; every other member-scoped operation accepted arbitrary member IDs (cross-section IDOR between staff).
- Decision: Shared module `src/core/services/department.ts` (`assertDepartmentAccess`, `departmentScopeCondition`, `memberDepartmentById`, bypass = owner OR `members.view_all_departments` OR staff dept 'general'). Wired into: subscriptions (create/update/status/freeze/unfreeze/renew + per-member reads + list filter), payments (record/refund/void + list filter), attendance check-in/out, store credit sale/debt repay/totals/list, classes book/cancel/status/member-lists, InBody create/delete/list/progress/results, training plans create/update/end/cancel/list (EXISTS form keeps COUNT join-free), CRM queue. Club-level aggregates gated by `reports.view`/`diagnostics.view` remain intentionally unscoped.
- Consequences: Scoped staff can no longer touch other sections via any service path; lists shrink accordingly. Financial reports stay club-wide for their existing roles.

## ADR-005: Secure cookie flag is an explicit opt-in
- Date: 2026-08-25
- Status: accepted
- Context: Audit F-11 noted the session cookie lacks `Secure`. Setting it unconditionally breaks plain-HTTP LAN deployments (cookie would be dropped), while loopback localhost works either way.
- Decision: `GYMSYSTEM_SECURE_COOKIES=1` appends `Secure` to session cookies (set + clear). Default stays off until an HTTPS terminator exists.
- Consequences: Deployment docs must mention the flag when introducing HTTPS/LAN support.

## ADR-008: Hard-delete surfaces for previously non-deletable entities
- Date: 2026-08-25
- Status: accepted (product-owner request)
- Context: "Delete anything" was untrue for employees, store products and cash sessions — they only had activate/deactivate or open/close toggles.
- Decision: Three new permissions (`employees.purge`, `store.purge`, `cash.purge`; migration v8 registers the codes, unseeded for non-owner roles → grantable from the Permissions page):
  1. **Employees** — hard delete cascades the employee's salaries and their treasury ledger rows (keyed by salary id); generated expense documents remain as historical paperwork (no structural link exists).
  2. **Products** — hard delete removes the product, its stock-movement log, AND its lines inside historical sale documents (amended same day per owner request after the initial refuse-if-sold guard felt blocking). Sale headers/totals survive; only referenced line items are detached. The PRODUCT_PURGED audit entry records movementsRemoved / saleLinesRemoved / salesAffected.
  3. **Cash sessions** — OPEN sessions may be deleted (mistaken open/abort; ledger money truth untouched). CLOSED sessions are permanently locked because their counted-vs-expected discrepancy record must never be hidden.
  4. **Subscriptions** (`subscriptions.purge`, migration v9) — hard delete removes the subscription with its payments, refunds, their treasury ledger rows and freeze history; attendance rows and class bookings SURVIVE with the subscription reference detached to NULL so visit history is never lost. Department-scoped + audited `SUBSCRIPTION_PURGED` with paymentsRemoved count.
- Consequences: Payroll purges alter historical cash totals by design (same semantics as member purge). Sold-product removal requires deactivation. Closed-session discrepancies remain permanently visible.

## ADR-007: Anwar account as second owner; manager gains the permission editor
- Date: 2026-08-25
- Status: accepted (product-owner request)
- Context: Owner wants an "Anwar" account that can literally do everything, including every destructive delete, with the ability to hand those capabilities to other accounts, and to delegate permission control over subordinate roles to the manager.
- Decision:
  1. The Anwar account is created through Users → role **owner**. Owner short-circuits every `roleHasPermission` check and cannot be locked out of the Permissions page, satisfying "anything, literally". Multiple owner accounts are supported; last-active-owner protections remain.
  2. "Delete anything" maps to the existing destructive set (`members.delete/restore/purge`, `payments.refund/void`, `expenses` void, `store.void_sale`, `subscriptions.cancel`, `users.manage`) — all inherently held by owner and grantable per-role from the Permissions page. No new backend deletion surface was invented.
  3. Migration v7 grants `settings.edit` to the manager role (idempotent, ON CONFLICT DO NOTHING) so a manager can open `/permissions` (already gated by `users.view`, which manager holds) and edit any non-owner role — i.e., control permissions for the people under them.
- Consequences: An empowered manager can escalate any role except owner (owner row is immutable by service contract). Permissions are role-scoped; true per-user overrides would require a new table + migration and are explicitly deferred. Client-side `hasPermission` uses static defaults for cosmetics only — the server cache is authoritative after boot/commit refresh.

## ADR-006: Restore request size limits are route-scoped
- Date: 2026-08-25
- Status: accepted
- Context: Every POST buffered up to 256 MB before validation (audit F-13).
- Decision: `readBody(req, limit)` defaults to 8 MB; `/api/system/restore|import-legacy` explicitly opts into the 256 MB DB-transfer limit AFTER the `backup.restore` permission check; file uploads cap at 3 MB envelope around the 2 MB stored limit.
- Consequences: Oversized bodies on ordinary routes fail fast with the standard validation error instead of consuming memory.

## ADR-010: LAN bind on 0.0.0.0 (default) + value-level auto doc sync
- Status: **superseded by ADR-023** (loopback-only default restored; the `GYMSYSTEM_HOST` override and the sync:docs host facts are kept)
- Date: 2026-08-27
- Status: accepted (product-owner request)
- Context: The backend defaulted to loopback-only (`127.0.0.1`), so it was unreachable from other LAN devices / Tailscale IPs. Separately, the AI documentation (`AGENTS.md`, `.ai/*`, `docs/ai/*`) repeatedly drifted from the code (e.g. migrations "v1..v6" while code has v1..v11), because nothing kept counts/versions in sync after edits.
- Decision:
  1. `server/index.ts` default `HOST` changed from `127.0.0.1` to `0.0.0.0` (`GYMSYSTEM_HOST` override retained), enabling LAN/Tailscale reachability out of the box.
  2. New `scripts/sync-docs.mjs` recomputes machine-checkable facts from source every run (PERMS count, AUDIT_ACTIONS count, migration max version, host default, service/page/test counts) and refreshes only those value patterns in `AGENTS.md`, `.ai/project.md`, `docs/ai/architecture.md`, `docs/ai/database.md`. It never rewrites narrative/business rules — those remain the `/docs` agent's job.
  3. Auto-run: npm `sync:docs` script for manual/agent use, plus a `.git/hooks/pre-commit` (sh, LF) that re-syncs before every commit.
- Consequences: The app is now reachable on the LAN by default (bind 0.0.0.0) — a security-relevant change; operators should keep the network trusted or re-set `GYMSYSTEM_HOST` to loopback. Document counts/versions update automatically on commit; narrative/rule drift still needs `/docs` or a human. Secure-cookie note (ADR-005) becomes more relevant now that LAN exposure is on.

## ADR-012: Single shared cross-agent memory under `.ai/` (no parallel systems)
- Date: 2026-08-29
- Status: accepted
- Context: The AI workflow was implicitly OpenCode-centric (AGENTS.md + `.opencode/` agents/commands). Switching to Cursor, Claude Code, or another agent meant the next agent lost the prior chat context and had to re-derive the live state by re-reading code. There was a temptation to spawn multiple parallel memory systems (STATE.md, TASKS.md, CHANGELOG.md, .cursor/rules/, separate Claude memory) — that would have caused drift.
- Decision:
  1. **One coherent shared memory under `.ai/`** with clear roles:
     - `.ai/project.md` — long-form project profile (idempotent, value-level auto-synced by `scripts/sync-docs.mjs`).
     - `.ai/architecture.md`, `.ai/business-rules.md` — quick-reference for AI agents (short, not narrative; full versions live in `docs/ai/`).
     - `.ai/tasks.md` — task history & roadmap (active / completed / blocked / discovered-followup).
     - `.ai/decisions.md` — Architecture Decision Record (this file).
     - `.ai/current-state.md` — live dev-state handoff. Concise, agent-maintained, **never machine-generated**. Answers: "What was the previous agent doing? Where did it stop? What should the next agent do?"
  2. **AGENTS.md is the single repository-wide entry point.** It mandates the reading order (`AGENTS.md` → `.ai/project.md` → `.ai/current-state.md` → `.ai/tasks.md` → `.ai/decisions.md` → inspect source) and explicitly states: "The repository files are the persistent memory shared between coding agents. Chat history is NOT part of the project's source of truth."
  3. **No duplicate system**: no STATE.md, no TASKS.md, no CHANGELOG.md, no `.claude/`, no separate memory schema. The existing `.ai/architecture.md` and `.ai/business-rules.md` are kept as short quick-reference; their full counterparts in `docs/ai/` are kept as human-readable long-form. They are NOT duplicates — they serve different audiences.
  4. **OpenCode agents and commands** are updated to read and write the SAME `.ai/` files (no OpenCode-only memory). `.opencode/agents/{planner,tester,reviewer,security,docs,analyze,audit}.md` and `.opencode/commands/{feature,review,test,docs,analyze,audit}.md` must reference `.ai/current-state.md` as the live-state source.
  5. **Cursor rule (`.cursor/rules/gym-assistant.md`)** is minimal and points to the shared state without duplicating AGENTS.md content.
  6. **`scripts/sync-docs.mjs`** continues to update only machine-verifiable facts (counts, versions) — it must NEVER touch `.ai/current-state.md` because that file is the agent's live context and would lose its meaning if auto-generated.
- Consequences: any future agent (Cursor, Claude Code, OpenCode) can resume the project from repository files alone. The reading order and update discipline become the contract. The workflow becomes portable.

## ADR-011: GitHub hosting (private) for version control & collaboration
- Date: 2026-08-27
- Status: accepted (product-owner request)
- Context: The repo had a single initial commit, no remote, and the app was offline-only on one machine. Owner wants a private GitHub repo for version control, history and controlled collaboration.
- Decision:
  1. Default branch renamed `master` → `main`.
  2. Remote `origin` = `https://github.com/kotb4/GymSystem` (PRIVATE), created via `gh repo create`.
  3. All work committed in one clean history commit (36a4c7d) after a security scan confirmed no DB dumps, `.env*`, logs, `.gymbak` or secrets are tracked (`.gitignore` excludes them).
  4. Collaboration stays private: collaborators added individually via GitHub repo Settings → Collaborators (invite-only) or `gh api repos/kotb4/GymSystem/collaborators/<username> -X PUT`; repo never made public.
- Consequences: Source is now version-controlled off-machine; runtime data (SQLite DB, files, backups, sealed env) remains local under `%LOCALAPPDATA%\GymSystem` and is intentionally never committed. LAN/0.0.0.0 default (ADR-010) plus private-collab means the hosted code is code only, never the live database.

## ADR-013: Migration FK toggle at connection level
- Date: 2026-08-31
- Status: accepted (code health / correctness)
- Context: Migration v21 rebuilds `products` + `stock_movements` (DROP/RENAME of tables referenced by other tables) and attempted `PRAGMA foreign_keys = OFF` inside the migration transaction. SQLite ignores `PRAGMA foreign_keys` inside a transaction, so any existing v20 DB with store data crashed with `FOREIGN KEY constraint failed` on upgrade. The migration runner (`applyMigration`) already wraps migrations in `db.transaction()` (BEGIN IMMEDIATE), making the pragma a no-op.
- Decision: Add a connection-level FK toggle (`Db.setForeignKeys(enabled)`) and a migration flag (`Migration.fkOff: boolean`). In `applyMigration`, if `fkOff` is true, disable FK at the connection level, run the migration transaction, then re-enable FK in a `finally` block. Mark migration v21 with `fkOff: true`. Keeps migrations append-only (never mutate an old migration) while fixing the upgrade path.
- Consequences: Existing v20 DBs with store data can now upgrade to v21+v22 without FK errors. The pragma is truly off during the DDL, ensuring the rebuild succeeds. FK re-enabled after each migration preserves data integrity. No schema change — only the migration runner logic changed.

## ADR-014: Privilege escalation guards (setRolePermissions, createUser, updateUser)
- Date: 2026-08-31
- Status: accepted (security hardening)
- Context: Two escalation paths: (1) a manager with `settings.edit` could call `setRolePermissions` to grant their own role `users.manage`, then promote to owner via `updateUser`; (2) `createUser`/`updateUser` allowed a non-owner with `users.manage` to create or set `role_id = 'owner'`. The owner role is supposed to be absolute and immutable except by the owner.
- Decision:
  - `setRolePermissions` retains `requirePermission(actor, "settings.edit")`, refuses to edit the `owner` role (silent no-op), and refuses to edit the actor's own role unless `actor.roleId === "owner"` (blocks self-escalation). Manager can still edit subordinate roles (reception/trainer) per ADR-007.
  - `createUser` and `updateUser` reject `roleId === "owner"` when `actor.roleId !== "owner"`.
- Consequences: The manager permission-control feature (ADR-007) is preserved — managers edit subordinate roles but cannot escalate to owner; the owner role's absolutism is preserved. Regression tests added in `tests/manager-permissions.test.ts`.

## ADR-015: Store reads department-scoped; return reports fixed
- Date: 2026-08-31
- Status: accepted (correctness + security)
- Context: `getSale`, `listSales`, `getStoreReturn`, `listStoreReturns` lacked department scoping (cross-section read). `getStoreStats` / `getDailySalesReport` aggregated returns from sales that could later be voided, overstating revenue. `store_returns` has no `member_id` column, so scoping must go through the sale's member.
- Decision:
  - `getSale`, `listSales`: `assertDepartmentAccess` (getter) / list-condition via `departmentScopeCondition` on `store_sales.member_id`; null-member (walk-in) stays visible to every section (`m.department IN (?, 'general') OR m.id IS NULL`).
  - `getStoreReturn`: post-fetch `assertDepartmentAccess` via the sale's `member_id` (selected as `s.member_id` in `RETURN_SELECT`).
  - `listStoreReturns`: list-condition via `departmentScopeCondition` on the sale's member (same null-member rule).
  - `getStoreStats` / `getDailySalesReport`: JOIN `store_returns r` to `store_sales s`, filter `s.status = 'completed'` when aggregating returns.
  - Fixed the missing `store_return_items.line_cost_minor` bug (compute cost as `unit_cost_minor * qty`).
- Consequences: Store reads respect the actor's department (walk-in always visible); return analytics only count returns from still-completed sales. No regression; coverage added in `tests/manager-permissions.test.ts` and `tests/migration-upgrade.test.ts`.
