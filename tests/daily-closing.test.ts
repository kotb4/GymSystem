import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember, setMemberStatus } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment, voidPayment } from "@/core/services/payments.service";
import { createUser } from "@/core/services/users.service";
import { AppError } from "@/core/errors";
import { todayKey } from "@/core/dates";
import type { ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";
import {
  closeDailyClosing,
  getDailyClosingById,
  getOrCreateDailyClosing,
  getTreasurySnapshot,
  listDailyClosings,
  listTreasurySnapshotsForDate,
  reopenDailyClosing,
} from "@/core/services/daily-closing.service";
import { getTreasuryForDashboard } from "@/core/services/dashboard.service";

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

async function newMember(name = "عضو خزينة") {
  return createMember(db, owner, {
    fullName: `${name}-${Math.floor(Math.random() * 1e9)}`,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function newSubscriptionWithPayment(priceMajor: number, paidMajor: number, methodCode: "cash" | "bank_card" | "transfer" | "other" = "cash") {
  const m = await newMember();
  const plan = await createPlan(db, owner, {
    name: `خطة-${Math.floor(Math.random() * 1e9)}`,
    durationDays: 30,
    price: priceMajor,
  });
  const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
  const payment = await recordPayment(db, owner, {
    memberId: m.id,
    subscriptionId: sub.id,
    baseAmountMinor: priceMajor * 100,
    paidAmountMinor: paidMajor * 100,
    methodCode,
  });
  return { member: m, plan, sub, payment };
}

describe("daily closing — UNIQUE constraint and idempotency", () => {
  it("creates an OPEN daily closing for a (date, box) pair", async () => {
    const today = todayKey();
    const closing = getOrCreateDailyClosing(db, manager, {
      businessDate: today,
      box: "gym",
      openingBalanceMinor: 0,
    });
    expect(closing.status).toBe("open");
    expect(closing.businessDate).toBe(today);
    expect(closing.box).toBe("gym");
    expect(closing.countedCashMinor).toBeNull();
    expect(closing.differenceMinor).toBeNull();
    expect(closing.openedById).toBe(manager.userId);
  });

  it("is idempotent — calling twice returns the same row", async () => {
    const today = todayKey();
    const a = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    const b = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    expect(a.id).toBe(b.id);
  });

  it("enforces only-one-current-row at the service level", () => {
    const today = todayKey();
    getOrCreateDailyClosing(db, manager, { businessDate: today, box: "store", openingBalanceMinor: 0 });
    // Calling again should return the same row, not create a new one
    const second = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "store", openingBalanceMinor: 0 });
    const list = listDailyClosings(db, manager, { fromKey: today, toKey: today, box: "store", currentOnly: true });
    expect(list.items.length).toBe(1);
    expect(list.items[0].id).toBe(second.id);
  });

  it("allows multiple closings for the same (date, box) when previous is superseded", async () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    reopenDailyClosing(db, manager, first.id, "إعادة فحص اليوم");
    // Should succeed because old row now has superseded_by set
    const list = listDailyClosings(db, manager, { fromKey: today, toKey: today, currentOnly: false });
    expect(list.items.length).toBe(2);
  });
});

describe("daily closing — expected amounts from financial_ledger", () => {
  it("sums expected totals by method from ledger entries on the day", async () => {
    const today = todayKey();
    await newSubscriptionWithPayment(1000, 1000, "cash");
    await newSubscriptionWithPayment(500, 500, "bank_card");
    await newSubscriptionWithPayment(250, 250, "transfer");
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    expect(closing.expected.cash).toBe(100_000);
    expect(closing.expected.card).toBe(50_000);
    expect(closing.expected.transfer).toBe(25_000);
    expect(closing.expected.other).toBe(0);
    expect(closing.expected.total).toBe(175_000);
  });

  it("excludes voided payments (their reversal ledger entry nets to zero)", async () => {
    const today = todayKey();
    const { payment } = await newSubscriptionWithPayment(1000, 1000, "cash");
    voidPayment(db, owner, payment.id, "إلغاء الاختبار");
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    expect(closing.expected.cash).toBe(0);
    expect(closing.expected.total).toBe(0);
  });
});

describe("daily closing — diff calculation and reason requirement", () => {
  it("computes difference = counted - expected", async () => {
    const today = todayKey();
    await newSubscriptionWithPayment(1000, 1000, "cash");
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    const closed = closeDailyClosing(db, manager, closing.id, { countedCashMinor: 90_000, reason: "فرق في العدّ" });
    expect(closed.status).toBe("closed");
    expect(closed.countedCashMinor).toBe(90_000);
    expect(closed.differenceMinor).toBe(-10_000);
  });

  it("requires a reason when difference != 0", () => {
    const today = todayKey();
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    const err = syncAppError(() =>
      closeDailyClosing(db, manager, closing.id, { countedCashMinor: 50_000 }),
    );
    expect(err.messageKey).toBe("errors.treasury.differenceReasonRequired");
  });

  it("accepts zero difference without reason", () => {
    const today = todayKey();
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    const closed = closeDailyClosing(db, manager, closing.id, { countedCashMinor: 0 });
    expect(closed.differenceMinor).toBe(0);
    expect(closed.reason).toBeNull();
  });
});

describe("daily closing — state machine (open/closed/reopened)", () => {
  it("blocks edits to a closed closing", () => {
    const today = todayKey();
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, closing.id, { countedCashMinor: 0 });
    const err = syncAppError(() =>
      closeDailyClosing(db, manager, closing.id, { countedCashMinor: 0 }),
    );
    expect(err.messageKey).toBe("errors.treasury.notEditable");
  });

  it("manager reopen creates a new OPEN row and marks old as REOPENED", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    const reopened = reopenDailyClosing(db, manager, first.id, "تصحيح خطأ");
    expect(reopened.status).toBe("open");
    expect(reopened.supersededBy).toBeNull();
    const refreshed = getDailyClosingById(db, manager, first.id);
    expect(refreshed.status).toBe("reopened");
    expect(refreshed.supersededBy).toBe(reopened.id);
  });

  it("reopen requires 5+ character reason", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    const err = syncAppError(() => reopenDailyClosing(db, manager, first.id, ""));
    expect(err.messageKey).toBe("errors.treasury.reopenReasonRequired");
  });

  it("reopen of an already-reopened closing is rejected", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    reopenDailyClosing(db, manager, first.id, "إعادة فحص");
    const err = syncAppError(() => reopenDailyClosing(db, manager, first.id, "إعادة ثانية"));
    expect(err.messageKey).toBe("errors.treasury.cannotReopen");
  });
});

