import type { Db, SqlValue } from "@/db/engine";
import { normalizeEgyMobile } from "@/core/whatsapp";
import {
  readSetting,
  updateSetting,
  SETTING_KEYS,
  isWhatsappBotEnabled,
  DEFAULT_BOT_MENU_TEMPLATE,
  DEFAULT_BOT_OPTION_0_TEMPLATE,
  DEFAULT_BOT_OPTION_1_TEMPLATE,
  DEFAULT_BOT_OPTION_2_TEMPLATE,
  DEFAULT_BOT_OPTION_3_TEMPLATE,
  DEFAULT_BOT_OPTION_4_TEMPLATE,
  DEFAULT_BOT_OPTION_5_TEMPLATE,
} from "./settings.service";
import { getLiveOccupancy } from "./dashboard.service";
import { getMemberPortalUrl } from "./member-portal.service";
import { renderQrPngBase64 } from "@/core/qr";
import { diffDaysKeys, nowStamp, todayKey } from "@/core/dates";
import { randomUUID } from "node:crypto";
import { requirePermission, type ServiceActor } from "@/core/permissions";

export interface BotCustomOption {
  id: string;
  triggerKey: string;
  title: string;
  replyMessage: string;
  enabled: boolean;
}

export interface WhatsAppBotConfig {
  enabled: boolean;
  menuTemplate: string;
  option0Template: string;
  option1Template: string;
  option2Template: string;
  option3Template: string;
  option4Template: string;
  option5Template: string;
  customOptions: BotCustomOption[];
  defaultTemplates: {
    menu: string;
    option0: string;
    option1: string;
    option2: string;
    option3: string;
    option4: string;
    option5: string;
  };
}

export interface SaveWhatsAppBotConfigInput {
  enabled?: boolean;
  menuTemplate?: string;
  option0Template?: string;
  option1Template?: string;
  option2Template?: string;
  option3Template?: string;
  option4Template?: string;
  option5Template?: string;
  customOptions?: BotCustomOption[];
}

/**
 * Handover mute tracking: when a member requests human assistance ('0') or reception
 * chats with a member, the bot is muted for that phone number for 2 hours so it doesn't
 * interfere with the human conversation.
 */
const handoverMuteMap = new Map<string, number>();

export interface InboundWhatsAppResult {
  ok: boolean;
  reply: string | null;
  replyJid?: string;
  media?: {
    base64: string;
    mime: string;
    caption?: string;
  } | null;
  handledOption?: string;
}

export function applyBotTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    const replacement = val == null ? "" : String(val);
    result = result.split(`{${key}}`).join(replacement);
  }
  return result;
}

export function muteBotForPhone(phone: string, durationMinutes = 120): void {
  const norm = normalizeEgyMobile(phone) || phone;
  handoverMuteMap.set(norm, Date.now() + durationMinutes * 60 * 1000);
}

export function unmuteBotForPhone(phone: string): void {
  const norm = normalizeEgyMobile(phone) || phone;
  handoverMuteMap.delete(norm);
}

export function isBotMutedForPhone(phone: string): boolean {
  const norm = normalizeEgyMobile(phone) || phone;
  const expires = handoverMuteMap.get(norm);
  if (!expires) return false;
  if (Date.now() > expires) {
    handoverMuteMap.delete(norm);
    return false;
  }
  return true;
}

/** Clear all mutes (useful for testing). */
export function clearBotMutes(): void {
  handoverMuteMap.clear();
}

/**
 * Core handler for incoming WhatsApp messages received by the gateway.
 */
