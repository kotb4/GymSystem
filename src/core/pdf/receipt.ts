import { drawText, embedPdfFont, toAsciiDigits } from "./arabic";
import { drawDeveloperCredit } from "./credit";
import { formatMinor } from "@/core/money";
import PDFDocumentType from "pdfkit";
import QRCode from "qrcode";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

export interface ReceiptData {
  gymName: string;
  gymPhone?: string | null;
  gymAddress?: string | null;
  receiptNo: string;
  issuedAt: string;
  memberCode: string;
  memberName: string;
  memberPhone: string | null;
  planName: string | null;
  baseAmountMinor: number;
  discountAmountMinor: number;
  netAmountMinor: number;
  paidAmountMinor: number;
  remainingAmountMinor: number;
  refundedAmountMinor: number;
  methodLabel: string;
  status: string;
  referenceNo: string | null;
  notes: string | null;
  createdByName: string;
  branchName: string | null;
  /** Title shown in header banner. Defaults to "فاتورة دفع". */
  title?: string;
  logoBuffer?: Buffer | null;
  logoWidth?: number;
  showQr?: boolean;
  showTax?: boolean;
  taxPercent?: number;
  taxAmountMinor?: number;
  footerText?: string | null;
  terms?: string[];
}

const PAGE_MARGIN = 36;
const COLOR_PRIMARY = "#0055FF"; // Electric Cobalt Blue
const COLOR_PRIMARY_DARK = "#080B11"; // Obsidian Black
const COLOR_LABEL = "#475569"; // Slate 600
const COLOR_VALUE = "#0f172a"; // Slate 900
const COLOR_LIGHT_BORDER = "#cbd5e1"; // Slate 300
const COLOR_CARD_BG = "#f8fafc"; // Slate 50
const COLOR_ROW_ALT = "#f1f5f9"; // Slate 100
const COLOR_SUCCESS = "#047857"; // Emerald 700
const COLOR_DANGER = "#b91c1c"; // Red 700

const STATUS_LABELS: Record<string, string> = {
  partial: "مدفوع جزئياً",
  paid: "مدفوع بالكامل",
  voided: "ملغي",
  refunded: "مسترجع",
};

