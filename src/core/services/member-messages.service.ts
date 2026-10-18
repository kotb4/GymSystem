import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row, SqlValue } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";
import { readSetting, SETTING_KEYS } from "./settings.service";
import { whatsappTransport } from "./card-delivery.service";

export interface MemberConversationItem {
  member_id: string;
  member_name: string;
  member_phone: string;
  member_code: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender: "gym" | "member" | null;
  total_messages: number;
}

export interface MemberMessageRow extends Row {
  id: string;
  member_id: string;
  sender_type: "gym" | "member";
  sender_user_id: string | null;
  sender_user_name: string | null;
  message: string;
  channel: "whatsapp" | "internal";
  status: "sent" | "delivered" | "read" | "failed";
  created_at: string;
}

export function listMemberConversations(
  db: Db,
  actor: ServiceActor,
  search?: string
): MemberConversationItem[] {
  requirePermission(actor, "messages.view");

  let sql = `
    SELECT
      m.id AS member_id,
      m.full_name AS member_name,
      m.phone AS member_phone,
      m.member_code AS member_code,
      (SELECT msg.message FROM member_direct_messages msg WHERE msg.member_id = m.id ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
      (SELECT msg.created_at FROM member_direct_messages msg WHERE msg.member_id = m.id ORDER BY msg.created_at DESC LIMIT 1) AS last_message_at,
      (SELECT msg.sender_type FROM member_direct_messages msg WHERE msg.member_id = m.id ORDER BY msg.created_at DESC LIMIT 1) AS last_sender,
      (SELECT COUNT(*) FROM member_direct_messages msg WHERE msg.member_id = m.id) AS total_messages
    FROM members m
    WHERE m.deleted_at IS NULL
  `;
  const params: SqlValue[] = [];

  if (search && search.trim()) {
    sql += " AND (m.full_name LIKE ? OR m.phone LIKE ? OR m.member_code LIKE ?)";
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  sql += `
    ORDER BY
      CASE WHEN last_message_at IS NOT NULL THEN 1 ELSE 2 END ASC,
      last_message_at DESC,
      m.created_at DESC
    LIMIT 100
  `;

  return db.all<MemberConversationItem>(sql, params);
}

export function getMemberMessages(
  db: Db,
  actor: ServiceActor,
  memberId: string
): MemberMessageRow[] {
  requirePermission(actor, "messages.view");

  return db.all<MemberMessageRow>(
    `SELECT mm.*,
       u.full_name AS sender_user_name
     FROM member_direct_messages mm
     LEFT JOIN users u ON mm.sender_user_id = u.id
     WHERE mm.member_id = ?
     ORDER BY mm.created_at ASC`,
    [memberId]
  );
}

export async function sendMemberMessage(
  db: Db,
  actor: ServiceActor,
  input: {
    memberId: string;
    message: string;
    channel?: "whatsapp" | "internal";
  }
): Promise<MemberMessageRow> {
  requirePermission(actor, "messages.send");

  if (!input.memberId) throw errValidation("errors.members.memberRequired");
  if (!input.message || input.message.trim().length === 0) {
    throw errValidation("errors.messages.messageRequired");
  }

  const member = db.first<{ id: string; full_name: string; phone: string }>(
    "SELECT id, full_name, phone FROM members WHERE id = ? AND deleted_at IS NULL",
    [input.memberId]
  );
  if (!member) throw errNotFound("errors.members.notFound");

  const id = randomUUID();
  const stamp = nowStamp();
  const channel = input.channel || "whatsapp";
  let status: "sent" | "failed" = "sent";

  if (channel === "whatsapp" && member.phone) {
    const apiUrl = (readSetting(db, SETTING_KEYS.whatsappApiUrl) || "").trim() || "http://127.0.0.1:8891";
    const transport = whatsappTransport(apiUrl);
    const result = await transport(member.phone, input.message.trim());
    if (!result.ok) {
      status = "failed";
    }
  }

  db.run(
    `INSERT INTO member_direct_messages (id, member_id, sender_type, sender_user_id, message, channel, status, created_at)
     VALUES (?, ?, 'gym', ?, ?, ?, ?, ?)`,
    [id, input.memberId, actor.userId, input.message.trim(), channel, status, stamp]
  );

  recordAudit(db, actor, "MEMBER_MESSAGE_SENT", "member_message", id, {
    member_id: input.memberId,
    channel,
    status,
  });

  return db.first<MemberMessageRow>(
    `SELECT mm.*, u.full_name AS sender_user_name
     FROM member_direct_messages mm
     LEFT JOIN users u ON mm.sender_user_id = u.id
     WHERE mm.id = ?`,
    [id]
  )!;
}
