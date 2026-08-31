# Current AI Development Tasks

> **Reading order for the next agent:** `AGENTS.md` → `.ai/project.md` → `.ai/current-state.md` → `.ai/tasks.md` → `.ai/decisions.md` (when relevant) → inspect the actual source. The repository files are the persistent memory; chat history is not part of the project.

## TASK-014: Store POS + inventory upgrade (returns, lost stock, reports, low-stock)
- Status: done (2026-08-29) — implementation + unit tests + full verification green
- Objective: line-item sale returns, "lost" stock, store reports (daily sales, product best-sellers, stock value, gross profit), dusted low-stock lists, net-of-returns stats.
- Migration work:
  - **v21** (pre-existed in working tree, unwired): rebuilds `products` + `stock_movements` (drops `result_qty >= 0` CHECK so negative stock is allow-listed at runtime via `allow_negative_stock`), movement types `return`/`lost`, `returned_qty` on `store_sale_items`, creates `store_returns`, `allow_negative_stock` setting.
  - **v22** (added): `store_return_items` (id, return_id, sale_item_id, product_id, product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor), `store_returns` columns `return_no`, `items_total_minor`, `discount_minor`, `total_minor`, `box` (guarded via `PRAGMA table_info`), unique index on `return_no`, indexes, `store.return` permission + manager role grant. Uses `db.run` single statements (NOT `db.exec`) in the raw DDL path, mirroring the v20 pattern.
- Service (`src/core/services/store.service.ts`): `returnStoreSale` (guards over-return via `returned_qty`; dash restock via movement `return`; ledger refund reversal `refTable:store_returns`, `direction:-1`, box store; `STORE_RETURN_CREATED` audit), `getStoreReturn`, `listStoreReturns`, `getDailySalesReport`, `getProductSalesReport`, `getStockValue`, `listLowStockProducts`. `voidStoreSale`/`unvoidStoreSale` restock/reverse only unreturned qty. `adjustStock` accepts `lost`. `getStoreStats` nets out returns.
- Permissions/audit: `store.return` in `PERMS` + `MANAGER_PERMS` (NOT reception); `STORE_RETURN_CREATED` in `src/core/audit-actions.ts`.
- Wiring: `server/rpc/store.rpc.ts` (8 new fns), `src/api/index.ts` (`storeApi` + types `StoreReturnItemRow`/`StoreReturnRow`/`DailySalesRow`/`ProductSalesRow`/`StockValueRow`, `StoreSaleItem.id`/`returnedQty`), `src/pages/store-page.tsx` (Returns tab, Reports tab, ReturnModal, `lost` in stock modal, movement labels via i18n).
- i18n: `common.noPermission` added; `store.emptyReturn` added; `store.return` perm label; `errors.store.*` keys (returnNotFound/returnCreditNotAllowed/returnExceedsQty/emptyReturn/saleItemNotFound); store UI + movement keys.
- Fixed during this session: `getStoreStats`/`getDailySalesReport` referenced non-existent `store_return_items.line_cost_minor` → switched to `unit_cost_minor * qty` (the column is not persisted; cost computed in SQL). Frontend `t()` mistargets fixed (`common.apply`→`rpt.apply`; `common.noPermission` added to `common` — it was previously only under the dashboard section).
- Tests: `tests/store.test.ts` grew 17 → 28 (returns partial/full, over-return guard, credit-sale blocked, void-after-return no double-restock, `lost` movement, daily/product/stock-value/low-stock reports, report perm denials). 3 harness tests updated 20 → 22 for the new migrations (`foundation.smoke`, `part4-backup`, `restore-authz`).
- Verification: `npm test` 384/384, `npm run typecheck` clean, `npm run typecheck:server` clean, `npm run build` OK (pre-existing seed.ts `import.meta` CJS esbuild warning is non-fatal), `node scripts/check-rpc-consistency.cjs` ok. Browser UI NOT manually verified this session.

