import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  assignCardByBarcode,
  listCards,
  registerCard,
  reportCardLost,
  setCardBlocked,
  unassignCard,
} from "@/core/services/cards.service";
import {
  createMember,
  setMemberStatus,
} from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

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

async function activeMemberWithSub(name: string) {
  const member = await createMember(db, owner, { fullName: name });
  const plan = await createPlan(db, owner, { name: `${name}-باقة`, durationDays: 30, price: 300 });
  await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  return member;
}

describe("cards service", () => {
  it("registers pre-printed barcodes and rejects duplicates", async () => {
    const card = await registerCard(db, reception, { barcodeValue: "gym-000201" });
    expect(card.barcodeValue).toBe("GYM-000201");
    expect(card.status).toBe("available");
    await expect(
      registerCard(db, reception, { barcodeValue: "GYM-000201" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("assigns cards and auto-registers unknown barcodes", async () => {
    const member = await activeMemberWithSub("صاحب كارت");
    const result = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-999001",
      memberId: member.id,
    });
    expect(result.registeredNew).toBe(true);
    expect(result.card.status).toBe("assigned");

    const again = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-999001",
      memberId: member.id,
    });
    expect(again.registeredNew).toBe(false);
  });

  it("refuses assigning a card held by another member", async () => {
    const first = await activeMemberWithSub("الأول");
    const second = await activeMemberWithSub("الثاني");
    await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-777001",
      memberId: first.id,
    });
    await expect(
      assignCardByBarcode(db, reception, { barcodeValue: "GYM-777001", memberId: second.id }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "errors.cardAssignedOther" });
  });

  it("unassigns with permission and restores availability", async () => {
    const member = await activeMemberWithSub("فك ربط");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-555001",
      memberId: member.id,
    });
    const manager = buildActor(
      await createUser(db, owner, {
        username: "manager",
        password: "Manage@2026",
        fullName: "مدير",
        roleId: "manager",
      }),
    );
    await expect(unassignCard(db, reception, card.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const unassigned = await unassignCard(db, owner, card.id);
    expect(unassigned.status).toBe("available");
    expect(unassigned.memberId).toBeNull();
  });

  it("lost cards keep member link; blocked restore returns to assigned", async () => {
    const member = await activeMemberWithSub("حالات الكارت");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-333001",
      memberId: member.id,
    });

    const lost = await reportCardLost(db, owner, card.id);
    expect(lost.status).toBe("lost");

    const blocked = await setCardBlocked(db, owner, card.id, true);
    expect(blocked.status).toBe("blocked");

    const restored = await setCardBlocked(db, owner, card.id, false);
    expect(restored.status).toBe("assigned");
    expect(restored.memberId).toBe(member.id);
  });

  it("lists cards joined with holder names", async () => {
    const member = await activeMemberWithSub("قائمة الكروت");
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-111001", memberId: member.id });
    const page = listCards(db, owner, { search: "GYM-111001" });
    expect(page.total).toBe(1);
    expect(page.items[0].memberName).toBe("قائمة الكروت");
  });
});

describe("check-in service", () => {
it("records a happy-path check-in", async () => {
const member = await activeMemberWithSub("عضو حاضر");
await assignCardByBarcode(db, reception, { barcodeValue: "GYM-100001", memberId: member.id });
const result = await recordCheckIn(db, reception, { barcode: "GYM-100001" });
expect(result.kind).toBe("success");
if (result.kind === "success") {
expect(result.memberCode).toBe(member.memberCode);
expect(result.planName).toContain("باقة");
}
});

it("surfaces outstanding money at check-in", async () => {
  const member = await createMember(db, owner, { fullName: "عضو مستحق" });
  const { createPlan } = await import("@/core/services/plans.service");
  const { createSubscription } = await import("@/core/services/subscriptions.service");
  const { recordPayment } = await import("@/core/services/payments.service");
  const plan = await createPlan(db, owner, { name: "باقة 500", durationDays: 30, price: 500 });
  const sub = await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  await recordPayment(db, owner, {
    memberId: member.id,
    subscriptionId: sub.id,
    baseAmountMinor: 50_000,
    paidAmountMinor: 40_000,
    methodCode: "cash",
  });

  const assigned = await assignCardByBarcode(db, owner, {
    barcodeValue: "GYM-100010",
    memberId: member.id,
  });
  const result = await recordCheckIn(db, reception, {
    barcode: assigned.card.barcodeValue,
  });
  expect(result.kind).toBe("success");
  if (result.kind === "success") {
    expect(result.outstandingMinor).toBe(10_000);
    expect(result.sessionsRemaining ?? null).toBeNull();
  }
});

  it("denies unknown, lost, blocked and unlinked cards", async () => {
    const unknown = await recordCheckIn(db, reception, { barcode: "GYM-NOPE-01" });
    expect(unknown).toMatchObject({ kind: "denied", reason: "CARD_UNKNOWN" });

    const member = await activeMemberWithSub("حالات دخول");
    const lost = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-100002",
      memberId: member.id,
    });
    await reportCardLost(db, owner, lost.card.id);
    expect(await recordCheckIn(db, reception, { barcode: "GYM-100002" })).toMatchObject({
      kind: "denied",
      reason: "CARD_LOST",
    });

    const blocked = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-100003",
      memberId: member.id,
    });
    await setCardBlocked(db, owner, blocked.card.id, true);
    expect(await recordCheckIn(db, reception, { barcode: "GYM-100003" })).toMatchObject({
      kind: "denied",
      reason: "CARD_BLOCKED",
    });

    await createMember(db, owner, { fullName: "عضو بلا كارت" });
    expect(await recordCheckIn(db, reception, { barcode: "GYM-UNLINKED" })).toMatchObject({
      kind: "denied",
      reason: "CARD_UNKNOWN",
    });
  });

  it("denies inactive members and members without live subscriptions", async () => {
    const suspended = await activeMemberWithSub("موقوف");
    await setMemberStatus(db, owner, suspended.id, "suspended");
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-200001", memberId: suspended.id });
    expect(await recordCheckIn(db, reception, { barcode: "GYM-200001" })).toMatchObject({
      kind: "denied",
      reason: "MEMBER_INACTIVE",
    });

    const expired = await createMember(db, owner, { fullName: "منتهي" });
    const oldPlan = await createPlan(db, owner, { name: "قديم", durationDays: 30, price: 100 });
    const sub = await createSubscription(db, owner, {
      memberId: expired.id,
      planId: oldPlan.id,
      startDate: addDaysLocal(-40),
    });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-200002", memberId: expired.id });
    expect(await recordCheckIn(db, reception, { barcode: "GYM-200002" })).toMatchObject({
      kind: "denied",
      reason: "NO_ACTIVE_SUBSCRIPTION",
    });
    void sub;
  });

  it("flags duplicate scans within the configured window", async () => {
    const member = await activeMemberWithSub("تكرار");
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-300001", memberId: member.id });
    expect(await recordCheckIn(db, reception, { barcode: "GYM-300001" })).toMatchObject({
      kind: "success",
    });
    const second = await recordCheckIn(db, reception, { barcode: "GYM-300001" });
    expect(second.kind).toBe("duplicate");

    const third = await recordCheckIn(db, reception, { barcode: "GYM-300001" });
    expect(third.kind).toBe("duplicate");
  });
});

function addDaysLocal(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
