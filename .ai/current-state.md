# Current Development State

- **Last updated:** 2026-09-02
- **Current objective:** TASK-021 (page consolidation) — attendance now a single reception page at `/attendance`; fast check-in tab/page removed; previous phases (staff, settings tabs, grouped sidebar) done & pushed
- **Last agent/tool:** opencode (this session)

## Active tasks

- **TASK-021** — extended: merged the two attendance screens into a single `/attendance` page, then removed the "fast (barcode/card)" tab + `/checkin` page entirely (reception/search is the only attendance screen now). Prior phases (P2 /staff, P3 settings tabs, P4 grouped sidebar) pushed (`d05d94a`); the attendance merge push is `1c88c86`. This session's fast-tab removal is not yet committed.

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

**Phase 6 (done, this session, NOT yet committed): removed fast attendance tab.** Per user request, deleted the "fast (barcode/card)" tab + `/checkin` page entirely — the reception/search screen is now the only attendance UI. Deleted `fast-checkin-tab.tsx`, `checkin-page.tsx`, `attendance-page.tsx`. `/attendance` route now renders `ReceptionPage` gated by `reception.view`; removed `/checkin` route + imports; `NAV_ROUTES` `/attendance` gated by `reception.view`. Removed dead i18n keys `nav.attendanceFast`/`nav.attendanceSearch`. Backend `checkin.*` permissions + `recordCheckIn` engine are KEPT because `reception.checkIn` delegates to them (manager + reception roles already carry `checkin.create` + `checkin.view_history`).

## Known issues / follow-ups

- Browser camera capture still not live-tested (needs real webcam).
- Legacy `/users`, `/permissions`, `/health`, `/scanner`, `/reception` routes still registered in `routes/index.tsx` (direct-bookmark compat) but no longer listed in the sidebar; could be removed once confirmed unused. (`/checkin` route removed this session.)
- No i18n-coverage regression: shared `checkin.*` keys retained (used by dashboard `checkin.recent`/`checkin.noScans`, member-profile `checkin.deniedTitles`/`checkin.successTitle`, employee-checkin `checkin.submit`).
- Some `checkin.*` fast-tab-only keys (e.g. `scanTitle`, `scanHint`, `quickTitle`, `fieldBarcode`) are now unused but retained (harmless; coverage test checks only that used keys exist).

## Blockers

- None.

## Files changed (TASK-021, this session)

**Created (phase 6):** none — this phase is a removal.

**Deleted (phase 6):**
- `src/components/attendance/fast-checkin-tab.tsx`
- `src/pages/checkin-page.tsx`
- `src/pages/attendance-page.tsx`

**Modified (phase 6):**
- `src/routes/index.tsx` (removed `/checkin` route + `CheckInPage`/`AttendancePage` imports; `/attendance` now renders `ReceptionPage` gated by `reception.view`)
- `src/routes/nav-routes.ts` (`/attendance` permission → `reception.view`)
- `src/i18n/ar.ts` (removed dead `nav.attendanceFast`/`nav.attendanceSearch`)

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