describe("daily closing — audit log entries", () => {
  it("logs DAILY_CLOSING_OPENED, DAILY_CLOSING_COUNTED, and DAILY_CLOSING_DISCREPANCY", () => {
    const today = todayKey();
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, closing.id, { countedCashMinor: 50_000, reason: "فرق في الإحصاء" });
    const audits = db.all<{ action: string; entity_id: string }>(
      "SELECT action, entity_id FROM audit_logs WHERE entity_type = 'daily_closing' ORDER BY created_at",
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("DAILY_CLOSING_OPENED");
    expect(actions).toContain("DAILY_CLOSING_COUNTED");
    expect(actions).toContain("DAILY_CLOSING_DISCREPANCY");
    // First two entries should reference the same closing id
    const countLogs = audits.filter((a) => a.action === "DAILY_CLOSING_COUNTED");
    expect(countLogs.length).toBe(1);
    expect(countLogs[0].entity_id).toBe(closing.id);
  });

  it("logs DAILY_CLOSING_REOPENED with the previous closing id in payload", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    const reopened = reopenDailyClosing(db, manager, first.id, "إعادة فحص كاملة");
    const audit = db.first<{ action: string; entity_id: string; metadata: string }>(
      "SELECT action, entity_id, metadata FROM audit_logs WHERE action = 'DAILY_CLOSING_REOPENED'",
    );
    expect(audit).not.toBeNull();
    expect(audit!.entity_id).toBe(reopened.id);
    const payload = JSON.parse(audit!.metadata);
    expect(payload.previousClosingId).toBe(first.id);
  });
});

