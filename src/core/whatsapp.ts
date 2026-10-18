/**
 * Egyptian phone normalization and WhatsApp direct URL helpers.
 */

export function digitsOnly(value: unknown): string {
  return String(value == null ? "" : value).replace(/[^\d]/g, "");
}

/**
 * Normalizes an Egyptian phone number to E.164 format: '201xxxxxxxxx'.
 * Returns null if the number is not a valid Egyptian mobile.
 */
export function normalizeEgyMobile(value: unknown): string | null {
  let d = digitsOnly(value);
  if (!d) return null;

  // Drop explicit international dialing prefixes.
  if (d.startsWith("00")) d = d.slice(2);
  // E.164 country code 20 (+ national number = 12 digits total for mobile).
  if (d.startsWith("20") && (d.length === 12 || d.length === 11)) d = d.slice(2);
  // National mobile with leading zero: 01x xxxxx xx.
  if (d.startsWith("0") && d.length === 11) d = d.slice(1);

  // Now expect the 10-digit national mobile form 1x xxxxxxxx with valid prefix 10/11/12/15.
  if (/^1[0125]\d{8}$/.test(d)) return "20" + d;

  return null;
}

/**
 * Generates a direct WhatsApp click-to-chat URL (`https://wa.me/201...`).
 * Returns null if the phone is not a valid Egyptian mobile.
 */
export function buildWhatsAppDirectUrl(phone: unknown, text?: string): string | null {
  const normalized = normalizeEgyMobile(phone);
  if (!normalized) return null;
  const baseUrl = `https://wa.me/${normalized}`;
  if (!text || !text.trim()) return baseUrl;
  return `${baseUrl}?text=${encodeURIComponent(text.trim())}`;
}

export interface MessagePlaceholderData {
  memberName?: string | null;
  memberCode?: string | null;
  gymName?: string | null;
  planName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  daysUntilExpiry?: number | null;
  amountPaid?: string | number | null;
  amountRemaining?: string | number | null;
  daysSinceLastVisit?: number | null;
  remainingSessions?: number | null;
  discount?: string | null;
  portalUrl?: string | null;
}

/**
 * Replaces all placeholders in a template with member/gym business values.
 */
export function fillMessagePlaceholders(template: string, data: MessagePlaceholderData): string {
  let result = template;
  if (data.memberName != null) result = result.split("{اسم العميل}").join(String(data.memberName));
  if (data.memberCode != null) result = result.split("{رقم العضوية}").join(String(data.memberCode));
  const gymName = (data.gymName != null && String(data.gymName).trim() !== "") ? String(data.gymName).trim() : "الجيم";
  result = result.split("{اسم الجيم}").join(gymName);
  result = result.split("{اسم_الجيم}").join(gymName);
  result = result.split("{gym_name}").join(gymName);
  result = result.split("{اسم الصالة}").join(gymName);
  if (data.planName != null) result = result.split("{اسم الخطة}").join(String(data.planName));
  if (data.startDate != null) result = result.split("{تاريخ البداية}").join(String(data.startDate));
  if (data.endDate != null) result = result.split("{تاريخ الانتهاء}").join(String(data.endDate));
  if (data.daysUntilExpiry != null) result = result.split("{الأيام المتبقية}").join(String(data.daysUntilExpiry));
  if (data.amountPaid != null) {
    result = result.split("{المبلغ المدفوع}").join(String(data.amountPaid));
    result = result.split("{المبلغ}").join(String(data.amountPaid));
  }
  if (data.amountRemaining != null) result = result.split("{المبلغ المتبقي}").join(String(data.amountRemaining));
  if (data.daysSinceLastVisit != null) result = result.split("{عدد أيام الغياب}").join(String(data.daysSinceLastVisit));
  if (data.remainingSessions != null) result = result.split("{الحصص المتبقية}").join(String(data.remainingSessions));
  if (data.discount != null) result = result.split("{الخصم}").join(String(data.discount));
  if (data.portalUrl != null) {
    result = result.split("{رابط البوابة}").join(String(data.portalUrl));
    result = result.split("{رابط الكارنيه}").join(String(data.portalUrl));
    result = result.split("{الرابط}").join(String(data.portalUrl));
  }
  return result;
}

export interface PaymentReceiptMessageData {
  gymName?: string | null;
  memberName: string;
  memberCode?: string | null;
  receiptNo?: string | null;
  amountPaid: string | number;
  amountRemaining?: string | number | null;
  planName?: string | null;
  date?: string | null;
  notes?: string | null;
}

