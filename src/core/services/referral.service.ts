import { nowStamp } from "@/core/dates";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { assertDepartmentAccess, memberDepartmentById } from "./department";

// ───────────────────── helpers ─────────────────────

function str(v: unknown): string { return v == null ? "" : String(v); }
function num(v: unknown, fallback = 0): number { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REF-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ───────────────────── settings ─────────────────────

export interface ReferralSettings {
  rewardType: "free_days" | "credit";
  rewardValue: number;
}

export function getReferralSettings(db: Db, actor: ServiceActor): ReferralSettings {
  requirePermission(actor, "referrals.view");
  const rows = db.all<{ key: string; value: string }>("SELECT key, value FROM referral_settings");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    rewardType: (map.get("reward_type") ?? "free_days") as "free_days" | "credit",
    rewardValue: Number(map.get("reward_value") ?? 7),
  };
}

export function updateReferralSettings(db: Db, actor: ServiceActor, settings: Partial<ReferralSettings>): ReferralSettings {
  requirePermission(actor, "referrals.manage");
  if (settings.rewardType && !["free_days", "credit"].includes(settings.rewardType)) {
    throw errValidation("errors.invalidRole");
  }
  if (settings.rewardValue != null && settings.rewardValue < 0) {
    throw errValidation("errors.finance.invalidAmount");
  }
  db.transaction(() => {
    if (settings.rewardType) {
      db.run("INSERT OR REPLACE INTO referral_settings (key, value) VALUES ('reward_type', ?)", [settings.rewardType]);
    }
    if (settings.rewardValue != null) {
      db.run("INSERT OR REPLACE INTO referral_settings (key, value) VALUES ('reward_value', ?)", [String(settings.rewardValue)]);
    }
    recordAudit(db, actor, "SETTINGS_UPDATED", "referral_settings", null, { ...settings });
  });
  return getReferralSettings(db, actor);
}

// ───────────────────── member referral code ─────────────────────

export function getMemberReferralCode(db: Db, actor: ServiceActor, memberId: string): string {
  requirePermission(actor, "members.view");
  const row = db.first<{ referral_code: string | null }>("SELECT referral_code FROM members WHERE id = ?", [memberId]);
  if (!row) throw errNotFound("errors.memberNotFound");
  if (row.referral_code) return row.referral_code;
  const code = generateReferralCode();
  db.run("UPDATE members SET referral_code = ? WHERE id = ?", [code, memberId]);
  return code;
}

// ───────────────────── referrals CRUD ─────────────────────

export interface ReferralRow {
  id: string;
  referrerId: string;
  referrerName: string;
  referredName: string;
  referredPhone: string | null;
  referredMemberId: string | null;
  referralCode: string;
  status: "pending" | "joined" | "cancelled";
  notes: string | null;
  createdAt: string;
  convertedAt: string | null;
}

function mapReferral(r: Row): ReferralRow {
  return {
    id: str(r.id),
    referrerId: str(r.referrer_id),
    referrerName: str(r.referrer_name),
    referredName: str(r.referred_name),
    referredPhone: r.referred_phone == null ? null : str(r.referred_phone),
    referredMemberId: r.referred_member_id == null ? null : str(r.referred_member_id),
    referralCode: str(r.referral_code),
    status: str(r.status) as "pending" | "joined" | "cancelled",
    notes: r.notes == null ? null : str(r.notes),
    createdAt: str(r.created_at),
    convertedAt: r.converted_at == null ? null : str(r.converted_at),
  };
}

const REFERRAL_SELECT =
  "SELECT r.*, rm.full_name AS referrer_name FROM referrals r LEFT JOIN members rm ON rm.id = r.referrer_id";

