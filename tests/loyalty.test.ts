import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription, renewSubscription } from "@/core/services/subscriptions.service";
import { assignCardByBarcode } from "@/core/services/cards.service";
import { recordCheckIn, memberOutstandingMinor } from "@/core/services/attendance.service";
import { createProduct, createSale, voidStoreSale } from "@/core/services/store.service";
import { createReferral, convertReferral } from "@/core/services/referral.service";
import {
  getLoyaltySettings,
  updateLoyaltySettings,
  getEarnRules,
  upsertEarnRule,
  removeEarnRule,
  getRedemptionCatalog,
  upsertRedemption,
  setRedemptionActive,
  getMemberBalance,
  listMemberTransactions,
  adjustPoints,
  redeemReward,
  applyEarnRule,
  earnPoints,
  reverseEarnedPoints,
  memberBalance,
} from "@/core/services/loyalty.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    expect.unreachable("expected to throw");
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}


let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;

async function member(name = "عضو ولاء") {
  return createMember(db, owner, {
    fullName: name,
    phone: `011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  });
}

async function activeSub(memberId: string) {
  const plan = await createPlan(db, owner, {
    name: `باقة ${Math.random().toString(36).slice(2, 7)}`,
    durationDays: 30,
    price: 300,
  });
  return createSubscription(db, owner, { memberId, planId: plan.id });
}

async function product(name = "منتج ولاء") {
  return createProduct(db, owner, { name, costMinor: 5000, priceMinor: 10000, stockQty: 20, minStockQty: 5 });
}

function seedPoints(memberId: string, points: number, reason = "تهيئة") {
  return adjustPoints(db, manager, memberId, points, reason);
}

function discountReward(title: string, pointsCost: number, valueMinor: number) {
  return upsertRedemption(db, manager, { rewardType: "discount", title, pointsCost, valueMinor });
}

function customReward(title: string, pointsCost: number) {
  return upsertRedemption(db, manager, { rewardType: "custom", title, pointsCost });
}

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
      password: "Manager@2026",
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
});

describe("loyalty: rules + settings", () => {
  it("seeds default earn rules and reads them", () => {
    const rules = getEarnRules(db, manager);
    expect(rules.length).toBeGreaterThanOrEqual(4);
    const checkin = rules.find((r) => r.action === "checkin");
    expect(checkin?.enabled).toBe(true);
    expect(getLoyaltySettings(db, manager).rewardEnabled).toBe(true);
  });

  it("upserts a rule and removes it", () => {
    upsertEarnRule(db, manager, { action: "checkin", points: 7, enabled: true });
    const after = getEarnRules(db, manager).find((r) => r.action === "checkin")!;
    expect(after.points).toBe(7);
    removeEarnRule(db, manager, "checkin");
    expect(getEarnRules(db, manager).find((r) => r.action === "checkin")).toBeUndefined();
  });

  it("rejects negative points and invalid actions", () => {
    expectCode(() => upsertEarnRule(db, manager, { action: "checkin", points: -1, enabled: true }), "VALIDATION");
    expectCode(() => upsertEarnRule(db, manager, { action: "chargeback" as never, points: 5, enabled: true }), "VALIDATION");
  });

  it("rejects negative store points per EGP in settings", () => {
    expectCode(() => updateLoyaltySettings(db, manager, { storePointsPerEgp: -1 }), "VALIDATION");
  });

  it("denies rule/settings management to reception", () => {
    expectCode(() => upsertEarnRule(db, reception, { action: "checkin", points: 1, enabled: true }), "FORBIDDEN");
    expectCode(() => getLoyaltySettings(db, reception), "FORBIDDEN");
  });
});

describe("loyalty: redemption catalog", () => {
  it("creates and lists a discount reward and grants credit on redeem", async () => {
    const reward = discountReward("خصم 100 جنيه", 300, 10000);
    expect(reward.active).toBe(true);
    const catalog = getRedemptionCatalog(db, manager);
    expect(catalog.find((r) => r.id === reward.id)?.title).toBe("خصم 100 جنيه");

    const m = await member();
    seedPoints(m.id, 500, "تهيئة");
    const first = redeemReward(db, manager, m.id, reward.id);
    expect(first.creditMinor).toBe(10000);
    expect(first.balanceAfter).toBe(500 - 300);
  });

  it("validates reward types and required fields", () => {
    expectCode(() => upsertRedemption(db, manager, { rewardType: "discount" as never, title: "x", pointsCost: 1 }), "VALIDATION");
    expectCode(() => upsertRedemption(db, manager, { rewardType: "discount", title: "", pointsCost: 1 }), "VALIDATION");
    expectCode(() => upsertRedemption(db, manager, { rewardType: "discount", title: "x", pointsCost: 0 }), "VALIDATION");
    expectCode(() => upsertRedemption(db, manager, { rewardType: "free_days", title: "x", pointsCost: 10 }), "VALIDATION");
  });
});

describe("loyalty: earn + balance", () => {
  it("starts at zero and earns points via earnPoints", async () => {
    const m = await member();
    expect(getMemberBalance(db, owner, m.id).balance).toBe(0);
    earnPoints(db, owner, m.id, "checkin", 5, "attendance", "att-1", "checkin");
    expect(getMemberBalance(db, owner, m.id).balance).toBe(5);
  });

  it("does not double-earn for the same source+ref_id", async () => {
    const m = await member();
    earnPoints(db, owner, m.id, "checkin", 5, "attendance", "att-1", "checkin");
    earnPoints(db, owner, m.id, "checkin", 5, "attendance", "att-1", "checkin");
    expect(getMemberBalance(db, owner, m.id).balance).toBe(5);
    expect(listMemberTransactions(db, owner, m.id).total).toBe(1);
  });

  it("honors a disabled feature (no-op)", async () => {
    const m = await member();
    updateLoyaltySettings(db, manager, { rewardEnabled: false });
    applyEarnRule(db, owner, m.id, "checkin", "attendance", "att-2", { reason: "checkin" });
    expect(getMemberBalance(db, owner, m.id).balance).toBe(0);
  });

  it("awards points on a real check-in (seeded rule = 5)", async () => {
    const m = await member();
    const sub = await activeSub(m.id);
    const barcode = `GYM-LOY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const card = await assignCardByBarcode(db, owner, { barcodeValue: barcode, memberId: m.id });
    const result = await recordCheckIn(db, reception, { barcode: card.card.barcodeValue });
    expect(result.kind).toBe("success");
    expect(getMemberBalance(db, owner, m.id).balance).toBe(5);
  });

  it("awards points on renewal via renewSubscription", async () => {
    const m = await member();
    const sub = await activeSub(m.id);
    await renewSubscription(db, owner, sub.id);
    expect(getMemberBalance(db, owner, m.id).balance).toBe(50);
  });

  it("awards referral points on conversion on top of the referral reward", async () => {
    const referrer = await member("المحيل");
    const referred = await member("المحال إليه");
    const ref = createReferral(db, owner, {
      referrerMemberId: referrer.id,
      referredName: "المحال إليه",
      referredPhone: "01299887766",
    });
    convertReferral(db, owner, ref.id, referred.id);
    const balance = getMemberBalance(db, owner, referrer.id);
    expect(balance.balance).toBeGreaterThanOrEqual(100);
    expect(balance.balance).toBe(balance.earned);
  });
});

