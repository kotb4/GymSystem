# Yassen Mohamed Kotb | 01288536381 Database

## Technology

- **Engine:** SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`, synchronous)
- **Location:** `%LOCALAPPDATA%/GymSystem/Database/gym.db`
- **Pragmas:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`
- **Migrations:** Append-only array in `src/db/migrations.ts`, tracked in `schema_migrations` table, applied at boot inside a transaction. Currently **v1 through v32**.
- **Total tables:** 43 (including `schema_migrations` created at runtime)

## Conventions

| Pattern | Implementation |
|---------|---------------|
| **Primary keys** | `TEXT` UUIDs via `crypto.randomUUID()`, except `audit_logs`/`financial_ledger`/`backups_log` which use `INTEGER PRIMARY KEY AUTOINCREMENT` |
| **Money** | `*_minor INTEGER` (piastres; 100 = 1 EGP). CHECK constraints enforce `>= 0`. |
| **Dates** | `YYYY-MM-DD` TEXT columns for date-only fields (start_date, end_date, etc.) |
| **Timestamps** | `YYYY-MM-DD HH:mm:ss` TEXT for all datetime columns |
| **Soft delete** | Members only: `deleted_at`, `deleted_by`, `deletion_reason` |
| **Status enums** | CHECK constraints enforce allowed values |
| **FK enforcement** | `PRAGMA foreign_keys=ON`; all FKs use `REFERENCES t(c)` without ON DELETE (defaults to RESTRICT) |
| **Unique constraints** | Partial unique indexes on nullable phone/barcode columns |

## Migration History

| Version | Changes |
|---------|---------|
| v1 | Core: roles, permissions, role_permissions, users, settings, membership_plans, members, cards, member_subscriptions, attendance, audit_logs, counters. Seed: 4 roles, 73 permissions, 4 payment methods, 10 expense categories. |
| v2 | Payments: payment_methods, expense_categories, payments, payment_refunds, expenses, cash_sessions, financial_ledger |
| v3 | Trainers: trainers, training_plans, backups_log |
| v4 | Major expansion: plan kinds (time/sessions/open), subscription_freezes, body_assessments, fitness_test_defs/results, product_categories, products, stock_movements, store_sales, store_sale_items, store_debts, store_debt_payments, classes, class_sessions, class_bookings, employees, salaries, expense_attachments (BLOB), crm_templates, crm_messages. Added: members.department, users.department, cash_sessions.box, financial_ledger.box, attendance.checkout_at |
| v5 | auth_sessions |
| v6 | files table, members.photo_file_id, employees.salary_type/base, allow_negative_stock setting |
| v7 | Manager gains `settings.edit` permission |
| v8 | employees.purge, store.purge, cash.purge permission codes |
| v9 | subscriptions.purge permission code |

## Complete Table Reference

### Core Entities

**`users`** — System users with authentication
- id (PK), username (UNIQUE, NOCASE), password_hash, full_name, role_id (FK→roles), is_active, failed_attempts, locked_until, department (general/men/women), created_at, updated_at, last_login_at

**`roles`** — System roles (seeded: owner, manager, reception, trainer)
- id (PK TEXT), name_ar, created_at

**`permissions`** — Permission codes (73 seeded)
- code (PK TEXT)

**`role_permissions`** — Role-permission grants (composite PK)
- role_id (FK→roles), permission_code (FK→permissions)

**`settings`** — Key-value configuration (32 keys)
- key (PK TEXT), value (TEXT)

**`members`** — Gym members
- id (PK), member_code (UNIQUE), full_name, phone, email, gender, date_of_birth, address, notes, registration_date, status (active/inactive/suspended/archived), department (general/men/women), photo_file_id (FK→files), deleted_at/deleted_by/deletion_reason (soft delete), height_cm, weight_kg, emergency_contact_name/phone, created_by, created_at, updated_at, archived_at

**`cards`** — Physical barcode cards
- id (PK), barcode_value (UNIQUE), status (available/assigned/lost/blocked), member_id (FK→members), notes, assigned_at, assigned_by, unassigned_at, created_at, updated_at

**`membership_plans`** — Subscription plan templates
- id (PK), name (UNIQUE), duration_days (CHECK>0), price (REAL, CHECK>=0), description, color, is_active, kind (time/sessions/open), sessions_count (CHECK>0), created_at, updated_at

