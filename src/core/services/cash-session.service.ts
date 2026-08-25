import { nowStamp } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

export type CashSessionStatus = "open" | "closed";
export type CashBox = "gym" | "store";

export interface CashSessionRow extends Row {
  id: string;
  opened_by: string;
  opened_at: string;
  opening_balance_minor: number;
  closed_by: string | null;
  closed_at: string | null;
  expected_closing_minor: number | null;
  counted_closing_minor: number | null;
  difference_minor: number | null;
  close_note: string | null;
  status: CashSessionStatus;
}

export interface CashSession {
  id: string;
  openedByName: string;
  openedAt: string;
  openingBalanceMinor: number;
  closedByName: string | null;
  closedAt: string | null;
  expectedClosingMinor: number | null;
  countedClosingMinor: number | null;
  differenceMinor: number | null;
  closeNote: string | null;
  status: CashSessionStatus;
  box: CashBox;
}

export interface OpenSessionInput {
  openingBalanceMinor: number;
  /** Which drawer this session counts; defaults to the gym box. */
  box?: CashBox;
}

export interface CloseSessionResult extends CashSession {
  cashInMinor: number;
  cashOutMinor: number;
}

function mapSession(row: CashSessionRow & Record<string, unknown>): CashSession {
  return {
    id: row.id,
    openedByName: String(row.opener_name ?? ""),
    openedAt: row.opened_at,
    openingBalanceMinor: Number(row.opening_balance_minor),
    closedByName: row.closer_name == null ? null : String(row.closer_name),
    closedAt: row.closed_at,
    expectedClosingMinor: row.expected_closing_minor == null ? null : Number(row.expected_closing_minor),
    countedClosingMinor: row.counted_closing_minor == null ? null : Number(row.counted_closing_minor),
    differenceMinor: row.difference_minor == null ? null : Number(row.difference_minor),
    closeNote: row.close_note,
    status: row.status as CashSessionStatus,
    box: (row.box == null ? "gym" : String(row.box)) as CashBox,
  };
}

const SESSION_SELECT = `SELECT cs.*, ou.full_name AS opener_name, cu.full_name AS closer_name\nFROM cash_sessions cs\nJOIN users ou ON ou.id = cs.opened_by\nLEFT JOIN users cu ON cu.id = cs.closed_by`;

function getSessionRow(db: Db, sessionId: string): (CashSessionRow & Record<string, unknown>) | null {
  return db.first<CashSessionRow & Record<string, unknown>>(`${SESSION_SELECT}\nWHERE cs.id = ?`, [
    sessionId,
  ]);
}

export function getOpenCashSession(db: Db, actor: ServiceActor, box: CashBox = "gym"): CashSession | null {
  requirePermission(actor, "payments.view");
  const row = db.first<CashSessionRow & Record<string, unknown>>(
    `${SESSION_SELECT}\nWHERE cs.status = 'open' AND cs.box = ?\nORDER BY cs.opened_at DESC LIMIT 1`,
    [box],
  );
  return row ? mapSession(row) : null;
}

const CASH_METHOD = "cash";

export interface SessionCashTotals {
  cashInMinor: number;
  cashOutMinor: number;
}

export function computeSessionCash(
  db: Db,
  openedAt: string,
  untilStamp: string,
  box: CashBox = "gym",
): SessionCashTotals {
  const row = db.first<{ cash_in: number; cash_out: number }>(
    `SELECT\n      COALESCE(SUM(CASE WHEN direction = 1 THEN amount_minor ELSE 0 END), 0) AS cash_in,\n      COALESCE(SUM(CASE WHEN direction = -1 THEN amount_minor ELSE 0 END), 0) AS cash_out\n    FROM financial_ledger\n    WHERE method_code = ? AND occurred_at >= ? AND occurred_at <= ? AND box = ?`,
    [CASH_METHOD, openedAt, untilStamp, box],
  );
  return {
    cashInMinor: Number(row?.cash_in ?? 0),
    cashOutMinor: Number(row?.cash_out ?? 0),
  };
}