/** Render the modern receipt and return the raw PDF bytes. */
export async function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  // Generate verification QR code buffer if enabled (default true)
  let qrBuffer: Buffer | null = null;
  if (data.showQr !== false) {
    const qrPayload = JSON.stringify({
      receipt: data.receiptNo,
      member: data.memberCode,
      paid: (data.paidAmountMinor / 100).toFixed(2),
      date: data.issuedAt,
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
        Title: `Receipt ${data.receiptNo}`,
        Author: data.gymName,
        Subject: "Payment receipt",
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

function paint(doc: PdfDoc, data: ReceiptData, qrBuffer: Buffer | null): void {
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

  // Decorative subtle diagonal strip on left
  doc.polygon(
    [left, PAGE_MARGIN],
    [left + 120, PAGE_MARGIN],
    [left + 80, PAGE_MARGIN + headerH],
    [left, PAGE_MARGIN + headerH],
  ).fill(COLOR_PRIMARY_DARK);
  doc.restore();

  // Title and Gym Name inside Header Banner
  const gymTitle = data.gymName;
  const subTitle = data.title ?? "فاتورة دفع رسمية";

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

  // Left side of Header Banner (Receipt Number & Date & Optional Logo)
  let headerLeftStart = left + 20;
  let headerLeftW = width * 0.45 - 20;

  if (data.logoBuffer) {
    try {
      const fitWidth = Math.max(30, Math.min(140, Math.round((data.logoWidth ?? 100) * 0.75)));
      doc.image(data.logoBuffer, left + 16, PAGE_MARGIN + 12, { fit: [fitWidth, 54] });
      headerLeftStart = left + 16 + fitWidth + 10;
      headerLeftW = width * 0.45 - (fitWidth + 12);
    } catch {
      // Fallback
    }
  }

  drawText(doc, `رقم المرجع: ${toAsciiDigits(data.receiptNo)}`, headerLeftStart, PAGE_MARGIN + 14, headerLeftW, {
    size: 12,
    align: "left",
    color: "#ffffff",
    weight: "bold",
  });

  const dateClean = data.issuedAt.slice(0, 10);
  const dateStr = data.branchName ? `${toAsciiDigits(dateClean)} • فرع: ${data.branchName}` : `التاريخ: ${toAsciiDigits(dateClean)}`;
  drawText(doc, dateStr, headerLeftStart, PAGE_MARGIN + 44, headerLeftW, {
    size: 9,
    align: "left",
    color: "#e6fffa",
    weight: "regular",
  });

  let curY = PAGE_MARGIN + headerH + 16;

  // ── Member & Subscription Info Card ─────────────────────────────────────
  const memberCardH = 74;
  doc.roundedRect(left + 12, curY, width - 24, memberCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(left + 12, curY, width - 24, memberCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  // 2-Column layout inside Member Card
  const colW = (width - 48) / 2;
  const colRightX = left + 24 + colW;
  const colLeftX = left + 24;

  // Row 1: Member Name & Code
  cardField(doc, colRightX, curY + 8, colW, "اسم العضو", data.memberName, true);
  cardField(doc, colLeftX, curY + 8, colW, "كود العضوية", toAsciiDigits(data.memberCode), true);

  // Row 2: Phone & Plan
  cardField(
    doc,
    colRightX,
    curY + 40,
    colW,
    "رقم الموبايل",
    data.memberPhone ? toAsciiDigits(data.memberPhone) : "—",
  );
  cardField(doc, colLeftX, curY + 40, colW, "الباقة", data.planName ?? "—");

  curY += memberCardH + 18;

  // ── Section Title: تفاصيل الفاتورة ────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "بيانات الدفع والمبالغ المالية");
  curY += 24;

  // ── Financial Breakdown Table ───────────────────────────────────────────
  const tableX = left + 12;
  const tableW = width - 24;

  // Table Header
  const headerRowH = 26;
  doc.roundedRect(tableX, curY, tableW, headerRowH, 4).fill(COLOR_ROW_ALT);
  // Description column on the RIGHT:
  drawText(doc, "البند والبيان", tableX + tableW * 0.45, curY + 6, tableW * 0.55 - 16, {
    size: 10,
    align: "right",
    color: COLOR_LABEL,
    weight: "bold",
  });
  // Amount column on the LEFT:
  drawText(doc, "المبلغ - ج.م", tableX + 16, curY + 6, tableW * 0.45 - 16, {
    size: 10,
    align: "left",
    color: COLOR_LABEL,
    weight: "bold",
  });
  curY += headerRowH + 6;

  // Rows
  curY = tableRow(doc, tableX, curY, tableW, "قيمة الاشتراك الأساسية", data.baseAmountMinor);
  if (data.discountAmountMinor > 0) {
    curY = tableRow(doc, tableX, curY, tableW, "الخصم المطبق", -data.discountAmountMinor, false, true);
  }
  if (data.showTax && data.taxPercent && data.taxAmountMinor && data.taxAmountMinor > 0) {
    curY = tableRow(doc, tableX, curY, tableW, `ضريبة القيمة المضافة (${toAsciiDigits(String(data.taxPercent))}%)`, data.taxAmountMinor);
  }
  const netWithTax = data.netAmountMinor + (data.taxAmountMinor ?? 0);
  curY = tableRow(doc, tableX, curY, tableW, "الإجمالي المستحق", netWithTax, true);

  // ── Prominent Paid Box (Grand Badge) ────────────────────────────────────
  curY += 10;
  const grandBoxH = 58;
  doc.roundedRect(tableX, curY, tableW, grandBoxH, 8).fill("#f0fdf4");
  doc.roundedRect(tableX, curY, tableW, grandBoxH, 8).lineWidth(1.2).strokeColor("#86efac").stroke();

  drawText(doc, "الـمـبـلـغ الـمـدفـوع فـعـلـيـاً", tableX + tableW * 0.4, curY + 18, tableW * 0.6 - 16, {
    size: 13,
    align: "right",
    color: COLOR_SUCCESS,
    weight: "bold",
  });

  const paidFormatted = `ج.م ${toAsciiDigits(formatMinor(data.paidAmountMinor))}`;
  drawText(doc, paidFormatted, tableX + 16, curY + 14, tableW * 0.4, {
    size: 18,
    align: "left",
    color: COLOR_SUCCESS,
    weight: "bold",
  });
  curY += grandBoxH + 12;

  // Remaining and Refund rows
  if (data.remainingAmountMinor > 0) {
    curY = tableRow(doc, tableX, curY, tableW, "المبلغ المتبقي على العضو", data.remainingAmountMinor, true, true);
  }
  if (data.refundedAmountMinor > 0) {
    curY = tableRow(doc, tableX, curY, tableW, "المبلغ المسترجع", -data.refundedAmountMinor, false, true);
  }

  curY += 14;

  // ── Payment Metadata Card ───────────────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "تفاصيل العملية والموظف");
  curY += 24;

  const metaCardH = 74;
  doc.roundedRect(tableX, curY, tableW, metaCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(tableX, curY, tableW, metaCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  cardField(doc, colRightX, curY + 8, colW, "طريقة الدفع", data.methodLabel);
  cardField(doc, colLeftX, curY + 8, colW, "الموظف المسؤول", data.createdByName);

  cardField(doc, colRightX, curY + 40, colW, "حالة الإيصال", STATUS_LABELS[data.status] ?? data.status);
  if (data.referenceNo) {
    cardField(doc, colLeftX, curY + 40, colW, "رقم مرجعي / شيك", toAsciiDigits(data.referenceNo));
  } else if (data.notes) {
    cardField(doc, colLeftX, curY + 40, colW, "ملاحظات", data.notes);
  }

  curY += metaCardH + 14;

  // ── Notes block if present and not placed yet ───────────────────────────
  if (data.notes && data.referenceNo) {
    doc.roundedRect(tableX, curY, tableW, 28, 6).fill("#fffbeb");
    doc.roundedRect(tableX, curY, tableW, 28, 6).lineWidth(0.6).strokeColor("#fde68a").stroke();
    drawText(doc, `ملاحظات: ${data.notes}`, tableX + 12, curY + 6, tableW - 24, {
      size: 9,
      align: "right",
      color: "#92400e",
    });
    curY += 34;
  }

  // ── Terms & Rules block if present ──────────────────────────────────────
  if (data.terms && data.terms.length > 0) {
    const termsCount = Math.min(3, data.terms.length);
    const termsH = termsCount * 13 + 22;
    doc.roundedRect(tableX, curY, tableW, termsH, 6).fill("#f8fafc");
    doc.roundedRect(tableX, curY, tableW, termsH, 6).lineWidth(0.6).strokeColor(COLOR_LIGHT_BORDER).stroke();
    drawText(doc, "شروط وقواعد الاشتراك بالصالة:", tableX + 12, curY + 4, tableW - 24, {
      size: 8.5,
      align: "right",
      color: COLOR_VALUE,
      weight: "bold",
    });
    let tY = curY + 17;
    for (let i = 0; i < termsCount; i += 1) {
      drawText(doc, `• ${data.terms[i]}`, tableX + 12, tY, tableW - 24, {
        size: 7.8,
        align: "right",
        color: COLOR_LABEL,
      });
      tY += 12;
    }
    curY += termsH + 10;
  }

  // ── Footer with QR Code, Footer Text, and Gym Stamp ─────────────────────
  const footerH = 88;
  const footerY = pageHeight - PAGE_MARGIN - footerH - 12;

  doc.moveTo(left + 12, footerY).lineTo(right - 12, footerY).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  // QR Code on Left (only if enabled)
  if (qrBuffer) {
    doc.image(qrBuffer, left + 20, footerY + 10, { width: 68, height: 68 });
  }

  // Footer text
  if (data.footerText) {
    const footX = left + (qrBuffer ? 100 : 20);
    const footW = width - (qrBuffer ? 120 : 40);
    drawText(doc, data.footerText, footX, footerY + 14, footW, {
      size: 9,
      align: "center",
      color: COLOR_LABEL,
      weight: "bold",
    });
  }

  // Centered Developer Credit (see ./credit.ts)
  drawDeveloperCredit(doc, footerY + 36);
}

function drawSectionHeader(doc: PdfDoc, x: number, y: number, width: number, title: string): void {
  // Small colored vertical pill on the right
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

function tableRow(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  label: string,
  amountMinor: number,
  isEmphasized = false,
  isDanger = false,
): number {
  const rowH = 22;
  const labelW = width * 0.55;
  const amountW = width * 0.45;

  // Background alternating line
  doc.moveTo(x + 10, y + rowH - 2).lineTo(x + width - 10, y + rowH - 2).lineWidth(0.5).strokeColor("#e2e8f0").stroke();

  drawText(doc, label, x + width - labelW, y + 2, labelW - 16, {
    size: isEmphasized ? 10.5 : 10,
    align: "right",
    color: isEmphasized ? COLOR_VALUE : COLOR_LABEL,
    weight: isEmphasized ? "bold" : "regular",
  });

  const num = toAsciiDigits(formatMinor(Math.abs(amountMinor)));
  const text = amountMinor < 0 ? `- ${num}` : num;

  drawText(doc, text, x + 16, y + 2, amountW - 16, {
    size: isEmphasized ? 11 : 10,
    align: "left",
    color: isDanger ? COLOR_DANGER : isEmphasized ? COLOR_PRIMARY : COLOR_VALUE,
    weight: isEmphasized ? "bold" : "regular",
  });

  return y + rowH;
}