### Subscriptions & Attendance

**`member_subscriptions`** — Active subscriptions
- id (PK), member_id (FK→members), plan_id (FK→membership_plans), start_date, end_date, price (REAL), status (active/suspended/cancelled), sessions_total, sessions_used, frozen_at, frozen_days, resume_date, notes, created_by, created_at, updated_at
- CHECK: end_date >= start_date

**`subscription_freezes`** — Freeze history
- id (PK), subscription_id (FK→member_subscriptions), frozen_at, expected_resume_date, actual_resume_date, reason, created_by, created_at

**`attendance`** — Check-in/check-out records
- id (PK), member_id (FK→members), card_id (FK→cards), subscription_id (FK→member_subscriptions), checkin_at, checkout_at, created_by, device_identifier, notes

### Payments & Finance

**`payments`** — Full payment records
- id (PK), member_id (FK→members), subscription_id (FK→member_subscriptions), base_amount_minor, discount_kind (none/fixed/percent), discount_input, discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, method_code (FK→payment_methods), status (partial/paid/voided/refunded), reference_no, notes, client_ref (UNIQUE), paid_at, created_by, voided_by, voided_at, void_reason, created_at, updated_at
- CHECK arithmetic: net = base - discount, paid <= net, refunded <= paid, remaining = net - paid

**`payment_refunds`** — Individual refund records
- id (PK), payment_id (FK→payments), amount_minor (CHECK>0), reason, method_code, created_by, created_at

**`financial_ledger`** — Append-only cash truth (AUTOINCREMENT)
- id (PK), entry_type (payment/refund/reversal_payment/reversal_expense/expense), ref_table, ref_id, member_id, method_code, direction (+1/-1), amount_minor, occurred_at, box (gym/store), created_by, created_at
- UNIQUE(ref_table, ref_id, entry_type)

**`payment_methods`** — Payment method lookup (seeded: cash, bank_card, transfer, other)
- code (PK), label_ar, is_active, sort_order, created_at

**`expense_categories`** — Expense categories (10 seeded)
- id (PK), name_ar (UNIQUE), is_active, created_at

**`expenses`** — Expense records
- id (PK), category_id (FK→expense_categories), amount_minor, method_code, description, expense_date, reference_no, status (active/voided), void_reason, voided_by, voided_at, created_by, updated_at, created_at

**`expense_attachments`** — *removed.* The legacy BLOB table was dropped in migration v15; legacy rows were backfilled to the filesystem (migration v26, `server/expense-attachments-backfill.ts`). Expense attachments now live in the `files` registry with `kind='expense_attachment'` and are read from `Files/expense_attachment/<id><ext>` on disk.

**`cash_sessions`** — Cash register open/close
- id (PK), opened_by, opened_at, opening_balance_minor, closed_by, closed_at, expected_closing_minor, counted_closing_minor, difference_minor, close_note, status (open/closed), box (gym/store)
- UNIQUE(box) WHERE status = 'open' (one open session per box)

### Store/POS

**`product_categories`** — Store product categories (5 seeded)
- id (PK), name_ar (UNIQUE), is_active, created_at

**`products`** — Store products
- id (PK), name, category_id, sku (UNIQUE), barcode (UNIQUE), cost_minor, price_minor, stock_qty, min_stock_qty, supplier_name, is_active, created_by, created_at, updated_at

**`stock_movements`** — Inventory movement log
- id (PK), product_id (FK→products), movement_type (stock_in/sale/manual_adjust/damage/count_correction), delta, result_qty, unit_cost_minor, ref_table, ref_id, notes, created_by, created_at

**`store_sales`** — Store/POS sales header
- id (PK), sale_no (UNIQUE), items_total_minor, discount_minor, total_minor, cost_total_minor, method_code, member_id, is_credit, status (completed/voided), seller_id, sold_at, notes, void_reason, voided_by, voided_at, created_at

**`store_sale_items`** — Store/POS sale line items
- id (PK), sale_id (FK→store_sales), product_id (FK→products), product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor

**`store_debts`** — Credit sale debts
- id (PK), member_id, sale_id (UNIQUE, FK→store_sales), original_minor, paid_minor, status (open/settled), notes, created_by, created_at, updated_at

