import { drawText, embedPdfFont, toAsciiDigits } from "./arabic";
import { drawDeveloperCredit } from "./credit";
import { formatMinor } from "@/core/money";
import PDFDocumentType from "pdfkit";
import QRCode from "qrcode";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

export interface StoreReceiptItem {
  productName: string;
  qty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface StoreReceiptData {
  gymName: string;
  saleNo: string;
  soldAt: string;
  branchName: string | null;
  customerName: string;
  customerPhone: string | null;
  cashierName: string;
  items: StoreReceiptItem[];
  itemsTotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  methodLabel: string;
  isCredit: boolean;
  paymentStatusText?: string;
  isPaid?: boolean;
  debtRemainingMinor?: number;
  status: string;
  title?: string;
}

const PAGE_MARGIN = 36;
const COLOR_PRIMARY = "#0f766e"; // Emerald 700
const COLOR_PRIMARY_DARK = "#115e59"; // Emerald 800
const COLOR_LABEL = "#475569"; // Slate 600
const COLOR_VALUE = "#0f172a"; // Slate 900
const COLOR_LIGHT_BORDER = "#cbd5e1"; // Slate 300
const COLOR_CARD_BG = "#f8fafc"; // Slate 50
const COLOR_ROW_ALT = "#f1f5f9"; // Slate 100
const COLOR_SUCCESS = "#047857"; // Emerald 700
const COLOR_DANGER = "#b91c1c"; // Red 700

/** Render the modern store sales receipt and return the raw PDF bytes. */
export async function renderStoreReceiptPdf(data: StoreReceiptData): Promise<Buffer> {
  const qrPayload = JSON.stringify({
    sale: data.saleNo,
    customer: data.customerName,
    total: (data.totalMinor / 100).toFixed(2),
    date: data.soldAt,
  });
  let qrBuffer: Buffer | null = null;
  try {
    qrBuffer = await QRCode.toBuffer(qrPayload, {
      width: 140,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  } catch {
    qrBuffer = null;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentType({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: `Store Sale ${data.saleNo}`,
        Author: data.gymName,
        Subject: "Store sales receipt",
        Creator: "GymSystem",
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

function paint(doc: PdfDoc, data: StoreReceiptData, qrBuffer: Buffer | null): void {
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
  const subTitle = data.title ?? "فاتورة مبيعات متجر";

  // Right side of Header Banner (Gym & Invoice Type)
  const headerRightW = width * 0.6 - 20;
  drawText(doc, gymTitle, left + width - headerRightW - 20, PAGE_MARGIN + 14, headerRightW, {
    size: 20,
    align: "right",
    color: "#ffffff",
    weight: "bold",
  });

  drawText(doc, subTitle, left + width - headerRightW - 20, PAGE_MARGIN + 44, headerRightW, {
    size: 11,
    align: "right",
    color: "#ccfbf1",
    weight: "regular",
  });

  // Left side of Header Banner (Sale Number & Date)
  const headerLeftW = width * 0.4 - 20;
  drawText(doc, `رقم: ${toAsciiDigits(data.saleNo)}`, left + 20, PAGE_MARGIN + 16, headerLeftW, {
    size: 11,
    align: "left",
    color: "#ffffff",
    weight: "bold",
  });

  const dateClean = data.soldAt.slice(0, 10);
  const dateStr = data.branchName ? `${toAsciiDigits(dateClean)} • فرع: ${data.branchName}` : `التاريخ: ${toAsciiDigits(dateClean)}`;
  drawText(doc, dateStr, left + 20, PAGE_MARGIN + 44, headerLeftW, {
    size: 9.5,
    align: "left",
    color: "#e6fffa",
    weight: "regular",
  });

  let curY = PAGE_MARGIN + headerH + 16;

  // ── Customer & Cashier Info Card ─────────────────────────────────────────
  const infoCardH = 74;
  doc.roundedRect(left + 12, curY, width - 24, infoCardH, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(left + 12, curY, width - 24, infoCardH, 8).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  const colW = (width - 48) / 2;
  const colRightX = left + 24 + colW;
  const colLeftX = left + 24;

  cardField(doc, colRightX, curY + 8, colW, "العميل", data.customerName, true);
  cardField(doc, colLeftX, curY + 8, colW, "الكاشير", data.cashierName, true);

  cardField(
    doc,
    colRightX,
    curY + 40,
    colW,
    "رقم الموبايل",
    data.customerPhone ? toAsciiDigits(data.customerPhone) : "—",
  );
  cardField(
    doc,
    colLeftX,
    curY + 40,
    colW,
    "حالة السداد",
    data.paymentStatusText ?? (data.isCredit ? "غير مسدد (بيع بالآجل)" : "مسدد بالكامل"),
    true,
  );

  curY += infoCardH + 18;

  // ── Section Title: الأصناف المشتراة ──────────────────────────────────────
  drawSectionHeader(doc, left + 12, curY, width - 24, "بيانات الأصناف والمنتجات");
  curY += 24;

  // ── Items Table ───────────────────────────────────────────────────────────
  const tableX = left + 12;
  const tableW = width - 24;

  const colItemW = tableW * 0.46;
  const colQtyW = tableW * 0.14;
  const colPriceW = tableW * 0.20;
  const colTotalW = tableW * 0.20;

  const colItemX = tableX + tableW - colItemW;
  const colQtyX = colItemX - colQtyW;
  const colPriceX = colQtyX - colPriceW;
  const colTotalX = tableX;

  // Header Row
  const headerRowH = 26;
  doc.roundedRect(tableX, curY, tableW, headerRowH, 4).fill(COLOR_ROW_ALT);
  drawText(doc, "الصنف / المنتج", colItemX, curY + 6, colItemW - 8, {
    size: 10,
    align: "right",
    color: COLOR_LABEL,
    weight: "bold",
  });
  drawText(doc, "الكمية", colQtyX, curY + 6, colQtyW, {
    size: 10,
    align: "center",
    color: COLOR_LABEL,
    weight: "bold",
  });
  drawText(doc, "سعر الوحدة - ج.م", colPriceX, curY + 6, colPriceW, {
    size: 10,
    align: "left",
    color: COLOR_LABEL,
    weight: "bold",
  });
  drawText(doc, "الإجمالي - ج.م", colTotalX + 8, curY + 6, colTotalW - 8, {
    size: 10,
    align: "left",
    color: COLOR_LABEL,
    weight: "bold",
  });
  curY += headerRowH + 6;

  // Items Rows
  for (const item of data.items) {
    doc.moveTo(tableX, curY + 22).lineTo(tableX + tableW, curY + 22).lineWidth(0.5).strokeColor("#e2e8f0").stroke();

    drawText(doc, item.productName, colItemX, curY + 3, colItemW - 8, {
      size: 10,
      align: "right",
      color: COLOR_VALUE,
    });
    drawText(doc, toAsciiDigits(String(item.qty)), colQtyX, curY + 3, colQtyW, {
      size: 10,
      align: "center",
      color: COLOR_VALUE,
      weight: "bold",
    });
    drawText(
      doc,
      toAsciiDigits(formatMinor(item.unitPriceMinor)),
      colPriceX,
      curY + 3,
      colPriceW,
      {
        size: 9.5,
        align: "left",
        color: COLOR_VALUE,
      },
    );
    drawText(
      doc,
      toAsciiDigits(formatMinor(item.lineTotalMinor)),
      colTotalX + 8,
      curY + 3,
      colTotalW - 8,
      {
        size: 9.5,
        align: "left",
        color: COLOR_VALUE,
        weight: "bold",
      },
    );
    curY += 24;
  }

  curY += 10;

  // ── Financial Breakdown Rows ────────────────────────────────────────────
  curY = tableRow(doc, tableX, curY, tableW, "إجمالي الأصناف", data.itemsTotalMinor);
  if (data.discountMinor > 0) {
    curY = tableRow(doc, tableX, curY, tableW, "الخصم المطبق", -data.discountMinor, false, true);
  }

  // ── Prominent Net Total Box ─────────────────────────────────────────────
  curY += 8;
  const grandBoxH = 58;
  doc.roundedRect(tableX, curY, tableW, grandBoxH, 8).fill("#f0fdf4");
  doc.roundedRect(tableX, curY, tableW, grandBoxH, 8).lineWidth(1.2).strokeColor("#86efac").stroke();

  drawText(doc, "صـافـي إجـمـالـي الـفـاتـورة", tableX + tableW * 0.4, curY + 18, tableW * 0.6 - 16, {
    size: 13,
    align: "right",
    color: COLOR_SUCCESS,
    weight: "bold",
  });

  const totalFormatted = `ج.م ${toAsciiDigits(formatMinor(data.totalMinor))}`;
  drawText(doc, totalFormatted, tableX + 16, curY + 14, tableW * 0.4, {
    size: 18,
    align: "left",
    color: COLOR_SUCCESS,
    weight: "bold",
  });
  curY += grandBoxH + 10;

  // ── Payment Status Badge Banner ──────────────────────────────────────────
  const isPaid = data.isPaid ?? !data.isCredit;
  const statusBg = isPaid ? "#ecfdf5" : "#fffbeb";
  const statusBorder = isPaid ? "#a7f3d0" : "#fde68a";
  const statusColor = isPaid ? COLOR_SUCCESS : "#b45309";
  const statusTitle = isPaid
    ? (data.paymentStatusText ?? "فاتورة مدفوعة ومسددة بالكامل")
    : (data.paymentStatusText ?? (data.debtRemainingMinor ? `غير مسدد — بيع بالآجل (المتبقي: ${toAsciiDigits(formatMinor(data.debtRemainingMinor))} ج.م)` : "غير مسدد — بيع بالآجل"));

  const badgeH = 28;
  doc.roundedRect(tableX, curY, tableW, badgeH, 6).fill(statusBg);
  doc.roundedRect(tableX, curY, tableW, badgeH, 6).lineWidth(1).strokeColor(statusBorder).stroke();
  drawText(doc, statusTitle, tableX + 12, curY + 7, tableW - 24, {
    size: 10.5,
    align: "center",
    color: statusColor,
    weight: "bold",
  });
  curY += badgeH + 16;

  // ── Footer with Policy and QR Code ──────────────────────────────────────
  const footerH = 88;
  const footerY = pageHeight - PAGE_MARGIN - footerH - 12;

  doc.moveTo(left + 12, footerY).lineTo(right - 12, footerY).lineWidth(0.8).strokeColor(COLOR_LIGHT_BORDER).stroke();

  if (qrBuffer) {
    doc.image(qrBuffer, left + 20, footerY + 10, { width: 68, height: 68 });
  }

  // Centered Developer Credit (see ./credit.ts)
  drawDeveloperCredit(doc, footerY + 36);
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
