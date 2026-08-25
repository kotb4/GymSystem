import { nowStamp } from "@/core/dates";
import { PERMS, ROLES, ROLE_GRANTS, type RoleId } from "@/core/permissions";
import type { Db } from "./engine";

export interface Migration {
  version: number;
  statements: string[];
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
  db.transaction(() => {
    for (const statement of migration.statements) db.exec(statement);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
      migration.version,
      nowStamp(),
    ]);
  });
}
