import { errConflict, errNotFound } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { getLocalBranchId } from "@/core/branch";

export interface StaffShiftRow extends Row {
  id: string;
  user_id: string;
  opened_at: string;
  opening_cash_minor: number;
  closed_at: string | null;
  closed_by: string | null;
  expected_cash_minor: number;
  counted_cash_minor: number | null;
  difference_minor: number | null;
  notes: string | null;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  branch_id: string | null;
}

export interface StaffShift {
  id: string;
  userId: string;
  userName: string;
  openedAt: string;
  openingCashMinor: number;
  closedAt: string | null;
  closedByName: string | null;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  notes: string | null;
  status: "open" | "closed";
  branchId: string | null;
}

export interface ShiftSummary {
  shift: StaffShift;
  paymentsCount: number;
  paymentsCashMinor: number;
  paymentsOtherMinor: number;
  storeSalesCount: number;
  storeSalesCashMinor: number;
  expensesCashMinor: number;
  netCashCollectedMinor: number;
  newMembersCount: number;
  checkinsCount: number;
}

export interface OpenShiftInput {
  openingCashMinor?: number;
  notes?: string | null;
}

export interface CloseShiftInput {
  countedCashMinor: number;
  notes?: string | null;
}

export async function getActiveShift(
  db: Db,
  actor: ServiceActor,
): Promise<StaffShift | null> {
  requirePermission(actor, "shifts.view");
  const row = db.first<StaffShiftRow & { user_name: string }>(
    `SELECT s.*, u.username as user_name
     FROM staff_shifts s
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id = ? AND s.status = 'open'
     ORDER BY s.opened_at DESC LIMIT 1`,
    [actor.userId],
  );
  if (!row) return null;
  return toShift(row);
}

