import { drawText, embedPdfFont, toAsciiDigits } from "./arabic";
import { drawDeveloperCredit } from "./credit";
import { formatMinor } from "@/core/money";
import PDFDocumentType from "pdfkit";
import QRCode from "qrcode";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

export interface SubscriptionContractData {
  gymName: string;
  gymPhone?: string | null;
  gymAddress?: string | null;
  contractNo: string;
  issuedAt: string;
  branchName: string | null;
  memberName: string;
  memberCode: string;
  memberPhone: string | null;
  planName: string;
  kindLabel: string;
  startDate: string;
  endDate: string;
  sessionsLimit: number | null;
  freezeDaysLimit: number;
  freezeMaxCount: number;
  priceMinor: number;
  discountMinor: number;
  netMinor: number;
  paidMinor: number;
  remainingMinor: number;
  terms: string[];
  title?: string;
  logoBuffer?: Buffer | null;
  showQr?: boolean;
  footerText?: string | null;
}

const PAGE_MARGIN = 36;
const COLOR_PRIMARY = "#0055FF"; // Electric Cobalt Blue
const COLOR_PRIMARY_DARK = "#080B11"; // Obsidian Black
const COLOR_LABEL = "#475569"; // Slate 600
const COLOR_VALUE = "#0f172a"; // Slate 900
const COLOR_MUTED = "#64748b"; // Slate 500
const COLOR_LIGHT_BORDER = "#cbd5e1"; // Slate 300
const COLOR_CARD_BG = "#f8fafc"; // Slate 50

