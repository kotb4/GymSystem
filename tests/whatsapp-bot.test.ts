import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordCheckIn } from "@/core/services/attendance.service";
import { updateSetting, SETTING_KEYS } from "@/core/services/settings.service";
import {
  handleWhatsAppInbound,
  muteBotForPhone,
  unmuteBotForPhone,
  isBotMutedForPhone,
  clearBotMutes,
  getWhatsAppBotConfig,
  saveWhatsAppBotConfig,
  simulateWhatsAppBot,
} from "@/core/services/whatsapp-bot.service";
import {
  listRenewalStageRecipients,
  sendRenewalStage,
  sendWelcomeMessage,
} from "@/core/services/messages.service";
import { applyAntiBanVariations, getRandomGreeting, getRandomClosing } from "@/core/whatsapp";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { addDaysKey, setDevOverrideDate, todayKey } from "@/core/dates";
import { createTestDb } from "./helpers/test-db";

const TODAY = "2026-09-19";

let db: Db;
let owner: ServiceActor;

beforeEach(async () => {
  db = createTestDb();
  setDevOverrideDate(TODAY);
  clearBotMutes();
  owner = buildActor(
    await setup(db, {
      gymName: "GymGate VIP",
      ownerFullName: "المالك",
      username: "owner",
      password: "Owner@2026",
    }),
  );
  process.env.GYM_CRM_MOCK = "1";
});

afterEach(() => {
  delete process.env.GYM_CRM_MOCK;
  setDevOverrideDate(null);
  clearBotMutes();
});

describe("whatsapp bot: inbound auto-reply & menu", () => {
  it("returns default interactive menu on greeting or 'قائمة'", async () => {
    const member = await createMember(db, owner, {
      fullName: "أحمد علي",
      phone: "01012345678",
    });

    const res = await handleWhatsAppInbound(db, "01012345678", "مرحبا");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("GymGate VIP");
    expect(res.reply).toContain("أحمد علي");
    expect(res.reply).toContain("1️⃣");
    expect(res.reply).toContain("5️⃣");
    expect(res.reply).toContain("0️⃣");
    expect(res.handledOption).toBe("menu");
  });

  it("handles option 1: subscription info and direct portal link", async () => {
    const member = await createMember(db, owner, {
      fullName: "محمود حسن",
      phone: "01122334455",
    });
    const plan = await createPlan(db, owner, {
      name: "باقة 3 شهور VIP",
      durationDays: 90,
      price: 1500,
    });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: TODAY,
    });

    const res = await handleWhatsAppInbound(db, "01122334455", "1");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("محمود حسن");
    expect(res.reply).toContain("باقة 3 شهور VIP");
    expect(res.reply).toContain("الأيام المتبقية");
    expect(res.reply).toContain("portal?token=");
    expect(res.handledOption).toBe("1");
  });

  it("handles option 2: live gym occupancy", async () => {
    const member = await createMember(db, owner, {
      fullName: "سعيد محمد",
      phone: "01234567890",
    });
    const plan = await createPlan(db, owner, {
      name: "باقة شهر",
      durationDays: 30,
      price: 500,
    });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: TODAY,
    });
    const card = db.first<{ barcode_value: string }>("SELECT barcode_value FROM cards WHERE member_id = ?", [member.id]);
    await recordCheckIn(db, owner, { barcode: card!.barcode_value });

    const res = await handleWhatsAppInbound(db, "01234567890", "2");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("نسبة إشغال");
    expect(res.reply).toContain("1");
    expect(res.handledOption).toBe("2");
  });

  it("handles option 3: working hours", async () => {
    await updateSetting(db, owner, SETTING_KEYS.workingHours, "السبت إلى الخميس من 9 ص إلى 11 م");
    const res = await handleWhatsAppInbound(db, "01000000000", "3");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("مواعيد عمل");
    expect(res.reply).toContain("السبت إلى الخميس من 9 ص إلى 11 م");
    expect(res.handledOption).toBe("3");
  });

  it("handles option 4: membership plans and prices", async () => {
    await createPlan(db, owner, {
      name: "باقة سنوية شاملة",
      durationDays: 365,
      price: 4000,
    });

    const res = await handleWhatsAppInbound(db, "01000000000", "4");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("باقة سنوية شاملة");
    expect(res.reply).toContain("4000 ج.م");
    expect(res.handledOption).toBe("4");
  });

  it("handles option 5: digital card barcode & QR code media payload", async () => {
    const member = await createMember(db, owner, {
      fullName: "خالد سعيد",
      phone: "01511223344",
    });

    const res = await handleWhatsAppInbound(db, "01511223344", "5");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("كارنيه عضويتك الرقمي");
    expect(res.reply).toContain("خالد سعيد");
    expect(res.media).toBeDefined();
    expect(res.media?.mime).toBe("image/png");
    expect(res.media?.base64).toBeTruthy();
    expect(res.handledOption).toBe("5");
  });

  it("handles option 0: receptionist handover and mutes bot for 2 hours", async () => {
    const phone = "01055556666";
    const res = await handleWhatsAppInbound(db, phone, "0");
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("تم تحويل محادثتك لموظف الاستقبال");
    expect(res.handledOption).toBe("0");

    expect(isBotMutedForPhone(phone)).toBe(true);

    // Subsequent normal messages do not trigger auto-reply while muted
    const nextMsg = await handleWhatsAppInbound(db, phone, "عايز اعرف اسعاركم");
    expect(nextMsg.ok).toBe(true);
    expect(nextMsg.reply).toBeNull();

    // But sending 'قائمة' overrides the mute
    const menuMsg = await handleWhatsAppInbound(db, phone, "قائمة");
    expect(menuMsg.ok).toBe(true);
    expect(menuMsg.reply).toContain("GymGate VIP");
  });

  it("returns null when bot is disabled in settings", async () => {
    await updateSetting(db, owner, SETTING_KEYS.whatsappBotEnabled, "0");
    const res = await handleWhatsAppInbound(db, "01011112222", "مرحبا");
    expect(res.ok).toBe(true);
    expect(res.reply).toBeNull();
  });
});