export async function handleWhatsAppInbound(
  db: Db,
  fromPhone: string,
  rawMessage: string,
  origin?: string,
  remoteJid?: string,
  senderPn?: string,
  pushName?: string,
  options?: { bypassDisabledCheck?: boolean; skipLogging?: boolean },
): Promise<InboundWhatsAppResult> {
  if (!isWhatsappBotEnabled(db) && !options?.bypassDisabledCheck) {
    return { ok: true, reply: null };
  }

  const normalizedPhone = normalizeEgyMobile(fromPhone);
  const cleanPhone = normalizedPhone || fromPhone.replace(/[^\d]/g, "");
  const rawLid = remoteJid ? remoteJid.replace(/@.*$/, "") : "";
  const senderPnNorm = senderPn ? (normalizeEgyMobile(senderPn) || senderPn.replace(/[^\d]/g, "")) : "";
  const text = (rawMessage || "").trim();
  if (!text) return { ok: true, reply: null };

  const effectiveReplyJid = remoteJid || (cleanPhone ? `${cleanPhone}@s.whatsapp.net` : undefined);

  // 1. Resolve member from member_whatsapp_identities table if LID is provided
  type MemberRow = {
    id: string;
    member_code: string;
    full_name: string;
    phone: string;
    department: string;
  };

  let member: MemberRow | null | undefined;
  if (rawLid) {
    const ident = db.first<{ member_id: string }>(
      "SELECT member_id FROM member_whatsapp_identities WHERE lid = ? LIMIT 1",
      [rawLid],
    );
    if (ident?.member_id) {
      member = db.first<MemberRow>(
        "SELECT id, member_code, full_name, phone, department FROM members WHERE id = ? AND deleted_at IS NULL",
        [ident.member_id],
      );
    }
  }

  // 2. If not matched by LID, search by phone candidates (senderPn, fromPhone, cleanPhone)
  if (!member) {
    const candidatePhones = [senderPnNorm, fromPhone, cleanPhone].filter(Boolean);
    for (const p of candidatePhones) {
      member = db.first<MemberRow>(
        `SELECT id, member_code, full_name, phone, department
         FROM members
         WHERE deleted_at IS NULL AND (
           phone = ? OR phone = ? OR phone LIKE ?
         ) LIMIT 1`,
        [p, p, `%${p.slice(-9)}%`],
      );
      if (member) break;
    }
  }

  const now = nowStamp();
  const gymName = readSetting(db, SETTING_KEYS.gymName) || "الصالة الرياضية";

  // 3. Smart Auto-Link: If member is still unknown, check if message body is a phone number or member code!
  const digitsOnly = text.replace(/[\s-]/g, "");
  const isPhonePattern = /^(01[0125]\d{8}|201[0125]\d{8})$/.test(digitsOnly);
  const isCodePattern = /^(B\d+-)?MEM-\d+$/i.test(text.trim()) || (/^\d{4,8}$/.test(text.trim()) && !["0", "1", "2", "3", "4", "5"].includes(text.trim()));

  if (!member && (isPhonePattern || isCodePattern)) {
    const searchTarget = text.trim();
    const cleanSearchPhone = normalizeEgyMobile(searchTarget) || searchTarget.replace(/[^\d]/g, "");
    const candidate = db.first<MemberRow>(
      `SELECT id, member_code, full_name, phone, department
       FROM members
       WHERE deleted_at IS NULL AND (
         phone = ? OR phone = ? OR phone LIKE ? OR member_code = ? COLLATE NOCASE
       ) LIMIT 1`,
      [searchTarget, cleanSearchPhone, `%${cleanSearchPhone.slice(-9)}%`, searchTarget],
    );

    if (candidate) {
      member = candidate;
      try {
        db.run(
          `INSERT INTO member_whatsapp_identities (id, member_id, phone, lid, remote_jid, push_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(lid) DO UPDATE SET member_id = excluded.member_id, phone = excluded.phone, updated_at = excluded.updated_at`,
          [randomUUID(), member.id, member.phone || cleanPhone, rawLid || null, remoteJid || null, pushName || null, now, now],
        );
      } catch {
        /* non-fatal */
      }

      const reply =
        `تم ربط حسابك في الواتساب بنجاح بعضويتك يا كابتن *${member.full_name}*! 🎉✨\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🆔 *كود العضوية:* ${member.member_code}\n` +
        `🏢 *الصالة:* ${gymName}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `الآن يمكنك الاستفادة من جميع خدمات البوت الفورية:\n` +
        `1️⃣ للاستعلام عن باقتك وموعد الانتهاء ورابط البوابة\n` +
        `5️⃣ لتنزيل بطاقتك الرقمية وباركود الدخول الذكي\n\n` +
        `💡 (أرسل كلمة «قائمة» في أي وقت لعرض كافة الخيارات).`;

      saveBotReply(db, member.id, reply, now);
      return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "link" };
    }
  }

  // If member is found and we have a LID, ensure it's saved in member_whatsapp_identities
  if (member && rawLid) {
    try {
      db.run(
        `INSERT INTO member_whatsapp_identities (id, member_id, phone, lid, remote_jid, push_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lid) DO UPDATE SET member_id = excluded.member_id, phone = excluded.phone, updated_at = excluded.updated_at`,
        [randomUUID(), member.id, member.phone || cleanPhone, rawLid, remoteJid || null, pushName || null, now, now],
      );
    } catch {
      /* ignore */
    }
  }

  // Log incoming message in member_direct_messages
  if (member && !options?.skipLogging) {
    try {
      db.run(
        `INSERT INTO member_direct_messages (id, member_id, sender_type, message, channel, status, created_at)
         VALUES (?, ?, 'member', ?, 'whatsapp', 'delivered', ?)`,
        [randomUUID(), member.id, text, now],
      );
    } catch {
      /* non-fatal */
    }
  }

  const lower = text.toLowerCase().trim();
  const isMenuCommand =
    lower === "قائمة" ||
    lower === "menu" ||
    lower === "اوامر" ||
    lower === "أوامر" ||
    lower === "start" ||
    lower === "مساعدة" ||
    lower === "help";

  // Check handover mute: if muted and message is not an explicit menu command, do not reply
  if (isBotMutedForPhone(cleanPhone) && !isMenuCommand && lower !== "0") {
    return { ok: true, reply: null };
  }

  const baseVars: Record<string, string> = {
    "اسم الجيم": gymName,
    "اسم_الجيم": gymName,
    "gym_name": gymName,
    "اسم الصالة": gymName,
    "اسم العضو": member ? member.full_name : "بطلنا الرياضي",
    "اسم_العضو": member ? member.full_name : "بطلنا الرياضي",
    "اسم العميل": member ? member.full_name : "بطلنا الرياضي",
    "member_name": member ? member.full_name : "بطلنا الرياضي",
    "كود العضوية": member ? member.member_code : "—",
    "كود_العضوية": member ? member.member_code : "—",
    "رقم العضوية": member ? member.member_code : "—",
    "member_code": member ? member.member_code : "—",
    "تحية العضو": member ? `يا كابتن *${member.full_name}* 👋\n` : "",
    "تحية_العضو": member ? `يا كابتن *${member.full_name}* 👋\n` : "",
    "salutation": member ? `يا كابتن *${member.full_name}* 👋\n` : "",
  };

  // --- Option 0: Handover to receptionist ---
  if (lower === "0" || lower === "استقبال" || lower === "موظف" || lower === "خدمة العملاء" || lower === "خدمه العملاء") {
    muteBotForPhone(cleanPhone, 120);

    // Record handover request in whatsapp_bot_handovers table
    try {
      const existing = db.first<{ id: string }>(
        "SELECT id FROM whatsapp_bot_handovers WHERE phone = ? AND status = 'pending' LIMIT 1",
        [cleanPhone],
      );
      if (existing) {
        db.run(
          "UPDATE whatsapp_bot_handovers SET last_message = ?, created_at = ? WHERE id = ?",
          [text, now, existing.id],
        );
      } else {
        const customerName = member?.full_name || pushName || cleanPhone;
        db.run(
          `INSERT INTO whatsapp_bot_handovers (id, phone, member_id, customer_name, last_message, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          [randomUUID(), cleanPhone, member?.id || null, customerName, text, now],
        );
      }
    } catch {
      // non-fatal
    }

    const template = readSetting(db, SETTING_KEYS.whatsappBotOption0Template) || DEFAULT_BOT_OPTION_0_TEMPLATE;
    const reply = applyBotTemplate(template, baseVars);

    if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
    return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "0" };
  }

  // --- Option 1: Subscription details & Member Portal Link ---
  if (lower === "1" || lower === "اشتراكي" || lower === "اشتراك" || lower === "باقتي") {
    if (!member) {
      const reply =
        `عذراً يا بطل، حساب الواتساب هذا لم يتم ربطه بعضويتك في *${gymName}* بعد. 🔍\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 *لربط حسابك فوراً:* أرسل الآن **رقم هاتفك المسجل في الجيم** (مثال: 01012345678) أو **كود عضويتك** (مثال: MEM-000001).\n\n` +
        `أو أرسل الرقم 0 للتحدث مع موظف الاستقبال. 👤`;
      return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "1" };
    }

    const today = todayKey();
    const sub = db.first<{
      plan_name: string;
      start_date: string;
      end_date: string;
      sessions_total: number | null;
      sessions_used: number | null;
    }>(
      `SELECT p.name AS plan_name, s.start_date, s.end_date, s.sessions_total, s.sessions_used
       FROM member_subscriptions s
       JOIN membership_plans p ON p.id = s.plan_id
       WHERE s.member_id = ? AND s.status = 'active' AND s.end_date >= ?
       ORDER BY s.end_date DESC LIMIT 1`,
      [member.id, today],
    );

    let portalLink = "";
    try {
      const systemActor: ServiceActor = { userId: "system", username: "system", roleId: "owner", department: "general" };
      const portalInfo = getMemberPortalUrl(db, systemActor, member.id, origin);
      portalLink = portalInfo.url;
    } catch {
      /* portal link generation fallback */
    }

    let reply: string;
    if (sub) {
      const daysLeft = Math.max(0, diffDaysKeys(today, sub.end_date));
      const sessionsRemaining =
        sub.sessions_total != null ? Math.max(0, sub.sessions_total - (sub.sessions_used ?? 0)) : null;

      const subVars: Record<string, string | number> = {
        ...baseVars,
        "اسم الباقة": sub.plan_name,
        "اسم_الباقة": sub.plan_name,
        "اسم الخطة": sub.plan_name,
        "plan_name": sub.plan_name,
        "تاريخ البدء": sub.start_date,
        "تاريخ_البدء": sub.start_date,
        "start_date": sub.start_date,
        "تاريخ الانتهاء": sub.end_date,
        "تاريخ_الانتهاء": sub.end_date,
        "end_date": sub.end_date,
        "الأيام المتبقية": daysLeft,
        "الايام المتبقية": daysLeft,
        "الأيام_المتبقية": daysLeft,
        "days_left": daysLeft,
        "تفاصيل الحصص": sessionsRemaining != null ? `🎟️ *الحصص المتبقية:* ${sessionsRemaining} حصة\n` : "",
        "الحصص المتبقية": sessionsRemaining != null ? sessionsRemaining : "—",
        "رابط البوابة": portalLink
          ? `📲 *رابط بوابتك الإلكترونية لمتابعة اشتراكك ونسبة الإشغال:*\n${portalLink}\n\n`
          : "",
        "رابط_البوابة": portalLink,
        "portal_url": portalLink,
      };

      const template = readSetting(db, SETTING_KEYS.whatsappBotOption1Template) || DEFAULT_BOT_OPTION_1_TEMPLATE;
      reply = applyBotTemplate(template, subVars);
    } else {
      reply =
        `👤 مرحباً بك يا كابتن ${member.full_name} 👋\n` +
        `لا يوجد لديك اشتراك نشط حالياً في *${gymName}*.\n` +
        `يسعدنا تجديد اشتراكك مع الاستقبال (أرسل 0) أو الاطلاع على باقاتنا (أرسل 4). 💪✨`;
    }

    if (!options?.skipLogging) saveBotReply(db, member.id, reply, now);
    return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "1" };
  }

  // --- Option 2: Live Gym Floor Occupancy ---
  if (lower === "2" || lower === "اشغال" || lower === "إشغال" || lower === "نسبة الاشغال" || lower === "زحمة") {
    const occupancy = getLiveOccupancy(db);
    const occVars = {
      ...baseVars,
      "عدد المتواجدين": occupancy,
      "عدد_المتواجدين": occupancy,
      "نسبة الإشغال": occupancy,
      "نسبة_الإشغال": occupancy,
      "occupancy": occupancy,
    };
    const template = readSetting(db, SETTING_KEYS.whatsappBotOption2Template) || DEFAULT_BOT_OPTION_2_TEMPLATE;
    const reply = applyBotTemplate(template, occVars);

    if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
    return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "2" };
  }

  // --- Option 3: Gym Hours & Schedule ---
  if (lower === "3" || lower === "مواعيد" || lower === "ساعات" || lower === "أوقات" || lower === "اوقات") {
    const hours = readSetting(db, SETTING_KEYS.workingHours) || "يومياً من 8:00 صباحاً حتى 11:00 مساءً";
    const hoursVars = {
      ...baseVars,
      "مواعيد العمل": hours,
      "مواعيد_العمل": hours,
      "ساعات العمل": hours,
      "ساعات_العمل": hours,
      "working_hours": hours,
    };
    const template = readSetting(db, SETTING_KEYS.whatsappBotOption3Template) || DEFAULT_BOT_OPTION_3_TEMPLATE;
    const reply = applyBotTemplate(template, hoursVars);

    if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
    return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "3" };
  }

  // --- Option 4: Membership Plans & Prices ---
  if (lower === "4" || lower === "اسعار" || lower === "أسعار" || lower === "خطط" || lower === "باقات") {
    const plans = db.all<{
      name: string;
      price: number;
      duration_days: number;
      sessions_count: number | null;
    }>(
      `SELECT name, price, duration_days, sessions_count
       FROM membership_plans
       WHERE is_active = 1
       ORDER BY duration_days ASC LIMIT 8`,
    );

    const plansText = plans.length > 0
      ? plans
          .map(
            (p, idx) =>
              `${idx + 1}️⃣ *${p.name}* — ${p.price} ج.م\n   ⏳ المدة: ${p.duration_days} يوم${
                p.sessions_count ? ` | ${p.sessions_count} حصة` : ""
              }`,
          )
          .join("\n\n")
      : "تواصل مع الاستقبال للاطلاع على أحدث العروض.";

    const plansVars = {
      ...baseVars,
      "قائمة الباقات": plansText,
      "قائمة_الباقات": plansText,
      "plans_list": plansText,
    };
    const template = readSetting(db, SETTING_KEYS.whatsappBotOption4Template) || DEFAULT_BOT_OPTION_4_TEMPLATE;
    const reply = applyBotTemplate(template, plansVars);

    if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
    return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "4" };
  }

  // --- Option 5: Digital Card QR Barcode ---
  if (lower === "5" || lower === "كارنيه" || lower === "باركود" || lower === "كارت" || lower === "qr") {
    if (!member) {
      const reply =
        `عذراً يا بطل، حساب الواتساب هذا لم يتم ربطه بعضويتك في *${gymName}* بعد. 🔍\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 *لتنزيل كارنيه عضويتك فوراً:* أرسل الآن **رقم هاتفك المسجل في الجيم** (مثال: 01012345678) أو **كود عضويتك** (مثال: MEM-000001).\n\n` +
        `أو أرسل الرقم 0 للتحدث مع موظف الاستقبال. 👤`;
      return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "5" };
    }

    const card = db.first<{ barcode_value: string }>(
      `SELECT barcode_value FROM cards WHERE member_id = ? AND status = 'active' LIMIT 1`,
      [member.id],
    );
    const barcode = card?.barcode_value || member.member_code;

    let qrBase64: string | null = null;
    try {
      qrBase64 = await renderQrPngBase64(barcode);
    } catch {
      /* QR render fallback */
    }

    const cardVars = {
      ...baseVars,
      "رمز الباركود": barcode,
      "رمز_الباركود": barcode,
      "الباركود": barcode,
      "barcode": barcode,
    };
    const template = readSetting(db, SETTING_KEYS.whatsappBotOption5Template) || DEFAULT_BOT_OPTION_5_TEMPLATE;
    const reply = applyBotTemplate(template, cardVars);

    if (!options?.skipLogging) saveBotReply(db, member.id, reply, now);

    return {
      ok: true,
      reply,
      replyJid: effectiveReplyJid,
      media: qrBase64
        ? {
            base64: qrBase64,
            mime: "image/png",
            caption: reply,
          }
        : null,
      handledOption: "5",
    };
  }

  // --- Check Custom Bot Options / Keywords ---
  const rawCustom = readSetting(db, SETTING_KEYS.whatsappBotCustomOptionsJson);
  if (rawCustom) {
    try {
      const customOptions: BotCustomOption[] = JSON.parse(rawCustom);
      if (Array.isArray(customOptions)) {
        for (const opt of customOptions) {
          if (!opt.enabled) continue;
          const triggers = (opt.triggerKey || "")
            .split(/[,،]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          if (triggers.includes(lower)) {
            const reply = applyBotTemplate(opt.replyMessage, baseVars);
            if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
            return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: `custom_${opt.triggerKey}` };
          }
        }
      }
    } catch {
      /* ignore invalid json */
    }
  }

  // --- Main Interactive Menu (Default for greetings, "قائمة", or unhandled numbers) ---
  const menuTemplate = readSetting(db, SETTING_KEYS.whatsappBotMenuTemplate) || DEFAULT_BOT_MENU_TEMPLATE;
  const reply = applyBotTemplate(menuTemplate, baseVars);

  if (!options?.skipLogging) saveBotReply(db, member?.id, reply, now);
  return { ok: true, reply, replyJid: effectiveReplyJid, handledOption: "menu" };
}