export async function openCashSession(
  db: Db,
  actor: ServiceActor,
  input: OpenSessionInput,
): Promise<CashSession> {
  requirePermission(actor, "cash.open");
  const openingBalanceMinor = Math.round(input.openingBalanceMinor);
  assertNonNegativeInteger(openingBalanceMinor, "errors.finance.invalidAmount");
  const box: CashBox = input.box ?? "gym";
  if (box !== "gym" && box !== "store") throw errValidation("errors.finance.invalidBox");

  const openExisting = db.count(
    "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open' AND box = ?",
    [box],
  );
  if (openExisting > 0) throw errConflict("errors.finance.sessionAlreadyOpen");

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  await db.transaction(async () => {
    db.run(
      "INSERT INTO cash_sessions (id, opened_by, opened_at, opening_balance_minor, status, box)\nVALUES (?, ?, ?, ?, 'open', ?)",
      [id, actor.userId, stamp, openingBalanceMinor, box],
    );
    recordAudit(db, actor, "CASH_SESSION_OPENED", "cash_session", id, {
      openingBalanceMinor,
      box,
    });
  });
  const row = getSessionRow(db, id)!;
  return mapSession(row);
}

export async function closeCashSession(
  db: Db,
  actor: ServiceActor,
  sessionId: string,
  countedBalanceMinor: number,
  note?: string | null,
): Promise<CloseSessionResult> {
  requirePermission(actor, "cash.close");
  assertNonNegativeInteger(Math.round(countedBalanceMinor), "errors.finance.invalidCounted");

  const row = db.first<CashSessionRow>("SELECT * FROM cash_sessions WHERE id = ?", [sessionId]);
  if (!row) throw errNotFound("errors.finance.sessionNotFound");
  if (row.status !== "open") throw errConflict("errors.finance.sessionAlreadyClosed");

  const stamp = nowStamp();
  const totals = computeSessionCash(db, row.opened_at, stamp, (row.box ?? "gym") as CashBox);
  const expected =
    Number(row.opening_balance_minor) + totals.cashInMinor - totals.cashOutMinor;
  if (expected < 0) {
    throw errValidation("errors.finance.negativeExpected");
  }
  const difference = Math.round(countedBalanceMinor) - expected;

  await db.transaction(async () => {
    db.run(
      "UPDATE cash_sessions SET closed_by = ?, closed_at = ?, expected_closing_minor = ?, counted_closing_minor = ?, difference_minor = ?, close_note = ?, status = 'closed'\nWHERE id = ?",
      [actor.userId, stamp, expected, Math.round(countedBalanceMinor), difference, note?.trim() || null, sessionId],
    );
    recordAudit(db, actor, "CASH_SESSION_CLOSED", "cash_session", sessionId, {
      expectedMinor: expected,
      countedMinor: Math.round(countedBalanceMinor),
      cashInMinor: totals.cashInMinor,
      cashOutMinor: totals.cashOutMinor,
    });
    if (difference !== 0) {
      recordAudit(db, actor, "CASH_DISCREPANCY", "cash_session", sessionId, {
        differenceMinor: difference,
        expectedMinor: expected,
        countedMinor: Math.round(countedBalanceMinor),
      });
    }
  });

  const fresh = getSessionRow(db, sessionId)!;
  const mapped = mapSession(fresh);
  return { ...mapped, cashInMinor: totals.cashInMinor, cashOutMinor: totals.cashOutMinor };
}

export interface CashTotalsForOpen {
  openingMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  expectedMinor: number;
}

export function getOpenSessionTotals(
  db: Db,
  actor: ServiceActor,
): (CashTotalsForOpen & { session: CashSession }) | null {
  const session = getOpenCashSession(db, actor);
  if (!session) return null;
  const totals = computeSessionCash(db, session.openedAt, nowStamp(), session.box);
  const openingMinor = session.openingBalanceMinor;
  return {
    session,
    openingMinor,
    cashInMinor: totals.cashInMinor,
    cashOutMinor: totals.cashOutMinor,
    expectedMinor: Math.max(0, openingMinor + totals.cashInMinor - totals.cashOutMinor),
  };
}

export function listCashSessions(
  db: Db,
  actor: ServiceActor,
  query: { page?: number; pageSize?: number; status?: CashSessionStatus | "all" } = {},
): { items: CashSession[]; total: number } {
  requirePermission(actor, "reports.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
  const where = query.status && query.status !== "all" ? "WHERE cs.status = ?" : "";
  const params: Array<string | number> = query.status && query.status !== "all" ? [query.status] : [];
  const total = db.count(`SELECT COUNT(*) FROM cash_sessions cs ${where}`, params);
  const rows = db.all<CashSessionRow & Record<string, unknown>>(
    `${SESSION_SELECT}\n${where}\nORDER BY cs.opened_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapSession), total };
}
