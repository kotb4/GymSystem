import { drawText, embedPdfFont, toAsciiDigits } from "./arabic";
import { drawDeveloperCredit } from "./credit";
import { formatMinor } from "@/core/money";
import PDFDocumentType from "pdfkit";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

export interface PayslipItem {
  label: string;
  amountMinor: number;
  type: "earning" | "deduction";
}

export interface PayslipData {
  gymName: string;
  slipNo: string;
  issuedAt: string;
  periodMonth: string; // YYYY-MM
  employeeName: string;
  roleTitle: string | null;
  department: string | null;
  phone: string | null;
  salaryType: string;
  baseAmountMinor: number;
  incentivesMinor: number;
  deductionsMinor: number;
  advancesMinor: number;
  unpaidLeaveImpactMinor: number;
  netAmountMinor: number;
  status: "pending" | "paid";
  paidAt: string | null;
  paymentMethod: string;
  notes: string | null;
  branchName: string | null;
}

const PAGE_MARGIN = 36;
const COLOR_PRIMARY = "#0055FF"; // Electric Cobalt Blue
const COLOR_PRIMARY_DARK = "#080B11"; // Obsidian Black
const COLOR_LABEL = "#475569"; // Slate 600
const COLOR_VALUE = "#0f172a"; // Slate 900
const COLOR_LIGHT_BORDER = "#cbd5e1"; // Slate 300
const COLOR_CARD_BG = "#f8fafc"; // Slate 50
const COLOR_SUCCESS = "#047857"; // Emerald 700
const COLOR_DANGER = "#b91c1c"; // Red 700

