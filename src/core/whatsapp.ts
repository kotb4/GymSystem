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
}

/**
 * Replaces all placeholders in a template with member/gym business values.
 */
export function fillMessagePlaceholders(template: string, data: MessagePlaceholderData): string {
  let result = template;
  if (data.memberName != null) result = result.split("{اسم العميل}").join(String(data.memberName));
  if (data.memberCode != null) result = result.split("{رقم العضوية}").join(String(data.memberCode));
  if (data.gymName != null) result = result.split("{اسم الجيم}").join(String(data.gymName));
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
  return result;
}
