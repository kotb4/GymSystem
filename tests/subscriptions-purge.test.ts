import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import {
  createSubscription,
  freezeSubscription,
  purgeSubscription,
} from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;
let menStaff: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "الاستقبال",
      roleId: "reception",
    }),
  );
  menStaff = buildActor(
    await createUser(db, owner, {
      username: "men-staff",
      password: "Recep@2026",
      fullName: "موظف رجال",
      roleId: "reception",
      department: "men",
    }),
  );
});

async function subWithMoney(price = 500) {
  const women = await createMember(db, owner, {
    fullName: "عضوة اشتراك",
    department: "women",
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
  const plan = await createPlan(db, owner, { name: `باقة ${price}`, durationDays: 30, price });
  const sub = await createSubscription(db, owner, { memberId: women.id, planId: plan.id });
  const payment = await recordPayment(db, owner, {
    memberId: women.id,
    subscriptionId: sub.id,
    baseAmountMinor: price * 100,
    paidAmountMinor: Math.round((price * 100) / 2),
    methodCode: "cash",
  });
  return { women, sub, payment };
}

describe("subscriptions hard-delete (purgeSubscription)", () => {
  it("removes the subscription with its payments/refunds/ledger/freezes", async () => {
    const { sub, payment } = await subWithMoney(500);
    const subEnd = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [sub.id])!
    ).end_date;
    await freezeSubscription(db, owner, sub.id, { endDate: subEnd });

    const ledgerBefore = db.count(
      "SELECT COUNT(*) AS c FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ?",
      [payment.id],
    );
    expect(ledgerBefore).toBeGreaterThanOrEqual(1);

    await purgeSubscription(db, owner, sub.id);

    expect(db.count("SELECT COUNT(*) AS c FROM member_subscriptions WHERE id = ?", [sub.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM payments WHERE id = ?", [payment.id])).toBe(0);
    expect(db.count("SELECT COUNT(*) AS c FROM payment_refunds WHERE payment_id = ?", [payment.id])).toBe(0);
    expect(
      db.count(
        "SELECT COUNT(*) AS c FROM financial_ledger WHERE (ref_table = 'payments' AND ref_id = ?) OR (ref_table = 'payment_refunds' AND ref_id = ?)",
        [payment.id, payment.id],
      ),
    ).toBe(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM subscription_freezes WHERE subscription_id = ?", [sub.id]),
    ).toBe(0);
    expect(
      db.count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'SUBSCRIPTION_PURGED'"),
    ).toBe(1);
  });

  it("keeps attendance and class bookings alive with detached references", async () => {
    const { women, sub } = await subWithMoney(500);

    const { createClass, createClassSession } = await import("@/core/services/classes.service");
    const cls = await createClass(db, owner, { name: "كروس", capacity: 5 });
    const sess = await createClassSession(db, owner, cls.id, { sessionDate: "2026-09-01", startTime: "18:00" });
    db.run(
      "INSERT INTO attendance (id, member_id, subscription_id, checkin_at) VALUES (?, ?, ?, ?)",
      ["att-keep", women.id, sub.id, new Date().toISOString()],
    );
    db.run(
      "INSERT INTO class_bookings (id, session_id, member_id, consumed_subscription_id, booked_at)\nVALUES ('bk-keep', ?, ?, ?, '2026-01-01T00:00:00')",
      [sess.id, women.id, sub.id],
    );

    await purgeSubscription(db, owner, sub.id);

    // attendance survives, reference detached
    expect(db.count("SELECT COUNT(*) AS c FROM attendance WHERE id = 'att-keep'")).toBe(1);
    expect(
      db.first<{ subscription_id: string | null }>(
        "SELECT subscription_id FROM attendance WHERE id = 'att-keep'",
      )?.subscription_id ?? null,
    ).toBeNull();

    // booking survives, reference detached
    expect(db.count("SELECT COUNT(*) AS c FROM class_bookings WHERE id = 'bk-keep'")).toBe(1);
    expect(
      db.first<{ consumed_subscription_id: string | null }>(
        "SELECT consumed_subscription_id FROM class_bookings WHERE id = 'bk-keep'",
      )?.consumed_subscription_id ?? null,
    ).toBeNull();
  });

  it("denies reception without subscriptions.purge", async () => {
    const { sub } = await subWithMoney(300);
    await expect(purgeSubscription(db, reception, sub.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("enforces department isolation on purge", async () => {
    const { sub } = await subWithMoney(300);
    await expect(purgeSubscription(db, menStaff, sub.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
