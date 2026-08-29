import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember, setMemberStatus } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import {
  getPaymentById,
  getSubscriptionBalance,
  listPayments,
  listActiveMethods,
  recordPayment,
  refundPayment,
  voidPayment,
} from "@/core/services/payments.service";
import {
  createCategory,
  createExpense,
  listCategories,
  listExpenses,
  setCategoryActive,
  updateExpense,
  voidExpense,
} from "@/core/services/expenses.service";
import {
  closeCashSession,
  getOpenSessionTotals,
  listCashSessions,
  openCashSession,
} from "@/core/services/cash-session.service";
import { getFinanceOverview, getMemberOutstanding, listLedgerEntries } from "@/core/services/finance.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import { createUser } from "@/core/services/users.service";
import { AppError } from "@/core/errors";
import { todayKey } from "@/core/dates";
import type { ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

function syncAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected function to throw an AppError");
}

let db: Db;
let owner: ReturnType<typeof buildActor>;
let manager: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;
let trainer: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  manager = buildActor(
    await createUser(db, owner, {
      username: "manager",
      password: "Manage@2026",
      fullName: "المدير",
      roleId: "manager",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "الاستقبال",
      roleId: "reception",
    }),
  );
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "المدرب",
      roleId: "trainer",
    }),
  );
});

