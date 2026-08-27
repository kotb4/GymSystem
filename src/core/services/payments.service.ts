import { isValidDateKey, nowStamp, todayKey } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import {
  assertNonNegativeInteger,
  computeDiscount,
  computePaymentSplit,
  type DiscountKind,
} from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";
import {
  assertDepartmentAccess,
  departmentScopeCondition,
  memberDepartmentById,
} from "./department";

export type PaymentStatus = "partial" | "paid" | "voided" | "refunded";

export interface PaymentRow extends Row {
  id: string;
  member_id: string;
  subscription_id: string | null;
  base_amount_minor: number;
  discount_kind: DiscountKind;
  discount_input: number;
  discount_amount_minor: number;
  net_amount_minor: number;
  paid_amount_minor: number;
  refunded_amount_minor: number;
  remaining_amount_minor: number;
  method_code: string;
  status: PaymentStatus;
  reference_no: string | null;
  notes: string | null;
  paid_at: string;
  created_by: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment extends Row {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  subscriptionId: string | null;
  planName: string | null;
  baseAmountMinor: number;
  discountKind: DiscountKind;
  discountInput: number;
  discountAmountMinor: number;
  netAmountMinor: number;
  paidAmountMinor: number;
  refundedAmountMinor: number;
  remainingAmountMinor: number;
  methodCode: string;
methodLabel: string;
status: PaymentStatus;
/** 1 when the linked subscription is cancelled (history row, not revenue). */
subCancelled: 0 | 1;
referenceNo: string | null;
  notes: string | null;
  paidAt: string;
  createdBy: string;
  createdByName: string;
  voidedAt: string | null;
  voidReason: string | null;
  refundReason: string | null;
}

export interface RecordPaymentInput {
  memberId: string;
  subscriptionId?: string | null;
  baseAmountMinor: number;
  discountKind?: DiscountKind;
  discountValue?: number;
  paidAmountMinor: number;
  methodCode: string;
  referenceNo?: string | null;
  notes?: string | null;
  clientRef?: string | null;
  paidAt?: string;
}

export interface SubscriptionBalance {
  subscriptionId: string;
  priceMinor: number;
  paidMinor: number;
  discountedMinor: number;
  remainingMinor: number;
}

function mapRow(row: PaymentRow & Record<string, unknown>): Payment {
  return {
    ...row,
    memberId: row.member_id,
    memberCode: String(row.member_code ?? ""),
    memberName: String(row.full_name ?? ""),
    subscriptionId: row.subscription_id,
    planName: row.plan_name == null ? null : String(row.plan_name),
    baseAmountMinor: Number(row.base_amount_minor),
    discountKind: row.discount_kind as DiscountKind,
    discountInput: Number(row.discount_input),
    discountAmountMinor: Number(row.discount_amount_minor),
    netAmountMinor: Number(row.net_amount_minor),
    paidAmountMinor: Number(row.paid_amount_minor),
    refundedAmountMinor: Number(row.refunded_amount_minor),
    remainingAmountMinor: Number(row.remaining_amount_minor),
    methodCode: row.method_code,
    methodLabel: String(row.method_label ?? row.method_code),
    status: row.status as PaymentStatus,
    referenceNo: row.reference_no,
    notes: row.notes,
    paidAt: row.paid_at,
    createdBy: row.created_by,
    createdByName: String(row.creator_name ?? ""),
    subCancelled: Number(row.sub_cancelled) === 1 ? 1 : 0,
    voidedAt: row.voided_at == null ? null : String(row.voided_at),
    voidReason: row.void_reason == null ? null : String(row.void_reason),
    refundReason: row.refund_reason == null ? null : String(row.refund_reason),
  };
}

