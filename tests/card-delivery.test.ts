import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember, updateMember } from "@/core/services/members.service";
import { registerCard, listMemberCards, type CardWithMember } from "@/core/services/cards.service";
import {
  queueCardDelivery,
  sendPendingCardDeliveries,
  listCardDeliveries,
  countPendingCardDeliveries,
} from "@/core/services/card-delivery.service";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;
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
  manager = buildActor(
    await createUser(db, owner, {
      username: "manager",
      password: "Mgr@2026",
      fullName: "مدير",
      roleId: "manager",
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
  trainer = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
  process.env.GYM_CRM_MOCK = "1";
});

afterEach(() => {
  delete process.env.GYM_CRM_MOCK;
});

async function memberWithPhone(fullName = "عميل واتساب", phone: string | null = "01012345678") {
  return createMember(db, owner, { fullName, phone, department: "general" });
}

function memberCard(memberId: string): CardWithMember {
  const cards = listMemberCards(db, manager, memberId);
  return cards[0];
}

describe("card-delivery service (TASK-044)", () => {
  it("rejects queue/list/count/send without cards.send (trainer)", async () => {
    const member = await memberWithPhone();
    const card = memberCard(member.id);
    await expect(queueCardDelivery(db, trainer, { cardId: card.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(() => listCardDeliveries(db, trainer, {})).toThrow();
    expect(() => countPendingCardDeliveries(db, trainer)).toThrow();
    await expect(sendPendingCardDeliveries(db, trainer, 10)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects queueing for an unassigned card", async () => {
    const card = await registerCard(db, owner, { barcodeValue: "GYM-DEL-9001" });
    await expect(queueCardDelivery(db, manager, { cardId: card.id })).rejects.toMatchObject({
      code: "VALIDATION",
      messageKey: "errors.cardNotAssigned",
    });
  });

  it("allows reception to queue and list deliveries", async () => {
    const member = await memberWithPhone();
    const queued = await queueCardDelivery(db, reception, { cardId: memberCard(member.id).id });
    expect(queued.status).toBe("pending");
    expect(listCardDeliveries(db, reception, { memberId: member.id })).toHaveLength(1);
  });

  it("queues then mock-sends exactly once (dedupe guard)", async () => {
    const member = await memberWithPhone();
    const card = memberCard(member.id);

    const queued = await queueCardDelivery(db, manager, { cardId: card.id });
    expect(queued.status).toBe("pending");
    expect(queued.memberId).toBe(member.id);
    expect(queued.barcodeValue).toBe(member.memberCode);
    expect(queued.phone).toBe("01012345678");

    const result = await sendPendingCardDeliveries(db, manager, 10);
    expect(result.sent).toBe(1);
    expect(countPendingCardDeliveries(db, manager)).toBe(0);

    const history = listCardDeliveries(db, manager, { memberId: member.id });
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("sent");
    expect(history[0].sentAt).not.toBeNull();

    // Idempotent: re-queueing returns the sent record, does not resend.
    const again = await queueCardDelivery(db, manager, { cardId: card.id });
    expect(again.status).toBe("sent");
    expect(listCardDeliveries(db, manager, { memberId: member.id })).toHaveLength(1);
  });

  it("marks skipped_no_phone when the member has no phone", async () => {
    const member = await memberWithPhone("بلا رقم", null);
    await queueCardDelivery(db, manager, { cardId: memberCard(member.id).id });
    const result = await sendPendingCardDeliveries(db, manager, 10);
    expect(result.skippedNoPhone).toBe(1);
    const history = listCardDeliveries(db, manager, { memberId: member.id });
    expect(history[0].status).toBe("skipped_no_phone");
  });

  it("marks not_configured when whatsapp is disabled even in mock mode", async () => {
    process.env.GYM_CRM_MOCK = "";
    const member = await memberWithPhone();
    await queueCardDelivery(db, manager, { cardId: memberCard(member.id).id });
    const result = await sendPendingCardDeliveries(db, manager, 10);
    expect(result.notConfigured).toBe(1);
    const history = listCardDeliveries(db, manager, { memberId: member.id });
    expect(history[0].status).toBe("not_configured");
  });

  it("re-queues a failed delivery to pending (reuses the row, no UNIQUE crash)", async () => {
    process.env.GYM_CRM_MOCK = "";
    const member = await memberWithPhone();
    const card = memberCard(member.id);
    // First attempt ends terminal (not_configured in mock-off, failed if transport errors).
    await queueCardDelivery(db, manager, { cardId: card.id });
    const first = await sendPendingCardDeliveries(db, manager, 10);
    expect(first.notConfigured + first.failed).toBe(1);

    // Re-queue once WhatsApp is enabled again — must flip the SAME row to
    // pending, never attempt a second INSERT (dedupe_key is UNIQUE).
    process.env.GYM_CRM_MOCK = "1";
    const re = await queueCardDelivery(db, manager, { cardId: card.id });
    expect(re.status).toBe("pending");
    expect(re.error).toBeNull();

    const history = listCardDeliveries(db, manager, { memberId: member.id });
    expect(history).toHaveLength(1); // still one row
    expect(history[0].status).toBe("pending");
    expect(countPendingCardDeliveries(db, manager)).toBe(1);

    // And it actually sends now.
    const sent = await sendPendingCardDeliveries(db, manager, 10);
    expect(sent.sent).toBe(1);
  });

  it("re-queues a skipped_no_phone row once the member gets a phone", async () => {
    const member = await memberWithPhone("بلا رقم لاحقاً", null);
    const card = memberCard(member.id);
    await queueCardDelivery(db, manager, { cardId: card.id });
    const first = await sendPendingCardDeliveries(db, manager, 10);
    expect(first.skippedNoPhone).toBe(1);

    // Member now has a phone → re-queue updates the snapshot and re-sends.
    await updateMember(db, manager, member.id, { fullName: "بلا رقم لاحقاً", phone: "01099998888" });
    const re = await queueCardDelivery(db, manager, { cardId: card.id });
    expect(re.status).toBe("pending");
    expect(re.phone).toBe("01099998888");
    const sent = await sendPendingCardDeliveries(db, manager, 10);
    expect(sent.sent).toBe(1);
    expect(listCardDeliveries(db, manager, { memberId: member.id })).toHaveLength(1);
  });

  it("listCardDeliveries filters by status and limits rows", async () => {
    const m1 = await memberWithPhone("أول", "01000000000");
    const m2 = await memberWithPhone("ثاني", "01011112222");
    await queueCardDelivery(db, owner, { cardId: memberCard(m1.id).id });
    await queueCardDelivery(db, owner, { cardId: memberCard(m2.id).id });
    await sendPendingCardDeliveries(db, owner, 10);

    const all = listCardDeliveries(db, owner, { status: "sent" });
    expect(all).toHaveLength(2);
    const capped = listCardDeliveries(db, owner, { limit: 1 });
    expect(capped).toHaveLength(1);
    const pendingOnly = listCardDeliveries(db, owner, { status: "pending" });
    expect(pendingOnly).toHaveLength(0);
  });

  it("rejects queueing for an unknown card", async () => {
    await expect(
      queueCardDelivery(db, owner, { cardId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});