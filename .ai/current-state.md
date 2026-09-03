# Current Development State

- **Last updated:** 2026-09-04
- **Current objective (done):** TASK-021 — **removed the daily closing (الإغلاق اليومي) feature entirely** (product decision). `/الخزينة` (`/treasury`) is now **cash sessions (الوردية) only**, gated by `payments.view`. `cash.daily_close`/`cash.daily_reopen` permissions removed; migration **v27** drops `daily_closings` + `daily_closing_audit_entries` + indexes + revokes the seeded grants; dashboard KPI card removed. Cleanup (TASK-022-adjacent): removed the dead `import.meta` branch in `shouldSeedDemo()` → **`npm run build` is now fully clean (no CJS warning)**; corrected false `VITE_SEED_DEMO` dev-seeding claims in docs.
- **Last agent/tool:** opencode (this session)

## Active tasks

- **TASK-021** — extended: resolved الاشتراكات / الباقات duplicate. Attendance fast-tab removal pushed (`cc3bdb8`); subscriptions+packages+plans merge/tab-reorder pushed (`29de98e`); packages-primary interface pushed (`9f53d30`). This session: phase 9 merged `/cash` + `/treasury` into a tabbed `/treasury` (pushed `7ac7420`), phase 10 removed the tabs → single `/treasury` page (cash session primary + daily closing below), and phase 11 (current) **removed the daily-closing feature entirely** so `/الخزينة` = cash sessions (الوردية) only (migration v27, pending push).

## What was most recently completed (handoff context)

### TASK-020 — Subscriptions page blank-screen fix (2026-09-02)
Fixed `FreezeSubscriptionModal` crash that blanked the whole /subscriptions page: it read a prop inside its initial `useState` while the parent always mounted it with `subscription={null}`, so `null.endDate` threw. Fix: made the `subscription` prop nullable, `if (!open || !sub) return null;` before any hooks, renamed `subscription`→`sub`, dropped `as Subscription` casts. Committed/pushed (`04bdf28`). Also added an `ErrorBoundary` (`src/components/ui/error-boundary.tsx`) in `src/main.tsx` so a single crash can no longer blank a whole route.

### TASK-021 — Page consolidation & sidebar reorganization (2026-09-02, in progress)
Consolidate small admin/pages into shared shells and reorder the sidebar.

**Phase 1 (done, pushed `18ff360`): assign-card quick action.** Added `members.qaAssignCard` i18n + `cards.assign`-gated `assignCard` quick action (`BadgePlus`) on member profile wired to the existing `cardModalOpen` state.

**Phase 2 (done, this session): /staff page.** Extracted `UsersTab` (`src/components/staff/users-tab.tsx`) + `PermissionsTab` (`src/components/staff/permissions-tab.tsx`) from the old pages; `users-page.tsx`/`permissions-page.tsx` now re-export them (legacy `/users` + `/permissions` routes preserved). New `src/pages/staff-page.tsx` renders both as Tabs, gated by `users.view`. Added `/staff` to `NAV_ROUTES` + sidebar `ICONS`. `nav.staff` i18n key added previously.

**Phase 3 (done, this session): Settings tabs.** Extracted `HealthTab` (`src/components/settings/health-tab.tsx`) + `ScannerTab` (`src/components/settings/scanner-tab.tsx`); `health-page.tsx`/`scanner-diagnostics-page.tsx` re-export them (legacy routes preserved). `settings-page.tsx` became a 3-tab shell: general (settings cards), backups (`HealthTab`), scanner diagnostics (`ScannerTab`). Added `settings.backupsTab` + `settings.scannerDiagTab` i18n keys.

