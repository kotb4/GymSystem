import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { registerCard, assignCardByBarcode } from "@/core/services/cards.service";
import { updateSetting } from "@/core/services/settings.service";
import {
  listRecipients,
  sendMessage,
  sendSegment,
  listMessageHistory,
  getMessagesConfig,
  getMemberMessageData,
  sendWelcomeMessage,
  sendPaymentMessage,
  type MessageRecipient,
} from "@/core/services/messages.service";
import { normalizeEgyMobile, buildWhatsAppDirectUrl, fillMessagePlaceholders } from "@/core/whatsapp";
import { errForbidden, errNotFound, errValidation } from "@/core/errors";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { addDaysKey, setDevOverrideDate, todayKey } from "@/core/dates";
import { createTestDb } from "./helpers/test-db";

const TODAY = "2026-09-19";

let db: Db;
let owner: ServiceActor;
let manager: ServiceActor;
let reception: ServiceActor;
let trainerUser: ServiceActor;
let menReception: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  setDevOverrideDate(TODAY);
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
  trainerUser = buildActor(
    await createUser(db, owner, {
      username: "trainer",
      password: "Train@2026",
      fullName: "مدرب",
      roleId: "trainer",
    }),
  );
  menReception = buildActor(
    await createUser(db, owner, {
      username: "men-recep",
      password: "Recep@2026",
      fullName: "استقبال رجال",
      roleId: "reception",
      department: "men",
    }),
  );
  process.env.GYM_CRM_MOCK = "1";
});

afterEach(() => {
  delete process.env.GYM_CRM_MOCK;
  setDevOverrideDate(null);
});

