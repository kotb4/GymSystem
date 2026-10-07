import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  assignCardByBarcode,
  deleteCard,
  getCardByBarcode,
  getCardById,
  listMemberCards,
  registerCard,
  unassignCard,
} from "@/core/services/cards.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { errConflict, errForbidden, errNotFound } from "@/core/errors";
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

/** Member with a live subscription so their card can actually check in. */
async function memberWithSub(name: string) {
  const member = await createMember(db, owner, { fullName: name });
  const plan = await createPlan(db, owner, { name: `${name}-باقة`, durationDays: 30, price: 300 });
  await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
  return member;
}

async function auditActions(action: string): Promise<number> {
  return db.count("SELECT COUNT(*) FROM audit_logs WHERE action = ?", [action]);
}

describe("deleteCard — virtual cards are always protected", () => {
  it("refuses a virtual card in safe mode", async () => {
    const member = await memberWithSub("كارت افتراضي");
    const card = listMemberCards(db, reception, member.id)[0];
    expect(card.kind).toBe("virtual");

    await expect(deleteCard(db, owner, card.id)).rejects.toThrow(
      errConflict("errors.cardVirtualCannotDelete"),
    );
  });

  it("refuses a virtual card even with force — the member would lose check-in", async () => {
    const member = await memberWithSub("كارت افتراضي قهري");
    const card = listMemberCards(db, reception, member.id)[0];

    await expect(deleteCard(db, owner, card.id, { force: true })).rejects.toThrow(
      errConflict("errors.cardVirtualCannotDelete"),
    );
    // Still there, still scannable by member code.
    expect(getCardByBarcode(db, member.memberCode)).not.toBeNull();
  });
});

describe("deleteCard — safe mode guards", () => {
  it("refuses a physical card that is still assigned to a member", async () => {
    const member = await memberWithSub("صاحب كارت مربوط");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-001",
      memberId: member.id,
    });
    expect(card.status).toBe("assigned");

    await expect(deleteCard(db, owner, card.id)).rejects.toThrow(
      errConflict("errors.cardAssignedCannotDelete"),
    );
    expect(getCardById(db, card.id)).not.toBeNull();
  });

  it("refuses a physical card that already has attendance history", async () => {
    const member = await memberWithSub("صاحب كارت حضور");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-002",
      memberId: member.id,
    });
    // Check in while the card is linked (that is the only way attendance gets
    // a card_id), then release it so the *attendance* guard is the one hit.
    await recordCheckIn(db, reception, { barcode: "GYM-DEL-002" });
    await unassignCard(db, owner, card.id);

    await expect(deleteCard(db, owner, card.id)).rejects.toThrow(
      errConflict("errors.cardHasAttendanceCannotDelete"),
    );
    expect(getCardById(db, card.id)).not.toBeNull();
  });

  it("deletes a plain available physical card", async () => {
    const card = await registerCard(db, reception, { barcodeValue: "GYM-DEL-003" });

    const result = await deleteCard(db, owner, card.id);
    expect(result).toEqual({ unassigned: false, detachedAttendance: 0 });
    expect(getCardById(db, card.id)).toBeNull();
  });

  it("throws NOT_FOUND for an unknown card", async () => {
    await expect(deleteCard(db, owner, "card_does_not_exist")).rejects.toThrow(
      errNotFound("errors.cardNotFound"),
    );
  });
});

describe("deleteCard — force mode", () => {
  it("deletes an ASSIGNED physical card and releases it from the member", async () => {
    const member = await memberWithSub("صاحب كارت مربوط قهري");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-010",
      memberId: member.id,
    });

    const result = await deleteCard(db, owner, card.id, { force: true });
    expect(result).toEqual({ unassigned: true, detachedAttendance: 0 });
    expect(getCardById(db, card.id)).toBeNull();
    // The member is left with only their virtual card, not a dangling physical one.
    const remaining = listMemberCards(db, reception, member.id);
    expect(remaining.every((c) => c.kind === "virtual")).toBe(true);
    expect(remaining.some((c) => c.barcodeValue === "GYM-DEL-010")).toBe(false);
  });

  it("keeps attendance history but detaches it from the deleted card", async () => {
    const member = await memberWithSub("صاحب كارت حضور قهري");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-011",
      memberId: member.id,
    });
    await recordCheckIn(db, reception, { barcode: "GYM-DEL-011" });

    const before = db.count("SELECT COUNT(*) FROM attendance WHERE member_id = ?", [member.id]);
    expect(before).toBe(1);

    const result = await deleteCard(db, owner, card.id, { force: true });
    expect(result.unassigned).toBe(true);
    expect(result.detachedAttendance).toBe(1);

    // Card gone, attendance row preserved with a NULL card link.
    expect(getCardById(db, card.id)).toBeNull();
    const rows = db.all<{ id: string; card_id: string | null }>(
      "SELECT id, card_id FROM attendance WHERE member_id = ?",
      [member.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].card_id).toBeNull();
  });

  it("cleans up card_deliveries so the FK stays satisfied", async () => {
    const member = await memberWithSub("صاحب كارت تسليم");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-012",
      memberId: member.id,
    });
    db.run(
      "INSERT INTO card_deliveries (id, member_id, card_id, barcode_value, member_name, phone, status, dedupe_key, created_at)\n" +
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      [
        "cd_test_1",
        member.id,
        card.id,
        "GYM-DEL-012",
        member.fullName,
        "01000000000",
        `card:${card.id}:v1`,
        new Date().toISOString(),
      ],
    );

    await deleteCard(db, owner, card.id, { force: true });
    expect(db.count("SELECT COUNT(*) FROM card_deliveries WHERE card_id = ?", [card.id])).toBe(0);
  });

  it("records an audit trail for the forced delete", async () => {
    const member = await memberWithSub("صاحب كارت تدقيق");
    const { card } = await assignCardByBarcode(db, reception, {
      barcodeValue: "GYM-DEL-013",
      memberId: member.id,
    });

    const before = await auditActions("CARD_DELETED");
    await deleteCard(db, owner, card.id, { force: true });
    expect(await auditActions("CARD_DELETED")).toBe(before + 1);
  });

  it("is idempotent-safe: a second delete of the same card is NOT_FOUND", async () => {
    const card = await registerCard(db, reception, { barcodeValue: "GYM-DEL-014" });
    await deleteCard(db, owner, card.id, { force: true });

    await expect(deleteCard(db, owner, card.id, { force: true })).rejects.toThrow(
      errNotFound("errors.cardNotFound"),
    );
  });
});

describe("deleteCard — authorization", () => {
  it("denies a role without cards.delete", async () => {
    const trainer = buildActor(
      await createUser(db, owner, {
        username: "trainer",
        password: "Train@2026",
        fullName: "مدرب",
        roleId: "trainer",
      }),
    );
    const card = await registerCard(db, owner, { barcodeValue: "GYM-DEL-020" });

    await expect(deleteCard(db, trainer, card.id, { force: true })).rejects.toThrow(errForbidden());
  });
});