    const PAYMENT_SELECT = `SELECT p.*, m.member_code AS member_code, m.full_name AS full_name,\n  pm.label_ar AS method_label, u.full_name AS creator_name, pl.name AS plan_name,\n  EXISTS(SELECT 1 FROM member_subscriptions cs WHERE cs.id = p.subscription_id AND cs.status = 'cancelled') AS sub_cancelled,\n  (SELECT pr.reason FROM payment_refunds pr WHERE pr.payment_id = p.id ORDER BY pr.created_at DESC LIMIT 1) AS refund_reason\nFROM payments p\nJOIN members m ON m.id = p.member_id\nJOIN payment_methods pm ON pm.code = p.method_code\nJOIN users u ON u.id = p.created_by\nLEFT JOIN member_subscriptions s ON s.id = p.subscription_id\nLEFT JOIN membership_plans pl ON pl.id = s.plan_id`;

function getPaymentRow(db: Db, paymentId: string): (PaymentRow & Record<string, unknown>) | null {
  return db.first<PaymentRow & Record<string, unknown>>(`${PAYMENT_SELECT}\nWHERE p.id = ?`, [
    paymentId,
  ]);
}

export function getPaymentById(db: Db, actor: ServiceActor, paymentId: string): Payment {
  requirePermission(actor, "payments.view");
  const row = getPaymentRow(db, paymentId);
  if (!row) throw errNotFound("errors.finance.paymentNotFound");
  return mapRow(row);
}

function resolveMethod(db: Db, methodCode: string): { code: string; is_active: number } {
  const method = db.first<{ code: string; is_active: number }>(
    "SELECT code, is_active FROM payment_methods WHERE code = ?",
    [methodCode],
  );
  if (!method) throw errNotFound("errors.finance.methodNotFound");
  if (Number(method.is_active) !== 1) throw errValidation("errors.finance.methodInactive");
  return method;
}

export async function recordPayment(
  db: Db,
  actor: ServiceActor,
  input: RecordPaymentInput,
): Promise<Payment> {
  requirePermission(actor, "payments.create");

  const member = getMemberRowById(db, input.memberId);
  if (!member) throw errNotFound("errors.memberNotFound");
  if (member.status === "archived") throw errConflict("errors.memberArchived");
  assertDepartmentAccess(actor, member.department);

  let subscriptionId: string | null = null;
  if (input.subscriptionId) {
    const sub = db.first<{ id: string; member_id: string; price: number; status: string }>(
      "SELECT id, member_id, price, status FROM member_subscriptions WHERE id = ?",
      [input.subscriptionId],
    );
    if (!sub) throw errNotFound("errors.finance.subscriptionNotFoundForPayment");
    if (sub.member_id !== input.memberId) {
      throw errValidation("errors.finance.subscriptionOwnerMismatch");
    }
    if (sub.status === "cancelled") throw errValidation("errors.subscriptionCancelled");
    subscriptionId = sub.id;
    const subBalance = getSubscriptionBalanceInternal(db, subscriptionId);
    if (subBalance.remainingMinor === 0) {
      throw errValidation("errors.finance.subscriptionFullyPaid");
    }
  }

  const kind: DiscountKind = input.discountKind ?? "none";
  if (kind !== "none") requirePermission(actor, "payments.discount");
  const baseMinor = Math.round(input.baseAmountMinor);
  assertNonNegativeInteger(baseMinor, "errors.finance.invalidAmount");
  const discount = computeDiscount(baseMinor, kind, input.discountValue ?? 0);

  const paidMinor = Math.round(input.paidAmountMinor);
  const split = computePaymentSplit(discount.netMinor, paidMinor);
  if (split.netMinor === 0 && split.paidMinor === 0) {
    throw errValidation("errors.finance.zeroPayment");
  }

  resolveMethod(db, input.methodCode);

  const paidAt = input.paidAt?.trim() || nowStamp();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(paidAt) || !isValidDateKey(paidAt.slice(0, 10))) {
    throw errValidation("errors.invalidDate");
  }
  if (paidAt.slice(0, 10) > todayKey()) throw errValidation("errors.finance.futureDate");

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const status: PaymentStatus = split.remainingMinor === 0 ? "paid" : "partial";