async function activeMember(
  name: string,
  opts: { department?: "general" | "men" | "women"; phone?: string | null; dob?: string; planDays?: number; startDate?: string } = {},
) {
  const member = await createMember(db, owner, {
    fullName: name,
    phone: opts.phone !== undefined ? opts.phone : `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    department: opts.department ?? "general",
    dateOfBirth: opts.dob ?? null,
  });
  const plan = await createPlan(db, owner, {
    name: `${name}-باقة`,
    durationDays: opts.planDays ?? 30,
    price: 300,
  });
  const sub = await createSubscription(db, owner, {
    memberId: member.id,
    planId: plan.id,
    startDate: opts.startDate,
  });
  const barcode = `GYM-${100000 + Math.floor(Math.random() * 900000)}`;
  const card = await registerCard(db, reception, { barcodeValue: barcode });
  await assignCardByBarcode(db, reception, { barcodeValue: barcode, memberId: member.id });
  return { member, sub, card };
}

/** Directly inserted attendance row with a custom timestamp (recordCheckIn stamps 'now'). */
function insertCheckInAt(memberId: string, cardId: string, subscriptionId: string, onKey: string) {
  db.run(
    "INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, notes)\nVALUES (?, ?, ?, ?, ? || ' 12:00:00', NULL, NULL)",
    [crypto.randomUUID(), memberId, cardId, subscriptionId, onKey],
  );
}

function recipientIds(rows: MessageRecipient[]): Set<string> {
  return new Set(rows.map((r) => r.memberId));
}

describe("messages: recipients (segments)", () => {
  it("denies listRecipients without messages.view (trainer)", async () => {
    expect(() => listRecipients(db, trainerUser, { segment: "absent" })).toThrow(errForbidden());
    expect(() => listRecipients(db, trainerUser, { segment: "birthday" })).toThrow(errForbidden());
  });

  it("rejects unknown segments", async () => {
    expect(() => listRecipients(db, manager, { segment: "mall" as never })).toThrow(
      errValidation("errors.messageSegmentInvalid"),
    );
  });

  it("absent: only live-subscription members beyond the configured window, never-visited counted worst", async () => {
    const visitedYesterday = await activeMember("حضر أمس");
    insertCheckInAt(visitedYesterday.member.id, visitedYesterday.card.id, visitedYesterday.sub.id, addDaysKey(TODAY, -1));

    const absent20 = await activeMember("غائب 20 يوم");
    insertCheckInAt(absent20.member.id, absent20.card.id, absent20.sub.id, addDaysKey(TODAY, -20));

    const absent3 = await activeMember("غائب 3 أيام");
    insertCheckInAt(absent3.member.id, absent3.card.id, absent3.sub.id, addDaysKey(TODAY, -3));

    const neverVisited = await activeMember("لم يحضر بعد");
    const noSub = await activeMember("بدون اشتراك");
    db.run("DELETE FROM member_subscriptions WHERE member_id = ?", [noSub.member.id]);

    const out = listRecipients(db, manager, { segment: "absent" });
    const ids = recipientIds(out);

    expect(ids.has(absent20.member.id)).toBe(true);
    expect(ids.has(neverVisited.member.id)).toBe(true);
    expect(ids.has(visitedYesterday.member.id)).toBe(false);
    expect(ids.has(absent3.member.id)).toBe(false);
    expect(ids.has(noSub.member.id)).toBe(false);

    // sorted most-absent first (never-visited counts as largest gap)
    const sorted = out.map((r) => r.memberId);
    expect(sorted[0]).toBe(neverVisited.member.id);
    expect(sorted.indexOf(neverVisited.member.id)).toBeLessThan(sorted.indexOf(absent20.member.id));
  });

  it("absent: window from settings is respected at the boundary", async () => {
    await updateSetting(db, owner, "messages_absent_days", "5");
    const exactly5 = await activeMember("غائب 5 بالضبط");
    insertCheckInAt(exactly5.member.id, exactly5.card.id, exactly5.sub.id, addDaysKey(TODAY, -5));
    const fourDays = await activeMember("غائب 4");
    insertCheckInAt(fourDays.member.id, fourDays.card.id, fourDays.sub.id, addDaysKey(TODAY, -4));

    const out = listRecipients(db, owner, { segment: "absent" });
    expect(recipientIds(out).has(exactly5.member.id)).toBe(true);
    expect(recipientIds(out).has(fourDays.member.id)).toBe(false);
  });

  it("absent: a member who visited today never appears", async () => {
    const visitedToday = await activeMember("حضر اليوم");
    await recordCheckIn(db, reception, { barcode: visitedToday.card.barcodeValue });
    const out = listRecipients(db, manager, { segment: "absent" });
    expect(recipientIds(out).has(visitedToday.member.id)).toBe(false);
  });

  it("birthday: next birthday inside the window, including today", async () => {
    const birthdayToday = await activeMember("عيده اليوم", { dob: "1990-09-19" });
    const birthdayIn3 = await activeMember("عيده بعد 3 أيام", { dob: "1991-09-22" });
    const birthdayIn10 = await activeMember("عيده بعد 10 أيام", { dob: "1990-09-29" });
    const noDob = await activeMember("بدون تاريخ ميلاد", { dob: null });

    const out = listRecipients(db, owner, { segment: "birthday" });
    const ids = recipientIds(out);
    expect(ids.has(birthdayToday.member.id)).toBe(true);
    expect(ids.has(birthdayIn3.member.id)).toBe(true);
    expect(ids.has(birthdayIn10.member.id)).toBe(false);
    expect(ids.has(noDob.member.id)).toBe(false);

    const target = out.find((r) => r.memberId === birthdayToday.member.id);
    expect(target?.daysUntilBirthday).toBe(0);
  });

  it("birthday: year-boundary candidates are included", async () => {
    await updateSetting(db, owner, "messages_birthday_days", "200");
    // TODAY 2026-09-19 → the Jan 3 anniversary is next year (2027-01-03).
    const newton = await activeMember("عيده في يناير", { dob: "1992-01-03" });
    const out = listRecipients(db, owner, { segment: "birthday" });
    const target = out.find((r) => r.memberId === newton.member.id);
    expect(target?.nextBirthdayKey).toBe("2027-01-03");
    expect(target?.daysUntilBirthday ?? 0).toBeGreaterThan(90);
  });

  it("expiry: live subscriptions ending inside the window only", async () => {
    // 7-day plan started 6 days ago → ends today (0 days until expiry → in window).
    const endsToday = await activeMember("ينتهي اليوم", { planDays: 7, startDate: addDaysKey(TODAY, -6) });
    // 60-day plan started 30 days ago → ends in 29 days → outside window.
    const endsIn29 = await activeMember("ينتهي بعد 29", { planDays: 60, startDate: addDaysKey(TODAY, -30) });

    const out = listRecipients(db, owner, { segment: "expiry" });
    const ids = recipientIds(out);
    expect(ids.has(endsToday.member.id)).toBe(true);
    expect(ids.has(endsIn29.member.id)).toBe(false);
  });

  it("scopes recipients by department for section staff", async () => {
    await updateSetting(db, owner, "messages_absent_days", "7");
    const menMember = await activeMember("عضو رجال", { department: "men" });
    const womenMember = await activeMember("عضو سيدات", { department: "women" });
    insertCheckInAt(menMember.member.id, menMember.card.id, menMember.sub.id, addDaysKey(TODAY, -10));
    insertCheckInAt(womenMember.member.id, womenMember.card.id, womenMember.sub.id, addDaysKey(TODAY, -10));

    const out = listRecipients(db, menReception, { segment: "absent" });
    const ids = recipientIds(out);
    expect(ids.has(menMember.member.id)).toBe(true);
    expect(ids.has(womenMember.member.id)).toBe(false);
  });
});

describe("messages: sending", () => {
  it("denies sendMessage/sendSegment/history without messages.send (reception)", async () => {
    const member = await activeMember("مرسل إليه");
    await expect(
      sendMessage(db, reception, { memberId: member.member.id, segment: "absent", body: "مرحبًا" }),
    ).rejects.toThrow(errForbidden());
    await expect(
      sendSegment(db, reception, { segment: "absent", body: "مرحبًا" }),
    ).rejects.toThrow(errForbidden());
    expect(() => listMessageHistory(db, reception)).toThrow(errForbidden());
  });

  it("validates segment and body input", async () => {
    const member = await activeMember("مرسل إليه");
    await expect(
      sendMessage(db, owner, { memberId: member.member.id, segment: "mall" as never, body: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      sendMessage(db, owner, { memberId: member.member.id, segment: "absent", body: "   " }),
    ).rejects.toThrow(errValidation("errors.messageBodyRequired"));
    await expect(
      sendMessage(db, owner, { memberId: member.member.id, segment: "absent", body: "x".repeat(2001) }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "errors.messageTooLong" });
    await expect(
      sendMessage(db, owner, { memberId: crypto.randomUUID(), segment: "absent", body: "x" }),
    ).rejects.toThrow(errNotFound("errors.memberNotFound"));
  });

  it("sends over the mock transport, persists outbox and audits", async () => {
    const member = await activeMember("مرسل إليه");
    const result = await sendMessage(db, owner, { memberId: member.member.id, segment: "absent", body: "أهلاً بك" });
    expect(result.status).toBe("sent");
    expect(result.sentAt).toBeTruthy();

    const row = db.first<{ status: string; body: string; member_name: string }>(
      "SELECT status, body, member_name FROM member_messages WHERE id = ?",
      [result.messageId],
    );
    expect(row?.status).toBe("sent");
    expect(row?.body).toBe("أهلاً بك");
    expect(row?.member_name).toBe(member.member.fullName);

    const audit = db.count(
      "SELECT COUNT(*) FROM audit_logs WHERE action = 'MESSAGE_SENT' AND entity_type = 'member' AND entity_id = ?",
      [member.member.id],
    );
    expect(audit).toBe(1);

    const history = listMessageHistory(db, owner);
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("sent");
  });

  it("skips members without a phone and reports not-configured when no gateway", async () => {
    const noPhone = await activeMember("بدون رقم", { phone: null });
    const res = await sendMessage(db, owner, { memberId: noPhone.member.id, segment: "absent", body: "مرحبا" });
    expect(res.status).toBe("skipped_no_phone");

    delete process.env.GYM_CRM_MOCK;
    const res2 = await sendMessage(db, owner, { memberId: noPhone.member.id, segment: "absent", body: "مرحبا" });
    expect(res2.status).toBe("not_configured");

    const statuses = db.all<{ status: string }>("SELECT status FROM member_messages ORDER BY created_at");
    expect(statuses.map((s) => s.status)).toEqual(["skipped_no_phone", "not_configured"]);
  });

  it("sendSegment batches with correct outcome counts and a full outbox", async () => {
    await updateSetting(db, owner, "messages_absent_days", "7");
    const target1 = await activeMember("هدف 1");
    const target2 = await activeMember("هدف 2");
    const noPhone = await activeMember("هدف بدون رقم", { phone: null });
    insertCheckInAt(target1.member.id, target1.card.id, target1.sub.id, addDaysKey(TODAY, -10));
    insertCheckInAt(target2.member.id, target2.card.id, target2.sub.id, addDaysKey(TODAY, -10));
    insertCheckInAt(noPhone.member.id, noPhone.card.id, noPhone.sub.id, addDaysKey(TODAY, -10));
    // a recently-attended member with a live sub must be excluded
    const recent = await activeMember("حضر مؤخرًا");
    insertCheckInAt(recent.member.id, recent.card.id, recent.sub.id, addDaysKey(TODAY, -2));

    const summary = await sendSegment(db, owner, { segment: "absent", body: "رسالة جماعية" });
    expect(summary.sent).toBe(2);
    expect(summary.skippedNoPhone).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.notConfigured).toBe(0);

    const rows = db.all<{ member_id: string; status: string }>(
      "SELECT member_id, status FROM member_messages WHERE segment = 'absent'",
    );
    expect(rows.length).toBe(3);
    expect(rows.filter((r) => r.status === "sent").length).toBe(2);
    expect(rows.filter((r) => r.status === "skipped_no_phone").length).toBe(1);
  });

  it("enforces department access when sending", async () => {
    const womenMember = await activeMember("عضو سيدات", { department: "women" });
    await expect(
      sendMessage(db, menReception, { memberId: womenMember.member.id, segment: "absent", body: "مرحبا" }),
    ).rejects.toThrow(errForbidden());
  });
});

describe("messages: config", () => {
  it("returns the configured windows and reflects settings edits", async () => {
    const cfg = getMessagesConfig(db, owner);
    expect(cfg.absentDays).toBe(14);
    expect(cfg.birthdayDays).toBe(7);
    expect(cfg.expiryDays).toBe(7);

    await updateSetting(db, owner, "messages_absent_days", "21");
    await updateSetting(db, owner, "messages_birthday_days", "3");
    await updateSetting(db, owner, "messages_expiry_days", "10");
    const after = getMessagesConfig(db, owner);
    expect(after.absentDays).toBe(21);
    expect(after.birthdayDays).toBe(3);
    expect(after.expiryDays).toBe(10);
  });

  it("rejects out-of-range window values in settings", async () => {
    await expect(updateSetting(db, owner, "messages_absent_days", "0")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(updateSetting(db, owner, "messages_expiry_days", "999")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("messages: welcome, payment & smart placeholders", () => {
  it("retrieves rich placeholders for a member via getMemberMessageData", async () => {
    const { member } = await activeMember("أحمد فؤاد", { phone: "01011112222" });
    const data = getMemberMessageData(db, owner, member.id);
    expect(data.memberId).toBe(member.id);
    expect(data.memberName).toBe("أحمد فؤاد");
    expect(data.planName).toBe("أحمد فؤاد-باقة");
    expect(data.gymName).toBe("Yassen Mohamed Kotb | 01288536381");
    expect(data.startDate).toBe(TODAY);
    expect(data.daysUntilExpiry).toBe(29);
  });

  it("sends a welcome message using the configured template", async () => {
    const { member } = await activeMember("كابتن جديد", { phone: "01122334455" });
    const res = await sendWelcomeMessage(db, owner, { memberId: member.id });
    expect(res.status).toBe("sent");
    const row = db.first<{ segment: string; body: string }>(
      "SELECT segment, body FROM member_messages WHERE id = ?",
      [res.messageId],
    );
    expect(row?.segment).toBe("welcome");
    expect(row?.body).toContain("كابتن جديد");
    expect(row?.body).toContain(member.memberCode);
  });

  it("sends a payment receipt message with custom amounts", async () => {
    const { member } = await activeMember("عميل دفع", { phone: "01234567890" });
    const res = await sendPaymentMessage(db, owner, {
      memberId: member.id,
      amountPaid: 750,
      amountRemaining: 0,
      planName: "VIP اشتراك",
      endDate: "2026-10-19",
    });
    expect(res.status).toBe("sent");
    const row = db.first<{ segment: string; body: string }>(
      "SELECT segment, body FROM member_messages WHERE id = ?",
      [res.messageId],
    );
    expect(row?.segment).toBe("payment");
    expect(row?.body).toContain("750");
    expect(row?.body).toContain("VIP اشتراك");
    expect(row?.body).toContain("2026-10-19");
  });

  it("enforces cool-down protection in sendSegment", async () => {
    const m1 = await activeMember("غائب 1", { phone: "01099991111" });
    const m2 = await activeMember("غائب 2", { phone: "01099992222" });

    // Mark both absent: record check-in 20 days ago
    const past = `${addDaysKey(TODAY, -20)} 10:00:00`;
    db.run("INSERT INTO attendance (id, member_id, checkin_at, created_by) VALUES (?, ?, ?, ?)", [
      crypto.randomUUID(),
      m1.member.id,
      past,
      owner.userId,
    ]);
    db.run("INSERT INTO attendance (id, member_id, checkin_at, created_by) VALUES (?, ?, ?, ?)", [
      crypto.randomUUID(),
      m2.member.id,
      past,
      owner.userId,
    ]);

    // Send first batch
    const first = await sendSegment(db, owner, { segment: "absent", body: "رسالة 1" });
    expect(first.sent).toBe(2);

    // Send second batch immediately -> cool-down (7 days) should skip both
    const second = await sendSegment(db, owner, { segment: "absent", body: "رسالة 2" });
    expect(second.sent).toBe(0);
    expect(second.skippedCooldown).toBe(2);

    // With bypassCooldown = true -> sends regardless
    const third = await sendSegment(db, owner, { segment: "absent", body: "رسالة 3", bypassCooldown: true });
    expect(third.sent).toBe(2);
  });
});

describe("messages: direct wa.me & placeholder engine", () => {
  it("normalizes Egyptian mobile numbers correctly", () => {
    expect(normalizeEgyMobile("01012345678")).toBe("201012345678");
    expect(normalizeEgyMobile("+201123456789")).toBe("201123456789");
    expect(normalizeEgyMobile("00201234567890")).toBe("201234567890");
    expect(normalizeEgyMobile("015 1234 5678")).toBe("201512345678");
    expect(normalizeEgyMobile("0223456789")).toBeNull(); // landline
    expect(normalizeEgyMobile("invalid")).toBeNull();
  });

  it("builds wa.me direct links with properly encoded text", () => {
    const url = buildWhatsAppDirectUrl("01012345678", "أهلاً بك يا كابتن!");
    expect(url).toContain("https://wa.me/201012345678?text=");
    expect(decodeURIComponent(url!)).toContain("أهلاً بك يا كابتن!");
    expect(buildWhatsAppDirectUrl("01012345678")).toBe("https://wa.me/201012345678");
    expect(buildWhatsAppDirectUrl("invalid")).toBeNull();
  });

  it("replaces all template placeholders seamlessly", () => {
    const tmpl =
      "مرحباً {اسم العميل} ({رقم العضوية}) في {اسم الجيم}. خطتك: {اسم الخطة}، صالحة حتى {تاريخ الانتهاء} ({الأيام المتبقية} يوم). تم دفع {المبلغ} والمتبقي {المبلغ المتبقي}. الخصم: {الخصم}.";
    const res = fillMessagePlaceholders(tmpl, {
      memberName: "علي حسن",
      memberCode: "MEM-001",
      gymName: "جيم الأبطال",
      planName: "اشتراك سنوي",
      endDate: "2027-01-01",
      daysUntilExpiry: 365,
      amountPaid: 3000,
      amountRemaining: 500,
      discount: "10%",
    });
    expect(res).toContain("علي حسن");
    expect(res).toContain("MEM-001");
    expect(res).toContain("جيم الأبطال");
    expect(res).toContain("اشتراك سنوي");
    expect(res).toContain("2027-01-01");
    expect(res).toContain("365 يوم");
    expect(res).toContain("تم دفع 3000 والمتبقي 500");
    expect(res).toContain("10%");
  });
});