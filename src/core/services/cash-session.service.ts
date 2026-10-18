import { nowStamp, todayKey } from "@/core/dates";
import { errConflict, errForbidden, errNotFound, errValidation } from "@/core/errors";
import { assertNonNegativeInteger } from "@/core/money";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { assignDocNo } from "./document-numbers.service";
import { recordAudit } from "./audit.service";
import { insertLedgerEntry } from "./payments.service";
import { getLocalBranchId } from "@/core/branch";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { DEVELOPER_CREDIT_LINE, whatsappTransport } from "./card-delivery.service";

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
  box: string | null;
  closing_no: string | null;
  previous_session_id: string | null;
  previous_closing_minor: number | null;
  inter_shift_gap_minor: number | null;
  gap_reason: string | null;
  gap_expense_id: string | null;
}

export interface CashSession {
  id: string;
  openedById: string;
  openedByName: string;
  openedAt: string;
  openingBalanceMinor: number;
  closedById: string | null;
  closedByName: string | null;
  closedAt: string | null;
  expectedClosingMinor: number | null;
  countedClosingMinor: number | null;
  differenceMinor: number | null;
  closeNote: string | null;
  status: CashSessionStatus;
  box: CashBox;
  closingNo?: string | null;
  previousSessionId?: string | null;
  previousClosingMinor?: number | null;
  interShiftGapMinor?: number | null;
  gapReason?: string | null;
  gapExpenseId?: string | null;
}

export interface OpenSessionInput {
  openingBalanceMinor: number;
  /** Which drawer this session counts; defaults to the gym box. */
  box?: CashBox;
  gapReason?: string | null;
}

export interface CloseSessionResult extends CashSession {
  cashInMinor: number;
  cashOutMinor: number;
}

function mapSession(row: CashSessionRow & Record<string, unknown>): CashSession {
  return {
    id: row.id,
    openedById: String(row.opened_by ?? ""),
    openedByName: String(row.opener_name ?? ""),
    openedAt: row.opened_at,
    openingBalanceMinor: Number(row.opening_balance_minor),
    closedById: row.closed_by == null ? null : String(row.closed_by),
    closedByName: row.closer_name == null ? null : String(row.closer_name),
    closedAt: row.closed_at,
    expectedClosingMinor: row.expected_closing_minor == null ? null : Number(row.expected_closing_minor),
    countedClosingMinor: row.counted_closing_minor == null ? null : Number(row.counted_closing_minor),
    differenceMinor: row.difference_minor == null ? null : Number(row.difference_minor),
    closeNote: row.close_note,
    status: row.status as CashSessionStatus,
    box: (row.box == null ? "gym" : String(row.box)) as CashBox,
    closingNo: row.closing_no == null ? null : String(row.closing_no),
    previousSessionId: row.previous_session_id == null ? null : String(row.previous_session_id),
    previousClosingMinor: row.previous_closing_minor == null ? null : Number(row.previous_closing_minor),
    interShiftGapMinor: row.inter_shift_gap_minor == null ? 0 : Number(row.inter_shift_gap_minor),
    gapReason: row.gap_reason == null ? null : String(row.gap_reason),
    gapExpenseId: (row.gap_expense_id == null || row.gap_expense_status === "voided") ? null : String(row.gap_expense_id),
  };
}

const SESSION_SELECT = `SELECT cs.*, ou.full_name AS opener_name, cu.full_name AS closer_name, ge.status AS gap_expense_status\nFROM cash_sessions cs\nJOIN users ou ON ou.id = cs.opened_by\nLEFT JOIN users cu ON cu.id = cs.closed_by\nLEFT JOIN expenses ge ON ge.id = cs.gap_expense_id`;

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