**`store_debt_payments`** — Debt installment repayments
- id (PK), debt_id (FK→store_debts), amount_minor, method_code, created_by, created_at

### Classes & Training

**`classes`** — Gym class definitions
- id (PK), name, description, trainer_id (FK→trainers), location, capacity (CHECK>0), consumes_session (bool), is_active, created_by, created_at, updated_at

**`class_sessions`** — Scheduled class instances
- id (PK), class_id (FK→classes), session_date, start_time, duration_min, capacity, status (scheduled/done/cancelled), notes, created_by, created_at
- UNIQUE(class_id, session_date, start_time)

**`class_bookings`** — Member bookings
- id (PK), session_id (FK→class_sessions), member_id (FK→members), status (booked/attended/cancelled/no_show), consumed_subscription_id (FK→member_subscriptions), booked_by, booked_at
- UNIQUE(session_id, member_id)

**`trainers`** — Trainer profiles
- id (PK), full_name, phone (UNIQUE partial), email, specialization, joined_date, is_active, notes, created_by, created_at, updated_at

**`training_plans`** — Member-trainer assignments
- id (PK), member_id, trainer_id, start_date, end_date, status (active/ended/cancelled), notes, created_by, created_at, updated_at

### Employees & Salaries

**`employees`** — Employee profiles
- id (PK), full_name, phone, role_title, department, specialization, salary_type (monthly/daily/per_class/custom), salary_base_minor, monthly_salary_minor, joined_date, user_id, trainer_id, is_active, notes, created_by, created_at, updated_at

**`salaries`** — Monthly salary records
- id (PK), employee_id (FK→employees), period_month, base_amount_minor, bonus_minor, deduction_minor, net_amount_minor, method_code, status (pending/paid), paid_at, notes, created_by, created_at, updated_at
- UNIQUE(employee_id, period_month)
- CHECK: net = base + bonus - deduction

### Assessments

**`body_assessments`** — InBody body composition
- id (PK), member_id, assessment_date, height_cm, weight_kg, body_fat_percent, muscle_mass_kg, bmi, waist_cm, chest_cm, arm_cm, thigh_cm, notes, trainer_id, created_by, created_at

**`fitness_test_defs`** — Custom fitness test definitions
- id (PK), name (UNIQUE), unit, is_active, created_by, created_at

**`fitness_test_results`** — Fitness test results
- id (PK), def_id (FK→fitness_test_defs), member_id, value, test_date, trainer_id, notes, created_by, created_at

### CRM

**`crm_templates`** — WhatsApp/message templates (6 seeded)
- code (PK), body_ar, is_active, updated_at

**`crm_messages`** — Sent/queued messages
- id (PK), member_id, template_code, channel (whatsapp), body, phone, status (pending/sent/manual_opened/failed/skipped_no_provider/skipped_no_phone), provider_ref, error, dedupe_key (UNIQUE), sent_at, created_by, created_at

### System

**`auth_sessions`** — Server-side session tokens
- token_hash (PK), user_id (FK→users), created_at, last_seen_at, expires_at

**`files`** — Filesystem file registry (bytes live on disk under `Files/<kind>/<id><ext>`)
- id (PK), kind (member_photo/inbody_report/expense_attachment/other), original_name, mime_type, size_bytes, sha256, relative_path (v25+), created_by, created_at

**`audit_logs`** — Audit trail (AUTOINCREMENT)
- id (PK), user_id, user_name, action, entity_type, entity_id, metadata (JSON), created_at

**`backups_log`** — Backup audit trail (AUTOINCREMENT)
- id (PK), kind (manual/auto/pre_restore), file_name, size_bytes, checksum, verified, created_by, created_at

**`counters`** — Auto-increment sequence counters
- name (PK), value (seeded: member_code=0, card_barcode=100)

## Key Indexes

- `idx_members_phone_unique` — UNIQUE partial on phone (excludes NULL/empty)
- `idx_trainers_phone_unique` — UNIQUE partial on phone (excludes NULL/empty)
- `idx_cash_sessions_box_open` — UNIQUE partial: one open session per box
- `idx_subs_status_end` — subscription status + end_date for expiry queries
- `idx_ledger_box` — ledger box + occurred_at for financial queries
