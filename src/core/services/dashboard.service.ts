import {
  addDaysKey,
  dateKey,
  diffDaysKeys,
  parseDateKey,
  todayKey,
} from "@/core/dates";
import { requirePermission, roleHasPermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import {
  attendanceSeries,
  countCheckInsOnDate,
  type AttendanceDayPoint,
} from "./attendance.service";
import {
  countActiveSubscriptions,
  listExpiringSubscriptions,
  type SubscriptionWithMember,
} from "./subscriptions.service";

// ----------------------- date-range + bucketing helpers --------------------

export type DashboardBucket = "day" | "week" | "month";

export interface DashboardRange {
  fromKey: string;
  toKey: string;
}

export function resolveDashboardRange(
  key: "today" | "7d" | "30d" | "month" | "year" | "custom",
  custom?: DashboardRange,
): DashboardRange {
  const today = todayKey();
  switch (key) {
    case "today":
      return { fromKey: today, toKey: today };
    case "7d":
      return { fromKey: addDaysKey(today, -6), toKey: today };
    case "30d":
      return { fromKey: addDaysKey(today, -29), toKey: today };
    case "month":
      return { fromKey: `${today.slice(0, 7)}-01`, toKey: today };
    case "year":
      return { fromKey: `${today.slice(0, 4)}-01-01`, toKey: today };
    case "custom":
      if (custom && custom.fromKey <= custom.toKey) return custom;
      return { fromKey: addDaysKey(today, -6), toKey: today };
  }
}

/** Bucket id for a single YYYY-MM-DD key: day -> itself, week -> its Monday, month -> YYYY-MM. */
function bucketIdForKey(key: string, bucket: DashboardBucket): string {
  if (bucket === "day") return key;
  if (bucket === "month") return key.slice(0, 7);
  const d = parseDateKey(key);
  const offset = (d.getDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  return addDaysKey(key, -offset);
}

export function pickDashboardBucket(fromKey: string, toKey: string): DashboardBucket {
  const days = diffDaysKeys(fromKey, toKey) + 1;
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  return "month";
}

/** Ordered, gap-free list of bucket ids spanning from..to inclusive. */
function buildBucketKeys(fromKey: string, toKey: string, bucket: DashboardBucket): string[] {
  const keys: string[] = [];
  let cursor = fromKey;
  const guard = diffDaysKeys(fromKey, toKey) + 1 + 5;
  let n = 0;
  while (cursor <= toKey && n < guard) {
    const id = bucketIdForKey(cursor, bucket);
    if (keys[keys.length - 1] !== id) keys.push(id);
    const nextDate = parseDateKey(cursor);
    nextDate.setDate(nextDate.getDate() + 1);
    cursor = dateKey(nextDate);
    n++;
  }
  return keys;
}

interface DayPoint {
  revenueMinor: number;
  expensesMinor: number;
  netMinor: number;
  checks: number;
  newMembers: number;
  renewals: number;
}

function sumDayMap(
  map: Map<string, DayPoint>,
  fromKey: string,
  toKey: string,
): DayPoint {
  const acc: DayPoint = { revenueMinor: 0, expensesMinor: 0, netMinor: 0, checks: 0, newMembers: 0, renewals: 0 };
  if (fromKey >= toKey && fromKey !== toKey) return acc;
  let cursor = fromKey;
  const guard = diffDaysKeys(fromKey, toKey) + 1 + 5;
  let n = 0;
  while (cursor <= toKey && n < guard) {
    const p = map.get(cursor);
    if (p) {
      acc.revenueMinor += p.revenueMinor;
      acc.expensesMinor += p.expensesMinor;
      acc.netMinor += p.netMinor;
      acc.checks += p.checks;
      acc.newMembers += p.newMembers;
      acc.renewals += p.renewals;
    }
    const next = parseDateKey(cursor);
    next.setDate(next.getDate() + 1);
    cursor = dateKey(next);
    n++;
  }
  return acc;
}

function buildSeries(
  dayMap: Map<string, DayPoint>,
  bucketKeys: string[],
  bucket: DashboardBucket,
): SeriesPoint[] {
  return bucketKeys.map((bucketKey) => {
    if (bucket === "day") {
      const p = dayMap.get(bucketKey) ?? emptyDay();
      return { key: bucketKey, ...p };
    }
    const [from, to] = bucketRange(bucketKey, bucket);
    const acc = sumDayMap(dayMap, from, to);
    return { key: bucketKey, ...acc };
  });
}

function emptyDay(): DayPoint {
  return { revenueMinor: 0, expensesMinor: 0, netMinor: 0, checks: 0, newMembers: 0, renewals: 0 };
}

function bucketRange(bucketKey: string, bucket: DashboardBucket): [string, string] {
  if (bucket === "day") return [bucketKey, bucketKey];
  if (bucket === "month") {
    const start = `${bucketKey}-01`;
    const year = Number(bucketKey.slice(0, 4));
    const month = Number(bucketKey.slice(5, 7));
    const end = dateKey(new Date(year, month, 0));
    return [start, end];
  }
  // week -> Monday .. Sunday
  const start = bucketKey;
  const d = parseDateKey(start);
  d.setDate(d.getDate() + 6);
  return [start, addDaysKey(start, 6)];
}

export interface DashboardStats {
  totalMembers: number;
  activeMembers: number;
  activeSubscriptions: number;
  frozenSubscriptions: number;
  checkinsToday: number;
}

export function getDashboardStats(db: Db, actor: ServiceActor): DashboardStats {
  requirePermission(actor, "members.view");
  return {
    totalMembers: db.count("SELECT COUNT(*) FROM members WHERE status != 'archived'"),
    activeMembers: db.count("SELECT COUNT(*) FROM members WHERE status = 'active'"),
    activeSubscriptions: countActiveSubscriptions(db),
    frozenSubscriptions: db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'suspended'",
    ),
    checkinsToday: countCheckInsOnDate(db, todayKey()),
  };
}

export function getDashboardAttendance(
  db: Db,
  actor: ServiceActor,
  days: 7 | 30,
): AttendanceDayPoint[] {
  requirePermission(actor, "members.view");
  return attendanceSeries(db, days);
}

export function getExpiringForDashboard(
  db: Db,
  actor: ServiceActor,
  withinDays = 7,
): SubscriptionWithMember[] {
  requirePermission(actor, "subscriptions.view");
  return listExpiringSubscriptions(db, actor, withinDays);
}

interface OutstandingRow {
  cnt: number;
  total_minor: number;
}

export interface DashboardOperationalStats {
  /** Members with at least one active subscription not fully paid. */
  membersWithOutstanding: number;
  outstandingTotalMinor: number;
  expiredSubscriptions: number;
  lostCards: number;
  busyHoursToday: Array<{ hour: number; count: number }>;
}

export function getDashboardOperational(
  db: Db,
  actor: ServiceActor,
): DashboardOperationalStats {
  requirePermission(actor, "payments.view");
  const balanceRow = db.first<OutstandingRow>(
    "WITH paid AS (\n  SELECT subscription_id, SUM(paid_amount_minor) AS paid_minor, SUM(discount_amount_minor) AS discount_minor\n  FROM payments\n  WHERE subscription_id IS NOT NULL AND status IN ('partial', 'paid')\n  GROUP BY subscription_id\n)\nSELECT COUNT(*) AS cnt,\n  COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor, 0) - COALESCE(p.discount_minor, 0), 0)), 0) AS total_minor\nFROM member_subscriptions s\nLEFT JOIN paid p ON p.subscription_id = s.id\nWHERE s.status = 'active'",
  );
  const hourRows = db.all<{ hour: number; total: number }>(
    "SELECT CAST(substr(checkin_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS total\nFROM attendance WHERE deleted_at IS NULL AND substr(checkin_at, 1, 10) = ?\nGROUP BY hour ORDER BY total DESC LIMIT 5",
    [todayKey()],
  );
  return {
    membersWithOutstanding: Number(balanceRow?.cnt ?? 0),
    outstandingTotalMinor: Number(balanceRow?.total_minor ?? 0),
    expiredSubscriptions: db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND end_date < ?",
      [todayKey()],
    ),
    lostCards: db.count("SELECT COUNT(*) FROM cards WHERE status = 'lost'"),
    busyHoursToday: hourRows.map((row) => ({
      hour: Number(row.hour),
      count: Number(row.total),
    })),
  };
}

