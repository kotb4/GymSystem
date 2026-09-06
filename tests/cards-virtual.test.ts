import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  ensureVirtualCard,
  listMemberCards,
  listCards,
  getCardByBarcode,
} from "@/core/services/cards.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { unassignCard, setCardBlocked } from "@/core/services/cards.service";
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

describe("virtual cards (TASK-044)", () => {
  it("createMember auto-creates one virtual card whose barcode is the member code", async () => {
    const member = await createMember(db, owner, { fullName: "أحمد محمد" });
    const cards = listMemberCards(db, reception, member.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].barcodeValue).toBe(member.memberCode);
    expect(cards[0].kind).toBe("virtual");
    expect(cards[0].status).toBe("assigned");
    expect(cards[0].memberId).toBe(member.id);
  });

  it("ensureVirtualCard is idempotent and re-links a re-versioned member code", async () => {
    const member = await createMember(db, owner, { fullName: "منى سعيد" });
    const first = ensureVirtualCard(db, { memberId: member.id, memberCode: member.memberCode });
    const second = ensureVirtualCard(db, { memberId: member.id, memberCode: member.memberCode });
    expect(second.id).toBe(first.id);
    expect(listMemberCards(db, reception, member.id)).toHaveLength(1);
  });

  it("a member code scans as a card barcode for check-in attrs", async () => {
    const member = await createMember(db, owner, { fullName: "كارت افتراضي" });
    const plan = await createPlan(db, owner, { name: "باقة الكارت الافتراضي", durationDays: 30, price: 300 });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });

    const card = getCardByBarcode(db, member.memberCode)!;
    expect(card).not.toBeNull();
    expect(card.barcode_value).toBe(member.memberCode);
    expect(card.kind).toBe("virtual");
    expect(card.member_id).toBe(member.id);
  });

  it("physical cards stay physical and listCards kind filter separates them", async () => {
    const member = await createMember(db, owner, { fullName: "كارت مطبوع" });
    const { assignCardByBarcode } = await import("@/core/services/cards.service");
    await assignCardByBarcode(db, owner, { barcodeValue: "GYM-PC-7001", memberId: member.id });
    await unassignCard(db, owner, getCardByBarcode(db, "GYM-PC-7001")!.id);

    const virtualOnly = listCards(db, owner, { kind: "virtual" });
    const physicalOnly = listCards(db, owner, { kind: "physical" });
    expect(virtualOnly.items).toHaveLength(1);
    expect(physicalOnly.items).toHaveLength(1);
    expect(virtualOnly.items[0].kind).toBe("virtual");
    expect(physicalOnly.items[0].barcodeValue).toBe("GYM-PC-7001");
  });

  it("blocking/reporting-lost a virtual card still leaves the member with a scannable fallback", async () => {
    const member = await createMember(db, owner, { fullName: "كارت موقوف" });
    const card = listMemberCards(db, reception, member.id)[0];
    await setCardBlocked(db, owner, card.id, true);
    const updated = getCardByBarcode(db, member.memberCode)!;
    expect(updated.status).toBe("blocked");
  });

  it("migration backfill: a fresh member code card from legacy members is re-marked virtual", async () => {
    // Directly simulate a legacy card whose barcode equals a member code
    // (the pre-v33 "member code as card" path), as v33 would have migrated it.
    const member = await createMember(db, owner, { fullName: "ترقية" });
    const legacy = listMemberCards(db, reception, member.id)[0];
    db.run("UPDATE cards SET kind = 'physical' WHERE id = ?", [legacy.id]);
    const ensured = ensureVirtualCard(db, { memberId: member.id, memberCode: member.memberCode });
    expect(ensured.kind).toBe("virtual");
    expect(ensured.status).toBe("assigned");
  });
});