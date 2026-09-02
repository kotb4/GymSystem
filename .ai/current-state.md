# Current Development State

- **Last updated:** 2026-09-02
- **Current objective:** TASK-021 (page consolidation) — merged /checkin + /reception into one /attendance page; previous phases (staff, settings tabs, grouped sidebar) done & pushed
- **Last agent/tool:** opencode (this session)

## Active tasks

- **TASK-021** — extended: merged the two attendance screens into a single `/attendance` page. Prior phases (P2 /staff, P3 settings tabs, P4 grouped sidebar) already done + pushed (`d05d94a`). This session's attendance merge is not yet committed.

## What was most recently completed (handoff context)

### TASK-020 — Subscriptions page blank-screen fix (2026-09-02)
Fixed `FreezeSubscriptionModal` crash that blanked the whole /subscriptions page: it read a prop inside its initial `useState` while the parent always mounted it with `subscription={null}`, so `null.endDate` threw. Fix: made the `subscription` prop nullable, `if (!open || !sub) return null;` before any hooks, renamed `subscription`→`sub`, dropped `as Subscription` casts. Committed/pushed (`04bdf28`). Also added an `ErrorBoundary` (`src/components/ui/error-boundary.tsx`) in `src/main.tsx` so a single crash can no longer blank a whole route.

### TASK-021 — Page consolidation & sidebar reorganization (2026-09-02, in progress)
Consolidate small admin/pages into shared shells and reorder the sidebar.

**Phase 1 (done, pushed `18ff360`): assign-card quick action.** Added `members.qaAssignCard` i18n + `cards.assign`-gated `assignCard` quick action (`BadgePlus`) on member profile wired to the existing `cardModalOpen` state.

**Phase 2 (done, this session): /staff page.** Extracted `UsersTab` (`src/components/staff/users-tab.tsx`) + `PermissionsTab` (`src/components/staff/permissions-tab.tsx`) from the old pages; `users-page.tsx`/`permissions-page.tsx` now re-export them (legacy `/users` + `/permissions` routes preserved). New `src/pages/staff-page.tsx` renders both as Tabs, gated by `users.view`. Added `/staff` to `NAV_ROUTES` + sidebar `ICONS`. `nav.staff` i18n key added previously.

**Phase 3 (done, this session): Settings tabs.** Extracted `HealthTab` (`src/components/settings/health-tab.tsx`) + `ScannerTab` (`src/components/settings/scanner-tab.tsx`); `health-page.tsx`/`scanner-diagnostics-page.tsx` re-export them (legacy routes preserved). `settings-page.tsx` became a 3-tab shell: general (settings cards), backups (`HealthTab`), scanner diagnostics (`ScannerTab`). Added `settings.backupsTab` + `settings.scannerDiagTab` i18n keys.

**Phase 4 (done, this session): grouped sidebar.** Added `group: NavGroup` to every `NAV_ROUTES` entry + `NAV_GROUP_ORDER`; sidebar now renders group headers (`nav.group.*`) and only shows groups with ≥1 visible route. Cleaned-up canonical sidebar set: removed `/users`,`/permissions`,`/scanner`,`/health` (their pages now live under /staff + /settings; legacy *routes* still resolvable), and removed the dangling `/hr` icon map entry + `nav.hr` i18n key. Added missing sidebar icons for `/store` (ShoppingBag), `/classes` (ListChecks), `/crm` (MessageSquare).

**Phase 5 (done, this session, NOT yet committed): merged attendance screens.** Merged the two overlapping attendance pages (fast barcode/card check-in + reception search) into a single `/attendance` page with tabs. Extracted `FastCheckInTab` (`src/components/attendance/fast-checkin-tab.tsx`, from CheckInPage) + `ReceptionTab` (`src/components/attendance/reception-tab.tsx`, from ReceptionPage); `checkin-page.tsx`/`reception-page.tsx` re-export them (legacy `/checkin` + `/reception` routes preserved). New `src/pages/attendance-page.tsx` renders permission-aware tabs (gates `checkin.create` / `reception.view`). Sidebar now has a single `/attendance` entry (ScanLine icon) in the "daily" group; replaced `nav.checkin`/`nav.reception` sidebar entries. Added i18n `nav.attendance`, `nav.attendanceFast`, `nav.attendanceSearch`.

## Known issues / follow-ups

- Browser camera capture still not live-tested (needs real webcam).
- Legacy `/users`, `/permissions`, `/health`, `/scanner`, `/checkin`, `/reception` routes still registered in `routes/index.tsx` (direct-bookmark compat) but no longer listed in the sidebar; could be removed once confirmed unused.
- No i18n-coverage regression: legacy nav keys (`users`, `permissions`, `scannerDiagnostics`, `health`, `checkin`, `reception`) retained (still used by legacy route titles + tab components).

## Blockers

- None.

## Files changed (TASK-021, this session)

**Created:**
- `src/components/staff/users-tab.tsx`, `src/components/staff/permissions-tab.tsx`, `src/pages/staff-page.tsx`
- `src/components/settings/health-tab.tsx`, `src/components/settings/scanner-tab.tsx`
- `src/components/attendance/fast-checkin-tab.tsx`, `src/components/attendance/reception-tab.tsx`, `src/pages/attendance-page.tsx`

**Modified:**
- `src/pages/users-page.tsx`, `src/pages/permissions-page.tsx` → re-export tab components
- `src/pages/health-page.tsx`, `src/pages/scanner-diagnostics-page.tsx` → re-export tab components
- `src/pages/checkin-page.tsx`, `src/pages/reception-page.tsx` → re-export attendance tab components
- `src/pages/settings-page.tsx` → 3-tab shell
- `src/routes/index.tsx` (+`/staff`, +`/attendance` routes), `src/routes/nav-routes.ts` (group field + canonical sidebar set + `/staff` + single `/attendance`), `src/components/layout/sidebar.tsx` (grouped nav + single `/attendance` icon + icon cleanup)
- `src/i18n/ar.ts` (+`settings.backupsTab`, `settings.scannerDiagTab`, `nav.group.*`, `nav.attendance/attendanceFast/attendanceSearch`; removed `nav.hr`)