export async function openShift(
  db: Db,
  actor: ServiceActor,
  input: OpenShiftInput = {},
): Promise<StaffShift> {
  requirePermission(actor, "shifts.manage");

  const existing = await getActiveShift(db, actor);
  if (existing) {
    throw errConflict("errors.shiftAlreadyOpen");
  }

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const openingCashMinor = Math.max(0, Math.round(input.openingCashMinor ?? 0));
  const branchId = getLocalBranchId(db);

  await db.transaction(async () => {
    db.run(
      `INSERT INTO staff_shifts (id, user_id, opened_at, opening_cash_minor, status, notes, created_at, updated_at, branch_id)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        id,
        actor.userId,
        stamp,
        openingCashMinor,
        input.notes?.trim() || null,
        stamp,
        stamp,
        branchId,
      ],
    );

    recordAudit(db, actor, "STAFF_SHIFT_OPENED", "shift", id, {
      openingCashMinor,
      openedAt: stamp,
    });
  });

  const shift = await getActiveShift(db, actor);
  if (!shift) throw new Error("shift vanished after open");
  return shift;
}

export async function getShiftSummary(
  db: Db,
  actor: ServiceActor,
  shiftId: string,
): Promise<ShiftSummary> {
  requirePermission(actor, "shifts.view");
  const row = db.first<StaffShiftRow & { user_name: string }>(
    `SELECT s.*, u.username as user_name
     FROM staff_shifts s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [shiftId],
  );
  if (!row) throw errNotFound("errors.shiftNotFound");

  const startTime = row.opened_at;
  const endTime = row.closed_at ?? nowStamp();
  const userId = row.user_id;

  // 1. Subscription & membership payments collected by this user in shift period
  const paymentRows = db.all<Row & { method_code: string; paid_amount_minor: number }>(
    `SELECT method_code, paid_amount_minor
     FROM payments
     WHERE created_by = ? AND paid_at >= ? AND paid_at <= ? AND status != 'voided'`,
    [userId, startTime, endTime],
  );

  let paymentsCashMinor = 0;
  let paymentsOtherMinor = 0;
  for (const p of paymentRows) {
    if (p.method_code === "cash") {
      paymentsCashMinor += Number(p.paid_amount_minor || 0);
    } else {
      paymentsOtherMinor += Number(p.paid_amount_minor || 0);
    }
  }

  // 2. POS store sales collected by this user in shift period
  const storeRows = db.all<Row & { total_minor: number; method_code: string }>(
    `SELECT total_minor, method_code
     FROM store_sales
     WHERE seller_id = ? AND sold_at >= ? AND sold_at <= ? AND status != 'voided'`,
    [userId, startTime, endTime],
  );

  let storeSalesCashMinor = 0;
  for (const s of storeRows) {
    if (s.method_code === "cash") {
      storeSalesCashMinor += Number(s.total_minor || 0);
    }
  }

  // 3. Cash expenses disbursed by this user in shift period
  const expenseRows = db.all<Row & { amount_minor: number }>(
    `SELECT amount_minor
     FROM expenses
     WHERE created_by = ? AND created_at >= ? AND created_at <= ? AND status != 'voided'`,
    [userId, startTime, endTime],
  );

  let expensesCashMinor = 0;
  for (const e of expenseRows) {
    expensesCashMinor += Number(e.amount_minor || 0);
  }

  // 4. Activity stats: new members created & check-ins
  const newMembersCount = Number(
    db.scalar(
      "SELECT COUNT(*) FROM members WHERE created_by = ? AND created_at >= ? AND created_at <= ?",
      [userId, startTime, endTime],
    ) || 0,
  );

  const checkinsCount = Number(
    db.scalar(
      "SELECT COUNT(*) FROM attendance WHERE created_by = ? AND checkin_at >= ? AND checkin_at <= ?",
      [userId, startTime, endTime],
    ) || 0,
  );

  const netCashCollectedMinor = paymentsCashMinor + storeSalesCashMinor - expensesCashMinor;
  const expectedCashMinor = Number(row.opening_cash_minor || 0) + netCashCollectedMinor;

  const shift = toShift(row);
  shift.expectedCashMinor = expectedCashMinor;

  return {
    shift,
    paymentsCount: paymentRows.length,
    paymentsCashMinor,
    paymentsOtherMinor,
    storeSalesCount: storeRows.length,
    storeSalesCashMinor,
    expensesCashMinor,
    netCashCollectedMinor,
    newMembersCount,
    checkinsCount,
  };
}

export async function closeShift(
  db: Db,
  actor: ServiceActor,
  shiftIdOrInput?: string | (CloseShiftInput & { shiftId?: string }),
  maybeInput?: CloseShiftInput,
): Promise<ShiftSummary & StaffShift> {
  requirePermission(actor, "shifts.manage");

  let shiftId = typeof shiftIdOrInput === "string" ? shiftIdOrInput : (shiftIdOrInput?.shiftId || "");
  const input: CloseShiftInput = typeof shiftIdOrInput === "object" ? shiftIdOrInput : (maybeInput || { countedCashMinor: 0 });

  if (!shiftId) {
    const active = await getActiveShift(db, actor);
    if (!active) {
      throw errNotFound("errors.shiftNotFound");
    }
    shiftId = active.id;
  }

  const row = db.first<StaffShiftRow>(
    "SELECT * FROM staff_shifts WHERE id = ?",
    [shiftId],
  );
  if (!row) throw errNotFound("errors.shiftNotFound");
  if (row.status !== "open") throw errConflict("errors.shiftAlreadyClosed");

  const countedCashMinor = Math.max(0, Math.round(Number(input.countedCashMinor || 0)));
  const summary = await getShiftSummary(db, actor, shiftId);
  const expectedCashMinor = summary.shift.expectedCashMinor;
  const differenceMinor = countedCashMinor - expectedCashMinor;
  const stamp = nowStamp();

  await db.transaction(async () => {
    db.run(
      `UPDATE staff_shifts
       SET status = 'closed',
           closed_at = ?,
           closed_by = ?,
           expected_cash_minor = ?,
           counted_cash_minor = ?,
           difference_minor = ?,
           notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
           updated_at = ?
       WHERE id = ?`,
      [
        stamp,
        actor.userId,
        expectedCashMinor,
        countedCashMinor,
        differenceMinor,
        input.notes?.trim() || null,
        input.notes?.trim() || null,
        stamp,
        shiftId,
      ],
    );

    recordAudit(db, actor, "STAFF_SHIFT_CLOSED", "shift", shiftId, {
      expectedCashMinor,
      countedCashMinor,
      differenceMinor,
      closedAt: stamp,
    });
  });

  const finalSummary = await getShiftSummary(db, actor, shiftId);
  return {
    ...finalSummary.shift,
    ...finalSummary,
  };
}

export function listShifts(
  db: Db,
  actor: ServiceActor,
  limit = 30,
): StaffShift[] {
  requirePermission(actor, "shifts.view");
  const rows = db.all<StaffShiftRow & { user_name: string; closed_by_name: string | null }>(
    `SELECT s.*, u.username as user_name, cb.username as closed_by_name
     FROM staff_shifts s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN users cb ON cb.id = s.closed_by
     ORDER BY s.opened_at DESC
     LIMIT ?`,
    [limit],
  );

  return rows.map((r) => ({
    ...toShift(r),
    closedByName: r.closed_by_name ?? null,
  }));
}

function toShift(
  row: StaffShiftRow & { user_name?: string; closed_by_name?: string | null },
): StaffShift {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || "User",
    openedAt: row.opened_at,
    openingCashMinor: Number(row.opening_cash_minor || 0),
    closedAt: row.closed_at,
    closedByName: row.closed_by_name || null,
    expectedCashMinor: Number(row.expected_cash_minor || 0),
    countedCashMinor: row.counted_cash_minor == null ? null : Number(row.counted_cash_minor),
    differenceMinor: row.difference_minor == null ? null : Number(row.difference_minor),
    notes: row.notes,
    status: row.status,
    branchId: row.branch_id,
  };
}
