import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, departmentScopeCondition } from "./department";
import { getLocalBranchId } from "@/core/branch";
import { insertLedgerEntry } from "./payments.service";
import { assignDocNo } from "./document-numbers.service";

export interface UnifiedDebtItem extends Row {
  debtId: string;
  debtType: "subscription" | "store" | "private_training";
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  memberCode: string;
  title: string;
  totalAmountMinor: number;
  paidAmountMinor: number;
  remainingAmountMinor: number;
  createdAt: string;
  status: "pending" | "partial";
}

export function listMemberDebts(
  db: Db,
  actor: ServiceActor,
  filter?: {
    debtType?: "all" | "subscription" | "store" | "private_training";
    status?: "all" | "pending" | "partial";
    search?: string;
    limit?: number;
    offset?: number;
  },
): { items: UnifiedDebtItem[]; total: number; totalRemainingMinor: number; totalDebtMinor: number } {
  requirePermission(actor, "debts.view");

  const items: UnifiedDebtItem[] = [];
  const scope = departmentScopeCondition(actor, "m");

  // 1. Subscription debts (aggregated per subscription)
  if (!filter?.debtType || filter.debtType === "all" || filter.debtType === "subscription") {
    const subDebts = db.all<{
      subscription_id: string;
      member_id: string;
      member_name: string;
      member_phone: string | null;
      member_code: string;
      plan_name: string;
      price_minor: number;
      paid_minor: number;
      discount_minor: number;
      remaining_minor: number;
      created_at: string;
    }>(
      `WITH sub_paid AS (
        SELECT 
          subscription_id,
          COALESCE(SUM(paid_amount_minor - refunded_amount_minor), 0) AS total_paid_minor,
          COALESCE(SUM(discount_amount_minor), 0) AS total_discount_minor
        FROM payments
        WHERE status IN ('partial', 'paid') AND subscription_id IS NOT NULL
        GROUP BY subscription_id
      )
      SELECT 
        s.id AS subscription_id,
        s.member_id,
        m.full_name AS member_name, 
        m.phone AS member_phone,
        m.member_code,
        COALESCE(mp.name, 'اشتراك') AS plan_name,
        CAST(ROUND(s.price * 100) AS INTEGER) AS price_minor,
        COALESCE(sp.total_paid_minor, 0) AS paid_minor,
        COALESCE(sp.total_discount_minor, 0) AS discount_minor,
        (CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(sp.total_paid_minor, 0) - COALESCE(sp.total_discount_minor, 0)) AS remaining_minor,
        s.created_at
      FROM member_subscriptions s
      JOIN members m ON s.member_id = m.id
      LEFT JOIN membership_plans mp ON s.plan_id = mp.id
      LEFT JOIN sub_paid sp ON sp.subscription_id = s.id
      WHERE s.status != 'cancelled'
        AND m.deleted_at IS NULL
        AND (CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(sp.total_paid_minor, 0) - COALESCE(sp.total_discount_minor, 0)) > 0
        ${scope.sql}
      ORDER BY s.created_at DESC`,
      scope.params,
    );

    for (const d of subDebts) {
      const isPartial = d.paid_minor > 0;
      items.push({
        debtId: d.subscription_id,
        debtType: "subscription",
        memberId: d.member_id,
        memberName: d.member_name,
        memberPhone: d.member_phone,
        memberCode: d.member_code,
        title: `اشتراك: ${d.plan_name}`,
        totalAmountMinor: Math.max(0, d.price_minor - d.discount_minor),
        paidAmountMinor: d.paid_minor,
        remainingAmountMinor: d.remaining_minor,
        createdAt: d.created_at,
        status: isPartial ? "partial" : "pending",
      });
    }
  }

  // 2. Store credit debts
  if (!filter?.debtType || filter.debtType === "all" || filter.debtType === "store") {
    const tableExists = db.count(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'store_debts'",
    ) > 0;

    if (tableExists) {
      const storeDebts = db.all<{
        debt_id: string;
        member_id: string;
        member_name: string;
        member_phone: string | null;
        member_code: string;
        sale_no: string;
        original_minor: number;
        paid_minor: number;
        created_at: string;
      }>(
        `SELECT d.id AS debt_id, d.member_id, m.full_name AS member_name,
                m.phone AS member_phone, m.member_code,
                COALESCE(s.sale_no, 'فاتورة متجر') AS sale_no,
                d.original_minor,
                d.paid_minor,
                d.created_at
         FROM store_debts d
         JOIN members m ON d.member_id = m.id
         LEFT JOIN store_sales s ON d.sale_id = s.id
         WHERE (d.original_minor - d.paid_minor) > 0
           AND d.status = 'open'
           AND m.deleted_at IS NULL
           ${scope.sql}
         ORDER BY d.created_at DESC`,
        scope.params,
      );

      for (const d of storeDebts) {
        const remainingMinor = d.original_minor - d.paid_minor;
        const isPartial = d.paid_minor > 0;
        items.push({
          debtId: d.debt_id,
          debtType: "store",
          memberId: d.member_id,
          memberName: d.member_name,
          memberPhone: d.member_phone,
          memberCode: d.member_code,
          title: `متجر: فاتورة ${d.sale_no}`,
          totalAmountMinor: d.original_minor,
          paidAmountMinor: d.paid_minor,
          remainingAmountMinor: remainingMinor,
          createdAt: d.created_at,
          status: isPartial ? "partial" : "pending",
        });
      }
    }
  }

  // 3. Private training debts
  if (!filter?.debtType || filter.debtType === "all" || filter.debtType === "private_training") {
    const ptExists = db.count(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'private_trainings'",
    ) > 0;

    if (ptExists) {
      const ptDebts = db.all<{
        pt_id: string;
        member_id: string;
        member_name: string;
        member_phone: string | null;
        member_code: string;
        trainer_name: string;
        price_minor: number;
        paid_minor: number;
        remaining_minor: number;
        created_at: string;
      }>(
        `SELECT pt.id AS pt_id, pt.member_id, m.full_name AS member_name,
                m.phone AS member_phone, m.member_code,
                t.full_name AS trainer_name,
                pt.price_minor,
                pt.paid_amount_minor AS paid_minor,
                pt.remaining_amount_minor AS remaining_minor,
                pt.created_at
         FROM private_trainings pt
         JOIN members m ON pt.member_id = m.id
         LEFT JOIN trainers t ON pt.trainer_id = t.id
         WHERE pt.remaining_amount_minor > 0
           AND pt.status != 'cancelled'
           AND m.deleted_at IS NULL
           ${scope.sql}
         ORDER BY pt.created_at DESC`,
        scope.params,
      );

      for (const d of ptDebts) {
        const isPartial = d.paid_minor > 0;
        items.push({
          debtId: d.pt_id,
          debtType: "private_training",
          memberId: d.member_id,
          memberName: d.member_name,
          memberPhone: d.member_phone,
          memberCode: d.member_code,
          title: `برايفت: مع كابتن ${d.trainer_name || 'المدرب'}`,
          totalAmountMinor: d.price_minor,
          paidAmountMinor: d.paid_minor,
          remainingAmountMinor: d.remaining_minor,
          createdAt: d.created_at,
          status: isPartial ? "partial" : "pending",
        });
      }
    }
  }

  // Filter in memory by status and search
  let filtered = items;
  if (filter?.status && filter.status !== "all") {
    filtered = filtered.filter((i) => i.status === filter.status);
  }
  if (filter?.search && filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    filtered = filtered.filter(
      (i) =>
        i.memberName.toLowerCase().includes(q) ||
        i.memberCode.toLowerCase().includes(q) ||
        (i.memberPhone && i.memberPhone.includes(q)) ||
        i.title.toLowerCase().includes(q),
    );
  }

  // Sort newest first
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totalRemainingMinor = filtered.reduce((acc, cur) => acc + cur.remainingAmountMinor, 0);
  const total = filtered.length;
  const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);
  const offset = Math.max(filter?.offset || 0, 0);
  const paginated = filtered.slice(offset, offset + limit);

  return { items: paginated, total, totalRemainingMinor, totalDebtMinor: totalRemainingMinor };
}

