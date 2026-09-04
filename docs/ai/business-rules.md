# Yassen Mohamed Kotb | 01288536381 Business Rules

## Members

- Sequential member codes (zero-padded integer from `counters` table).
- Statuses: `active`, `inactive`, `suspended`, `archived`.
- Soft-delete: sets `deleted_at`, `deleted_by`, `deletion_reason`. Members in trash are hidden from default listing but visible on "trash" filter.
- Hard purge: cascades 17+ child tables (payments, subscriptions, attendance, cards, photos, ledger, body_assessments, fitness_results, class_bookings, training_plans, store_debts, store_debt_payments, crm_messages, expense_attachments... ) in FK-safe order inside a single transaction.
- Phone uniqueness enforced via partial unique index (NULL/empty values excluded).
- Department: `general`, `men`, or `women` — affects all downstream scoping.

## Plans

- Three kinds: `time` (duration-based), `sessions` (session-count-based), `open` (no expiry).
- Time plans: `duration_days` determines subscription end date (inclusive: end = start + duration_days - 1).
- Session plans: `sessions_count` is the total sessions allowed across the subscription lifetime.

## Subscriptions

- Overlap detection: rejects creating a new subscription for a member with an existing `active` subscription on the same plan kind (within `calcSubscriptionEndDate` window). Suggests a start date after the current subscription ends.
- Statuses: `active`, `suspended`, `cancelled`.
- Effective status: computed from status + dates → `active`, `upcoming`, `expired`, `suspended`, `cancelled`.
- **Renewal:** creates a NEW successor subscription; never mutates the old one. Old subscription preserved for history.
- **Cancellation:** sets status to `cancelled`. Does NOT modify payments. A reversal ledger entry may be written for revenue reconciliation. Historical records fully preserved.
- **Session plans:** `sessions_used` is incremented atomically on check-in via `consumeSession()`. Attendance denies if `sessions_used >= sessions_total`.
- Subscription stores its own `price` at creation time (independent of plan's current price). Plan price changes do NOT rewrite historical subscriptions.

## Freeze / Unfreeze

- `freezeSubscription`: sets `status = suspended`, records `frozen_at`, creates a `subscription_freezes` history row, adds `frozen_days` to the subscription.
- If `freeze_extends_expiry=1` (setting), adds frozen_days to the subscription's `end_date`.
- `unfreezeSubscription`: closes the freeze-history row (`actual_resume_date`), sets `status = active`.
- Idempotent: cannot freeze an already-frozen subscription; cannot unfreeze a non-frozen one.

## Attendance / Check-In

- Requires: active member, active (or session-credit) subscription.
- Card lookup by barcode; validates card is `assigned` and member is not `inactive`/deleted.
- Duplicate-scan window: configurable via `checkin_duplicate_window_seconds` (default 45s). Returns `duplicate` status within window.
- Session plans: atomically decrements `sessions_used`. Denies if no sessions left.
- Returns outstanding balance for the member (gym + store combined).
- Check-out: optional, records `checkout_at` timestamp on attendance record.
- Attendance requires `checkin.create` permission (enforced server-side).

## Payments

- Money: integer minor units (piastres; 100 = 1 EGP).
- Discount: `none`, `fixed`, or `percent`. Enforced via CHECK: `discount_amount_minor <= base_amount_minor`. Percent limited 1-100.
- Net: `net_amount_minor = base_amount_minor - discount_amount_minor`.
- Paid: `paid_amount_minor <= net_amount_minor`. Remaining: `net - paid`.
- Status: `partial` (paid < net), `paid` (paid = net), `voided`, `refunded`.
- Each payment writes ONE ledger entry (`entry_type = 'payment'`, `direction = +1`).
- **Refund:** writes to `payment_refunds` table, updates `refunded_amount_minor` on payment, sets status to `refunded` if fully refunded, writes reversal ledger entry (`entry_type = 'refund'`, `direction = -1`). Cannot refund more than paid minus already-refunded.
- **Void:** blocks if payment has any refunds. Writes reversal ledger entry. Preserves the payment record.
- **Double-reversal guard:** checks ledger for existing reversal before writing. Prevents duplicate voids/refunds.
- Voided payments excluded from subscription balance calculations.
- Cancelled subscription payments excluded from revenue calculations.

## Financial Ledger

- Append-only truth table. Every financial event creates exactly one ledger entry.
- `UNIQUE(ref_table, ref_id, entry_type)` prevents duplicate entries.
- Entry types: `payment`, `refund`, `reversal_payment`, `reversal_expense`, `expense`.
- Direction: `+1` (cash inflow) or `-1` (cash outflow).
- Box: `gym` or `store` — separates gym revenue from store revenue.
- Revenue calculation (dashboard): `inflow - refunds` (refunds excluded from inflow to prevent double-counting).
- Revenue calculation (reports): `SUM(paid_amount_minor) - SUM(refund_amount_minor) - SUM(expenses)`.
- Revenue excludes payments on cancelled subscriptions.

## Expenses

- Categories: seeded 10 (rent, salaries, utilities, equipment, maintenance, marketing, supplies, insurance, other, transportation). Admin can add more.
- Each expense writes a ledger entry (`entry_type = 'expense'`, `direction = -1`).
- Void: writes a reversal entry (`entry_type = 'reversal_expense'`, `direction = +1`).
- Attachments: stored on disk under `Files/expense_attachment/<id><ext>` and registered in the `files` table (kind `expense_attachment`). Limited to PDF/JPEG/PNG, ≤2 MB, magic-byte verified at upload.

## Cash Sessions

- Two boxes: `gym` and `store`. One open session per box enforced via partial unique index.
- Open: records opening balance, opened_by, opened_at.
- Close: calculates expected closing (opening + ledger inflows - ledger outflows for the session period), accepts counted amount, records discrepancy permanently.
- Sessions are immutable once closed.
- Deletion: only open sessions can be deleted (`cash.purge` permission). Closed sessions are permanent.

## Store / POS

- Products have `cost_minor` (purchase price) and `price_minor` (selling price), `stock_qty`.
- Stock movements tracked via `stock_movements` table (types: stock_in, sale, manual_adjust, damage, count_correction).
- Sales create: header (`store_sales`), line items (`store_sale_items`), stock deductions, ledger entry.
- Credit sales: creates `store_debts` record, repaid via `store_debt_payments` installments.
- Void sale: reverses stock, writes reversal ledger entry. Blocked if debt has payments.
- Store debt is SEPARATE from gym subscription debt. They are tracked independently.
- Profit calculation: `total_minor - cost_total_minor` per sale.
- `allow_negative_stock` setting controls whether sales can exceed available stock.

## Classes

- Classes define template: name, capacity, trainer, `consumes_session` flag.
- Sessions are scheduled instances: date, time, duration, capacity override.
- Bookings: member books a session. Enforces capacity. If `consumes_session` class, atomically consumes one session from the member's subscription.
- Cancel session: returns consumed sessions to members.
- Complete session: marks all `booked` bookings as `attended`.
- Unique constraint: one booking per member per session.

## Trainers & Training Plans

- Trainers: name, phone (unique partial), specialization, active/inactive.
- Training plans: link member to trainer with date range and status (active/ended/cancelled).
- `sweepExpiredPlans()`: auto-ends plans past their end_date. Returns count of ended plans.
- Trainer financial visibility is permission-controlled.

## Employees & Salaries

- Employee types: monthly/daily/per_class/custom salary.
- Salary records: per period (month), with base + bonus - deduction = net.
- `paySalary`: marks salary as paid, generates an expense record + ledger entry in a single transaction. Cannot pay twice.
- `purgeEmployee`: hard-deletes employee + salary records + ledger entries in a transaction.

## Body Assessments / InBody

- Body composition measurements: height, weight, body fat %, muscle mass, BMI (auto-computed), waist/chest/arm/thigh.
- Progress comparison: first vs latest assessment for a member.
- Custom fitness tests: admin-defined test definitions (name, unit), with per-member results.
- Historical measurements must not be overwritten.

## CRM / WhatsApp

- Templates: 6 seeded (welcome, expiry_reminder, gym_debt, store_debt, birthday, inactive).
- Messages: queued with `pending` status. WhatsApp integration is external (click-to-chat).
- `sendPendingMessages`: opens WhatsApp Web URL for each pending message. Does NOT confirm delivery.
- `markManuallySent`: marks message as sent after user confirms.
- `generateDueMessages`: auto-generates expiry/inactivity reminder messages.
- Deduplication: `dedupe_key` UNIQUE prevents duplicate messages for the same member+template+period.

## Permissions & Roles

- 4 roles: owner, manager, reception, trainer.
- 73 permissions across 12 domains.
- Owner: hardcoded bypass — always passes all permission checks.
- Manager: nearly full access; missing: subscriptions.purge, employees.purge, store.purge, cash.purge, users.manage. Gains settings.edit via DB grant.
- Reception: member/card/subscription/check-in/payment/cash/store-sell/classes/trainers/CRM.
- Trainer: members.view, classes.view, assessments.view.
- DB-backed grants: `role_permissions` table overrides defaults; loaded at boot, refreshed on every write.
- Permissions page allows manager to customize role grants (except owner is immutable).

## Department Isolation

- Three departments: `general`, `men`, `women`.
- Applied to: members, users (employees inherit from user or have own department).
- Bypass: owner role OR `members.view_all_departments` permission OR actor's department is `general`.
- Enforcement: `assertDepartmentAccess(actor, memberDept)` on single-member ops; `departmentScopeCondition(actor)` for list queries.
- Cross-section access (e.g., men-section user accessing women-section member) → FORBIDDEN.

## Audit

- 97 audit action types covering all major operations.
- Each mutation calls `recordAudit(db, actor, action, entityType, entityId, metadata?)`.
- Audit trail is append-only; never deleted.
- Metadata stored as JSON string.
- Sensitive data (passwords, secrets) never stored in audit logs.
