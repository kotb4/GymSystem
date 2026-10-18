import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import {
  openCashSession,
  closeCashSession,
  listCashSessions,
  getCashierPerformanceSummary,
} from "@/core/services/cash-session.service";
import { listLedgerEntries } from "@/core/services/finance.service";
import type { Db } from "@/db/engine";

describe("Cashier and Treasury Enhanced Filters", () => {
  let db: Db;
  let owner: ReturnType<typeof buildActor>;
  let staff1: ReturnType<typeof buildActor>;
  let staff2: ReturnType<typeof buildActor>;

  beforeEach(async () => {
    db = createTestDb();
    const ownerUser = await setup(db, {
      gymName: "Gym Test",
      ownerFullName: "مالك النظام",
      username: "owner",
      password: "Owner@2026",
    });
    owner = buildActor(ownerUser);

    staff1 = buildActor(
      await createUser(db, owner, {
        username: "staff1",
        password: "Staff@2026",
        fullName: "موظف أول",
        roleId: "reception",
      }),
    );

    staff2 = buildActor(
      await createUser(db, owner, {
        username: "staff2",
        password: "Staff@2026",
        fullName: "موظف ثان",
        roleId: "reception",
      }),
    );
  });

  it("filters cash sessions by employee, discrepancy, box, and date range", async () => {
    // Open & close session for staff1 with exact matching
    const s1 = await openCashSession(db, staff1, { openingBalanceMinor: 10000, box: "gym" });
    await closeCashSession(db, staff1, s1.id, 10000, "Exact match");

    // Open & close session for staff2 with shortage
    const s2 = await openCashSession(db, staff2, { openingBalanceMinor: 20000, box: "store" });
    await closeCashSession(db, staff2, s2.id, 18000, "Shortage of 2000");

    // Test listCashSessions filters
    const all = listCashSessions(db, owner, {});
    expect(all.total).toBe(2);

    const staff1Only = listCashSessions(db, owner, { openedById: staff1.userId });
    expect(staff1Only.total).toBe(1);
    expect(staff1Only.items[0].openedById).toBe(staff1.userId);

    const storeOnly = listCashSessions(db, owner, { box: "store" });
    expect(storeOnly.total).toBe(1);
    expect(storeOnly.items[0].box).toBe("store");

    const exactOnly = listCashSessions(db, owner, { discrepancy: "exact" });
    expect(exactOnly.total).toBe(1);
    expect(exactOnly.items[0].differenceMinor).toBe(0);

    const shortageOnly = listCashSessions(db, owner, { discrepancy: "shortage" });
    expect(shortageOnly.total).toBe(1);
    expect(shortageOnly.items[0].differenceMinor).toBe(-2000);

    // Test Cashier Performance Summary
    const summary = getCashierPerformanceSummary(db, owner);
    expect(summary.length).toBeGreaterThanOrEqual(2);

    const s2Summary = summary.find((x) => x.userId === staff2.userId);
    expect(s2Summary).toBeDefined();
    expect(s2Summary?.sessionsCount).toBe(1);
    expect(s2Summary?.shortageCount).toBe(1);
    expect(s2Summary?.totalDifferenceMinor).toBe(-2000);
  });

  it("filters financial ledger entries with creator join and totals calculation", async () => {
    const mem = await createMember(db, staff1, { fullName: "عضو تجريبي", phone: "01012345678" });
    const plan = await createPlan(db, owner, { name: "باقة شهرية", durationDays: 30, price: 500 });
    const sub = await createSubscription(db, staff1, {
      memberId: mem.id,
      planId: plan.id,
      startDate: "2026-01-01",
    });

    await recordPayment(db, staff1, {
      memberId: mem.id,
      subscriptionId: sub.id,
      baseAmountMinor: 50000,
      paidAmountMinor: 50000,
      methodCode: "cash",
      occurredAt: "2026-01-01 10:00:00",
    });

    const ledger = listLedgerEntries(db, owner, { createdBy: staff1.userId });
    expect(ledger.total).toBe(1);
    expect(ledger.items[0].createdById).toBe(staff1.userId);
    expect(ledger.items[0].createdByName).toBe("موظف أول");
    expect(ledger.items[0].memberName).toBe("عضو تجريبي");
    expect(ledger.totalInMinor).toBe(50000);
    expect(ledger.totalOutMinor).toBe(0);
  });
});