  try {
    await db.transaction(async () => {
      db.run(
        "INSERT INTO payments (id, member_id, subscription_id, base_amount_minor, discount_kind, discount_input, discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, method_code, status, reference_no, notes, client_ref, paid_at, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          input.memberId,
          subscriptionId,
          baseMinor,
          discount.kind,
          discount.inputValue,
          discount.discountMinor,
          discount.netMinor,
          split.paidMinor,
          split.remainingMinor,
          input.methodCode,
          status,
          input.referenceNo?.trim() || null,
          input.notes?.trim() || null,
          input.clientRef?.trim() || null,
          paidAt,
          actor.userId,
          stamp,
          stamp,
        ],
      );
      insertLedgerEntry(db, {
        entryType: "payment",
        refTable: "payments",
        refId: id,
        memberId: input.memberId,
        methodCode: input.methodCode,
        direction: 1,
        amountMinor: split.paidMinor,
        occurredAt: paidAt,
        actor,
      });
      recordAudit(db, actor, "PAYMENT_RECORDED", "payment", id, {
        memberCode: member.member_code,
        netMinor: split.netMinor,
        paidMinor: split.paidMinor,
        remainingMinor: split.remainingMinor,
        method: input.methodCode,
        subscriptionId,
      });
      if (discount.discountMinor > 0) {
        recordAudit(db, actor, "PAYMENT_DISCOUNT_APPLIED", "payment", id, {
          kind: discount.kind,
          inputValue: discount.inputValue,
          discountMinor: discount.discountMinor,
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw errConflict("errors.finance.duplicateTransaction");
    throw error;
  }

  return getPaymentById(db, actor, id);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("UNIQUE constraint failed") ||
      error.message.includes("SQLITE_CONSTRAINT_UNIQUE"))
  );
}

interface LedgerInput {
  entryType: "payment" | "refund" | "reversal_payment" | "reversal_expense" | "expense";
  refTable: string;
  refId: string;
  memberId: string | null;
  methodCode: string;
  direction: 1 | -1;
  amountMinor: number;
  occurredAt: string;
  actor: ServiceActor;
  /** Cash drawer this movement belongs to; defaults to the gym box. */
  box?: "gym" | "store";
}

export function insertLedgerEntry(db: Db, input: LedgerInput): number {
  if (input.amountMinor <= 0) return 0;
  return db.insert(
    "INSERT INTO financial_ledger (entry_type, ref_table, ref_id, member_id, method_code, direction, amount_minor, occurred_at, created_by, created_at, box)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      input.entryType,
      input.refTable,
      input.refId,
      input.memberId,
      input.methodCode,
      input.direction,
      input.amountMinor,
      input.occurredAt,
      input.actor.userId,
      nowStamp(),
      input.box ?? "gym",
    ],
  );
}

export async function refundPayment(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
  amountMinor: number,
  reason: string,
  methodCode?: string,
): Promise<Payment> {
  requirePermission(actor, "payments.refund");
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) throw errValidation("errors.finance.refundReasonRequired");

  const row = getPaymentRow(db, paymentId);
  if (!row) throw errNotFound("errors.finance.paymentNotFound");
  if (row.status === "voided") throw errConflict("errors.finance.paymentVoided");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));

  const paidMinorRow = Number(row.paid_amount_minor);
  const refundedSoFar = Number(row.refunded_amount_minor);
  const refundable = paidMinorRow - refundedSoFar;
  const refundMinor = Math.round(amountMinor);
  if (!Number.isFinite(refundMinor) || refundMinor <= 0) {
    throw errValidation("errors.finance.invalidRefundAmount");
  }
  if (refundMinor > refundable) {
    throw errValidation("errors.finance.refundExceedsPaid", {
      refundable: (refundable / 100).toFixed(2),
    });
  }

  const method = methodCode ?? row.method_code;
  resolveMethod(db, method);

  const refundId = crypto.randomUUID();
  const stamp = nowStamp();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO payment_refunds (id, payment_id, amount_minor, reason, method_code, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?)",
      [refundId, paymentId, refundMinor, trimmedReason, method, actor.userId, stamp],
    );
    const newRefunded = refundedSoFar + refundMinor;
    const nextStatus: PaymentStatus = newRefunded >= paidMinorRow ? "refunded" : (row.status as PaymentStatus);
    db.run("UPDATE payments SET refunded_amount_minor = ?, status = ?, updated_at = ? WHERE id = ?", [
      newRefunded,
      nextStatus,
      stamp,
      paymentId,
    ]);
    insertLedgerEntry(db, {
      entryType: "refund",
      refTable: "payment_refunds",
      refId: refundId,
      memberId: row.member_id,
      methodCode: method,
      direction: -1,
      amountMinor: refundMinor,
      occurredAt: stamp,
      actor,
    });
    recordAudit(db, actor, "REFUND_CREATED", "payment_refund", refundId, {
      paymentId,
      memberCode: row.member_code,
      amountMinor: refundMinor,
      reason: trimmedReason,
    });
  });

  return getPaymentById(db, actor, paymentId);
}

