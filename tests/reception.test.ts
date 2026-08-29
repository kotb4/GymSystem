import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  assignCardByBarcode,
  setCardBlocked,
  registerCard,
  reportCardLost,
} from "@/core/services/cards.service";
import { createMember, setMemberStatus } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription, freezeSubscription } from "@/core/services/subscriptions.service";
import * as reception from "@/core/services/reception.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let reception_actor: ServiceActor;
let trainer: ServiceActor;

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
  reception_actor = buildActor(
    await createUser(db, owner, {
      username: "reception",
      password: "Recep@2026",
      fullName: "استقبال",
      roleId: "reception",
    }),
  );
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
});

async function activeMemberWithSub(name: string) {
  const member = await createMember(db, owner, { fullName: name });
  const plan = await createPlan(db, owner, { name: `${name}-باقة`, durationDays: 30, price: 300 });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  return { member, plan, sub };
}

describe("reception service authorization", () => {
  it("rejects lookup/search/checkIn for roles without reception.view", async () => {
    const member = (await activeMemberWithSub("غير مصرح")).member;
    expect(() => reception.lookup(db, trainer, { memberId: member.id })).toThrow();
    expect(() => reception.search(db, trainer, "غير")).toThrow();
    await expect(
      reception.checkIn(db, trainer, { memberId: member.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reception lookup eligibility", () => {
  it("resolves an eligible member by barcode", async () => {
    const { member } = await activeMemberWithSub("سليم");
    await assignCardByBarcode(db, reception_actor, {
      barcodeValue: "GYM-REC-1001",
      memberId: member.id,
    });
    const res = reception.lookup(db, reception_actor, { barcode: "gym-rec-1001" });
    expect(res.source).toBe("barcode");
    expect(res.barcode).toBe("GYM-REC-1001");
    expect(res.member?.fullName).toBe("سليم");
    expect(res.eligibility?.eligible).toBe(true);
    expect(res.eligibility?.reason).toBe("VALID");
  });

  it("resolves an eligible member by member id", async () => {
    const { member } = await activeMemberWithSub("بالكود");
    const res = reception.lookup(db, reception_actor, { memberId: member.id });
    expect(res.member?.id).toBe(member.id);
    expect(res.source).toBe("member");
    expect(res.eligibility?.eligible).toBe(true);
  });

  it("flags an expired subscription (no active subscription)", async () => {
    const member = await createMember(db, owner, { fullName: "منتهي" });
    const plan = await createPlan(db, owner, { name: "قديم", durationDays: 30, price: 100 });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: addDaysLocal(-40),
    });
    const res = reception.lookup(db, reception_actor, { memberId: member.id });
    expect(res.eligibility?.eligible).toBe(false);
    expect(res.eligibility?.reason).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  it("flags an inactive member", async () => {
    const { member } = await activeMemberWithSub("موقوف");
    await setMemberStatus(db, owner, member.id, "suspended");
    const res = reception.lookup(db, reception_actor, { memberId: member.id });
    expect(res.eligibility?.reason).toBe("MEMBER_INACTIVE");
    expect(res.eligibility?.eligible).toBe(false);
  });

  it("flags a frozen subscription", async () => {
    const { member, sub } = await activeMemberWithSub("مجمد");
    const subEnd = (
      db.first<{ end_date: string }>("SELECT end_date FROM member_subscriptions WHERE id = ?", [sub.id])!
    ).end_date;
    await freezeSubscription(db, owner, sub.id, { endDate: subEnd, reason: "سفر" });
    const res = reception.lookup(db, reception_actor, { memberId: member.id });
    expect(res.eligibility?.reason).toBe("FROZEN");
    expect(res.eligibility?.eligible).toBe(false);
  });

  it("flags an exhausted sessions plan", async () => {
    const member = await createMember(db, owner, { fullName: "حصص" });
    const plan = await createPlan(db, owner, {
      name: "باقة حصص",
      durationDays: 60,
      price: 150,
      kind: "sessions",
      sessionsCount: 1,
    });
    const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    db.run("UPDATE member_subscriptions SET sessions_used = sessions_total WHERE id = ?", [sub.id]);
    const res = reception.lookup(db, reception_actor, { memberId: member.id });
    expect(res.eligibility?.reason).toBe("NO_SESSIONS_LEFT");
    expect(res.eligibility?.sessionsRemaining).toBe(0);
    expect(res.eligibility?.eligible).toBe(false);
  });

  it("returns an unknown-card lookup for an unknown barcode", async () => {
    const res = reception.lookup(db, reception_actor, { barcode: "GYM-NOPE-99" });
    expect(res.member).toBeNull();
    expect(res.eligibility?.reason).toBe("CARD_UNKNOWN");
    expect(res.eligibility?.eligible).toBe(false);
  });

  it("surfaces card status reasons (lost / blocked)", async () => {
    const { member } = await activeMemberWithSub("كارت تالف");
    const lost = await assignCardByBarcode(db, owner, {
      barcodeValue: "GYM-REC-2001",
      memberId: member.id,
    });
    await reportCardLost(db, owner, lost.card.id);
    expect(reception.lookup(db, reception_actor, { barcode: "GYM-REC-2001" }).eligibility?.reason).toBe(
      "CARD_LOST",
    );

    const blocked = await assignCardByBarcode(db, owner, {
      barcodeValue: "GYM-REC-2002",
      memberId: member.id,
    });
    await setCardBlocked(db, owner, blocked.card.id, true);
    expect(reception.lookup(db, reception_actor, { barcode: "GYM-REC-2002" }).eligibility?.reason).toBe(
      "CARD_BLOCKED",
    );
  });
});

describe("reception search", () => {
  it("returns matching members with eligibility", async () => {
    await activeMemberWithSub("أحمد محمد");
    await activeMemberWithSub("أحمد علي");
    await activeMemberWithSub("سارة");
    const results = reception.search(db, reception_actor, "أحمد");
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.member.fullName).toContain("أحمد");
      expect(r.eligibility).toBeDefined();
    }
  });
});

describe("reception check-in", () => {
  it("checks in a member with an assigned card by member id", async () => {
    const { member } = await activeMemberWithSub("حاضر بكارت");
    await assignCardByBarcode(db, reception_actor, {
      barcodeValue: "GYM-REC-3001",
      memberId: member.id,
    });
    const result = await reception.checkIn(db, reception_actor, { memberId: member.id });
    expect(result.kind).toBe("success");
  });

  it("auto-creates and assigns a card for a member without one", async () => {
    const { member } = await activeMemberWithSub("بلا كارت");
    const before = db.count("SELECT COUNT(*) FROM cards WHERE member_id = ?", [member.id]);
    expect(before).toBe(0);

    const result = await reception.checkIn(db, reception_actor, { memberId: member.id });
    expect(result.kind).toBe("success");

    const after = db.count("SELECT COUNT(*) FROM cards WHERE member_id = ? AND status = 'assigned'", [
      member.id,
    ]);
    expect(after).toBe(1);
  });

  it("checks in by scanned barcode", async () => {
    const { member } = await activeMemberWithSub("بالباركود");
    await assignCardByBarcode(db, reception_actor, {
      barcodeValue: "GYM-REC-4001",
      memberId: member.id,
    });
    const result = await reception.checkIn(db, reception_actor, { barcode: "GYM-REC-4001" });
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.memberName).toBe("بالباركود");
  });

  it("flags a duplicate check-in within the window", async () => {
    const { member } = await activeMemberWithSub("تكرار استقبال");
    await assignCardByBarcode(db, reception_actor, {
      barcodeValue: "GYM-REC-5001",
      memberId: member.id,
    });
    expect((await reception.checkIn(db, reception_actor, { barcode: "GYM-REC-5001" })).kind).toBe(
      "success",
    );
    const second = await reception.checkIn(db, reception_actor, { barcode: "GYM-REC-5001" });
    expect(second.kind).toBe("duplicate");
  });

  it("checks in by barcode for a pre-registered available card assigned on the fly", async () => {
    const { member } = await activeMemberWithSub("كارت متاح");
    await registerCard(db, reception_actor, { barcodeValue: "GYM-REC-6001" });
    await assignCardByBarcode(db, reception_actor, {
      barcodeValue: "GYM-REC-6001",
      memberId: member.id,
    });
    const result = await reception.checkIn(db, reception_actor, { barcode: "GYM-REC-6001" });
    expect(result.kind).toBe("success");
  });
});

function addDaysLocal(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