async function newMember(name = "عضو مالي") {
  return createMember(db, owner, {
    fullName: `${name}-${Math.floor(Math.random() * 1e9)}`,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function newSubscription(priceMajor: number, planName = "شهري") {
  const m = await newMember();
  const plan = await createPlan(db, owner, {
    name: `${planName}-${Math.floor(Math.random() * 1e9)}`,
    durationDays: 30,
    price: priceMajor,
  });
  const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
  return { member: m, plan, sub };
}

function stampToday(hour = 10) {
  return `${todayKey()} ${String(hour).padStart(2, "0")}:00:00`;
}

async function ledgerFor(refTable: string) {
  return listLedgerEntries(db, owner, { pageSize: 200 }).items.filter((e) => e.refTable === refTable);
}

describe("payments — full and partial", () => {
  it("records a full payment with correct split, ledger entry and audit trail", async () => {
    const { member, sub } = await newSubscription(1000);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 100_000,
      paidAmountMinor: 100_000,
      methodCode: "cash",
    });
    expect(payment.status).toBe("paid");
    expect(payment.netAmountMinor).toBe(100_000);
    expect(payment.paidAmountMinor).toBe(100_000);
    expect(payment.remainingAmountMinor).toBe(0);

    const entries = await ledgerFor("payments");
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe(1);
    expect(entries[0].amountMinor).toBe(100_000);
    expect(entries[0].methodCode).toBe("cash");

    const audits = db.all<{ action: string }>(
      "SELECT action FROM audit_logs WHERE entity_id = ? AND entity_type = 'payment'",
      [payment.id],
    );
    expect(audits.map((a) => a.action)).toContain("PAYMENT_RECORDED");
  });

  it("applies the spec example: 1000 EGP, 100 discount, 600 paid, 300 remaining", async () => {
    const { member, sub } = await newSubscription(1000);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 100_000,
      discountKind: "fixed",
      discountValue: 10_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });
    expect(payment.baseAmountMinor).toBe(100_000);
    expect(payment.discountAmountMinor).toBe(10_000);
    expect(payment.netAmountMinor).toBe(90_000);
    expect(payment.paidAmountMinor).toBe(60_000);
    expect(payment.remainingAmountMinor).toBe(30_000);
    expect(payment.status).toBe("partial");

    const audits = db
      .all<{ action: string }>(
        "SELECT action FROM audit_logs WHERE entity_id = ? AND entity_type = 'payment'",
        [payment.id],
      )
      .map((a) => a.action);
    expect(audits).toContain("PAYMENT_DISCOUNT_APPLIED");
  });

  it("tracks subscription balance in minor units across multiple partial payments", async () => {
    const { member, sub } = await newSubscription(1000);
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 100_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });
    let balance = getSubscriptionBalance(db, owner, sub.id);
    expect(balance.priceMinor).toBe(100_000);
    expect(balance.paidMinor).toBe(60_000);
    expect(balance.remainingMinor).toBe(40_000);

    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 40_000,
      paidAmountMinor: 40_000,
      methodCode: "bank_card",
    });
    balance = getSubscriptionBalance(db, owner, sub.id);
    expect(balance.remainingMinor).toBe(0);
  });

  it("rejects overpayment, allows zero-paid balance records, and blocks fully-zero records", async () => {
    const { member } = await newSubscription(500);
    await expect(
      recordPayment(db, owner, {
        memberId: member.id,
        baseAmountMinor: 50_000,
        paidAmountMinor: 60_000,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.overpay" });

    const balanceOnly = await recordPayment(db, owner, {
      memberId: member.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 0,
      methodCode: "cash",
    });
    expect(balanceOnly.status).toBe("partial");
    expect(balanceOnly.paidAmountMinor).toBe(0);
    expect(balanceOnly.remainingAmountMinor).toBe(50_000);
    expect((await ledgerFor("payments")).filter((e) => e.entryType === "payment")).toHaveLength(0);

    const comped = await newSubscription(200);
    await expect(
      recordPayment(db, owner, {
        memberId: comped.member.id,
        baseAmountMinor: 20_000,
        discountKind: "percent",
        discountValue: 100,
        paidAmountMinor: 0,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.zeroPayment" });
  });

  it("rejects negative or non-integer amounts", async () => {
    const { member } = await newSubscription(300);
    await expect(
      recordPayment(db, owner, {
        memberId: member.id,
        baseAmountMinor: -5,
        paidAmountMinor: 1,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      recordPayment(db, owner, {
        memberId: member.id,
        baseAmountMinor: Number.NaN,
        paidAmountMinor: 1,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("enforces duplicate client_ref protection (idempotency)", async () => {
    const { member } = await newSubscription(400);
    const input = {
      memberId: member.id,
      baseAmountMinor: 40_000,
      paidAmountMinor: 40_000,
      methodCode: "cash",
      clientRef: "offline-op-777",
    };
    await recordPayment(db, owner, input);
    await expect(recordPayment(db, owner, input)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "errors.finance.duplicateTransaction",
    });
  });

  it("validates the payment method exists and is active", async () => {
    const { member } = await newSubscription(300);
    await expect(
      recordPayment(db, owner, {
        memberId: member.id,
        baseAmountMinor: 30_000,
        paidAmountMinor: 30_000,
        methodCode: "does-not-exist",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.methodNotFound" });

    db.run("UPDATE payment_methods SET is_active = 0 WHERE code = 'transfer'");
    await expect(
      recordPayment(db, owner, {
        memberId: member.id,
        baseAmountMinor: 30_000,
        paidAmountMinor: 30_000,
        methodCode: "transfer",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.methodInactive" });
    expect(listActiveMethods(db).map((m) => m.code)).not.toContain("transfer");
  });

  it("rejects payments for archived members and mismatched subscriptions", async () => {
    const { sub } = await newSubscription(300);
    const stranger = await newMember("شخص آخر");

    await expect(
      recordPayment(db, owner, {
        memberId: stranger.id,
        subscriptionId: sub.id,
        baseAmountMinor: 30_000,
        paidAmountMinor: 30_000,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.subscriptionOwnerMismatch" });

    const archived = await newMember("عضو مؤرشف");
    await setMemberStatus(db, owner, archived.id, "archived");
    await expect(
      recordPayment(db, reception, {
        memberId: archived.id,
        baseAmountMinor: 30_000,
        paidAmountMinor: 30_000,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ messageKey: "errors.memberArchived" });
  });
});

describe("discounts", () => {
  it("applies a percentage discount correctly", async () => {
    const { member } = await newSubscription(800);
    const payment = await recordPayment(db, manager, {
      memberId: member.id,
      baseAmountMinor: 80_000,
      discountKind: "percent",
      discountValue: 25,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });
    expect(payment.discountAmountMinor).toBe(20_000);
    expect(payment.netAmountMinor).toBe(60_000);
    expect(payment.status).toBe("paid");
  });

  it("rejects invalid discounts: non-positive, out-of-range percent, fixed exceeding base", async () => {
    const { member } = await newSubscription(500);
    const base = { memberId: member.id, baseAmountMinor: 50_000, paidAmountMinor: 1, methodCode: "cash" };

    await expect(
      recordPayment(db, owner, { ...base, discountKind: "fixed", discountValue: 0 }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.discountMustBePositive" });
    await expect(
      recordPayment(db, owner, { ...base, discountKind: "percent", discountValue: 0 }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.discountMustBePositive" });
    await expect(
      recordPayment(db, owner, { ...base, discountKind: "percent", discountValue: 150 }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.discountPercentRange" });
    await expect(
      recordPayment(db, owner, { ...base, discountKind: "fixed", discountValue: 60_000 }),
    ).rejects.toMatchObject({ messageKey: "errors.finance.discountExceedsAmount" });
    await expect(
      recordPayment(db, owner, { ...base, discountKind: "fixed", discountValue: -100 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("blocks discounts for roles without payments.discount permission", async () => {
    const { member } = await newSubscription(500);
    await expect(
      recordPayment(db, reception, {
        memberId: member.id,
        baseAmountMinor: 50_000,
        discountKind: "fixed",
        discountValue: 5_000,
        paidAmountMinor: 45_000,
        methodCode: "cash",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("financial permissions", () => {
  it("lets reception record plain payments but not refunds, voids, expenses or reports", async () => {
    const { member, sub } = await newSubscription(300);
    const payment = await recordPayment(db, reception, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 30_000,
      methodCode: "cash",
    });
    expect(payment.status).toBe("paid");

    await expect(refundPayment(db, reception, payment.id, 1_000, "خطأ في التسجيل")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(voidPayment(db, reception, payment.id, "خطأ في التسجيل")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createExpense(db, reception, {
        categoryId: "cat-rent",
        amountMinor: 10_000,
        methodCode: "cash",
        description: "مصروف تجريبي",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(syncAppError(() => getPeriodReport(db, reception, todayKey(), todayKey())).code).toBe(
      "FORBIDDEN",
    );
  });

  it("hides payments entirely from roles without payments.view", async () => {
    expect(syncAppError(() => listPayments(db, trainer, {})).code).toBe("FORBIDDEN");
    const { sub } = await newSubscription(300);
    expect(syncAppError(() => getSubscriptionBalance(db, trainer, sub.id)).code).toBe("FORBIDDEN");
  });

  it("allows managers to refund one payment and void another", async () => {
    const first = await newSubscription(300);
    const refundable = await recordPayment(db, owner, {
      memberId: first.member.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 30_000,
      methodCode: "cash",
    });
    const refunded = await refundPayment(db, manager, refundable.id, 10_000, "عضو غادر النادي");
    expect(refunded.refundedAmountMinor).toBe(10_000);

    const second = await newSubscription(400);
    const voidable = await recordPayment(db, owner, {
      memberId: second.member.id,
      baseAmountMinor: 40_000,
      paidAmountMinor: 40_000,
      methodCode: "cash",
    });
    const voided = await voidPayment(db, manager, voidable.id, "إلغاء نهائي بعد الاتفاق");
    expect(voided.status).toBe("voided");
    expect(voided.voidedAt).toBeTruthy();
  });
});

describe("refunds", () => {
  it("performs partial then full refunds and flips status to refunded", async () => {
    const { member } = await newSubscription(600);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      baseAmountMinor: 60_000,
      paidAmountMinor: 60_000,
      methodCode: "bank_card",
    });

    const first = await refundPayment(db, owner, payment.id, 15_000, "خصم جزئي بالاتفاق");
    expect(first.refundedAmountMinor).toBe(15_000);
    expect(first.status).toBe("paid");

    const second = await refundPayment(db, owner, payment.id, 45_000, "استرداد كامل");
    expect(second.refundedAmountMinor).toBe(60_000);
    expect(second.status).toBe("refunded");

    const refunds = await ledgerFor("payment_refunds");
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.direction === -1)).toBe(true);
    expect(refunds.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(60_000);
  });

  it("rejects refunds exceeding the refundable amount, empty reasons, and voided targets", async () => {
    const { member } = await newSubscription(600);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      baseAmountMinor: 60_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });

    await expect(refundPayment(db, owner, payment.id, 60_001, "أكثر من المدفوع")).rejects.toMatchObject({
      messageKey: "errors.finance.refundExceedsPaid",
    });
    await expect(refundPayment(db, owner, payment.id, 0, "صفر")).rejects.toMatchObject({
      messageKey: "errors.finance.invalidRefundAmount",
    });
    await expect(refundPayment(db, owner, payment.id, 1_000, "لا")).rejects.toMatchObject({
      messageKey: "errors.finance.refundReasonRequired",
    });

    await voidPayment(db, owner, payment.id, "إلغاء قبل الاسترداد");
    await expect(refundPayment(db, owner, payment.id, 1_000, "بعد الإلغاء")).rejects.toMatchObject({
      messageKey: "errors.finance.paymentVoided",
    });
  });
});

describe("voids and reversals", () => {
  it("voids a payment, writes a reversal ledger entry and blocks double void", async () => {
    const { member } = await newSubscription(700);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      baseAmountMinor: 70_000,
      paidAmountMinor: 70_000,
      methodCode: "cash",
    });

    const voided = await voidPayment(db, owner, payment.id, "تم تسجيله بالخطأ");
    expect(voided.status).toBe("voided");
    expect(voided.voidedAt).toBeTruthy();

    const reversals = (await ledgerFor("payments")).filter((e) => e.entryType === "reversal_payment");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].direction).toBe(-1);
    expect(reversals[0].amountMinor).toBe(70_000);

    await expect(voidPayment(db, owner, payment.id, "إلغاء مرة أخرى")).rejects.toMatchObject({
      messageKey: "errors.finance.alreadyVoided",
    });
  });

  it("blocks voiding a payment that already has refunds", async () => {
    const { member } = await newSubscription(600);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      baseAmountMinor: 60_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });
    await refundPayment(db, owner, payment.id, 10_000, "استرداد جزئي");
    await expect(voidPayment(db, owner, payment.id, "محاولة إلغاء")).rejects.toMatchObject({
      messageKey: "errors.finance.voidWithRefunds",
    });
  });

  it("excludes voided payments from subscription balance", async () => {
    const { member, sub } = await newSubscription(500);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
    });
    expect(getSubscriptionBalance(db, owner, sub.id).remainingMinor).toBe(0);
    await voidPayment(db, owner, payment.id, "خطأ إداري");
    expect(getSubscriptionBalance(db, owner, sub.id)).toMatchObject({
      paidMinor: 0,
      remainingMinor: 50_000,
    });
  });
});

describe("expenses", () => {
  it("creates an expense with a ledger entry and audit record", async () => {
    const expense = await createExpense(db, owner, {
      categoryId: "cat-rent",
      amountMinor: 50_000,
      methodCode: "cash",
      description: "إيجار المقر لشهر أغسطس",
    });
    expect(expense.categoryNameAr).toBe("إيجار");
    expect(expense.methodLabel).toBe("نقدي");
    expect(expense.status).toBe("active");

    const entries = await ledgerFor("expenses");
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe(-1);
    expect(entries[0].entryType).toBe("expense");

    const audits = db
      .all<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'expense'")
      .map((a) => a.action);
    expect(audits).toContain("EXPENSE_CREATED");
  });

  it("validates amount, category, description and date", async () => {
    await expect(
      createExpense(db, owner, {
        categoryId: "cat-rent",
        amountMinor: 0,
        methodCode: "cash",
        description: "وصف صالح",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createExpense(db, owner, {
        categoryId: "missing-cat",
        amountMinor: 10_000,
        methodCode: "cash",
        description: "وصف صالح",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createExpense(db, owner, {
        categoryId: "cat-rent",
        amountMinor: 10_000,
        methodCode: "cash",
        description: "ab",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createExpense(db, owner, {
        categoryId: "cat-rent",
        amountMinor: 10_000,
        methodCode: "cash",
        description: "وصف صالح",
        expenseDate: "2099-01-01",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("updates an expense and records a compensating ledger adjustment", async () => {
    const expense = await createExpense(db, owner, {
      categoryId: "cat-electricity",
      amountMinor: 12_000,
      methodCode: "cash",
      description: "فاتورة كهرباء",
    });
    const updated = await updateExpense(db, owner, expense.id, {
      categoryId: "cat-electricity",
      amountMinor: 18_000,
      methodCode: "cash",
      description: "فاتورة كهرباء معدلة",
    });
    expect(updated.amountMinor).toBe(18_000);

    const entries = await ledgerFor("expenses");
    expect(entries.some((e) => e.amountMinor === 6_000 && e.direction === -1)).toBe(true);

    const audits = db
      .all<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'expense'")
      .map((a) => a.action);
    expect(audits).toContain("EXPENSE_UPDATED");
  });

  it("voids an expense with a reversal entry and blocks re-voiding", async () => {
    const expense = await createExpense(db, owner, {
      categoryId: "cat-water",
      amountMinor: 5_000,
      methodCode: "cash",
      description: "فاتورة مياه",
    });
    const voided = await voidExpense(db, owner, expense.id, "مسجل بالخطأ مرتين");
    expect(voided.status).toBe("voided");

    const reversals = (await ledgerFor("expenses")).filter((e) => e.entryType === "reversal_expense");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].direction).toBe(1);

    await expect(voidExpense(db, owner, expense.id, "سبب آخر طويل")).rejects.toMatchObject({
      messageKey: "errors.finance.alreadyVoided",
    });
  });

  it("filters expenses by category, status and amount", async () => {
    await createExpense(db, owner, {
      categoryId: "cat-rent",
      amountMinor: 90_000,
      methodCode: "cash",
      description: "إيجار كبير",
    });
    const small = await createExpense(db, owner, {
      categoryId: "cat-cleaning",
      amountMinor: 3_000,
      methodCode: "cash",
      description: "مستلزمات نظافة",
    });
    await voidExpense(db, owner, small.id, "لم يكن مصروفًا فعليًا");

    expect(listExpenses(db, owner, { categoryId: "cat-rent" }).total).toBe(1);
    expect(listExpenses(db, owner, { status: "voided" }).items[0].id).toBe(small.id);
    expect(listExpenses(db, owner, { minAmountMinor: 50_000 }).total).toBe(1);
    expect(listExpenses(db, owner, { maxAmountMinor: 10_000, status: "active" }).total).toBe(0);
  });

  it("manages categories safely: no duplicates, no deletion while referenced", async () => {
    const created = await createCategory(db, owner, "بقالة النادي");
    expect(created.isActive).toBe(true);

    expect(syncAppError(() => createCategory(db, owner, "بقالة النادي")).messageKey).toBe(
      "errors.finance.categoryExists",
    );

    const expense = await createExpense(db, owner, {
      categoryId: created.id,
      amountMinor: 4_000,
      methodCode: "cash",
      description: "مشتريات بقالة",
    });
    expect(syncAppError(() => setCategoryActive(db, owner, created.id, false)).messageKey).toBe(
      "errors.finance.categoryInUse",
    );

    await voidExpense(db, owner, expense.id, "تصحيح تسجيل");
    setCategoryActive(db, owner, created.id, false);
    const retired = listCategories(db).find((c) => c.id === created.id);
    expect(retired?.isActive).toBe(false);
    expect(listCategories(db, false).some((c) => c.id === created.id)).toBe(false);

    const historical = db.first<{ id: string }>(
      "SELECT id FROM expenses WHERE category_id = ?",
      [created.id],
    );
    expect(historical?.id).toBe(expense.id);
  });
});

describe("cash sessions", () => {
  it("opens exactly one session at a time and rejects invalid opening balances", async () => {
    const session = await openCashSession(db, reception, { openingBalanceMinor: 50_000 });
    expect(session.status).toBe("open");
    expect(session.openingBalanceMinor).toBe(50_000);

    await expect(openCashSession(db, reception, { openingBalanceMinor: 1_000 })).rejects.toMatchObject({
      messageKey: "errors.finance.sessionAlreadyOpen",
    });
    await expect(openCashSession(db, reception, { openingBalanceMinor: -1 })).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const audits = db
      .all<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'cash_session'")
      .map((a) => a.action);
    expect(audits).toContain("CASH_SESSION_OPENED");
  });

  it("computes expected closing from opening balance plus cash in minus cash out only", async () => {
    await openCashSession(db, reception, { openingBalanceMinor: 50_000 });
    const { member, sub } = await newSubscription(200);
    await recordPayment(db, reception, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 20_000,
      paidAmountMinor: 20_000,
      methodCode: "cash",
    });
    await createExpense(db, owner, {
      categoryId: "cat-supplies",
      amountMinor: 5_000,
      methodCode: "cash",
      description: "مناشف ومستلزمات",
    });
    await recordPayment(db, reception, {
      memberId: (await newMember()).id,
      baseAmountMinor: 99_00,
      paidAmountMinor: 99_00,
      methodCode: "bank_card",
    });

    const totals = getOpenSessionTotals(db, reception)!;
    expect(totals.cashInMinor).toBe(20_000);
    expect(totals.cashOutMinor).toBe(5_000);
    expect(totals.expectedMinor).toBe(65_000);
  });

  it("closes with zero difference and records no discrepancy audit", async () => {
    const session = await openCashSession(db, reception, { openingBalanceMinor: 50_000 });
    const result = await closeCashSession(db, reception, session.id, 50_000, "يوم سليم");
    expect(result.status).toBe("closed");
    expect(result.differenceMinor).toBe(0);
    expect(result.cashInMinor).toBe(0);
    expect(result.cashOutMinor).toBe(0);

    const actions = db
      .all<{ action: string }>("SELECT action FROM audit_logs WHERE entity_type = 'cash_session'")
      .map((a) => a.action);
    expect(actions).toContain("CASH_SESSION_CLOSED");
    expect(actions).not.toContain("CASH_DISCREPANCY");

    await expect(closeCashSession(db, reception, session.id, 50_000)).rejects.toMatchObject({
      messageKey: "errors.finance.sessionAlreadyClosed",
    });
  });

  it("stores cash discrepancies permanently and never hides them", async () => {
    const session = await openCashSession(db, reception, { openingBalanceMinor: 50_000 });
    const { member } = await newSubscription(150);
    await recordPayment(db, reception, {
      memberId: member.id,
      baseAmountMinor: 15_000,
      paidAmountMinor: 15_000,
      methodCode: "cash",
    });

    const expected = 65_000;
    const counted = 63_250;
    const result = await closeCashSession(db, reception, session.id, counted, "نقص غير مفهوم");
    expect(result.expectedClosingMinor).toBe(expected);
    expect(result.countedClosingMinor).toBe(counted);
    expect(result.differenceMinor).toBe(counted - expected);

    const stored = db.first<{ difference_minor: number }>(
      "SELECT difference_minor FROM cash_sessions WHERE id = ?",
      [session.id],
    );
    expect(Number(stored?.difference_minor)).toBe(-1_750);

    const discrepancy = db.first<{ metadata: string }>(
      "SELECT metadata FROM audit_logs WHERE entity_type = 'cash_session' AND action = 'CASH_DISCREPANCY' AND entity_id = ?",
      [session.id],
    );
    expect(discrepancy).not.toBeNull();
    expect(JSON.parse(discrepancy!.metadata)).toMatchObject({ differenceMinor: -1_750 });
  });

  it("enforces cash permissions: reception can open/close, trainer cannot, listing needs reports.view", async () => {
    await expect(openCashSession(db, trainer, { openingBalanceMinor: 0 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const session = await openCashSession(db, manager, { openingBalanceMinor: 10_000 });
    await expect(closeCashSession(db, trainer, session.id, 0)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(syncAppError(() => listCashSessions(db, reception, {})).code).toBe("FORBIDDEN");
    expect(listCashSessions(db, manager, {}).items.length).toBe(1);
  });
});

describe("reports and dashboard", () => {
  it("calculates period revenue, refunds, expenses, net result, methods, plans and daily series", async () => {
    const dayA = "2026-08-20";
    const dayB = "2026-08-22";

    const planA = await createPlan(db, owner, { name: "بلاتيني", durationDays: 30, price: 1000 });
    const planB = await createPlan(db, owner, { name: "ذهبي", durationDays: 30, price: 500 });
    const mA = await newMember("عضو بلاتيني");
    const mB = await newMember("عضو ذهبي");
    const subA = await createSubscription(db, owner, { memberId: mA.id, planId: planA.id });
    const subB = await createSubscription(db, owner, { memberId: mB.id, planId: planB.id });

    await recordPayment(db, owner, {
      memberId: mA.id,
      subscriptionId: subA.id,
      baseAmountMinor: 100_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
      paidAt: `${dayA} 12:00:00`,
    });
    await recordPayment(db, owner, {
      memberId: mB.id,
      subscriptionId: subB.id,
      baseAmountMinor: 30_000,
      paidAmountMinor: 20_000,
      methodCode: "bank_card",
      paidAt: `${dayB} 13:00:00`,
    });
    const voidedTarget = await recordPayment(db, owner, {
      memberId: mB.id,
      baseAmountMinor: 99_000,
      paidAmountMinor: 99_000,
      methodCode: "cash",
      paidAt: `${dayA} 14:00:00`,
    });
    await voidPayment(db, owner, voidedTarget.id, "دخول بالخطأ");

    const list = listPayments(db, owner, { fromKey: dayA, toKey: dayB });
    expect(list.total).toBe(3);
    expect(
      listPayments(db, owner, { fromKey: dayA, toKey: dayB, status: "partial" }).total,
    ).toBe(2);
    expect(
      listPayments(db, owner, { fromKey: dayA, toKey: dayB, status: "paid" }).total,
    ).toBe(0);

    await createExpense(db, owner, {
      categoryId: "cat-maintenance",
      amountMinor: 12_000,
      methodCode: "cash",
      description: "صيانة جهاز مشي",
      expenseDate: dayA,
    });
    const badExpense = await createExpense(db, owner, {
      categoryId: "cat-marketing",
      amountMinor: 8_000,
      methodCode: "cash",
      description: "حملة إعلانية",
      expenseDate: dayB,
    });
    await voidExpense(db, owner, badExpense.id, "لم يتم الصرف فعليًا");

    const refundTarget = list.items[0];
    await refundPayment(db, owner, refundTarget.id, 5_000, "خصم جزئي متفق عليه");

    const report = getPeriodReport(db, owner, dayA, todayKey());
    expect(report.revenueMinor).toBe(70_000);
    expect(report.paymentCount).toBe(2);
    expect(report.avgTicketMinor).toBe(35_000);
    expect(report.expensesMinor).toBe(12_000);
    expect(report.netResultMinor).toBe(70_000 - 5_000 - 12_000);

    const cash = report.byMethod.find((m) => m.code === "cash");
    const card = report.byMethod.find((m) => m.code === "bank_card");
    expect(cash).toMatchObject({ revenueMinor: 50_000, count: 1 });
    expect(card).toMatchObject({ revenueMinor: 20_000, count: 1 });

    expect(report.byPlan).toHaveLength(2);
    expect(report.byPlan.find((p) => p.planId === planA.id)).toMatchObject({ revenueMinor: 50_000 });
    expect(report.byPlan.find((p) => p.planId === planB.id)).toMatchObject({ revenueMinor: 20_000 });

    expect(report.expensesByCategory).toHaveLength(1);
    expect(report.expensesByCategory[0]).toMatchObject({ categoryId: "cat-maintenance", amountMinor: 12_000 });

    const dailyMap = new Map(report.daily.map((d) => [d.dateKey, d]));
    expect(dailyMap.get(dayA)).toMatchObject({ revenueMinor: 50_000, expensesMinor: 12_000 });
    expect(dailyMap.get(dayB)).toMatchObject({ revenueMinor: 20_000, expensesMinor: 0 });
    expect(dailyMap.get("2026-08-21")).toMatchObject({ revenueMinor: 0, expensesMinor: 0 });
  });

  it("feeds the finance overview from the ledger without inventing values", async () => {
    const { member } = await newSubscription(120);
    await recordPayment(db, reception, {
      memberId: member.id,
      baseAmountMinor: 12_000,
      paidAmountMinor: 12_000,
      methodCode: "cash",
    });
    await createExpense(db, owner, {
      categoryId: "cat-salaries",
      amountMinor: 3_000,
      methodCode: "bank_card",
      description: "مكافأة مدرب",
    });

    const overview = getFinanceOverview(db, owner, todayKey(), todayKey());
    expect(overview.todayInMinor).toBe(12_000);
    expect(overview.todayOutMinor).toBe(3_000);
    expect(overview.todayNetMinor).toBe(9_000);
    expect(overview.todayPaymentsCount).toBe(1);
    expect(overview.byMethodToday.map((r) => r.methodCode).sort()).toEqual(["bank_card", "cash"]);

    const empty = getPeriodReport(db, owner, "2020-01-01", "2020-01-02");
    expect(empty.revenueMinor).toBe(0);
    expect(empty.paymentCount).toBe(0);
    expect(empty.avgTicketMinor).toBe(0);
    expect(empty.daily).toHaveLength(2);
  });

  it("excludes cancelled subscription payments from revenue in reports and ledger", async () => {
    const { member, sub } = await newSubscription(800);
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 80_000,
      paidAmountMinor: 80_000,
      methodCode: "cash",
    });

    const before = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(before.revenueMinor).toBe(80_000);
    expect(before.paymentCount).toBe(1);

    const overviewBefore = getFinanceOverview(db, owner, todayKey(), todayKey());
    expect(overviewBefore.todayInMinor).toBe(80_000);

    const { setSubscriptionStatus } = await import("@/core/services/subscriptions.service");
    await setSubscriptionStatus(db, owner, sub.id, "cancelled");

    const afterReport = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(afterReport.revenueMinor).toBe(0);
    expect(afterReport.paymentCount).toBe(0);

    const afterOverview = getFinanceOverview(db, owner, todayKey(), todayKey());
    expect(afterOverview.todayInMinor).toBe(0);
  });

  it("full refund zeroes revenue in both dashboard overview and period report", async () => {
    const { member, sub } = await newSubscription(500);
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 25_000,
      methodCode: "cash",
    });

    const beforeRep = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(beforeRep.revenueMinor).toBe(25_000);

    const beforeOv = getFinanceOverview(db, owner, todayKey(), todayKey());
    expect(beforeOv.todayInMinor).toBe(25_000);

    const payment = listPayments(db, owner, { subscriptionId: sub.id }).items[0];
    await refundPayment(db, owner, payment.id, 25_000, "استرداد كامل");

    const afterRep = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(afterRep.revenueMinor).toBe(25_000);
    expect(afterRep.refundsMinor).toBe(25_000);
    expect(afterRep.netResultMinor + afterRep.expensesMinor).toBe(0);

    const afterOv = getFinanceOverview(db, owner, todayKey(), todayKey());
    expect(afterOv.todayInMinor - afterOv.todayRefundsMinor).toBe(0);
    expect(afterOv.todayNetMinor + afterOv.todayOutMinor).toBe(0);
  });

  it("reports 100 EGP outstanding for a 500 subscription with a single 400 payment", async () => {
    const { member, sub } = await newSubscription(500);
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 40_000,
      methodCode: "cash",
    });

    const out = getMemberOutstanding(db, owner, member.id);
    expect(out.subscriptionsMinor).toBe(10_000);
    expect(out.storeMinor).toBe(0);
    expect(out.totalMinor).toBe(10_000);

    const payment = listPayments(db, owner, { subscriptionId: sub.id }).items[0];
    expect(payment.status).toBe("partial");
    expect(payment.remainingAmountMinor).toBe(10_000);
  });

  it("a fresh ACTIVE subscription with one 250 payment shows in list sums, overview today-in and period revenue", async () => {
    const { member, sub } = await newSubscription(500, "نشط-500");
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 25_000,
      methodCode: "cash",
    });

    // what the revenue card on the payments page sums from:
    const listed = listPayments(db, owner, {}).items.filter(
      (p) => p.subscriptionId === sub.id,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("partial");
    expect(listed[0].subCancelled).toBe(0);
    const collected = listed.reduce(
      (s, p) => s + (p.status === "paid" || p.status === "partial" ? p.paidAmountMinor : 0),
      0,
    );
    expect(collected).toBe(25_000);

    // dashboard finance overview (ledger-based):
    const monthStart = `${todayKey().slice(0, 7)}-01`;
    const ov = getFinanceOverview(db, owner, todayKey(), monthStart);
    expect(ov.todayInMinor).toBe(25_000);

    // reports page period revenue:
    const rep = getPeriodReport(db, owner, todayKey(), todayKey());
    expect(rep.revenueMinor).toBe(25_000);
  });

  it("flags cancelled-subscription payments in lists and reports zero outstanding after cancel", async () => {
    const { member, sub } = await newSubscription(800);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 80_000,
      paidAmountMinor: 30_000,
      methodCode: "cash",
    });

    const listed = listPayments(db, owner, { subscriptionId: sub.id }).items[0];
    expect(listed.subCancelled).toBe(0);

    const before = getMemberOutstanding(db, owner, member.id);
    expect(before.subscriptionsMinor).toBe(50_000);

    const { setSubscriptionStatus } = await import("@/core/services/subscriptions.service");
    await setSubscriptionStatus(db, owner, sub.id, "cancelled");

    const listedAfter = listPayments(db, owner, { subscriptionId: sub.id }).items[0];
    expect(listedAfter.subCancelled).toBe(1);

    const after = getMemberOutstanding(db, owner, member.id);
    expect(after.subscriptionsMinor).toBe(0);
    expect(after.totalMinor).toBe(0);
    void payment;
  });

  it("does not double-reverse when voiding a payment whose subscription was already cancelled", async () => {
    const { member, sub } = await newSubscription(700);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 70_000,
      paidAmountMinor: 70_000,
      methodCode: "cash",
    });

    const { setSubscriptionStatus } = await import("@/core/services/subscriptions.service");
    await setSubscriptionStatus(db, owner, sub.id, "cancelled");

    const reversalsAfterCancel = listLedgerEntries(db, owner, {}).items.filter(
      (e) => e.entryType === "reversal_payment" && e.refId === payment.id,
    );
    expect(reversalsAfterCancel).toHaveLength(1);

    const voided = await voidPayment(db, owner, payment.id, "اختبار إلغاء بعد إلغاء الاشتراك");
    expect(voided.status).toBe("voided");

    const reversals = listLedgerEntries(db, owner, {}).items.filter(
      (e) => e.entryType === "reversal_payment" && e.refId === payment.id,
    );
    expect(reversals).toHaveLength(1);
    expect(getPeriodReport(db, owner, todayKey(), todayKey()).revenueMinor).toBe(0);
  });

  it("does not double-reverse when cancelling a subscription whose payment was already voided", async () => {
    const { member, sub } = await newSubscription(600);
    const payment = await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 60_000,
      paidAmountMinor: 60_000,
      methodCode: "cash",
    });

    await voidPayment(db, owner, payment.id, "خطأ في التسجيل");
    expect(
      listLedgerEntries(db, owner, {}).items.filter(
        (e) => e.entryType === "reversal_payment" && e.refId === payment.id,
      ),
    ).toHaveLength(1);

    const { setSubscriptionStatus } = await import("@/core/services/subscriptions.service");
    await setSubscriptionStatus(db, owner, sub.id, "cancelled");

    expect(
      listLedgerEntries(db, owner, {}).items.filter(
        (e) => e.entryType === "reversal_payment" && e.refId === payment.id,
      ),
    ).toHaveLength(1);
  });

  it("blocks reports from users without reports.view", async () => {
    expect(syncAppError(() => getPeriodReport(db, trainer, todayKey(), todayKey())).code).toBe(
      "FORBIDDEN",
    );
  });

  it("keeps payment filters accurate: search, status, method, employee, amount, subscription", async () => {
    const { member, sub } = await newSubscription(900);
    await recordPayment(db, owner, {
      memberId: member.id,
      subscriptionId: sub.id,
      baseAmountMinor: 90_000,
      paidAmountMinor: 40_000,
      methodCode: "cash",
      referenceNo: "REF-42",
    });
    const second = await recordPayment(db, reception, {
      memberId: (await newMember()).id,
      baseAmountMinor: 10_000,
      paidAmountMinor: 10_000,
      methodCode: "bank_card",
    });

    expect(listPayments(db, owner, { search: "REF-42" }).total).toBe(1);
    expect(listPayments(db, owner, { status: "partial" }).total).toBe(1);
    expect(listPayments(db, owner, { methodCode: "bank_card" }).total).toBe(1);
    expect(listPayments(db, owner, { createdBy: reception.userId }).items[0].id).toBe(second.id);
    expect(listPayments(db, owner, { minAmountMinor: 50_000 }).total).toBe(1);
    expect(listPayments(db, owner, { subscriptionId: sub.id }).total).toBe(1);
    expect(listPayments(db, owner, { subscriptionId: sub.id, status: "paid" })).toMatchObject({ total: 0 });
    expect(getPaymentById(db, owner, second.id).createdByName).toBe("الاستقبال");
  });

  it("listPayments filters by memberId when provided", async () => {
    const aMember = await newMember("عضو أ");
    const aPlan = await createPlan(db, owner, {
      name: `خطة أ-${Math.floor(Math.random() * 1e9)}`,
      durationDays: 30,
      price: 500,
    });
    const aSub = await createSubscription(db, owner, { memberId: aMember.id, planId: aPlan.id });
    await recordPayment(db, owner, {
      memberId: aMember.id,
      subscriptionId: aSub.id,
      baseAmountMinor: 50_000,
      paidAmountMinor: 50_000,
      methodCode: "cash",
    });
    const bMember = await newMember("عضو ب");
    const bPlan = await createPlan(db, owner, {
      name: `خطة ب-${Math.floor(Math.random() * 1e9)}`,
      durationDays: 30,
      price: 700,
    });
    const bSub = await createSubscription(db, owner, { memberId: bMember.id, planId: bPlan.id });
    await recordPayment(db, owner, {
      memberId: bMember.id,
      subscriptionId: bSub.id,
      baseAmountMinor: 70_000,
      paidAmountMinor: 70_000,
      methodCode: "cash",
    });
    const all = listPayments(db, owner, { pageSize: 100 });
    expect(all.total).toBe(2);
    const onlyA = listPayments(db, owner, { pageSize: 100, memberId: aMember.id });
    expect(onlyA.total).toBe(1);
    expect(onlyA.items[0].memberId).toBe(aMember.id);
    const onlyB = listPayments(db, owner, { pageSize: 100, memberId: bMember.id });
    expect(onlyB.total).toBe(1);
    expect(onlyB.items[0].memberId).toBe(bMember.id);
  });
});