describe("daily closing — permission matrix", () => {
  it("trainer is blocked from creating/closing/reopening", () => {
    const today = todayKey();
    const err1 = syncAppError(() => getOrCreateDailyClosing(db, trainer, { businessDate: today, box: "gym", openingBalanceMinor: 0 }));
    expect(err1.code).toBe("FORBIDDEN");
    const err2 = syncAppError(() => reopenDailyClosing(db, trainer, "x", "اختبار"));
    expect(err2.code).toBe("FORBIDDEN");
  });

  it("reception can create and close, but not reopen", () => {
    const today = todayKey();
    const opening = getOrCreateDailyClosing(db, reception, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    expect(opening.status).toBe("open");
    const closed = closeDailyClosing(db, reception, opening.id, { countedCashMinor: 0 });
    expect(closed.status).toBe("closed");
    const err = syncAppError(() => reopenDailyClosing(db, reception, opening.id, "إعادة فتح"));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("manager can do all three operations", () => {
    const today = todayKey();
    const opening = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    expect(opening.status).toBe("open");
    const closed = closeDailyClosing(db, manager, opening.id, { countedCashMinor: 0 });
    expect(closed.status).toBe("closed");
    const reopened = reopenDailyClosing(db, manager, opening.id, "إعادة فحص");
    expect(reopened.status).toBe("open");
  });

  it("owner (no perm check) can do everything", () => {
    const today = todayKey();
    const opening = getOrCreateDailyClosing(db, owner, { businessDate: today, box: "store", openingBalanceMinor: 0 });
    closeDailyClosing(db, owner, opening.id, { countedCashMinor: 0 });
    reopenDailyClosing(db, owner, opening.id, "اختبار المالك");
    expect(true).toBe(true);
  });
});

describe("daily closing — dashboard snapshot", () => {
  it("returns status='missing' when no closing exists for the date", () => {
    const today = todayKey();
    const snap = getTreasurySnapshot(db, manager, today, "gym");
    expect(snap.status).toBe("missing");
    expect(snap.expectedMinor).toBe(0);
    expect(snap.closingId).toBeNull();
  });

  it("returns current snapshot for both boxes for a date", () => {
    const today = todayKey();
    getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    const both = listTreasurySnapshotsForDate(db, manager, today);
    expect(both.gym.status).toBe("open");
    expect(both.store.status).toBe("missing");
  });

  it("getTreasuryForDashboard returns both boxes with safe fallbacks", () => {
    const today = todayKey();
    const section = getTreasuryForDashboard(db, manager, today);
    expect(section.businessDate).toBe(today);
    expect(section.gym).toBeDefined();
    expect(section.store).toBeDefined();
    expect(section.gym.status).toBe("missing");
    expect(section.store.status).toBe("missing");
  });

  it("getTreasuryForDashboard reflects closed status after close", async () => {
    const today = todayKey();
    await newSubscriptionWithPayment(500, 500, "cash");
    const opening = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, opening.id, { countedCashMinor: 50_000 });
    const section = getTreasuryForDashboard(db, manager, today);
    expect(section.gym.status).toBe("closed");
    expect(section.gym.countedCashMinor).toBe(50_000);
  });
});

describe("daily closing — list filtering and pagination", () => {
  it("lists current closings by default and skips superseded ones", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    reopenDailyClosing(db, manager, first.id, "إعادة");
    const list = listDailyClosings(db, manager, { fromKey: today, toKey: today, currentOnly: true });
    expect(list.items.length).toBe(1);
    expect(list.items[0].status).toBe("open");
  });

  it("includes superseded rows when currentOnly=false", () => {
    const today = todayKey();
    const first = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    closeDailyClosing(db, manager, first.id, { countedCashMinor: 0 });
    reopenDailyClosing(db, manager, first.id, "إعادة");
    const list = listDailyClosings(db, manager, { fromKey: today, toKey: today, currentOnly: false });
    expect(list.items.length).toBe(2);
  });

  it("filters by box", () => {
    const today = todayKey();
    getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    getOrCreateDailyClosing(db, manager, { businessDate: today, box: "store", openingBalanceMinor: 0 });
    const gymList = listDailyClosings(db, manager, { fromKey: today, toKey: today, box: "gym" });
    expect(gymList.items.length).toBe(1);
    expect(gymList.items[0].box).toBe("gym");
  });
});

describe("daily closing — input validation", () => {
  it("rejects invalid business date", () => {
    const err = syncAppError(() =>
      getOrCreateDailyClosing(db, manager, { businessDate: "not-a-date", box: "gym", openingBalanceMinor: 0 }),
    );
    expect(err.messageKey).toBe("errors.treasury.invalidBusinessDate");
  });

  it("rejects invalid box", () => {
    const err = syncAppError(() =>
      getOrCreateDailyClosing(db, manager, { businessDate: todayKey(), box: "invalid" as never, openingBalanceMinor: 0 }),
    );
    expect(err.messageKey).toBe("errors.treasury.invalidBox");
  });

  it("rejects negative opening balance", () => {
    const err = syncAppError(() =>
      getOrCreateDailyClosing(db, manager, { businessDate: todayKey(), box: "gym", openingBalanceMinor: -100 }),
    );
    expect(err.messageKey).toBe("errors.treasury.invalidOpeningBalance");
  });
});

describe("daily closing — per-method audit entries", () => {
  it("records method breakdown rows on close", async () => {
    const today = todayKey();
    await newSubscriptionWithPayment(1000, 1000, "cash");
    await newSubscriptionWithPayment(500, 500, "bank_card");
    const closing = getOrCreateDailyClosing(db, manager, { businessDate: today, box: "gym", openingBalanceMinor: 0 });
    // counted = cash expected (100k) so no reason needed
    const closed = closeDailyClosing(db, manager, closing.id, { countedCashMinor: 100_000 });
    expect(closed.methodBreakdown).toHaveLength(4);
    const cashRow = closed.methodBreakdown.find((b) => b.methodCode === "cash");
    expect(cashRow?.expectedMinor).toBe(100_000);
    expect(cashRow?.actualMinor).toBe(100_000);
    const cardRow = closed.methodBreakdown.find((b) => b.methodCode === "bank_card");
    expect(cardRow?.expectedMinor).toBe(50_000);
    expect(cardRow?.actualMinor).toBe(50_000);
  });
});