function saveBotReply(db: Db, memberId: string | undefined, message: string, createdAt: string): void {
  if (!memberId) return;
  try {
    db.run(
      `INSERT INTO member_direct_messages (id, member_id, sender_type, message, channel, status, message_type, created_at)
       VALUES (?, ?, 'gym', ?, 'whatsapp', 'sent', 'bot', ?)`,
      [randomUUID(), memberId, message, createdAt],
    );
  } catch {
    try {
      db.run(
        `INSERT INTO member_direct_messages (id, member_id, sender_type, message, channel, status, created_at)
         VALUES (?, ?, 'gym', ?, 'whatsapp', 'sent', ?)`,
        [randomUUID(), memberId, message, createdAt],
      );
    } catch {
      /* non-fatal */
    }
  }
}

export function getWhatsAppBotConfig(db: Db, actor: ServiceActor): WhatsAppBotConfig {
  requirePermission(actor, "settings.view");

  let customOptions: BotCustomOption[] = [];
  const rawCustom = readSetting(db, SETTING_KEYS.whatsappBotCustomOptionsJson);
  if (rawCustom) {
    try {
      const parsed = JSON.parse(rawCustom);
      if (Array.isArray(parsed)) customOptions = parsed;
    } catch {
      /* ignore invalid json */
    }
  }

  return {
    enabled: isWhatsappBotEnabled(db),
    menuTemplate: readSetting(db, SETTING_KEYS.whatsappBotMenuTemplate) ?? DEFAULT_BOT_MENU_TEMPLATE,
    option0Template: readSetting(db, SETTING_KEYS.whatsappBotOption0Template) ?? DEFAULT_BOT_OPTION_0_TEMPLATE,
    option1Template: readSetting(db, SETTING_KEYS.whatsappBotOption1Template) ?? DEFAULT_BOT_OPTION_1_TEMPLATE,
    option2Template: readSetting(db, SETTING_KEYS.whatsappBotOption2Template) ?? DEFAULT_BOT_OPTION_2_TEMPLATE,
    option3Template: readSetting(db, SETTING_KEYS.whatsappBotOption3Template) ?? DEFAULT_BOT_OPTION_3_TEMPLATE,
    option4Template: readSetting(db, SETTING_KEYS.whatsappBotOption4Template) ?? DEFAULT_BOT_OPTION_4_TEMPLATE,
    option5Template: readSetting(db, SETTING_KEYS.whatsappBotOption5Template) ?? DEFAULT_BOT_OPTION_5_TEMPLATE,
    customOptions,
    defaultTemplates: {
      menu: DEFAULT_BOT_MENU_TEMPLATE,
      option0: DEFAULT_BOT_OPTION_0_TEMPLATE,
      option1: DEFAULT_BOT_OPTION_1_TEMPLATE,
      option2: DEFAULT_BOT_OPTION_2_TEMPLATE,
      option3: DEFAULT_BOT_OPTION_3_TEMPLATE,
      option4: DEFAULT_BOT_OPTION_4_TEMPLATE,
      option5: DEFAULT_BOT_OPTION_5_TEMPLATE,
    },
  };
}