**Phase 4 (done, this session): grouped sidebar.** Added `group: NavGroup` to every `NAV_ROUTES` entry + `NAV_GROUP_ORDER`; sidebar now renders group headers (`nav.group.*`) and only shows groups with ≥1 visible route. Cleaned-up canonical sidebar set: removed `/users`,`/permissions`,`/scanner`,`/health` (their pages now live under /staff + /settings; legacy *routes* still resolvable), and removed the dangling `/hr` icon map entry + `nav.hr` i18n key. Added missing sidebar icons for `/store` (ShoppingBag), `/classes` (ListChecks), `/crm` (MessageSquare).

**Phase 5 (done, pushed `1c88c86`): merged attendance screens.** Merged the two overlapping attendance pages (fast barcode/card check-in + reception search) into a single `/attendance` page with tabs. Extracted `FastCheckInTab` + `ReceptionTab` into `src/components/attendance/`; `checkin-page.tsx`/`reception-page.tsx` re-export them. Sidebar uses single `/attendance` entry. Added i18n `nav.attendance`, `nav.attendanceFast`, `nav.attendanceSearch`.

**Phase 6 (done, pushed `cc3bdb8`): removed fast attendance tab.** Per user request, deleted the "fast (barcode/card)" tab + `/checkin` page entirely — the reception/search screen is now the only attendance UI. Deleted `fast-checkin-tab.tsx`, `checkin-page.tsx`, `attendance-page.tsx`. `/attendance` route now renders `ReceptionPage` gated by `reception.view`; removed `/checkin` route + imports; `NAV_ROUTES` `/attendance` gated by `reception.view`. Removed dead i18n keys `nav.attendanceFast`/`nav.attendanceSearch`. Backend `checkin.*` permissions + `recordCheckIn` engine are KEPT because `reception.checkIn` delegates to them (manager + reception roles already carry `checkin.create` + `checkin.view_history`).

**Phase 7 (done, pushed `29de98e`): merged subscriptions + packages + plans into one screen.** Per user request, `/subscriptions` (الاشتراكات) now consolidates الاشتراكات + الباقات + الخطط as one tabbed screen. `SubscriptionsPage` gained a 3rd tab الباقات (renders `<PackagesPage />`, which internally has الباقات + مقارنة tabs) gated by `packages.view`; kept existing الاشتراكات (`subs`) + الخطط (`plans`) tabs. Removed `/packages` from `NAV_ROUTES` sidebar (legacy `/packages` route in `routes/index.tsx` kept for bookmark compat, still renders `PackagesPage`). No backend/schema/permission changes. Note: subscriptions reference `membership_plans` (خطط), while الباقات is a separate richer catalog (time/visit/hybrid + compare).

**Phase 8 (done, pushed `9f53d30`): resolved the "two الباقات" duplication — modern `packages` is now THE interface.** Investigation revealed the `plans` tab in `/subscriptions` was actually labeled "الباقات" too (i18n `plans.tabPlans: "الباقات"`), so there were two tabs both named الباقات (legacy `PlansGrid` from `membership_plans` vs modern `PackagesPage` from `packages`). Per user decision ("الباقات هي الواجهة"), `SubscriptionsPage` now shows only 2 tabs (`subs` + `packages`); the legacy `PlansGrid`/`PlanFormModal` (simple plans) is moved to a secondary sub-view toggled by an "إدارة الخطط البسيطة" button (with back). `SubscriptionFormModal` now defaults to the first package when packages exist (packages are the primary choice; simple plan remains a secondary fallback). Backend/schema untouched — `membership_plans` remains the load-bearing table for attendance/reports/payments via synthetic plans. Added i18n `plans.secondaryManage`.

