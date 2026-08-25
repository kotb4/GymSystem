# Architecture Decision Log

## ADR-001: Member hard-purge intentionally cascades all history
- Date: 2026-08-25
- Status: accepted (product-owner request during UAT)
- Context: The original design refused hard-delete whenever any financial/attendance record referenced a member, leaving trashed members undeletable forever. Owner explicitly requested full deletion from the trash.
- Decision: `purgeMember` (requires `members.purge`) cascades all 17 related tables in FK-safe order inside one transaction — including payments, refunds, financial_ledger rows, attendance, subscriptions/freezes, cards, store sales/items/debts/repayments, CRM messages, bookings, training plans, assessments, fitness results — then deletes the member and audits `MEMBER_PURGED` with the cascade count.
- Consequences: Financial/cash-trail rows for that member are permanently destroyed; reports reflect their absence. Supersedes the refuse-on-history guard and its docstring. Known follow-up (audit F-05): `files` registry rows/disk bytes for member photos are not yet cleaned by the cascade.

## ADR-002: RPC authorization policy for plain reads
- Date: 2026-08-25
- Status: accepted
- Context: Several RPC entries were registered `p()` (no actor) and could not enforce permissions; audit trail, settings dumps, and a state-mutating sweep were callable by every authenticated role.
- Decision: Actor-gated (`a()` + first-statement `requirePermission`): `audit.listAuditLogs`→`audit.view`, `settings.readAllSettings`/`getBackupConfig`→`settings.view`, `trainingPlans.sweepExpiredPlans`→`training.manage`, `permissions.getRolePermissions`/`getAllPermissions`→`users.view`. Deliberately left open to all staff (catalog/config reads with no sensitive payload): payment methods list, expense categories, product categories, scanner/sound/working-days/inactive-days/checkout/freeze-extenders flags, subscriptions counters, barcode preview, `auth.needsSetup`. Dead exposure removed outright (no frontend caller): `settings.getWhatsAppConfig`, `settings.getExpiryThresholds` (remain internal service helpers).
- Consequences: Unknown-RPC behavior unchanged for whitelisted callers; frontend wrappers untouched (server injects actor). Any future `p()` registration must be justified in this log.

## ADR-003: Cash-box tagging and per-box sessions
- Date: 2026-08-25
- Status: accepted
- Context: Migration v4 introduced `cash_sessions.box` / `financial_ledger.box` with a per-box unique-open index, but services ignored the column: all ledger rows defaulted to 'gym', a second (store) session could open while arithmetic mixed both drawers.
- Decision: `insertLedgerEntry` persists `box` (default 'gym'); store sale payments, credit-sale reversals, and store-debt installments are tagged `'store'`. Sessions accept optional `box` (default 'gym'), uniqueness is enforced per box, and expected-closing math filters the ledger by the session's own box. Existing historical rows remain 'gym'.
- Consequences: Gym drawer counts no longer include store revenue. UI drawer selection is not built yet — the cash page operates on the gym box via defaults; exposing the store drawer is future UI work.

## ADR-004: Department isolation enforced across all member-scoped services
- Date: 2026-08-25
- Status: accepted
- Context: First audit (F-04) showed men/women section isolation existed only inside members.service; every other member-scoped operation accepted arbitrary member IDs (cross-section IDOR between staff).
- Decision: Shared module `src/core/services/department.ts` (`assertDepartmentAccess`, `departmentScopeCondition`, `memberDepartmentById`, bypass = owner OR `members.view_all_departments` OR staff dept 'general'). Wired into: subscriptions (create/update/status/freeze/unfreeze/renew + per-member reads + list filter), payments (record/refund/void + list filter), attendance check-in/out, store credit sale/debt repay/totals/list, classes book/cancel/status/member-lists, InBody create/delete/list/progress/results, training plans create/update/end/cancel/list (EXISTS form keeps COUNT join-free), CRM queue. Club-level aggregates gated by `reports.view`/`diagnostics.view` remain intentionally unscoped.
- Consequences: Scoped staff can no longer touch other sections via any service path; lists shrink accordingly. Financial reports stay club-wide for their existing roles.

## ADR-005: Secure cookie flag is an explicit opt-in
- Date: 2026-08-25
- Status: accepted
- Context: Audit F-11 noted the session cookie lacks `Secure`. Setting it unconditionally breaks plain-HTTP LAN deployments (cookie would be dropped), while loopback localhost works either way.
- Decision: `GYMSYSTEM_SECURE_COOKIES=1` appends `Secure` to session cookies (set + clear). Default stays off until an HTTPS terminator exists.
- Consequences: Deployment docs must mention the flag when introducing HTTPS/LAN support.

## ADR-006: Restore request size limits are route-scoped
- Date: 2026-08-25
- Status: accepted
- Context: Every POST buffered up to 256 MB before validation (audit F-13).
- Decision: `readBody(req, limit)` defaults to 8 MB; `/api/system/restore|import-legacy` explicitly opts into the 256 MB DB-transfer limit AFTER the `backup.restore` permission check; file uploads cap at 3 MB envelope around the 2 MB stored limit.
- Consequences: Oversized bodies on ordinary routes fail fast with the standard validation error instead of consuming memory.