// ------------------------------ KPI series --------------------------------

export interface SeriesPoint {
  key: string;
  revenueMinor: number;
  expensesMinor: number;
  netMinor: number;
  checks: number;
  newMembers: number;
  renewals: number;
}

export interface TrendValue {
  current: number;
  previous: number;
  deltaPct: number | null;
}

export function trendOf(current: number, previous: number): TrendValue {
  return { current, previous, deltaPct: previous === 0 ? null : ((current - previous) / previous) * 100 };
}

interface LedgerDay {
  day: string;
  inflow: number;
  outflow: number;
  refunds: number;
}

/** Revenue/expenses per day from financial_ledger (excludes cancelled-sub rows, mirrors finance.service). */
function ledgerDayMap(db: Db, fromKey: string, toKey: string): Map<string, DayPoint> {
  const fromStamp = `${fromKey} 00:00:00`;
  const toStamp = `${addDaysKey(toKey, 1)} 00:00:00`;
  const rows = db.all<LedgerDay>(
    `SELECT substr(l.occurred_at, 1, 10) AS day,
      COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_type NOT IN ('refund', 'reversal_payment') THEN l.amount_minor ELSE 0 END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN l.direction = -1 AND l.entry_type NOT IN ('refund', 'reversal_expense') THEN l.amount_minor ELSE 0 END), 0) AS outflow,
      COALESCE(SUM(CASE WHEN l.entry_type = 'refund' THEN l.amount_minor ELSE 0 END), 0) AS refunds
    FROM financial_ledger l
    LEFT JOIN payments _lp ON l.ref_table = 'payments' AND l.ref_id = _lp.id
    LEFT JOIN member_subscriptions _ls ON _lp.subscription_id = _ls.id AND _ls.status = 'cancelled'
    LEFT JOIN payment_refunds _lr ON l.ref_table = 'payment_refunds' AND l.ref_id = _lr.id
    LEFT JOIN payments _lpr ON _lr.payment_id = _lpr.id
    LEFT JOIN member_subscriptions _lsr ON _lpr.subscription_id = _lsr.id AND _lsr.status = 'cancelled'
    WHERE l.occurred_at >= ? AND l.occurred_at < ? AND _ls.id IS NULL AND _lsr.id IS NULL
    GROUP BY day`,
    [fromStamp, toStamp],
  );
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    const revenue = Number(r.inflow) - Number(r.refunds);
    map.set(r.day, { revenueMinor: revenue, expensesMinor: Number(r.outflow), netMinor: revenue - Number(r.outflow), checks: 0, newMembers: 0, renewals: 0 });
  }
  return map;
}

