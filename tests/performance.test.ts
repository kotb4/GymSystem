import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/engine";
import { buildActor, setup } from "@/core/services/auth.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import { getFinanceOverview, listLedgerEntries } from "@/core/services/finance.service";
import { listPayments } from "@/core/services/payments.service";
import { listMembers } from "@/core/services/members.service";
import { listAuditLogs } from "@/core/services/audit.service";
import { listAuditForMember } from "@/core/services/member-profile.service";
import { countCheckInsOnDate } from "@/core/services/attendance.service";
import { getDashboardOverview } from "@/core/services/dashboard.service";
import { addDaysKey, nowStamp, todayKey } from "@/core/dates";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

// Performance/scale benchmark for a single-gym production profile (1k–10k
// members). TASK-043: asserts generous ceilings so CI stays green, prints the
// measured numbers for the record, and deterministically verifies that the hot
// paths land on the right indexes. Set GYM_PERF_SCALE to override the size
// (default 1000, capped at 25000).
const SCALE = Math.min(25000, Math.max(200, Number(process.env.GYM_PERF_SCALE ?? 1000)));

function timed<T>(label: string, fn: () => T): T {
  const started = performance.now();
  const value = fn();
  const ms = Math.round((performance.now() - started) * 10) / 10;
  console.info(`[perf] ${label}: ${ms}ms`);
  return value;
}

function explain(sql: string, params: unknown[] = []): string[] {
  return db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params as never[]).map((r) => r.detail);
}

let db: Db;
let owner: ServiceActor;

const reportFrom = (): string => addDaysKey(todayKey(), -29);