**Phase 9 (done, this session): merged the two confusing financial pages into one clarified screen.** User: "خزينة النادي والاغلاق اليومي مش مفهومين". Approved direction: rename/clarify + redesign + fix broken UI + merge into one page. `/treasury` is now the single tabbed container "الخزينة النقدية" with 2 tabs:
- **الإغلاق اليومي** (`tabClosing`) — the daily closing: expected (from ledger) vs counted per box (النادي/المتجر), reopen/print/history/detail. Copied from old treasury page.
- **ورديات الخزينة** (`tabSessions`) — the cash drawer sessions (open/close session, counted vs expected difference, history). `cash-page.tsx` became `CashSessionsPanel` (page title removed) embedded as the tab; a new `CashSessionsPage` wrapper re-exports the standalone page for the kept legacy `/cash` route.
Nav: removed `/cash` sidebar entry (was `payments.view`); single `/treasury` entry now gated by `permissions: ["cash.daily_close", "payments.view"]` (any-of) so nobody loses access — a `payments.view`-only user sees only the ورديات tab. `nav.cash` i18n key removed; renamed `nav.treasury` → "الخزينة النقدية".
Broken-UI fixes in the closing panel: removed two dead `value="" onChange={()=>{}}` reason inputs; removed the misleading duplicate "counted cash (نقدي)" box in the detail financials (it wrongly showed `expected.cash` as counted — real counted is `countedCashMinor`, already shown in the closed section); simplified "إنشاء / تحديث السجل" → "إنشاء سجل الإغلاق اليومي" with clearer hint; box cards now titled صندوق النادي/المتجر with a shared `closingCardHint`. Added i18n `treasury.tabClosing`/`tabSessions`/`tabClosingHint`/`tabSessionsHint`/`closingCardHint`. Backend/schema untouched.

**Phase 10 (done, this session): single-page `/treasury` — no tabs, the cash session (الوردية) is the PRIMARY daily tool, daily closing merged below.** User decisions: (1) "الوردية (cash session) هي الأساسي" — it's what they operate every shift; (2) "ادمج الورديات جوه الإغلاق اليومي" — merge, don't keep separate; (3) "صفحة واحدة بدون تبويبات". Rewrote `TreasuryPage` in `src/pages/treasury/index.tsx`: removed the `Tabs` container entirely. New layout reads top-to-bottom:
- Page header (الخزينة النقدية).
- **وردية الخزينة** (primary) — renders `<CashSessionsPanel />` (open-session KPIs + open/close form + سجل الورديات), gated by `payments.view`. Each section gets a heading row with a neon icon + hint (`sessionSectionHint`).
- **الإغلاق اليومي** — renders `<DailyClosingPanel />` (expected-by-method per box النادي/المتجر + خزينة اليوم KPI + سجل الإقفال + detail), gated by `cash.daily_close`.
- Forbidden (EmptyState) only if the actor has neither permission. A `payments.view`-only user sees just the وردية section; a `cash.daily_close`-only user sees just الإغلاق اليومي.
Removed the now-unused tab keys from i18n: `tabClosing`/`tabSessions`/`tabClosingHint`/`tabSessionsHint`; added `treasury.dailyClosingTitle`/`dailyClosingSectionHint`/`sessionSectionHint`; updated `treasury.subtitle`. Removed the `Tabs` import + `TreasuryTab` type from `treasury/index.tsx`. Backend/schema untouched. Verification: `npm run typecheck` clean, i18n coverage 3/3, `npm test` 424/424 (33 files), `npm run build` OK (pre-existing seed.ts CJS `import.meta` warning, non-fatal).

