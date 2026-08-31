# Current Development State

- **Last updated:** 2026-08-31
- **Current objective:** Store POS + review fixes completed; ready for manual UI verification + commit
- **Status:** TASK-014 (store POS) and TASK-015 (review remediation) both done — all verification green
- **Last agent/tool:** opencode (this session)

## Active tasks

- None open. TASK-014 (store POS upgrade) and TASK-015 (review-security/bug fix batch) both complete. Next: manual UI verification of the Store Returns/Reports tabs, optional `npm run sync:docs`, then commit.

## What was most recently completed (handoff context)

### TASK-015 — Review-security + bug fix batch (2026-08-31)
1. **Migration v21 FK blocker (CRITICAL)** — `PRAGMA foreign_keys = OFF` was issued *inside* the migration transaction (a no-op in SQLite), so any v20 DB with store data crashed with `FOREIGN KEY constraint failed` on upgrade. Added `Db.setForeignKeys(enabled)` + `Migration.fkOff`; `applyMigration` toggles FK off/on at the connection level around the rebuild. Verified by new `tests/migration-upgrade.test.ts` (seeds v20 store data, runs 21+22, asserts success + data preserved + FK still enforced).
2. **`purgeProduct`** now deletes `store_return_items` (by product or sale-item) before `store_sale_items` and fixes the `movementsRemoved` audit count; **`purgeMember`** now deletes `store_return_items` + `store_returns` before `store_sale_items`/`store_sales`. Both previously threw FK errors when returns existed.
3. **`unvoidStoreSale`** now recreates the `store_debts` row for credit sales (the void had deleted it permanently).
4. **Privilege escalation closed:**
   - `setRolePermissions` requires `settings.edit` **and** refuses to touch `owner` and **refuses to edit the actor's own role unless owner** — manager can still edit subordinate roles (ADR-007).
   - `createUser` / `updateUser` reject `roleId === "owner"` for non-owner actors.
5. **`voidStoreSale` credit-settled bypass** — now blocks void when any `store_debt_payments` exist for the sale's debts (not just open-debt paid_minor).
6. **`getStoreStats` / `getDailySalesReport`** now JOIN `store_sales s` and only count returns whose sale is still `status='completed'`.
7. **Department scoping** — `getSale`, `listSales`, `getStoreReturn`, `listStoreReturns` now enforce the actor's department (walk-in null-member records stay visible to every section). `RETURN_SELECT` now selects `s.member_id AS sale_member_id` because `store_returns` has no direct `member_id` column.
8. **`ReportsTab` default dates** now use `todayKey()` / `addDaysKey(todayKey(), -29)` (local) instead of UTC `toISOString()`.

### TASK-014 — Store POS + inventory upgrade (2026-08-29)
Line-item sales returns (`store_returns`/`store_return_items`, migration v22), `lost` stock movement, store reports (daily sales, product best-sellers, stock value, gross profit, low-stock), Returns/Reports tabs in the Store page, netted stats. Fixed a missing `store_return_items.line_cost_minor` bug (compute as `unit_cost_minor * qty`).

## Verification (this session)

- `npm test` — **388/388** pass in 31 files (was 384; +1 migration-upgrade test, +3 manager-permissions tests → 8 total).
- `npm run typecheck` — clean; `npm run typecheck:server` — clean.
- `npm run build` — OK (pre-existing seed.ts `import.meta` CJS esbuild warning is non-fatal).
- `node scripts/check-rpc-consistency.cjs` — ok (no client calls missing from registry).

## Files changed (TASK-015 review batch)

- `src/db/migrations.ts` — `Migration.fkOff`, `applyMigration` FK toggle, v21 uses the guarded path (no pragma-in-tx).
- `src/db/engine.ts` — `Db.setForeignKeys(enabled)`.
- `src/core/services/store.service.ts` — purge FK order, void/unvoid debt handling, reports completed-sales filter, `assertDepartmentAccess`/scoping on reads, `RETURN_SELECT` member_id.
- `src/core/services/members.service.ts` — purgeMember return cleanup.
- `src/core/services/permissions.service.ts` — self-role / owner-role guard in `setRolePermissions`.
- `src/core/services/users.service.ts` — owner-promotion guards in `createUser`/`updateUser`.
- `src/pages/store-page.tsx` — `ReportsTab` local date keys.
- `tests/migration-upgrade.test.ts` — NEW. `tests/manager-permissions.test.ts` — +3 cases.

## Database changes

- **None** (no new migration; the v21 fix changes how the *runner* runs migrations, not the schema).

## Known issues / follow-ups

- Manual browser verification of the Store **Returns** and **Reports** tabs not yet done (no running server confirmed this session).
- Department scoping on the remaining CPU lists (attendance, card/search endpoints) still needs a follow-up pass per the reviewer report — not part of the store-fix batch.

## Blockers

- None.