export function payMemberDebt(
  db: Db,
  actor: ServiceActor,
  input: {
    debtType: "subscription" | "store" | "private_training";
    debtId: string;
    amountMinor: number;
    methodCode: string;
    notes?: string;
  },
): { success: boolean; paidMinor: number; remainingMinor: number } {
  requirePermission(actor, "debts.manage");

  if (input.amountMinor <= 0) {
    throw errValidation("errors.debt.amountInvalid");
  }
  if (!input.methodCode) {
    throw errValidation("errors.quickSession.methodRequired");
  }

  const stamp = nowStamp();

  return db.transaction(() => {
    let newRemaining = 0;

    if (input.debtType === "subscription") {
      let sub = db.first<{ id: string; member_id: string; price: number; status: string }>(
        "SELECT id, member_id, price, status FROM member_subscriptions WHERE id = ?",
        [input.debtId],
      );
      if (!sub) {
        // Fallback: in case debtId is a payment ID
        const p = db.first<{ subscription_id: string }>(
          "SELECT subscription_id FROM payments WHERE id = ?",
          [input.debtId],
        );
        if (p?.subscription_id) {
          sub = db.first<{ id: string; member_id: string; price: number; status: string }>(
            "SELECT id, member_id, price, status FROM member_subscriptions WHERE id = ?",
            [p.subscription_id],
          );
        }
      }
      if (!sub) throw errNotFound("errors.finance.subscriptionNotFoundForPayment");
      if (sub.status === "cancelled") throw errValidation("errors.subscriptionCancelled");

      const member = db.first<{ id: string; department: string | null }>(
        "SELECT id, department FROM members WHERE id = ?",
        [sub.member_id],
      );
      if (member) {
        assertDepartmentAccess(actor, member.department);
      }

      const agg = db.first<{ paid: number; discounted: number }>(
        `SELECT COALESCE(SUM(paid_amount_minor - refunded_amount_minor), 0) AS paid,
                COALESCE(SUM(discount_amount_minor), 0) AS discounted
         FROM payments
         WHERE subscription_id = ? AND status IN ('partial', 'paid')`,
        [sub.id],
      );
      const priceMinor = Math.round(Number(sub.price) * 100);
      const paidSoFar = Number(agg?.paid ?? 0);
      const discountSoFar = Number(agg?.discounted ?? 0);
      const remainingBefore = Math.max(0, priceMinor - paidSoFar - discountSoFar);

      if (remainingBefore <= 0) {
        throw errValidation("errors.finance.subscriptionFullyPaid");
      }
      if (input.amountMinor > remainingBefore) {
        throw errValidation("errors.overpayDebt");
      }

      newRemaining = remainingBefore - input.amountMinor;

      const paymentId = crypto.randomUUID();
      const branchId = getLocalBranchId(db);

      db.run(
        `INSERT INTO payments (
          id, member_id, subscription_id, base_amount_minor, discount_kind, discount_input,
          discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor,
          remaining_amount_minor, method_code, status, reference_no, notes, client_ref,
          paid_at, created_by, created_at, updated_at, branch_id
        ) VALUES (?, ?, ?, ?, 'none', 0, 0, ?, ?, 0, 0, ?, 'paid', NULL, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          sub.member_id,
          sub.id,
          input.amountMinor,
          input.amountMinor,
          input.amountMinor,
          input.methodCode,
          input.notes?.trim() || "سداد دفعة اشتراك متبقية",
          stamp,
          actor.userId,
          stamp,
          stamp,
          branchId,
        ],
      );

      insertLedgerEntry(db, {
        entryType: "payment",
        refTable: "payments",
        refId: paymentId,
        memberId: sub.member_id,
        methodCode: input.methodCode,
        direction: 1,
        amountMinor: input.amountMinor,
        occurredAt: stamp,
        actor,
      });
    } else if (input.debtType === "store") {
      const d = db.first<{
        id: string;
        member_id: string;
        original_minor: number;
        paid_minor: number;
      }>(
        "SELECT id, member_id, original_minor, paid_minor FROM store_debts WHERE id = ?",
        [input.debtId],
      );
      if (!d) throw errNotFound("errors.store.debtNotFound");
      const remainingBefore = d.original_minor - d.paid_minor;
      if (input.amountMinor > remainingBefore) {
        throw errValidation("errors.store.overpayDebt");
      }

      newRemaining = remainingBefore - input.amountMinor;
      const newPaid = d.paid_minor + input.amountMinor;
      const newStatus = newRemaining === 0 ? "settled" : "open";

      const repaymentId = crypto.randomUUID();
      db.run(
        `INSERT INTO store_debt_payments (id, debt_id, amount_minor, method_code, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [repaymentId, d.id, input.amountMinor, input.methodCode, actor.userId, stamp],
      );
      assignDocNo(db, "store_debt_payment", repaymentId, stamp, actor);

      db.run(
        `UPDATE store_debts 
         SET paid_minor = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [newPaid, newStatus, stamp, d.id],
      );

      // Ledger entry with box: 'store'
      insertLedgerEntry(db, {
        entryType: "payment",
        refTable: "store_debts",
        refId: `${d.id}-${repaymentId}`,
        memberId: d.member_id,
        methodCode: input.methodCode,
        direction: 1,
        amountMinor: input.amountMinor,
        occurredAt: stamp,
        actor,
        box: "store",
      });
    } else if (input.debtType === "private_training") {
      const pt = db.first<{
        id: string;
        member_id: string;
        remaining_amount_minor: number;
        paid_amount_minor: number;
      }>(
        "SELECT id, member_id, remaining_amount_minor, paid_amount_minor FROM private_trainings WHERE id = ?",
        [input.debtId],
      );
      if (!pt) throw errNotFound("errors.ptNotFound");
      if (input.amountMinor > pt.remaining_amount_minor) {
        throw errValidation("errors.overpayDebt");
      }

      newRemaining = pt.remaining_amount_minor - input.amountMinor;
      const newPaid = pt.paid_amount_minor + input.amountMinor;

      db.run(
        `UPDATE private_trainings 
         SET paid_amount_minor = ?, remaining_amount_minor = ?, updated_at = ?
         WHERE id = ?`,
        [newPaid, newRemaining, stamp, pt.id],
      );

      const ptPaymentRefId = `${pt.id}-pt-pay-${Date.now()}`;
      // Ledger entry
      insertLedgerEntry(db, {
        entryType: "payment",
        refTable: "private_trainings",
        refId: ptPaymentRefId,
        memberId: pt.member_id,
        methodCode: input.methodCode,
        direction: 1,
        amountMinor: input.amountMinor,
        occurredAt: stamp,
        actor,
      });
    }

    recordAudit(
      db,
      actor,
      "DEBT_REPAID",
      input.debtType,
      input.debtId,
      {
        paidMinor: input.amountMinor,
        remainingMinor: newRemaining,
        methodCode: input.methodCode,
        notes: input.notes,
      },
    );

    return {
      success: true,
      paidMinor: input.amountMinor,
      remainingMinor: newRemaining,
    };
  });
}
