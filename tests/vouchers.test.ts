import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment, refundPayment } from "@/core/services/payments.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import { openCashSession, closeCashSession } from "@/core/services/cash-session.service";
import { generateOperationVoucher } from "@/core/services/vouchers.service";
import { searchByDocNo } from "@/core/services/document-numbers.service";
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
      gymName: "جيم النوردة",
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

async function paidPayment(amountMinor = 150000) {
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
  return { member, payment };
}

const asPdf = (base64: string) => Buffer.from(base64, "base64");

describe("operation vouchers", () => {
  it("prints a refund voucher carrying the refund reference number", async () => {
    const { payment } = await paidPayment();
    await refundPayment(db, owner, payment.id, 25000, "طلب العميل");
    const refundId = String(db.scalar("SELECT id FROM payment_refunds LIMIT 1"));

    const v = await generateOperationVoucher(db, owner, "refund", refundId);
    expect(v.docNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?RFD-\d{4}-\d{6}$/);
    expect(v.fileName).toBe(`voucher-${v.docNo}.pdf`);
    const bytes = asPdf(v.base64);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("also mints the original receipt number so both documents reconcile", async () => {
    const { payment } = await paidPayment();
    await refundPayment(db, owner, payment.id, 2500, "سبب");
    const refundId = String(db.scalar("SELECT id FROM payment_refunds LIMIT 1"));
    // Before printing anything, the receipt number does not exist yet.
    expect(db.scalar("SELECT receipt_no FROM payments WHERE id = ?", [payment.id])).toBeNull();

    await generateOperationVoucher(db, owner, "refund", refundId);
    const receiptNo = String(db.scalar("SELECT receipt_no FROM payments WHERE id = ?", [payment.id]));
    expect(receiptNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?RCP-\d{4}-\d{6}$/);
    // ...and it is now findable in the lookup.
    expect(searchByDocNo(db, owner, receiptNo)).toHaveLength(1);
  });

  it("archives each voucher in pdf_deliveries", async () => {
    const { payment } = await paidPayment();
    await refundPayment(db, owner, payment.id, 1000, "سبب");
    const refundId = String(db.scalar("SELECT id FROM payment_refunds LIMIT 1"));
    await generateOperationVoucher(db, owner, "refund", refundId);

    const row = db.first<{ doc_type: string; ref_table: string; file_hash: string; file_size: number }>(
      "SELECT doc_type, ref_table, file_hash, file_size FROM pdf_deliveries WHERE ref_id = ?",
      [refundId],
    );
    expect(row?.doc_type).toBe("refund_voucher");
    expect(row?.ref_table).toBe("payment_refunds");
    expect(Number(row?.file_size)).toBeGreaterThan(2000);
    expect(row?.file_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prints a cash-closing voucher with the closing reference number", async () => {
    const session = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 50000 });
    await closeCashSession(db, owner, session.id, 48000, "فرق نقدي");

    const v = await generateOperationVoucher(db, owner, "cash_closing", session.id);
    expect(v.docNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?CS-\d{4}-\d{6}$/);
    expect(asPdf(v.base64).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("prints an attendance voucher", async () => {
    const member = await createMember(db, owner, { fullName: "سارة", phone: "01000000007" });
    const plan = await createPlan(db, owner, { name: "باقة", durationDays: 30, price: 100000 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, owner, { memberId: member.id, barcodeValue: "GYM-888001" });
    await recordCheckIn(db, reception, { barcode: "GYM-888001" });
    const attendanceId = String(db.scalar("SELECT id FROM attendance LIMIT 1"));

    const v = await generateOperationVoucher(db, owner, "attendance", attendanceId);
    expect(v.docNo).toMatch(/^(?:[A-Z0-9]{1,6}-)?ATT-\d{4}-\d{6}$/);
    expect(asPdf(v.base64).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("refuses a caller without the permission for that operation", async () => {
    // Attendance vouchers are gated on reports.view, which reception lacks
    // (the same permission that gates the reference-number lookup).
    const member = await createMember(db, owner, { fullName: "سارة", phone: "01000000008" });
    const plan = await createPlan(db, owner, { name: "باقة", durationDays: 30, price: 100000 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, owner, { memberId: member.id, barcodeValue: "GYM-888002" });
    await recordCheckIn(db, reception, { barcode: "GYM-888002" });
    const attendanceId = String(db.scalar("SELECT id FROM attendance LIMIT 1"));

    await expect(generateOperationVoucher(db, reception, "attendance", attendanceId)).rejects.toThrow(
      errForbidden(),
    );
    // The owner can.
    await expect(generateOperationVoucher(db, owner, "attendance", attendanceId)).resolves.toBeTruthy();
  });

  it("refuses to print a closing that never happened", async () => {
    const session = await openCashSession(db, owner, { box: "gym", openingBalanceMinor: 1000 });
    await expect(generateOperationVoucher(db, owner, "cash_closing", session.id)).rejects.toThrow();
  });
});