**Phase 11 (done, this session): removed the daily closing (الإغلاق اليومي) feature ENTIRELY — `/الخزينة` = الوردية only.** User decisions: "حذف الميزة كاملة من النظام" + "الخزينة = الوردية فقط" (Recommended). This is a full, clean removal across the whole stack:
- `/treasury` (`src/pages/treasury/index.tsx`) rewritten to a minimal page = header + `<CashSessionsPanel/>` (cash sessions, gated `payments.view`). Deleted `closing-detail.tsx`/`closing-form.tsx`/`closing-list.tsx`/`print.tsx` + the `/treasury/print/:closingId` route.
- Backend: deleted `src/core/services/daily-closing.service.ts` + `server/rpc/daily-closing.rpc.ts`; removed the `dailyClosing` registration from `server/rpc/registry.ts` and `getTreasuryForDashboard` from `dashboard.rpc.ts` + `dashboard.service.ts` (incl. `DashboardTreasurySection` type + the daily-closing import). Removed `api.treasury.*` wrappers + exported types in `src/api/index.ts`.
- Permissions: removed `cash.daily_close` + `cash.daily_reopen` from `PERMS`/`MANAGER_PERMS`/`RECEPTION_PERMS` + i18n `perms` keys. Audit actions: removed `DAILY_CLOSING_*`. Dashboard: removed the treasury KPI card + related state/fetch from `dashboard-page.tsx`.
- Migration **v27** (append-only): `DROP TABLE daily_closing_audit_entries` → 3 indexes → `daily_closings`, and `DELETE`s the seeded `cash.daily_close`/`cash.daily_reopen` permission + role-grant rows. Cash sessions (`cash_sessions`) untouched.
- i18n: removed the unused `treasury.*` block (kept only `title`/`subtitle`/`sessionSectionHint`) and the unused `errors.treasury.*` block.
- Tests: deleted `tests/daily-closing.test.ts` (was 30 cases); bumped the 3 hardcoded migration-version assertions 26→27 (`foundation.smoke.test.ts`, `part4-backup.test.ts`, `restore-authz.test.ts`).
- Verification: `npm run typecheck` clean, `npm run typecheck:server` clean, i18n coverage 3/3, `npm test` **394/394** (32 files), `npm run build` OK (pre-existing seed.ts CJS `import.meta` warning non-fatal), `node scripts/check-rpc-consistency.cjs` ok (264 entries, no missing).

