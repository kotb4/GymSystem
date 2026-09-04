# Current Development State

- **Last updated:** 2026-09-05
- **Current objective (done, this session):** **TASK-039 — highest-priority security fixes: loopback-only default bind + race-safe first-setup + one-time legacy import (ADR-023).**
- **What changed (TASK-039):**
  - **Host binding:** `server/config.ts` gains `DEFAULT_HTTP_HOST = "127.0.0.1"` + `resolveHttpHost(override?)`; `server/index.ts` binds **127.0.0.1** by default (`GYMSYSTEM_HOST` override kept as an explicit opt-in to LAN exposure). `scripts/sync-docs.mjs` `hostBind()` reads the default from `config.ts`. ADR-010 marked superseded; AGENTS.md diagram/command + `.ai/project.md` + `.opencode/agents/security.md` + `docs/ai/architecture.md` normalized to loopback.
  - **Setup race:** `auth.service.setup()` re-checks `countActiveOwners(db)` **inside** the `BEGIN IMMEDIATE` write transaction (in addition to the pre-check), so concurrent setups can't both create an owner — exactly one wins, the other throws `CONFLICT errors.setupAlreadyDone`. No schema change.
  - **Legacy import one-time:** `server/backups.ts::importDatabaseBytes` rejects `kind: "legacy_import"` whenever the live DB already has an active owner (sync check before any heavy work; route still fast-fails unauth `POST /api/system/import-legacy` with 401). Restore (authenticated) unaffected.
  - **Tests:** `tests/host-bind.test.ts` (new, 4 tests), `tests/auth.users.test.ts` (+1 concurrent-setup race test), `tests/restore-authz.test.ts` (+1 legacy-import-after-setup rejection test).
- **Verification (TASK-039):** targeted `npx vitest run tests/host-bind.test.ts tests/auth.users.test.ts tests/restore-authz.test.ts tests/backup-authz.test.ts` **33/33**; full `npm test` **450 total** (449 pass in the parallel run; the 1 failure is the known `restore-authz` boot load-timing flake which passes solo **6/6** → effective 450/450); typecheck ×2 clean (CLIENT=0, SERVER=0); `check-rpc-consistency` clean (272 entries, none missing); `npm run build` clean; `npm run sync:docs` reads `host default = 127.0.0.1` + regenerated `.ai/project.md`/`docs/ai/architecture.md`.
- **Commits (TASK-039):** **`fb7c06a`** (origin main, `41a255b..fb7c06a`).
- **Previous objective (delivered earlier this session):** **TASK-038 — remove the license grace period: lock EXACTLY at `expiresAt` with a TOTAL lockdown (ADR-022).**
- **What changed (TASK-038):**
  - `server/license/policy.ts`: deleted `GRACE_DAYS`, `graceDeadline()`, `graceDaysRemaining()`, the `"grace"` state; `expiryState()` = `now >= expiresAt` ⇒ `"expired"` else `"active"` (locks on the exact boundary). `CLOCK_ROLLBACK_GRACE_MS` untouched.
  - `server/license/session.ts`: `graceDaysRemaining` removed from `LicensePublicStatus` (`daysRemaining` = active-only countdown); new `FULL_LOCK_ALLOWLIST` (license.status/activate/deactivate + auth.needsSetup) applied ONLY when `"expired"` → **total lockdown, even pure reads are 423/LOCKED**; `tampered`/`invalid` keep `READONLY_ALLOWLIST`. `rpcBlockReason` expired reason `"expired_readonly"` → `"expired"`.
  - `server/rpc/license.rpc.ts`: `activate`/`deactivate` converted `a()` → `p()` (plain/unauthenticated) so the activation screen works WITHOUT a login during the lockdown (still requires a valid HWID-matched Ed25519 `.lic`).
  - Frontend: `src/api/index.ts` (`graceDaysRemaining` removed), `app-layout.tsx` (`graceMsg` dropped → `hardMsg ?? activeMsg`), `license-page.tsx` (grace branch removed), `src/routes/index.tsx` (locked branch renders ONLY `LicensePage` — login/setup removed from the locked routes), `src/i18n/ar.ts` (`states.grace`/`bannerGrace`/`statusGraceDesc` removed; `bannerExpired`/`statusReadonlyDesc`/`errors.license.blocked` reworded to «مقفل»).
  - Tests `tests/license.test.ts`: grace tests → exact-boundary expiry (+ a "just before stays active" boundary test; 28 tests vs 27); gate test asserts expired blocks READS too; marker test asserts `"expired"` + reads blocked; `GRACE_DAYS` math → plain `DAY` math.
  - Docs: ADR-022 added (supersedes ADR-019 §5/§7 wording; ADR-021 §2 updated), `migrations.ts` v29 comment updated. **No schema change (v29 untouched), no permission/audit changes.**
  - Verification (TASK-038): `npx vitest run tests/license.test.ts` **28/28**; typecheck ×2 clean; RPC consistency clean (272 entries); full `npm test` **444 total** (parallel run 442/444 — only the 2 known load-timing boot flakes `backup-authz`/`restore-authz`, which pass solo **9/9**); `npm run build` clean; `npm run sync:docs` clean.