describe("whatsapp anti-ban & multi-stage retention", () => {
  it("injects dynamic zero-width entropy to ensure every message hash is unique", () => {
    const baseText = "رسالة تجريبية موحدة";
    const variant1 = applyAntiBanVariations(baseText, { salt: "member_1" });
    const variant2 = applyAntiBanVariations(baseText, { salt: "member_2" });

    expect(variant1).not.toBe(variant2);
    expect(variant1.startsWith(baseText)).toBe(true);
    expect(variant2.startsWith(baseText)).toBe(true);
  });

  it("filters 3-stage renewal recipients correctly", async () => {
    const plan = await createPlan(db, owner, { name: "خطة تجديد", durationDays: 30, price: 100 });

    // Member 1: Expires in 5 days (Stage 1)
    const m1 = await createMember(db, owner, { fullName: "عضو مرحلة 1", phone: "01010000001" });
    await createSubscription(db, owner, {
      memberId: m1.id,
      planId: plan.id,
      startDate: addDaysKey(TODAY, -24),
    });

    // Member 2: Expires Today (Stage 2)
    const m2 = await createMember(db, owner, { fullName: "عضو مرحلة 2", phone: "01010000002" });
    await createSubscription(db, owner, {
      memberId: m2.id,
      planId: plan.id,
      startDate: addDaysKey(TODAY, -29),
    });

    // Member 3: Expired 3 days ago (Stage 3)
    const m3 = await createMember(db, owner, { fullName: "عضو مرحلة 3", phone: "01010000003" });
    await createSubscription(db, owner, {
      memberId: m3.id,
      planId: plan.id,
      startDate: addDaysKey(TODAY, -32),
    });

    const stage1Recipients = listRenewalStageRecipients(db, owner, 1);
    expect(stage1Recipients.some((r) => r.memberId === m1.id)).toBe(true);
    expect(stage1Recipients.some((r) => r.memberId === m2.id)).toBe(false);

    const stage2Recipients = listRenewalStageRecipients(db, owner, 2);
    expect(stage2Recipients.some((r) => r.memberId === m2.id)).toBe(true);

    const stage3Recipients = listRenewalStageRecipients(db, owner, 3);
    expect(stage3Recipients.some((r) => r.memberId === m3.id)).toBe(true);
  });

  it("sends renewal stage 2 with customized today template", async () => {
    const plan = await createPlan(db, owner, { name: "خطة سريعة", durationDays: 30, price: 100 });
    const m = await createMember(db, owner, { fullName: "عضو اليوم", phone: "01099998888" });
    await createSubscription(db, owner, {
      memberId: m.id,
      planId: plan.id,
      startDate: addDaysKey(TODAY, -29),
    });

    const summary = await sendRenewalStage(db, owner, { stage: 2 });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const sentRow = db.first<{ body: string }>(
      "SELECT body FROM member_messages WHERE member_id = ? AND status = 'sent' ORDER BY created_at DESC LIMIT 1",
      [m.id],
    );
    expect(sentRow?.body).toContain("اليوم هو موعد نهاية اشتراكك");
  });

  it("includes portal link in welcome message", async () => {
    const m = await createMember(db, owner, { fullName: "كابتن البوابة", phone: "01044443333" });
    await updateSetting(db, owner, SETTING_KEYS.messagesWelcomeTemplate, "أهلاً يا {اسم العميل}، رابط بوابتك هو: {رابط البوابة}");

    const res = await sendWelcomeMessage(db, owner, { memberId: m.id });
    expect(res.status).toBe("sent");

    const sentRow = db.first<{ body: string }>(
      "SELECT body FROM member_messages WHERE id = ?",
      [res.messageId],
    );
    expect(sentRow?.body).toContain("portal?token=");
  });

  it("handles incoming messages from WhatsApp LID and auto-links by member phone", async () => {
    const member = await createMember(db, owner, { fullName: "كابتن ليد", phone: "01077778888" });
    const lidJid = "91109594279952@lid";

    // First greeting from unknown LID
    const res1 = await handleWhatsAppInbound(
      db,
      "91109594279952",
      "السلام عليكم",
      "http://localhost:8890",
      lidJid,
    );
    expect(res1.ok).toBe(true);
    expect(res1.replyJid).toBe(lidJid);
    expect(res1.reply).toContain("أهلاً بك في");

    // Member texts their phone number to link
    const resLink = await handleWhatsAppInbound(
      db,
      "91109594279952",
      "01077778888",
      "http://localhost:8890",
      lidJid,
      undefined,
      "Captain LID",
    );
    expect(resLink.ok).toBe(true);
    expect(resLink.replyJid).toBe(lidJid);
    expect(resLink.reply).toContain("تم ربط حسابك في الواتساب بنجاح");
    expect(resLink.reply).toContain("كابتن ليد");

    // Next time they request option 1 (subscription)
    const resSub = await handleWhatsAppInbound(
      db,
      "91109594279952",
      "1",
      "http://localhost:8890",
      lidJid,
    );
    expect(resSub.ok).toBe(true);
    expect(resSub.replyJid).toBe(lidJid);
    expect(resSub.reply).toContain("كابتن ليد");
  });

  it("allows reading and saving bot configuration including custom templates", async () => {
    const initial = getWhatsAppBotConfig(db, owner);
    expect(initial.enabled).toBe(true);
    expect(initial.menuTemplate).toContain("أهلاً بك في");
    expect(initial.defaultTemplates.option1).toContain("بيانات اشتراكك الحالي");

    await saveWhatsAppBotConfig(db, owner, {
      menuTemplate: "رسالة ترحيب مخصصة في {اسم الجيم} يا {اسم العضو}!",
      option1Template: "يا {اسم العضو} باقتك هي {اسم الباقة} وتنتهي في {تاريخ الانتهاء}",
      customOptions: [
        {
          id: "c1",
          triggerKey: "6, لوكيشن",
          title: "موقع الصالة",
          replyMessage: "📍 عنوان {اسم الجيم}: شارع النصر، المعادي.",
          enabled: true,
        },
      ],
    });

    const updated = getWhatsAppBotConfig(db, owner);
    expect(updated.menuTemplate).toBe("رسالة ترحيب مخصصة في {اسم الجيم} يا {اسم العضو}!");
    expect(updated.option1Template).toBe("يا {اسم العضو} باقتك هي {اسم الباقة} وتنتهي في {تاريخ الانتهاء}");
    expect(updated.customOptions).toHaveLength(1);
    expect(updated.customOptions[0].title).toBe("موقع الصالة");

    // Test customized inbound reply
    const member = await createMember(db, owner, {
      fullName: "زياد عمرو",
      phone: "01099887766",
    });
    const plan = await createPlan(db, owner, {
      name: "باقة سنوية ذهبية",
      durationDays: 365,
      price: 4000,
    });
    await createSubscription(db, owner, {
      memberId: member.id,
      planId: plan.id,
      startDate: TODAY,
    });

    // 1. Menu customization
    const resMenu = await handleWhatsAppInbound(db, "01099887766", "قائمة");
    expect(resMenu.reply).toBe("رسالة ترحيب مخصصة في GymGate VIP يا زياد عمرو!");

    // 2. Option 1 customization
    const resOpt1 = await handleWhatsAppInbound(db, "01099887766", "1");
    expect(resOpt1.reply).toContain("يا زياد عمرو باقتك هي باقة سنوية ذهبية");

    // 3. Custom trigger '6' or 'لوكيشن'
    const resCustNum = await handleWhatsAppInbound(db, "01099887766", "6");
    expect(resCustNum.reply).toBe("📍 عنوان GymGate VIP: شارع النصر، المعادي.");
    expect(resCustNum.handledOption).toBe("custom_6, لوكيشن");

    const resCustWord = await handleWhatsAppInbound(db, "01099887766", "لوكيشن");
    expect(resCustWord.reply).toBe("📍 عنوان GymGate VIP: شارع النصر، المعادي.");

    // 4. Test simulateWhatsAppBot function
    const sim = await simulateWhatsAppBot(db, owner, {
      message: "6",
      memberId: member.id,
    });
    expect(sim.reply).toBe("📍 عنوان GymGate VIP: شارع النصر، المعادي.");
    expect(sim.matchedMember?.fullName).toBe("زياد عمرو");
  });
});
