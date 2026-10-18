import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { listMemberDebts, payMemberDebt } from "@/core/services/debts.service";
import { createProduct, createSale } from "@/core/services/store.service";
import { AppError } from "@/core/errors";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

describe("Debts Service", () => {
  it("consolidates multi-installment subscription payments into a single accurate debt item", async () => {
    const member = await createMember(db, owner, {
      fullName: "ياسين محمد قطب",
      phone: "01288536381",
    });

    const plan = await createPlan(db, owner, {
      name: "اشتراك شهري 500",
      kind: "time",
      durationDays: 30,
      price: 500,
    });

    // Create subscription for 500 EGP (no upfront payment)
    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    // 1. Initial state: owes 500 EGP
    let debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(1);
    expect(debts.totalDebtMinor).toBe(50000);
    expect(debts.items[0]).toMatchObject({
      debtId: sub.id,
      debtType: "subscription",
      memberId: member.id,
      totalAmountMinor: 50000,
      paidAmountMinor: 0,
      remainingAmountMinor: 50000,
      status: "pending",
    });

    // 2. First installment: paid 250 EGP
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50000,
      paidAmountMinor: 25000,
      methodCode: "cash",
      notes: "الدفعة الأولى 250",
    });

    debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(1);
    expect(debts.totalDebtMinor).toBe(25000);
    expect(debts.items[0]).toMatchObject({
      debtId: sub.id,
      debtType: "subscription",
      paidAmountMinor: 25000,
      remainingAmountMinor: 25000,
      status: "partial",
    });

    // 3. Second installment: paid 200 EGP
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 25000,
      paidAmountMinor: 20000,
      methodCode: "cash",
      notes: "الدفعة الثانية 200",
    });

    debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(1);
    expect(debts.totalDebtMinor).toBe(5000);
    expect(debts.items[0]).toMatchObject({
      debtId: sub.id,
      debtType: "subscription",
      paidAmountMinor: 45000,
      remainingAmountMinor: 5000,
      status: "partial",
    });

    // 4. Third installment: paid remaining 50 EGP
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 5000,
      paidAmountMinor: 5000,
      methodCode: "cash",
      notes: "الدفعة الثالثة 50",
    });

    // 5. Subscription is 100% paid: phantom debt must disappear completely!
    debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(0);
    expect(debts.totalDebtMinor).toBe(0);
    expect(debts.items).toHaveLength(0);
  });

  it("handles paying subscription debt directly via payMemberDebt", async () => {
    const member = await createMember(db, owner, {
      fullName: "محمد أحمد",
      phone: "01011112222",
    });

    const plan = await createPlan(db, owner, {
      name: "خطة 300",
      kind: "time",
      durationDays: 30,
      price: 300,
    });

    const sub = await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    // Initial partial payment of 100 EGP
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 30000,
      paidAmountMinor: 10000,
      methodCode: "cash",
    });

    let debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(1);
    expect(debts.items[0].remainingAmountMinor).toBe(20000);

    // Pay 150 EGP via payMemberDebt
    const res1 = payMemberDebt(db, owner, {
      debtType: "subscription",
      debtId: sub.id,
      amountMinor: 15000,
      methodCode: "cash",
      notes: "سداد من شاشة الديون",
    });
    expect(res1.success).toBe(true);
    expect(res1.paidMinor).toBe(15000);
    expect(res1.remainingMinor).toBe(5000);

    // Verify ledger entry
    const ledger = db.all<{ amount_minor: number; direction: number }>(
      "SELECT amount_minor, direction FROM financial_ledger WHERE ref_table = 'payments' AND member_id = ?",
      [member.id],
    );
    expect(ledger).toHaveLength(2); // 10000 initial + 15000 debt payment

    // Verify overpay throws
    expect(() =>
      payMemberDebt(db, owner, {
        debtType: "subscription",
        debtId: sub.id,
        amountMinor: 6000,
        methodCode: "cash",
      }),
    ).toThrow(AppError);

    // Pay remaining 50 EGP
    const res2 = payMemberDebt(db, owner, {
      debtType: "subscription",
      debtId: sub.id,
      amountMinor: 5000,
      methodCode: "cash",
    });
    expect(res2.success).toBe(true);
    expect(res2.remainingMinor).toBe(0);

    // Debts list should now be completely empty
    debts = listMemberDebts(db, owner);
    expect(debts.total).toBe(0);
    expect(debts.items).toHaveLength(0);

    // Paying again when fully paid throws
    expect(() =>
      payMemberDebt(db, owner, {
        debtType: "subscription",
        debtId: sub.id,
        amountMinor: 1000,
        methodCode: "cash",
      }),
    ).toThrow(AppError);
  });

  it("handles store credit debts and settlements via payMemberDebt", async () => {
    const member = await createMember(db, owner, {
      fullName: "علي حسن",
      phone: "01122223333",
    });

    const prod = await createProduct(db, owner, {
      name: "مشروب بروتين",
      priceMinor: 5000,
      costMinor: 3000,
      stockQty: 10,
    });

    // Credit sale of 50 EGP
    const sale = await createSale(db, owner, {
      memberId: member.id,
      items: [{ productId: prod.id, qty: 1 }],
      isCredit: true,
      methodCode: "cash",
      paidAmountMinor: 0,
    });

    const storeDebtRow = db.first<{ id: string }>(
      "SELECT id FROM store_debts WHERE sale_id = ?",
      [sale.id],
    )!;

    // Check debts list
    let debts = listMemberDebts(db, owner, { debtType: "store" });
    expect(debts.total).toBe(1);
    expect(debts.items[0]).toMatchObject({
      debtId: storeDebtRow.id,
      debtType: "store",
      totalAmountMinor: 5000,
      paidAmountMinor: 0,
      remainingAmountMinor: 5000,
      status: "pending",
    });

    // Pay partial 30 EGP via payMemberDebt
    const res = payMemberDebt(db, owner, {
      debtType: "store",
      debtId: storeDebtRow.id,
      amountMinor: 3000,
      methodCode: "cash",
    });
    expect(res.success).toBe(true);
    expect(res.remainingMinor).toBe(2000);

    // Verify store_debt_payments row was recorded
    const repayments = db.all<{ amount_minor: number }>(
      "SELECT amount_minor FROM store_debt_payments WHERE debt_id = ?",
      [storeDebtRow.id],
    );
    expect(repayments).toHaveLength(1);
    expect(repayments[0].amount_minor).toBe(3000);

    // Verify store box ledger entry
    const storeLedger = db.first<{ box: string; amount_minor: number }>(
      "SELECT box, amount_minor FROM financial_ledger WHERE ref_table = 'store_debts' ORDER BY created_at DESC LIMIT 1",
    );
    expect(storeLedger?.box).toBe("store");
    expect(storeLedger?.amount_minor).toBe(3000);

    // Pay remaining 20 EGP
    payMemberDebt(db, owner, {
      debtType: "store",
      debtId: storeDebtRow.id,
      amountMinor: 2000,
      methodCode: "cash",
    });

    debts = listMemberDebts(db, owner, { debtType: "store" });
    expect(debts.total).toBe(0);
  });

  it("filters debts by search query, status, and debtType", async () => {
    const memberA = await createMember(db, owner, {
      fullName: "أحمد حسام",
      phone: "01099998888",
    });
    const memberB = await createMember(db, owner, {
      fullName: "محمود سعيد",
      phone: "01177776666",
    });

    const plan = await createPlan(db, owner, {
      name: "خطة شهرية",
      kind: "time",
      durationDays: 30,
      price: 400,
    });

    // Sub A: completely unpaid (pending)
    await createSubscription(db, owner, {
      memberId: memberA.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    // Sub B: partially paid (partial)
    const subB = await createSubscription(db, owner, {
      memberId: memberB.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });
    await recordPayment(db, owner, {
      memberId: memberB.id,
      subscriptionId: subB.id,
      baseAmountMinor: 40000,
      paidAmountMinor: 15000,
      methodCode: "cash",
    });

    // Test search by name
    const searchRes = listMemberDebts(db, owner, { search: "أحمد" });
    expect(searchRes.total).toBe(1);
    expect(searchRes.items[0].memberId).toBe(memberA.id);

    // Test filter by status: pending
    const pendingRes = listMemberDebts(db, owner, { status: "pending" });
    expect(pendingRes.total).toBe(1);
    expect(pendingRes.items[0].memberId).toBe(memberA.id);

    // Test filter by status: partial
    const partialRes = listMemberDebts(db, owner, { status: "partial" });
    expect(partialRes.total).toBe(1);
    expect(partialRes.items[0].memberId).toBe(memberB.id);

    // Test filter by debtType
    const subOnly = listMemberDebts(db, owner, { debtType: "subscription" });
    expect(subOnly.total).toBe(2);

    const storeOnly = listMemberDebts(db, owner, { debtType: "store" });
    expect(storeOnly.total).toBe(0);
  });

  it("enforces department isolation on debts listing and payment", async () => {
    const { createUser } = await import("@/core/services/users.service");
    const menRecep = buildActor(
      await createUser(db, owner, {
        username: "men-recep",
        password: "Recep@2026",
        fullName: "موظف رجال",
        roleId: "reception",
        department: "men",
      }),
    );

    const menMember = await createMember(db, owner, {
      fullName: "عضو رجال",
      phone: "01055554444",
      department: "men",
    });

    const womenMember = await createMember(db, owner, {
      fullName: "عضوة سيدات",
      phone: "01033332222",
      department: "women",
    });

    const plan = await createPlan(db, owner, {
      name: "خطة عامة",
      kind: "time",
      durationDays: 30,
      price: 200,
    });

    const subMen = await createSubscription(db, owner, {
      memberId: menMember.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    const subWomen = await createSubscription(db, owner, {
      memberId: womenMember.id,
      planId: plan.id,
      startDate: "2026-10-01",
    });

    // Men reception sees only men member's debt
    const menDebts = listMemberDebts(db, menRecep);
    expect(menDebts.total).toBe(1);
    expect(menDebts.items[0].memberId).toBe(menMember.id);

    // Men reception cannot pay women member's debt
    expect(() =>
      payMemberDebt(db, menRecep, {
        debtType: "subscription",
        debtId: subWomen.id,
        amountMinor: 5000,
        methodCode: "cash",
      }),
    ).toThrow();

    // Men reception can pay men member's debt
    const payRes = payMemberDebt(db, menRecep, {
      debtType: "subscription",
      debtId: subMen.id,
      amountMinor: 10000,
      methodCode: "cash",
    });
    expect(payRes.success).toBe(true);
    expect(payRes.remainingMinor).toBe(10000);
  });
});