**Phase 12 (done, this session): cleaned build warning + corrected dev-seeding docs.**
- Removed the **dead `import.meta` branch** in `shouldSeedDemo()` (`src/db/seed.ts:12-19`). This branch was never executed — `shouldSeedDemo()` is called only by `server/context.ts` (the Node/CJS backend bundle, which always took the `process.env` path), and no frontend code imports it. It tripped the esbuild CJS `import.meta` warning. `shouldSeedDemo()` now checks only `process.env.GYM_SEED_DEMO === "1"`. **`npm run build` is now fully clean** (`node scripts/build-server.mjs` → exit 0, no warning; the only remaining note is Vite's cosmetic chunk-size suggestion, unrelated).
- Corrected inaccurate dev-seeding docs: seeding runs only in the backend; the frontend `VITE_SEED_DEMO` from `.env.development` does **not** reach the Node server process, so it never seeded. Dev seeding = `set GYM_SEED_DEMO=1 && npm run dev:server` (the README already said this). Fixed AGENTS.md (§2), `.ai/architecture.md`, `docs/ai/security.md`.
- Verification: `npm run typecheck` clean, `npm test` **394/394**, `npm run build` clean.

## Known issues / follow-ups

- Browser camera capture still not live-tested (needs real webcam).
- `scripts/e2e-audit.ps1` (66-check audit) now **passes all 66 checks** (exit 0). Two stale audit assertions fixed (test-data only, no product change): (1) "frozen subscription denied" asserted the old deny-on-frozen-scan behavior, but the product intentionally **auto-unfreezes on check-in** (unit-tested in `tests/subscriptions.freeze.enhanced.test.ts`) — the audit now asserts the scan is granted; (2) the member-photo upload sent an `object[]` body that PowerShell transmitted as text, failing the JPEG magic-byte sniff (ADR-018 §4) — now built as a true `byte[]` with `FF D8 FF E0` header so it uploads as binary.
- `npm run e2e` (e2e-smoke) **passes all 24 checks**; corrected the stale `unauthenticated /me` check in `scripts/e2e-smoke.ps1` — the server intentionally returns `200 {needsSetup:true}` (not 401) for unauthenticated `/api/auth/me`, so the old check asserted the opposite of the documented behavior.
- Legacy `/users`, `/permissions`, `/health`, `/scanner`, `/reception`, `/packages`, `/cash` routes still registered in `routes/index.tsx` (direct-bookmark compat) but no longer listed in the sidebar; could be removed once confirmed unused. (`/checkin` route removed this session.) `/cash` (legacy `CashSessionsPage` wrapper) and the canonical `/treasury` both render cash sessions; keep `/cash` until operators confirm the old bookmark is unused.
- The daily-closing feature (الإغلاق اليومي) is fully removed (tables, permissions, service, RPC, UI, dashboard). A full-repo sweep (source + docs, excluding the historical migration v20 definition and tasks/current-state history) confirmed **no stale references remain**; the last one fixed was the `treasury.subtitle` i18n string, which still mentioned daily-closing reconciliation and was updated to describe the cash-sessions-only page.
- No i18n-coverage regression: shared `checkin.*` keys retained (used by dashboard `checkin.recent`/`checkin.noScans`, member-profile `checkin.deniedTitles`/`checkin.successTitle`, employee-checkin `checkin.submit`).
- Some `checkin.*` fast-tab-only keys (e.g. `scanTitle`, `scanHint`, `quickTitle`, `fieldBarcode`) are now unused but retained (harmless; coverage test checks only that used keys exist).
- `nav.packages` i18n key is now unused (sidebar entry removed) but retained harmlessly; `/packages` legacy route still used by some flows.

## Blockers

- None.

## Files changed (TASK-021, this session)

**Removed (phase 11 — daily-closing feature deleted entirely):**
- `src/core/services/daily-closing.service.ts`, `server/rpc/daily-closing.rpc.ts` (deleted)
- `src/pages/treasury/{closing-detail,closing-form,closing-list,print}.tsx` (deleted) + `src/pages/treasury/index.tsx` (rewritten to cash-sessions only)
- `tests/daily-closing.test.ts` (deleted, 30 cases)
- `src/routes/index.tsx` (`/treasury/print/:closingId` route + `TreasuryPrintPage` import removed; `/treasury` permission → `payments.view`), `src/routes/nav-routes.ts` (`/treasury` → `permissions: ["cash.daily_close","payments.view"]` → single `payments.view`)
- `server/rpc/registry.ts` (removed `dailyClosing`), `server/rpc/dashboard.rpc.ts` + `src/core/services/dashboard.service.ts` (removed `getTreasuryForDashboard` + `DashboardTreasurySection` + import)
- `src/api/index.ts` (removed `treasuryApi`, `api.treasury`, `dashboardApi.treasury`, exported daily-closing types + re-exports)
- `src/core/permissions.ts` (removed `cash.daily_close`/`cash.daily_reopen`), `src/core/audit-actions.ts` (removed `DAILY_CLOSING_*`)
- `src/pages/dashboard-page.tsx` (removed treasury KPI card + `treasury` state/fetch + type import)
- `src/db/migrations.ts` (+ **v27**: drop `daily_closing_audit_entries` → indexes → `daily_closings`; delete seeded perms/grants)
- `src/i18n/ar.ts` (removed `perms."cash.daily_close"`/`perms."cash.daily_reopen"`, unused `treasury.*` (kept title/subtitle/sessionSectionHint), unused `errors.treasury.*`)

**Modified (phase 11 — migration-version bumps 26→27):** `tests/foundation.smoke.test.ts`, `tests/part4-backup.test.ts`, `tests/restore-authz.test.ts`

**Modified (phase 9 — cash/treasury merge):**
- `src/pages/treasury/index.tsx` (`DailyClosingPanel` extracted; new tabbed `TreasuryPage` -> later replaced by single-page in phase 10; removed dead `value=""` reason inputs ×2; removed misleading duplicate counted-cash box in detail financials; box cards retitled; cleaner date-row header)
- `src/pages/cash-page.tsx` (`CashSessionsPage` → `CashSessionsPanel` embedding component w/o title; new `CashSessionsPage` wrapper keeps legacy `/cash` page)
- `src/routes/nav-routes.ts` (removed `/cash` sidebar entry; `/treasury` → `permissions: ["cash.daily_close","payments.view"]`)
- `src/routes/index.tsx` (`/treasury` `RequirePermission` → `permissions` any-of)
- `src/i18n/ar.ts` (+`treasury.tabClosing/tabSessions/tabClosingHint/tabSessionsHint/closingCardHint`; retitled `treasury.title`/`subtitle`+`nav.treasury`→"الخزينة النقدية"; clearer `snapshotMissingHint`/`createSnapshotBtn`; removed `nav.cash`)

**Modified (phase 10 — single-page `/treasury`, session primary):**
- `src/pages/treasury/index.tsx` (removed `Tabs` container + `TreasuryTab` type; single-page `TreasuryPage` renders page header → `<CashSessionsPanel/>` under "وردية الخزينة" heading + hint (gated `payments.view`) → `<DailyClosingPanel/>` under "الإغلاق اليومي" heading + hint (gated `cash.daily_close`); EmptyState forbidden only if neither perm; added neon icon rows using `WalletCards`/`Coins`)
- `src/i18n/ar.ts` (removed `tabClosing/tabSessions/tabClosingHint/tabSessionsHint`; added `treasury.dailyClosingTitle`/`dailyClosingSectionHint`/`sessionSectionHint`; updated `treasury.subtitle`)
- `.ai/current-state.md`, `.ai/tasks.md` (these docs)

**Modified (phase 8):**
- `src/pages/subscriptions-page.tsx` (tabs now `subs`/`packages` only; legacy `PlansGrid`/`PlanFormModal` moved to a secondary "إدارة الخطط البسيطة" sub-view toggled by a button with back; added `ArrowLeft` import + `showPlans` state)
- `src/components/subscriptions/subscription-form-modal.tsx` (defaults to first package when packages exist — packages are the primary choice; simple plan stays a secondary fallback)
- `src/i18n/ar.ts` (+`plans.secondaryManage`)

**Modified (phase 7):**
- `src/pages/subscriptions-page.tsx` (+`packages` tab rendering `<PackagesPage />`, gated by `packages.view`; tabs now `subs`/`packages`/`plans`; added `PackagesPage` import)
- `src/routes/nav-routes.ts` (removed `/packages` sidebar entry)

**Modified (phase 6):**
- `src/routes/nav-routes.ts` (`/attendance` permission → `reception.view`)
- `src/i18n/ar.ts` (removed dead `nav.attendanceFast`/`nav.attendanceSearch`)

**Deleted (phase 6):**
- `src/components/attendance/fast-checkin-tab.tsx`
- `src/pages/checkin-page.tsx`
- `src/pages/attendance-page.tsx`

**Created (phases 2-5):**
- `src/components/staff/users-tab.tsx`, `src/components/staff/permissions-tab.tsx`, `src/pages/staff-page.tsx`
- `src/components/settings/health-tab.tsx`, `src/components/settings/scanner-tab.tsx`
- `src/components/attendance/reception-tab.tsx` (kept), `src/pages/attendance-page.tsx` (since deleted)

**Modified (phases 2-5):**
- `src/pages/users-page.tsx`, `src/pages/permissions-page.tsx` → re-export tab components
- `src/pages/health-page.tsx`, `src/pages/scanner-diagnostics-page.tsx` → re-export tab components
- `src/pages/reception-page.tsx` → re-export `ReceptionTab`
- `src/pages/settings-page.tsx` → 3-tab shell
- `src/routes/index.tsx` (+`/staff`, +`/attendance` routes; later `/checkin` removed), `src/routes/nav-routes.ts` (+`/staff`, single `/attendance`), `src/components/layout/sidebar.tsx` (grouped nav + `/attendance` icon + icon cleanup)
- `src/i18n/ar.ts` (+`settings.backupsTab`, `settings.scannerDiagTab`, `nav.group.*`, `nav.attendance`; removed `nav.hr`)