# Yassen Mohamed Kotb | 01288536381 Business Rules (verified from code)

Every rule below was read from the actual implementation. Anything unverified is explicitly marked. File references point at the enforcing service.

## Members

- Sequential `member_code` from `counters` table; unique non-empty phone enforced by partial unique index (`members.service.ts`).
- Status set: active | inactive | suspended | archived. Archiving blocks new subscriptions/payments.
- **Trash:** soft delete via `deleted_at/deleted_by/deletion_reason`; restorable; hidden from default lists.
- **Purge** (`members.purge` perm): refuses unless already trashed; cascades 17 child tables in FK-safe order inside one transaction (store_debt_payments → payment_refunds → ledger → crm_messages → freezes → bookings → attendance → payments → debts → sale items → sales → subscriptions → cards → training plans → assessments → test results → member). Audit `MEMBER_PURGED` records cascade count.
- Department scoping: `department ∈ general|men|women`; `assertDepartmentAccess` prevents cross-section access for men/women-scoped staff.

## Plans & Subscriptions

- Plan kinds: `time` (date range), `sessions` (sessions_count), `open` (no fixed end) (`plans.service.ts`).
- Overlap guard: creating/updating an active overlapping subscription is rejected with a suggested next-day start (`errors.subscriptionOverlap`) (`subscriptions.service.ts`).
- Effective status computed from dates + status field (upcoming/active/expired…); expired subs never grant attendance.
- **Freeze:** allowed only while active; configurable window near expiry; `freeze_extends_expiry=1` (default) shifts end_date by frozen days; history written to `subscription_freezes`; resume validates expected date range.
- **Renew:** creates a successor subscription linked to the same plan/member.
- **Cancel:** marks status cancelled and inserts `reversal_payment` ledger entries for its payments — but only if no reversal exists yet (double-reversal guard). Reports exclude cancelled-subscription payments from revenue.
- **Purge** (`subscriptions.purge`): hard delete removes payments/refunds/their ledger rows/freeze history; attendance & class bookings survive detached (subscription_id → NULL); department-scoped; audited `SUBSCRIPTION_PURGED`.

## Attendance / Cards

- Barcode cards: statuses available|assigned|lost|blocked; assigning auto-registers unknown barcodes; lost keeps the holder link.
- Check-in requires: valid card, active member, live subscription OR sessions-plan credit; duplicate scans within configured window are flagged (`cards.service.ts`, setting `checkin_duplicate_window_seconds`).
- Check-out supported when `attendance_checkout_enabled=1`.
- Session-consuming classes atomically decrement `sessions_used` on attended booking.

## Payments & Ledger

- Money stored as integer minor units; CHECKs enforce `net = base − discount`, paid ≤ net, refunded ≤ paid, remaining = net − paid.
- Discounts: none|fixed|percent; percent bounded; requires `payments.discount` permission.
- Idempotency: optional `client_ref` UNIQUE prevents duplicate submission (`errors.finance.duplicateTransaction`).
- Refund: partial or full, requires reason ≥3 chars, cannot exceed refundable; full refund flips status to `refunded`.
- Void: blocked if any refunds exist (and refunds blocked on voided payments); writes one `reversal_payment` ledger entry — guarded against duplicates when subscription cancellation already reversed it.
- `financial_ledger` is append-only cash truth with `UNIQUE(ref_table, ref_id, entry_type)`; finance overview reads from the ledger, not from payments directly.

## Expenses & Cash Boxes

- Expense: category + method + description ≥3 chars + date not in future; void writes reversal entry, editing writes compensating adjustment; attachments (PDF/JPEG/PNG, ≤2 MB) are stored on disk under `Files/expense_attachment/` and registered in the `files` table (kind `expense_attachment`).
- Categories can't be disabled while referenced by past expenses.
- Dual boxes `gym` | `store`; exactly ONE open session per box (partial unique index); store sale payments, credit-sale reversals, and debt installments are tagged `box='store'` in the ledger; expected closing = opening + cash-in − cash-out **scoped to the session's box**; counted-vs-expected difference stored permanently with audit when ≠ 0. Sessions accept an optional `box` input (default `gym`).

## Store / POS

- Credit sale REQUIRES a member and creates exactly one `store_debts` row per sale (1:1 via UNIQUE sale_id), repaid through installments (`store_debt_payments`) — each installment writes its own ledger entry keyed by the repayment row id, so any number of partial repayments succeed. Voiding a partially-repaid credit sale is rejected with a clear conflict (void-before-any-repayment drops the open debt).
- Product hard-purge (`store.purge`) cascades its stock-movement log and detaches its lines from historical sales (headers/totals intact); audited with removal counts (ADR-008).
- Stock: movements ledger (stock_in/sale/manual_adjust/damage/count_correction); negative stock rejected unless `allow_negative_stock=1`.
- Void sale reverses stock and marks debt rows; profit stats use cost vs price minor units.

## Classes & Training

- Booking enforces session capacity (override needs manage permission) and rejects duplicates via UNIQUE(session_id, member_id).
- `consumes_session=1` classes consume one session credit atomically inside the booking transaction.
- Training plans: overlap-guarded per member; expired plans auto-swept to `ended`.

## Employees & Salaries

- Salary types: monthly | daily | per_class | custom; one salary row per employee+month (UNIQUE).
- Paying a salary marks it paid and generates an expense + ledger entry in the same transaction.

## InBody / Fitness tests

- Body assessments compute BMI server-side; progress deltas between two assessments; delete requires manage permission.
- Custom fitness test definitions are idempotent upserts keyed by name.

## CRM

- Seeded Arabic templates with `{{var}}` substitution; unknown placeholders left intact.
- Messages deduplicated by `dedupe_key`; statuses include manual_opened / skipped_no_phone / skipped_no_provider; sending is manual-open WhatsApp flow (no automated transport).

## Users, Roles & Permissions

- First-run setup creates the single owner; setup endpoint refuses once an owner exists.
- Lockout: 5 failed logins → 300 s lock; success resets counter.
- Sessions: HttpOnly cookie, SHA-hashed token in `auth_sessions`, 12 h sliding TTL, pruned at boot/login.
- 73 permissions × 4 roles; owner always passes every check; other roles resolve from `role_permissions` table cached in memory (refreshed on boot and after each committed write); editable at runtime from Permissions page (requires `users.view` to view, `settings.edit` to mutate; owner row immutable). Multiple owner accounts are allowed — each passes everything by design (e.g., the "Anwar" account, ADR-007). Manager holds `settings.edit` since migration v7, enabling permission control over subordinate roles (ADR-007).
- Deactivating self or the last active owner is refused.

## Backups / Restore

- `.gymbak` snapshot verified (SQLite header + integrity_check + users present) before adoption; pre-restore safety snapshot taken automatically; restore swaps DB files atomically and reopens. Server-enforced permissions: create → `backup.create`, download/import → `backup.restore`; the first-run legacy import runs under a synthetic system actor whose user-FK columns are stored as NULL.
- Legacy import runs unauthenticated ONLY while no owner exists yet.

## UNKNOWN — REQUIRES CONFIRMATION

- Exact freeze window length rule (setting-driven; verify values before relying).
- Auto-backup scheduling behavior details (settings exist; runtime trigger semantics not re-verified).
- Notifications digest generation cadence.