export async function saveWhatsAppBotConfig(
  db: Db,
  actor: ServiceActor,
  input: SaveWhatsAppBotConfigInput,
): Promise<{ ok: boolean }> {
  requirePermission(actor, "settings.edit");

  if (input.enabled !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotEnabled, input.enabled ? "1" : "0");
  }
  if (input.menuTemplate !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotMenuTemplate, input.menuTemplate);
  }
  if (input.option0Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption0Template, input.option0Template);
  }
  if (input.option1Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption1Template, input.option1Template);
  }
  if (input.option2Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption2Template, input.option2Template);
  }
  if (input.option3Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption3Template, input.option3Template);
  }
  if (input.option4Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption4Template, input.option4Template);
  }
  if (input.option5Template !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotOption5Template, input.option5Template);
  }
  if (input.customOptions !== undefined) {
    await updateSetting(db, actor, SETTING_KEYS.whatsappBotCustomOptionsJson, JSON.stringify(input.customOptions));
  }

  return { ok: true };
}

export async function simulateWhatsAppBot(
  db: Db,
  actor: ServiceActor,
  input: {
    message: string;
    memberId?: string;
    simulatedPhone?: string;
  },
): Promise<{
  reply: string | null;
  handledOption?: string;
  media?: { base64: string; mime: string; caption?: string } | null;
  matchedMember?: { id: string; fullName: string; memberCode: string; phone: string } | null;
}> {
  requirePermission(actor, "settings.view");

  let testPhone = (input.simulatedPhone || "").trim();
  let matchedMember = null;

  if (input.memberId) {
    matchedMember = db.first<{ id: string; fullName: string; memberCode: string; phone: string }>(
      "SELECT id, full_name AS fullName, member_code AS memberCode, phone FROM members WHERE id = ? AND deleted_at IS NULL",
      [input.memberId],
    );
    if (matchedMember && !testPhone) {
      testPhone = matchedMember.phone;
    }
  }

  if (!testPhone) {
    testPhone = "01000000000";
  }

  const result = await handleWhatsAppInbound(
    db,
    testPhone,
    input.message,
    undefined,
    undefined,
    undefined,
    undefined,
    { bypassDisabledCheck: true, skipLogging: true },
  );

  return {
    reply: result.reply,
    handledOption: result.handledOption,
    media: result.media,
    matchedMember,
  };
}

