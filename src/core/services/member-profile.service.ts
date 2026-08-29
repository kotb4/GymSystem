import { diffDaysKeys, todayKey } from "@/core/dates";
import { errNotFound } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { assertDepartmentAccess, memberDepartmentById } from "./department";
import { toAuditItem, type AuditLogItem } from "./audit.service";

export type SubscriptionKind = "time" | "sessions" | "open";

export interface MemberOverviewActiveSub {
  id: string;
  planName: string | null;
  kind: SubscriptionKind;
  startDate: string;
  endDate: string;
  sessionsTotal: number | null;
  sessionsUsed: number;
}

export interface MemberOverview {
  activeSubscription: MemberOverviewActiveSub | null;
  nextSubDaysLeft: number | null;
  lastAttendanceAt: string | null;
  visitsThisMonth: number;
}

interface OverviewSubRow extends Row {
  id: string;
  start_date: string;
  end_date: string;
  plan_name: string | null;
  plan_kind: string | null;
  sessions_total: number | null;
  sessions_used: number | null;
}

function pickActiveSub(db: Db, memberId: string, today: string): OverviewSubRow | null {
  const candidates = db.all<OverviewSubRow>(
    `SELECT s.id, s.start_date, s.end_date, p.name AS plan_name, p.kind AS plan_kind,
            s.sessions_total, s.sessions_used
       FROM member_subscriptions s
       JOIN membership_plans p ON p.id = s.plan_id
      WHERE s.member_id = ? AND s.status = 'active' AND s.start_date <= ? AND s.end_date >= ?
      ORDER BY (CASE WHEN p.kind = 'sessions' THEN 0 ELSE 1 END), s.end_date DESC`,
    [memberId, today, today],
  );
  for (const row of candidates) {
    if ((row.plan_kind ?? "time") === "sessions") {
      const remaining = Number(row.sessions_total ?? 0) - Number(row.sessions_used ?? 0);
      if (remaining > 0) return row;
      continue;
    }
    return row;
  }
  return candidates[0] ?? null;
}

export function getMemberOverview(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): MemberOverview {
  requirePermission(actor, "members.view");
  const member = db.first<{ id: string; deleted_at: string | null }>(
    "SELECT id, deleted_at FROM members WHERE id = ?",
    [memberId],
  );
  if (!member || member.deleted_at) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));

  const today = todayKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const sub = pickActiveSub(db, memberId, today);

  const last = db.first<{ last_at: string | null }>(
    "SELECT MAX(checkin_at) AS last_at FROM attendance WHERE member_id = ? AND deleted_at IS NULL",
    [memberId],
  );
  const visitsThisMonth = db.count(
    "SELECT COUNT(*) FROM attendance WHERE member_id = ? AND deleted_at IS NULL AND checkin_at >= ?",
    [memberId, `${monthStart} 00:00:00`],
  );

  return {
    activeSubscription: sub
      ? {
          id: String(sub.id),
          planName: sub.plan_name == null ? null : String(sub.plan_name),
          kind: (sub.plan_kind ?? "time") as SubscriptionKind,
          startDate: String(sub.start_date),
          endDate: String(sub.end_date),
          sessionsTotal: sub.sessions_total == null ? null : Number(sub.sessions_total),
          sessionsUsed: Number(sub.sessions_used ?? 0),
        }
      : null,
    nextSubDaysLeft: sub ? diffDaysKeys(today, String(sub.end_date)) + 1 : null,
    lastAttendanceAt: last?.last_at ?? null,
    visitsThisMonth: Number(visitsThisMonth),
  };
}

export interface MemberAuditQuery {
  page?: number;
  pageSize?: number;
}

export function listAuditForMember(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  query: MemberAuditQuery = {},
): { items: AuditLogItem[]; total: number } {
  requirePermission(actor, "audit.view");
  const member = db.first<{ id: string; deleted_at: string | null }>(
    "SELECT id, deleted_at FROM members WHERE id = ?",
    [memberId],
  );
  if (!member || member.deleted_at) throw errNotFound("errors.memberNotFound");
  assertDepartmentAccess(actor, memberDepartmentById(db, memberId));

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const total = db.count(
    `SELECT COUNT(*) FROM audit_logs
      WHERE (entity_type = 'member' AND entity_id = ?)
         OR (entity_type = 'subscription' AND entity_id IN (SELECT id FROM member_subscriptions WHERE member_id = ?))
         OR (entity_type = 'payment' AND entity_id IN (SELECT id FROM payments WHERE member_id = ?))
         OR (entity_type = 'training_plan' AND entity_id IN (SELECT id FROM training_plans WHERE member_id = ?))
         OR (entity_type = 'assessment' AND entity_id IN (SELECT id FROM body_assessments WHERE member_id = ?))`,
    [memberId, memberId, memberId, memberId, memberId],
  );

  const rows = db.all<Row>(
    `SELECT * FROM audit_logs
      WHERE (entity_type = 'member' AND entity_id = ?)
         OR (entity_type = 'subscription' AND entity_id IN (SELECT id FROM member_subscriptions WHERE member_id = ?))
         OR (entity_type = 'payment' AND entity_id IN (SELECT id FROM payments WHERE member_id = ?))
         OR (entity_type = 'training_plan' AND entity_id IN (SELECT id FROM training_plans WHERE member_id = ?))
         OR (entity_type = 'assessment' AND entity_id IN (SELECT id FROM body_assessments WHERE member_id = ?))
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    [memberId, memberId, memberId, memberId, memberId, pageSize, offset],
  );
  return { items: rows.map((r) => toAuditItem(r as never)), total };
}
