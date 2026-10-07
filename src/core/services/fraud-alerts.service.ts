import { addDaysKey, todayKey } from "@/core/dates";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";

export type FraudAlertSeverity = "low" | "medium" | "high" | "critical";

export type FraudAlertType =
  | "unusual_void"
  | "high_discount"
  | "cash_discrepancy"
  | "excessive_refunds"
  | "expired_checkin_surge";

export interface FraudAlertItem {
  id: string;
  type: FraudAlertType;
  severity: FraudAlertSeverity;
  titleKey: string;
  description: string;
  timestamp: string;
  actorUserId?: string | null;
  actorName?: string | null;
  amountMinor?: number | null;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface FraudAlertsSummary {
  alerts: FraudAlertItem[];
  totalAlerts: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  scanWindowDays: number;
}

/**
 * Scan system activity (payments, refunds, discounts, cash sessions, attendance)
 * over the last N days (default 14 days) to detect anomalous or high-risk operational patterns.
 */
export function scanFraudAlerts(
  db: Db,
  actor: ServiceActor,
  daysToScan: number = 14,
): FraudAlertsSummary {
  requirePermission(actor, "audit.view");

  const windowDays = Math.max(1, Math.min(60, daysToScan));
  const today = todayKey();
  const sinceKey = addDaysKey(today, -windowDays);
  const sinceStamp = `${sinceKey}T00:00:00.000Z`;

  const alerts: FraudAlertItem[] = [];

  // 1. Unusual Voids (payments or sales voided)
  const voidedPayments = db.all<{
    id: string;
    paid_amount_minor: number;
    void_reason: string | null;
    voided_at: string;
    voided_by: string | null;
    user_name: string | null;
  }>(
    `SELECT p.id, p.paid_amount_minor, p.void_reason, p.voided_at, p.voided_by, u.full_name AS user_name
     FROM payments p
     LEFT JOIN users u ON u.id = p.voided_by
     WHERE p.status = 'voided' AND p.voided_at >= ?
     ORDER BY p.voided_at DESC LIMIT 50`,
    [sinceStamp],
  );

  for (const p of voidedPayments) {
    const isLarge = p.paid_amount_minor >= 50000; // >= 500 EGP
    alerts.push({
      id: `void-pay-${p.id}`,
      type: "unusual_void",
      severity: isLarge ? "high" : "medium",
      titleKey: "alerts.voidedPayment",
      description: `إلغاء دفعة مالية بقيمة ${(p.paid_amount_minor / 100).toFixed(2)} ج.م${p.void_reason ? ` (السبب: ${p.void_reason})` : ""}`,
      timestamp: p.voided_at,
      actorUserId: p.voided_by,
      actorName: p.user_name,
      amountMinor: p.paid_amount_minor,
      relatedEntityId: p.id,
    });
  }

  // 2. High Discounts applied on payments (e.g. discount >= 30% or >= 300 EGP)
  const highDiscounts = db.all<{
    id: string;
    paid_amount_minor: number;
    discount_amount_minor: number;
    created_at: string;
    created_by: string | null;
    user_name: string | null;
  }>(
    `SELECT p.id, p.paid_amount_minor, p.discount_amount_minor, p.created_at, p.created_by, u.full_name AS user_name
     FROM payments p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.status = 'paid' 
       AND p.discount_amount_minor > 0 
       AND (p.discount_amount_minor >= 30000 OR (p.discount_amount_minor * 100 / (p.paid_amount_minor + p.discount_amount_minor)) >= 30)
       AND p.created_at >= ?
     ORDER BY p.created_at DESC LIMIT 50`,
    [sinceStamp],
  );

  for (const d of highDiscounts) {
    const total = d.paid_amount_minor + d.discount_amount_minor;
    const pct = total > 0 ? Math.round((d.discount_amount_minor * 100) / total) : 0;
    const isCritical = pct >= 50 || d.discount_amount_minor >= 100000;
    alerts.push({
      id: `disc-pay-${d.id}`,
      type: "high_discount",
      severity: isCritical ? "high" : "medium",
      titleKey: "alerts.highDiscountApplied",
      description: `خصم يدوي استثنائي بنسبة ${pct}% بقيمة ${(d.discount_amount_minor / 100).toFixed(2)} ج.م على معاملة بقيمة ${(total / 100).toFixed(2)} ج.م`,
      timestamp: d.created_at,
      actorUserId: d.created_by,
      actorName: d.user_name,
      amountMinor: d.discount_amount_minor,
      relatedEntityId: d.id,
    });
  }

  // 3. Cash Session Discrepancies (عجز أو فائض غير متطابق في إغلاق الخزينة)
  const cashDiscrepancies = db.all<{
    id: string;
    expected_cash_minor: number;
    counted_cash_minor: number;
    difference_minor: number;
    closed_at: string;
    closed_by: string | null;
    user_name: string | null;
  }>(
    `SELECT c.id,
            c.expected_closing_minor AS expected_cash_minor,
            c.counted_closing_minor AS counted_cash_minor,
            c.difference_minor,
            c.closed_at,
            c.closed_by,
            u.full_name AS user_name
     FROM cash_sessions c
     LEFT JOIN users u ON u.id = c.closed_by
     WHERE c.status = 'closed'
       AND c.difference_minor != 0
       AND c.closed_at >= ?
     ORDER BY c.closed_at DESC LIMIT 50`,
    [sinceStamp],
  );

  for (const cd of cashDiscrepancies) {
    const absDiff = Math.abs(cd.difference_minor);
    const isShortage = cd.difference_minor < 0;
    const severity: FraudAlertSeverity = absDiff >= 20000 ? "critical" : absDiff >= 5000 ? "high" : "medium";
    alerts.push({
      id: `cash-diff-${cd.id}`,
      type: "cash_discrepancy",
      severity,
      titleKey: isShortage ? "alerts.cashShortage" : "alerts.cashSurplus",
      description: `فارق نقدي في الخزينة (${isShortage ? "عجز" : "زيادة"}) بقيمة ${(absDiff / 100).toFixed(2)} ج.م (المتوقع: ${(cd.expected_cash_minor / 100).toFixed(2)}، الفعلي: ${(cd.counted_cash_minor / 100).toFixed(2)})`,
      timestamp: cd.closed_at,
      actorUserId: cd.closed_by,
      actorName: cd.user_name,
      amountMinor: cd.difference_minor,
      relatedEntityId: cd.id,
    });
  }

  // 4. Repeated Refunds (استرداد أموال)
  const refunds = db.all<{
    id: string;
    amount_minor: number;
    reason: string | null;
    created_at: string;
    created_by: string | null;
    user_name: string | null;
  }>(
    `SELECT r.id, r.amount_minor, r.reason, r.created_at, r.created_by, u.full_name AS user_name
     FROM payment_refunds r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.created_at >= ?
     ORDER BY r.created_at DESC LIMIT 30`,
    [sinceStamp],
  );

  for (const ref of refunds) {
    alerts.push({
      id: `refund-${ref.id}`,
      type: "excessive_refunds",
      severity: ref.amount_minor >= 50000 ? "high" : "low",
      titleKey: "alerts.refundIssued",
      description: `استرداد مالي بقيمة ${(ref.amount_minor / 100).toFixed(2)} ج.م${ref.reason ? ` (السبب: ${ref.reason})` : ""}`,
      timestamp: ref.created_at,
      actorUserId: ref.created_by,
      actorName: ref.user_name,
      amountMinor: ref.amount_minor,
      relatedEntityId: ref.id,
    });
  }

  // Sort alerts newest first
  alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const highCount = alerts.filter((a) => a.severity === "high").length;
  const mediumCount = alerts.filter((a) => a.severity === "medium").length;
  const lowCount = alerts.filter((a) => a.severity === "low").length;

  return {
    alerts,
    totalAlerts: alerts.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    scanWindowDays: windowDays,
  };
}
