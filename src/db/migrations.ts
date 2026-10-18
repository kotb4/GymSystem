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
      // ---- ADR-018 §8: backfill is handled by `server/expense-attachments-backfill.ts`
      // after `runMigrations` finishes (called from `server/context.ts`).
      // This migration is a no-op to keep `src/db/migrations.ts` free of
      // node-only globals so the frontend tsconfig still typechecks.
      version: 26,
      statements: [],
      callback: () => {
        // Reserved — backfill lives in server/expense-attachments-backfill.ts.
      },
    },
    {
      // ---- v27: Remove the daily-closing (الإغلاق اليومي) feature ----
      // The feature was removed entirely (product decision): the /treasury page
      // now serves only cash sessions (cash_sessions). We drop the daily_closings
      // tables + indexes and revoke the seeded permissions/grants. This is an
      // append-only drop: it only runs on DBs that have v20 applied. The legacy
      // cash_sessions feature and its tables are untouched.
      version: 27,
      statements: [
        "DROP TABLE IF EXISTS daily_closing_audit_entries",
        "DROP INDEX IF EXISTS idx_daily_closings_active",
        "DROP INDEX IF EXISTS idx_daily_closings_status",
        "DROP INDEX IF EXISTS idx_daily_closings_date",
        "DROP TABLE IF EXISTS daily_closings",
      ],
      callback: (db: Db) => {
        db.run("DELETE FROM role_permissions WHERE permission_code IN ('cash.daily_close', 'cash.daily_reopen')");
        db.run("DELETE FROM permissions WHERE code IN ('cash.daily_close', 'cash.daily_reopen')");
      },
    },
    {
      // ---- v28: class_recurrences (weekly recurring class schedule) ----
      // TASK-035: the classes hub manages gym group classes (MMA, Karate, ...).
      // A recurrence template stores the weekly pattern (days_of_week as
      // comma-separated 0..6, Sunday=0), and class_sessions rows are
      // materialized from it. Existing sessions/bookings/attendance untouched.
      version: 28,
      statements: [
        "CREATE TABLE IF NOT EXISTS class_recurrences (\n  id TEXT PRIMARY KEY,\n  class_id TEXT NOT NULL REFERENCES classes(id),\n  days_of_week TEXT NOT NULL,\n  start_date TEXT NOT NULL,\n  start_time TEXT NOT NULL,\n  duration_min INTEGER NOT NULL CHECK (duration_min >= 5),\n  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_class_recurrences_class ON class_recurrences(class_id)",
      ],
      callback: () => {
        // Validation lives in the service layer (classes.service.ts).
      },
    },
    {
      // ---- v29: license_activation marker (license anti-rollback) ----
      // TASK-036-F1: the signed `.lic` + `license.json` live in configDir and a
      // user could simply delete them to revert to an unlicensed, fully-writable
      // state with NO expiry ceiling. This table is the "activation ever
      // occurred" marker inside gym.db: written from a VERIFIED payload at
      // activation/boot, keyed by HWID, and survives cert/state file deletion.
      // At boot, when no valid signed payload is present, the marker enforces
      // the recorded grant period (expiry, no grace window since ADR-022) and
      // the monotonic last_active clock guard instead of falling back to unlicensed.
      version: 29,
      statements: [
        "CREATE TABLE IF NOT EXISTS license_activation (\n  hwid TEXT PRIMARY KEY,\n  activated_at INTEGER NOT NULL,\n  issued_at INTEGER NOT NULL,\n  expires_at INTEGER NOT NULL,\n  gym TEXT,\n  tier TEXT,\n  last_active INTEGER,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
      ],
      callback: () => {
        // Read/write lives in server/license/session.ts (runtime layer).
      },
    },
    {
      // ---- v30: product SKU snapshots on store line items ----
      // TASK-041 (historical data integrity): store_sale_items and
      // store_return_items already snapshot the product NAME plus unit
      // price/cost and line total, but NOT the product's SKU/code. A later SKU
      // change (or a legacy-detached receipt) must not alter what a sale or
      // return document says. Columns are NULL for rows predating this
      // migration; only new sale/return lines populate them.
      version: 30,
      statements: [],
      callback: (db: Db) => {
        const saleCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(store_sale_items)").map((c) => c.name),
        );
        if (!saleCols.has("product_sku_snapshot"))
          db.run("ALTER TABLE store_sale_items ADD COLUMN product_sku_snapshot TEXT");
        const returnCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(store_return_items)").map((c) => c.name),
        );
        if (!returnCols.has("product_sku_snapshot"))
          db.run("ALTER TABLE store_return_items ADD COLUMN product_sku_snapshot TEXT");
      },
    },
    {
      // ---- v31: encrypted-backup flag + backup lifecycle settings (TASK-042) ----
      // A v2 `.gymbak` is an AES-256-GCM container wrapping the whole v1 buffer;
      // the logs now record whether an entry is encrypted. The lifecycle settings
      // (auto backups on/off, configurable storage location, tiered retention
      // policy) are plain `settings` rows so they survive backups/restores. The
      // encryption KEY is never stored here — it lives in Config/backup-key.json
      // wrapped by Windows DPAPI (server/backup-crypto.ts).
      version: 31,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (name: string) =>
          Number(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [name])) === 1;
        if (!tableExists("backups_log")) {
          // Ultra-early fixture / minimal upgrade: create the full latest shape.
          db.exec(
            "CREATE TABLE backups_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  kind TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'pre_restore', 'pre_purge')),\n  file_name TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),\n  checksum TEXT,\n  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),\n  encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
          );
          db.run("CREATE INDEX IF NOT EXISTS idx_backups_created ON backups_log(created_at)", []);
        } else {
          const cols = new Set(
            db.all<{ name: string }>("PRAGMA table_info(backups_log)").map((c) => c.name),
          );
          if (!cols.has("encrypted"))
            db.run(
              "ALTER TABLE backups_log ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1))",
            );
        }
        const defaults: Array<[string, string]> = [
          ["backup_auto_enabled", "1"],
          ["backup_location", ""],
          ["backup_retention_policy", JSON.stringify({ daily: 7, weekly: 8, monthly: 24 })],
          ["backup_encryption_enabled", "0"],
          ["backup_password_set", "0"],
        ];
        for (const [key, value] of defaults) {
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
        }
      },
    },
    {
      // ---- v32: expand backups_log.kind to include pre_purge (TASK-042) ----
      // The pre-destructive snapshot taken immediately before a member purge is
      // a distinct kind, so the `kind` CHECK must accept it. SQLite cannot alter
      // a CHECK constraint, so the table is rebuilt inside the migration. No
      // other table references backups_log, and `created_by` FK is preserved
      // (`REFERENCES users(id)`) by the RENAME below.
      version: 32,
      statements: [],
      callback: (db: Db) => {
        const sql =
          String(db.scalar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'backups_log'") ?? "");
        // v31 may already have created the full-shape table for fresh boots/upgrade
        // fixtures; rebuilding again would be a no-op but risks needless churn.
        if (sql.includes("pre_purge")) return;
        const checkSql =
          "CREATE TABLE backups_log_new (\n" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
          "  kind TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'pre_restore', 'pre_purge')),\n" +
          "  file_name TEXT NOT NULL,\n" +
          "  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),\n" +
          "  checksum TEXT,\n" +
          "  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),\n" +
          "  encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),\n" +
          "  created_by TEXT REFERENCES users(id),\n" +
          "  created_at TEXT NOT NULL\n" +
          ")";
        db.exec(
          `${checkSql};
INSERT INTO backups_log_new (id, kind, file_name, size_bytes, checksum, verified, encrypted, created_by, created_at)
  SELECT id, kind, file_name, size_bytes, checksum, verified, encrypted, created_by, created_at FROM backups_log;
DROP TABLE backups_log;
ALTER TABLE backups_log_new RENAME TO backups_log;
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups_log(created_at);`,
        );
      },
    },
    {
      // ---- v33: virtual cards + card deliveries (TASK-044) ----
      // Additive only. Every member gets ONE auto-created "virtual" card whose
      // barcode is their member code (`MEM-xxxxxx`), so the same member code
      // flow doubles as a QR-sendable card. Existing cards whose barcode already
      // equals a member code (the legacy member-code path) are re-marked
      // `kind='virtual'`. `card_deliveries` logs each per-card send attempt with
      // a UNIQUE dedupe key so a card can never be WhatsApp-sent twice.
      // A new `cards.send` permission gates everything (owner + manager grants).
      version: 33,
      statements: [],
      callback: (db: Db) => {
        const hasCol = (table: string, col: string) =>
          Number(db.scalar("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?", [table, col])) === 1;
        if (!hasCol("cards", "kind"))
          db.run(
            "ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical', 'virtual'))",
          );
        const hasTable = (name: string) =>
          Number(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [name])) === 1;
        if (!hasTable("card_deliveries")) {
          db.exec(
            "CREATE TABLE card_deliveries (\n" +
              "  id TEXT PRIMARY KEY,\n" +
              "  member_id TEXT NOT NULL REFERENCES members(id),\n" +
              "  card_id TEXT NOT NULL REFERENCES cards(id),\n" +
              "  barcode_value TEXT NOT NULL,\n" +
              "  member_name TEXT,\n" +
              "  phone TEXT,\n" +
              "  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_phone', 'not_configured')),\n" +
              "  error TEXT,\n" +
              "  image_hash TEXT,\n" +
              "  dedupe_key TEXT NOT NULL UNIQUE,\n" +
              "  sent_at TEXT,\n" +
              "  created_by TEXT REFERENCES users(id),\n" +
              "  created_at TEXT NOT NULL\n" +
              ")",
          );
          db.run("CREATE INDEX IF NOT EXISTS idx_card_deliveries_status ON card_deliveries(status)");
          db.run("CREATE INDEX IF NOT EXISTS idx_card_deliveries_member ON card_deliveries(member_id)");
        }
        // Backfill: one virtual card per existing member whose member_code is
        // not already used as a card barcode; re-mark matching cards as virtual.
        const members = db.all<{ id: string; member_code: string }>(
          "SELECT id, member_code FROM members WHERE deleted_at IS NULL",
        );
        const memberCodes = new Set(members.map((m) => m.member_code));
        for (const { id, member_code } of members) {
          const existing = db.first<{ id: string; kind: string }>(
            "SELECT id, kind FROM cards WHERE barcode_value = ? LIMIT 1",
            [member_code],
          );
          if (existing) {
            if (existing.kind !== "virtual")
              db.run("UPDATE cards SET kind = 'virtual', updated_at = ? WHERE id = ?", [nowStamp(), existing.id]);
            continue;
          }
          db.run(
            "INSERT INTO cards (id, barcode_value, status, member_id, kind, notes, assigned_at, created_at, updated_at) VALUES (?, ?, 'assigned', ?, 'virtual', ?, ?, ?, ?)",
            [crypto.randomUUID(), member_code, id, "Virtual card (member code)", nowStamp(), nowStamp(), nowStamp()],
          );
        }
        void memberCodes;
        // cards.send permission + grants (owner is implicit in ROLE_GRANTS).
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('cards.send')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'cards.send')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('reception', 'cards.send')");
        // TASK-044 cleanup: bulk-messaging is removed; drop its now-dead grants
        // (the crm_* TABLES stay for historical data, non-destructive).
        db.run("DELETE FROM role_permissions WHERE permission_code IN ('crm.send', 'crm.templates')");
        db.run("DELETE FROM permissions WHERE code IN ('crm.send', 'crm.templates')");
      },
    },
    {
      // ---- v34: member messaging outbox + outreach segments (TASK-061) ----
      // WhatsApp outreach lives in `member_messages`: one append-only row per
      // send attempt (individual or segment batch) with snapshot fields and a
      // status flow mirroring card_deliveries (pending/sent/failed/skipped_no_phone
      // /not_configured). Segment windows (absence / birthday / expiry days) are
      // plain settings rows with defaults; `messages.view` and `messages.send`
      // gate the page and the send actions (manager: view+send, reception: view).
      version: 34,
      statements: [],
      callback: (db: Db) => {
        const hasTable = (name: string) =>
          Number(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [name])) === 1;
        if (!hasTable("member_messages")) {
          db.exec(
            "CREATE TABLE member_messages (\n" +
              "  id TEXT PRIMARY KEY,\n" +
              "  member_id TEXT NOT NULL REFERENCES members(id),\n" +
              "  segment TEXT NOT NULL CHECK (segment IN ('absent', 'birthday', 'expiry')),\n" +
              "  member_code TEXT NOT NULL,\n" +
              "  member_name TEXT NOT NULL,\n" +
              "  phone TEXT,\n" +
              "  body TEXT NOT NULL,\n" +
              "  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_phone', 'not_configured')),\n" +
              "  error TEXT,\n" +
              "  dedupe_key TEXT NOT NULL UNIQUE,\n" +
              "  sent_at TEXT,\n" +
              "  created_by TEXT REFERENCES users(id),\n" +
              "  created_at TEXT NOT NULL\n" +
              ")",
          );
          db.run("CREATE INDEX IF NOT EXISTS idx_member_messages_member ON member_messages(member_id)");
          db.run("CREATE INDEX IF NOT EXISTS idx_member_messages_status ON member_messages(status)");
        }
        const defaults: Array<[string, string]> = [
          ["messages_absent_days", "14"],
          ["messages_birthday_days", "7"],
          ["messages_expiry_days", "7"],
        ];
        for (const [key, value] of defaults) {
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
        }
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('messages.view')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('messages.send')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'messages.view')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'messages.send')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('reception', 'messages.view')");
      },
    },
    {
      // ---- v35: expanded message segments & anti-ban settings ----
      version: 35,
      statements: [],
      fkOff: true,
      callback: (db: Db) => {
        db.exec(
          "CREATE TABLE member_messages_v35 (\n" +
            "  id TEXT PRIMARY KEY,\n" +
            "  member_id TEXT NOT NULL REFERENCES members(id),\n" +
            "  segment TEXT NOT NULL CHECK (segment IN ('absent', 'birthday', 'expiry', 'welcome', 'payment', 'custom')),\n" +
            "  member_code TEXT NOT NULL,\n" +
            "  member_name TEXT NOT NULL,\n" +
            "  phone TEXT,\n" +
            "  body TEXT NOT NULL,\n" +
            "  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_phone', 'skipped_cooldown', 'not_configured')),\n" +
            "  error TEXT,\n" +
            "  dedupe_key TEXT NOT NULL UNIQUE,\n" +
            "  sent_at TEXT,\n" +
            "  created_by TEXT REFERENCES users(id),\n" +
            "  created_at TEXT NOT NULL\n" +
            ")",
        );
        db.exec("INSERT INTO member_messages_v35 SELECT * FROM member_messages");
        db.exec("DROP TABLE member_messages");
        db.exec("ALTER TABLE member_messages_v35 RENAME TO member_messages");
        db.exec("CREATE INDEX IF NOT EXISTS idx_member_messages_member ON member_messages(member_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_member_messages_status ON member_messages(status)");

        const defaults: Array<[string, string]> = [
          [
            "messages_welcome_template",
            "أهلاً بك يا {اسم العميل} في {اسم الجيم}! يسعدنا انضمامك إلينا. رقم عضويتك هو: {رقم العضوية}. نتمنى لك رحلة رياضية موفقة.",
          ],
          [
            "messages_payment_template",
            "أهلاً يا {اسم العميل}، تم استلام مبلغ {المبلغ} ج بنجاح. باقتك: {اسم الخطة}، صالحة حتى {تاريخ الانتهاء}. شكراً لاختيارك {اسم الجيم}.",
          ],
          ["messages_pacing_min_seconds", "8"],
          ["messages_pacing_max_seconds", "15"],
          ["messages_cooldown_days", "7"],
        ];
        for (const [key, value] of defaults) {
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
        }
      },
    },
    {
      // ---- v36: offline-first multi-branch sync engine ----
      version: 36,
      statements: [
        "CREATE TABLE IF NOT EXISTS branch_info (\n" +
          "  branch_id TEXT PRIMARY KEY,\n" +
          "  branch_name TEXT NOT NULL,\n" +
          "  branch_role TEXT NOT NULL CHECK (branch_role IN ('primary', 'replica')),\n" +
          "  branch_prefix TEXT NOT NULL DEFAULT '',\n" +
          "  remote_url TEXT,\n" +
          "  sync_secret TEXT NOT NULL,\n" +
          "  auto_sync_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_sync_enabled IN (0, 1)),\n" +
          "  sync_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (sync_interval_seconds >= 10),\n" +
          "  last_push_at TEXT,\n" +
          "  last_pull_at TEXT,\n" +
          "  last_error TEXT,\n" +
          "  updated_at TEXT NOT NULL\n" +
          ")",
        "CREATE TABLE IF NOT EXISTS sync_control (\n" +
          "  id INTEGER PRIMARY KEY CHECK (id = 1),\n" +
          "  is_applying_remote INTEGER NOT NULL DEFAULT 0\n" +
          ")",
        "INSERT OR IGNORE INTO sync_control (id, is_applying_remote) VALUES (1, 0)",
        "CREATE TABLE IF NOT EXISTS sync_outbox (\n" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
          "  entity_type TEXT NOT NULL,\n" +
          "  entity_id TEXT NOT NULL,\n" +
          "  operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),\n" +
          "  payload_json TEXT,\n" +
          "  occurred_at TEXT NOT NULL,\n" +
          "  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),\n" +
          "  attempts INTEGER NOT NULL DEFAULT 0,\n" +
          "  last_attempt_at TEXT,\n" +
          "  last_error TEXT\n" +
          ")",
        "CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_id ON sync_outbox(status, id)",
        "CREATE TABLE IF NOT EXISTS sync_inbox_log (\n" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
          "  remote_branch_id TEXT NOT NULL,\n" +
          "  entity_type TEXT NOT NULL,\n" +
          "  entity_id TEXT NOT NULL,\n" +
          "  operation TEXT NOT NULL,\n" +
          "  applied_at TEXT NOT NULL,\n" +
          "  result TEXT NOT NULL\n" +
          ")",
        "CREATE INDEX IF NOT EXISTS idx_sync_inbox_applied ON sync_inbox_log(applied_at)",
      ],
      callback: (db: Db) => {
        db.run(
          "INSERT OR IGNORE INTO branch_info (branch_id, branch_name, branch_role, branch_prefix, sync_secret, auto_sync_enabled, sync_interval_seconds, updated_at) " +
            "VALUES ('main', 'الفرع الرئيسي', 'primary', 'B1', 'gym-sec-' || lower(hex(randomblob(16))), 1, 60, datetime('now'))",
        );

        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        if (tableExists("members")) {
          db.exec(
            "CREATE TRIGGER IF NOT EXISTS trg_sync_members_ai AFTER INSERT ON members\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('members', NEW.id, 'insert', datetime('now'));\n" +
              "END;\n" +
              "CREATE TRIGGER IF NOT EXISTS trg_sync_members_au AFTER UPDATE ON members\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('members', NEW.id, 'update', datetime('now'));\n" +
              "END;",
          );
        }

        if (tableExists("cards")) {
          db.exec(
            "CREATE TRIGGER IF NOT EXISTS trg_sync_cards_ai AFTER INSERT ON cards\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('cards', NEW.id, 'insert', datetime('now'));\n" +
              "END;\n" +
              "CREATE TRIGGER IF NOT EXISTS trg_sync_cards_au AFTER UPDATE ON cards\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('cards', NEW.id, 'update', datetime('now'));\n" +
              "END;",
          );
        }

        if (tableExists("member_subscriptions")) {
          db.exec(
            "CREATE TRIGGER IF NOT EXISTS trg_sync_subs_ai AFTER INSERT ON member_subscriptions\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('member_subscriptions', NEW.id, 'insert', datetime('now'));\n" +
              "END;\n" +
              "CREATE TRIGGER IF NOT EXISTS trg_sync_subs_au AFTER UPDATE ON member_subscriptions\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('member_subscriptions', NEW.id, 'update', datetime('now'));\n" +
              "END;",
          );
        }

        if (tableExists("attendance")) {
          db.exec(
            "CREATE TRIGGER IF NOT EXISTS trg_sync_attendance_ai AFTER INSERT ON attendance\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('attendance', NEW.id, 'insert', datetime('now'));\n" +
              "END;",
          );
        }

        if (tableExists("payments")) {
          db.exec(
            "CREATE TRIGGER IF NOT EXISTS trg_sync_payments_ai AFTER INSERT ON payments\n" +
              "WHEN (SELECT COALESCE(is_applying_remote, 0) FROM sync_control WHERE id = 1) = 0\n" +
              "BEGIN\n" +
              "  INSERT INTO sync_outbox (entity_type, entity_id, operation, occurred_at)\n" +
              "  VALUES ('payments', NEW.id, 'insert', datetime('now'));\n" +
              "END;",
          );
        }
      },
    },
    {
      version: 37,
      statements: [],
      callback: (db: Db) => {
        // ---- hidden developer account & system flag ----
        const userCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(users)").map((c) => c.name),
        );
        if (userCols.size > 0 && !userCols.has("is_developer")) {
          db.exec("ALTER TABLE users ADD COLUMN is_developer INTEGER NOT NULL DEFAULT 0");
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_users_is_developer ON users(is_developer)");
      },
    },
    {
      version: 38,
      statements: [],
      callback: (db: Db) => {
        // ---- owner and user phone column for remote link delivery & notifications ----
        const userCols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(users)").map((c) => c.name),
        );
        if (userCols.size > 0 && !userCols.has("phone")) {
          db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
        }
      },
    },
    {
      version: 39,
      statements: [],
      callback: (db: Db) => {
        // ---- multi-branch reporting & branch tracking ----
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        const addColIfMissing = (table: string, col: string, def: string) => {
          if (!tableExists(table)) return;
          const cols = new Set(
            db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name),
          );
          if (cols.size > 0 && !cols.has(col)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
          }
        };

        addColIfMissing("payments", "branch_id", "TEXT DEFAULT 'main'");
        addColIfMissing("expenses", "branch_id", "TEXT DEFAULT 'main'");
        addColIfMissing("attendance", "branch_id", "TEXT DEFAULT 'main'");
        addColIfMissing("members", "branch_id", "TEXT DEFAULT 'main'");
        addColIfMissing("member_subscriptions", "branch_id", "TEXT DEFAULT 'main'");

        db.exec(
          "CREATE TABLE IF NOT EXISTS registered_branches (\n" +
            "  branch_id TEXT PRIMARY KEY,\n" +
            "  branch_name TEXT NOT NULL,\n" +
            "  branch_role TEXT NOT NULL DEFAULT 'replica',\n" +
            "  is_active INTEGER NOT NULL DEFAULT 1,\n" +
            "  created_at TEXT NOT NULL,\n" +
            "  updated_at TEXT NOT NULL\n" +
            ")",
        );

        // Seed registered_branches from branch_info
        if (tableExists("branch_info")) {
          db.exec(
            "INSERT OR IGNORE INTO registered_branches (branch_id, branch_name, branch_role, is_active, created_at, updated_at)\n" +
              "SELECT branch_id, branch_name, branch_role, 1, updated_at, updated_at FROM branch_info",
          );
        } else {
          db.exec(
            "INSERT OR IGNORE INTO registered_branches (branch_id, branch_name, branch_role, is_active, created_at, updated_at)\n" +
              "VALUES ('main', 'الفرع الرئيسي', 'primary', 1, datetime('now'), datetime('now'))",
          );
        }

        // Backfill existing rows with current branch_id if null
        const currentBranchId = tableExists("branch_info")
          ? (db.scalar("SELECT branch_id FROM branch_info LIMIT 1") as string | null) || "main"
          : "main";

        if (tableExists("payments")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_payments_branch ON payments(branch_id)");
          db.run("UPDATE payments SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
        if (tableExists("expenses")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses(branch_id)");
          db.run("UPDATE expenses SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
        if (tableExists("attendance")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_branch ON attendance(branch_id)");
          db.run("UPDATE attendance SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
        if (tableExists("members")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_members_branch ON members(branch_id)");
          db.run("UPDATE members SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
        if (tableExists("member_subscriptions")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_member_subscriptions_branch ON member_subscriptions(branch_id)");
          db.run("UPDATE member_subscriptions SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
      },
    },
    {
      version: 40,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        const addColIfMissing = (table: string, col: string, def: string) => {
          if (!tableExists(table)) return;
          const cols = new Set(
            db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name),
          );
          if (cols.size > 0 && !cols.has(col)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
          }
        };

        addColIfMissing("registered_branches", "branch_prefix", "TEXT NOT NULL DEFAULT ''");
        addColIfMissing("registered_branches", "last_seen_at", "TEXT");
      },
    },
    {
      version: 41,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        const addColIfMissing = (table: string, col: string, def: string) => {
          if (!tableExists(table)) return;
          const cols = new Set(
            db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name),
          );
          if (cols.size > 0 && !cols.has(col)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
          }
        };

        addColIfMissing("store_sales", "branch_id", "TEXT DEFAULT 'main'");

        const currentBranchId = tableExists("branch_info")
          ? (db.scalar("SELECT branch_id FROM branch_info LIMIT 1") as string | null) || "main"
          : "main";

        if (tableExists("store_sales")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_store_sales_branch ON store_sales(branch_id)");
          db.run("UPDATE store_sales SET branch_id = ? WHERE branch_id IS NULL", [currentBranchId]);
        }
      },
    },
    {
      version: 42,
      statements: [
        "CREATE TABLE IF NOT EXISTS pdf_deliveries (\n  id TEXT PRIMARY KEY,\n  doc_type TEXT NOT NULL,\n  ref_table TEXT NOT NULL,\n  ref_id TEXT NOT NULL,\n  member_id TEXT REFERENCES members(id),\n  member_name TEXT,\n  phone TEXT,\n  channel TEXT NOT NULL,\n  status TEXT NOT NULL,\n  error TEXT,\n  file_name TEXT,\n  file_size INTEGER,\n  file_hash TEXT,\n  sent_at TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
        "CREATE INDEX IF NOT EXISTS idx_pdf_deliveries_status ON pdf_deliveries(status)",
        "CREATE INDEX IF NOT EXISTS idx_pdf_deliveries_member ON pdf_deliveries(member_id)",
        "CREATE INDEX IF NOT EXISTS idx_pdf_deliveries_ref ON pdf_deliveries(ref_table, ref_id)",
        "CREATE INDEX IF NOT EXISTS idx_pdf_deliveries_created ON pdf_deliveries(created_at)",
      ],
      // `payments` and `counters` may be absent in a partial/legacy skeleton
      // (the upgrade tests replay migrations 21.. on a trimmed v20 schema), so
      // add the column and the counter defensively — same pattern as v41.
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        if (tableExists("counters")) {
          db.run("INSERT INTO counters (name, value) VALUES ('receipt_no', 0) ON CONFLICT(name) DO NOTHING");
        }

        if (!tableExists("payments")) return;
        const cols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(payments)").map((c) => c.name),
        );
        if (cols.size > 0 && !cols.has("receipt_no")) {
          db.exec("ALTER TABLE payments ADD COLUMN receipt_no TEXT");
          db.exec("CREATE INDEX IF NOT EXISTS idx_payments_receipt_no ON payments(receipt_no)");
        }
      },
    },
    {
      version: 43,
      // Every customer-facing operation gets a printable, searchable reference
      // number ("reference number" / مرجع). payments already had `receipt_no`
      // (v42) and store_sales/store_returns have `sale_no`/`return_no`; this
      // adds the missing ones so an operator can always look up a printed
      // document by the number the customer reads back to them.
      // All DDL is done in the callback so it can be conditional per table.
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        // Defensive: partial/legacy skeletons may be missing any of these.
        const targets: { table: string; column: string; index: string }[] = [
          { table: "payment_refunds", column: "refund_no", index: "idx_payment_refunds_refund_no" },
          { table: "store_debt_payments", column: "payment_no", index: "idx_store_debt_payments_no" },
          { table: "cash_sessions", column: "closing_no", index: "idx_cash_sessions_closing_no" },
          { table: "attendance", column: "visit_no", index: "idx_attendance_visit_no" },
        ];

        for (const t of targets) {
          if (!tableExists(t.table)) continue;
          const cols = columnNames(t.table);
          if (cols.size === 0) continue;
          if (!cols.has(t.column)) {
            db.exec(`ALTER TABLE ${t.table} ADD COLUMN ${t.column} TEXT`);
          }
          // Partial unique index: many legacy rows are NULL, and SQLite treats
          // each NULL as distinct, so this only enforces uniqueness of real
          // numbers without backfilling history.
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${t.index} ON ${t.table}(${t.column}) WHERE ${t.column} IS NOT NULL`,
          );
        }

        if (tableExists("counters")) {
          for (const name of [
            "refund_no",
            "store_debt_payment_no",
            "cash_closing_no",
            "attendance_no",
          ]) {
            db.run("INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING", [name]);
          }
        }
      },
    },
    {
      version: 44,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        if (tableExists("membership_plans") && tableExists("packages")) {
          db.run(
            `UPDATE membership_plans
             SET price = ROUND(price / 100.0, 2)
             WHERE id IN (SELECT synthetic_plan_id FROM packages WHERE synthetic_plan_id IS NOT NULL)
               AND price >= 1000`,
          );
        }

        if (tableExists("member_subscriptions")) {
          db.run(
            `UPDATE member_subscriptions
             SET price = ROUND(price / 100.0, 2)
             WHERE package_id IS NOT NULL
               AND price >= 1000`,
          );
        }
      },
    },
    {
      version: 45,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        if (!tableExists("employee_advances")) {
          db.exec(`
            CREATE TABLE employee_advances (
              id TEXT PRIMARY KEY,
              employee_id TEXT NOT NULL REFERENCES employees(id),
              amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
              repaid_minor INTEGER NOT NULL DEFAULT 0 CHECK (repaid_minor >= 0 AND repaid_minor <= amount_minor),
              deduction_month TEXT NOT NULL,
              notes TEXT,
              status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
              settled_at TEXT,
              created_by TEXT NOT NULL REFERENCES users(id),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              branch_id TEXT
            );
            CREATE INDEX idx_advances_emp ON employee_advances(employee_id);
            CREATE INDEX idx_advances_month ON employee_advances(deduction_month);
            CREATE INDEX idx_advances_status ON employee_advances(status);
          `);
        }

        if (tableExists("employees")) {
          const cols = columnNames("employees");
          if (!cols.has("shift_start")) {
            db.exec("ALTER TABLE employees ADD COLUMN shift_start TEXT");
          }
          if (!cols.has("shift_end")) {
            db.exec("ALTER TABLE employees ADD COLUMN shift_end TEXT");
          }
          if (!cols.has("commission_pct")) {
            db.exec("ALTER TABLE employees ADD COLUMN commission_pct REAL DEFAULT 0");
          }
        }
      },
    },
    {
      version: 46,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        // 1. Guest Invitations on Plans, Packages and Subscriptions
        if (tableExists("membership_plans")) {
          const cols = columnNames("membership_plans");
          if (!cols.has("invitations_count")) {
            db.exec("ALTER TABLE membership_plans ADD COLUMN invitations_count INTEGER DEFAULT 0");
          }
        }

        if (tableExists("packages")) {
          const cols = columnNames("packages");
          if (!cols.has("invitations_count")) {
            db.exec("ALTER TABLE packages ADD COLUMN invitations_count INTEGER DEFAULT 0");
          }
        }

        if (tableExists("member_subscriptions")) {
          const cols = columnNames("member_subscriptions");
          if (!cols.has("invitations_total")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN invitations_total INTEGER DEFAULT 0");
          }
          if (!cols.has("invitations_used")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN invitations_used INTEGER DEFAULT 0");
          }
          if (!cols.has("promo_code_id")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN promo_code_id TEXT");
          }
        }

        if (tableExists("store_sales")) {
          const cols = columnNames("store_sales");
          if (!cols.has("promo_code_id")) {
            db.exec("ALTER TABLE store_sales ADD COLUMN promo_code_id TEXT");
          }
        }

        if (!tableExists("guest_invitations")) {
          db.exec(`
            CREATE TABLE guest_invitations (
              id TEXT PRIMARY KEY,
              subscription_id TEXT NOT NULL REFERENCES member_subscriptions(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
              guest_name TEXT NOT NULL,
              guest_phone TEXT,
              notes TEXT,
              created_by TEXT REFERENCES users(id),
              created_at TEXT NOT NULL,
              branch_id TEXT
            );
            CREATE INDEX idx_guest_inv_sub ON guest_invitations(subscription_id);
            CREATE INDEX idx_guest_inv_member ON guest_invitations(member_id);
          `);
        }

        // 2. Staff Shifts
        if (!tableExists("staff_shifts")) {
          db.exec(`
            CREATE TABLE staff_shifts (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              opened_at TEXT NOT NULL,
              opening_cash_minor INTEGER NOT NULL DEFAULT 0,
              closed_at TEXT,
              closed_by TEXT REFERENCES users(id),
              expected_cash_minor INTEGER NOT NULL DEFAULT 0,
              counted_cash_minor INTEGER,
              difference_minor INTEGER,
              notes TEXT,
              status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              branch_id TEXT
            );
            CREATE INDEX idx_shifts_user ON staff_shifts(user_id);
            CREATE INDEX idx_shifts_status ON staff_shifts(status);
            CREATE INDEX idx_shifts_opened ON staff_shifts(opened_at);
          `);
        }

        // 3. Promo Codes
        if (!tableExists("promo_codes")) {
          db.exec(`
            CREATE TABLE promo_codes (
              id TEXT PRIMARY KEY,
              code TEXT NOT NULL UNIQUE,
              discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
              discount_value INTEGER NOT NULL CHECK (discount_value > 0),
              min_spend_minor INTEGER NOT NULL DEFAULT 0,
              max_uses INTEGER,
              times_used INTEGER NOT NULL DEFAULT 0,
              valid_from TEXT,
              valid_to TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              notes TEXT,
              created_by TEXT REFERENCES users(id),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX idx_promo_code ON promo_codes(code);
            CREATE INDEX idx_promo_active ON promo_codes(is_active);
          `);
        }

        // 4. Renewal Reminder Logs (prevent duplicate reminders on same day/period)
        if (!tableExists("renewal_reminder_logs")) {
          db.exec(`
            CREATE TABLE renewal_reminder_logs (
              id TEXT PRIMARY KEY,
              subscription_id TEXT NOT NULL REFERENCES member_subscriptions(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
              phone TEXT NOT NULL,
              expiry_date TEXT NOT NULL,
              sent_channel TEXT NOT NULL DEFAULT 'whatsapp',
              status TEXT NOT NULL DEFAULT 'sent',
              sent_at TEXT NOT NULL,
              created_by TEXT REFERENCES users(id)
            );
            CREATE INDEX idx_reminder_sub ON renewal_reminder_logs(subscription_id);
            CREATE INDEX idx_reminder_date ON renewal_reminder_logs(sent_at);
          `);
        }
      },
    },
    {
      version: 47,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        if (tableExists("packages")) {
          const cols = columnNames("packages");
          if (!cols.has("invitations_count")) {
            db.exec("ALTER TABLE packages ADD COLUMN invitations_count INTEGER DEFAULT 0");
          }
        }

        if (tableExists("membership_plans")) {
          const cols = columnNames("membership_plans");
          if (!cols.has("invitations_count")) {
            db.exec("ALTER TABLE membership_plans ADD COLUMN invitations_count INTEGER DEFAULT 0");
          }
        }

        if (tableExists("member_subscriptions")) {
          const cols = columnNames("member_subscriptions");
          if (!cols.has("invitations_total")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN invitations_total INTEGER DEFAULT 0");
          }
          if (!cols.has("invitations_used")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN invitations_used INTEGER DEFAULT 0");
          }
          if (!cols.has("promo_code_id")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN promo_code_id TEXT");
          }
        }

        if (tableExists("store_sales")) {
          const cols = columnNames("store_sales");
          if (!cols.has("promo_code_id")) {
            db.exec("ALTER TABLE store_sales ADD COLUMN promo_code_id TEXT");
          }
        }

        if (!tableExists("guest_invitations")) {
          db.exec(`
            CREATE TABLE guest_invitations (
              id TEXT PRIMARY KEY,
              subscription_id TEXT NOT NULL REFERENCES member_subscriptions(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
              guest_name TEXT NOT NULL,
              guest_phone TEXT,
              notes TEXT,
              created_by TEXT REFERENCES users(id),
              created_at TEXT NOT NULL,
              branch_id TEXT
            );
            CREATE INDEX idx_guest_inv_sub ON guest_invitations(subscription_id);
            CREATE INDEX idx_guest_inv_member ON guest_invitations(member_id);
          `);
        }

        if (!tableExists("staff_shifts")) {
          db.exec(`
            CREATE TABLE staff_shifts (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              opened_at TEXT NOT NULL,
              opening_cash_minor INTEGER NOT NULL DEFAULT 0,
              closed_at TEXT,
              closed_by TEXT REFERENCES users(id),
              expected_cash_minor INTEGER NOT NULL DEFAULT 0,
              counted_cash_minor INTEGER,
              difference_minor INTEGER,
              notes TEXT,
              status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              branch_id TEXT
            );
            CREATE INDEX idx_shifts_user ON staff_shifts(user_id);
            CREATE INDEX idx_shifts_status ON staff_shifts(status);
            CREATE INDEX idx_shifts_opened ON staff_shifts(opened_at);
          `);
        }

        if (!tableExists("promo_codes")) {
          db.exec(`
            CREATE TABLE promo_codes (
              id TEXT PRIMARY KEY,
              code TEXT NOT NULL UNIQUE,
              discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
              discount_value INTEGER NOT NULL CHECK (discount_value > 0),
              min_spend_minor INTEGER NOT NULL DEFAULT 0,
              max_uses INTEGER,
              times_used INTEGER NOT NULL DEFAULT 0,
              valid_from TEXT,
              valid_to TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              notes TEXT,
              created_by TEXT REFERENCES users(id),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX idx_promo_code ON promo_codes(code);
            CREATE INDEX idx_promo_active ON promo_codes(is_active);
          `);
        }

        if (!tableExists("renewal_reminder_logs")) {
          db.exec(`
            CREATE TABLE renewal_reminder_logs (
              id TEXT PRIMARY KEY,
              subscription_id TEXT NOT NULL REFERENCES member_subscriptions(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
              phone TEXT NOT NULL,
              expiry_date TEXT NOT NULL,
              sent_channel TEXT NOT NULL DEFAULT 'whatsapp',
              status TEXT NOT NULL DEFAULT 'sent',
              sent_at TEXT NOT NULL,
              created_by TEXT REFERENCES users(id)
            );
            CREATE INDEX idx_reminder_sub ON renewal_reminder_logs(subscription_id);
            CREATE INDEX idx_reminder_date ON renewal_reminder_logs(sent_at);
          `);
        }
      },
    },
    {
      version: 48,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        if (tableExists("classes")) {
          const cols = columnNames("classes");
          if (!cols.has("discipline")) {
            db.exec("ALTER TABLE classes ADD COLUMN discipline TEXT DEFAULT 'general'");
          }
          if (!cols.has("category")) {
            db.exec("ALTER TABLE classes ADD COLUMN category TEXT DEFAULT 'all'");
          }
          if (!cols.has("level")) {
            db.exec("ALTER TABLE classes ADD COLUMN level TEXT DEFAULT 'all_levels'");
          }
        }

        if (tableExists("trainers")) {
          const cols = columnNames("trainers");
          if (!cols.has("rank_title")) {
            db.exec("ALTER TABLE trainers ADD COLUMN rank_title TEXT");
          }
        }
      },
    },
    {
      version: 49,
      statements: [],
      fkOff: true,
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;

        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('classes.purge')");
        db.run("INSERT OR IGNORE INTO permissions (code) VALUES ('trainers.purge')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'classes.purge')");
        db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES ('manager', 'trainers.purge')");

        if (tableExists("store_sale_items")) {
          const cols = columnNames("store_sale_items");
          const hasSnapshot = cols.has("product_name_snapshot");
          const hasReturned = cols.has("returned_qty");
          const hasSku = cols.has("product_sku_snapshot");

          db.exec(
            "CREATE TABLE store_sale_items_v49 (\n" +
            "  id TEXT PRIMARY KEY,\n" +
            "  sale_id TEXT NOT NULL REFERENCES store_sales(id),\n" +
            "  product_id TEXT REFERENCES products(id),\n" +
            "  product_name_snapshot TEXT NOT NULL DEFAULT '',\n" +
            "  qty REAL NOT NULL CHECK (qty > 0),\n" +
            "  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),\n" +
            "  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),\n" +
            "  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),\n" +
            "  returned_qty REAL NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),\n" +
            "  product_sku_snapshot TEXT\n" +
            ")"
          );
          db.exec(
            `INSERT INTO store_sale_items_v49 (id, sale_id, product_id, product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor, returned_qty, product_sku_snapshot) ` +
            `SELECT id, sale_id, product_id, ${hasSnapshot ? "product_name_snapshot" : "''"}, qty, unit_price_minor, unit_cost_minor, line_total_minor, ${hasReturned ? "returned_qty" : "0"}, ${hasSku ? "product_sku_snapshot" : "NULL"} FROM store_sale_items`
          );
          db.exec("DROP TABLE store_sale_items");
          db.exec("ALTER TABLE store_sale_items_v49 RENAME TO store_sale_items");
          db.exec("CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON store_sale_items(sale_id)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_sale_items_product ON store_sale_items(product_id)");
        }

        if (tableExists("store_return_items")) {
          const cols = columnNames("store_return_items");
          const hasSnapshot = cols.has("product_name_snapshot");
          const hasSku = cols.has("product_sku_snapshot");

          db.exec(
            "CREATE TABLE store_return_items_v49 (\n" +
            "  id TEXT PRIMARY KEY,\n" +
            "  return_id TEXT NOT NULL REFERENCES store_returns(id),\n" +
            "  sale_item_id TEXT NOT NULL REFERENCES store_sale_items(id),\n" +
            "  product_id TEXT REFERENCES products(id),\n" +
            "  product_name_snapshot TEXT NOT NULL DEFAULT '',\n" +
            "  qty REAL NOT NULL CHECK (qty > 0),\n" +
            "  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),\n" +
            "  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),\n" +
            "  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),\n" +
            "  product_sku_snapshot TEXT\n" +
            ")"
          );
          db.exec(
            `INSERT INTO store_return_items_v49 (id, return_id, sale_item_id, product_id, product_name_snapshot, qty, unit_price_minor, unit_cost_minor, line_total_minor, product_sku_snapshot) ` +
            `SELECT id, return_id, sale_item_id, product_id, ${hasSnapshot ? "product_name_snapshot" : "''"}, qty, unit_price_minor, unit_cost_minor, line_total_minor, ${hasSku ? "product_sku_snapshot" : "NULL"} FROM store_return_items`
          );
          db.exec("DROP TABLE store_return_items");
          db.exec("ALTER TABLE store_return_items_v49 RENAME TO store_return_items");
          db.exec("CREATE INDEX IF NOT EXISTS idx_store_return_items_return ON store_return_items(return_id)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_store_return_items_product ON store_return_items(product_id)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_store_return_items_sale_item ON store_return_items(sale_item_id)");
        }
      },
    },
    {
      version: 50,
      statements: [],
      callback: (db: Db) => {
        const tables = new Set(
          db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name),
        );
        if (!tables.has("expense_categories")) return;
        db.run(
          "INSERT OR IGNORE INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('cat-owner-withdrawal', 'مسحوبات المالك / الإدارة', 1, '2026-10-08T00:00:00Z')",
        );
      },
    },
    {
      version: 51,
      statements: [
        `CREATE TABLE IF NOT EXISTS payment_methods (
          code TEXT PRIMARY KEY,
          label_ar TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`,
        "INSERT OR IGNORE INTO payment_methods (code, label_ar, sort_order, created_at) VALUES ('instapay', 'انستاباي', 5, '2026-10-08 00:00:00'), ('wallet', 'محفظة إلكترونية', 6, '2026-10-08 00:00:00')",
        `CREATE TABLE IF NOT EXISTS quick_sessions (
          id TEXT PRIMARY KEY,
          client_type TEXT NOT NULL CHECK (client_type IN ('member', 'guest')),
          member_id TEXT REFERENCES members(id),
          guest_name TEXT,
          guest_phone TEXT,
          guest_gender TEXT CHECK (guest_gender IN ('male', 'female')),
          session_name TEXT NOT NULL,
          price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
          paid_amount_minor INTEGER NOT NULL CHECK (paid_amount_minor >= 0),
          method_code TEXT NOT NULL REFERENCES payment_methods(code),
          trainer_id TEXT REFERENCES trainers(id),
          session_date TEXT NOT NULL,
          session_time TEXT NOT NULL,
          attendance_recorded INTEGER NOT NULL DEFAULT 1 CHECK (attendance_recorded IN (0, 1)),
          notes TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_quick_sessions_date ON quick_sessions(session_date)",
        "CREATE INDEX IF NOT EXISTS idx_quick_sessions_member ON quick_sessions(member_id)",
        `CREATE TABLE IF NOT EXISTS suppliers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          address TEXT,
          company_name TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS purchase_invoices (
          id TEXT PRIMARY KEY,
          invoice_no TEXT NOT NULL UNIQUE,
          supplier_id TEXT NOT NULL REFERENCES suppliers(id),
          invoice_date TEXT NOT NULL,
          total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor >= 0),
          paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
          remaining_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (remaining_amount_minor >= 0),
          method_code TEXT REFERENCES payment_methods(code),
          status TEXT NOT NULL CHECK (status IN ('paid', 'partial', 'unpaid')),
          notes TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id)",
        "CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(invoice_date)",
        `CREATE TABLE IF NOT EXISTS purchase_invoice_items (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
          total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0)
        )`,
        "CREATE INDEX IF NOT EXISTS idx_purchase_items_invoice ON purchase_invoice_items(invoice_id)",
        `CREATE TABLE IF NOT EXISTS private_training_packages (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sessions_count INTEGER NOT NULL CHECK (sessions_count > 0),
          price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
          duration_days INTEGER NOT NULL CHECK (duration_days > 0),
          coach_commission_percent REAL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS private_trainings (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL REFERENCES members(id),
          trainer_id TEXT NOT NULL REFERENCES trainers(id),
          package_id TEXT REFERENCES private_training_packages(id),
          total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
          completed_sessions INTEGER NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0),
          price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
          paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
          remaining_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (remaining_amount_minor >= 0),
          method_code TEXT REFERENCES payment_methods(code),
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
          notes TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_pt_member ON private_trainings(member_id)",
        "CREATE INDEX IF NOT EXISTS idx_pt_trainer ON private_trainings(trainer_id)",
        `CREATE TABLE IF NOT EXISTS private_training_sessions (
          id TEXT PRIMARY KEY,
          private_training_id TEXT NOT NULL REFERENCES private_trainings(id) ON DELETE CASCADE,
          trainer_id TEXT NOT NULL REFERENCES trainers(id),
          session_date TEXT NOT NULL,
          session_time TEXT NOT NULL,
          notes TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_pt_sessions_pt ON private_training_sessions(private_training_id)",
        `CREATE TABLE IF NOT EXISTS gym_announcements (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'danger')),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL
        )`,
      ],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        const columnNames = (table: string) =>
          new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

        if (tableExists("member_subscriptions")) {
          const cols = columnNames("member_subscriptions");
          if (!cols.has("sales_user_id")) {
            db.exec("ALTER TABLE member_subscriptions ADD COLUMN sales_user_id TEXT REFERENCES users(id)");
          }
        }
        if (tableExists("membership_plans")) {
          const cols = columnNames("membership_plans");
          if (!cols.has("allowed_days")) {
            db.exec("ALTER TABLE membership_plans ADD COLUMN allowed_days TEXT");
          }
        }

        for (const p of PERMS) {
          db.run("INSERT OR IGNORE INTO permissions (code) VALUES (?)", [p]);
        }
        for (const role of ROLES) {
          for (const p of ROLE_GRANTS[role]) {
            db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)", [role, p]);
          }
        }
      },
    },
    {
      version: 52,
      statements: [
        `CREATE TABLE IF NOT EXISTS championship_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          color TEXT,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS championships (
          id TEXT PRIMARY KEY,
          category_id TEXT REFERENCES championship_categories(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          date TEXT,
          location TEXT,
          description TEXT,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_championships_cat ON championships(category_id)",
        `CREATE TABLE IF NOT EXISTS championship_achievements (
          id TEXT PRIMARY KEY,
          championship_id TEXT NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
          member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          rank_title TEXT NOT NULL,
          medal TEXT,
          notes TEXT,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_champ_achieve_champ ON championship_achievements(championship_id)",
        "CREATE INDEX IF NOT EXISTS idx_champ_achieve_member ON championship_achievements(member_id)",
        `CREATE TABLE IF NOT EXISTS trainer_attendance (
          id TEXT PRIMARY KEY,
          trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          check_in_time TEXT NOT NULL,
          check_out_time TEXT,
          status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'late', 'absent', 'excused')),
          notes TEXT,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_trainer_att_date ON trainer_attendance(date)",
        "CREATE INDEX IF NOT EXISTS idx_trainer_att_trainer ON trainer_attendance(trainer_id)",
        `CREATE TABLE IF NOT EXISTS member_direct_messages (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          sender_type TEXT NOT NULL CHECK (sender_type IN ('gym', 'member')),
          sender_user_id TEXT REFERENCES users(id),
          message TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'internal')),
          status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_member_direct_msgs_member ON member_direct_messages(member_id)",
        "CREATE INDEX IF NOT EXISTS idx_member_direct_msgs_created ON member_direct_messages(created_at)",
      ],
      callback: (db: Db) => {
        const catCount = db.count("SELECT COUNT(*) FROM championship_categories");
        if (catCount === 0) {
          const defaultCats = [
            { id: "cat-bb", name: "كمال الأجسام", description: "Bodybuilding", color: "#f59e0b" },
            { id: "cat-cp", name: "كلاسيك فيزيك", description: "Classic Physique", color: "#3b82f6" },
            { id: "cat-mp", name: "منس فيزيك", description: "Men's Physique", color: "#10b981" },
            { id: "cat-bk", name: "بيكيني", description: "Bikini Fitness", color: "#ec4899" },
            { id: "cat-pl", name: "باور ليفتنج", description: "Powerlifting", color: "#8b5cf6" },
          ];
          for (const c of defaultCats) {
            db.run(
              "INSERT OR IGNORE INTO championship_categories (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
              [c.id, c.name, c.description, c.color, nowStamp()]
            );
          }
        }

        for (const p of PERMS) {
          db.run("INSERT OR IGNORE INTO permissions (code) VALUES (?)", [p]);
        }
        for (const role of ROLES) {
          for (const p of ROLE_GRANTS[role]) {
            db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)", [role, p]);
          }
        }
      },
    },
    {
      version: 53,
      statements: [],
      callback: (db: Db) => {
        const hasTrainers = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'trainers'") > 0;
        if (!hasTrainers) return;
        const cols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(trainers)").map((c) => c.name),
        );
        if (!cols.has("employee_id")) {
          db.exec("ALTER TABLE trainers ADD COLUMN employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL");
          db.exec("CREATE INDEX IF NOT EXISTS idx_trainers_employee ON trainers(employee_id)");
        }
      },
    },
    {
      version: 54,
      statements: [],
      callback: (db: Db) => {
        const hasMembers = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'members'") > 0;
        if (!hasMembers) return;
        const cols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(members)").map((c) => c.name),
        );
        if (!cols.has("home_branch_only")) {
          db.exec("ALTER TABLE members ADD COLUMN home_branch_only INTEGER NOT NULL DEFAULT 0 CHECK (home_branch_only IN (0, 1))");
        }
      },
    },
    {
      version: 55,
      statements: [],
      callback: (db: Db) => {
        const hasUsers = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'") > 0;
        if (!hasUsers) return;
        const cols = new Set(
          db.all<{ name: string }>("PRAGMA table_info(users)").map((c) => c.name),
        );
        if (!cols.has("user_code")) {
          db.exec("ALTER TABLE users ADD COLUMN user_code TEXT");
          db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code)");
        }
        if (db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'counters'") > 0) {
          db.run("INSERT INTO counters (name, value) VALUES ('user_code', 0) ON CONFLICT(name) DO NOTHING");
        }
        const orderBy = cols.has("created_at") ? "ORDER BY created_at ASC, rowid ASC" : "ORDER BY rowid ASC";
        const rows = db.all<{ id: string; user_code: string | null }>(
          `SELECT id, user_code FROM users ${orderBy}`,
        );
        let seq = 0;
        for (const row of rows) {
          if (!row.user_code) {
            seq++;
            const code = `U${seq}`;
            db.run("UPDATE users SET user_code = ? WHERE id = ?", [code, row.id]);
          } else {
            const m = row.user_code.match(/^U(\d+)$/i);
            if (m) {
              const num = parseInt(m[1], 10);
              if (num > seq) seq = num;
            }
          }
        }
        if (seq > 0) {
          db.run(
            "INSERT INTO counters (name, value) VALUES ('user_code', ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, ?)",
            [seq, seq],
          );
        }
      },
    },
    {
      version: 56,
      statements: [],
      callback: (db: Db) => {
        const hasClasses = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'classes'") > 0;
        if (hasClasses) {
          const classCols = new Set(db.all<{ name: string }>("PRAGMA table_info(classes)").map((c) => c.name));
          if (!classCols.has("plan_id")) {
            db.exec("ALTER TABLE classes ADD COLUMN plan_id TEXT REFERENCES membership_plans(id)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_classes_plan_id ON classes(plan_id)");
          }
          if (!classCols.has("default_trainer_fee_minor")) {
            db.exec("ALTER TABLE classes ADD COLUMN default_trainer_fee_minor INTEGER NOT NULL DEFAULT 0");
          }
        }

        const hasSessions = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'class_sessions'") > 0;
        if (hasSessions) {
          const sessionCols = new Set(db.all<{ name: string }>("PRAGMA table_info(class_sessions)").map((c) => c.name));
          if (!sessionCols.has("trainer_fee_minor")) {
            db.exec("ALTER TABLE class_sessions ADD COLUMN trainer_fee_minor INTEGER NOT NULL DEFAULT 0");
          }
          if (!sessionCols.has("paid_to_trainer")) {
            db.exec("ALTER TABLE class_sessions ADD COLUMN paid_to_trainer INTEGER NOT NULL DEFAULT 0 CHECK (paid_to_trainer IN (0, 1))");
          }
          if (!sessionCols.has("expense_id")) {
            db.exec("ALTER TABLE class_sessions ADD COLUMN expense_id TEXT REFERENCES expenses(id)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_class_sessions_expense ON class_sessions(expense_id)");
          }
          if (!sessionCols.has("paid_at")) {
            db.exec("ALTER TABLE class_sessions ADD COLUMN paid_at TEXT");
          }
        }

        const hasTrainers = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'trainers'") > 0;
        if (hasTrainers) {
          const trainerCols = new Set(db.all<{ name: string }>("PRAGMA table_info(trainers)").map((c) => c.name));
          if (!trainerCols.has("default_session_fee_minor")) {
            db.exec("ALTER TABLE trainers ADD COLUMN default_session_fee_minor INTEGER NOT NULL DEFAULT 0");
          }
        }
      },
    },
    {
      version: 57,
      statements: [
        `CREATE TABLE IF NOT EXISTS member_whatsapp_identities (
          id TEXT PRIMARY KEY,
          member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
          phone TEXT NOT NULL,
          lid TEXT UNIQUE,
          remote_jid TEXT,
          push_name TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_member_wa_phone ON member_whatsapp_identities(phone)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_member_wa_lid ON member_whatsapp_identities(lid) WHERE lid IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_member_wa_member ON member_whatsapp_identities(member_id)",
      ],
      callback: (db: Db) => {
        const hasDirectMsgs = db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'member_direct_messages'") > 0;
        if (hasDirectMsgs) {
          const cols = new Set(db.all<{ name: string }>("PRAGMA table_info(member_direct_messages)").map((c) => c.name));
          if (!cols.has("error_reason")) {
            db.exec("ALTER TABLE member_direct_messages ADD COLUMN error_reason TEXT");
          }
          if (!cols.has("message_type")) {
            db.exec("ALTER TABLE member_direct_messages ADD COLUMN message_type TEXT DEFAULT 'direct'");
          }
          if (!cols.has("retry_count")) {
            db.exec("ALTER TABLE member_direct_messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
          }
        }

        const memberCols = db.all<{ name: string }>("PRAGMA table_info(members)");
        if (memberCols.some((c) => c.name === "phone")) {
          const members = db.all<{ id: string; phone: string; full_name: string }>(
            "SELECT id, phone, full_name FROM members WHERE phone IS NOT NULL AND phone != '' AND deleted_at IS NULL",
          );
          const now = nowStamp();
          for (const m of members) {
            const clean = m.phone.replace(/[^\d]/g, "");
            if (!clean) continue;
            db.run(
              `INSERT OR IGNORE INTO member_whatsapp_identities (id, member_id, phone, push_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), m.id, clean, m.full_name, now, now],
            );
          }
        }
      },
    },
    {
      version: 58,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          Boolean(db.scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]));
        if (tableExists("membership_plans")) {
          const cols = new Set(
            db.all<{ name: string }>("PRAGMA table_info(membership_plans)").map((c) => c.name),
          );
          if (!cols.has("category")) {
            db.exec(
              "ALTER TABLE membership_plans ADD COLUMN category TEXT NOT NULL DEFAULT 'gym' CHECK (category IN ('gym', 'academy'))",
            );
          }
          if (tableExists("classes")) {
            db.exec(
              "UPDATE membership_plans SET category = 'academy' WHERE id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)",
            );
          }
          db.exec("CREATE INDEX IF NOT EXISTS idx_membership_plans_category ON membership_plans(category)");
        }
      },
    },
    {
      version: 59,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          Boolean(db.scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]));

        // 1. Add schedule_json to classes for detailed days & times
        if (tableExists("classes")) {
          const cols = new Set(
            db.all<{ name: string }>("PRAGMA table_info(classes)").map((c) => c.name),
          );
          if (!cols.has("schedule_json")) {
            db.exec("ALTER TABLE classes ADD COLUMN schedule_json TEXT DEFAULT NULL");
          }
        }

        // 2. Ensure trainer payouts expense category exists
        if (tableExists("expense_categories")) {
          db.run(
            "INSERT OR IGNORE INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('cat-trainers', 'مستحقات وأتعاب المدربين', 1, ?)",
            [nowStamp()],
          );
        }

        // 3. Create trainer_payouts table
        db.exec(`
          CREATE TABLE IF NOT EXISTS trainer_payouts (
            id TEXT PRIMARY KEY,
            trainer_id TEXT NOT NULL REFERENCES trainers(id),
            amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
            payout_date TEXT NOT NULL,
            payout_type TEXT NOT NULL DEFAULT 'academy_fee' CHECK (payout_type IN ('monthly_salary', 'academy_fee', 'pt_commission', 'bonus', 'advance', 'other')),
            method_code TEXT NOT NULL DEFAULT 'cash' REFERENCES payment_methods(code),
            notes TEXT,
            expense_id TEXT REFERENCES expenses(id),
            created_by TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            branch_id TEXT DEFAULT 'main'
          );
          CREATE INDEX IF NOT EXISTS idx_trainer_payouts_trainer ON trainer_payouts(trainer_id);
          CREATE INDEX IF NOT EXISTS idx_trainer_payouts_date ON trainer_payouts(payout_date);
        `);
      },
    },
    {
      version: 60,
      statements: [],
      callback: (db) => {
        const tableExists = (table: string) =>
          Boolean(db.scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]));

        if (tableExists("quick_sessions")) {
          const cols = new Set(
            db.all<{ name: string }>("PRAGMA table_info(quick_sessions)").map((c) => c.name),
          );
          if (!cols.has("lead_id")) {
            db.exec("ALTER TABLE quick_sessions ADD COLUMN lead_id TEXT REFERENCES leads(id) DEFAULT NULL");
            db.exec("CREATE INDEX IF NOT EXISTS idx_quick_sessions_lead ON quick_sessions(lead_id)");
          }
          if (!cols.has("invitation_member_id")) {
            db.exec("ALTER TABLE quick_sessions ADD COLUMN invitation_member_id TEXT REFERENCES members(id) DEFAULT NULL");
            db.exec("CREATE INDEX IF NOT EXISTS idx_quick_sessions_inv_member ON quick_sessions(invitation_member_id)");
          }
        }
      },
    },
    {
      version: 61,
      statements: [],
      callback: (db) => {
        const tableExists = (table: string) =>
          Boolean(db.scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]));

        if (tableExists("trainers")) {
          const cols = new Set(
            db.all<{ name: string }>("PRAGMA table_info(trainers)").map((c) => c.name),
          );
          if (!cols.has("working_schedule")) {
            db.exec("ALTER TABLE trainers ADD COLUMN working_schedule TEXT DEFAULT NULL");
          }
        }
      },
    },
    {
      version: 62,
      statements: [],
      callback: (db) => {
        const tableExists = (table: string) =>
          Boolean(db.scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]));

        if (tableExists("membership_plans") && tableExists("classes")) {
          // 1. Ensure all plans linked to classes have category = 'academy'
          db.exec(
            "UPDATE membership_plans SET category = 'academy' WHERE id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)",
          );

          // 2. Fix inflated prices for plans linked to classes created when form multiplied by 100 (e.g. 500 -> 50000)
          db.exec(`
            UPDATE membership_plans
            SET price = ROUND(price / 100, 2)
            WHERE id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)
              AND price >= 10000
              AND (CAST(price AS INTEGER) % 100) = 0
          `);

          // 3. Fix corresponding subscriptions created with inflated plan price
          if (tableExists("member_subscriptions")) {
            db.exec(`
              UPDATE member_subscriptions
              SET price = ROUND(price / 100, 2)
              WHERE plan_id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)
                AND price >= 10000
                AND (CAST(price AS INTEGER) % 100) = 0
            `);
          }

          // 4. Fix corresponding payments and ledger entries if inflated
          if (tableExists("payments") && tableExists("member_subscriptions")) {
            db.exec(`
              UPDATE payments
              SET base_amount_minor = ROUND(base_amount_minor / 100),
                  paid_amount_minor = CASE
                    WHEN paid_amount_minor >= 1000000 AND (paid_amount_minor % 100) = 0
                    THEN ROUND(paid_amount_minor / 100)
                    ELSE paid_amount_minor
                  END
              WHERE subscription_id IN (
                SELECT ms.id FROM member_subscriptions ms
                WHERE ms.plan_id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)
              )
              AND base_amount_minor >= 1000000
              AND (base_amount_minor % 100) = 0
            `);

            if (tableExists("financial_ledger")) {
              db.exec(`
                UPDATE financial_ledger
                SET amount_minor = ROUND(amount_minor / 100)
                WHERE ref_table = 'payments'
                  AND ref_id IN (
                    SELECT p.id FROM payments p
                    WHERE p.subscription_id IN (
                      SELECT ms.id FROM member_subscriptions ms
                      WHERE ms.plan_id IN (SELECT plan_id FROM classes WHERE plan_id IS NOT NULL)
                    )
                  )
                  AND amount_minor >= 1000000
                  AND (amount_minor % 100) = 0
              `);
            }
          }
        }
      },
    },
    {
      version: 63,
      statements: [
        `CREATE TABLE IF NOT EXISTS member_belt_gradings (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          discipline TEXT NOT NULL,
          belt_name TEXT NOT NULL,
          belt_color TEXT DEFAULT '#10B981',
          grading_date TEXT NOT NULL,
          examiner_name TEXT,
          score_or_grade TEXT,
          certificate_no TEXT,
          notes TEXT,
          branch_id TEXT DEFAULT 'main',
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_belt_gradings_member ON member_belt_gradings(member_id)`,
        `CREATE INDEX IF NOT EXISTS idx_belt_gradings_date ON member_belt_gradings(grading_date)`,
        `CREATE INDEX IF NOT EXISTS idx_belt_gradings_discipline ON member_belt_gradings(discipline)`,
      ],
    },
    {
      version: 64,
      statements: [
        `CREATE TABLE IF NOT EXISTS whatsapp_bot_handovers (
          id TEXT PRIMARY KEY,
          phone TEXT NOT NULL,
          member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
          customer_name TEXT NOT NULL,
          last_message TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT REFERENCES users(id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_bot_handovers_status ON whatsapp_bot_handovers(status)`,
        `CREATE INDEX IF NOT EXISTS idx_bot_handovers_phone ON whatsapp_bot_handovers(phone)`,
        `CREATE INDEX IF NOT EXISTS idx_bot_handovers_created ON whatsapp_bot_handovers(created_at)`,
      ],
    },
    {
      version: 65,
      statements: [],
      callback: (db: Db) => {
        const tableExists = (table: string) =>
          db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) > 0;
        if (tableExists("cash_sessions")) {
          const cols = new Set(db.all<{ name: string }>("PRAGMA table_info(cash_sessions)").map((c) => c.name));
          if (!cols.has("previous_session_id")) {
            db.exec("ALTER TABLE cash_sessions ADD COLUMN previous_session_id TEXT REFERENCES cash_sessions(id)");
          }
          if (!cols.has("previous_closing_minor")) {
            db.exec("ALTER TABLE cash_sessions ADD COLUMN previous_closing_minor INTEGER");
          }
          if (!cols.has("inter_shift_gap_minor")) {
            db.exec("ALTER TABLE cash_sessions ADD COLUMN inter_shift_gap_minor INTEGER DEFAULT 0");
          }
          if (!cols.has("gap_reason")) {
            db.exec("ALTER TABLE cash_sessions ADD COLUMN gap_reason TEXT");
          }
          if (!cols.has("gap_expense_id")) {
            db.exec("ALTER TABLE cash_sessions ADD COLUMN gap_expense_id TEXT REFERENCES expenses(id)");
          }
          db.exec("CREATE INDEX IF NOT EXISTS idx_cash_sessions_prev_session ON cash_sessions(previous_session_id)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_cash_sessions_gap_expense ON cash_sessions(gap_expense_id)");
        }

        if (tableExists("expense_categories")) {
          db.run(
            "INSERT OR IGNORE INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('cat-cash-shortage', 'عجز ونواقص الخزينة', 1, datetime('now'))",
          );
        }
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
