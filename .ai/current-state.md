# Current Development State

- **Last updated:** 2026-08-31
- **Current objective:** Member Referral System implemented; committed + pushed to GitHub
- **Status:** TASK-016 (member referral system) complete — all verification green, committed and pushed
- **Last agent/tool:** opencode (this session)

## Active tasks

- None open. TASK-016 (member referral system) is complete, verified, and pushed. Optional future follow-ups are tracked in `.ai/tasks.md`.

## What was most recently completed (handoff context)

### TASK-016 — Member Referral System (2026-08-31)
Complete end-to-end referral feature: refer members, track conversion to joined members, grant rewards, per-referrer stats, top-referrers leaderboard, configurable reward settings. Exposed as a new tab in the member profile.

**Backend:**
- `src/core/services/referral.service.ts` — full CRUD (create/list/cancel), conversion (`convert` guards already-processed, self-referral, duplicate reward), settings get/update, stats, top referrers.
- Migration **v23** in `src/db/migrations.ts` — idempotent `ALTER TABLE members ADD COLUMN referral_code` (guarded via `PRAGMA table_info`, matching v22 pattern so legacy-import tests don't break) + 3 tables (`referrals`, `referral_rewards`, `referral_settings`) + `referrals.view`/`referrals.manage` permission + role grant inserts.
- Permissions `referrals.view` / `referrals.manage` in `PERMS`, `MANAGER_PERMS`, `RECEPTION_PERMS`.
- Audit actions `REFERRAL_CREATED`/`CONVERTED`/`CANCELLED`/`REWARD_GRANTED`/`REWARD_CANCELLED`.
- `server/rpc/referral.rpc.ts` + registered in `server/rpc/registry.ts`.
- `src/api/index.ts` — `referral` wrappers + type exports.

**Frontend:**
- `src/pages/member-profile/tabs/referrals-tab.tsx` — named export `ReferralsTab`, matches project component conventions.
- `src/pages/member-profile/types.ts` (`TabKey` += `"referrals"`), `index.tsx` (tab def + conditional render + convert call `api.referral.convert(...)`).

**i18n** (`src/i18n/ar.ts`): full `referral:` block, missing keys (`referral.desc`, `.emptyTitle`, `.emptyDescription`, `.confirmConvert`, `.confirmCancel`), `common.egp`, error keys (`referralNotFound`, `referralSelfReferral`, `referralDuplicateReward`, `referralAlreadyProcessed`), perms labels (`referrals.view`/`referrals.manage`).

**Tests:** `tests/referral.test.ts` (13 cases). Migration-version bumps in `tests/restore-authz.test.ts`, `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts` (22→23); `tests/migration-upgrade.test.ts` added a `members` table to its v20 skeleton + comment updated.

**Key fixes during the session:** migration v23 idempotency; `node:crypto` import removed (frontend typecheck has no node types — use global `crypto.randomUUID()`); synchronous `db.transaction(() => …)`; removed unused locals (`noUnusedLocals`); i18n edits handled via temp `.cjs` script (PowerShell node -e corrupts Arabic/CRLF).

## Verification (this session)

- `npm test` — **401/401** pass in 32 files (was 388; +13 referral, migration-version bumps).
- `npm run typecheck` — clean; `npm run typecheck:server` — clean.
- `npm run build` — OK (pre-existing seed.ts `import.meta` CJS esbuild warning is non-fatal).
- `node scripts/check-rpc-consistency.cjs` — ok (no client calls missing from registry; informational list unchanged).

## Files changed (TASK-016 referral system)

- `src/core/services/referral.service.ts` — NEW referral service.
- `server/rpc/referral.rpc.ts` — NEW RPC; `server/rpc/registry.ts` — registered.
- `src/api/index.ts` — `referral` wrappers + types.
- `src/db/migrations.ts` — migration v23 (idempotent ALTER + referrals/referral_rewards/referral_settings + perm inserts).
- `src/core/permissions.ts` — `referrals.view`/`referrals.manage`; `src/core/audit-actions.ts` — 5 referral audit actions.
- `src/pages/member-profile/tabs/referrals-tab.tsx` — NEW tab; `types.ts` + `index.tsx` — wiring.
- `src/i18n/ar.ts` — referral block + error keys + perms labels + `common.egp`.
- `tests/referral.test.ts` — NEW (13 cases).
- `tests/restore-authz.test.ts`, `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts`, `tests/migration-upgrade.test.ts` — migration version 22→23 updates.

## Database changes

- **Migration v23** added (referrals / referral_rewards / referral_settings tables + `members.referral_code` column + `referrals.view`/`referrals.manage` permission rows).

## Known issues / follow-ups

- No dedicated referral management page separate from the member-profile tab (rewards/leaderboard live in the same tab). If a standalone Referrals page is desired later, wire `NAV_ROUTES` + a page — current scope is tab-only.
- Manual browser verification of the Referrals tab not yet done (no running server confirmed this session).

## Blockers

- None.
