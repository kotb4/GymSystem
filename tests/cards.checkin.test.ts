import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import {
  assignCardByBarcode,
  autoGenerateCards,
  getCardStats,
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
import {
  deleteAttendance,
  recordCheckIn,
  restoreAttendance,
} from "@/core/services/attendance.service";
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

  it("denies check-in for frozen subscriptions without auto-unfreezing", async () => {
    const member = await activeMemberWithSub("مجمد-دخول");
    const sub = db.first<{ id: string; end_date: string }>(
      "SELECT id, end_date FROM member_subscriptions WHERE member_id = ?",
      [member.id],
    )!;
    const { freezeSubscription } = await import("@/core/services/subscriptions.service");
    await freezeSubscription(db, owner, sub.id, { endDate: sub.end_date, reason: "سفر" });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-FRZ-01", memberId: member.id });

    const result = await recordCheckIn(db, reception, { barcode: "GYM-FRZ-01" });
    expect(result).toMatchObject({
      kind: "denied",
      reason: "FROZEN",
      memberId: member.id,
    });

    const subAfter = db.first<{ status: string }>(
      "SELECT status FROM member_subscriptions WHERE id = ?",
      [sub.id],
    )!;
    expect(subAfter.status).toBe("suspended");
  });

  it("flags duplicate scans for trial members within duplicate window", async () => {
    const { createTrial } = await import("@/core/services/trials.service");
    const member = await createMember(db, owner, { fullName: "تجربة-مكرر" });
    await createTrial(db, owner, {
      trialType: "day_1",
      memberId: member.id,
    });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-TRL-01", memberId: member.id });

    const first = await recordCheckIn(db, reception, { barcode: "GYM-TRL-01" });
    expect(first.kind).toBe("success");

    const second = await recordCheckIn(db, reception, { barcode: "GYM-TRL-01" });
    expect(second.kind).toBe("duplicate");
  });

  it("double scanning a session-plan member within the window consumes only ONE session", async () => {
    const member = await createMember(db, owner, { fullName: "حصص-مكرر" });
    const plan = await createPlan(db, owner, {
      name: "أعضاء-باقة",
      durationDays: 30,
      price: 300,
      kind: "sessions",
      sessionsCount: 5,
    });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-SESS-01", memberId: member.id });

    const first = await recordCheckIn(db, reception, { barcode: "GYM-SESS-01" });
    expect(first.kind).toBe("success");
    // Two very quick follow-up scans hit the duplicate window: both must be
    // rejected as duplicates, not consume additional session credits.
    const second = await recordCheckIn(db, reception, { barcode: "GYM-SESS-01" });
    const third = await recordCheckIn(db, reception, { barcode: "GYM-SESS-01" });
    expect(second.kind).toBe("duplicate");
    expect(third.kind).toBe("duplicate");

    const used = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE member_id = ?",
      [member.id],
    )!;
    expect(Number(used.sessions_used)).toBe(1);
  });

  it("deleteAttendance restores session count and restoreAttendance re-consumes it", async () => {
    const member = await createMember(db, owner, { fullName: "حضور-استرجاع" });
    const plan = await createPlan(db, owner, {
      name: "باقة-حضور",
      durationDays: 30,
      price: 200,
      kind: "sessions",
      sessionsCount: 10,
    });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-SESS-99", memberId: member.id });

    const checkIn = await recordCheckIn(db, reception, { barcode: "GYM-SESS-99" });
    expect(checkIn.kind).toBe("success");
    if (checkIn.kind !== "success") return;
    expect(checkIn.memberId).toBe(member.id);

    let used = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE member_id = ?",
      [member.id],
    )!;
    expect(Number(used.sessions_used)).toBe(1);

    // Receptionist lacks checkin.delete by default
    expect(() => deleteAttendance(db, reception, checkIn.attendanceId)).toThrow();

    // Owner has checkin.delete -> deletes checkin and restores session credit
    deleteAttendance(db, owner, checkIn.attendanceId);

    used = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE member_id = ?",
      [member.id],
    )!;
    expect(Number(used.sessions_used)).toBe(0);

    const attRow = db.first<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM attendance WHERE id = ?",
      [checkIn.attendanceId],
    )!;
    expect(attRow.deleted_at).toBeTruthy();

    // Restore attendance re-consumes the session
    restoreAttendance(db, owner, checkIn.attendanceId);

    used = db.first<{ sessions_used: number }>(
      "SELECT sessions_used FROM member_subscriptions WHERE member_id = ?",
      [member.id],
    )!;
    expect(Number(used.sessions_used)).toBe(1);

    const attRowRestored = db.first<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM attendance WHERE id = ?",
      [checkIn.attendanceId],
    )!;
    expect(attRowRestored.deleted_at).toBeNull();
  });

  it("denies check-in when member is restricted to home branch and scanned at a different branch", async () => {
    // Member created with branch_id 'main' and homeBranchOnly true
    const member = await createMember(db, owner, {
      fullName: "عضو-فرع-رئيسي-فقط",
      homeBranchOnly: true,
    });
    const plan = await createPlan(db, owner, {
      name: "باقة-فرع",
      durationDays: 30,
      price: 200,
    });
    await createSubscription(db, owner, { memberId: member.id, planId: plan.id });
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-BRANCH-01", memberId: member.id });

    // When current branch matches member.branch_id ('main'), check-in succeeds
    const ok = await recordCheckIn(db, reception, { barcode: "GYM-BRANCH-01" });
    expect(ok.kind).toBe("success");

    // Simulate changing current local branch to 'branch-2'
    db.run("UPDATE branch_info SET branch_id = 'branch-2'");

    // Scan again at different branch: rejected with BRANCH_NOT_ALLOWED
    const denied = await recordCheckIn(db, reception, { barcode: "GYM-BRANCH-01" });
    expect(denied).toMatchObject({
      kind: "denied",
      reason: "BRANCH_NOT_ALLOWED",
      memberName: "عضو-فرع-رئيسي-فقط",
    });

    // Reset branch_info back to 'main'
    db.run("UPDATE branch_info SET branch_id = 'main'");
  });

  it("calculates card stats telemetry accurately", async () => {
    const member = await activeMemberWithSub("عضو-إحصائيات-الكروت");
    // Register 2 physical available cards
    await registerCard(db, reception, { barcodeValue: "GYM-STAT-001" });
    const card2 = await registerCard(db, reception, { barcodeValue: "GYM-STAT-002" });
    // Assign 1 card
    await assignCardByBarcode(db, reception, { barcodeValue: "GYM-STAT-001", memberId: member.id });
    // Block card2 (requires cards.block - owner)
    await setCardBlocked(db, owner, card2.id, true);

    const stats = getCardStats(db, reception);
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.assigned).toBeGreaterThanOrEqual(1);
    expect(stats.blocked).toBeGreaterThanOrEqual(1);
    expect(stats.physical).toBeGreaterThanOrEqual(2);
  });

  it("auto generates sequential batch cards with custom prefix", async () => {
    const res = await autoGenerateCards(db, reception, { count: 5, prefix: "TEST-SEQ" });
    expect(res.count).toBe(5);
    expect(res.registered).toHaveLength(5);
    expect(res.fromBarcode).toBe("TEST-SEQ-000101");
    expect(res.toBarcode).toBe("TEST-SEQ-000105");

    // Second batch continues from where it left off
    const nextBatch = await autoGenerateCards(db, reception, { count: 3, prefix: "TEST-SEQ" });
    expect(nextBatch.count).toBe(3);
    expect(nextBatch.fromBarcode).toBe("TEST-SEQ-000106");
    expect(nextBatch.toBarcode).toBe("TEST-SEQ-000108");
  });

  it("filters cards by lost_or_blocked", async () => {
    const c1 = await registerCard(db, reception, { barcodeValue: "GYM-LST-001" });
    const c2 = await registerCard(db, reception, { barcodeValue: "GYM-BLK-001" });
    await reportCardLost(db, owner, c1.id);
    await setCardBlocked(db, owner, c2.id, true);

    const list = listCards(db, reception, { status: "lost_or_blocked" });
    const barcodes = list.items.map((i) => i.barcodeValue);
    expect(barcodes).toContain("GYM-LST-001");
    expect(barcodes).toContain("GYM-BLK-001");
  });
});

