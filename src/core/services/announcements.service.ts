import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";

export interface AnnouncementInput {
  title: string;
  content: string;
  level?: "info" | "success" | "warning" | "danger";
}

export interface AnnouncementRow extends Row {
  id: string;
  title: string;
  content: string;
  level: "info" | "success" | "warning" | "danger";
  is_active: number;
  created_by: string | null;
  created_at: string;
  creator_name: string | null;
}

export function createAnnouncement(
  db: Db,
  actor: ServiceActor,
  input: AnnouncementInput,
): AnnouncementRow {
  requirePermission(actor, "announcements.manage");

  if (!input.title || input.title.trim().length < 2) {
    throw errValidation("errors.announcements.titleRequired");
  }
  if (!input.content || input.content.trim().length < 2) {
    throw errValidation("errors.announcements.contentRequired");
  }

  const id = randomUUID();
  const stamp = nowStamp();
  const level = input.level || "info";

  db.run(
    `INSERT INTO gym_announcements (
      id, title, content, level, is_active, created_by, created_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [id, input.title.trim(), input.content.trim(), level, actor.userId, stamp],
  );

  recordAudit(db, actor, "ANNOUNCEMENT_CREATED", "announcement", id, {
    title: input.title,
  });

  return getAnnouncementById(db, id)!;
}

export function updateAnnouncement(
  db: Db,
  actor: ServiceActor,
  id: string,
  input: Partial<AnnouncementInput> & { isActive?: boolean },
): AnnouncementRow {
  requirePermission(actor, "announcements.manage");

  const existing = getAnnouncementById(db, id);
  if (!existing) throw errNotFound("errors.announcements.notFound");

  const title = input.title !== undefined ? input.title.trim() : existing.title;
  const content = input.content !== undefined ? input.content.trim() : existing.content;
  const level = input.level !== undefined ? input.level : existing.level;
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;

  if (title.length < 2) throw errValidation("errors.announcements.titleRequired");
  if (content.length < 2) throw errValidation("errors.announcements.contentRequired");

  db.run(
    `UPDATE gym_announcements 
     SET title = ?, content = ?, level = ?, is_active = ?
     WHERE id = ?`,
    [title, content, level, isActive, id],
  );

  recordAudit(db, actor, "ANNOUNCEMENT_UPDATED", "announcement", id, {
    title,
  });

  return getAnnouncementById(db, id)!;
}

export function deleteAnnouncement(
  db: Db,
  actor: ServiceActor,
  id: string,
): { success: boolean } {
  requirePermission(actor, "announcements.manage");

  const existing = getAnnouncementById(db, id);
  if (!existing) throw errNotFound("errors.announcements.notFound");

  db.run("DELETE FROM gym_announcements WHERE id = ?", [id]);

  recordAudit(db, actor, "ANNOUNCEMENT_DELETED", "announcement", id, {
    title: existing.title,
  });

  return { success: true };
}

export function getAnnouncementById(
  db: Db,
  id: string,
): AnnouncementRow | null {
  return db.first<AnnouncementRow>(
    `SELECT a.*, u.full_name AS creator_name
     FROM gym_announcements a
     LEFT JOIN users u ON a.created_by = u.id
     WHERE a.id = ?`,
    [id],
  );
}

export function listActiveAnnouncements(db: Db): AnnouncementRow[] {
  return db.all<AnnouncementRow>(
    `SELECT a.*, u.full_name AS creator_name
     FROM gym_announcements a
     LEFT JOIN users u ON a.created_by = u.id
     WHERE a.is_active = 1
     ORDER BY a.created_at DESC`,
  );
}

export function listAllAnnouncements(
  db: Db,
  actor: ServiceActor,
): AnnouncementRow[] {
  requirePermission(actor, "announcements.view");
  return db.all<AnnouncementRow>(
    `SELECT a.*, u.full_name AS creator_name
     FROM gym_announcements a
     LEFT JOIN users u ON a.created_by = u.id
     ORDER BY a.created_at DESC`,
  );
}