describe("loyalty: store purchase integration", () => {
  it("awards points on a member cash sale but not walk-in or credit sales", async () => {
    const m = await member();
    const p = await product();

    await createSale(db, owner, { items: [{ productId: p.id, qty: 1 }], methodCode: "cash" });
    await createSale(db, owner, { items: [{ productId: p.id, qty: 1 }], methodCode: "cash", memberId: m.id, isCredit: true });

    expect(getMemberBalance(db, owner, m.id).balance).toBe(0);

    const cash = await createSale(db, owner, { items: [{ productId: p.id, qty: 1 }], methodCode: "cash", memberId: m.id });
    expect(getMemberBalance(db, owner, m.id).balance).toBe(10);

    await voidStoreSale(db, owner, cash.id, "إلغاء البيع");
    expect(getMemberBalance(db, owner, m.id).balance).toBe(0);
  });
});

describe("loyalty: redemption guards + abuse", () => {
  it("blocks redemption with insufficient points and writes nothing", async () => {
    const m = await member();
    const reward = discountReward("خصم", 100, 5000);
    expectCode(() => redeemReward(db, manager, m.id, reward.id), "CONFLICT");
    expect(listMemberTransactions(db, owner, m.id).total).toBe(0);
  });

  it("blocks redemption of an inactive reward", async () => {
    const m = await member();
    const reward = upsertRedemption(db, manager, { rewardType: "free_days", title: "يوم", pointsCost: 10, days: 1 });
    seedPoints(m.id, 50, "تهيئة");
    setRedemptionActive(db, manager, reward.id, false);
    expectCode(() => redeemReward(db, manager, m.id, reward.id), "CONFLICT");
  });

  it("prevents a negative balance across many sequential redeems (atomicity)", async () => {
    const m = await member();
    seedPoints(m.id, 300, "تهيئة 300");
    const reward = customReward("مكافأة", 100);
    let successes = 0;
    let failed = 0;
    for (let i = 0; i < 10; i++) {
      try {
        redeemReward(db, manager, m.id, reward.id);
        successes++;
      } catch {
        failed++;
      }
    }
    expect(successes).toBe(3);
    expect(failed).toBe(7);
    const bal = getMemberBalance(db, owner, m.id);
    expect(bal.balance).toBe(0);
    expect(bal.balance).toBeGreaterThanOrEqual(0);
  });

  it("keeps the ledger invariant balance == sum(delta) and never negative", async () => {
    const m = await member();
    earnPoints(db, owner, m.id, "checkin", 10, "attendance", "a1", "1");
    earnPoints(db, owner, m.id, "checkin", 10, "attendance", "a2", "2");
    earnPoints(db, owner, m.id, "store_purchase", 5, "store_sales", "s1", "3");
    adjustPoints(db, manager, m.id, -5, "تصحيح");
    const rows = listMemberTransactions(db, owner, m.id).items;
    const sum = rows.reduce((acc, r) => acc + r.delta, 0);
    expect(sum).toBe(memberBalance(db, m.id));
    for (const r of rows) {
      expect(r.balanceAfter).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses manual adjustments that would go negative and requires a reason", async () => {
    const m = await member();
    expectCode(() => adjustPoints(db, manager, m.id, -10, "خصم"), "CONFLICT");
    expectCode(() => adjustPoints(db, manager, m.id, 5, "   "), "VALIDATION");
  });
});

describe("loyalty: credit reduces outstanding (display only)", () => {
  it("reduces memberOutstandingMinor by usable credit without touching the ledger", async () => {
    const m = await member();
    await activeSub(m.id);
    const before = memberOutstandingMinor(db, m.id);
    expect(before).toBe(30000);
    seedPoints(m.id, 300, "تهيئة");
    const reward = discountReward("خصم", 300, 10000);
    redeemReward(db, manager, m.id, reward.id);
    const after = memberOutstandingMinor(db, m.id);
    expect(after).toBe(before - 10000);
  });
});

describe("loyalty: permissions + department scope", () => {
  it("denies reads to roles without loyalty.view", async () => {
    const m = await member();
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Trainer@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    expectCode(() => getMemberBalance(db, trainer, m.id), "FORBIDDEN");
    expectCode(() => getEarnRules(db, trainer), "FORBIDDEN");
  });

  it("blocks store/men staff from women department members", async () => {
    const womenMember = await createMember(db, owner, { fullName: "عضوة", department: "women", phone: `012${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` });
    seedPoints(womenMember.id, 20, "هدية");
    const deal = buildActor(
      await createUser(db, owner, {
        username: "guy",
        password: "Guy@2026",
        fullName: "رجل",
        department: "men",
        roleId: "reception",
      }),
    );
    expectCode(() => getMemberBalance(db, deal, womenMember.id), "FORBIDDEN");
  });

  it("allows manager to manage and reception to view", async () => {
    const m = await member();
    expect(getMemberBalance(db, reception, m.id).balance).toBe(0);
    adjustPoints(db, manager, m.id, 20, "هدية");
    expect(getMemberBalance(db, reception, m.id).balance).toBe(20);
  });
});