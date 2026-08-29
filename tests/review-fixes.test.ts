import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  createProduct,
  createSale,
  voidStoreSale,
  repayStoreDebt,
  listStoreDebts,
} from "@/core/services/store.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import {
  sweepExpiredPlans,
} from "@/core/services/training-plans.service";
import {
  readAllSettings,
  getBackupConfig,
} from "@/core/services/settings.service";
import { listAuditLogs } from "@/core/services/audit.service";
import { getAllPermissions } from "@/core/services/permissions.service";
import { freezeSubscription, unfreezeSubscription } from "@/core/services/subscriptions.service";
import { writeSettingInternal, SETTING_KEYS } from "@/core/services/settings.service";
import { listLedgerEntries } from "@/core/services/finance.service";
import type { Db } from "@/db/engine";
import { PERMS } from "@/core/permissions";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let trainer: ServiceActor;
let reception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Trainer@2026",
      fullName: "المدرب",
      roleId: "trainer",
    }),
  );
  reception = buildActor(
    await createUser(db, owner, {
      username: "reception2",
      password: "Recep@2026",
      fullName: "الاستقبال",
      roleId: "reception",
    }),
  );
});

async function member(fullName = "عضو المتجر") {
  return createMember(db, owner, {
    fullName: `${fullName}-${Math.floor(Math.random() * 1e9)}`,
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function seedProduct(priceMinor = 10000) {
  return createProduct(db, owner, {
    name: `منتج ${Math.random().toString(36).slice(2, 8)}`,
    costMinor: 5000,
    priceMinor,
    stockQty: 20,
    minStockQty: 5,
  });
}

describe("review fixes regression", () => {
  it("allows a SECOND store-debt installment and tags repayments as store box", async () => {
    const m = await member();
    const p = await seedProduct();
    await createSale(db, owner, {
      items: [{ productId: p.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      memberId: m.id,
    });
    const debt = listStoreDebts(db, owner, { status: "open" }).items[0];

    await repayStoreDebt(db, owner, { debtId: debt.id, amountMinor: 4000, methodCode: "cash" });
    const second = await repayStoreDebt(db, owner, {
      debtId: debt.id,
      amountMinor: 6000,
      methodCode: "cash",
    });
    expect(second.status).toBe("settled");
    expect(second.paidMinor).toBe(10000);

    const repaymentRows = listLedgerEntries(db, owner, {}).items.filter(
      (e) => e.entryType === "payment" && e.refTable === "store_debts",
    );
    expect(repaymentRows).toHaveLength(2);
    expect(new Set(repaymentRows.map((r) => r.refId)).size).toBe(2);
    for (const row of repaymentRows) expect(row.box).toBe("store");
  });

  it("voids a credit sale before repayment but rejects it after partial repayment", async () => {
    const m = await member();
    const p1 = await seedProduct();
    const saleA = await createSale(db, owner, {
      items: [{ productId: p1.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      memberId: m.id,
    });

    await expect(voidStoreSale(db, owner, saleA.id, "إلغاء قبل السداد")).resolves.toBeUndefined();

    const p2 = await seedProduct();
    const saleB = await createSale(db, owner, {
      items: [{ productId: p2.id, qty: 1 }],
      methodCode: "cash",
      isCredit: true,
      memberId: m.id,
    });
    const openDebt = listStoreDebts(db, owner, { status: "open" }).items.find(
      (d) => d.saleNo === saleB.saleNo,
    )!;
    await repayStoreDebt(db, owner, { debtId: openDebt.id, amountMinor: 2000, methodCode: "cash" });

    await expect(
      voidStoreSale(db, owner, saleB.id, "محاولة إلغاء بعد سداد جزئي"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces checkin.create on recordCheckIn", async () => {
    await expect(
      recordCheckIn(db, trainer, { barcode: "ABC-1234" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gates previously-open RPC functions behind their permissions", async () => {
    expect(() => sweepExpiredPlans(db, trainer)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    const swept = await sweepExpiredPlans(db, owner);
    expect(typeof swept).toBe("number");

    expect(() => readAllSettings(db, reception)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(readAllSettings(db, owner)["gym_name"]).toBe("Yassen Mohamed Kotb | 01288536381");

    expect(() => getBackupConfig(db, reception)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(getBackupConfig(db, owner)).toMatchObject({
      autoIntervalHours: expect.any(Number),
      retentionCount: expect.any(Number),
    });

    expect(() => listAuditLogs(db, trainer)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(listAuditLogs(db, owner, {}).total).toBeGreaterThan(0);

    expect(() => getAllPermissions(db, trainer)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(getAllPermissions(db, owner)).toHaveLength(PERMS.length);
  });

  it("closes the freeze history row on manual unfreeze regardless of freeze_extends_expiry setting", async () => {
    const { createPlan } = await import("@/core/services/plans.service");
    const { createSubscription } = await import("@/core/services/subscriptions.service");
    writeSettingInternal(db, SETTING_KEYS.freezeExtendsExpiry, "0");

    const m = await member("عضو التجميد");
    const plan = await createPlan(db, owner, { name: "شهري تجميد", durationDays: 30, price: 300 });
    const sub = await createSubscription(db, owner, { memberId: m.id, planId: plan.id });
    const endDateBefore = (
      db.first<{ end_date: string }>(
        "SELECT end_date FROM member_subscriptions WHERE id = ?",
        [sub.id],
      )!
    ).end_date;

    await freezeSubscription(db, owner, sub.id, { endDate: endDateBefore });
    await unfreezeSubscription(db, owner, sub.id);

    const freezes = db.all<{ actual_resume_date: string | null; expected_resume_date: string | null }>(
      "SELECT actual_resume_date, expected_resume_date FROM subscription_freezes WHERE subscription_id = ?",
      [sub.id],
    );
    expect(freezes).toHaveLength(1);
    expect(freezes[0].actual_resume_date).not.toBeNull();

    const fresh = db.first<{ end_date: string; status: string }>(
      "SELECT end_date, status FROM member_subscriptions WHERE id = ?",
      [sub.id],
    )!;
    expect(fresh.status).toBe("active");
  });
});
