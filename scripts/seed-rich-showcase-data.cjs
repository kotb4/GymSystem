const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const crypto = require("node:crypto");

const dbPath = path.join(process.env.LOCALAPPDATA, "GymGate", "Database", "gym.db");
const db = new DatabaseSync(dbPath);

console.log("Seeding rich realistic showcase data into:", dbPath);

const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString().replace("T", " ").slice(0, 19);

// Get owner id
const owner = db.prepare("SELECT id FROM users WHERE username = 'owner'").get();
if (!owner) {
  console.error("Owner user not found!");
  process.exit(1);
}
const ownerId = owner.id;

db.exec("BEGIN");

try {
  // 1. Membership Plans
  const plans = [
    { id: "plan-monthly-1", name: "اشتراك شهري شامل", duration_days: 30, price: 500, kind: "time", color: "#38bdf8" },
    { id: "plan-quarter-1", name: "اشتراك 3 شهور ذهبي", duration_days: 90, price: 1350, kind: "time", color: "#818cf8" },
    { id: "plan-sessions-10", name: "باقة 10 حصص لياقة", duration_days: 45, price: 600, kind: "sessions", sessions_count: 10, color: "#f59e0b" },
    { id: "plan-annual-vip", name: "عضوية سنوية VIP", duration_days: 365, price: 4200, kind: "time", color: "#10b981" },
  ];

  for (const p of plans) {
    db.prepare(`
      INSERT OR REPLACE INTO membership_plans (id, name, duration_days, price, kind, sessions_count, color, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(p.id, p.name, p.duration_days, p.price, p.kind, p.sessions_count || null, p.color, now, now);
  }

  // 2. Members
  const membersData = [
    { id: "mem-01", code: "B1-MEM-000001", name: "كابتن أحمد خالد الشناوي", phone: "01012345678", gender: "male", status: "active", planId: "plan-monthly-1", card: "B1-CRD-000001" },
    { id: "mem-02", code: "B1-MEM-000002", name: "سارة الشريف", phone: "01099887766", gender: "female", status: "active", planId: "plan-quarter-1", card: "B1-CRD-000002" },
    { id: "mem-03", code: "B1-MEM-000003", name: "محمد منصور عبد الله", phone: "01122334455", gender: "male", status: "active", planId: "plan-sessions-10", card: "B1-CRD-000003" },
    { id: "mem-04", code: "B1-MEM-000004", name: "نور الدين الحسيني", phone: "01233445566", gender: "male", status: "active", planId: "plan-monthly-1", card: "B1-CRD-000004" },
    { id: "mem-05", code: "B1-MEM-000005", name: "عمر فتحي الجندي", phone: "01555667788", gender: "male", status: "active", planId: "plan-annual-vip", card: "B1-CRD-000005" },
  ];

  for (const m of membersData) {
    db.prepare(`
      INSERT OR REPLACE INTO members (id, member_code, full_name, phone, gender, status, registration_date, created_by, created_at, updated_at, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main')
    `).run(m.id, m.code, m.name, m.phone, m.gender, m.status, today, ownerId, now, now);

    // Card
    db.prepare(`
      INSERT OR REPLACE INTO cards (id, barcode_value, status, member_id, assigned_at, assigned_by, created_at, updated_at)
      VALUES (?, ?, 'assigned', ?, ?, ?, ?, ?)
    `).run(`card-${m.id}`, m.card, m.id, now, ownerId, now, now);

    // Subscription
    const plan = plans.find(p => p.id === m.planId);
    const endDate = new Date(Date.now() + plan.duration_days * 86400000).toISOString().slice(0, 10);
    const subId = `sub-${m.id}`;

    db.prepare(`
      INSERT OR REPLACE INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, sessions_total, sessions_used, status, created_by, created_at, updated_at, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, 'main')
    `).run(subId, m.id, plan.id, today, endDate, plan.price, plan.sessions_count || null, ownerId, now, now);

    // Payment
    const paymentId = `pay-${m.id}`;
    const amountMinor = plan.price * 100;
    db.prepare(`
      INSERT OR REPLACE INTO payments (id, member_id, subscription_id, base_amount_minor, discount_kind, discount_amount_minor, net_amount_minor, paid_amount_minor, remaining_amount_minor, method_code, status, paid_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'none', 0, ?, ?, 0, 'cash', 'paid', ?, ?, ?, ?)
    `).run(paymentId, m.id, subId, amountMinor, amountMinor, amountMinor, now, ownerId, now, now);

    // Financial ledger
    db.prepare(`
      INSERT OR REPLACE INTO financial_ledger (entry_type, ref_table, ref_id, member_id, method_code, direction, amount_minor, occurred_at, created_by, created_at, box)
      VALUES ('payment', 'payments', ?, ?, 'cash', 1, ?, ?, ?, ?, 'gym')
    `).run(paymentId, m.id, amountMinor, now, ownerId, now);
  }

  // 3. Products in Store
  const products = [
    { id: "prod-01", name: "واي بروتين جولد ستاندرد 2 كجم", sku: "WHEY-GOLD", barcode: "PROD-001", cat: "pcat-supplements", cost: 140000, price: 185000, stock: 15 },
    { id: "prod-02", name: "كرياتين مونوهيدرات 300 جم", sku: "CREATINE-300", barcode: "PROD-002", cat: "pcat-supplements", cost: 55000, price: 75000, stock: 24 },
    { id: "prod-03", name: "بروتين بار شوكولاتة وكراميل", sku: "BAR-CHOC", barcode: "PROD-003", cat: "pcat-supplements", cost: 3000, price: 4500, stock: 65 },
    { id: "prod-04", name: "مشروب طاقة رياضي منعش", sku: "ENERGY-DRINK", barcode: "PROD-004", cat: "pcat-drinks", cost: 2200, price: 3500, stock: 40 },
    { id: "prod-05", name: "مياه معدنية طبيعية 600 مل", sku: "WATER-600", barcode: "PROD-005", cat: "pcat-drinks", cost: 500, price: 1000, stock: 120 },
  ];

  for (const p of products) {
    db.prepare(`
      INSERT OR REPLACE INTO products (id, name, category_id, sku, barcode, cost_minor, price_minor, stock_qty, min_stock_qty, is_active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 1, ?, ?, ?)
    `).run(p.id, p.name, p.cat, p.sku, p.barcode, p.cost, p.price, p.stock, ownerId, now, now);
  }

  // 4. Open Cash Session
  const existingSession = db.prepare("SELECT id FROM cash_sessions WHERE status = 'open' AND box = 'gym'").get();
  if (!existingSession) {
    db.prepare(`
      INSERT INTO cash_sessions (id, opened_by, opened_at, opening_balance_minor, status, box)
      VALUES (?, ?, ?, 50000, 'open', 'gym')
    `).run(crypto.randomUUID(), ownerId, now);
  }

  // 5. Initial Attendance Records (Live Occupants)
  db.prepare("UPDATE attendance SET checkout_at = ? WHERE checkout_at IS NULL").run(now);
  db.prepare(`
    INSERT INTO attendance (id, member_id, card_id, checkin_at, created_by, device_identifier)
    VALUES (?, 'mem-01', 'card-mem-01', datetime('now', '-35 minutes'), ?, 'FRONT-DESK-1')
  `).run(crypto.randomUUID(), ownerId);

  db.prepare(`
    INSERT INTO attendance (id, member_id, card_id, checkin_at, created_by, device_identifier)
    VALUES (?, 'mem-02', 'card-mem-02', datetime('now', '-18 minutes'), ?, 'FRONT-DESK-1')
  `).run(crypto.randomUUID(), ownerId);

  db.exec("COMMIT");
  console.log("✅ Successfully seeded 4 plans, 5 members, cards, products, active cash session, and attendance!");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("❌ Seeding failed:", err);
  process.exit(1);
}