export async function voidPayment(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
  reason: string,
): Promise<Payment> {
  requirePermission(actor, "payments.void");
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) throw errValidation("errors.finance.voidReasonRequired");

  const row = db.first<PaymentRow>("SELECT * FROM payments WHERE id = ?", [paymentId]);
  if (!row) throw errNotFound("errors.finance.paymentNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));
  if (row.status === "voided") throw errConflict("errors.finance.alreadyVoided");
  if (Number(row.refunded_amount_minor) > 0) {
    throw errConflict("errors.finance.voidWithRefunds");
  }

  const stamp = nowStamp();
  await db.transaction(async () => {
    db.run(
      "UPDATE payments SET status = 'voided', voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?",
      [actor.userId, stamp, trimmedReason, stamp, paymentId],
    );
    if (Number(row.paid_amount_minor) > 0) {
      const alreadyReversed =
        db.count(
          "SELECT COUNT(*) FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ? AND entry_type = 'reversal_payment'",
          [paymentId],
        ) > 0;
      if (!alreadyReversed) {
        insertLedgerEntry(db, {
          entryType: "reversal_payment",
          refTable: "payments",
          refId: paymentId,
          memberId: row.member_id,
          methodCode: row.method_code,
          direction: -1,
          amountMinor: Number(row.paid_amount_minor),
          occurredAt: stamp,
          actor,
        });
      }
    }
    recordAudit(db, actor, "PAYMENT_VOIDED", "payment", paymentId, {
      reason: trimmedReason,
      paidMinor: Number(row.paid_amount_minor),
    });
  });

  return getPaymentById(db, actor, paymentId);
}