export function buildPaymentReceiptMessage(data: PaymentReceiptMessageData): string {
  const gym = data.gymName?.trim() || "الصالة الرياضية";
  return [
    `🧾 *إيصال سداد — ${gym}*`,
    `━━━━━━━━━━━━━━━━`,
    `👤 *العضو:* ${data.memberName}`,
    data.memberCode ? `🆔 *كود العضوية:* ${data.memberCode}` : null,
    data.receiptNo ? `🔢 *رقم الإيصال:* ${data.receiptNo}` : null,
    data.planName ? `📋 *الاشتراك / البيان:* ${data.planName}` : null,
    `💵 *المبلغ المدفوع:* ${data.amountPaid} ج.م`,
    data.amountRemaining && Number(data.amountRemaining) > 0
      ? `⚠️ *المتبقي:* ${data.amountRemaining} ج.م`
      : null,
    data.date ? `📅 *التاريخ:* ${data.date}` : null,
    data.notes ? `📝 *ملاحظات:* ${data.notes}` : null,
    `━━━━━━━━━━━━━━━━`,
    `شكراً لثقتكم بنا وتمنياتنا لكم بتدريب ممتع! 💪✨`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface RenewalReminderMessageData {
  gymName?: string | null;
  memberName: string;
  memberCode?: string | null;
  planName: string;
  endDate: string;
  daysRemaining: number;
}

export function buildRenewalReminderMessage(data: RenewalReminderMessageData): string {
  const gym = data.gymName?.trim() || "الصالة الرياضية";
  const daysText = data.daysRemaining === 0 ? "ينتهي اليوم" : `متبقي ${data.daysRemaining} يوم`;
  return [
    `🔔 *تذكير تجديد الاشتراك — ${gym}*`,
    `━━━━━━━━━━━━━━━━`,
    `مرحباً بك ${data.memberName} 👋`,
    data.memberCode ? `كود العضوية: ${data.memberCode}` : null,
    `نود تذكيرك بأن اشتراكك في باقة (*${data.planName}*) سينتهي بتاريخ:`,
    `📅 *${data.endDate}* (${daysText})`,
    `━━━━━━━━━━━━━━━━`,
    `لتجديد اشتراكك ومواصلة أهدافك الرياضية دون انقطاع، يسعدنا تواصلك مع إدارة الاستقبال.`,
    `نتمنى لك دوام الصحة والتألق! 💪🔥`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Dynamic greeting and closing variations to prevent identical text signatures (anti-ban).
 */
export function applyAntiBanVariations(
  message: string,
  opts?: { memberName?: string | null; salt?: string },
): string {
  const entropy = opts?.salt || Math.random().toString(36).slice(2, 8);
  const zeroWidthSalt = Array.from(entropy)
    .map((c) => (c.charCodeAt(0) % 2 === 0 ? "\u200B" : "\u200C"))
    .join("");

  return `${message}${zeroWidthSalt}`;
}

export function getRandomGreeting(): string {
  const list = [
    "أهلاً يا كابتن",
    "مرحباً يا بطل",
    "تحياتنا لك يا كابتن",
    "يا هلا يا بطل",
    "يسعد أوقاتك يا بطل",
  ];
  return list[Math.floor(Math.random() * list.length)];
}

export function getRandomClosing(): string {
  const list = [
    "نتمنى لك يوماً رائعاً وتدريباً ممتعاً! 💪",
    "فريق العمل جاهز لمساعدتك دائماً! ✨",
    "ننتظر رؤيتك قريباً في الجيم! 🔥",
    "مع أطيب تمنياتنا بدوام الصحة والتألق! 🌟",
    "واصل تقدمك، نحن معك خطوة بخطوة! 🚀",
  ];
  return list[Math.floor(Math.random() * list.length)];
}

export function buildStage2RenewalMessage(data: RenewalReminderMessageData): string {
  const gym = data.gymName?.trim() || "الصالة الرياضية";
  return [
    `⚠️ *تنبيه: اليوم آخر يوم في اشتراكك — ${gym}*`,
    `━━━━━━━━━━━━━━━━`,
    `مرحباً يا ${data.memberName} 👋`,
    data.memberCode ? `كود العضوية: ${data.memberCode}` : null,
    `نود تذكيرك بأن اشتراكك في باقة (*${data.planName}*) ينتهي *اليوم*!`,
    `━━━━━━━━━━━━━━━━`,
    `لتجنب انقطاع سجل تمارينك، تفضل بزيارة مكتب الاستقبال أو تجديد اشتراكك اليوم.`,
    `نحن دائماً في خدمتك! 💪🔥`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildStage3RenewalMessage(data: RenewalReminderMessageData): string {
  const gym = data.gymName?.trim() || "الصالة الرياضية";
  return [
    `وحشتنا يا بطل ${data.memberName} 👋 — ${gym}`,
    `━━━━━━━━━━━━━━━━`,
    data.memberCode ? `كود العضوية: ${data.memberCode}` : null,
    `اشتراكك في باقة (*${data.planName}*) انتهى منذ 3 أيام.`,
    `يسعدنا تجديد باقتك والعودة لمواصلة رحلتك الرياضية مع عروض مميزة بانتظارك!`,
    `━━━━━━━━━━━━━━━━`,
    `تواصل مع موظف الاستقبال أو شرفنا بالزيارة للتجديد. نتطلع لرؤيتك! 💪✨`,
  ]
    .filter(Boolean)
    .join("\n");
}