export function getLastClosedCashSession(
  db: Db,
  actor: ServiceActor,
  box: CashBox = "gym",
): CashSession | null {
  requirePermission(actor, "payments.view");
  const row = db.first<CashSessionRow & Record<string, unknown>>(
    `${SESSION_SELECT}\nWHERE cs.status = 'closed' AND cs.box = ?\nORDER BY cs.closed_at DESC LIMIT 1`,
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

export interface DeficitAlertParams {
  box: CashBox;
  openingBalanceMinor: number;
  previousClosingMinor: number;
  deficitMinor: number;
  openerName: string;
  closerName: string | null;
  gapReason: string | null;
  timestamp: string;
}

export function formatHandoverDeficitAlertMessage(params: DeficitAlertParams & { gymName?: string }): string {
  const gymName = params.gymName || "GymGate";
  const boxName = params.box === "store" ? "خزينة المتجر" : "خزينة الجيم";
  const deficitEgp = (params.deficitMinor / 100).toFixed(2);
  const prevClosingEgp = (params.previousClosingMinor / 100).toFixed(2);
  const openBalanceEgp = (params.openingBalanceMinor / 100).toFixed(2);
  const closerName = params.closerName || "غير محدد";
  const openerName = params.openerName || "غير محدد";
  const reason = params.gapReason || "لم يُسجل سبب";

  return [
    `🚨 *تنبيه رقابي عاجل: عجز تسليم نقدية بين الورديات*`,
    `━━━━━━━━━━━━━━━━━`,
    `🏢 *المنشأة:* ${gymName}`,
    `📦 *الخزينة:* ${boxName}`,
    `⚠️ *قيمة العجز:* ${deficitEgp} ج.م`,
    `━━━━━━━━━━━━━━━━━`,
    `📥 *إغلاق الوردية السابقة:* ${prevClosingEgp} ج.م`,
    `👤 *كاشير الإغلاق السابق:* ${closerName}`,
    `💵 *المبلغ الفعلي المستلم:* ${openBalanceEgp} ج.م`,
    `👤 *كاشير استلام الوردية:* ${openerName}`,
    `📝 *السبب المدون:* ${reason}`,
    `🕒 *التوقيت:* ${params.timestamp}`,
    `━━━━━━━━━━━━━━━━━`,
    `💡 *الإجراء المطلوب:* يرجى مراجعة درج الكاشير والتأكد من تسوية العجز أو توجيهه كمصروف رقابي.`,
    `\n${DEVELOPER_CREDIT_LINE}`,
  ].join("\n");
}

export async function sendOwnerHandoverDeficitAlert(
  db: Db,
  params: DeficitAlertParams,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    let phone: string | null = (readSetting(db, SETTING_KEYS.ownerAlertPhone) || "").trim();
    if (!phone) {
      const ownerUser = db.first<{ phone: string | null }>(
        "SELECT phone FROM users WHERE role_id = 'owner' AND is_active = 1 AND phone IS NOT NULL AND TRIM(phone) != '' ORDER BY created_at ASC LIMIT 1",
      );
      if (ownerUser?.phone) {
        phone = ownerUser.phone.trim();
      }
    }
    if (!phone) {
      phone = (readSetting(db, SETTING_KEYS.gymPhone) || "").trim();
    }
    if (!phone) {
      return { ok: false, skipped: true, error: "no_owner_phone" };
    }

    const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
    const isMock = proc.process?.env?.GYM_CRM_MOCK === "1";
    const apiUrl = (readSetting(db, SETTING_KEYS.whatsappApiUrl) || "").trim() || "http://127.0.0.1:8891";

    const gymName = readSetting(db, SETTING_KEYS.gymName) || "GymGate";
    const message = formatHandoverDeficitAlertMessage({ ...params, gymName });

    if (isMock) {
      return { ok: true };
    }

    const transport = whatsappTransport(apiUrl);
    return await transport(phone, message);
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
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

  // Check last closed session for inter-shift gap
  const lastClosed = db.first<{
    id: string;
    counted_closing_minor: number | null;
    expected_closing_minor: number | null;
    closer_name: string | null;
  }>(
    `SELECT cs.id, cs.counted_closing_minor, cs.expected_closing_minor, u.full_name AS closer_name
     FROM cash_sessions cs
     LEFT JOIN users u ON u.id = cs.closed_by
     WHERE cs.box = ? AND cs.status = 'closed'
     ORDER BY cs.closed_at DESC LIMIT 1`,
    [box],
  );

  let previousSessionId: string | null = null;
  let previousClosingMinor: number | null = null;
  let interShiftGapMinor = 0;

  if (lastClosed) {
    previousSessionId = lastClosed.id;
    previousClosingMinor = lastClosed.counted_closing_minor != null
      ? Number(lastClosed.counted_closing_minor)
      : (lastClosed.expected_closing_minor != null ? Number(lastClosed.expected_closing_minor) : 0);
    interShiftGapMinor = openingBalanceMinor - previousClosingMinor;
  }

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const gapReason = input.gapReason?.trim() || null;

  await db.transaction(async () => {
    db.run(
      `INSERT INTO cash_sessions (
        id, opened_by, opened_at, opening_balance_minor, status, box,
        previous_session_id, previous_closing_minor, inter_shift_gap_minor, gap_reason
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      [
        id,
        actor.userId,
        stamp,
        openingBalanceMinor,
        box,
        previousSessionId,
        previousClosingMinor,
        interShiftGapMinor,
        gapReason,
      ],
    );
    recordAudit(db, actor, "CASH_SESSION_OPENED", "cash_session", id, {
      openingBalanceMinor,
      box,
      previousClosingMinor,
      interShiftGapMinor,
    });
    if (interShiftGapMinor < 0) {
      recordAudit(db, actor, "CASH_DISCREPANCY", "cash_session", id, {
        handoverDeficitMinor: Math.abs(interShiftGapMinor),
        openingBalanceMinor,
        previousClosingMinor,
        reason: gapReason,
      });
    }
  });
  const row = getSessionRow(db, id)!;

  if (interShiftGapMinor < 0) {
    void sendOwnerHandoverDeficitAlert(db, {
      box,
      openingBalanceMinor,
      previousClosingMinor: previousClosingMinor ?? 0,
      deficitMinor: Math.abs(interShiftGapMinor),
      openerName: String(row.opener_name || actor.username || actor.userId),
      closerName: lastClosed?.closer_name ?? null,
      gapReason,
      timestamp: stamp,
    }).catch(() => {
      /* ignore background alert failure */
    });
  }

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

  // Strict ownership enforcement: Only the employee who opened this session (or the owner/developer) can close it
  const isOpener = actor.userId === row.opened_by;
  const isOwnerOrDev = actor.roleId === "owner" || actor.isDeveloper === true;
  if (!isOpener && !isOwnerOrDev) {
    throw errValidation("errors.finance.sessionOpenerOnlyCanClose");
  }

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
    assignDocNo(db, "cash_closing", sessionId, stamp, actor);
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

/**
 * Aborts/deletes a session (ADR-008). OPEN sessions may be purged (mistaken
 * open) — ledger money truth is untouched. CLOSED sessions are permanent:
 * their counted-vs-expected discrepancy record must never be hidden.
 */
export function deleteCashSession(db: Db, actor: ServiceActor, sessionId: string): void {
  requirePermission(actor, "cash.purge");
  const row = getSessionRow(db, sessionId);
  if (!row) throw errNotFound("errors.finance.sessionNotFound");

  db.run("DELETE FROM cash_sessions WHERE id = ?", [sessionId]);
  recordAudit(db, actor, "CASH_SESSION_DELETED", "cash_session", sessionId, {
    box: String(row.box ?? "gym"),
    openedAt: row.opened_at,
    status: row.status,
  });
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

export interface CashSessionListQuery {
  page?: number;
  pageSize?: number;
  status?: CashSessionStatus | "all";
  openedById?: string;
  fromKey?: string;
  toKey?: string;
  box?: CashBox | "all";
  discrepancy?: "all" | "exact" | "difference" | "shortage" | "surplus";
}

export interface CashierPerformanceItem {
  userId: string;
  fullName: string;
  username: string;
  sessionsCount: number;
  totalOpeningMinor: number;
  totalExpectedMinor: number;
  totalCountedMinor: number;
  totalDifferenceMinor: number;
  shortageCount: number;
  surplusCount: number;
  exactCount: number;
  totalCollectionsMinor: number;
}

export function listCashSessions(
  db: Db,
  actor: ServiceActor,
  query: CashSessionListQuery = {},
): { items: CashSession[]; total: number } {
  requirePermission(actor, "reports.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status && query.status !== "all") {
    conditions.push("cs.status = ?");
    params.push(query.status);
  }

  if (query.openedById && query.openedById.trim() !== "" && query.openedById !== "all") {
    conditions.push("cs.opened_by = ?");
    params.push(query.openedById);
  }

  if (query.box && query.box !== "all") {
    conditions.push("cs.box = ?");
    params.push(query.box);
  }

  if (query.fromKey && query.fromKey.trim() !== "") {
    conditions.push("cs.opened_at >= ?");
    params.push(`${query.fromKey} 00:00:00`);
  }

  if (query.toKey && query.toKey.trim() !== "") {
    conditions.push("cs.opened_at <= ?");
    params.push(`${query.toKey} 23:59:59`);
  }

  if (query.discrepancy && query.discrepancy !== "all") {
    if (query.discrepancy === "exact") {
      conditions.push("(cs.status = 'closed' AND cs.difference_minor = 0)");
    } else if (query.discrepancy === "difference") {
      conditions.push("(cs.status = 'closed' AND cs.difference_minor != 0)");
    } else if (query.discrepancy === "shortage") {
      conditions.push("(cs.status = 'closed' AND cs.difference_minor < 0)");
    } else if (query.discrepancy === "surplus") {
      conditions.push("(cs.status = 'closed' AND cs.difference_minor > 0)");
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM cash_sessions cs ${where}`, params);
  const rows = db.all<CashSessionRow & Record<string, unknown>>(
    `${SESSION_SELECT}\n${where}\nORDER BY cs.opened_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapSession), total };
}

export function getCashierPerformanceSummary(
  db: Db,
  actor: ServiceActor,
  range: { fromKey?: string; toKey?: string } = {},
): CashierPerformanceItem[] {
  requirePermission(actor, "reports.view");

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (range.fromKey) {
    conditions.push("cs.opened_at >= ?");
    params.push(`${range.fromKey} 00:00:00`);
  }
  if (range.toKey) {
    conditions.push("cs.opened_at <= ?");
    params.push(`${range.toKey} 23:59:59`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.all<{
    user_id: string;
    full_name: string;
    username: string;
    sessions_count: number;
    total_opening_minor: number;
    total_expected_minor: number;
    total_counted_minor: number;
    total_difference_minor: number;
    shortage_count: number;
    surplus_count: number;
    exact_count: number;
  }>(
    `SELECT
      u.id AS user_id,
      u.full_name AS full_name,
      u.username AS username,
      COUNT(cs.id) AS sessions_count,
      COALESCE(SUM(cs.opening_balance_minor), 0) AS total_opening_minor,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' THEN cs.expected_closing_minor ELSE 0 END), 0) AS total_expected_minor,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' THEN cs.counted_closing_minor ELSE 0 END), 0) AS total_counted_minor,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' THEN cs.difference_minor ELSE 0 END), 0) AS total_difference_minor,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' AND cs.difference_minor < 0 THEN 1 ELSE 0 END), 0) AS shortage_count,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' AND cs.difference_minor > 0 THEN 1 ELSE 0 END), 0) AS surplus_count,
      COALESCE(SUM(CASE WHEN cs.status = 'closed' AND cs.difference_minor = 0 THEN 1 ELSE 0 END), 0) AS exact_count
    FROM cash_sessions cs
    JOIN users u ON u.id = cs.opened_by
    ${where}
    GROUP BY u.id, u.full_name, u.username
    ORDER BY sessions_count DESC`,
    params,
  );

  // Calculate direct payment cash collections by user in the same range
  const payConditions: string[] = ["p.status IN ('paid', 'partial')"];
  const payParams: Array<string | number> = [];
  if (range.fromKey) {
    payConditions.push("p.paid_at >= ?");
    payParams.push(`${range.fromKey} 00:00:00`);
  }
  if (range.toKey) {
    payConditions.push("p.paid_at <= ?");
    payParams.push(`${range.toKey} 23:59:59`);
  }

  const payRows = db.all<{ created_by: string; total_collected: number }>(
    `SELECT p.created_by, COALESCE(SUM(p.paid_amount_minor), 0) AS total_collected
     FROM payments p
     LEFT JOIN member_subscriptions s ON s.id = p.subscription_id
     WHERE ${payConditions.join(" AND ")} AND (s.id IS NULL OR s.status != 'cancelled')
     GROUP BY p.created_by`,
    payParams,
  );

  const collectionsMap = new Map<string, number>();
  for (const pr of payRows) {
    collectionsMap.set(pr.created_by, Number(pr.total_collected || 0));
  }

  return rows.map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    username: r.username,
    sessionsCount: Number(r.sessions_count),
    totalOpeningMinor: Number(r.total_opening_minor),
    totalExpectedMinor: Number(r.total_expected_minor),
    totalCountedMinor: Number(r.total_counted_minor),
    totalDifferenceMinor: Number(r.total_difference_minor),
    shortageCount: Number(r.shortage_count),
    surplusCount: Number(r.surplus_count),
    exactCount: Number(r.exact_count),
    totalCollectionsMinor: collectionsMap.get(r.user_id) ?? 0,
  }));
}

export interface OwnerWithdrawInput {
  amountMinor: number;
  note?: string | null;
  box?: CashBox;
}

export async function withdrawByOwner(
  db: Db,
  actor: ServiceActor,
  input: OwnerWithdrawInput,
): Promise<{ expenseId: string; amountMinor: number; expectedRemainingMinor: number }> {
  if (actor.roleId !== "owner" && actor.isDeveloper !== true) {
    throw errForbidden();
  }

  const amountMinor = Math.round(input.amountMinor);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw errValidation("errors.finance.invalidAmount");
  }

  const box: CashBox = input.box ?? "gym";
  const openSession = getOpenCashSession(db, actor, box);
  if (!openSession) {
    throw errValidation("errors.finance.noOpenSessionToWithdraw");
  }

  // Ensure category exists
  let category = db.first<{ id: string }>(
    "SELECT id FROM expense_categories WHERE id = 'cat-owner-withdrawal' OR name_ar = 'مسحوبات المالك / الإدارة'",
  );
  if (!category) {
    db.run(
      "INSERT OR IGNORE INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('cat-owner-withdrawal', 'مسحوبات المالك / الإدارة', 1, ?)",
      [nowStamp()],
    );
    category = { id: "cat-owner-withdrawal" };
  }

  const expenseId = crypto.randomUUID();
  const stamp = nowStamp();
  const today = todayKey();
  const desc = input.note?.trim()
    ? `مسحوبات المالك / الإدارة: ${input.note.trim()}`
    : "مسحوبات نقدية للمالك / الإدارة من الخزينة";

  await db.transaction(async () => {
    db.run(
      "INSERT INTO expenses (id, category_id, amount_minor, method_code, description, expense_date, reference_no, status, created_by, created_at, updated_at, branch_id)\nVALUES (?, ?, ?, 'cash', ?, ?, NULL, 'active', ?, ?, ?, ?)",
      [
        expenseId,
        category.id,
        amountMinor,
        desc,
        today,
        actor.userId,
        stamp,
        stamp,
        getLocalBranchId(db),
      ],
    );

    insertLedgerEntry(db, {
      entryType: "expense",
      refTable: "expenses",
      refId: expenseId,
      memberId: null,
      methodCode: "cash",
      direction: -1,
      amountMinor,
      occurredAt: `${today} ${stamp.slice(11)}`,
      actor,
      box,
    });

    recordAudit(db, actor, "EXPENSE_CREATED", "expense", expenseId, {
      category: category.id,
      amountMinor,
      method: "cash",
      isOwnerWithdrawal: true,
      box,
    });
  });

  const totals = computeSessionCash(db, openSession.openedAt, nowStamp(), box);
  const expectedRemaining = Math.max(0, openSession.openingBalanceMinor + totals.cashInMinor - totals.cashOutMinor);

  return {
    expenseId,
    amountMinor,
    expectedRemainingMinor: expectedRemaining,
  };
}

export interface ResolveGapInput {
  sessionId: string;
  note: string;
  categoryId?: string;
}

export async function resolveInterShiftGap(
  db: Db,
  actor: ServiceActor,
  input: ResolveGapInput,
): Promise<{ session: CashSession; expenseId: string }> {
  requirePermission(actor, "expenses.create");
  const trimmedNote = input.note?.trim();
  if (!trimmedNote || trimmedNote.length < 2) {
    throw errValidation("errors.finance.descriptionRequired");
  }

  const sessionRow = db.first<CashSessionRow>(
    "SELECT * FROM cash_sessions WHERE id = ?",
    [input.sessionId],
  );
  if (!sessionRow) throw errNotFound("errors.finance.sessionNotFound");

  const gapMinor = Number(sessionRow.inter_shift_gap_minor || 0);
  if (gapMinor >= 0) {
    throw errValidation("errors.finance.noDeficitToResolve");
  }
  if (sessionRow.gap_expense_id) {
    const linkedExp = db.first<{ id: string; status: string }>(
      "SELECT id, status FROM expenses WHERE id = ?",
      [sessionRow.gap_expense_id],
    );
    if (linkedExp && linkedExp.status === "active") {
      throw errConflict("errors.finance.deficitAlreadyResolved");
    }
  }

  const deficitAmountMinor = Math.abs(gapMinor);

  // Ensure category exists
  let categoryId = input.categoryId?.trim();
  if (!categoryId) {
    let cat = db.first<{ id: string }>(
      "SELECT id FROM expense_categories WHERE id = 'cat-cash-shortage' OR name_ar LIKE '%عجز%' LIMIT 1",
    );
    if (!cat) {
      db.run(
        "INSERT OR IGNORE INTO expense_categories (id, name_ar, is_active, created_at) VALUES ('cat-cash-shortage', 'عجز ونواقص الخزينة', 1, ?)",
        [nowStamp()],
      );
      cat = { id: "cat-cash-shortage" };
    }
    categoryId = cat.id;
  }

  const expenseId = crypto.randomUUID();
  const stamp = nowStamp();
  const today = todayKey();
  const box: CashBox = (sessionRow.box ?? "gym") as CashBox;
  const description = `عجز تسليم بين الورديتين (وردية #${sessionRow.id.slice(0, 8)}): ${trimmedNote}`;

  await db.transaction(async () => {
    db.run(
      `INSERT INTO expenses (
        id, category_id, amount_minor, method_code, description,
        expense_date, reference_no, status, created_by, created_at, updated_at, branch_id
      ) VALUES (?, ?, ?, 'cash', ?, ?, NULL, 'active', ?, ?, ?, ?)`,
      [
        expenseId,
        categoryId,
        deficitAmountMinor,
        description,
        today,
        actor.userId,
        stamp,
        stamp,
        getLocalBranchId(db),
      ],
    );

    // Record ledger entry before/at session opened_at to reflect cash leaving before the new shift
    const occurredAt = sessionRow.opened_at || `${today} ${stamp.slice(11)}`;

    insertLedgerEntry(db, {
      entryType: "expense",
      refTable: "expenses",
      refId: expenseId,
      memberId: null,
      methodCode: "cash",
      direction: -1,
      amountMinor: deficitAmountMinor,
      occurredAt,
      actor,
      box,
    });

    db.run(
      "UPDATE cash_sessions SET gap_expense_id = ?, gap_reason = ? WHERE id = ?",
      [expenseId, trimmedNote, input.sessionId],
    );

    recordAudit(db, actor, "EXPENSE_CREATED", "expense", expenseId, {
      category: categoryId,
      amountMinor: deficitAmountMinor,
      method: "cash",
      isInterShiftDeficit: true,
      sessionId: input.sessionId,
      box,
    });
  });

  const fresh = getSessionRow(db, input.sessionId)!;
  return {
    session: mapSession(fresh),
    expenseId,
  };
}