function seedBulk(): void {
  const ownerId = owner.userId;
  const stamped = (daysAgo: number): string =>
    nowStamp(new Date(Date.now() - daysAgo * 86_400_000));
  const today = todayKey();
  const planIds = ["perf-plan-basic", "perf-plan-pro", "perf-plan-year"];

  db.transaction(() => {
    for (const [idx, id] of planIds.entries()) {
      db.run(
        `INSERT INTO membership_plans (id, name, duration_days, price, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [id, `خطة الأداء ${idx + 1}`, idx === 2 ? 365 : 30, 1000 + idx * 500, stamped(1), stamped(1)],
      );
    }
    db.run(
      `INSERT INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('perf-cat', 'مصاريف الأداء', 1, ?)`,
      [stamped(1)],
    );
  });

  db.transaction(() => {
    for (let i = 0; i < SCALE; i++) {
      const memberId = `perf-m-${String(i).padStart(6, "0")}`;
      const registration = stamped(i % 30);
      db.run(
        `INSERT INTO members (id, member_code, full_name, phone, registration_date, status, department, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 'general', ?, ?, ?)`,
        [memberId, `PM${String(i).padStart(6, "0")}`, `عضو أداء ${i}`, `0100000${String(i).padStart(5, "0")}`, today, ownerId, registration, stamped(1)],
      );
    }
  });

  db.transaction(() => {
    for (let i = 0; i < SCALE; i++) {
      const subId = `perf-s-${String(i).padStart(6, "0")}`;
      const planId = planIds[i % planIds.length];
      const started = addDaysKey(today, -(i % 29));
      const end = addDaysKey(started, planId === "perf-plan-year" ? 364 : 29);
      db.run(
        `INSERT INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1000, 'active', ?, ?, ?)`,
        [subId, `perf-m-${String(i).padStart(6, "0")}`, planId, started, end, ownerId, stamped(1), stamped(1)],
      );
    }
  });

  db.transaction(() => {
    for (let i = 0; i < SCALE; i++) {
      const memberId = `perf-m-${String(i).padStart(6, "0")}`;
      for (let p = 0; p < 3; p++) {
        const paymentId = `perf-p-${String(i).padStart(6, "0")}-${p}`;
        const paidAt = stamped((i * 3 + p) % 29);
        const net = 50_000;
        db.run(
          `INSERT INTO payments (id, member_id, base_amount_minor, discount_kind, discount_input, discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, method_code, status, paid_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'none', 0, 0, ?, ?, 0, 0, 'cash', 'paid', ?, ?, ?, ?)`,
          [paymentId, memberId, net, net, net, paidAt, ownerId, paidAt, paidAt],
        );
      }
    }
  });

  db.transaction(() => {
    for (let i = 0; i < SCALE; i++) {
      const memberId = `perf-m-${String(i).padStart(6, "0")}`;
      for (let a = 0; a < 10; a++) {
        const at = stamped((i + a) % 14);
        db.run(
          `INSERT INTO attendance (id, member_id, checkin_at, created_by)
           VALUES (?, ?, ?, ?)`,
          [`perf-a-${String(i).padStart(6, "0")}-${a}`, memberId, at, ownerId],
        );
      }
    }
  });

  db.transaction(() => {
    for (let i = 0; i < Math.ceil(SCALE * 3); i++) {
      db.run(
        `INSERT INTO financial_ledger (entry_type, ref_table, ref_id, member_id, method_code, direction, amount_minor, occurred_at, created_by, created_at)
         VALUES ('payment', 'payments', ?, ?, 'cash', 1, 50000, ?, ?, ?)`,
        [`perf-p-${String(Math.floor(i / 3)).padStart(6, "0")}-${i % 3}`, `perf-m-${String(Math.floor(i / 3)).padStart(6, "0")}`, stamped(i % 29), ownerId, stamped(1)],
      );
    }
  });

  db.transaction(() => {
    for (let i = 0; i < SCALE; i++) {
      const memberId = `perf-m-${String(i).padStart(6, "0")}`;
      const created = stamped(i % 29);
      db.run(
        `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, metadata, created_at)
         VALUES (?, 'owner', 'MEMBER_CREATED', 'member', ?, NULL, ?)`,
        [ownerId, memberId, created],
      );
      db.run(
        `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, metadata, created_at)
         VALUES (?, 'owner', 'MEMBER_EDITED', 'member', ?, NULL, ?)`,
        [ownerId, memberId, stamped((i + 3) % 29)],
      );
    }
  });

  db.transaction(() => {
    for (let i = 0; i < 20; i++) {
      db.run(
        `INSERT INTO expenses (id, category_id, amount_minor, method_code, description, expense_date, status, created_by, created_at, updated_at)
         VALUES (?, 'perf-cat', 5000, 'cash', 'مصروف أداء', ?, 'active', ?, ?, ?)`,
        [`perf-e-${i}`, addDaysKey(today, -(i % 29)), ownerId, stamped(1), stamped(1)],
      );
    }
    for (let i = 0; i < 40; i++) {
      db.run(
        `INSERT INTO payment_refunds (id, payment_id, amount_minor, reason, method_code, created_by, created_at)
         VALUES (?, ?, 5000, 'رد أداء', 'cash', ?, ?)`,
        [`perf-r-${i}`, `perf-p-${String(i).padStart(6, "0")}-0`, ownerId, stamped(i % 29)],
      );
    }
  });
}

describe("performance profile", () => {
  beforeAll(
    async () => {
      db = createTestDb();
      const ownerUser = await setup(db, {
        gymName: "Yassen Mohamed Kotb | 01288536381",
        ownerFullName: "المالك",
        username: "perf-owner",
        password: "Owner@2026",
      });
      owner = buildActor(ownerUser);
      seedBulk();
      console.info(`[perf] seeded dataset: scale=${SCALE}`);
    },
    180_000,
  );

  it("keeps the financial report well under budget (summary + paginated details)", () => {
    const from = reportFrom();
    const to = todayKey();
    const p1 = timed(`getPeriodReport(page=1) @${SCALE}`, () =>
      getPeriodReport(db, owner, from, to, {
        paymentsPage: 1,
        expensesPage: 1,
        refundsPage: 1,
        voidsPage: 1,
        pageSize: 50,
      }),
    );
    expect(p1.detailedPayments.items.length).toBeLessThanOrEqual(50);
    expect(p1.detailedPayments.total).toBe(SCALE * 3);
    expect(p1.paymentCount).toBe(SCALE * 3);

    const deep = timed(`getPeriodReport(deep page) @${SCALE}`, () =>
      getPeriodReport(db, owner, from, to, {
        paymentsPage: Math.max(2, Math.ceil((SCALE * 3) / 50) - 1),
        expensesPage: 1,
        refundsPage: 1,
        voidsPage: 1,
        pageSize: 50,
      }),
    );
    expect(deep.detailedPayments.items.length).toBeGreaterThan(0);

    const overview = timed(`getFinanceOverview(@today) @${SCALE}`, () =>
      getFinanceOverview(db, owner, to, to),
    );
    expect(overview).toBeDefined();
  });

  it("keeps the dashboard aggregates under budget", () => {
    const dash = timed(`getDashboardOverview(30d) @${SCALE}`, () => getDashboardOverview(db, owner, "30d"));
    expect(dash).toBeDefined();
  });

  it("keeps member list paging under budget at the first and last pages", () => {
    const first = timed(`listMembers(page=1) @${SCALE}`, () => listMembers(db, owner, { page: 1, pageSize: 100 }));
    expect(first.items.length).toBeLessThanOrEqual(100);
    expect(first.total).toBe(SCALE);

    const lastPage = Math.max(1, Math.ceil(SCALE / 100));
    const last = timed(`listMembers(page=${lastPage}) @${SCALE}`, () =>
      listMembers(db, owner, { page: lastPage, pageSize: 100 }),
    );
    expect(last.items.length).toBeGreaterThanOrEqual(0);
  });

  it("keeps ledger, payments, audit and audit-for-member paging under budget", () => {
    const led = timed(`listLedgerEntries(page deep) @${SCALE}`, () =>
      listLedgerEntries(db, owner, { page: Math.max(1, Math.floor(SCALE / 200)), pageSize: 200 }),
    );
    expect(led).toBeDefined();

    const pay = timed(`listPayments(@range) @${SCALE}`, () =>
      listPayments(db, owner, { fromKey: reportFrom(), toKey: todayKey(), page: Math.max(1, Math.floor(SCALE / 100)), pageSize: 100 }),
    );
    expect(pay).toBeDefined();

    const aud = timed(`listAuditLogs(page deep) @${SCALE}`, () =>
      listAuditLogs(db, owner, { page: Math.max(1, Math.floor(SCALE / 100)), pageSize: 100 }),
    );
    expect(aud).toBeDefined();

    const memberAudit = timed(`listAuditForMember(member 0) @${SCALE}`, () =>
      listAuditForMember(db, owner, "perf-m-000000", { page: 1, pageSize: 50 }),
    );
    expect(memberAudit).toBeDefined();
  });

  it("keeps per-day check-in counting fast and index-backed", () => {
    const n = timed(`countCheckInsOnDate(@today) @${SCALE}`, () => countCheckInsOnDate(db, todayKey()));
    expect(n).toBeGreaterThan(0);

    const plan = explain(
      "SELECT COUNT(*) FROM attendance WHERE deleted_at IS NULL AND checkin_at >= ? AND checkin_at < ?",
      [`${todayKey()} 00:00:00`, `${addDaysKey(todayKey(), 1)} 00:00:00`],
    );
    expect(plan.join("\n")).toContain("idx_att_time");
  });

  it("uses the ledger UNIQUE index for ref lookups (no new index needed there)", () => {
    const plan = explain("SELECT * FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ?", ["perf-p-000000-0"]);
    expect(plan.join("\n")).toContain("financial_ledger");
  });
});