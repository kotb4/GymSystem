import PDFDocumentType from "pdfkit";
import { drawText, embedPdfFont, toAsciiDigits } from "./arabic";
import { drawDeveloperCredit } from "./credit";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

const PAGE_MARGIN = 36;
const COLOR_PRIMARY = "#0f766e";
const COLOR_PRIMARY_DARK = "#115e59";
const COLOR_LABEL = "#475569";
const COLOR_VALUE = "#0f172a";
const COLOR_BORDER = "#cbd5e1";
const COLOR_CARD_BG = "#f8fafc";

export interface VoucherField {
  label: string;
  value: string;
}

export interface OperationVoucherData {
  /** Short document title, e.g. "إيصال استرجاع". */
  title: string;
  /** The printed reference number — the whole point of the document. */
  docNo: string;
  issuedAt: string;
  /** Emphasised money row; leave null for documents without an amount. */
  totalLabel: string | null;
  totalMinor: number | null;
  /** Money in/out colouring for the emphasised row. */
  totalTone: "neutral" | "in" | "out";
  fields: VoucherField[];
  /** Optional signature line for cash-counting documents. */
  signatureLabel: string | null;
  branchName: string | null;
  createdByName: string | null;
  notes: string | null;
}

/**
 * One shared voucher layout for every operation that is not a full receipt:
 * refunds, store-debt repayments, cash-box closings and attendance visits.
 *
 * They all need the same things — a big reference number the customer can read
 * back, the member, the amount and a footer — so they share this template rather
 * than each growing its own near-duplicate PDF generator.
 */