## TASK-015: Review-fix batch (security + bugs from 2026-08-31 full review)
- Status: done (2026-08-31)
- Goal: remediate the findings of the full project code+security review issued at end of TASK-014.
- Changes:
  - **CRITICAL — migration v21 FK pragma no-op (upgrade blocker).** v21 rebuilt `products` + `stock_movements` (DROP/RENAME referenced tables) and tried to disable FK inside the transaction. SQLite ignores `PRAGMA foreign_keys` inside a transaction, so any DB on v20 that had store data crashed with `FOREIGN KEY constraint failed` on upgrade. Fix: `Db.setForeignKeys(enabled)` toggles the pragma at the **connection** level; `applyMigration` toggles off before the transaction and back on in `finally` for any migration with `fkOff: true` (currently only v21). v22 untouched.
  - **purgeProduct FK** when product has return history: now deletes `store_return_items` (by product or by sale_item) before `store_sale_items` and the product; also fixed `movementsRemoved` audit field (was set to sale-line count).
  - **purgeMember FK** when member has store returns: now deletes `store_return_items` and `store_returns` (by sale_id) before `store_sale_items` and `store_sales`.
  - **unvoidStoreSale credit-debt loss:** if a void deleted the `store_debts` row for a credit sale, unvoid now recreates it (with the original member and `paid_minor=0`, status `open`) if missing.
  - **Privilege escalation (setRolePermissions):** a non-owner (e.g. manager) could call `setRolePermissions` (gated by `settings.edit`) to grant their own role `users.manage` and then promote to owner. Fix: `setRolePermissions` requires `settings.edit`, refuses to touch the `owner` role, and refuses to edit the actor's own role unless the actor is owner. Manager still edits subordinate roles (reception/trainer) per ADR-007.
  - **Privilege escalation (createUser / updateUser):** a non-owner with `users.manage` could create or promote a user to `owner`. Fix: both functions reject `roleId === "owner"` when `actor.roleId !== "owner"`.
  - **Void settled-credit-debt bypass:** `voidStoreSale` only checked `paid_minor > 0` on the *open* debt, so a fully-paid credit sale (status `paid`, no open debt) could be voided leaving debt-payment history. Fix: now blocks void when **any** `store_debt_payments` exist for the sale's debts.
  - **Reports counting returns from later-voided sales:** `getStoreStats` and `getDailySalesReport` aggregated `store_returns` without checking the parent sale is still `completed`. Fix: both now JOIN `store_sales` and filter `s.status = 'completed'`.
  - **Department scoping on store reads:** `getSale`/`listSales`/`getStoreReturn`/`listStoreReturns` previously ignored the actor's department. `getStoreReturn` and `getSale` use `assertDepartmentAccess` on the sale's member department; the list queries add a `(m.department IN (?, 'general') OR m.id IS NULL)` condition so walk-in (null-member) records stay visible to every section. `RETURN_SELECT` now also selects `s.member_id AS sale_member_id` because `store_returns` has no `member_id` column.
  - **ReportsTab default date range UTC bug:** `new Date().toISOString().slice(0, 10)` produces yesterday in timezones ahead of UTC. Replaced with `todayKey()` / `addDaysKey(todayKey(), -29)` from `@/core/dates` (local). Unused `dateKey` import removed (`noUnusedLocals`).
- Tests: `tests/migration-upgrade.test.ts` (new) seeds a v20 schema with store data, runs migrations 21+22, asserts success, data preserved, and FK still enforced afterwards. `tests/manager-permissions.test.ts` grew 5 → 8 (added: manager self-role edit blocked, manager cannot promote to owner via `updateUser`, manager cannot create an owner). All 388/388 tests pass.
- Verification: `npm test` 388/388, `npm run typecheck` clean, `npm run typecheck:server` clean, `npm run build` OK, `node scripts/check-rpc-consistency.cjs` ok.
- ADR: see `.ai/decisions.md` ADR-013 (migration FK toggle at connection level), ADR-014 (permission editor / owner-promotion guards), ADR-015 (store reads department scoping + return reports).

## TASK-013: Fix bugs from 2026-08-29 full review
- Status: done (2026-08-29)
- Fixes:
  1. Registered `/treasury` with `TreasuryPage` in `src/routes/index.tsx` (print route kept).
  2. Subscription form Save enabled when a package is selected (`!planId && !packageId`).
  3. Unlimited visit/hybrid packages use synthetic plan `kind=time`; `createSubscription` skips session-count validation when `unlimited_visits=1`; attendance/reception treat `sessions_total IS NULL` as unlimited (no consume, no NO_SESSIONS_LEFT).
  4. `listSubscriptions`: frozen = `suspended AND frozen_at IS NOT NULL`; suspended = `suspended AND frozen_at IS NULL`. Members smart-filter frozen matches the same.
  5. Added `treasury.gymCreatedToast` / `treasury.storeCreatedToast`. Treasury date default uses `todayKey()`. Dashboard expiring list uses `safeParseDateKey` / `safeDiffDaysKeys`.
- Tests: `tests/packages.test.ts` (unlimited subscribe + check-in + legacy sessions-kind), `tests/members.subscriptions.test.ts` (frozen vs suspended list). Full suite 373/373.