export interface BotHandoverRow {
  id: string;
  phone: string;
  member_id: string | null;
  customer_name: string;
  last_message: string | null;
  status: "pending" | "resolved" | "ignored";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  member_code?: string | null;
  resolver_name?: string | null;
}

export function listBotHandovers(
  db: Db,
  actor: ServiceActor,
  filter?: { status?: string; limit?: number },
): BotHandoverRow[] {
  requirePermission(actor, "messages.view");
  const status = filter?.status && filter.status !== "all" ? filter.status : undefined;
  const statusClause = status ? "WHERE h.status = ?" : "";
  const params: SqlValue[] = status ? [status] : [];
  const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);

  return db.all<BotHandoverRow>(
    `SELECT h.*, m.member_code, u.full_name AS resolver_name
     FROM whatsapp_bot_handovers h
     LEFT JOIN members m ON m.id = h.member_id
     LEFT JOIN users u ON u.id = h.resolved_by
     ${statusClause}
     ORDER BY CASE WHEN h.status = 'pending' THEN 0 ELSE 1 END, h.created_at DESC
     LIMIT ?`,
    [...params, limit],
  );
}

export function resolveBotHandover(
  db: Db,
  actor: ServiceActor,
  handoverId: string,
): { ok: boolean } {
  requirePermission(actor, "messages.send");
  const stamp = nowStamp();
  db.run(
    "UPDATE whatsapp_bot_handovers SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?",
    [stamp, actor.userId, handoverId],
  );
  return { ok: true };
}

export function countPendingBotHandovers(db: Db): number {
  return Number(
    db.scalar("SELECT COUNT(*) FROM whatsapp_bot_handovers WHERE status = 'pending'") ?? 0,
  );
}