/** Attendance per day (deleted rows excluded). */
function attendanceDayMap(db: Db, fromKey: string, toKey: string): Map<string, DayPoint> {
  const fromStamp = `${fromKey} 00:00:00`;
  const toStamp = `${addDaysKey(toKey, 1)} 00:00:00`;
  const rows = db.all<{ day: string; cnt: number }>(
    "SELECT substr(checkin_at, 1, 10) AS day, COUNT(*) AS cnt FROM attendance WHERE deleted_at IS NULL AND checkin_at >= ? AND checkin_at < ? GROUP BY day",
    [fromStamp, toStamp],
  );
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    map.set(r.day, { ...emptyDay(), checks: Number(r.cnt) });
  }
  return map;
}

/** New members per day (soft-deleted excluded). */
function newMembersDayMap(db: Db, fromKey: string, toKey: string): Map<string, DayPoint> {
  const fromStamp = `${fromKey} 00:00:00`;
  const toStamp = `${addDaysKey(toKey, 1)} 00:00:00`;
  const rows = db.all<{ day: string; cnt: number }>(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt FROM members WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY day",
    [fromStamp, toStamp],
  );
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    map.set(r.day, { ...emptyDay(), newMembers: Number(r.cnt) });
  }
  return map;
}

/** Renewals per day = subscriptions created in the period that are NOT the member's first subscription. */
function renewalsDayMap(db: Db, fromKey: string, toKey: string): Map<string, DayPoint> {
  const fromStamp = `${fromKey} 00:00:00`;
  const toStamp = `${addDaysKey(toKey, 1)} 00:00:00`;
  const rows = db.all<{ day: string; cnt: number }>(
    `SELECT substr(s.created_at, 1, 10) AS day, COUNT(*) AS cnt
     FROM member_subscriptions s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND s.id != (SELECT MIN(id) FROM member_subscriptions s2 WHERE s2.member_id = s.member_id)
     GROUP BY day`,
    [fromStamp, toStamp],
  );
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    map.set(r.day, { ...emptyDay(), renewals: Number(r.cnt) });
  }
  return map;
}

