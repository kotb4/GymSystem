import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { AUDIT_ACTIONS, type AuditAction } from "@/core/audit-actions";
import { requirePermission, type ServiceActor } from "@/core/permissions";

export { AUDIT_ACTIONS };
export type { AuditAction };

export interface AuditActorRef {
  userId?: string | null;
  username: string;
}

export interface AuditLogItem {
  id: number;
  userId: string | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRow extends Row {
  id: number;
  user_id: string | null;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  created_at: string;
}

function toAuditItem(row: AuditLogRow): AuditLogItem {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: Number(row.id),
    userId: row.user_id,
    userName: row.user_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata,
    createdAt: row.created_at,
  };
}

export function recordAudit(
  db: Db,
  actor: AuditActorRef,
  action: AuditAction,
  entityType: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
): number {
  return db.insert(
    "INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, metadata, created_at)\nVALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      actor.userId ?? null,
      actor.username,
      action,
      entityType,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      nowStamp(),
    ],
  );
}

export interface AuditListQuery {
  page?: number;
  pageSize?: number;
  action?: AuditAction;
}

export function listAuditLogs(
  db: Db,
  actor: ServiceActor,
  query: AuditListQuery = {},
): { items: AuditLogItem[]; total: number } {
  requirePermission(actor, "audit.view");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where = query.action ? "WHERE action = ?" : "";
  const params: Array<string> = query.action ? [query.action] : [];
  const total = db.count(`SELECT COUNT(*) FROM audit_logs ${where}`, params);
  const rows = db.all<AuditLogRow>(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(toAuditItem), total };
}