export interface ReferralListQuery {
  referrerId?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listReferrals(db: Db, actor: ServiceActor, query: ReferralListQuery = {}): { items: ReferralRow[]; total: number } {
  requirePermission(actor, "referrals.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (query.referrerId) { conditions.push("r.referrer_id = ?"); params.push(query.referrerId); }
  if (query.status) { conditions.push("r.status = ?"); params.push(query.status); }
  if (query.search) {
    conditions.push("(r.referred_name LIKE ? OR r.referred_phone LIKE ? OR rm.full_name LIKE ?)");
    const s = `%${query.search}%`; params.push(s, s, s);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.count(`SELECT COUNT(*) FROM referrals r LEFT JOIN members rm ON rm.id = r.referrer_id ${where}`, params);
  const rows = db.all<Row>(`${REFERRAL_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { items: rows.map(mapReferral), total };
}

export function getReferral(db: Db, actor: ServiceActor, referralId: string): ReferralRow {
  requirePermission(actor, "referrals.view");
  const row = db.first<Row>(`${REFERRAL_SELECT} WHERE r.id = ?`, [referralId]);
  if (!row) throw errNotFound("errors.referralNotFound");
  return mapReferral(row);
}

export interface CreateReferralInput {
  referrerMemberId: string;
  referredName: string;
  referredPhone?: string | null;
  notes?: string | null;
}

export function createReferral(db: Db, actor: ServiceActor, input: CreateReferralInput): ReferralRow {
  requirePermission(actor, "referrals.manage");
  const referrer = db.first<Row>("SELECT id, full_name, department, referral_code FROM members WHERE id = ? AND deleted_at IS NULL", [input.referrerMemberId]);
  if (!referrer) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, input.referrerMemberId));

  const name = input.referredName.trim();
  if (name.length < 2) throw errValidation("errors.fullNameRequired");
  if (input.referredPhone && input.referredPhone.trim().length < 5) throw errValidation("errors.phoneInvalid");

  // ensure referrer has a referral code
  let code = str(referrer.referral_code);
  if (!code) {
    code = generateReferralCode();
    db.run("UPDATE members SET referral_code = ? WHERE id = ?", [code, input.referrerMemberId]);
  }

  // prevent self-referral: check if referred phone matches referrer's phone
  if (input.referredPhone) {
    const referrerPhone = db.first<{ phone: string | null }>("SELECT phone FROM members WHERE id = ?", [input.referrerMemberId]);
    if (referrerPhone?.phone && input.referredPhone.trim() === referrerPhone.phone.trim()) {
      throw errConflict("errors.referralSelfReferral");
    }
  }

  const id = crypto.randomUUID();
  const ts = nowStamp();
  const referral = db.transaction(() => {
    db.run(
      "INSERT INTO referrals (id, referrer_id, referred_name, referred_phone, referral_code, status, notes, created_at)\nVALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      [id, input.referrerMemberId, name, input.referredPhone?.trim() || null, code, input.notes?.trim() || null, ts],
    );
    recordAudit(db, actor, "REFERRAL_CREATED", "referral", id, { referrerId: input.referrerMemberId, referredName: name });
    return db.first<Row>(`${REFERRAL_SELECT} WHERE r.id = ?`, [id])!;
  });
  return mapReferral(referral);
}

export function cancelReferral(db: Db, actor: ServiceActor, referralId: string): ReferralRow {
  requirePermission(actor, "referrals.manage");
  const row = db.first<Row>("SELECT * FROM referrals WHERE id = ?", [referralId]);
  if (!row) throw errNotFound("errors.referralNotFound");
  if (row.status !== "pending") throw errConflict("errors.referralAlreadyProcessed");
  assertDepartmentAccess(actor, memberDepartmentById(db, str(row.referrer_id)));

  const updated = db.transaction(() => {
    db.run("UPDATE referrals SET status = 'cancelled' WHERE id = ?", [referralId]);
    recordAudit(db, actor, "REFERRAL_CANCELLED", "referral", referralId, { referrerId: str(row.referrer_id) });
    return db.first<Row>(`${REFERRAL_SELECT} WHERE r.id = ?`, [referralId])!;
  });
  return mapReferral(updated);
}

// ───────────────────── conversion ─────────────────────

export function convertReferral(db: Db, actor: ServiceActor, referralId: string, memberId: string): ReferralRow {
  requirePermission(actor, "referrals.manage");
  const referralRow = db.first<Row>("SELECT * FROM referrals WHERE id = ?", [referralId]);
  if (!referralRow) throw errNotFound("errors.referralNotFound");
  if (referralRow.status !== "pending") throw errConflict("errors.referralAlreadyProcessed");
  assertDepartmentAccess(actor, memberDepartmentById(db, str(referralRow.referrer_id)));

  const member = db.first<Row>("SELECT id FROM members WHERE id = ? AND deleted_at IS NULL", [memberId]);
  if (!member) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));

  // prevent duplicate reward: check if this member is already a converted referral
  const existing = db.first<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM referrals WHERE referred_member_id = ? AND status = 'joined' AND id != ?",
    [memberId, referralId],
  );
  if (existing && num(existing.cnt) > 0) throw errConflict("errors.referralDuplicateReward");

  const settings = getReferralSettings(db, actor);
  const ts = nowStamp();

  const updated = db.transaction(() => {
    db.run(
      "UPDATE referrals SET status = 'joined', referred_member_id = ?, converted_at = ? WHERE id = ?",
      [memberId, ts, referralId],
    );

    // grant reward
    const rewardId = crypto.randomUUID();
    db.run(
      "INSERT INTO referral_rewards (id, referral_id, referrer_id, reward_type, reward_value, status, created_at, granted_at)\nVALUES (?, ?, ?, ?, ?, 'granted', ?, ?)",
      [rewardId, referralId, str(referralRow.referrer_id), settings.rewardType, settings.rewardValue, ts, ts],
    );

    recordAudit(db, actor, "REFERRAL_CONVERTED", "referral", referralId, {
      referrerId: str(referralRow.referrer_id),
      memberId,
      rewardType: settings.rewardType,
      rewardValue: settings.rewardValue,
    });
    recordAudit(db, actor, "REFERRAL_REWARD_GRANTED", "referral_reward", rewardId, {
      referrerId: str(referralRow.referrer_id),
      rewardType: settings.rewardType,
      rewardValue: settings.rewardValue,
    });

    return db.first<Row>(`${REFERRAL_SELECT} WHERE r.id = ?`, [referralId])!;
  });
  return mapReferral(updated);
}

// ───────────────────── stats ─────────────────────

export interface ReferralStats {
  totalReferrals: number;
  convertedReferrals: number;
  pendingReferrals: number;
  cancelledReferrals: number;
  conversionRate: number;
  totalRewardsGranted: number;
}

export function getReferralStats(db: Db, actor: ServiceActor, referrerId?: string): ReferralStats {
  requirePermission(actor, "referrals.view");
  const where = referrerId ? "WHERE referrer_id = ?" : "";
  const params = referrerId ? [referrerId] : [];

  const total = num(db.scalar(`SELECT COUNT(*) FROM referrals ${where}`, params));
  const converted = num(db.scalar(`SELECT COUNT(*) FROM referrals ${where}${where ? " AND" : " WHERE"} status = 'joined'`, params));
  const pending = num(db.scalar(`SELECT COUNT(*) FROM referrals ${where}${where ? " AND" : " WHERE"} status = 'pending'`, params));
  const cancelled = num(db.scalar(`SELECT COUNT(*) FROM referrals ${where}${where ? " AND" : " WHERE"} status = 'cancelled'`, params));
  const rewardsWhere = referrerId ? "WHERE rr.referrer_id = ? AND rr.status = 'granted'" : "WHERE rr.status = 'granted'";
  const rewardsParams = referrerId ? [referrerId] : [];
  const rewards = num(db.scalar(`SELECT COUNT(*) FROM referral_rewards rr ${rewardsWhere}`, rewardsParams));

  return {
    totalReferrals: total,
    convertedReferrals: converted,
    pendingReferrals: pending,
    cancelledReferrals: cancelled,
    conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
    totalRewardsGranted: rewards,
  };
}

export interface TopReferrerRow {
  referrerId: string;
  referrerName: string;
  totalReferrals: number;
  convertedReferrals: number;
}

export function listTopReferrers(db: Db, actor: ServiceActor, limit = 10): TopReferrerRow[] {
  requirePermission(actor, "referrals.view");
  const rows = db.all<Row>(
    "SELECT r.referrer_id, rm.full_name AS referrer_name, COUNT(*) AS total, SUM(CASE WHEN r.status = 'joined' THEN 1 ELSE 0 END) AS converted\nFROM referrals r LEFT JOIN members rm ON rm.id = r.referrer_id\nGROUP BY r.referrer_id ORDER BY converted DESC, total DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => ({
    referrerId: str(r.referrer_id),
    referrerName: str(r.referrer_name),
    totalReferrals: num(r.total),
    convertedReferrals: num(r.converted),
  }));
}

// ───────────────────── rewards ─────────────────────

export interface ReferralRewardRow {
  id: string;
  referralId: string;
  referrerId: string;
  referrerName: string;
  rewardType: "free_days" | "credit";
  rewardValue: number;
  status: "pending" | "granted" | "cancelled";
  createdAt: string;
  grantedAt: string | null;
}

function mapReward(r: Row): ReferralRewardRow {
  return {
    id: str(r.id),
    referralId: str(r.referral_id),
    referrerId: str(r.referrer_id),
    referrerName: str(r.referrer_name),
    rewardType: str(r.reward_type) as "free_days" | "credit",
    rewardValue: num(r.reward_value),
    status: str(r.status) as "pending" | "granted" | "cancelled",
    createdAt: str(r.created_at),
    grantedAt: r.granted_at == null ? null : str(r.granted_at),
  };
}

export function listReferralRewards(db: Db, actor: ServiceActor, referrerId?: string): ReferralRewardRow[] {
  requirePermission(actor, "referrals.view");
  const where = referrerId ? "WHERE rr.referrer_id = ?" : "";
  const params = referrerId ? [referrerId] : [];
  const rows = db.all<Row>(
    `SELECT rr.*, rm.full_name AS referrer_name FROM referral_rewards rr LEFT JOIN members rm ON rm.id = rr.referrer_id ${where} ORDER BY rr.created_at DESC`,
    params,
  );
  return rows.map(mapReward);
}
