import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment, refundPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import { assignDocNo, searchByDocNo } from "@/core/services/document-numbers.service";
import { openCashSession, closeCashSession } from "@/core/services/cash-session.service";
import { errForbidden } from "@/core/errors";
import { createTestDb } from "./helpers/test-db";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";

let db: Db;
let owner: ServiceActor;
let reception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  owner = buildActor(
    await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
});

async function paidSubscription(amountMinor = 150000) {
  const member = await createMember(db, owner, { fullName: "أحمد محمد", phone: "01000000000" });
  const plan = await createPlan(db, owner, { name: "باقة ذهبي", durationDays: 30, price: amountMinor });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  const payment = await recordPayment(db, owner, {
    memberId: member.id,
    subscriptionId: sub.id,
    baseAmountMinor: amountMinor,
    paidAmountMinor: amountMinor,
    methodCode: "cash",
  });
  return { member, sub, payment };
}

/** First refund row id for the suite. */
function firstRefundId(): string {
  return String(db.scalar("SELECT id FROM payment_refunds LIMIT 1"));
}

function docNo(table: string, column: string, id: string): string {
  return String(db.scalar(`SELECT ${column} FROM ${table} WHERE id = ?`, [id]));
}

describe("document reference numbers", () => {
  it("gives a refund a prefixed, searchable reference number", async () => {
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 5000, "استرجاع جزئي");

    const refundNo = docNo("payment_refunds", "refund_no", firstRefundId());
    expect(refundNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?RFD-\d{4}-\d{6}$/);

    const hits = searchByDocNo(db, owner, refundNo);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("refund");
    expect(hits[0].memberName).toBe("أحمد محمد");
    expect(hits[0].amountMinor).toBe(5000);
    expect(hits[0].route).toBe("/payments");
  });

  it("numbers every refund separately and never reuses a number", async () => {
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 1000, "أول");
    await refundPayment(db, owner, payment.id, 2000, "ثاني");

    const all = db.all<{ refund_no: string }>("SELECT refund_no FROM payment_refunds ORDER BY created_at");
    expect(all).toHaveLength(2);
    expect(all[0].refund_no).not.toBe(all[1].refund_no);
  });

  it("is idempotent: re-assigning returns the stored number and burns no counter", async () => {
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 1000, "سبب");
    const refundId = firstRefundId();
    const before = Number(db.scalar("SELECT value FROM counters WHERE name = 'refund_no'"));

    const again = assignDocNo(db, "refund", refundId, "2026-10-02 10:00");
    const after = Number(db.scalar("SELECT value FROM counters WHERE name = 'refund_no'"));

    expect(again).toBe(docNo("payment_refunds", "refund_no", refundId));
    expect(after).toBe(before);
  });

  it("numbers a cash-box closing and finds it again", async () => {
    const session = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 10000 });
    await closeCashSession(db, owner, session.id, 10000, "مطابق");

    const closingNo = docNo("cash_sessions", "closing_no", session.id);
    expect(closingNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?CS-\d{4}-\d{6}$/);

    const hits = searchByDocNo(db, owner, closingNo);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("cash_closing");
    expect(hits[0].route).toBe("/treasury");
  });

  it("numbers each attendance check-in and finds it by member", async () => {
    // Two different members: the duplicate-scan window would otherwise refuse a
    // second check-in for the same card.
    async function checkInMember(name: string, phone: string, barcode: string) {
      const m = await createMember(db, owner, { fullName: name, phone });
      const p = await createPlan(db, owner, { name: `باقة-${name}`, durationDays: 30, price: 100000 });
      await createSubscription(db, owner, { memberId: m.id, planId: p.id });
      await assignCardByBarcode(db, owner, { memberId: m.id, barcodeValue: barcode });
      const result = await recordCheckIn(db, reception, { barcode });
      expect(result.kind).toBe("success");
    }

    await checkInMember("سارة", "01000000001", "GYM-777001");
    await checkInMember("محمود", "01000000002", "GYM-777003");

    const rows = db.all<{ visit_no: string }>("SELECT visit_no FROM attendance ORDER BY checkin_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].visit_no).toMatch(/^(?:[A-Z0-9]{1,6}-)?ATT-\d{4}-\d{6}$/);
    expect(rows[0].visit_no).not.toBe(rows[1].visit_no);

    const hits = searchByDocNo(db, owner, rows[1].visit_no);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("attendance");
    expect(hits[0].memberName).toBe("محمود");
  });

  it("hides soft-deleted attendance from lookups", async () => {
    const member = await createMember(db, owner, { fullName: "سارة", phone: "01000000001" });
    const plan = await createPlan(db, owner, { name: "باقة", durationDays: 30, price: 100000 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, owner, { memberId: member.id, barcodeValue: "GYM-777002" });
    await recordCheckIn(db, reception, { barcode: "GYM-777002" });
    const row = db.first<{ id: string; visit_no: string }>("SELECT id, visit_no FROM attendance LIMIT 1")!;

    db.run("UPDATE attendance SET deleted_at = '2026-10-02 10:00' WHERE id = ?", [row.id]);
    expect(searchByDocNo(db, owner, row.visit_no)).toHaveLength(0);
  });

  it("finds an operation from a bare sequence the customer reads out", async () => {
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 1000, "سبب");
    const refundNo = docNo("payment_refunds", "refund_no", firstRefundId());

    const digits = refundNo.split("-").pop()!;
    expect(searchByDocNo(db, owner, digits).some((h) => h.docNo === refundNo)).toBe(true);
  });

  it("matches case-insensitively so a spoken lower-case number still hits", async () => {
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 1000, "سبب");
    const refundNo = docNo("payment_refunds", "refund_no", firstRefundId());

    const hits = searchByDocNo(db, owner, refundNo.toLowerCase());
    expect(hits).toHaveLength(1);
    expect(hits[0].docNo).toBe(refundNo);
  });

  it("returns nothing for an unknown number instead of throwing", async () => {
    expect(searchByDocNo(db, owner, "RCP-2026-999999")).toEqual([]);
  });

  it("rejects an empty query and a caller without reports.view", async () => {
    expect(() => searchByDocNo(db, owner, "   ")).toThrow();
    expect(() => searchByDocNo(db, reception, "RCP-2026-000001")).toThrow(errForbidden());
  });

  it("prefixes new numbers with the branch so synced branches cannot collide", async () => {
    db.run("UPDATE branch_info SET branch_prefix = 'B1'");
    const { payment } = await paidSubscription();
    await refundPayment(db, owner, payment.id, 1000, "سبب");
    const refundNo = docNo("payment_refunds", "refund_no", firstRefundId());

    // Same convention as member codes (B1-MEM-000001).
    expect(refundNo).toMatch(/^B1-RFD-\d{4}-\d{6}$/);

    // Reading it back without the branch token still resolves.
    const hits = searchByDocNo(db, owner, refundNo.replace(/^B1-/, ""));
    expect(hits).toHaveLength(1);
    expect(hits[0].docNo).toBe(refundNo);
  });

  it("returns exactly one row for a complete number even when kinds share a sequence", async () => {
    // POS and SDP keep separate counters that both start at 1, so the trailing
    // sequence exists on both. A complete number must resolve to exactly that
    // row; only a bare sequence is allowed to fan out.
    const { createProduct, createSale, repayStoreDebt } = await import("@/core/services/store.service");
    const member = await createMember(db, owner, { fullName: "محمود", phone: "01000000009" });
    const product = await createProduct(db, owner, {
      name: "مياه",
      costMinor: 500,
      priceMinor: 1000,
      stockQty: 50,
    });
    const sale = await createSale(db, owner, {
      memberId: member.id,
      methodCode: "cash",
      isCredit: true,
      items: [{ productId: product.id, qty: 2 }],
    });

    const debt = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [sale.id])!;
    await repayStoreDebt(db, owner, { debtId: debt.id, amountMinor: 1500, methodCode: "cash" });

    const saleNo = docNo("store_sales", "sale_no", sale.id);
    const debtNo = docNo(
      "store_debt_payments",
      "payment_no",
      String(db.scalar("SELECT id FROM store_debt_payments LIMIT 1")),
    );
    expect(saleNo.split("-").pop()).toBe(debtNo.split("-").pop());

    // Complete numbers -> exactly one row each.
    expect(searchByDocNo(db, owner, debtNo)).toHaveLength(1);
    expect(searchByDocNo(db, owner, saleNo)).toHaveLength(1);

    // Bare sequence -> both, each labelled: the useful answer when a customer
    // reads out only digits.
    const seq = debtNo.split("-").pop()!;
    const byDigits = searchByDocNo(db, owner, seq);
    expect(byDigits.map((h) => h.kind).sort()).toEqual(["store_debt_payment", "store_sale"]);
  });

  it("resolves a store-debt repayment to its member through the debt", async () => {
    const { createProduct, createSale, repayStoreDebt } = await import("@/core/services/store.service");
    const member = await createMember(db, owner, { fullName: "محمود", phone: "01000000009" });
    const product = await createProduct(db, owner, {
      name: "مياه",
      costMinor: 500,
      priceMinor: 1000,
      stockQty: 50,
    });
    const sale = await createSale(db, owner, {
      memberId: member.id,
      methodCode: "cash",
      isCredit: true,
      items: [{ productId: product.id, qty: 2 }],
    });
    const debt = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [sale.id])!;
    await repayStoreDebt(db, owner, { debtId: debt.id, amountMinor: 1500, methodCode: "cash" });

    const debtNo = docNo(
      "store_debt_payments",
      "payment_no",
      String(db.scalar("SELECT id FROM store_debt_payments LIMIT 1")),
    );
    expect(debtNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?SDP-\d{4}-\d{6}$/);

    const hits = searchByDocNo(db, owner, debtNo);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("store_debt_payment");
    expect(hits[0].memberName).toBe("محمود");
    expect(hits[0].amountMinor).toBe(1500);
    expect(hits[0].route).toBe("/store");
  });
});