describe("barcode hardware scanner burst detection", () => {
  it("normalizes Arabic keyboard layout scan codes to standard English", async () => {
    const { normalizeBarcodeString } = await import("@/core/barcode/barcode-input");
    expect(normalizeBarcodeString("لا1-ةثة-000001")).toBe("B1-MEM-000001");
  });

  it("detects rapid keystrokes burst (<50ms) ending in Enter even inside typing target", async () => {
    const { attachGlobalBarcodeScanner } = await import("@/core/barcode/barcode-input");
    const scanned: string[] = [];
    const listeners: Record<string, ((e: any) => void)[]> = {};
    const mockWindow = {
      addEventListener: (type: string, fn: any) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
    };
    (globalThis as any).window = mockWindow;

    // Mock HTMLInputElement typing target
    class MockInputElement {
      tagName = "INPUT";
      dataset: Record<string, string> = {};
      value = "ExistingText";
      dispatched: any[] = [];
      dispatchEvent(e: any) {
        this.dispatched.push(e);
        return true;
      }
    }
    (globalThis as any).HTMLInputElement = MockInputElement;
    (globalThis as any).HTMLElement = MockInputElement;

    const detach = attachGlobalBarcodeScanner((code) => {
      scanned.push(code);
    }, { minLength: 4 });

    const inputElement = new MockInputElement();

    const fireKey = (key: string, code: string, target: any) => {
      let prevented = false;
      let stopped = false;
      const evt = {
        key,
        code,
        target,
        repeat: false,
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; },
      };
      for (const listener of listeners["keydown"] || []) {
        listener(evt);
      }
      return { prevented, stopped };
    };

    // Simulate hardware scanner sending "MEM1" with rapid intervals into input element
    inputElement.value += "M";
    fireKey("M", "KeyM", inputElement);
    inputElement.value += "E";
    fireKey("E", "KeyE", inputElement);
    inputElement.value += "M";
    fireKey("M", "KeyM", inputElement);
    inputElement.value += "1";
    fireKey("1", "Digit1", inputElement);

    const enterRes = fireKey("Enter", "Enter", inputElement);
    expect(enterRes.prevented).toBe(true);
    expect(scanned).toContain("MEM1");
    // Leaked characters from burst must be cleared from the input value
    expect(inputElement.value).toBe("ExistingText");

    detach();
  });
});

function addDaysLocal(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
