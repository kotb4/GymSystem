import { randomUUID, createHash } from "node:crypto";
import { nowStamp } from "@/core/dates";
import { errNotFound } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { renderOperationVoucherPdf, type OperationVoucherData } from "@/core/pdf/operation-voucher";
import { assignDocNo } from "./document-numbers.service";

export type VoucherKind = "refund" | "store_debt_payment" | "cash_closing" | "attendance" | "expense";

export interface GeneratedVoucher {
  fileName: string;
  base64: string;
  size: number;
  hash: string;
  docNo: string;
}

/**
 * Printable vouchers for the operations that do not have a bespoke receipt:
 * refunds, store-debt repayments, cash-box closings and attendance visits.
 *
 * They all render through one shared template, and each carries the operation's
 * reference number as the largest element on the page — that number is what the
 * customer keeps and what `searchByDocNo` resolves later.
 */
const PERMISSION_BY_KIND: Record<VoucherKind, Parameters<typeof requirePermission>[1]> = {
  refund: "pdf.receipt",
  store_debt_payment: "store.view",
  cash_closing: "cash.close",
  attendance: "reports.view",
  expense: "expenses.view",
};

const EM_DASH = "—";
const CURRENCY = "ج.م";

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} ${CURRENCY}`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function userName(db: Db, userId: string | null): string | null {
  if (!userId) return null;
  return db.first<{ full_name: string }>("SELECT full_name FROM users WHERE id = ?", [userId])?.full_name ?? null;
}

function branchName(db: Db): string | null {
  return db.first<{ branch_name: string }>("SELECT branch_name FROM branch_info LIMIT 1")?.branch_name ?? null;
}

function methodLabel(db: Db, code: string | null): string {
  if (!code) return EM_DASH;
  const row = db.first<{ label_ar: string }>("SELECT label_ar FROM payment_methods WHERE code = ?", [code]);
  return row?.label_ar ?? code;
}

export async function generateOperationVoucher(
  db: Db,
  actor: ServiceActor,
  kind: VoucherKind,
  rowId: string,
): Promise<GeneratedVoucher> {
  requirePermission(actor, PERMISSION_BY_KIND[kind]);

  const built = buildVoucherData(db, kind, rowId);
  const bytes = await renderOperationVoucherPdf(built.data);
  const hash = sha256(bytes);
  const fileName = `voucher-${built.data.docNo}.pdf`;

  // Archive alongside every other generated document so the delivery history and
  // the file hash stay in one place.
  db.run(
    "INSERT INTO pdf_deliveries (id, doc_type, ref_table, ref_id, member_id, member_name, phone, channel, status, error, file_name, file_size, file_hash, sent_at, created_by, created_at)\n" +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      `pdfd_${randomUUID()}`,
      `${kind}_voucher`,
      built.table,
      rowId,
      built.memberId,
      built.memberName,
      null,
      "download",
      "generated",
      null,
      fileName,
      bytes.length,
      hash,
      null,
      actor.userId,
      nowStamp(),
    ],
  );

  return { fileName, base64: bytes.toString("base64"), size: bytes.length, hash, docNo: built.data.docNo };
}

interface BuiltVoucher {
  data: OperationVoucherData;
  table: string;
  memberId: string | null;
  memberName: string | null;
}

function buildVoucherData(db: Db, kind: VoucherKind, rowId: string): BuiltVoucher {
  switch (kind) {
    case "refund":
      return buildRefund(db, rowId);
    case "store_debt_payment":
      return buildDebtPayment(db, rowId);
    case "cash_closing":
      return buildCashClosing(db, rowId);
    case "attendance":
      return buildAttendance(db, rowId);
    case "expense":
      return buildExpense(db, rowId);
  }
}

function buildRefund(db: Db, refundId: string): BuiltVoucher {
  const row = db.first<{
    id: string;
    amount_minor: number;
    reason: string | null;
    method_code: string;
    created_by: string;
    created_at: string;
    receipt_no: string | null;
    payment_id: string;
    paid_at: string;
    paid_amount_minor: number;
    member_id: string;
    member_code: string;
    full_name: string;
  }>(
    "SELECT r.id, r.payment_id, r.amount_minor, r.reason, r.method_code, r.created_by, r.created_at,\n" +
      "       p.receipt_no, p.paid_amount_minor, p.paid_at, p.member_id, m.member_code, m.full_name\n" +
      "  FROM payment_refunds r\n" +
      "  JOIN payments p ON p.id = r.payment_id\n" +
      "  JOIN members m ON m.id = p.member_id\n" +
      " WHERE r.id = ?",
    [refundId],
  );
  if (!row) throw errNotFound("errors.finance.paymentNotFound");

  const docNo = assignDocNo(db, "refund", row.id, row.created_at, row.created_by);
  // The receipt number is minted lazily when the payment receipt is first
  // printed. A refund voucher quotes it, so make sure it exists — the customer
  // can then reconcile both documents from the same search.
  const receiptNo = assignDocNo(db, "payment", row.payment_id, row.paid_at, row.created_by);
  return {
    table: "payment_refunds",
    memberId: row.member_id,
    memberName: row.full_name,
    data: {
      title: "إيصال استرجاع مبلغ",
      docNo,
      issuedAt: row.created_at,
      totalLabel: "المبلغ المسترجع",
      totalMinor: row.amount_minor,
      totalTone: "out",
      fields: [
        { label: "العضو", value: row.full_name },
        { label: "كود العضوية", value: row.member_code },
        { label: "رقم الإيصال الأصلي", value: receiptNo },
        { label: "طريقة الاسترجاع", value: methodLabel(db, row.method_code) },
        { label: "إجمالي المدفوع", value: money(row.paid_amount_minor) },
        { label: "الموظف", value: userName(db, row.created_by) ?? EM_DASH },
      ],
      signatureLabel: "توقيع المستلم",
      branchName: branchName(db),
      createdByName: userName(db, row.created_by),
      notes: row.reason,
    },
  };
}

function buildDebtPayment(db: Db, paymentId: string): BuiltVoucher {
  const row = db.first<{
    id: string;
    amount_minor: number;
    method_code: string;
    created_by: string;
    created_at: string;
    sale_no: string;
    member_id: string | null;
    member_code: string | null;
    full_name: string | null;
    debt_original_minor: number;
    debt_paid_minor: number;
  }>(
    "SELECT dp.id, dp.amount_minor, dp.method_code, dp.created_by, dp.created_at,\n" +
      "       s.sale_no, s.member_id, m.member_code, m.full_name,\n" +
      "       d.original_minor AS debt_original_minor, d.paid_minor AS debt_paid_minor\n" +
      "  FROM store_debt_payments dp\n" +
      "  JOIN store_debts d ON d.id = dp.debt_id\n" +
      "  JOIN store_sales s ON s.id = d.sale_id\n" +
      "  LEFT JOIN members m ON m.id = s.member_id\n" +
      " WHERE dp.id = ?",
    [paymentId],
  );
  if (!row) throw errNotFound("errors.store.saleNotFound");

  const docNo = assignDocNo(db, "store_debt_payment", row.id, row.created_at, row.created_by);
  const remaining = row.debt_original_minor - row.debt_paid_minor;
  return {
    table: "store_debt_payments",
    memberId: row.member_id,
    memberName: row.full_name,
    data: {
      title: "إيصال سداد دين",
      docNo,
      issuedAt: row.created_at,
      totalLabel: "المبلغ المسدَّد",
      totalMinor: row.amount_minor,
      totalTone: "in",
      fields: [
        { label: "العضو", value: row.full_name ?? EM_DASH },
        { label: "كود العضوية", value: row.member_code ?? EM_DASH },
        { label: "رقم فاتورة البيع", value: row.sale_no },
        { label: "طريقة السداد", value: methodLabel(db, row.method_code) },
        { label: "إجمالي الدين", value: money(row.debt_original_minor) },
        { label: "المتبقي بعد السداد", value: money(remaining) },
      ],
      signatureLabel: "توقيع السداد",
      branchName: branchName(db),
      createdByName: userName(db, row.created_by),
      notes: null,
    },
  };
}

function buildCashClosing(db: Db, sessionId: string): BuiltVoucher {
  const row = db.first<{
    id: string;
    box: string | null;
    opened_at: string;
    closed_at: string | null;
    opening_balance_minor: number;
    expected_closing_minor: number | null;
    counted_closing_minor: number | null;
    difference_minor: number | null;
    close_note: string | null;
    closed_by: string | null;
  }>("SELECT * FROM cash_sessions WHERE id = ?", [sessionId]);
  if (!row || !row.closed_at) throw errNotFound("errors.finance.paymentNotFound");

  const docNo = assignDocNo(db, "cash_closing", row.id, row.closed_at, row.closed_by);
  const diff = Number(row.difference_minor ?? 0);
  return {
    table: "cash_sessions",
    memberId: null,
    memberName: null,
    data: {
      title: "محضر إقفال الصندوق",
      docNo,
      issuedAt: row.closed_at,
      totalLabel: "المبلغ المحتسب فعليًا",
      totalMinor: Number(row.counted_closing_minor ?? 0),
      totalTone: diff === 0 ? "neutral" : "out",
      fields: [
        { label: "الصندوق", value: row.box === "store" ? "متجر" : "الجيم" },
        { label: "وقت الفتح", value: row.opened_at },
        { label: "رصيد افتتاحي", value: money(row.opening_balance_minor) },
        { label: "المتوقع عند الإقفال", value: money(Number(row.expected_closing_minor ?? 0)) },
        { label: "الفرق", value: money(diff) },
        { label: "أُغلق بواسطة", value: userName(db, row.closed_by) ?? EM_DASH },
      ],
      signatureLabel: "توقيع المسؤول",
      branchName: branchName(db),
      createdByName: userName(db, row.closed_by),
      notes: row.close_note,
    },
  };
}

function buildAttendance(db: Db, attendanceId: string): BuiltVoucher {
  const row = db.first<{
    id: string;
    member_id: string;
    member_code: string;
    full_name: string;
    checkin_at: string;
    checkout_at: string | null;
    device_identifier: string | null;
    notes: string | null;
    created_by: string;
    plan_name: string | null;
  }>(
    "SELECT a.id, a.member_id, m.member_code, m.full_name, a.checkin_at, a.checkout_at,\n" +
      "       a.device_identifier, a.notes, a.created_by, p.name AS plan_name\n" +
      "  FROM attendance a\n" +
      "  JOIN members m ON m.id = a.member_id\n" +
      "  LEFT JOIN member_subscriptions s ON s.id = a.subscription_id\n" +
      "  LEFT JOIN membership_plans p ON p.id = s.plan_id\n" +
      " WHERE a.id = ?",
    [attendanceId],
  );
  if (!row) throw errNotFound("errors.memberNotFound");

  const docNo = assignDocNo(db, "attendance", row.id, row.checkin_at, row.created_by);
  return {
    table: "attendance",
    memberId: row.member_id,
    memberName: row.full_name,
    data: {
      title: "إيصال حضور",
      docNo,
      issuedAt: row.checkin_at,
      totalLabel: null,
      totalMinor: null,
      totalTone: "neutral",
      fields: [
        { label: "العضو", value: row.full_name },
        { label: "كود العضوية", value: row.member_code },
        { label: "وقت الحضور", value: row.checkin_at },
        { label: "وقت الانصراف", value: row.checkout_at ?? EM_DASH },
        { label: "الباقة", value: row.plan_name ?? EM_DASH },
        { label: "الجهاز", value: row.device_identifier ?? EM_DASH },
      ],
      signatureLabel: "توقيع العضو",
      branchName: branchName(db),
      createdByName: userName(db, row.created_by),
      notes: row.notes,
    },
  };
}

function buildExpense(db: Db, expenseId: string): BuiltVoucher {
  const row = db.first<{
    id: string;
    category_id: string;
    category_name: string | null;
    amount_minor: number;
    method_code: string;
    description: string;
    expense_date: string;
    reference_no: string | null;
    created_by: string;
    created_at: string;
    status: string;
  }>(
    "SELECT e.id, e.category_id, c.name_ar AS category_name, e.amount_minor, e.method_code, e.description, e.expense_date, e.reference_no, e.created_by, e.created_at, e.status\n" +
      "  FROM expenses e\n" +
      "  LEFT JOIN expense_categories c ON c.id = e.category_id\n" +
      " WHERE e.id = ?",
    [expenseId],
  );
  if (!row) throw errNotFound("errors.finance.categoryNotFound");

  const docNo = row.reference_no || assignDocNo(db, "expense", row.id, row.created_at, row.created_by);
  return {
    table: "expenses",
    memberId: null,
    memberName: null,
    data: {
      title: "سند صرف نقدية / مصروف",
      docNo,
      issuedAt: row.created_at,
      totalLabel: "المبلغ المصروف",
      totalMinor: row.amount_minor,
      totalTone: "out",
      fields: [
        { label: "بند المصروف", value: row.category_name ?? "مصروفات عامة" },
        { label: "البيان / الوصف", value: row.description },
        { label: "تاريخ المصروف", value: row.expense_date },
        { label: "طريقة الصرف", value: methodLabel(db, row.method_code) },
        { label: "المسؤول عن الصرف", value: userName(db, row.created_by) ?? EM_DASH },
      ],
      signatureLabel: "توقيع المستلم / المحاسب",
      branchName: branchName(db),
      createdByName: userName(db, row.created_by),
      notes: row.status === "voided" ? "⚠️ هذا السند ملغي ومستبعد من الحسابات (Voided)" : null,
    },
  };
}