- **Previous objective (delivered earlier this session):** **TASK-036 — the three approved follow-ups «اعمل كلو»**: **F1** license anti-rollback marker (TASK-031 Phase-3 hardening, ADR-021), **F2** standalone Referrals page (`/referrals`), **F3** purge photo-byte cleanup (audit F-05, now CLOSED with a regression test).
- **What changed (TASK-036):**
  - **DB (migration v29)** `license_activation` (hwid PK, activated_at, issued_at, expires_at INTEGER NOT NULL, gym TEXT, tier TEXT, last_active INTEGER, created_at, updated_at) — `CREATE TABLE IF NOT EXISTS`, no destructive statements. Marker written only from VERIFIED license payloads (activation + every boot); when `.lic`/`license.json` are deleted the session falls back to a state synthesized from the marker (grant period + clock-rollback guard preserved), so deleting license files can no longer revert to untracked `unlicensed` full-write. Explicit in-app deactivation clears the marker. `server/license/session.ts` gained DB param (`initLicenseSession(dataDir, database?)`, `_resetLicenseSession(nextDir?, database?)`, `_overrideHwIdForTest(hwid)` seam, read/upsert/update/delete marker helpers); `server/context.ts` passes `db`.
  - **F2 UI:** new `src/pages/referrals-page.tsx` (stats cards ×5, referrals DataTable with convert/cancel, top referrers, rewards, settings card, create/convert modals using `MemberPickerModal`) + route `path="referrals"` (gated `referrals.view`) + `NAV_ROUTES` (`/referrals`, `nav.referrals`, group `comms`) + sidebar `Share2` icon + i18n `nav.referrals` + 4 new `referral.*` keys. All referral RPCs pre-existed (TASK-016); zero backend changes.
  - **F3 verification (no code):** purge already unlinks photo bytes post-commit in `server/rpc/members.rpc.ts` (ADR-018/F-05). Added regression test: `setFilesRoot(tmp)` + `saveRawBytes` (real JPEG magic bytes `FF D8 FF E0`) → trash + purge via the RPC handler → assert `files` row gone, live path gone, `.trash` has the bytes.
  - **Tests:** migration asserts 28→29 in `foundation.smoke` (+`license_activation`=0), `restore-authz`, `part4-backup` (legacy-adopt re-run stays green); `tests/license.test.ts` +4 marker tests → **27/27**. Full suite **443/443 (34 files)** (was 438). ADR-021 recorded; stale ADR-001 F-05 note updated to CLOSED.
  - Verification (TASK-036): `npm run typecheck` + `typecheck:server` clean; `node scripts/check-rpc-consistency.cjs` clean (272 entries, no gaps); `npm test` **443/443**; `npm run build` clean (dist + dist-server; only Vite's cosmetic chunk-size note).
- **Previous objective (delivered earlier this session):** **TASK-035 — Classes hub (الحصص والمدربون)**: rework the التدريب section so the Classes page manages gym group classes (MMA/Karate...) via one hub with 4 tabs — الحصص / الجدول الأسبوعي / المدربون / خطط التدريب — plus **weekly recurring sessions (توريع أسبوعي)** with a **weekly timetable**. Done exactly per the user's answered questions: merge trainers into the classes hub, add recurring sessions + week grid, keep full trainer data.
- **What changed (TASK-035):**
  - **DB (migration v28)** `class_recurrences` (id, class_id→classes, days_of_week TEXT comma sep 0..6 [Sunday=0], start_date, start_time, duration_min≥5, capacity NULL|>0, is_active, created_by →users, created_at, updated_at) + `idx_class_recurrences_class`. Follows the v6+ `CREATE TABLE IF NOT EXISTS` convention so the legacy-adopt re-run path stays green. No destructive statements.
  - **Backend**: `classes.service.ts` gained a recurrence module: `ClassRecurrenceInput/ClassRecurrence/RecurrenceResult`, `createClassRecurrence` (validates days/date/time/capacity; adds days, clamps weeks 1..12; materializes real `class_sessions` inside one transaction; audit `CLASS_RECURRENCE_CREATED`), `listClassRecurrences` (activeOnly filter; `nextScheduledDate` = MIN future scheduled session), `generateRecurrenceWeeks` (extends by continuing AFTER the last generated session — `dayAfterLastSession` — dupe-skip guard identical to `createClassSession`; audit `CLASS_RECURRENCE_EXTENDED`), `deactivateClassRecurrence` (is_active=0, existing sessions kept; audit `CLASS_RECURRENCE_STOPPED`). Permissions: create/extend/stop = `classes.manage`, list = `classes.view`. `audit-actions.ts` +3 codes. 4 new RPCs in `server/rpc/classes.rpc.ts`.
  - **Frontend**: new `src/components/classes/` — `classes-tab.tsx` (class catalog cards + per-class recurrence cards with توريع/قادم/إيقاف + class/session/recurrence modals), `schedule-tab.tsx` (Saturday-first week grid, prev/next/today, class filter, capacity badges, opens `session-details-modal.tsx`), `trainers-tab.tsx` + `trainer-form-modal.tsx` (moved from `pages/trainers-page.tsx`), `plans-tab.tsx` (training plans management carried over intact), `recurrence-form-modal.tsx` (day chips سبت..جمعة in [6,0,1,2,3,4,5] order, start date/time, duration, optional capacity, weeks; `recurrenceToast` shows created/skipped). `session-details-modal.tsx` extracted (bookings table + member picker + complete/cancel/uncancel confirm dialogs; **fixed** a casing bug `bookingNo_Show`→`bookingNo_show` and the wrong empty-bookings key `members.noSubs`→`cls.emptyBookings`).
  - **Hub & nav**: `pages/classes-page.tsx` is now a 4-tab hub (tabs gated: classes/schedule by `classes.view`, trainers/plans by `trainers.view`; trainer role sees only the first two). Deleted `pages/trainers-page.tsx`; removed the `/trainers` route + nav entry; `/classes` route + nav entry now any-of `["classes.view","trainers.view"]`; sidebar icon `/classes`→Dumbbell (ListChecks import removed); `nav.classes` = "الحصص والمدربون". `nav.trainers` key kept (still used by plans tab + member profile). i18n: `cls` keys for tabs/schedule/recurrence (+`emptyBookings`) and `errors.classRecurrence{NotFound,Inactive,NoDays}`.
  - **Tests**: `tests/classes.test.ts` +7 recurrence tests (materialization counts for Mon+Thu×2 weeks=4, capacity fallback vs override, dupe-skip, extend-advances, stop-keeps, input/permission validation). Migration-version asserts bumped 27→28 in `foundation.smoke`, `restore-authz`, `part4-backup`. Full suite now **438/438 (34 files)**. During testing found+fixed 3 real bugs: `mapRecurrence` hardcoded `nextScheduledDate:null`, extend regenerated the same window (now advances past the last session), and startTime allowed `30:00` (strict `HH:MM` hours 0-23/minutes 0-59 now).
  - Verification (TASK-035): `npm run typecheck` + `typecheck:server` clean; `node scripts/check-rpc-consistency.cjs` clean (272 entries, no missing client calls); `npm test` **438/438** (one run had a single `restore-authz` load-timing flake that passes in isolation + on rerun); `npm run build` clean; `npm run sync:docs` → AGENTS.md (34→36 services, migrations v1..v28), docs/ai/architecture.md + database.md. i18n coverage 3/3 (included in suite).
- **Previous objective (delivered earlier this session):** **TASK-034 — License Tool GUI v7 (batch issuer)** — committed+pushed `2666400`. See the TASK-034 record below.
- **Earlier this session:** **TASK-031 offline licensing** committed+pushed (`4270511`), CLI ergonomics across `35d7ef0`+`17f225d`, **TASK-032** license folder + days-remaining banner, **TASK-033** WinForms GUI, **TASK-034** GUI v7 batch issuer — full records below.
- **TASK-038 committed/pushed:** **`c324aa6`** (origin main, `aa82d16..c324aa6`).
- **TASK-036 committed/pushed:** **`d833437`** (origin main, `2409078..d833437`).
- **TASK-035 committed/pushed:** **`cf16e5f`** (origin main, `2666400..cf16e5f`).
- **Last agent/tool:** opencode (this session)

- **TASK-030** — **done this session** (loyalty rewards execution fix, pending user report/commit). See `.ai/tasks.md`.
- **TASK-029** — **done this session** (anti-passback race fix, pending user report/commit). See `.ai/tasks.md`.
- **TASK-028** — **done this session** (class capacity race fix, pending user report/commit). See `.ai/tasks.md`.
- **TASK-027** — **done this session** (same-day freeze phantom-day fix, pending user report/commit). See `.ai/tasks.md`.
- **TASK-026** — **done this session** (freeze allowance bypass fix, pending user report/commit). See `.ai/tasks.md`.
- **TASK-025** — **done this session** (new reports tab). Committed **`48dbb6d`** and pushed to `origin/main`. See Phase 16 below for full detail.

## Active tasks
- **TASK-021** — extended: resolved الاشتراكات / الباقات duplicate. Attendance fast-tab removal pushed (`cc3bdb8`); subscriptions+packages+plans merge/tab-reorder pushed (`29de98e`); packages-primary interface pushed (`9f53d30`). This session: phase 9 merged `/cash` + `/treasury` into a tabbed `/treasury` (pushed `7ac7420`), phase 10 removed the tabs → single `/treasury` page (cash session primary + daily closing below), and phase 11 removed the daily-closing feature entirely so `/الخزينة` = cash sessions (الوردية) only (migration v27).

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

**Phase 13 (done, this session): removed legacy routes — canonical URLs only.**
- Removed the 7 legacy/duplicate routes from `src/routes/index.tsx`: `/reception` (→`/attendance`), `/packages` (→`/subscriptions` باقات tab), `/cash` (→`/treasury`), `/users` + `/permissions` (→`/staff`), `/scanner` + `/health` (→`/settings` tabs). Kept `ReceptionPage` import (still used by `/attendance`). Pruned the now-unused imports (`PackagesPage`, `UsersPage`, `CashSessionsPage`, `ScannerDiagnosticsPage`, `HealthPage`, `PermissionsPage`). Old bookmarks now hit the `*` catch-all → `/`.
- Deleted 4 fully-unused re-export wrapper pages: `users-page.tsx`, `permissions-page.tsx`, `scanner-diagnostics-page.tsx`, `health-page.tsx` (their tab components are imported directly by `/staff` + `/settings`).
- `cash-page.tsx`: removed the unused `CashSessionsPage` export; kept `CashSessionsPanel` (used by `/treasury`). Note `cashPage.title` is still used by `/treasury` (`treasury/index.tsx`), so no i18n cleanup needed.
- Kept `packages-page.tsx` (still imported by `subscriptions-page.tsx` for the باقات tab).
- Verification: `npm run typecheck` clean, `npm test` **394/394**, `npm run build` clean, `node scripts/check-rpc-consistency.cjs` → 264 entries, no missing, exit 0. Committed/pushed as `cb0d2bb`.

**Phase 14 (done, this session): removed orphaned `nav.*` i18n keys.**
- Removed 6 unused `nav.*` keys from `ar.ts`: `checkin`, `reception`, `packages`, `scannerDiagnostics`, `health`, `inbody` — all confirmed unused via repo-wide grep (their sidebar entries/routes were removed in earlier phases/TASK-023). Kept `nav.users`/`nav.permissions` (still used as tab titles in `/staff`). Verified: i18n coverage 3/3, `npm run typecheck` clean, `npm test` **394/394**, `npm run build` clean.

**Phase 15 (done, this session): resolved "expense attachments BLOBs → `Files\`" — already implemented; synced stale docs.**
- User asked for the roadmap "move expense-attachment BLOBs from SQLite to Files\" item. **Investigation showed the code migration was already fully implemented (ADR-018):** `server/files.service.ts` is a complete secure filesystem registry (kind `expense_attachment`, MIME whitelist + magic-byte sniffing, path-traversal guards, atomic writes, crash-safe trash delete); `server/expense-attachments-backfill.ts` idempotently backfills legacy BLOB rows to `Files/expense_attachment/<id>.<ext>` at boot (`server/context.ts:111`); migrations **v15** drops the old `expense_attachments` BLOB table (when empty), **v25** adds `files.relative_path`, **v26** is the backfill marker; `server/index.ts` uploads (`POST /api/files`) + serves (`GET /api/files/:id`). `expenses.service.ts` has zero BLOB code. Backups already archive `Files/` into `.gymbak` trailers.
- No code re-build was done (nothing to build). Instead corrected the **stale docs/AI-state** that still described the removed BLOB storage: removed the `expense_attachments` schema section in `docs/ai/database.md` (replaced with "removed; backfilled to Files/"), added `relative_path` to the `files` table doc, fixed `.ai/project.md` (removed stale known-limitation + feature-list), `.ai/business-rules.md:41`, `docs/ai/business-rules.md:75`, `docs/ai/roadmap.md:11`, `AGENTS.md:133`, `README.md:151`, `.ai/architecture.md:63` (v4 + "(dropped v15)"), and corrected factual errors in `.ai/decisions.md` ADR-018 (v20→v25, v21→v26, `unlinkPendingForPaths`→`unlinkFileBytes`+`sweepPendingDeletes`) and the `migrations.ts:649` comment path (`src/db/`→`server/`).
- Verification: `npm run sync:docs` (docs in sync), `npm run typecheck` + `npm run typecheck:server` clean, `npm run build` clean, targeted tests pass (`finance` 42, `i18n-coverage` 3, `part4-backup` 8).

**Phase 16 (done, this session): advanced analytics — Retention & Activity Insights (TASK-025).**
- The `/reports` page already covered finance + attendance (visits/peak-hours/top-members) + staff activity. The genuine missing gap was **member retention/churn + activity insight**. Built a new, non-duplicative module as a 4th tab "الاحتفاظ والنشاط" (`retention`) in `reports-page.tsx`.
- New `src/core/services/activity-insights.service.ts` → `getRetentionInsights(db, actor, {fromKey,toKey})`, gated `reports.view`, department-scoped for men/women staff, pure reads (no schema/migration/permission/audit change):
  - `inactiveMembers` — active members with an active paid-ish subscription whose last visit is older than the configured `inactive_days` (reuses `getInactiveDays`), incl. code/name/department/lastVisitAt/daysSinceLastVisit.
  - `visitorSplit {newMembers, returning}` — a visitor is "new" when this period holds their **all-time** first check-in (computed from global MIN; a subtle range-scoping bug was caught+fixed during testing).
  - `totalVisitors` + `avgCheckinsPerVisitingMember` (total / unique, 2dp).
  - `byDayOfWeek` (7 buckets, Sun=0) + `byDepartment` (general/men/women).
- Wiring: `server/rpc/reports.rpc.ts` (+`getRetentionInsights`), `src/api/index.ts` (`api.reports.retentionInsights(range)`). Reused existing `reports.view` — no new permission (avoids permission-count churn in tests/docs).
- UI: `RetentionView` in `reports-page.tsx` — 4 StatCards (inactive count w/ threshold, new vs returning, avg check-ins, total visits), day-of-week + department neon bars, at-risk members DataTable. i18n keys in `src/i18n/ar.ts`: `rpt.tabRetention`, `rpt.department`, `rpt.daysSinceVisit`, `rpt.dayUnit`, `rpt.retentionInactive`, `rpt.inactiveThreshold`, `rpt.retentionNewVisitors`, `rpt.retentionReturning`, `rpt.retentionAvgCheckins`, `rpt.dayOfWeekTitle`, `rpt.departmentSplitTitle`, `rpt.inactiveListTitle`/`Hint`/`Empty` + new `dow.day0..day6` namespace; dept labels reuse `members.dept*`.
- Tests: `tests/activity-insights.test.ts` (5) — aggregation math, `reports.view` denials, range/date validation, `inactive_days` threshold respect, archived exclusion. Dept scoping delegated to the already-covered `departmentScopeCondition` helper.
- Verification: `npm run typecheck` + `typecheck:server` clean, `node scripts/check-rpc-consistency.cjs` ok (265 entries, no missing client call), `npm test` **399/399** (33 files, +5 new), `npm run build` clean, `npm run sync:docs` in sync. No commit made (user-facing report pending).

**Files changed (TASK-025 — retention & activity insights):**
- Created: `src/core/services/activity-insights.service.ts`, `tests/activity-insights.test.ts`
- Modified: `server/rpc/reports.rpc.ts`, `src/api/index.ts`, `src/pages/reports-page.tsx`, `src/i18n/ar.ts`, `.ai/tasks.md` (+TASK-025), `.ai/current-state.md` (this file)
- No DB changes (no migration), no permission/audit changes.

## Known issues / follow-ups

- **License signing secrets:** `config/id_ed25519_private.pem` is the ONLY private key that matches the embedded `EMBEDDED_PUBLIC_PEM` in `server/license/crypto.ts`. It is gitignored (`config/`, `*.pem`, `license.lic`). **Never commit them;** if you regenerate via `npm run license:keygen` you MUST copy the new public PEM into `crypto.ts` and rebuild, or activation will fail (signature mismatch). Before shipping to a real customer, generate a fresh dedicated keypair and embed only its public key — the current one is a dev key.
- **TASK-031 Phase 3 hardening (discovered, RESOLVED by TASK-036-F1 + TASK-038):** while the license state is `unlicensed`, `isHardLocked=false` so all writes are allowed and there is **no expiry ceiling** — an actor can simply delete `configDir/license.json` + `license.lic` to revert a never-expired state and escape the license lockdown. TASK-036-F1 added the `license_activation` marker (ADR-021) so deleting the license files reverts to the marker's grant, not to `unlicensed`; TASK-038/ADR-022 made the expired lock a total lockdown (no read-only escape).
- Browser camera capture still not live-tested (needs real webcam).
- `scripts/e2e-audit.ps1` (66-check audit) now **passes all 66 checks** (exit 0). Two stale audit assertions fixed (test-data only, no product change): (1) "frozen subscription denied" asserted the old deny-on-frozen-scan behavior, but the product intentionally **auto-unfreezes on check-in** (unit-tested in `tests/subscriptions.freeze.enhanced.test.ts`) — the audit now asserts the scan is granted; (2) the member-photo upload sent an `object[]` body that PowerShell transmitted as text, failing the JPEG magic-byte sniff (ADR-018 §4) — now built as a true `byte[]` with `FF D8 FF E0` header so it uploads as binary.
- `npm run e2e` (e2e-smoke) **passes all 24 checks**; corrected the stale `unauthenticated /me` check in `scripts/e2e-smoke.ps1` — the server intentionally returns `200 {needsSetup:true}` (not 401) for unauthenticated `/api/auth/me`, so the old check asserted the opposite of the documented behavior.
- Legacy `/users`, `/permissions`, `/health`, `/scanner`, `/reception`, `/packages`, `/cash` routes are **removed** (this session, phase 13) — no longer registered in `routes/index.tsx`. Canonical equivalents: `/reception`→`/attendance`, `/packages`→`/subscriptions` (باقات tab), `/cash`→`/treasury`, `/users`+`/permissions`→`/staff`, `/scanner`+`/health`→`/settings` (tabs). Old bookmarks now redirect to `/` (catch-all). Deleted wrapper pages `users-page.tsx`, `permissions-page.tsx`, `scanner-diagnostics-page.tsx`, `health-page.tsx`; removed unused `CashSessionsPage` export from `cash-page.tsx` (kept `CashSessionsPanel`).
- The daily-closing feature (الإغلاق اليومي) is fully removed (tables, permissions, service, RPC, UI, dashboard). A full-repo sweep (source + docs, excluding the historical migration v20 definition and tasks/current-state history) confirmed **no stale references remain**; the last one fixed was the `treasury.subtitle` i18n string, which still mentioned daily-closing reconciliation and was updated to describe the cash-sessions-only page.
- No i18n-coverage regression: shared `checkin.*` keys retained (used by dashboard `checkin.recent`/`checkin.noScans`, member-profile `checkin.deniedTitles`/`checkin.successTitle`, employee-checkin `checkin.submit`).
- Some `checkin.*` fast-tab-only keys (e.g. `scanTitle`, `scanHint`, `quickTitle`, `fieldBarcode`) are now unused but retained (harmless; coverage test checks only that used keys exist).
- Orphaned `nav.*` keys removed (phase 14): `nav.checkin`, `nav.reception`, `nav.packages`, `nav.scannerDiagnostics`, `nav.health`, `nav.inbody` — all confirmed unused via repo-wide grep (their sidebar entries/routes were removed in earlier phases). `nav.users`/`nav.permissions` kept (still used as tab titles in `/staff`). i18n coverage 3/3. Also removed dead `ICONS` entries (for the now-removed `/cash` + `/packages` paths) + unused `Wallet`/`PackageIcon` imports from `sidebar.tsx`.

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