## TASK-012: Daily-closing treasury workflow (gym + store)
- Status: done (2026-08-28)
- Implementation: per-business-date reconciliation of expected vs counted cash per cash box with strict open/closed/reopened state machine. Migration v20 adds `daily_closings` + `daily_closing_audit_entries` + non-unique helper index `idx_daily_closings_active` on `(business_date, box) WHERE superseded_by IS NULL` (replaced an earlier UNIQUE partial index that broke the reopen transaction when both the new OPEN row and the soon-to-be-superseded row momentarily had `superseded_by IS NULL`). Service: `src/core/services/daily-closing.service.ts` (8 functions: `getOrCreateDailyClosing`, `recordCountedCash`, `closeDailyClosing`, `reopenDailyClosing`, `getDailyClosingById`, `listDailyClosings`, `getTreasurySnapshot`, `listTreasurySnapshotsForDate`). Reopen semantics: original row gets `status='reopened'`, `superseded_by=<new id>`, `reopen_count+1`; new row is OPEN with `opening_balance_minor = previous.counted_cash_minor` (carry-forward). Manager-only reopen via `cash.daily_reopen`; reception+manager can close via `cash.daily_close`. Dashboard integration: `getTreasuryForDashboard` returns `{gym, store}` snapshots. RPC: `server/rpc/daily-closing.rpc.ts`. API: `api.treasury.*` (7 wrappers). UI: `src/pages/treasury/{index,closing-form,closing-detail,closing-list,print}.tsx` + `/treasury` route + `/treasury/print/:closingId` route + `Coins` sidebar icon.
- Tests: `tests/daily-closing.test.ts` — 30 cases (UNIQUE/idempotency, expected math, voided-payments-excluded, diff calculation, reason-required-on-difference, blocked-edits-after-close, manager-only-reopen, audit logs, perm matrix, dashboard snapshot, list filtering, input validation, per-method audit entries).
- Known minor: `EffectiveSubscriptionStatus` exposes "frozen" but `listSubscriptions` SQL handler does not implement the `frozen` case; UI filter would fall through to "all" if selected. Tracked as follow-up.

## TASK-011: Strict duplicate member-name enforcement
- Status: done (2026-08-29)
- Implementation: `assertValidValues` in `src/core/services/members.service.ts` rejects `fullName` collision against any other member (including trashed, matching the existing phone-uniqueness pattern). i18n key `errors.nameTaken` added to `src/i18n/ar.ts`. Covers `createMember`, `updateMember`, and transitively `convertLead`/`convertTrial` since both call `createMember`. Note: future use of `nameTaken` should pair with the existing `nameRequired` key (errors.* namespace only).
- Tests: `tests/members.subscriptions.test.ts` — 4 new cases (create-blocked, reuse-after-purge, update-blocked, no-op-update-allowed).

## TASK-010: Defensive null-date handling for `endsAt` crash on /subscriptions
- Status: done (2026-08-29)
- Context: the previous bundle (`index-0aE826V2V.js`) had `Gs({result:e}){let n=Oo(e.subscriptionEndsAt,wo())}` which crashed with `Cannot read properties of null (reading 'endsAt')` whenever the backend returned `subscriptionEndsAt: null` (defence-in-depth — type said `string` but JSON can still send null).
- Implementation: `src/core/dates.ts` adds `safeParseDateKey(key: string | null | undefined): Date | null` (regex `/^\d{4}-\d{2}-\d{2}$/`) and `safeDiffDaysKeys(from, to): number | null`. Updated call sites: `pages/checkin-page.tsx` (`SuccessPanel`), `pages/subscriptions-page.tsx` (rows map + details modal), `pages/dashboard-page.tsx` (expiring list), `pages/member-profile/tabs/membership-tab.tsx` (rows map + details modal). All `diffDaysKeys` calls now guarded by `s.startDate && s.endDate` style checks; renderers fall back to `"—"` when input is missing.
- Tests: `tests/dates.test.ts` — 10 new cases covering valid, null, undefined, empty, malformed, single-digit, slash-separated inputs.
- Result: 370/370 → 370/370 (no regression).

## TASK-009: Cross-agent portable AI workflow (OpenCode ↔ Cursor ↔ Claude Code ↔ other)
- Status: done (2026-08-29)
- Implementation: introduces `.ai/current-state.md` as the single live-state handoff file; clarifies responsibilities across `AGENTS.md`, `.ai/tasks.md`, `.ai/decisions.md`, `docs/ai/*`; updates OpenCode agent/command prompts to read+write the same shared state; adds a minimal `.cursor/rules/gym-assistant.md` that points Cursor to the shared state without duplicating it. ADR-012 records the decision.
- Tests/verification: `npm run typecheck`, `npm test`, `npm run build` all clean; `npm run sync:docs` still works (current-state.md is NOT auto-generated, by design).

