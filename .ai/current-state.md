# Current Development State

- **Last updated:** 2026-09-02
- **Current objective:** TASK-021 (page consolidation) — now ALSO merged the two confusing cash/treasury pages (خزينة النادي + الإغلاق اليومي) into a single tabbed `/treasury` page, with clarified labels and broken-UI fixes.
- **Last agent/tool:** opencode (this session)

## Active tasks

- **TASK-021** — extended: resolved الاشتراكات / الباقات duplicate. Attendance fast-tab removal pushed (`cc3bdb8`); subscriptions+packages+plans merge/tab-reorder pushed (`29de98e`); packages-primary interface (@). This session: merged `/cash` + `/treasury` into one tabbed `/treasury` page ("الخزينة النقدية" = الإغلاق اليومي tab + ورديات الخزينة tab), clarified labels, removed dead reason inputs, fixed misleading counted/expected. All pushed.

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

## Known issues / follow-ups

- Browser camera capture still not live-tested (needs real webcam).
- Legacy `/users`, `/permissions`, `/health`, `/scanner`, `/reception`, `/packages`, `/cash` routes still registered in `routes/index.tsx` (direct-bookmark compat) but no longer listed in the sidebar; could be removed once confirmed unused. (`/checkin` route removed this session.)
- TODO (docs sync): `docs/ai/roadmap.md` may still list خزينة النادي and الإغلاق اليومي as separate pages; the UI is now merged under `/treasury`.
- No i18n-coverage regression: shared `checkin.*` keys retained (used by dashboard `checkin.recent`/`checkin.noScans`, member-profile `checkin.deniedTitles`/`checkin.successTitle`, employee-checkin `checkin.submit`).
- Some `checkin.*` fast-tab-only keys (e.g. `scanTitle`, `scanHint`, `quickTitle`, `fieldBarcode`) are now unused but retained (harmless; coverage test checks only that used keys exist).
- `nav.packages` i18n key is now unused (sidebar entry removed) but retained harmlessly; `/packages` legacy route still used by some flows.

## Blockers

- None.

## Files changed (TASK-021, this session)

**Modified (phase 9 — cash/treasury merge):**
- `src/pages/treasury/index.tsx` (`DailyClosingPanel` extracted from `TreasuryPage`; new `TreasuryPage` tab container renders closing + sessions tabs; removed dead `value=""` reason inputs ×2; removed misleading duplicate counted-cash box in detail financials; box cards retitled; cleaner date-row header)
- `src/pages/cash-page.tsx` (`CashSessionsPage` → `CashSessionsPanel` embedding component w/o title; new `CashSessionsPage` wrapper keeps legacy `/cash` page)
- `src/routes/nav-routes.ts` (removed `/cash` sidebar entry; `/treasury` → `permissions: ["cash.daily_close","payments.view"]`)
- `src/routes/index.tsx` (`/treasury` `RequirePermission` → `permissions` any-of)
- `src/i18n/ar.ts` (+`treasury.tabClosing/tabSessions/tabClosingHint/tabSessionsHint/closingCardHint`; retitled `treasury.title`/`subtitle`+`nav.treasury`→"الخزينة النقدية"; clearer `snapshotMissingHint`/`createSnapshotBtn`; removed `nav.cash`)

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