function mergeDayMaps(...maps: Map<string, DayPoint>[]): Map<string, DayPoint> {
  const out = new Map<string, DayPoint>();
  for (const m of maps) {
    for (const [k, p] of m) {
      const existing = out.get(k) ?? emptyDay();
      out.set(k, {
        revenueMinor: existing.revenueMinor + p.revenueMinor,
        expensesMinor: existing.expensesMinor + p.expensesMinor,
        netMinor: existing.netMinor + p.netMinor,
        checks: existing.checks + p.checks,
        newMembers: existing.newMembers + p.newMembers,
        renewals: existing.renewals + p.renewals,
      });
    }
  }
  return out;
}

export interface DashboardSeriesResult {
  range: DashboardRange;
  bucket: DashboardBucket;
  series: SeriesPoint[];
}

export function getDashboardSeries(
  db: Db,
  actor: ServiceActor,
  rangeKey: "today" | "7d" | "30d" | "month" | "year" | "custom",
  custom?: DashboardRange,
): DashboardSeriesResult {
  const range = resolveDashboardRange(rangeKey, custom);
  const bucket = pickDashboardBucket(range.fromKey, range.toKey);
  const bucketKeys = buildBucketKeys(range.fromKey, range.toKey, bucket);

  const canFinance = roleHasPermission(actor.roleId, "payments.view");
  const canMembers = roleHasPermission(actor.roleId, "members.view");

  const maps: Map<string, DayPoint>[] = [];
  if (canFinance) maps.push(ledgerDayMap(db, range.fromKey, range.toKey));
  if (canMembers) {
    maps.push(attendanceDayMap(db, range.fromKey, range.toKey));
    maps.push(newMembersDayMap(db, range.fromKey, range.toKey));
    maps.push(renewalsDayMap(db, range.fromKey, range.toKey));
  }
  const dayMap = mergeDayMaps(...maps);

  return { range, bucket, series: buildSeries(dayMap, bucketKeys, bucket) };
}

export interface DashboardFinanceSection {
  revenue: TrendValue;
  expenses: TrendValue;
  net: TrendValue;
}

export interface DashboardGrowthSection {
  newMembers: TrendValue;
  renewals: TrendValue;
  attendance: TrendValue;
}

export interface DashboardMembersSection {
  totalMembers: number;
  activeMembers: number;
  activeSubscriptions: number;
  frozenSubscriptions: number;
}

export interface DashboardStoreSection {
  lowStock: number;
  debtMinor: number;
}

export interface DashboardOperationsSection {
  outstandingTotalMinor: number;
  outstandingMembers: number;
  expiredSubscriptions: number;
  lostCards: number;
  expiringWithin7: number;
}

export interface DashboardOverview {
  range: DashboardRange;
  bucket: DashboardBucket;
  series: SeriesPoint[];
  finance: DashboardFinanceSection | null;
  growth: DashboardGrowthSection | null;
  members: DashboardMembersSection | null;
  store: DashboardStoreSection | null;
  operations: DashboardOperationsSection | null;
  pendingCrmMessages: number;
  expiredTrials: number;
}

