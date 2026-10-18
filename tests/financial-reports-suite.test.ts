import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, createUser, setup } from "@/core/services/auth.service";
import { getPeriodReport } from "@/core/services/financial-report.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { createMember } from "@/core/services/members.service";
import { recordPayment } from "@/core/services/payments.service";
import { createExpense } from "@/core/services/expenses.service";
import { createProduct, createSale, repayStoreDebt } from "@/core/services/store.service";
import { createQuickSession } from "@/core/services/quick-session.service";
import { createPTPackage, createPrivateTraining } from "@/core/services/private-training.service";
import { createTrainer } from "@/core/services/trainers.service";
import { todayKey } from "@/core/dates";

describe("Financial Reports Suite - Consolidated Revenue, P&L, Receivables & Liquidity", () => {
  it("consolidates revenue across all 5 streams and computes full P&L income statement", async () => {
    const db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Yassen Mohamed Kotb | 01288536381",
      ownerFullName: "المالك المالي",
      username: "finance_owner",
      password: "Owner@2026",
    });
    const owner = buildActor(ownerUser);
    const today = todayKey();

    // 1. Subscription Payment: 1000 EGP (100,000 minor)
    const member1 = await createMember(db, owner, {
      fullName: "محمد أحمد",
      phone: "01011111111",
    });
    const plan = await createPlan(db, owner, {
      name: "اشتراك شهري",
      durationDays: 30,
      price: 1500, // 1500 EGP
    });
    const sub = await createSubscription(db, owner, { memberId: member1.id, planId: plan.id });
    await recordPayment(db, owner, {
      memberId: member1.id,
      subscriptionId: sub.id,
      baseAmountMinor: 150_000,
      paidAmountMinor: 100_000, // 1000 EGP paid, 500 EGP remaining
      methodCode: "cash",
      paidAt: `${today} 10:00:00`,
    });

    // 2. Store Sale (Cash): 2 items sold, retail 200 EGP (20,000 minor), cost 120 EGP (12,000 minor)
    const product = await createProduct(db, owner, {
      name: "واي بروتين",
      priceMinor: 10_000,
      costMinor: 6_000,
      stockQty: 50,
      minStockQty: 5,
    });
    await createSale(db, owner, {
      items: [{ productId: product.id, qty: 2 }],
      methodCode: "cash",
      isCredit: false,
    });

    // 3. Store Debt Sale and Partial Repayment:
    // Member buys 300 EGP on credit, then repays 100 EGP via instapay
    const creditSale = await createSale(db, owner, {
      items: [{ productId: product.id, qty: 3 }],
      methodCode: "cash",
      isCredit: true,
      memberId: member1.id,
    });
    const openDebt = db.first<{ id: string }>("SELECT id FROM store_debts WHERE sale_id = ?", [creditSale.id]);
    expect(openDebt).toBeDefined();
    await repayStoreDebt(db, owner, {
      debtId: openDebt!.id,
      amountMinor: 10_000, // 100 EGP repaid
      methodCode: "instapay",
    });

    // 4. Quick Session (Day Pass): 80 EGP (8,000 minor) via wallet
    await createQuickSession(db, owner, {
      clientType: "guest",
      guestName: "زائر سريع",
      sessionName: "تذكرة يومية حرة",
      priceMinor: 8_000,
      paidAmountMinor: 8_000,
      methodCode: "wallet",
      sessionDate: today,
    });

    // 5. Private Training (PT): 1200 EGP package, 800 EGP (80,000 minor) paid, 400 EGP remaining
    const trainer = await createTrainer(db, owner, {
      fullName: "كابتن كمال",
      phone: "01022222222",
    });
    const ptPkg = await createPTPackage(db, owner, {
      name: "باقة 12 حصة خاصة",
      sessionsCount: 12,
      priceMinor: 120_000,
      durationDays: 30,
      coachCommissionPercent: 30,
    });
    await createPrivateTraining(db, owner, {
      memberId: member1.id,
      trainerId: trainer.id,
      packageId: ptPkg.id,
      totalSessions: 12,
      priceMinor: 120_000,
      paidAmountMinor: 80_000,
      methodCode: "bank_card",
      startDate: today,
      endDate: today,
    });

    // 6. Expenses: Rent 300 EGP (30,000 minor), Maintenance 50 EGP (5,000 minor)
    await createExpense(db, owner, {
      categoryId: "cat-rent",
      amountMinor: 30_000,
      methodCode: "cash",
      description: "إيجار صالة",
      expenseDate: today,
    });
    await createExpense(db, owner, {
      categoryId: "cat-maintenance",
      amountMinor: 5_000,
      methodCode: "cash",
      description: "صيانة أجهزة",
      expenseDate: today,
    });

    // Fetch Period Report
    const report = getPeriodReport(db, owner, today, today);

    // Verify Consolidated Revenue Streams:
    // Subscriptions: 100,000
    // Store: 20,000
    // Store Debt Repayment: 10,000
    // Quick Sessions: 8,000
    // PT: 80,000
    // Total Revenue = 218,000 minor (2,180 EGP)
    expect(report.subscriptionsRevenueMinor).toBe(100_000);
    expect(report.storeRevenueMinor).toBe(20_000);
    expect(report.storeDebtRepaymentsMinor).toBe(10_000);
    expect(report.quickSessionsRevenueMinor).toBe(8_000);
    expect(report.privateTrainingsRevenueMinor).toBe(80_000);
    expect(report.revenueMinor).toBe(218_000);
    expect(report.paymentCount).toBe(5); // 1 sub + 1 store + 1 debt repayment + 1 quick session + 1 PT

    // Verify Streams Summary Breakdown
    expect(report.streamsSummary).toHaveLength(5);
    const subStream = report.streamsSummary.find((s) => s.key === "subscriptions");
    const storeStream = report.streamsSummary.find((s) => s.key === "store");
    const ptStream = report.streamsSummary.find((s) => s.key === "private_training");
    expect(subStream?.revenueMinor).toBe(100_000);
    expect(storeStream?.revenueMinor).toBe(20_000);
    expect(ptStream?.revenueMinor).toBe(80_000);

    // Verify Income Statement (P&L):
    // Total Revenue: 218,000
    // COGS: 2 items * 6,000 = 12,000 minor (from store sale)
    // Refunds: 0
    // Gross Profit = 218,000 - 12,000 = 206,000 minor
    // Expenses = 30,000 + 5,000 = 35,000 minor
    // Net Profit = 206,000 - 35,000 = 171,000 minor
    const pnl = report.incomeStatement;
    expect(pnl.totalRevenueMinor).toBe(218_000);
    expect(pnl.cogsMinor).toBe(12_000);
    expect(pnl.grossProfitMinor).toBe(206_000);
    expect(pnl.totalExpensesMinor).toBe(35_000);
    expect(pnl.rentUtilitiesExpensesMinor).toBe(30_000);
    expect(pnl.maintenanceExpensesMinor).toBe(5_000);
    expect(pnl.netProfitMinor).toBe(171_000);
    expect(pnl.netMarginPercent).toBe(Math.round((171_000 / 218_000) * 100));

    // Verify Receivables & Aging:
    // Subscriptions remaining: 150,000 - 100,000 = 50,000 minor
    // Store credit debt remaining: 30,000 - 10,000 = 20,000 minor
    // PT remaining: 120,000 - 80,000 = 40,000 minor
    // Total Receivables = 50,000 + 20,000 + 40,000 = 110,000 minor
    const rec = report.receivables;
    expect(rec.subscriptionsDebtMinor).toBe(50_000);
    expect(rec.storeDebtMinor).toBe(20_000);
    expect(rec.privateTrainingDebtMinor).toBe(40_000);
    expect(rec.totalReceivablesMinor).toBe(110_000);
    expect(rec.aging.under30DaysMinor).toBe(110_000);
    expect(rec.topDebtors).toHaveLength(1);
    expect(rec.topDebtors[0].memberName).toBe("محمد أحمد");
    expect(rec.topDebtors[0].totalDebtMinor).toBe(110_000);

    // Verify Payment Methods: includes cash, instapay, wallet, bank_card
    const methods = report.byMethod.map((m) => m.code);
    expect(methods).toContain("cash");
    expect(methods).toContain("instapay");
    expect(methods).toContain("wallet");
    expect(methods).toContain("bank_card");

    // Verify Liquidity by Channel
    expect(report.liquidity.gymCashMinor).toBeGreaterThan(0);
    expect(report.liquidity.walletsMinor).toBe(18_000); // 10,000 instapay + 8,000 wallet
    expect(report.liquidity.bankMinor).toBe(80_000); // 80,000 bank_card
  });
});