export async function renderPayslipPdf(data: PayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentType({
      size: "A4",
      margin: PAGE_MARGIN,
      info: {
        Title: `Payslip ${data.slipNo}`,
        Author: data.gymName,
        Subject: "Employee Payslip",
        Creator: "GymGate",
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

function paint(doc: PdfDoc, data: PayslipData): void {
  embedPdfFont(doc);
  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;
  const pageHeight = doc.page.height;

  // Outer Border Frame
  doc
    .roundedRect(left, PAGE_MARGIN, width, pageHeight - PAGE_MARGIN * 2, 10)
    .lineWidth(1)
    .strokeColor(COLOR_LIGHT_BORDER)
    .stroke();

  // Header Banner
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

  // Header Titles
  const headerRightW = width * 0.6 - 20;
  drawText(doc, data.gymName, left + width - headerRightW - 20, PAGE_MARGIN + 14, headerRightW, {
    size: 20,
    align: "right",
    color: "#ffffff",
    weight: "bold",
  });

  drawText(doc, "مفردات مرتب — إيصال استلام راتب", left + width - headerRightW - 20, PAGE_MARGIN + 44, headerRightW, {
    size: 11,
    align: "right",
    color: "#cbd5e1",
    weight: "regular",
  });

  // Header Left Badges
  const metaBadgeW = width * 0.35;
  const metaBadgeX = left + 20;
  drawText(doc, `رقم المستند: ${toAsciiDigits(data.slipNo)}`, metaBadgeX, PAGE_MARGIN + 16, metaBadgeW, {
    size: 9.5,
    align: "left",
    color: "#ffffff",
    weight: "bold",
  });

  drawText(doc, `عن شهر: ${toAsciiDigits(data.periodMonth)}`, metaBadgeX, PAGE_MARGIN + 36, metaBadgeW, {
    size: 10,
    align: "left",
    color: "#93c5fd",
    weight: "bold",
  });

  drawText(doc, `تاريخ الإصدار: ${toAsciiDigits(data.issuedAt.slice(0, 10))}`, metaBadgeX, PAGE_MARGIN + 54, metaBadgeW, {
    size: 8.5,
    align: "left",
    color: "#cbd5e1",
    weight: "regular",
  });

  // Employee Card
  const empCardY = PAGE_MARGIN + headerH + 14;
  const empCardH = 76;
  doc
    .roundedRect(left + 16, empCardY, width - 32, empCardH, 6)
    .fillAndStroke(COLOR_CARD_BG, COLOR_LIGHT_BORDER);

  const colW = (width - 48) / 3;

  function cardField(cIndex: number, rIndex: number, label: string, value: string) {
    const fX = left + 24 + (2 - cIndex) * colW;
    const fY = empCardY + 12 + rIndex * 30;
    drawText(doc, label, fX, fY, colW - 12, {
      size: 8,
      align: "right",
      color: COLOR_LABEL,
      weight: "regular",
    });
    drawText(doc, toAsciiDigits(value), fX, fY + 11, colW - 12, {
      size: 10,
      align: "right",
      color: COLOR_VALUE,
      weight: "bold",
    });
  }

  cardField(0, 0, "اسم الموظف", data.employeeName);
  cardField(1, 0, "المسمى الوظيفي", data.roleTitle || "موظف");
  cardField(2, 0, "القسم", data.department === "women" ? "سيدات" : data.department === "men" ? "رجال" : "عام");

  cardField(0, 1, "رقم الموبايل", data.phone || "—");
  cardField(1, 1, "طريقة الراتب", data.salaryType === "daily" ? "يومي" : "شهري");
  cardField(2, 1, "حالة الصرف", data.status === "paid" ? "تم الصرف" : "معلق (قيد الاعتماد)");

  // Breakdown Tables: المستحقات (Earnings) vs الاستقطاعات (Deductions)
  const tablesY = empCardY + empCardH + 18;
  const tableW = (width - 42) / 2;

  // Earnings Box (Right side in RTL)
  const earningsX = left + 16 + tableW + 10;
  doc.roundedRect(earningsX, tablesY, tableW, 175, 6).strokeColor(COLOR_LIGHT_BORDER).stroke();
  doc.rect(earningsX, tablesY, tableW, 26).fill("#ecfdf5");
  drawText(doc, "المستحقات والإضافات (+)", earningsX + 10, tablesY + 7, tableW - 20, {
    size: 10,
    align: "right",
    color: COLOR_SUCCESS,
    weight: "bold",
  });

  function rowInBox(boxX: number, curY: number, label: string, amountMinor: number, isDeduction: boolean) {
    drawText(doc, label, boxX + 10, curY, tableW - 110, {
      size: 9,
      align: "right",
      color: COLOR_LABEL,
      weight: "regular",
    });
    drawText(doc, `${formatMinor(amountMinor)} ج.م`, boxX + tableW - 110, curY, 100, {
      size: 9.5,
      align: "left",
      color: isDeduction ? COLOR_DANGER : COLOR_VALUE,
      weight: "bold",
    });
  }

  let curEY = tablesY + 36;
  rowInBox(earningsX, curEY, "الراتب الأساسي", data.baseAmountMinor, false);
  curEY += 28;
  rowInBox(earningsX, curEY, "المكافآت والحوافز", data.incentivesMinor, false);
  curEY += 28;
  rowInBox(earningsX, curEY, "إجمالي المستحقات", data.baseAmountMinor + data.incentivesMinor, false);

  // Deductions Box (Left side in RTL)
  const deductionsX = left + 16;
  doc.roundedRect(deductionsX, tablesY, tableW, 175, 6).strokeColor(COLOR_LIGHT_BORDER).stroke();
  doc.rect(deductionsX, tablesY, tableW, 26).fill("#fef2f2");
  drawText(doc, "الاستقطاعات والخصومات (-)", deductionsX + 10, tablesY + 7, tableW - 20, {
    size: 10,
    align: "right",
    color: COLOR_DANGER,
    weight: "bold",
  });

  let curDY = tablesY + 36;
  rowInBox(deductionsX, curDY, "خصومات وجزاءات", data.deductionsMinor, true);
  curDY += 26;
  rowInBox(deductionsX, curDY, "سلف وعهد مستردة", data.advancesMinor, true);
  curDY += 26;
  rowInBox(deductionsX, curDY, "خصم إجازات بدون راتب", data.unpaidLeaveImpactMinor, true);
  curDY += 26;
  rowInBox(deductionsX, curDY, "إجمالي الاستقطاعات", data.deductionsMinor + data.advancesMinor + data.unpaidLeaveImpactMinor, true);

  // Big Net Salary Card
  const netY = tablesY + 190;
  const netH = 68;
  doc
    .roundedRect(left + 16, netY, width - 32, netH, 8)
    .fillAndStroke("#f0fdf4", "#86efac");

  drawText(doc, "صافي الراتب المستحق للموظف", left + width - 300, netY + 16, 260, {
    size: 11,
    align: "right",
    color: "#166534",
    weight: "bold",
  });

  if (data.status === "paid") {
    drawText(doc, `تم الصرف بتاريخ: ${toAsciiDigits(data.paidAt ? data.paidAt.slice(0, 10) : data.issuedAt.slice(0, 10))}`, left + width - 300, netY + 38, 260, {
      size: 9,
      align: "right",
      color: "#15803d",
      weight: "regular",
    });
  } else {
    drawText(doc, "في انتظار اعتماد الصرف والتوقيع", left + width - 300, netY + 38, 260, {
      size: 9,
      align: "right",
      color: "#854d0e",
      weight: "regular",
    });
  }

  drawText(doc, `${formatMinor(data.netAmountMinor)} ج.م`, left + 36, netY + 18, 260, {
    size: 22,
    align: "left",
    color: "#15803d",
    weight: "bold",
  });

  // Signatures Section
  const signY = netY + netH + 40;
  const signColW = (width - 80) / 2;

  // Management Signature (Right)
  drawText(doc, "توقيع المحاسب / الإدارة", left + width - signColW - 30, signY, signColW, {
    size: 10,
    align: "center",
    color: COLOR_LABEL,
    weight: "bold",
  });
  doc
    .moveTo(left + width - signColW - 30, signY + 50)
    .lineTo(left + width - 30, signY + 50)
    .lineWidth(0.8)
    .dash(4, { space: 3 })
    .strokeColor("#94a3b8")
    .stroke();
  doc.undash();

  // Employee Receipt Signature (Left)
  drawText(doc, "توقيع الموظف بالاستلام", left + 30, signY, signColW, {
    size: 10,
    align: "center",
    color: COLOR_LABEL,
    weight: "bold",
  });
  doc
    .moveTo(left + 30, signY + 50)
    .lineTo(left + 30 + signColW, signY + 50)
    .lineWidth(0.8)
    .dash(4, { space: 3 })
    .strokeColor("#94a3b8")
    .stroke();
  doc.undash();

  drawText(
    doc,
    "أقر أنا الموقع أعلاه باستلامي كامل مستحقاتي وصافي راتبي المبين بعاليه دون أي تأخير أو خصومات غير واردة.",
    left + 30,
    signY + 62,
    width - 60,
    {
      size: 7.5,
      align: "center",
      color: "#94a3b8",
      weight: "regular",
    },
  );

  // Developer Credit Centered at the bottom
  drawDeveloperCredit(doc, pageHeight - PAGE_MARGIN - 20);
}