export async function unvoidPayment(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
): Promise<Payment> {
  requirePermission(actor, "payments.void");
  const row = db.first<PaymentRow>("SELECT * FROM payments WHERE id = ?", [paymentId]);
  if (!row) throw errNotFound("errors.finance.paymentNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));
  if (row.status !== "voided") throw errConflict("errors.finance.notVoided");

  const stamp = nowStamp();
  await db.transaction(async () => {
    const originalStatus = Number(row.paid_amount_minor) >= Number(row.net_amount_minor) ? "paid" : "partial";
    db.run(
      "UPDATE payments SET status = ?, voided_by = NULL, voided_at = NULL, void_reason = NULL, updated_at = ? WHERE id = ?",
      [originalStatus, stamp, paymentId],
    );
    db.run(
      "DELETE FROM financial_ledger WHERE ref_table = 'payments' AND ref_id = ? AND entry_type = 'reversal_payment'",
      [paymentId],
    );
    recordAudit(db, actor, "PAYMENT_RESTORED", "payment", paymentId, {
      paidMinor: Number(row.paid_amount_minor),
    });
  });

  return getPaymentById(db, actor, paymentId);
}

export async function undoRefund(
  db: Db,
  actor: ServiceActor,
  paymentId: string,
): Promise<Payment> {
  requirePermission(actor, "payments.refund");

  const row = getPaymentRow(db, paymentId);
  if (!row) throw errNotFound("errors.finance.paymentNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, String(row.member_id)));

  const refund = db.first<{ id: string; amount_minor: number }>(
    "SELECT id, amount_minor FROM payment_refunds WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1",
    [paymentId],
  );
  if (!refund) throw errNotFound("errors.finance.refundNotFound");

  const stamp = nowStamp();
  await db.transaction(async () => {
    const newRefunded = Number(row.refunded_amount_minor) - Number(refund.amount_minor);
    const nextStatus: PaymentStatus = newRefunded <= 0
      ? (Number(row.paid_amount_minor) >= Number(row.net_amount_minor) ? "paid" : "partial")
      : (row.status as PaymentStatus);
    db.run("UPDATE payments SET refunded_amount_minor = ?, status = ?, updated_at = ? WHERE id = ?", [
      Math.max(0, newRefunded),
      nextStatus,
      stamp,
      paymentId,
    ]);
    db.run("DELETE FROM payment_refunds WHERE id = ?", [refund.id]);
    db.run(
      "DELETE FROM financial_ledger WHERE ref_table = 'payment_refunds' AND ref_id = ? AND entry_type = 'refund'",
      [refund.id],
    );
    recordAudit(db, actor, "REFUND_UNDONE", "payment", paymentId, {
      refundId: refund.id,
      amountMinor: Number(refund.amount_minor),
    });
  });

  return getPaymentById(db, actor, paymentId);
}

export function getSubscriptionBalance(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): SubscriptionBalance {
  requirePermission(actor, "payments.view");
  return getSubscriptionBalanceInternal(db, subscriptionId);
}

function getSubscriptionBalanceInternal(db: Db, subscriptionId: string): SubscriptionBalance {
  const sub = db.first<{ price: number }>(
    "SELECT price FROM member_subscriptions WHERE id = ?",
    [subscriptionId],
  );
  if (!sub) throw errNotFound("errors.finance.subscriptionNotFoundForPayment");
  const agg = db.first<{ paid: number; discounted: number }>(
    "SELECT COALESCE(SUM(paid_amount_minor), 0) AS paid, COALESCE(SUM(discount_amount_minor), 0) AS discounted FROM payments WHERE subscription_id = ? AND status IN ('partial','paid')",
    [subscriptionId],
  );
  const priceMinor = Math.round(Number(sub.price) * 100);
  const paidMinor = Number(agg?.paid ?? 0);
  const discountedMinor = Number(agg?.discounted ?? 0);
  return {
    subscriptionId,
    priceMinor,
    paidMinor,
    discountedMinor,
    remainingMinor: Math.max(0, priceMinor - paidMinor - discountedMinor),
  };
}

export interface PaymentListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  fromKey?: string;
  toKey?: string;
  status?: PaymentStatus | "all";
  methodCode?: string;
  createdBy?: string;
  subscriptionId?: string | null;
  minAmountMinor?: number;
  maxAmountMinor?: number;
}

export function listPayments(
  db: Db,
  actor: ServiceActor,
  query: PaymentListQuery = {},
): { items: Payment[]; total: number } {
  requirePermission(actor, "payments.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));

  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (query.search?.trim()) {
    conditions.push("(m.full_name LIKE ? OR m.member_code LIKE ? OR m.phone LIKE ? OR p.reference_no LIKE ?)");
    const like = `%${query.search.trim()}%`;
    params.push(like, like, like, like);
  }
  if (query.fromKey) {
    conditions.push("p.paid_at >= ?");
    params.push(query.fromKey);
  }
  if (query.toKey) {
    conditions.push("p.paid_at < ?");
    params.push(addOneDay(query.toKey));
  }
  if (query.status && query.status !== "all") {
    conditions.push("p.status = ?");
    params.push(query.status);
  }
  if (query.methodCode && query.methodCode !== "all") {
    conditions.push("p.method_code = ?");
    params.push(query.methodCode);
  }
  if (query.createdBy && query.createdBy !== "all") {
    conditions.push("p.created_by = ?");
    params.push(query.createdBy);
  }
  if (query.subscriptionId) {
    conditions.push("p.subscription_id = ?");
    params.push(query.subscriptionId);
  }
  if (query.minAmountMinor !== undefined) {
    conditions.push("p.net_amount_minor >= ?");
    params.push(Math.round(query.minAmountMinor));
  }
  if (query.maxAmountMinor !== undefined) {
    conditions.push("p.net_amount_minor <= ?");
    params.push(Math.round(query.maxAmountMinor));
  }

  const scope = departmentScopeCondition(actor, "m");
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ""));
    params.push(...scope.params);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM payments p JOIN members m ON m.id = p.member_id ${where}`, params);
  const rows = db.all<PaymentRow & Record<string, unknown>>(
    `${PAYMENT_SELECT}\n${where}\nORDER BY p.paid_at DESC, p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapRow), total };
}

function addOneDay(key: string): string {
  if (!isValidDateKey(key)) return key;
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function listActiveMethods(db: Db): Array<{ code: string; labelAr: string }> {
  return db
    .all<{ code: string; label_ar: string }>(
      "SELECT code, label_ar FROM payment_methods WHERE is_active = 1 ORDER BY sort_order",
    )
    .map((r) => ({ code: r.code, labelAr: r.label_ar }));
}