/** Render the modern member subscription agreement/contract PDF. */
export async function renderSubscriptionContractPdf(data: SubscriptionContractData): Promise<Buffer> {
  let qrBuffer: Buffer | null = null;
  if (data.showQr !== false) {
    const qrPayload = JSON.stringify({
      contract: data.contractNo,
      member: data.memberCode,
      plan: data.planName,
      end: data.endDate,
    });
    try {
      qrBuffer = await QRCode.toBuffer(qrPayload, {
        width: 140,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
    } catch {
      qrBuffer = null;
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentType({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: `Membership Contract ${data.contractNo}`,
        Author: data.gymName,
        Subject: "Gym Membership Agreement",
        Creator: "GymGate",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      paint(doc, data, qrBuffer);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function paint(doc: PdfDoc, data: SubscriptionContractData, qrBuffer: Buffer | null): void {
  embedPdfFont(doc);
  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;
  const pageHeight = doc.page.height;

  // ── Outer Decorative Frame ───────────────────────────────────────────────
  doc
    .roundedRect(left, PAGE_MARGIN, width, pageHeight - PAGE_MARGIN * 2, 10)
    .lineWidth(1)
    .strokeColor(COLOR_LIGHT_BORDER)
    .stroke();

  // ── Top Header Banner ───────────────────────────────────────────────────
  const headerH = 78;
  doc.save();
  doc.roundedRect(left, PAGE_MARGIN, width, headerH, 10).clip();
  doc.rect(left, PAGE_MARGIN, width, headerH).fill(COLOR_PRIMARY);

  doc.polygon(
    [left, PAGE_MARGIN],
    [left + 120, PAGE_MARGIN],
    [left + 80, PAGE_MARGIN + headerH],
    [left, PAGE_MARGIN + headerH],
  ).fill(COLOR_PRIMARY_DARK);
  doc.restore();

  const gymTitle = data.gymName;
  const subTitle = data.title ?? "عقد اشتراك عضوية رسمي";

  // Right side of Header Banner (Gym & Invoice Type & Address/Phone)
  const headerRightW = width * 0.6 - 20;
  drawText(doc, gymTitle, left + width - headerRightW - 20, PAGE_MARGIN + 12, headerRightW, {
    size: 19,
    align: "right",
    color: "#ffffff",
    weight: "bold",
  });

  const subLineParts = [subTitle];
  if (data.gymAddress) subLineParts.push(data.gymAddress);
  if (data.gymPhone) subLineParts.push(`هاتف: ${toAsciiDigits(data.gymPhone)}`);
  const subText = subLineParts.join(" • ");

  drawText(doc, subText, left + width - headerRightW - 20, PAGE_MARGIN + 42, headerRightW, {
    size: 9,
    align: "right",
    color: "#ccfbf1",
    weight: "regular",
  });

  // Left side of Header Banner (Contract Number & Date & Optional Logo)
  let headerLeftStart = left + 20;
  let headerLeftW = width * 0.4 - 20;

  if (data.logoBuffer) {
    try {
      doc.image(data.logoBuffer, left + 16, PAGE_MARGIN + 12, { fit: [54, 54] });
      headerLeftStart = left + 78;
      headerLeftW = width * 0.4 - 78;
    } catch {
      // Fallback
    }
  }

  drawText(doc, `عقد رقم: ${toAsciiDigits(data.contractNo)}`, headerLeftStart, PAGE_MARGIN + 15, headerLeftW, {
    size: 11,
    align: "left",
    color: "#ffffff",
    weight: "bold",
  });

  const dateClean = data.issuedAt.slice(0, 10);
  const dateStr = data.branchName ? `${toAsciiDigits(dateClean)} • فرع: ${data.branchName}` : `تاريخ التحرير: ${toAsciiDigits(dateClean)}`;
  drawText(doc, dateStr, headerLeftStart, PAGE_MARGIN + 43, headerLeftW, {
    size: 9,
    align: "left",
    color: "#e6fffa",
    weight: "regular",
  });

  let curY = PAGE_MARGIN + headerH + 16;

  // ── Member Section Card ──────────────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "بيانات العضو المشترك");
  curY += 22;

  const memberCardH = 74;
  doc.roundedRect(left + 12, curY, width - 24, memberCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(left + 12, curY, width - 24, memberCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  const colW = (width - 48) / 2;
  const colRightX = left + 24 + colW;
  const colLeftX = left + 24;

  cardField(doc, colRightX, curY + 8, colW, "اسم العضو", data.memberName, true);
  cardField(doc, colLeftX, curY + 8, colW, "كود العضوية", toAsciiDigits(data.memberCode), true);

  cardField(
    doc,
    colRightX,
    curY + 40,
    colW,
    "رقم الموبايل",
    data.memberPhone ? toAsciiDigits(data.memberPhone) : "—",
  );
  cardField(doc, colLeftX, curY + 40, colW, "الفرع المعتمد", data.branchName ?? "الفرع الرئيسي");

  curY += memberCardH + 16;

  // ── Subscription Details Section ──────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "تفاصيل باقة الاشتراك والصلاحية");
  curY += 22;

  const subCardH = 110;
  doc.roundedRect(left + 12, curY, width - 24, subCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(left + 12, curY, width - 24, subCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  // Row 1
  cardField(doc, colRightX, curY + 8, colW, "اسم الباقة", data.planName, true);
  cardField(doc, colLeftX, curY + 8, colW, "نوع الباقة", data.kindLabel);

  // Row 2
  cardField(doc, colRightX, curY + 42, colW, "تاريخ البداية", toAsciiDigits(data.startDate));
  cardField(doc, colLeftX, curY + 42, colW, "تاريخ النهاية", toAsciiDigits(data.endDate), true);

  // Row 3
  const sessionsVal = data.sessionsLimit != null ? `${toAsciiDigits(String(data.sessionsLimit))} حصة` : "مفتوح وغير محدود";
  const freezeVal = data.freezeDaysLimit > 0 ? `${toAsciiDigits(String(data.freezeDaysLimit))} يوم (${toAsciiDigits(String(data.freezeMaxCount))} مرات)` : "غير متاح";
  cardField(doc, colRightX, curY + 76, colW, "رصيد الحصص", sessionsVal);
  cardField(doc, colLeftX, curY + 76, colW, "رصيد التجميد", freezeVal);

  curY += subCardH + 16;

  // ── Financial Breakdown Section ─────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "البيانات المالية وسند السداد");
  curY += 22;

  const finCardH = 74;
  doc.roundedRect(left + 12, curY, width - 24, finCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(left + 12, curY, width - 24, finCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  cardField(doc, colRightX, curY + 8, colW, "قيمة الباقة", `ج.م ${toAsciiDigits(formatMinor(data.priceMinor))}`);
  cardField(doc, colLeftX, curY + 8, colW, "الصافي المطلوب", `ج.م ${toAsciiDigits(formatMinor(data.netMinor))}`, true);

  cardField(doc, colRightX, curY + 40, colW, "الخصم المطبق", `ج.م ${toAsciiDigits(formatMinor(data.discountMinor))}`);
  const paidText = data.remainingMinor > 0
    ? `ج.م ${toAsciiDigits(formatMinor(data.paidMinor))} (متبقي: ${toAsciiDigits(formatMinor(data.remainingMinor))})`
    : `ج.م ${toAsciiDigits(formatMinor(data.paidMinor))} (خالص بالكامل)`;
  cardField(doc, colLeftX, curY + 40, colW, "المبلغ المسدد", paidText, true);

  curY += finCardH + 16;

  // ── Terms & Conditions Section ──────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "الشروط والأحكام العامة للائحة الصالة");
  curY += 20;

  const terms = data.terms.length > 0 ? data.terms : [
    "الاشتراك شخصي وخاص بالعضو المسجل ولا يجوز التنازل عنه أو نقله إلا بموافقة الإدارة المسبقة.",
    "الالتزام بالزي الرياضي المناسب واستخدام المنشفة الشخصية داخل الصالة وقفل الخزانة بالمفتاح.",
    "إدارة الصالة غير مسؤولة عن فقدان المقتنيات الشخصية أو الأموال المتروكة في الخزائن.",
    "تجميد الاشتراك يخضع لضوابط الباقة والحد الأقصى للأيام المحددة ولا يقبل التجميد بأثر رجعي.",
    "يحق لإدارة الصالة إلغاء أو تعليق عضوية أي مشترك يخالف تعليمات السلامة أو الآداب العامة.",
  ];

  for (let i = 0; i < terms.length; i += 1) {
    const bullet = `• ${terms[i]}`;
    drawText(doc, bullet, left + 16, curY, width - 32, {
      size: 9,
      align: "right",
      color: COLOR_LABEL,
      weight: "regular",
    });
    curY += 15;
  }

  // ── Signatures & Stamp Section ──────────────────────────────────────────
  const footerH = 110;
  const footerY = pageHeight - PAGE_MARGIN - footerH - 10;

  doc.moveTo(left + 12, footerY).lineTo(right - 12, footerY).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  // Signatures
  const sigBoxW = (width - 120) / 2;
  const memberSigX = left + width - sigBoxW - 16;
  const gymSigX = left + 100;

  drawText(doc, "توقيع العضو المشترك بالإقرار والموافقة", memberSigX, footerY + 12, sigBoxW, {
    size: 10,
    align: "right",
    color: COLOR_VALUE,
    weight: "bold",
  });
  drawText(doc, "........................................................", memberSigX, footerY + 44, sigBoxW, {
    size: 10,
    align: "right",
    color: COLOR_MUTED,
  });

  drawText(doc, "توقيع وخاتم إدارة الصالة الرياضية", gymSigX, footerY + 12, sigBoxW, {
    size: 10,
    align: "left",
    color: COLOR_VALUE,
    weight: "bold",
  });
  drawText(doc, "........................................................", gymSigX, footerY + 44, sigBoxW, {
    size: 10,
    align: "left",
    color: COLOR_MUTED,
  });

  // QR Code on far left
  if (qrBuffer) {
    doc.image(qrBuffer, left + 16, footerY + 8, { width: 68, height: 68 });
  }

  // Footer note if configured
  if (data.footerText) {
    const footX = left + (qrBuffer ? 90 : 20);
    const footW = width - (qrBuffer ? 110 : 40);
    drawText(doc, data.footerText, footX, footerY + 68, footW, {
      size: 8.5,
      align: "center",
      color: COLOR_MUTED,
      weight: "bold",
    });
  }

  // Centered Developer Credit (see ./credit.ts)
  drawDeveloperCredit(doc, footerY + 90);
}

function drawSectionHeader(doc: PdfDoc, x: number, y: number, width: number, title: string): void {
  doc.roundedRect(x + width - 4, y + 2, 4, 14, 2).fill(COLOR_PRIMARY);
  drawText(doc, title, x, y, width - 12, {
    size: 11,
    align: "right",
    color: COLOR_VALUE,
    weight: "bold",
  });
}

function cardField(
  doc: PdfDoc,
  x: number,
  y: number,
  colW: number,
  label: string,
  value: string,
  boldValue = false,
): void {
  // Label on top line
  drawText(doc, label, x, y, colW - 12, {
    size: 8.5,
    align: "right",
    color: COLOR_LABEL,
    weight: "regular",
  });

  // Value directly below it
  drawText(doc, value, x, y + 13, colW - 12, {
    size: 10.5,
    align: "right",
    color: COLOR_VALUE,
    weight: boldValue ? "bold" : "regular",
  });
}
