# Current Development State

- **Last updated:** 2026-08-31
- **Current objective:** Configurable Loyalty/Rewards system implemented; committed + pushed to GitHub
- **Status:** TASK-017 (loyalty/rewards system) complete — all verification green, committed and pushed
- **Last agent/tool:** opencode (this session)

## Active tasks

- None open. TASK-017 (loyalty/rewards system) is complete, verified, and pushed. Optional future follow-ups are tracked in `.ai/tasks.md`.

## What was most recently completed (handoff context)

### TASK-017 — Configurable Loyalty/Rewards system (2026-08-31)
Full loyalty points feature: earn points from check-in, renewal, referral conversion, and paid store purchases; configurable earn rules; a redemption reward catalog (discount credit, free days, PT sessions, product, custom); an immutable append-only points ledger guarded against double-award; a member-profile Loyalty tab; and a standalone admin page (`/loyalty`).

**Backend:**
- `src/core/services/loyalty.service.ts` — settings, earn-rule CRUD, redemption-catalog CRUD, `getMemberBalance`, `listMemberTransactions`, `adjustPoints`, `redeemReward`, plus internal `applyEarnRule`/`earnPoints`/`reverseEarnedPoints`. `applyEarnRule`/`earnPoints` are **not** RPC-exposed so clients cannot forge points.
- Migration **v24** in `src/db/migrations.ts` — `loyalty_earn_rules`, `loyalty_redemption_catalog`, `loyalty_transactions`, `loyalty_credit_transactions`, `loyalty_settings`; `loyalty.view`/`loyalty.manage` permission rows (manager both, reception view); default earn-rule seed; unique partial index `uq_loyalty_tx_source_ref (source, ref_id)`.
- Earn hooks wired into existing services: attendance (check-in main + trial), subscription renewal, referral convert, store paid-cash `createSale`; store `voidStoreSale` reverses points.
- Discount redemption integration in `attendance.service.ts` `memberOutstandingMinor`: `max(0, subs + store - loyaltyUsableCreditMinor(db, memberId))` — tracked credit reduces **displayed** outstanding only, NOT `financial_ledger`/payment math (full payments integration deferred per ADR-017).
- Permissions `loyalty.view`/`loyalty.manage`; new audit actions; `server/rpc/loyalty.rpc.ts` registered in `server/rpc/registry.ts`; `src/api/index.ts` wrappers + type exports.

**Frontend:**
- `src/pages/member-profile/tabs/loyalty-tab.tsx` — balance/earned/redeemed/credit cards, redeem + adjust modals, transaction table.
- `src/pages/loyalty-page.tsx` — NEW standalone admin page (settings toggle + earn-rule CRUD + reward-catalog CRUD), registered in `src/routes/index.tsx`, `NAV_ROUTES` (`/loyalty`, `loyalty.manage`), sidebar `Gift` icon.

**i18n** (`src/i18n/ar.ts`): full `loyalty:` block, nested `errors.loyalty.*`, perms labels, `members.tabLoyalty`, `nav.loyalty`, admin-page keys.

**Tests:** `tests/loyalty.test.ts` (23 cases incl. perm denials, double-award guard, void reversal, redeem credit). Migration-version bumps 23→24 in `tests/restore-authz.test.ts`, `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts`.

## Verification (this session)

- `npm test` — **424/424** pass in 33 files (was 401; +23 loyalty).
- `npm run typecheck` — clean; `npm run typecheck:server` — clean.
- `npm run build` — OK (pre-existing seed.ts `import.meta` CJS esbuild warning is non-fatal).
- `node scripts/check-rpc-consistency.cjs` — ok (273 registry entries, no client calls missing).
- `npx vitest run tests/i18n-coverage.test.ts` — 3/3 pass.

## Files changed (TASK-017 loyalty)

- `src/core/services/loyalty.service.ts` — NEW loyalty service.
- `server/rpc/loyalty.rpc.ts` — NEW RPC; `server/rpc/registry.ts` — registered.
- `src/api/index.ts` — `loyalty` wrappers + types.
- `src/db/migrations.ts` — migration v24.
- `src/core/permissions.ts` — `loyalty.view`/`loyalty.manage`; `src/core/audit-actions.ts` — loyalty audit actions.
- `src/core/services/attendance.service.ts` — `memberOutstandingMinor` credit integration + earn hooks.
- Earn hooks in renewal / referral / store services.
- `src/pages/member-profile/tabs/loyalty-tab.tsx` — NEW tab; member-profile `types.ts` + `index.tsx` — wiring.
- `src/pages/loyalty-page.tsx` — NEW admin page; `src/routes/index.tsx` + `src/routes/nav-routes.ts` + `src/components/layout/sidebar.tsx` — route/nav.
- `src/i18n/ar.ts` — loyalty block + error keys + perms labels + `nav.loyalty`.
- `tests/loyalty.test.ts` — NEW (23 cases).
- `tests/restore-authz.test.ts`, `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts` — migration version 23→24 updates.

## Database changes

- **Migration v24** added (loyalty_earn_rules / loyalty_redemption_catalog / loyalty_transactions / loyalty_credit_transactions / loyalty_settings tables + `loyalty.view`/`loyalty.manage` permission rows + default earn-rule seed).

## Known issues / follow-ups

- Discount-redemption credit reduces **displayed** outstanding only; it does not affect `financial_ledger`, payment math, or reports. Full payments/ledger integration is a possible future feature (would require a ledger entry + payment coupling per ADR conventions).
- Store points only on paid cash member sales (not walk-ins/credit) by design.
- Manual browser verification of the Loyalty tab + admin page not yet done end-to-end (no running server confirmed this session).

## Blockers

- None.