export function getDashboardOverview(
  db: Db,
  actor: ServiceActor,
  rangeKey: "today" | "7d" | "30d" | "month" | "year" | "custom",
  custom?: DashboardRange,
): DashboardOverview {
  const series = getDashboardSeries(db, actor, rangeKey, custom);
  const range = series.range;
  const bucket = series.bucket;

  const canFinance = roleHasPermission(actor.roleId, "payments.view");
  const canMembers = roleHasPermission(actor.roleId, "members.view");
  const canSubs = roleHasPermission(actor.roleId, "subscriptions.view");
  const canStore = roleHasPermission(actor.roleId, "store.view");

  const spanDays = diffDaysKeys(range.fromKey, range.toKey) + 1;
  const prevFromKey = addDaysKey(range.fromKey, -spanDays);
  const prevToKey = addDaysKey(range.fromKey, -1);

  let finance: DashboardFinanceSection | null = null;
  if (canFinance) {
    const curr = sumDayMap(seriesDayMapOf(series), range.fromKey, range.toKey);
    const prev = sumDayMap(
      ledgerOnly(db, prevFromKey, prevToKey),
      prevFromKey,
      prevToKey,
    );
    finance = {
      revenue: trendOf(curr.revenueMinor, prev.revenueMinor),
      expenses: trendOf(curr.expensesMinor, prev.expensesMinor),
      net: trendOf(curr.netMinor, prev.netMinor),
    };
  }

  let growth: DashboardGrowthSection | null = null;
  if (canMembers) {
    const curr = sumDayMap(seriesDayMapOf(series), range.fromKey, range.toKey);
    const prev = mergeDayMaps(
      attendanceDayMap(db, prevFromKey, prevToKey),
      newMembersDayMap(db, prevFromKey, prevToKey),
      renewalsDayMap(db, prevFromKey, prevToKey),
    );
    const prevSum = sumDayMap(prev, prevFromKey, prevToKey);
    growth = {
      newMembers: trendOf(curr.newMembers, prevSum.newMembers),
      renewals: trendOf(curr.renewals, prevSum.renewals),
      attendance: trendOf(curr.checks, prevSum.checks),
    };
  }

  let members: DashboardMembersSection | null = null;
  if (canMembers) {
    members = {
      totalMembers: db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL"),
      activeMembers: db.count("SELECT COUNT(*) FROM members WHERE status = 'active' AND deleted_at IS NULL"),
      activeSubscriptions: canSubs ? countActiveSubscriptions(db) : 0,
      frozenSubscriptions: canSubs
        ? db.count("SELECT COUNT(*) FROM member_subscriptions WHERE status = 'suspended'")
        : 0,
    };
  }

  let store: DashboardStoreSection | null = null;
  if (canStore) {
    store = {
      lowStock: db.count("SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock_qty <= min_stock_qty"),
      debtMinor: Number(db.scalar("SELECT COALESCE(SUM(original_minor - paid_minor), 0) FROM store_debts WHERE status = 'open'") ?? 0),
    };
  }

  let operations: DashboardOperationsSection | null = null;
  if (canSubs) {
    const outstanding = db.first<{ cnt: number; total_minor: number }>(
      "WITH paid AS (\n  SELECT subscription_id, SUM(paid_amount_minor) AS paid_minor, SUM(discount_amount_minor) AS discount_minor\n  FROM payments\n  WHERE subscription_id IS NOT NULL AND status IN ('partial', 'paid')\n  GROUP BY subscription_id\n)\nSELECT COUNT(*) AS cnt,\n  COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor, 0) - COALESCE(p.discount_minor, 0), 0)), 0) AS total_minor\nFROM member_subscriptions s\nLEFT JOIN paid p ON p.subscription_id = s.id\nWHERE s.status = 'active'",
    );
    const today = todayKey();
    operations = {
      outstandingTotalMinor: Number(outstanding?.total_minor ?? 0),
      outstandingMembers: Number(outstanding?.cnt ?? 0),
      expiredSubscriptions: db.count(
        "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND end_date < ?",
        [today],
      ),
      lostCards: canMembers ? db.count("SELECT COUNT(*) FROM cards WHERE status = 'lost'") : 0,
      expiringWithin7: db.count(
        "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND end_date >= ? AND end_date <= ?",
        [today, addDaysKey(today, 6)],
      ),
    };
  }

  const pendingCrmMessages = roleHasPermission(actor.roleId, "crm.send")
    ? db.count("SELECT COUNT(*) FROM crm_messages WHERE status = 'pending'")
    : 0;

  const expiredTrials = roleHasPermission(actor.roleId, "trials.view")
    ? db.count(
        `SELECT COUNT(*) FROM trials WHERE status = 'active' AND end_date < '${todayKey()}'`,
      )
    : 0;

  return {
    range,
    bucket,
    series: series.series,
    finance,
    growth,
    members,
    store,
    operations,
    pendingCrmMessages,
    expiredTrials,
  };
}

function seriesDayMapOf(series: DashboardSeriesResult): Map<string, DayPoint> {
  const map = new Map<string, DayPoint>();
  for (const p of series.series) map.set(p.key, { ...emptyDay(), revenueMinor: p.revenueMinor, expensesMinor: p.expensesMinor, netMinor: p.netMinor, checks: p.checks, newMembers: p.newMembers, renewals: p.renewals });
  return map;
}

function ledgerOnly(db: Db, fromKey: string, toKey: string): Map<string, DayPoint> {
  return ledgerDayMap(db, fromKey, toKey);
}
