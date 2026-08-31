import { nowStamp } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

// ───────────────────── helpers ─────────────────────

function str(v: unknown): string { return v == null ? "" : String(v); }
function num(v: unknown, fallback = 0): number { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

const EARN_ACTIONS = ["checkin", "renewal", "referral", "store_purchase"] as const;
export type EarnAction = (typeof EARN_ACTIONS)[number];

const REWARD_TYPES = ["free_days", "discount", "product", "pt_session", "custom"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export interface LoyaltySettings {
  rewardEnabled: boolean;
  storePointsPerEgp: number;
}

export interface EarnRule {
  id: string;
  action: EarnAction;
  points: number;
  enabled: boolean;
  pointsPerMinor: number | null;
  minMinor: number | null;
}

export interface RedemptionItem {
  id: string;
  rewardType: RewardType;
  title: string;
  pointsCost: number;
  valueMinor: number | null;
  days: number | null;
  sessions: number | null;
  productId: string | null;
  active: boolean;
}

export interface LoyaltyTransactionRow {
  id: string;
  memberId: string;
  delta: number;
  balanceAfter: number;
  kind: "earn" | "redeem" | "adjust" | "void";
  source: "checkin" | "renewal" | "referral" | "store_purchase" | "manual" | "redemption";
  reason: string | null;
  refTable: string | null;
  refId: string | null;
  rewardId: string | null;
  pointsCost: number | null;
  createdBy: string;
  createdAt: string;
}

export interface LoyaltyBalance {
  memberId: string;
  balance: number;
  earned: number;
  redeemed: number;
  adjusted: number;
  usableCreditMinor: number;
}

// ───────────────────── settings ─────────────────────

function readSettingsMap(db: Db): Map<string, string> {
  const rows = db.all<{ key: string; value: string }>("SELECT key, value FROM loyalty_settings");
  return new Map(rows.map((r) => [r.key, r.value]));
}

export function getLoyaltySettings(db: Db, actor: ServiceActor): LoyaltySettings {
  requirePermission(actor, "loyalty.manage");
  const map = readSettingsMap(db);
  return {
    rewardEnabled: map.get("reward_enabled") !== "0",
    storePointsPerEgp: Number(map.get("store_points_per_egp") ?? 0),
  };
}

export function updateLoyaltySettings(db: Db, actor: ServiceActor, patch: Partial<LoyaltySettings>): LoyaltySettings {
  requirePermission(actor, "loyalty.manage");
  const inputs: [string, string][] = [];
  if (patch.rewardEnabled != null) {
    if (typeof patch.rewardEnabled !== "boolean") throw errValidation("errors.loyalty.invalidSettings");
    inputs.push(["reward_enabled", patch.rewardEnabled ? "1" : "0"]);
  }
  if (patch.storePointsPerEgp != null) {
    if (!Number.isFinite(patch.storePointsPerEgp) || patch.storePointsPerEgp < 0) {
      throw errValidation("errors.loyalty.invalidPoints");
    }
    inputs.push(["store_points_per_egp", String(Math.round(patch.storePointsPerEgp))]);
  }
  db.transaction(() => {
    for (const [k, v] of inputs) db.run("INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES (?, ?)", [k, v]);
    if (inputs.length) recordAudit(db, actor, "LOYALTY_RULES_UPDATED", "loyalty_settings", null, Object.fromEntries(inputs));
  });
  return getLoyaltySettings(db, actor);
}

// ───────────────────── earn rules ─────────────────────

function mapEarnRule(r: Row): EarnRule {
  return {
    id: str(r.id),
    action: str(r.action) as EarnAction,
    points: num(r.points),
    enabled: num(r.enabled) === 1,
    pointsPerMinor: r.points_per_minor == null ? null : num(r.points_per_minor),
    minMinor: r.min_minor == null ? null : num(r.min_minor),
  };
}

export function getEarnRules(db: Db, actor: ServiceActor): EarnRule[] {
  requirePermission(actor, "loyalty.view");
  const rows = db.all<Row>("SELECT * FROM loyalty_earn_rules ORDER BY action");
  return rows.map(mapEarnRule);
}

function getRuleByAction(db: Db, action: EarnAction): EarnRule | null {
  const r = db.first<Row>("SELECT * FROM loyalty_earn_rules WHERE action = ?", [action]);
  return r ? mapEarnRule(r) : null;
}

export interface EarnRuleInput {
  action: EarnAction;
  points: number;
  enabled: boolean;
  pointsPerMinor?: number | null;
  minMinor?: number | null;
}

export function upsertEarnRule(db: Db, actor: ServiceActor, input: EarnRuleInput): EarnRule {
  requirePermission(actor, "loyalty.manage");
  if (!EARN_ACTIONS.includes(input.action)) throw errValidation("errors.loyalty.invalidRule");
  if (!Number.isInteger(input.points) || input.points < 0) throw errValidation("errors.loyalty.invalidPoints");
  if (input.pointsPerMinor != null && (!Number.isInteger(input.pointsPerMinor) || input.pointsPerMinor < 0)) {
    throw errValidation("errors.loyalty.invalidPoints");
  }
  if (input.minMinor != null && (!Number.isInteger(input.minMinor) || input.minMinor < 0)) {
    throw errValidation("errors.loyalty.invalidPoints");
  }
  db.transaction(() => {
    db.run(
      "INSERT INTO loyalty_earn_rules (id, action, points, enabled, points_per_minor, min_minor, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?)\nON CONFLICT(action) DO UPDATE SET\n  points = excluded.points,\n  enabled = excluded.enabled,\n  points_per_minor = excluded.points_per_minor,\n  min_minor = excluded.min_minor",
      [
        crypto.randomUUID(),
        input.action,
        input.points,
        input.enabled ? 1 : 0,
        input.pointsPerMinor ?? null,
        input.minMinor ?? null,
        nowStamp(),
      ],
    );
    recordAudit(db, actor, "LOYALTY_RULES_UPDATED", "loyalty_earn_rule", null, { action: input.action, points: input.points, enabled: input.enabled });
  });
  return getRuleByAction(db, input.action)!;
}

export function removeEarnRule(db: Db, actor: ServiceActor, action: EarnAction): void {
  requirePermission(actor, "loyalty.manage");
  if (!EARN_ACTIONS.includes(action)) throw errValidation("errors.loyalty.invalidRule");
  db.transaction(() => {
    db.run("DELETE FROM loyalty_earn_rules WHERE action = ?", [action]);
    recordAudit(db, actor, "LOYALTY_RULES_UPDATED", "loyalty_earn_rule", null, { action, removed: true });
  });
}

// ───────────────────── redemption catalog ─────────────────────

function mapRedemption(r: Row): RedemptionItem {
  return {
    id: str(r.id),
    rewardType: str(r.reward_type) as RewardType,
    title: str(r.title),
    pointsCost: num(r.points_cost),
    valueMinor: r.value_minor == null ? null : num(r.value_minor),
    days: r.days == null ? null : num(r.days),
    sessions: r.sessions == null ? null : num(r.sessions),
    productId: r.product_id == null ? null : str(r.product_id),
    active: num(r.active) === 1,
  };
}

export function getRedemptionCatalog(db: Db, actor: ServiceActor): RedemptionItem[] {
  requirePermission(actor, "loyalty.view");
  const rows = db.all<Row>("SELECT * FROM loyalty_redemption_catalog ORDER BY created_at");
  return rows.map(mapRedemption);
}

export interface RedemptionInput {
  id?: string;
  rewardType: RewardType;
  title: string;
  pointsCost: number;
  valueMinor?: number | null;
  days?: number | null;
  sessions?: number | null;
  productId?: string | null;
}

export function upsertRedemption(db: Db, actor: ServiceActor, input: RedemptionInput): RedemptionItem {
  requirePermission(actor, "loyalty.manage");
  if (!REWARD_TYPES.includes(input.rewardType)) throw errValidation("errors.loyalty.invalidRewardType");
  const title = (input.title ?? "").trim();
  if (!title) throw errValidation("errors.loyalty.titleRequired");
  if (!Number.isInteger(input.pointsCost) || input.pointsCost <= 0) throw errValidation("errors.loyalty.invalidPoints");
  if (input.rewardType === "discount") {
    if (input.valueMinor == null || !Number.isInteger(input.valueMinor) || input.valueMinor <= 0) {
      throw errValidation("errors.loyalty.invalidCreditAmount");
    }
  }
  if (input.rewardType === "free_days") {
    if (input.days == null || !Number.isInteger(input.days) || input.days <= 0) throw errValidation("errors.loyalty.invalidDays");
  }
  if (input.rewardType === "pt_session") {
    if (input.sessions == null || !Number.isInteger(input.sessions) || input.sessions <= 0) throw errValidation("errors.loyalty.invalidSessions");
  }
  if (input.rewardType === "product" && !input.productId) throw errValidation("errors.loyalty.productRequired");
  const existing = input.id ? db.first<Row>("SELECT * FROM loyalty_redemption_catalog WHERE id = ?", [input.id]) : null;
  const id = existing ? input.id! : crypto.randomUUID();
  db.transaction(() => {
    if (existing) {
      db.run(
        "UPDATE loyalty_redemption_catalog SET reward_type = ?, title = ?, points_cost = ?, value_minor = ?, days = ?, sessions = ?, product_id = ?\nWHERE id = ?",
        [
          input.rewardType,
          title,
          input.pointsCost,
          input.valueMinor ?? null,
          input.days ?? null,
          input.sessions ?? null,
          input.productId ?? null,
          id,
        ],
      );
    } else {
      db.run(
        "INSERT INTO loyalty_redemption_catalog (id, reward_type, title, points_cost, value_minor, days, sessions, product_id, active, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        [
          id,
          input.rewardType,
          title,
          input.pointsCost,
          input.valueMinor ?? null,
          input.days ?? null,
          input.sessions ?? null,
          input.productId ?? null,
          nowStamp(),
        ],
      );
    }
    recordAudit(db, actor, "LOYALTY_CATALOG_UPDATED", "loyalty_redemption_catalog", input.id ?? null, {
      rewardType: input.rewardType, title, pointsCost: input.pointsCost,
    });
  });
  return mapRedemption(db.first<Row>("SELECT * FROM loyalty_redemption_catalog WHERE id = ?", [id])!);
}

export function setRedemptionActive(db: Db, actor: ServiceActor, id: string, active: boolean): RedemptionItem {
  requirePermission(actor, "loyalty.manage");
  const existing = db.first<Row>("SELECT * FROM loyalty_redemption_catalog WHERE id = ?", [id]);
  if (!existing) throw errNotFound("errors.loyalty.rewardNotFound");
  db.transaction(() => {
    db.run("UPDATE loyalty_redemption_catalog SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
    recordAudit(db, actor, "LOYALTY_CATALOG_UPDATED", "loyalty_redemption_catalog", id, { active });
  });
  return mapRedemption(db.first<Row>("SELECT * FROM loyalty_redemption_catalog WHERE id = ?", [id])!);
}

// ───────────────────── points ledger ─────────────────────

export function memberBalance(db: Db, memberId: string): number {
  return num(db.scalar("SELECT COALESCE(SUM(delta), 0) FROM loyalty_transactions WHERE member_id = ?", [memberId]));
}

export function loyaltyUsableCreditMinor(db: Db, memberId: string): number {
  return num(
    db.scalar(
      "SELECT COALESCE(SUM(amount_minor - used_minor), 0) FROM loyalty_credit_transactions WHERE member_id = ? AND status = 'granted' AND amount_minor > used_minor",
      [memberId],
    ),
  );
}

export function getMemberBalance(db: Db, actor: ServiceActor, memberId: string): LoyaltyBalance {
  requirePermission(actor, "loyalty.view");
  if (!db.first("SELECT id FROM members WHERE id = ? AND deleted_at IS NULL", [memberId])) {
    throw errNotFound("errors.memberNotFound");
  }
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  const earned = num(db.scalar("SELECT COALESCE(SUM(delta), 0) FROM loyalty_transactions WHERE member_id = ? AND delta > 0", [memberId]));
  const redeemed = num(db.scalar("SELECT COALESCE(SUM(delta), 0) FROM loyalty_transactions WHERE member_id = ? AND delta < 0 AND kind = 'redeem'", [memberId]));
  const adjusted = num(db.scalar("SELECT COALESCE(SUM(delta), 0) FROM loyalty_transactions WHERE member_id = ? AND kind = 'adjust'", [memberId]));
  return {
    memberId,
    balance: memberBalance(db, memberId),
    earned,
    redeemed: Math.abs(redeemed),
    adjusted,
    usableCreditMinor: loyaltyUsableCreditMinor(db, memberId),
  };
}

export interface MemberTransactionQuery {
  page?: number;
  pageSize?: number;
}

export interface MemberTransactionPage {
  items: LoyaltyTransactionRow[];
  total: number;
}

function mapTransaction(r: Row): LoyaltyTransactionRow {
  return {
    id: str(r.id),
    memberId: str(r.member_id),
    delta: num(r.delta),
    balanceAfter: num(r.balance_after),
    kind: str(r.kind) as LoyaltyTransactionRow["kind"],
    source: str(r.source) as LoyaltyTransactionRow["source"],
    reason: r.reason == null ? null : str(r.reason),
    refTable: r.ref_table == null ? null : str(r.ref_table),
    refId: r.ref_id == null ? null : str(r.ref_id),
    rewardId: r.reward_id == null ? null : str(r.reward_id),
    pointsCost: r.points_cost == null ? null : num(r.points_cost),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  };
}

export function listMemberTransactions(db: Db, actor: ServiceActor, memberId: string, query: MemberTransactionQuery = {}): MemberTransactionPage {
  requirePermission(actor, "loyalty.view");
  if (!db.first("SELECT id FROM members WHERE id = ? AND deleted_at IS NULL", [memberId])) {
    throw errNotFound("errors.memberNotFound");
  }
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const total = num(db.scalar("SELECT COUNT(*) FROM loyalty_transactions WHERE member_id = ?", [memberId]));
  const rows = db.all<Row>(
    "SELECT * FROM loyalty_transactions WHERE member_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
    [memberId, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapTransaction), total };
}

/**
 * EARN POINTS — the single entry point for awarding loyalty points.
 * Must be called INSIDE an existing transaction (the caller's) so the points
 * ledger commit is atomic with the motivating event (check-in, sale, etc.).
 * Idempotent: a second invocation for the same (source, ref_id) is a no-op.
 */
export function earnPoints(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  source: "checkin" | "renewal" | "referral" | "store_purchase" | "manual",
  points: number,
  refTable: string | null,
  refId: string | null,
  reason: string | null,
): void {
  if (points <= 0) return;
  if (refId != null) {
    const existing = db.first<{ id: string }>("SELECT id FROM loyalty_transactions WHERE source = ? AND ref_id = ?", [source, refId]);
    if (existing) return; // no double-earn
  }
  const kind: "earn" | "adjust" = source === "manual" ? "adjust" : "earn";
  const prev = memberBalance(db, memberId);
  const next = prev + points;
  const txId = crypto.randomUUID();
  db.run(
    "INSERT INTO loyalty_transactions (id, member_id, delta, balance_after, kind, source, reason, ref_table, ref_id, reward_id, points_cost, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
    [txId, memberId, points, next, kind, source, reason, refTable, refId, actor.userId, nowStamp()],
  );
  recordAudit(db, actor, "LOYALTY_POINTS_EARNED", "loyalty_transaction", txId, {
    memberId, source, delta: points, balanceAfter: next, refTable: refTable ?? undefined, refId: refId ?? undefined, reason: reason ?? undefined,
  });
}

function isRewardEnabled(db: Db): boolean {
  return readSettingsMap(db).get("reward_enabled") !== "0";
}

/** Award based on the configured earn rule for an action; no-op if disabled/none. */
export function applyEarnRule(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  action: EarnAction,
  refTable: string | null,
  refId: string | null,
  opts: { totalMinor?: number; reason?: string } = {},
): void {
  if (!isRewardEnabled(db)) return;
  const rule = getRuleByAction(db, action);
  if (!rule || !rule.enabled) return;
  let points: number;
  if (rule.pointsPerMinor != null && rule.pointsPerMinor > 0 && (opts.totalMinor ?? 0) > 0) {
    points = Math.floor((opts.totalMinor ?? 0) * rule.pointsPerMinor / 100);
  } else {
    if (rule.pointsPerMinor != null && rule.pointsPerMinor > 0) return;
    if (rule.minMinor != null && (opts.totalMinor ?? 0) < rule.minMinor) return;
    points = rule.points;
  }
  earnPoints(db, actor, memberId, action, points, refTable, refId, opts.reason ?? action);
}

/**
 * Reverse the points earned for an event (e.g. a store sale that is later
 * voided). The reversal is a negative 'void' ledger row keyed to a distinct
 * ref_id (`void:` + originalRefId) so it never collides with the earn row in
 * the unique (source, ref_id) index and re-voids are idempotent. No-op when
 * the original earn is absent or the reversal already exists.
 */
export function reverseEarnedPoints(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  source: "checkin" | "renewal" | "referral" | "store_purchase",
  refTable: string | null,
  refId: string,
  reason: string,
): void {
  if (!isRewardEnabled(db)) return;
  const original = db.first<Row>(
    "SELECT * FROM loyalty_transactions WHERE member_id = ? AND source = ? AND ref_id = ? AND kind != 'void'",
    [memberId, source, refId],
  );
  if (!original || num(original.delta) <= 0) return;
  const reversalRefId = `void:${refId}`;
  const existing = db.first<{ id: string }>("SELECT id FROM loyalty_transactions WHERE source = ? AND ref_id = ? AND kind = 'void'", [source, reversalRefId]);
  if (existing) return;
  const points = num(original.delta);
  const prev = memberBalance(db, memberId);
  const next = Math.max(0, prev - points);
  db.run(
    "INSERT INTO loyalty_transactions (id, member_id, delta, balance_after, kind, source, reason, ref_table, ref_id, reward_id, points_cost, created_by, created_at)\nVALUES (?, ?, ?, ?, 'void', ?, ?, ?, ?, NULL, NULL, ?, ?)",
    [crypto.randomUUID(), memberId, -points, next, source, reason, refTable, reversalRefId, actor.userId, nowStamp()],
  );
  recordAudit(db, actor, "LOYALTY_POINTS_ADJUSTED", "loyalty_transaction", refId, {
    memberId, source, delta: -points, balanceAfter: next, reason, reversal: true,
  });
}

// ───────────────────── manual adjustment ─────────────────────

export function adjustPoints(db: Db, actor: ServiceActor, memberId: string, points: number, reason: string): number {
  requirePermission(actor, "loyalty.manage");
  if (!db.first("SELECT id FROM members WHERE id = ? AND deleted_at IS NULL", [memberId])) {
    throw errNotFound("errors.memberNotFound");
  }
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  if (!Number.isInteger(points) || points === 0) throw errValidation("errors.loyalty.invalidPoints");
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw errValidation("errors.loyalty.reasonRequired");
  if (points < 0 && memberBalance(db, memberId) + points < 0) throw errConflict("errors.loyalty.insufficientPoints");
  return db.transaction(() => {
    const prev = memberBalance(db, memberId);
    const next = prev + points;
    if (next < 0) throw errConflict("errors.loyalty.insufficientPoints");
    const txId = crypto.randomUUID();
    db.run(
      "INSERT INTO loyalty_transactions (id, member_id, delta, balance_after, kind, source, reason, ref_table, ref_id, reward_id, points_cost, created_by, created_at)\nVALUES (?, ?, ?, ?, 'adjust', 'manual', ?, NULL, NULL, NULL, NULL, ?, ?)",
      [txId, memberId, points, next, trimmed, actor.userId, nowStamp()],
    );
    recordAudit(db, actor, "LOYALTY_POINTS_ADJUSTED", "loyalty_transaction", txId, {
      memberId, delta: points, balanceAfter: next, reason: trimmed,
    });
    return next;
  });
}

// ───────────────────── redemption ─────────────────────

export interface RedemptionResult {
  txId: string;
  memberId: string;
  reward: RedemptionItem;
  balanceAfter: number;
  creditMinor: number;
}

export function redeemReward(db: Db, actor: ServiceActor, memberId: string, rewardId: string): RedemptionResult {
  requirePermission(actor, "loyalty.manage");
  if (!db.first("SELECT id FROM members WHERE id = ? AND deleted_at IS NULL", [memberId])) {
    throw errNotFound("errors.memberNotFound");
  }
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));
  const reward = db.first<Row>("SELECT * FROM loyalty_redemption_catalog WHERE id = ?", [rewardId]);
  if (!reward) throw errNotFound("errors.loyalty.rewardNotFound");
  if (num(reward.active) !== 1) throw errConflict("errors.loyalty.rewardInactive");
  const item = mapRedemption(reward);

  return db.transaction(() => {
    const prev = memberBalance(db, memberId);
    const next = prev - item.pointsCost;
    if (next < 0) throw errConflict("errors.loyalty.insufficientPoints");
    const txId = crypto.randomUUID();
    db.run(
      "INSERT INTO loyalty_transactions (id, member_id, delta, balance_after, kind, source, reason, ref_table, ref_id, reward_id, points_cost, created_by, created_at)\nVALUES (?, ?, ?, ?, 'redeem', 'redemption', ?, NULL, NULL, ?, ?, ?, ?)",
      [txId, memberId, -item.pointsCost, next, `redeem:${item.title}`, item.id, item.pointsCost, actor.userId, nowStamp()],
    );
    let creditMinor = 0;
    if (item.rewardType === "discount" && (item.valueMinor ?? 0) > 0) {
      creditMinor = item.valueMinor!;
      db.run(
        "INSERT INTO loyalty_credit_transactions (id, member_id, loyalty_transaction_id, reward_id, amount_minor, used_minor, status, created_by, created_at)\nVALUES (?, ?, ?, ?, ?, 0, 'granted', ?, ?)",
        [crypto.randomUUID(), memberId, txId, item.id, creditMinor, actor.userId, nowStamp()],
      );
    }
    recordAudit(db, actor, "LOYALTY_REWARD_REDEEMED", "loyalty_reward", rewardId, {
      memberId, rewardType: item.rewardType, pointsCost: item.pointsCost, balanceAfter: next, creditMinor,
    });
    return { txId, memberId, reward: item, balanceAfter: next, creditMinor };
  });
}

// ───────────────────── outstanding integration ─────────────────────

/**
 * Amount of usable loyalty credit that should reduce a member's displayed
 * outstanding balance. Read-only; does NOT touch financial_ledger.
 */
export function memberOutstandingAdjustment(db: Db, memberId: string): number {
  return loyaltyUsableCreditMinor(db, memberId);
}
