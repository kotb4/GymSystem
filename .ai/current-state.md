# Current Development State

- **Last updated:** 2026-08-29
- **Current objective:** TASK-014 Store POS + inventory upgrade (returns, lost stock, reports)
- **Status:** implementation + automated verification complete; browser manual check pending
- **Last agent/tool:** opencode (this session)

## Active tasks

- TASK-014 is implemented and verified at the code/test/typecheck/build level. Only manual browser verification of the Returns/Reports tabs remains (no running server confirmed this session).

## What was most recently completed (handoff context)

Store module upgraded to full POS + inventory management:

1. **Line-item sales returns** — `returnStoreSale` (migration v22 + `store_return_items`): guards over-return via `store_sale_items.returned_qty`, restocks via movement type `return`, reverses store revenue via a ledger `refund` entry (`refTable=store_returns`, `direction:-1`, box store), writes `RTN-` numbered returns, records `STORE_RETURN_CREATED` audit. Return `no` via `counters.store_return_no`.
2. **"Lost" stock** — `adjustStock` accepts `lost` movement type; new `lost` in the stock modal.
3. **Reports** — `getDailySalesReport`, `getProductSalesReport` (best-sellers net of returns), `getStockValue`, `listLowStockProducts`; new **Returns** and **Reports** tabs in the Store page.
4. **Stats** — `getStoreStats` now nets returns out of revenue/profit.
5. **Void semantics** — `voidStoreSale`/`unvoidStoreSale` restock/reverse only unreturned qty to avoid double-restock.

## Verification (this session)

- `npm test` — 384/384 pass across 30 files (was 373; store grew 17 → 28)
- `npm run typecheck` — clean
- `npm run typecheck:server` — clean
- `npm run build` — OK (pre-existing seed.ts `import.meta` esbuild CJS warning is non-fatal; server bundle written)
- `node scripts/check-rpc-consistency.cjs` — ok (no client calls missing)
- 3 harness tests updated 20 → 22 for new migrations v21+v22: `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts`, `tests/restore-authz.test.ts`

## Key fixes landed during this session

- `store_return_items` has NO `line_cost_minor` column (migration v22 defines `unit_cost_minor`/`line_total_minor`); `getStoreStats` + `getDailySalesReport` previously referenced the missing column → now compute cost as `unit_cost_minor * qty` in SQL.
- Frontend `t()` mistargets corrected: `t("common.apply")` → `t("rpt.apply")`; added `common.noPermission` to the `common` section (it previously only existed under the dashboard section); added `store.emptyReturn` UI key.

## What remains / Next recommended step

1. Hard-refresh the running app and manually verify the Store → **Returns** and **Reports** tabs (create a sale → return a line → confirm stock restock, low-stock alert, daily/product/stock-value reports render in RTL).
2. Optionally run `npm run sync:docs` (or let the pre-commit hook) to refresh the migration version / permission count facts (now v22 / 90 permissions — check exact counts before committing).
3. Working tree contains a large amount of prior uncommitted work (HR, dashboard cockpit, leads/trials/reception/packages/member-profile, daily-closing). Nothing reverted; commit only what's intended.

## Files changed (TASK-014)

- `src/db/migrations.ts` — v22 appended (store returns + `store.return` permission); v21 (pre-existing) rebuilt products/stock_movements + store_returns + returned_qty + allow_negative_stock.
- `src/core/services/store.service.ts` — returns, reports, lost, netted stats, void-unreturned logic.
- `src/core/permissions.ts` — `store.return` in PERMS + MANAGER_PERMS.
- `src/core/audit-actions.ts` — `STORE_RETURN_CREATED`.
- `server/rpc/store.rpc.ts`, `src/api/index.ts` — RPC + API wiring + types.
- `src/i18n/ar.ts` — `common.noPermission`, `store.emptyReturn`, `store.return` perm label, `errors.store.*`, store report/movement UI keys.
- `src/pages/store-page.tsx` — Returns/Reports tabs, ReturnModal, lost movement, movement-label i18n.
- `tests/store.test.ts` — 11 new cases.
- `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts`, `tests/restore-authz.test.ts` — migration-version assertions 20 → 22.

## Database changes

- New migration **v22** (`store_return_items`, store_returns columns/unique index, `store.return` permission + manager grant). v21 also present in the working tree (not yet committed).

## Known issues / follow-ups

- Browser/manual verification of the new Store tabs not yet done (no running server confirmed this session).
- `sync:docs` facts (migration v count / permission count) should be regenerated before committing.

## Blockers

- None.