## TASK-008: Automatic documentation sync (value-level) + 0.0.0.0 LAN bind
- Status: done (2026-08-27)
- Implementation: `scripts/sync-docs.mjs` recalculates machine-checkable facts live from source (PERMS count, AUDIT_ACTIONS count, migration max version, HTTP HOST default, service/page/test file counts) and refreshes them in `AGENTS.md`, `.ai/project.md`, `docs/ai/architecture.md`, `docs/ai/database.md`. Guards against narrative drift by touching value-only patterns. Hooks: npm `sync:docs` script + `.git/hooks/pre-commit` (sh, LF-only, runs before each commit). Host default changed to `0.0.0.0` (`server/index.ts`) enabling LAN exposure.
- Tests: verified `node scripts/sync-docs.mjs` and the sh hook run to exit 0; typecheck clean.

## TASK-007: Subscription hard-delete
- Status: done (2026-08-25)
- Implementation: `subscriptions.purge` permission (migration v9) + `purgeSubscription` cascade (payments→refunds→ledger→freezes removed; attendance/bookings detached not destroyed) + RPC/API/UI in member-profile subs tab with confirm dialog; dept-scoped; ADR-008 item 4.
- Tests: tests/subscriptions-purge.test.ts (4 cases).

## TASK-006: Hard-delete surfaces for employees/products/cash sessions
- Status: done (2026-08-25)
- Implementation: permissions `employees.purge`/`store.purge`/`cash.purge` (migration v8) + services `purgeEmployee`/`purgeProduct`/`deleteCashSession` + RPC/API/UI wiring with confirm dialogs; boundaries per ADR-008.
- Tests: tests/purge-others.test.ts (5 cases incl. permission denials and sold-product/closed-session refusals).

## TASK-005: Anwar owner account + manager permission control
- Status: done (2026-08-25)
- Implementation: manager granted `settings.edit` via idempotent migration v7 + code default; Anwar to be created as role=owner from Users page (no code change needed); ADR-007 records scope decisions incl. explicit deferral of per-user permission overrides.
- Tests: tests/manager-permissions.test.ts (v7 idempotency, owner absolutism, manager edit persistence, owner-row immutability, denial without settings.edit).

## TASK-001: Full-project review remediation batch
- Status: done (2026-08-25)
- Priority: high
- Goal: Fix all findings from the initial full-project code review (5 bugs + design concerns + minors).
- Outcome:
  - Store-debt second installment UNIQUE crash fixed (ledger refId = repayment row id).
  - Void of partially-repaid credit sale now returns a proper conflict instead of raw FK error.
  - `recordCheckIn` enforces `checkin.create`.
  - Password hashing moved out of transactions (setup/createUser).
  - Open RPC functions gated (ADR-002); dead entries removed.
  - Unfreeze always closes the freeze-history row (date shift still rule-gated).
  - Cash boxes wired end-to-end at service layer (ADR-003).
  - Minors: money integer guard, cookie decode resilience, files-meta permission, employee phone i18n key, dead SQL removed, photo handlers permission-first + transactional, static stream error handler, tmp file deleted, .gitignore hardened.
  - Docs synced: purge docstring/AGENTS/business-rules corrected; permission count corrected to 68.

## TASK-002: Audit F-01 restore authorization
- Status: done (2026-08-25) — `backup.restore` gate inside `importDatabaseBytes`; legacy sentinel stored as NULL in user-FK columns.

## TASK-003: Audit F-02 backup create/download authorization
- Status: done (2026-08-25) — `backup.create` on create, `backup.restore` on download, both service-level.

## TASK-004: Remaining audit findings
- Status: done (2026-08-25, second remediation round)
- Items resolved:
  - F-03 initial git commit created.
  - F-04 department isolation extended to subscriptions/payments/attendance/store/classes/inbody/training-plans/crm (ADR-004) + regression suite tests/department-scope.test.ts.
  - F-05 purge now removes the member photo registry row inside the transaction and unlinks disk bytes in the RPC layer.
  - F-06 README synced (test count, current limitations).
  - F-09 rpc-consistency checker recognizes inline `{fn, actor}` registry entries.
  - F-10 auth-context uses api.auth.me() (no raw fetch outside src/api).
  - F-11 Secure cookie via GYMSYSTEM_SECURE_COOKIES opt-in (ADR-005).
  - F-13 route-scoped body limits (ADR-006); restore permission gate now precedes large-body buffering.
- Wontfix/documented: getBackupConfig RPC kept (gated, wrapper ready for future UI); getAllPermissions keeps unused db param by injection convention.