export async function renderOperationVoucherPdf(data: OperationVoucherData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentType({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: `${data.title} ${data.docNo}`,
        Author: "GymSystem",
        Subject: data.title,
        Creator: "GymSystem",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      paint(doc, data);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

const TONE_BG: Record<OperationVoucherData["totalTone"], string> = {
  neutral: "#f0fdf4",
  in: "#ecfdf5",
  out: "#fef2f2",
};
const TONE_BORDER: Record<OperationVoucherData["totalTone"], string> = {
  neutral: "#bbf7d0",
  in: "#a7f3d0",
  out: "#fecaca",
};
const TONE_TEXT: Record<OperationVoucherData["totalTone"], string> = {
  neutral: "#047857",
  in: "#047857",
  out: "#b91c1c",
};

function paint(doc: PdfDoc, data: OperationVoucherData): void {
  embedPdfFont(doc);
  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;

  doc
    .roundedRect(left, PAGE_MARGIN, width, doc.page.height - PAGE_MARGIN * 2, 10)
    .lineWidth(1)
    .strokeColor(COLOR_BORDER)
    .stroke();

  // ── Header banner ────────────────────────────────────────────────────────
  const headerH = 96;
  doc.save();
  doc.roundedRect(left, PAGE_MARGIN, width, headerH, 10).clip();
  doc.rect(left, PAGE_MARGIN, width, headerH).fill(COLOR_PRIMARY);
  doc
    .polygon([left, PAGE_MARGIN], [left + 110, PAGE_MARGIN], [left + 70, PAGE_MARGIN + headerH], [left, PAGE_MARGIN + headerH])
    .fill(COLOR_PRIMARY_DARK);
  doc.restore();

  const innerX = left + 20;
  const innerW = width - 40;

  drawText(doc, data.title, innerX, PAGE_MARGIN + 16, innerW, {
    size: 18,
    align: "right",
    color: "#ffffff",
    weight: "bold",
  });

  // The reference number is the largest element on the page: it is what the
  // customer keeps and reads back later.
  drawText(doc, toAsciiDigits(data.docNo), innerX, PAGE_MARGIN + 46, innerW, {
    size: 26,
    align: "center",
    color: "#ffffff",
    weight: "bold",
  });
  drawText(doc, "رقم المرجع", innerX, PAGE_MARGIN + 78, innerW, {
    size: 9,
    align: "center",
    color: "#ccfbf1",
  });

  let y = PAGE_MARGIN + headerH + 22;

  // ── Meta card ────────────────────────────────────────────────────────────
  const metaFields: VoucherField[] = [
    { label: "تاريخ الإصدار", value: toAsciiDigits(data.issuedAt) },
    ...(data.branchName ? [{ label: "الفرع", value: data.branchName }] : []),
    ...(data.createdByName ? [{ label: "بواسطة", value: data.createdByName }] : []),
  ];
  y = fieldCard(doc, innerX, y, innerW, metaFields, 2);

  // ── Detail rows ──────────────────────────────────────────────────────────
  if (data.fields.length > 0) {
    y = fieldCard(doc, innerX, y, innerW, data.fields, 2);
  }

  // ── Emphasised amount ────────────────────────────────────────────────────
  if (data.totalLabel !== null && data.totalMinor !== null) {
    const boxH = 64;
    doc.roundedRect(innerX, y, innerW, boxH, 8).fill(TONE_BG[data.totalTone]);
    doc.roundedRect(innerX, y, innerW, boxH, 8).lineWidth(0.8).strokeColor(TONE_BORDER[data.totalTone]).stroke();
    drawText(doc, data.totalLabel, innerX + 14, y + 12, innerW - 28, {
      size: 11,
      align: "right",
      color: COLOR_LABEL,
    });
    drawText(doc, `${toAsciiDigits(formatAmount(data.totalMinor))} ج.م`, innerX + 14, y + 32, innerW - 28, {
      size: 20,
      align: "right",
      color: TONE_TEXT[data.totalTone],
      weight: "bold",
    });
    y += boxH + 18;
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  if (data.notes) {
    const h = 34;
    doc.roundedRect(innerX, y, innerW, h, 6).fill("#fffbeb");
    doc.roundedRect(innerX, y, innerW, h, 6).lineWidth(0.6).strokeColor("#fde68a").stroke();
    drawText(doc, `ملاحظات: ${data.notes}`, innerX + 12, y + 10, innerW - 24, {
      size: 9.5,
      align: "right",
      color: "#92400e",
    });
    y += h + 14;
  }

  // ── Signature line ───────────────────────────────────────────────────────
  if (data.signatureLabel) {
    const lineY = y + 34;
    drawText(doc, data.signatureLabel, innerX, y + 6, innerW / 2 - 10, {
      size: 10,
      align: "right",
      color: COLOR_LABEL,
    });
    doc
      .moveTo(innerX + innerW / 2 + 10, lineY)
      .lineTo(innerX + innerW, lineY)
      .lineWidth(0.8)
      .strokeColor(COLOR_BORDER)
      .stroke();
    y = lineY + 16;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = doc.page.height - PAGE_MARGIN - 88 - 12;
  doc.moveTo(innerX, footerY).lineTo(right - 20, footerY).lineWidth(0.8).strokeColor(COLOR_BORDER).stroke();
  drawDeveloperCredit(doc, footerY + 36);
}

function fieldCard(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  fields: VoucherField[],
  columns: number,
): number {
  const rowH = 46;
  const rows = Math.ceil(fields.length / columns);
  const h = rows * rowH + 14;
  doc.roundedRect(x, y, width, h, 8).fill(COLOR_CARD_BG);
  doc.roundedRect(x, y, width, h, 8).lineWidth(0.6).strokeColor(COLOR_BORDER).stroke();

  const colW = (width - 24) / columns;
  fields.forEach((f, i) => {
    // RTL: first field on the right.
    const col = i % columns;
    const row = Math.floor(i / columns);
    const cx = x + 12 + (columns - 1 - col) * colW;
    const cy = y + 8 + row * rowH;
    drawText(doc, f.label, cx, cy, colW - 10, {
      size: 9,
      align: "right",
      color: COLOR_LABEL,
    });
    drawText(doc, toAsciiDigits(f.value), cx, cy + 17, colW - 10, {
      size: 11,
      align: "right",
      color: COLOR_VALUE,
      weight: "bold",
    });
  });
  return y + h + 16;
}

function formatAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}
