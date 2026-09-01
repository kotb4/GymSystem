import { nowStamp, diffDaysKeys } from "@/core/dates";
import { PERMS, ROLES, ROLE_GRANTS, type RoleId } from "@/core/permissions";
import type { Db, Row } from "./engine";

export interface Migration {
  version: number;
  statements: string[];
  callback?: (db: Db) => void;
  /** When true, FOREIGN KEY enforcement is disabled at the connection level
   * around this migration (needed for table-rebuild DROP/RENAME that reference
   * other tables). SQLite ignores `PRAGMA foreign_keys` inside a transaction,
   * so it is toggled before/after the migration transaction. */
  fkOff?: boolean;
}

const BASE_TS = "2026-01-01 00:00:00";

const ROLE_LABELS_AR: Record<RoleId, string> = {
  owner: "المالك",
  manager: "مدير",
  reception: "استقبال",
  trainer: "مدرب",
};

function buildMigrations(): Migration[] {
  const roleValues = ROLES.map((role) => `('${role}', '${ROLE_LABELS_AR[role]}', '${BASE_TS}')`).join(
    ", ",
  );
  const permValues = PERMS.map((perm) => `('${perm}')`).join(", ");
  const grantValues = ROLES.flatMap((role) =>
    ROLE_GRANTS[role].map((perm) => `('${role}', '${perm}')`),
  ).join(", ");

  return [
    {
      version: 1,
      statements: [
        "CREATE TABLE roles (\n  id TEXT PRIMARY KEY,\n  name_ar TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
        `INSERT INTO roles (id, name_ar, created_at) VALUES ${roleValues}`,
        "CREATE TABLE permissions (\n  code TEXT PRIMARY KEY\n)",
        `INSERT INTO permissions (code) VALUES ${permValues}`,
        "CREATE TABLE role_permissions (\n  role_id TEXT NOT NULL REFERENCES roles(id),\n  permission_code TEXT NOT NULL REFERENCES permissions(code),\n  PRIMARY KEY (role_id, permission_code)\n)",
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ${grantValues}`,
        "CREATE TABLE users (\n  id TEXT PRIMARY KEY,\n  username TEXT NOT NULL COLLATE NOCASE UNIQUE,\n  email TEXT UNIQUE,\n  password_hash TEXT NOT NULL,\n  full_name TEXT NOT NULL,\n  role_id TEXT NOT NULL REFERENCES roles(id),\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  failed_attempts INTEGER NOT NULL DEFAULT 0,\n  locked_until TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  last_login_at TEXT\n)",
        "CREATE INDEX idx_users_role ON users(role_id)",
        "CREATE TABLE settings (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL\n)",
        "CREATE TABLE membership_plans (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  duration_days INTEGER NOT NULL CHECK (duration_days > 0),\n  price REAL NOT NULL CHECK (price >= 0),\n  description TEXT,\n  color TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE TABLE members (\n  id TEXT PRIMARY KEY,\n  member_code TEXT NOT NULL UNIQUE,\n  full_name TEXT NOT NULL,\n  phone TEXT,\n  email TEXT,\n  gender TEXT CHECK (gender IN ('male', 'female')),\n  date_of_birth TEXT,\n  address TEXT,\n  photo_path TEXT,\n  notes TEXT,\n  registration_date TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'archived')),\n  created_by TEXT REFERENCES users(id),\n  archived_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_members_name ON members(full_name)",
        "CREATE INDEX idx_members_phone ON members(phone)",
        "CREATE INDEX idx_members_status ON members(status)",
        "CREATE UNIQUE INDEX idx_members_phone_unique ON members(phone) WHERE phone IS NOT NULL AND phone != ''",
        "CREATE TABLE cards (\n  id TEXT PRIMARY KEY,\n  barcode_value TEXT NOT NULL UNIQUE,\n  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'lost', 'blocked')),\n  member_id TEXT REFERENCES members(id),\n  notes TEXT,\n  assigned_at TEXT,\n  assigned_by TEXT REFERENCES users(id),\n  unassigned_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_cards_member ON cards(member_id)",
        "CREATE INDEX idx_cards_status ON cards(status)",
        "CREATE TABLE member_subscriptions (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  plan_id TEXT NOT NULL REFERENCES membership_plans(id),\n  start_date TEXT NOT NULL,\n  end_date TEXT NOT NULL,\n  price REAL NOT NULL CHECK (price >= 0),\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (end_date >= start_date)\n)",
        "CREATE INDEX idx_subs_member ON member_subscriptions(member_id)",
        "CREATE INDEX idx_subs_dates ON member_subscriptions(start_date, end_date)",
        "CREATE INDEX idx_subs_plan ON member_subscriptions(plan_id)",
        "CREATE TABLE attendance (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  card_id TEXT REFERENCES cards(id),\n  subscription_id TEXT REFERENCES member_subscriptions(id),\n  checkin_at TEXT NOT NULL,\n  created_by TEXT REFERENCES users(id),\n  device_identifier TEXT,\n  notes TEXT\n)",
        "CREATE INDEX idx_att_member_time ON attendance(member_id, checkin_at)",
        "CREATE INDEX idx_att_time ON attendance(checkin_at)",
        "CREATE TABLE audit_logs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id TEXT REFERENCES users(id),\n  user_name TEXT NOT NULL,\n  action TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT,\n  metadata TEXT,\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_audit_created ON audit_logs(created_at)",
        "CREATE INDEX idx_audit_user ON audit_logs(user_id)",
        "CREATE TABLE counters (\n  name TEXT PRIMARY KEY,\n  value INTEGER NOT NULL\n)",
        "INSERT INTO counters (name, value) VALUES ('member_code', 0), ('card_barcode', 100)",
      ],
    },
    {
      version: 2,
      statements: [
        "CREATE TABLE payment_methods (\n  code TEXT PRIMARY KEY,\n  label_ar TEXT NOT NULL,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  sort_order INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL\n)",
        `INSERT INTO payment_methods (code, label_ar, sort_order, created_at) VALUES\n  ('cash', 'نقدي', 1, '${BASE_TS}'),\n  ('bank_card', 'بطاقة بنكية', 2, '${BASE_TS}'),\n  ('transfer', 'تحويل / محفظة إلكترونية', 3, '${BASE_TS}'),\n  ('other', 'أخرى', 4, '${BASE_TS}')`,
        "CREATE TABLE expense_categories (\n  id TEXT PRIMARY KEY,\n  name_ar TEXT NOT NULL UNIQUE,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_at TEXT NOT NULL\n)",
        `INSERT INTO expense_categories (id, name_ar, created_at) VALUES\n  ('cat-rent', 'إيجار', '${BASE_TS}'),\n  ('cat-electricity', 'كهرباء', '${BASE_TS}'),\n  ('cat-water', 'مياه', '${BASE_TS}'),\n  ('cat-maintenance', 'صيانة', '${BASE_TS}'),\n  ('cat-salaries', 'مرتبات', '${BASE_TS}'),\n  ('cat-equipment', 'أجهزة ومعدات', '${BASE_TS}'),\n  ('cat-cleaning', 'نظافة', '${BASE_TS}'),\n  ('cat-marketing', 'تسويق', '${BASE_TS}'),\n  ('cat-supplies', 'مستلزمات', '${BASE_TS}'),\n  ('cat-other', 'أخرى', '${BASE_TS}')`,
        "CREATE TABLE payments (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  subscription_id TEXT REFERENCES member_subscriptions(id),\n  base_amount_minor INTEGER NOT NULL CHECK (base_amount_minor >= 0),\n  discount_kind TEXT NOT NULL DEFAULT 'none' CHECK (discount_kind IN ('none', 'fixed', 'percent')),\n  discount_input REAL NOT NULL DEFAULT 0 CHECK (discount_input >= 0),\n  discount_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),\n  net_amount_minor INTEGER NOT NULL CHECK (net_amount_minor >= 0),\n  paid_amount_minor INTEGER NOT NULL CHECK (paid_amount_minor >= 0),\n  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0),\n  remaining_amount_minor INTEGER NOT NULL CHECK (remaining_amount_minor >= 0),\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  status TEXT NOT NULL CHECK (status IN ('partial', 'paid', 'voided', 'refunded')),\n  reference_no TEXT,\n  notes TEXT,\n  client_ref TEXT UNIQUE,\n  paid_at TEXT NOT NULL,\n  created_by TEXT NOT NULL REFERENCES users(id),\n  voided_by TEXT REFERENCES users(id),\n  voided_at TEXT,\n  void_reason TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (discount_amount_minor <= base_amount_minor),\n  CHECK (net_amount_minor = base_amount_minor - discount_amount_minor),\n  CHECK (paid_amount_minor <= net_amount_minor),\n  CHECK (refunded_amount_minor <= paid_amount_minor),\n  CHECK (remaining_amount_minor = net_amount_minor - paid_amount_minor)\n)",
        "CREATE INDEX idx_payments_member ON payments(member_id)",
        "CREATE INDEX idx_payments_subscription ON payments(subscription_id)",
        "CREATE INDEX idx_payments_paid_at ON payments(paid_at)",
        "CREATE INDEX idx_payments_status ON payments(status)",
        "CREATE INDEX idx_payments_created_by ON payments(created_by)",
        "CREATE TABLE payment_refunds (\n  id TEXT PRIMARY KEY,\n  payment_id TEXT NOT NULL REFERENCES payments(id),\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  reason TEXT NOT NULL,\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_refunds_payment ON payment_refunds(payment_id)",
        "CREATE INDEX idx_refunds_created ON payment_refunds(created_at)",
        "CREATE TABLE expenses (\n  id TEXT PRIMARY KEY,\n  category_id TEXT NOT NULL REFERENCES expense_categories(id),\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  description TEXT NOT NULL,\n  expense_date TEXT NOT NULL,\n  reference_no TEXT,\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),\n  void_reason TEXT,\n  voided_by TEXT REFERENCES users(id),\n  voided_at TEXT,\n  created_by TEXT NOT NULL REFERENCES users(id),\n  updated_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_expenses_date ON expenses(expense_date)",
        "CREATE INDEX idx_expenses_category ON expenses(category_id)",
        "CREATE INDEX idx_expenses_status ON expenses(status)",
        "CREATE TABLE cash_sessions (\n  id TEXT PRIMARY KEY,\n  opened_by TEXT NOT NULL REFERENCES users(id),\n  opened_at TEXT NOT NULL,\n  opening_balance_minor INTEGER NOT NULL CHECK (opening_balance_minor >= 0),\n  closed_by TEXT REFERENCES users(id),\n  closed_at TEXT,\n  expected_closing_minor INTEGER CHECK (expected_closing_minor IS NULL OR expected_closing_minor >= 0),\n  counted_closing_minor INTEGER CHECK (counted_closing_minor IS NULL OR counted_closing_minor >= 0),\n  difference_minor INTEGER,\n  close_note TEXT,\n  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))\n)",
        "CREATE UNIQUE INDEX idx_cash_sessions_single_open ON cash_sessions(status) WHERE status = 'open'",
        "CREATE INDEX idx_cash_sessions_opened ON cash_sessions(opened_at)",
        "CREATE TABLE financial_ledger (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  entry_type TEXT NOT NULL CHECK (entry_type IN ('payment', 'refund', 'reversal_payment', 'reversal_expense', 'expense')),\n  ref_table TEXT NOT NULL,\n  ref_id TEXT NOT NULL,\n  member_id TEXT,\n  method_code TEXT NOT NULL,\n  direction INTEGER NOT NULL CHECK (direction IN (1, -1)),\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  occurred_at TEXT NOT NULL,\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  UNIQUE (ref_table, ref_id, entry_type)\n)",
        "CREATE INDEX idx_ledger_occurred ON financial_ledger(occurred_at)",
        "CREATE INDEX idx_ledger_method ON financial_ledger(method_code)",
        "CREATE INDEX idx_ledger_member ON financial_ledger(member_id)",
      ],
    },
    {
      version: 3,
      statements: [
        "CREATE TABLE trainers (\n  id TEXT PRIMARY KEY,\n  full_name TEXT NOT NULL,\n  phone TEXT,\n  email TEXT,\n  specialization TEXT,\n  joined_date TEXT NOT NULL,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE UNIQUE INDEX idx_trainers_phone_unique ON trainers(phone) WHERE phone IS NOT NULL AND phone != ''",
        "CREATE INDEX idx_trainers_active ON trainers(is_active)",
        "CREATE TABLE training_plans (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  trainer_id TEXT NOT NULL REFERENCES trainers(id),\n  start_date TEXT NOT NULL,\n  end_date TEXT NOT NULL,\n  notes TEXT,\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (end_date >= start_date)\n)",
        "CREATE INDEX idx_tplans_member ON training_plans(member_id)",
        "CREATE INDEX idx_tplans_trainer ON training_plans(trainer_id)",
        "CREATE INDEX idx_tplans_dates ON training_plans(start_date, end_date)",
        "CREATE TABLE backups_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  kind TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'pre_restore')),\n  file_name TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),\n  checksum TEXT,\n  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_backups_created ON backups_log(created_at)",
      ],
    },
    {
      version: 4,
      statements: [
        // ---- plan kinds & session subscriptions ----
        "ALTER TABLE membership_plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'time' CHECK (kind IN ('time', 'sessions', 'open'))",
        "ALTER TABLE membership_plans ADD COLUMN sessions_count INTEGER CHECK (sessions_count IS NULL OR sessions_count > 0)",
        "ALTER TABLE member_subscriptions ADD COLUMN sessions_total INTEGER",
        "ALTER TABLE member_subscriptions ADD COLUMN sessions_used INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE member_subscriptions ADD COLUMN frozen_at TEXT",
        "ALTER TABLE member_subscriptions ADD COLUMN frozen_days INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE member_subscriptions ADD COLUMN resume_date TEXT",
        "CREATE INDEX idx_subs_status_end ON member_subscriptions(status, end_date)",

        // ---- subscription freeze history ----
        "CREATE TABLE subscription_freezes (\n  id TEXT PRIMARY KEY,\n  subscription_id TEXT NOT NULL REFERENCES member_subscriptions(id),\n  frozen_at TEXT NOT NULL,\n  expected_resume_date TEXT,\n  actual_resume_date TEXT,\n  reason TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_freezes_sub ON subscription_freezes(subscription_id)",

        // ---- member profile enrichment + trash ----
        "ALTER TABLE members ADD COLUMN height_cm REAL",
        "ALTER TABLE members ADD COLUMN weight_kg REAL",
        "ALTER TABLE members ADD COLUMN emergency_contact_name TEXT",
        "ALTER TABLE members ADD COLUMN emergency_contact_phone TEXT",
        "ALTER TABLE members ADD COLUMN department TEXT NOT NULL DEFAULT 'general' CHECK (department IN ('general', 'men', 'women'))",
        "ALTER TABLE members ADD COLUMN deleted_at TEXT",
        "ALTER TABLE members ADD COLUMN deleted_by TEXT REFERENCES users(id)",
        "ALTER TABLE members ADD COLUMN deletion_reason TEXT",
        "CREATE INDEX idx_members_deleted ON members(deleted_at)",
        "CREATE INDEX idx_members_department ON members(department)",
        "CREATE INDEX idx_members_dob ON members(date_of_birth)",

        // ---- users department scoping ----
        "ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT 'general' CHECK (department IN ('general', 'men', 'women'))",

        // ---- attendance check-out ----
        "ALTER TABLE attendance ADD COLUMN checkout_at TEXT",

        // ---- body assessments & custom fitness tests ----
        "CREATE TABLE body_assessments (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  assessment_date TEXT NOT NULL,\n  height_cm REAL,\n  weight_kg REAL,\n  body_fat_percent REAL,\n  muscle_mass_kg REAL,\n  bmi REAL,\n  waist_cm REAL,\n  chest_cm REAL,\n  arm_cm REAL,\n  thigh_cm REAL,\n  notes TEXT,\n  trainer_id TEXT REFERENCES trainers(id),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_assess_member_date ON body_assessments(member_id, assessment_date)",
        "CREATE TABLE fitness_test_defs (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  unit TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE TABLE fitness_test_results (\n  id TEXT PRIMARY KEY,\n  def_id TEXT NOT NULL REFERENCES fitness_test_defs(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  value REAL NOT NULL,\n  test_date TEXT NOT NULL,\n  trainer_id TEXT REFERENCES trainers(id),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_ftests_def_member ON fitness_test_results(def_id, member_id, test_date)",
        "CREATE INDEX idx_ftests_member ON fitness_test_results(member_id, test_date)",

        // ---- store / POS ----
        "CREATE TABLE product_categories (\n  id TEXT PRIMARY KEY,\n  name_ar TEXT NOT NULL UNIQUE,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_at TEXT NOT NULL\n)",
        `INSERT INTO product_categories (id, name_ar, created_at) VALUES\n  ('pcat-supplements', 'مكملات غذائية', '${BASE_TS}'),\n  ('pcat-drinks', 'مشروبات', '${BASE_TS}'),\n  ('pcat-accessories', 'إكسسوارات', '${BASE_TS}'),\n  ('pcat-apparel', 'ملابس رياضية', '${BASE_TS}'),\n  ('pcat-other', 'أخرى', '${BASE_TS}')`,
        "CREATE TABLE products (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  category_id TEXT REFERENCES product_categories(id),\n  sku TEXT UNIQUE,\n  barcode TEXT UNIQUE,\n  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),\n  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),\n  stock_qty REAL NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),\n  min_stock_qty REAL NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),\n  supplier_name TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_products_category ON products(category_id)",
        "CREATE INDEX idx_products_active ON products(is_active)",
        "CREATE INDEX idx_products_name ON products(name)",
        "CREATE TABLE stock_movements (\n  id TEXT PRIMARY KEY,\n  product_id TEXT NOT NULL REFERENCES products(id),\n  movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_in', 'sale', 'manual_adjust', 'damage', 'count_correction')),\n  delta REAL NOT NULL,\n  result_qty REAL NOT NULL CHECK (result_qty >= 0),\n  unit_cost_minor INTEGER,\n  ref_table TEXT,\n  ref_id TEXT,\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_stock_moves_product ON stock_movements(product_id, created_at)",
        "CREATE INDEX idx_stock_moves_type ON stock_movements(movement_type)",

        // ---- store sales ----
        "CREATE TABLE store_sales (\n  id TEXT PRIMARY KEY,\n  sale_no TEXT NOT NULL UNIQUE,\n  items_total_minor INTEGER NOT NULL CHECK (items_total_minor >= 0),\n  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),\n  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),\n  cost_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_total_minor >= 0),\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  member_id TEXT REFERENCES members(id),\n  is_credit INTEGER NOT NULL DEFAULT 0 CHECK (is_credit IN (0, 1)),\n  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),\n  void_reason TEXT,\n  voided_by TEXT REFERENCES users(id),\n  voided_at TEXT,\n  seller_id TEXT NOT NULL REFERENCES users(id),\n  sold_at TEXT NOT NULL,\n  notes TEXT,\n  created_at TEXT NOT NULL,\n  CHECK (discount_minor <= items_total_minor),\n  CHECK (total_minor = items_total_minor - discount_minor)\n)",
        "CREATE INDEX idx_sales_seller ON store_sales(seller_id)",
        "CREATE INDEX idx_sales_sold_at ON store_sales(sold_at)",
        "CREATE INDEX idx_sales_member ON store_sales(member_id)",
        "CREATE INDEX idx_sales_status ON store_sales(status)",
        "CREATE TABLE store_sale_items (\n  id TEXT PRIMARY KEY,\n  sale_id TEXT NOT NULL REFERENCES store_sales(id),\n  product_id TEXT NOT NULL REFERENCES products(id),\n  product_name_snapshot TEXT NOT NULL,\n  qty REAL NOT NULL CHECK (qty > 0),\n  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),\n  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),\n  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)\n)",
        "CREATE INDEX idx_sale_items_sale ON store_sale_items(sale_id)",
        "CREATE INDEX idx_sale_items_product ON store_sale_items(product_id)",

        // ---- store debts (separate from gym subscription debt) ----
        "CREATE TABLE store_debts (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  sale_id TEXT NOT NULL UNIQUE REFERENCES store_sales(id),\n  original_minor INTEGER NOT NULL CHECK (original_minor > 0),\n  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),\n  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),\n  notes TEXT,\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (paid_minor <= original_minor)\n)",
        "CREATE INDEX idx_store_debts_member ON store_debts(member_id, status)",
        "CREATE TABLE store_debt_payments (\n  id TEXT PRIMARY KEY,\n  debt_id TEXT NOT NULL REFERENCES store_debts(id),\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_debt_payments_debt ON store_debt_payments(debt_id)",

        // ---- classes ----
        "CREATE TABLE classes (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  description TEXT,\n  trainer_id TEXT REFERENCES trainers(id),\n  location TEXT,\n  capacity INTEGER NOT NULL CHECK (capacity > 0),\n  consumes_session INTEGER NOT NULL DEFAULT 0 CHECK (consumes_session IN (0, 1)),\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_classes_active ON classes(is_active)",
        "CREATE TABLE class_sessions (\n  id TEXT PRIMARY KEY,\n  class_id TEXT NOT NULL REFERENCES classes(id),\n  session_date TEXT NOT NULL,\n  start_time TEXT NOT NULL,\n  duration_min INTEGER NOT NULL DEFAULT 60 CHECK (duration_min > 0),\n  capacity INTEGER NOT NULL CHECK (capacity > 0),\n  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  UNIQUE (class_id, session_date, start_time)\n)",
        "CREATE INDEX idx_class_sessions_date ON class_sessions(session_date)",
        "CREATE TABLE class_bookings (\n  id TEXT PRIMARY KEY,\n  session_id TEXT NOT NULL REFERENCES class_sessions(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'attended', 'cancelled', 'no_show')),\n  consumed_subscription_id TEXT REFERENCES member_subscriptions(id),\n  booked_by TEXT REFERENCES users(id),\n  booked_at TEXT NOT NULL,\n  UNIQUE (session_id, member_id)\n)",
        "CREATE INDEX idx_bookings_session ON class_bookings(session_id)",
        "CREATE INDEX idx_bookings_member ON class_bookings(member_id)",

        // ---- employees & payroll ----
        "CREATE TABLE employees (\n  id TEXT PRIMARY KEY,\n  full_name TEXT NOT NULL,\n  phone TEXT,\n  role_title TEXT,\n  department TEXT NOT NULL DEFAULT 'general' CHECK (department IN ('general', 'men', 'women')),\n  specialization TEXT,\n  monthly_salary_minor INTEGER,\n  joined_date TEXT,\n  user_id TEXT REFERENCES users(id),\n  trainer_id TEXT REFERENCES trainers(id),\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_employees_active ON employees(is_active)",
        "CREATE TABLE salaries (\n  id TEXT PRIMARY KEY,\n  employee_id TEXT NOT NULL REFERENCES employees(id),\n  period_month TEXT NOT NULL,\n  base_amount_minor INTEGER NOT NULL CHECK (base_amount_minor >= 0),\n  bonus_minor INTEGER NOT NULL DEFAULT 0 CHECK (bonus_minor >= 0),\n  deduction_minor INTEGER NOT NULL DEFAULT 0 CHECK (deduction_minor >= 0),\n  net_amount_minor INTEGER NOT NULL CHECK (net_amount_minor = base_amount_minor + bonus_minor - deduction_minor),\n  method_code TEXT NOT NULL REFERENCES payment_methods(code),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),\n  paid_at TEXT,\n  notes TEXT,\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE (employee_id, period_month)\n)",
        "CREATE INDEX idx_salaries_period ON salaries(period_month)",

        // ---- expense attachments (digital invoice images stored in-DB so backups cover them) ----
        "CREATE TABLE expense_attachments (\n  id TEXT PRIMARY KEY,\n  expense_id TEXT NOT NULL REFERENCES expenses(id),\n  file_name TEXT NOT NULL,\n  mime_type TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),\n  data BLOB NOT NULL,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_expense_att ON expense_attachments(expense_id)",

        // ---- dual cash boxes ----
        "ALTER TABLE cash_sessions ADD COLUMN box TEXT NOT NULL DEFAULT 'gym' CHECK (box IN ('gym', 'store'))",
        "DROP INDEX idx_cash_sessions_single_open",
        "CREATE UNIQUE INDEX idx_cash_sessions_box_open ON cash_sessions(box) WHERE status = 'open'",
        "ALTER TABLE financial_ledger ADD COLUMN box TEXT NOT NULL DEFAULT 'gym'",
        "CREATE INDEX idx_ledger_box ON financial_ledger(box, occurred_at)",

        // ---- CRM templates & message log ----
        "CREATE TABLE crm_templates (\n  code TEXT PRIMARY KEY,\n  body_ar TEXT NOT NULL,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  updated_at TEXT NOT NULL\n)",
        `INSERT INTO crm_templates (code, body_ar, updated_at) VALUES\n  ('welcome', 'مرحبًا {{name}} 🎉\\nأهلًا بك في {{gym}}!\\nرقم عضويتك: {{code}}\\nالباقة: {{plan}}\\nتبدأ بتاريخ {{start}} وتنتهي بتاريخ {{end}}.\\nنتمنى لك رحلة لياقة ممتعة 💪', '${BASE_TS}'),\n  ('expiry_reminder', 'مرحبًا {{name}} 👋\\nاشتراكك في {{gym}} ينتهي خلال {{days}} يوم بتاريخ {{end}}.\\nجدّد الآن لتستميع بمزايا العضوية دون انقطاع 💪', '${BASE_TS}'),\n  ('gym_debt', 'مرحبًا {{name}}\\nتنبيه ودود: يوجد رصيد اشتراك غير مسدد لدى {{gym}} بمبلغ {{balance}}.\\nيسعدنا تسويته في أقرب فرصة 🙏', '${BASE_TS}'),\n  ('store_debt', 'مرحبًا {{name}}\\nتنبيه ودود: يوجد رصيد مشتريات متجر غير مسدد لدى {{gym}} بمبلغ {{balance}}.\\nيسعدنا تسويته في أقرب فرصة 🛒', '${BASE_TS}'),\n  ('birthday', 'كل عام وأنت بخير يا {{name}} 🎂🎈\\nيتقدم إليك فريق {{gym}} بأجمل التهاني بمناسبة عيد ميلادك، ونتمنى لك عامًا مليئًا بالصحة واللياقة 💪', '${BASE_TS}'),\n  ('inactive', 'نشتاق لك في {{gym}} يا {{name}} 🏋️\\nلم نراك منذ {{days}} يومًا، ونظامك التدريبي بانتظارك.\\nعودة موفقة 💪', '${BASE_TS}')`,
        "CREATE TABLE crm_messages (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  template_code TEXT NOT NULL,\n  channel TEXT NOT NULL DEFAULT 'whatsapp',\n  body TEXT NOT NULL,\n  phone TEXT,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'manual_opened', 'failed', 'skipped_no_provider', 'skipped_no_phone')),\n  provider_ref TEXT,\n  error TEXT,\n  dedupe_key TEXT UNIQUE,\n  sent_at TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_crm_messages_member ON crm_messages(member_id, created_at)",

        // ---- new settings defaults ----
        `INSERT INTO settings (key, value) VALUES\n  ('inactive_days', '7'),\n  ('attendance_checkout_enabled', '0'),\n  ('freeze_extends_expiry', '1')\nON CONFLICT(key) DO NOTHING`,
      ],
    },
    {
      version: 5,
      statements: [
        // ---- local backend auth sessions (server-owned; nothing in the browser) ----
        "CREATE TABLE auth_sessions (\n  token_hash TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  last_seen_at TEXT NOT NULL,\n  expires_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id)",
        "CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at)",
      ],
    },
    {
      version: 6,
      statements: [
        // ---- filesystem file registry (photos / attachments live in Files\ on disk) ----
        "CREATE TABLE files (\n  id TEXT PRIMARY KEY,\n  kind TEXT NOT NULL CHECK (kind IN ('member_photo','inbody_report','expense_attachment','other')),\n  original_name TEXT NOT NULL,\n  mime_type TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),\n  sha256 TEXT NOT NULL,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX idx_files_kind ON files(kind)",

        // ---- member profile photo (filesystem-backed reference) ----
        "ALTER TABLE members ADD COLUMN photo_file_id TEXT REFERENCES files(id)",

        // ---- richer employee salary model ----
        "ALTER TABLE employees ADD COLUMN salary_type TEXT NOT NULL DEFAULT 'monthly' CHECK (salary_type IN ('monthly', 'daily', 'per_class', 'custom'))",
        "ALTER TABLE employees ADD COLUMN salary_base_minor INTEGER CHECK (salary_base_minor IS NULL OR salary_base_minor >= 0)",

        // ---- store business rule: accidental negative stock guard ----
        `INSERT INTO settings (key, value) VALUES\n  ('allow_negative_stock', '0')\nON CONFLICT(key) DO NOTHING`,
      ],
    },
    {
      version: 7,
      statements: [
        // ---- manager gains permission-editor control over subordinate roles (ADR-007) ----
        "INSERT INTO role_permissions (role_id, permission_code) VALUES ('manager', 'settings.edit')\nON CONFLICT(role_id, permission_code) DO NOTHING",
      ],
    },
    {
      version: 8,
      statements: [
        // ---- hard-delete capabilities for entities that only had soft toggles (ADR-008) ----
        "INSERT OR IGNORE INTO permissions (code) VALUES ('employees.purge')",
        "INSERT OR IGNORE INTO permissions (code) VALUES ('store.purge')",
        "INSERT OR IGNORE INTO permissions (code) VALUES ('cash.purge')",
      ],
    },
    {
      version: 9,
      statements: [
        // ---- hard-delete for subscriptions (detaches history, removes its money rows) ----
        "INSERT OR IGNORE INTO permissions (code) VALUES ('subscriptions.purge')",
      ],
    },
    {
      version: 10,
      statements: [
        "INSERT OR IGNORE INTO permissions (code) VALUES ('checkin.delete')",
      ],
    },
    {
      version: 11,
      statements: [],
      callback: (db) => {
        const hasCol = db.first<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM pragma_table_info('attendance') WHERE name = 'deleted_at'",
        );
        if (!hasCol || Number(hasCol.cnt) === 0) {
          db.exec("ALTER TABLE attendance ADD COLUMN deleted_at TEXT");
        }
      },
    },
    {
      // ---- HR: employee attendance (clock in/out), leaves, deductions, incentives ----
      version: 12,
      statements: [
        "CREATE TABLE IF NOT EXISTS employee_attendance (\n  id TEXT PRIMARY KEY,\n  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,\n  date_key TEXT NOT NULL,\n  clock_in_at TEXT NOT NULL,\n  clock_out_at TEXT,\n  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),\n  is_late INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0, 1)),\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE (employee_id, date_key)\n)",
        "CREATE INDEX IF NOT EXISTS idx_emp_att_emp_date ON employee_attendance(employee_id, date_key)",
        "CREATE INDEX IF NOT EXISTS idx_emp_att_date ON employee_attendance(date_key)",
        "CREATE TABLE IF NOT EXISTS employee_leaves (\n  id TEXT PRIMARY KEY,\n  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,\n  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'emergency')),\n  start_date TEXT NOT NULL,\n  end_date TEXT NOT NULL,\n  reason TEXT,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),\n  requested_by TEXT REFERENCES users(id),\n  approved_by TEXT REFERENCES users(id),\n  approved_at TEXT,\n  decision_note TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (end_date >= start_date)\n)",
        "CREATE INDEX IF NOT EXISTS idx_emp_leave_emp ON employee_leaves(employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_emp_leave_status ON employee_leaves(status)",
        "CREATE TABLE IF NOT EXISTS employee_deductions (\n  id TEXT PRIMARY KEY,\n  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  reason TEXT NOT NULL,\n  date_key TEXT NOT NULL,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_emp_ded_emp_date ON employee_deductions(employee_id, date_key)",
        "CREATE TABLE IF NOT EXISTS employee_incentives (\n  id TEXT PRIMARY KEY,\n  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,\n  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),\n  reason TEXT NOT NULL,\n  date_key TEXT NOT NULL,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_emp_inc_emp_date ON employee_incentives(employee_id, date_key)",
      ],
    },
    {
      // ---- employee barcodes (self-service check-in/out) + per-type leave quotas ----
      version: 13,
      statements: [
        "ALTER TABLE employees ADD COLUMN barcode TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_barcode ON employees(barcode) WHERE barcode IS NOT NULL AND barcode != ''",
        "ALTER TABLE employees ADD COLUMN annual_leave_days INTEGER CHECK (annual_leave_days IS NULL OR annual_leave_days >= 0)",
        "ALTER TABLE employees ADD COLUMN sick_leave_days INTEGER CHECK (sick_leave_days IS NULL OR sick_leave_days >= 0)",
        "ALTER TABLE employees ADD COLUMN unpaid_leave_days INTEGER CHECK (unpaid_leave_days IS NULL OR unpaid_leave_days >= 0)",
        "INSERT OR IGNORE INTO permissions (code) VALUES ('hr.employee_checkin')",
      ],
    },
    {
      // ---- drop the legacy members.photo_path column (photos now live in the
      // files registry via photo_file_id). Guarded + non-fatal so old SQLite
      // builds that lack ALTER DROP COLUMN still boot. ----
      version: 14,
      statements: [],
      callback: (db) => {
        const hasCol = db.first<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM pragma_table_info('members') WHERE name = 'photo_path'",
        );
        if (!hasCol || Number(hasCol.cnt) === 0) return;
        try {
          db.exec("ALTER TABLE members DROP COLUMN photo_path");
        } catch (error) {
          console.error(`migration v14: could not drop photo_path: ${String(error)}`);
        }
      },
    },
    {
      // ---- remove the dead in-DB expense_attachments BLOB table. Attachments
      // have routed through the files registry for a long time, so this table
      // is empty in every current install. To avoid silent data loss we only
      // drop it when it holds no rows and defer otherwise. ----
      version: 15,
      statements: [],
      callback: (db) => {
        const hasTable = db.first<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = 'expense_attachments'",
        );
        if (!hasTable || Number(hasTable.cnt) === 0) return;
        const rows = db.count("SELECT COUNT(*) FROM expense_attachments");
        if (rows > 0) {
          console.error(
            `migration v15: kept expense_attachments (${rows} legacy rows) — migrate manually before dropping`,
          );
          return;
        }
        db.exec("DROP TABLE IF EXISTS expense_attachments");
      },
    },
    {
      version: 16,
      statements: [
        "CREATE TABLE IF NOT EXISTS leads (\n  id TEXT PRIMARY KEY,\n  full_name TEXT NOT NULL,\n  phone TEXT,\n  email TEXT,\n  source TEXT NOT NULL CHECK (source IN ('facebook', 'instagram', 'whatsapp', 'referral', 'walk_in', 'existing_member', 'other')),\n  interested_plan_id TEXT REFERENCES membership_plans(id),\n  department TEXT NOT NULL DEFAULT 'general' CHECK (department IN ('general', 'men', 'women')),\n  assigned_employee_id TEXT REFERENCES employees(id),\n  assigned_user_id TEXT REFERENCES users(id),\n  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'trial', 'joined', 'lost')),\n  notes TEXT,\n  lost_reason TEXT,\n  converted_member_id TEXT REFERENCES members(id),\n  contacted_at TEXT,\n  interested_at TEXT,\n  trial_at TEXT,\n  joined_at TEXT,\n  lost_at TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE TABLE IF NOT EXISTS lead_followups (\n  id TEXT PRIMARY KEY,\n  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,\n  due_date TEXT NOT NULL,\n  due_time TEXT,\n  note TEXT,\n  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),\n  done_at TEXT,\n  done_by TEXT REFERENCES users(id),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE TABLE IF NOT EXISTS lead_activity (\n  id TEXT PRIMARY KEY,\n  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,\n  action TEXT NOT NULL,\n  note TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, department)",
        "CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)",
        "CREATE INDEX IF NOT EXISTS idx_lead_followups_due ON lead_followups(lead_id, done, due_date)",
        "CREATE INDEX IF NOT EXISTS idx_lead_activity_lead ON lead_activity(lead_id, created_at)",
      ],
    },
    {
      // ---- Trial Membership workflow. A trial is a bounded-access offer
      // attached optionally to a CRM lead and/or a member. During its active
      // window the linked member may check in without a paid subscription
      // (the check-in authority lives in trials.service + attendance.service).
      // Full history is preserved via the trial row + denormalized member
      // name/code so it survives a later member purge. ----
      version: 17,
      statements: [
        "CREATE TABLE IF NOT EXISTS trials (\n  id TEXT PRIMARY KEY,\n  trial_type TEXT NOT NULL CHECK (trial_type IN ('free', 'paid', 'day_1', 'day_3', 'day_7', 'custom')),\n  lead_id TEXT REFERENCES leads(id),\n  member_id TEXT REFERENCES members(id),\n  member_code TEXT,\n  member_name TEXT,\n  phone TEXT,\n  preferred_plan_id TEXT REFERENCES membership_plans(id),\n  plan_name TEXT,\n  department TEXT NOT NULL DEFAULT 'general' CHECK (department IN ('general', 'men', 'women')),\n  start_date TEXT NOT NULL,\n  end_date TEXT NOT NULL,\n  notes TEXT,\n  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'converted', 'cancelled')),\n  converted_member_id TEXT REFERENCES members(id),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  expired_at TEXT,\n  cancelled_at TEXT,\n  cancelled_by TEXT REFERENCES users(id),\n  cancel_reason TEXT,\n  converted_at TEXT,\n  CHECK (end_date >= start_date)\n)",
        "CREATE INDEX IF NOT EXISTS idx_trials_status ON trials(status, department)",
        "CREATE INDEX IF NOT EXISTS idx_trials_member ON trials(member_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_trials_lead ON trials(lead_id)",
        "CREATE INDEX IF NOT EXISTS idx_trials_dates ON trials(start_date, end_date)",
      ],
    },
    {
      // ---- Membership Package Builder. A package is a fully configurable
      // offering (time / visit / hybrid model) with duration, price, optional
      // visit limit or unlimited visits, freeze allowance, allowed freeze
      // count, included PT sessions, allowed access areas and description.
      // -- Architecture: packages live in their OWN table so the legacy
      // membership_plans table (deeply wired into check-in, reports, payments
      // and subscriptions) stays untouched. Each package also maintains a
      // synthetic membership_plans row (synthetic_plan_id → same name/duration/
      // price, kind mapped to a legacy token) so every existing JOIN keeps
      // working. When a member subscribes, the chosen package's full config is
      // SNAPSHOTTED onto the subscription row so later package edits never
      // mutate historical subscriptions — satisfying "package changes must not
      // corrupt history" and "historical subscriptions keep their snapshot". ----
      version: 18,
      statements: [
        "CREATE TABLE IF NOT EXISTS packages (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  model TEXT NOT NULL CHECK (model IN ('time', 'visit', 'hybrid')),\n  duration_days INTEGER NOT NULL CHECK (duration_days > 0),\n  price REAL NOT NULL CHECK (price >= 0),\n  visit_limit INTEGER CHECK (visit_limit IS NULL OR visit_limit > 0),\n  unlimited_visits INTEGER NOT NULL DEFAULT 0 CHECK (unlimited_visits IN (0, 1)),\n  freeze_allowance_days INTEGER NOT NULL DEFAULT 0 CHECK (freeze_allowance_days >= 0),\n  allowed_freezes INTEGER NOT NULL DEFAULT 0 CHECK (allowed_freezes >= 0),\n  pt_sessions INTEGER NOT NULL DEFAULT 0 CHECK (pt_sessions >= 0),\n  allowed_areas TEXT,\n  description TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  synthetic_plan_id TEXT REFERENCES membership_plans(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_packages_active ON packages(is_active)",
        "ALTER TABLE member_subscriptions ADD COLUMN package_id TEXT REFERENCES packages(id)",
        "ALTER TABLE member_subscriptions ADD COLUMN package_name TEXT",
        "ALTER TABLE member_subscriptions ADD COLUMN package_model TEXT CHECK (package_model IS NULL OR package_model IN ('time', 'visit', 'hybrid'))",
        "ALTER TABLE member_subscriptions ADD COLUMN package_duration_days INTEGER",
        "ALTER TABLE member_subscriptions ADD COLUMN package_price REAL",
        "ALTER TABLE member_subscriptions ADD COLUMN package_visit_limit INTEGER",
        "ALTER TABLE member_subscriptions ADD COLUMN package_unlimited_visits INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE member_subscriptions ADD COLUMN package_freeze_allowance_days INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE member_subscriptions ADD COLUMN package_allowed_freezes INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE member_subscriptions ADD COLUMN package_pt_sessions INTEGER NOT NULL DEFAULT 0",
      ],
    },
    {
      // ---- v19: Enhanced freeze system ----
      // Add start_date, end_date, duration_days, notes to subscription_freezes
      // Backfill existing rows with sensible defaults
      version: 19,
      statements: [],
      callback: (db: Db) => {
        const existing = new Set(
          db
            .all<{ name: string }>("PRAGMA table_info(subscription_freezes)")
            .map((r) => r.name),
        );
        db.transaction(() => {
          if (!existing.has("start_date")) {
            db.exec("ALTER TABLE subscription_freezes ADD COLUMN start_date TEXT NOT NULL DEFAULT ''");
          }
          if (!existing.has("end_date")) {
            db.exec("ALTER TABLE subscription_freezes ADD COLUMN end_date TEXT NOT NULL DEFAULT ''");
          }
          if (!existing.has("duration_days")) {
            db.exec("ALTER TABLE subscription_freezes ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0");
          }
          if (!existing.has("notes")) {
            db.exec("ALTER TABLE subscription_freezes ADD COLUMN notes TEXT");
          }
          // Backfill existing freeze rows that lack the new fields
          const freezes = db.all<{ id: string; subscription_id: string; frozen_at: string; expected_resume_date: string | null }>(
            "SELECT id, subscription_id, frozen_at, expected_resume_date FROM subscription_freezes WHERE start_date = ''",
          );
          for (const f of freezes) {
            const startDate = f.frozen_at.slice(0, 10);
            let endDate = f.expected_resume_date;
            if (!endDate) {
              const sub = db.first<{ end_date: string }>(
                "SELECT end_date FROM member_subscriptions WHERE id = ?",
                [f.subscription_id],
              );
              endDate = sub?.end_date ?? startDate;
            }
            const duration = Math.max(0, diffDaysKeys(startDate, endDate) + 1);
            db.run(
              "UPDATE subscription_freezes SET start_date = ?, end_date = ?, duration_days = ? WHERE id = ?",
              [startDate, endDate, duration, f.id],
            );
          }
        });
      },
    },
    {
      // ---- v20: Daily closing workflow ----
      // Per-business-date reconciliation of expected vs counted cash per cash box.
      // One CURRENT row per (business_date, box); reopen creates a new row and
      // marks the previous as 'reopened' (immutable history).
      version: 20,
      statements: [],
      callback: (db: Db) => {
        const existing = new Set(
          db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name),
        );
        if (!existing.has("daily_closings")) {
          db.run("CREATE TABLE daily_closings (id TEXT PRIMARY KEY, business_date TEXT NOT NULL, box TEXT NOT NULL CHECK (box IN ('gym','store')), status TEXT NOT NULL CHECK (status IN ('open','closed','reopened')), opening_balance_minor INTEGER NOT NULL CHECK (opening_balance_minor >= 0), expected_cash_minor INTEGER NOT NULL CHECK (expected_cash_minor >= 0), expected_card_minor INTEGER NOT NULL CHECK (expected_card_minor >= 0), expected_transfer_minor INTEGER NOT NULL CHECK (expected_transfer_minor >= 0), expected_other_minor INTEGER NOT NULL CHECK (expected_other_minor >= 0), expected_total_minor INTEGER NOT NULL CHECK (expected_total_minor >= 0), counted_cash_minor INTEGER, difference_minor INTEGER, reason TEXT, responsible_user_id TEXT REFERENCES users(id), responsible_user_name TEXT, opened_by TEXT NOT NULL REFERENCES users(id), opened_by_name TEXT NOT NULL, opened_at TEXT NOT NULL, closed_by TEXT REFERENCES users(id), closed_by_name TEXT, closed_at TEXT, reopen_reason TEXT, reopened_by TEXT REFERENCES users(id), reopened_by_name TEXT, reopened_at TEXT, reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0), superseded_by TEXT REFERENCES daily_closings(id), CHECK ((status = 'open' AND counted_cash_minor IS NULL AND difference_minor IS NULL AND closed_by IS NULL AND closed_at IS NULL) OR (status = 'closed' AND counted_cash_minor IS NOT NULL AND closed_by IS NOT NULL AND closed_at IS NOT NULL) OR (status = 'reopened' AND counted_cash_minor IS NOT NULL AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND reopened_by IS NOT NULL)))");
          db.run("CREATE INDEX idx_daily_closings_date ON daily_closings(business_date)");
          db.run("CREATE INDEX idx_daily_closings_status ON daily_closings(status, business_date)");
          db.run("CREATE INDEX idx_daily_closings_active ON daily_closings(business_date, box) WHERE superseded_by IS NULL");
        }
        if (!existing.has("daily_closing_audit_entries")) {
          db.run("CREATE TABLE daily_closing_audit_entries (id TEXT PRIMARY KEY, daily_closing_id TEXT NOT NULL REFERENCES daily_closings(id), method_code TEXT NOT NULL, expected_minor INTEGER NOT NULL CHECK (expected_minor >= 0), actual_minor INTEGER, UNIQUE (daily_closing_id, method_code))");
          db.run("CREATE INDEX idx_daily_closing_audit ON daily_closing_audit_entries(daily_closing_id)");
        }
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('cash.daily_close')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('cash.daily_reopen')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'cash.daily_close')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'cash.daily_reopen')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('reception', 'cash.daily_close')");
      },
    },
    {
      version: 21,
      statements: [],
      fkOff: true,
      callback: (db) => {
        db.exec("CREATE TABLE products_v21 (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  category_id TEXT REFERENCES product_categories(id),\n  sku TEXT UNIQUE,\n  barcode TEXT UNIQUE,\n  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),\n  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),\n  stock_qty REAL NOT NULL DEFAULT 0,\n  min_stock_qty REAL NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),\n  supplier_name TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)");
        db.exec("INSERT INTO products_v21 SELECT * FROM products");
        db.exec("DROP TABLE products");
        db.exec("ALTER TABLE products_v21 RENAME TO products");
        db.exec("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)");

        db.exec(
          "CREATE TABLE stock_movements_v21 (\n  id TEXT PRIMARY KEY,\n  product_id TEXT NOT NULL REFERENCES products(id),\n  movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_in', 'sale', 'manual_adjust', 'damage', 'count_correction', 'return', 'lost')),\n  delta REAL NOT NULL,\n  result_qty REAL NOT NULL,\n  unit_cost_minor INTEGER,\n  ref_table TEXT,\n  ref_id TEXT,\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        );
        db.exec("INSERT INTO stock_movements_v21 SELECT * FROM stock_movements");
        db.exec("DROP TABLE stock_movements");
        db.exec("ALTER TABLE stock_movements_v21 RENAME TO stock_movements");
        db.exec("CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_movements(product_id, created_at)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_stock_moves_type ON stock_movements(movement_type)");

        const itemCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(store_sale_items)").map((c) => c.name),
        );
        if (!itemCols.has("returned_qty")) {
          db.exec(
            "ALTER TABLE store_sale_items ADD COLUMN returned_qty REAL NOT NULL DEFAULT 0 CHECK (returned_qty >= 0)",
          );
        }
        db.exec(
          "CREATE TABLE IF NOT EXISTS store_returns (\n  id TEXT PRIMARY KEY,\n  sale_id TEXT NOT NULL REFERENCES store_sales(id),\n  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),\n  reason TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        );
        db.exec("CREATE INDEX IF NOT EXISTS idx_store_returns_sale ON store_returns(sale_id)");
        db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_negative_stock', '0')");
      },
    },
    {
      version: 22,
      statements: [],
      callback: (db: Db) => {
        // Item-level sales returns (partial/full) with a fixed receipt number.
        const returnCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(store_returns)").map((c) => c.name),
        );
        if (!returnCols.has("return_no"))
          db.run("ALTER TABLE store_returns ADD COLUMN return_no TEXT");
        if (!returnCols.has("items_total_minor"))
          db.run("ALTER TABLE store_returns ADD COLUMN items_total_minor INTEGER NOT NULL DEFAULT 0");
        if (!returnCols.has("discount_minor"))
          db.run("ALTER TABLE store_returns ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0");
        if (!returnCols.has("total_minor"))
          db.run("ALTER TABLE store_returns ADD COLUMN total_minor INTEGER NOT NULL DEFAULT 0");
        if (!returnCols.has("box"))
          db.run("ALTER TABLE store_returns ADD COLUMN box TEXT NOT NULL DEFAULT 'store'");
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_store_returns_return_no ON store_returns(return_no)");
        db.run("CREATE INDEX IF NOT EXISTS idx_store_returns_created ON store_returns(created_at)");
        db.run(
          "CREATE TABLE IF NOT EXISTS store_return_items (\n  id TEXT PRIMARY KEY,\n  return_id TEXT NOT NULL REFERENCES store_returns(id),\n  sale_item_id TEXT NOT NULL REFERENCES store_sale_items(id),\n  product_id TEXT NOT NULL REFERENCES products(id),\n  product_name_snapshot TEXT NOT NULL,\n  qty REAL NOT NULL CHECK (qty > 0),\n  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),\n  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),\n  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)\n)",
        );
        db.run("CREATE INDEX IF NOT EXISTS idx_store_return_items_return ON store_return_items(return_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_store_return_items_product ON store_return_items(product_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_store_return_items_sale_item ON store_return_items(sale_item_id)");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('store.return')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'store.return')");
      },
    },
    {
      version: 23,
      statements: [],
      callback: (db: Db) => {
        // ---- member referral system ----
        const memberCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(members)").map((c) => c.name),
        );
        if (!memberCols.has("referral_code"))
          db.exec("ALTER TABLE members ADD COLUMN referral_code TEXT");
        db.exec("CREATE TABLE IF NOT EXISTS referrals (\n  id TEXT PRIMARY KEY,\n  referrer_id TEXT NOT NULL REFERENCES members(id),\n  referred_name TEXT NOT NULL,\n  referred_phone TEXT,\n  referred_member_id TEXT REFERENCES members(id),\n  referral_code TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'joined', 'cancelled')),\n  notes TEXT,\n  created_at TEXT NOT NULL,\n  converted_at TEXT\n)");
        db.run("CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status)");
        db.exec("CREATE TABLE IF NOT EXISTS referral_rewards (\n  id TEXT PRIMARY KEY,\n  referral_id TEXT NOT NULL REFERENCES referrals(id),\n  referrer_id TEXT NOT NULL REFERENCES members(id),\n  reward_type TEXT NOT NULL CHECK (reward_type IN ('free_days', 'credit')),\n  reward_value INTEGER NOT NULL CHECK (reward_value >= 0),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'cancelled')),\n  created_at TEXT NOT NULL,\n  granted_at TEXT\n)");
        db.run("CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_referral_rewards_referral ON referral_rewards(referral_id)");
        db.exec("CREATE TABLE IF NOT EXISTS referral_settings (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL\n)");
        db.run("INSERT OR IGNORE INTO referral_settings (key, value) VALUES ('reward_type', 'free_days')");
        db.run("INSERT OR IGNORE INTO referral_settings (key, value) VALUES ('reward_value', '7')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('referrals.view')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('referrals.manage')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'referrals.view')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'referrals.manage')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('reception', 'referrals.view')");
      },
    },
    {
      version: 24,
      statements: [],
      callback: (db: Db) => {
        // ---- configurable loyalty / rewards system ----
        db.exec("CREATE TABLE IF NOT EXISTS loyalty_earn_rules (\n  id TEXT PRIMARY KEY,\n  action TEXT NOT NULL UNIQUE,\n  points INTEGER NOT NULL CHECK (points >= 0),\n  enabled INTEGER NOT NULL DEFAULT 1,\n  points_per_minor INTEGER,\n  min_minor INTEGER,\n  created_at TEXT NOT NULL\n)");
        db.exec("CREATE TABLE IF NOT EXISTS loyalty_redemption_catalog (\n  id TEXT PRIMARY KEY,\n  reward_type TEXT NOT NULL CHECK (reward_type IN ('free_days', 'discount', 'product', 'pt_session', 'custom')),\n  title TEXT NOT NULL,\n  points_cost INTEGER NOT NULL CHECK (points_cost > 0),\n  value_minor INTEGER,\n  days INTEGER,\n  sessions INTEGER,\n  product_id TEXT REFERENCES products(id),\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL\n)");
        db.exec("CREATE TABLE IF NOT EXISTS loyalty_transactions (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  delta INTEGER NOT NULL,\n  balance_after INTEGER NOT NULL,\n  kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'adjust', 'void')),\n  source TEXT NOT NULL CHECK (source IN ('checkin', 'renewal', 'referral', 'store_purchase', 'manual', 'redemption')),\n  reason TEXT,\n  ref_table TEXT,\n  ref_id TEXT,\n  reward_id TEXT REFERENCES loyalty_redemption_catalog(id),\n  points_cost INTEGER,\n  created_by TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)");
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tx_source_ref ON loyalty_transactions(source, ref_id) WHERE ref_id IS NOT NULL");
        db.run("CREATE INDEX IF NOT EXISTS idx_loyalty_tx_member ON loyalty_transactions(member_id)");
        db.exec("CREATE TABLE IF NOT EXISTS loyalty_credit_transactions (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  loyalty_transaction_id TEXT NOT NULL,\n  reward_id TEXT NOT NULL,\n  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),\n  used_minor INTEGER NOT NULL DEFAULT 0 CHECK (used_minor >= 0),\n  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'cancelled')),\n  created_by TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)");
        db.run("CREATE INDEX IF NOT EXISTS idx_loyalty_credit_member ON loyalty_credit_transactions(member_id)");
        db.exec("CREATE TABLE IF NOT EXISTS loyalty_settings (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL\n)");
        db.run("INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('reward_enabled', '1')");
        db.run("INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('store_points_per_egp', '0')");
        db.run("INSERT OR IGNORE INTO loyalty_earn_rules (id, action, points, enabled, points_per_minor, min_minor, created_at) VALUES ('rule_checkin', 'checkin', 5, 1, NULL, NULL, '2026-08-31T00:00:00Z')");
        db.run("INSERT OR IGNORE INTO loyalty_earn_rules (id, action, points, enabled, points_per_minor, min_minor, created_at) VALUES ('rule_renewal', 'renewal', 50, 1, NULL, NULL, '2026-08-31T00:00:00Z')");
        db.run("INSERT OR IGNORE INTO loyalty_earn_rules (id, action, points, enabled, points_per_minor, min_minor, created_at) VALUES ('rule_referral', 'referral', 100, 1, NULL, NULL, '2026-08-31T00:00:00Z')");
        db.run("INSERT OR IGNORE INTO loyalty_earn_rules (id, action, points, enabled, points_per_minor, min_minor, created_at) VALUES ('rule_store', 'store_purchase', 10, 1, NULL, 10000, '2026-08-31T00:00:00Z')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('loyalty.view')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('loyalty.manage')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'loyalty.view')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'loyalty.manage')");
                db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('reception', 'loyalty.view')");
              },
            },
            {
                          // ---- ADR-018 §3: stored `relative_path` for the file registry.
      // Existing rows are filled with the legacy `<kind>/<id><ext>` layout
      // so on-disk bytes remain reachable. Going forward, every saveFile
      // write stores the path explicitly and the service resolves paths
      // ONLY from `relative_path` (no more extname(original_name)).
      //
      // Defensive: if `files` doesn't exist (e.g. a partial v20 schema
      // upgrade test skeleton), the rest of the migrations cover its
      // creation; we just skip the backfill here.
      version: 25,
      statements: [],
      callback: (db: Db) => {
        const tables = new Set(
          db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name),
        );
        if (!tables.has("files")) return;
        const fileCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(files)").map((c) => c.name),
        );
        if (!fileCols.has("relative_path")) {
          db.exec("ALTER TABLE files ADD COLUMN relative_path TEXT NOT NULL DEFAULT ''");
          db.run("CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path)");
        }
        const rows = db.all<Row>(
          "SELECT id, kind, original_name, relative_path FROM files WHERE relative_path = '' OR relative_path IS NULL",
        );
        for (const r of rows) {
          const ext = String(r.original_name ?? "")
            .split(".")
            .pop()
            ?.replace(/[^.\w]/g, "")
            .slice(0, 10);
          const tail = ext ? `.${ext}` : "";
          const rel = `${String(r.kind)}/${String(r.id)}${tail}`;
          db.run("UPDATE files SET relative_path = ? WHERE id = ?", [rel, String(r.id)]);
        }
      },
    },
    {
      // ---- ADR-018 §8: backfill is handled by `src/db/expense-attachments-backfill.ts`
      // after `runMigrations` finishes (called from `server/context.ts`).
      // This migration is a no-op to keep `src/db/migrations.ts` free of
      // node-only globals so the frontend tsconfig still typechecks.
      version: 26,
      statements: [],
      callback: () => {
        // Reserved — backfill lives in server/expense-attachments-backfill.ts.
      },
    },
  ];
}

const MIGRATIONS: readonly Migration[] = buildMigrations();

export function runMigrations(db: Db): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (\n  version INTEGER PRIMARY KEY,\n  applied_at TEXT NOT NULL\n)",
  );
  const currentRaw = db.scalar("SELECT MAX(version) FROM schema_migrations");
  const current = currentRaw == null ? 0 : Number(currentRaw);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    applyMigration(db, migration);
  }
}

function applyMigration(db: Db, migration: Migration): void {
  const fkOff = migration.fkOff === true;
  if (fkOff) db.setForeignKeys(false);
  try {
    db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      if (migration.callback) migration.callback(db);
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        migration.version,
        nowStamp(),
      ]);
    });
  } finally {
    if (fkOff) db.setForeignKeys(true);
  }
}
