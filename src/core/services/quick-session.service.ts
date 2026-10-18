import { errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, SqlValue } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { randomUUID } from "node:crypto";
import { getLocalBranchId, getLocalBranchPrefix } from "@/core/branch";
import { formatMemberCode } from "@/core/services/members.service";

export interface QuickSessionInput {
  clientType: "member" | "guest";
  memberId?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestGender?: "male" | "female" | null;
  sessionName: string;
  priceMinor: number;
  paidAmountMinor: number;
  methodCode: string;
  trainerId?: string | null;
  sessionDate?: string | null;
  sessionTime?: string | null;
  recordAttendance?: boolean;
  notes?: string | null;
  autoCreateLead?: boolean;
  invitationMemberId?: string | null;
}

export interface QuickSessionRow {
  id: string;
  client_type: "member" | "guest";
  member_id: string | null;
  lead_id?: string | null;
  invitation_member_id?: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_gender: "male" | "female" | null;
  session_name: string;
  price_minor: number;
  paid_amount_minor: number;
  method_code: string;
  trainer_id: string | null;
  session_date: string;
  session_time: string;
  attendance_recorded: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  member_name?: string | null;
  member_code?: string | null;
  trainer_name?: string | null;
  creator_name?: string | null;
  lead_name?: string | null;
  invitation_member_name?: string | null;
  invitation_member_code?: string | null;
}

export function createQuickSession(
  db: Db,
  actor: ServiceActor,
  input: QuickSessionInput,
): QuickSessionRow {
  requirePermission(actor, "quick_sessions.create");

  if (!input.sessionName || input.sessionName.trim().length === 0) {
    throw errValidation("errors.quickSession.nameRequired");
  }
  if (input.priceMinor < 0) {
    throw errValidation("errors.quickSession.priceInvalid");
  }
  if (input.paidAmountMinor < 0 || input.paidAmountMinor > input.priceMinor) {
    throw errValidation("errors.quickSession.paidInvalid");
  }
  if (!input.methodCode) {
    throw errValidation("errors.quickSession.methodRequired");
  }

  let finalMemberId: string | null = null;
  let finalGuestName: string | null = null;

  if (input.clientType === "member") {
    if (!input.memberId) {
      throw errValidation("errors.quickSession.memberRequired");
    }
    const member = db.first<{ id: string; full_name: string }>(
      "SELECT id, full_name FROM members WHERE id = ? AND deleted_at IS NULL",
      [input.memberId],
    );
    if (!member) {
      throw errNotFound("errors.memberNotFound");
    }
    finalMemberId = member.id;
  } else {
    if (!input.guestName || input.guestName.trim().length < 2) {
      throw errValidation("errors.quickSession.guestNameRequired");
    }
    finalGuestName = input.guestName.trim();
  }

  const id = randomUUID();
  const sessionDate = input.sessionDate || todayKey();
  const now = new Date();
  const sessionTime =
    input.sessionTime ||
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const stamp = nowStamp();
  const attendanceRecorded = input.recordAttendance ? 1 : 0;
  const shouldCreateLead = input.clientType === "guest" && input.autoCreateLead !== false;
  let leadId: string | null = null;

  return db.transaction(() => {
    // 1. Handle Guest Invitation deduction from host member
    let hostMember: { id: string; full_name: string; member_code: string; department: string } | null = null;
    if (input.invitationMemberId) {
      hostMember = db.first<{ id: string; full_name: string; member_code: string; department: string }>(
        "SELECT id, full_name, member_code, department FROM members WHERE id = ? AND deleted_at IS NULL",
        [input.invitationMemberId],
      );
      if (!hostMember) throw errNotFound("errors.memberNotFound");

      const sub = db.first<{ id: string; invitations_total: number; invitations_used: number }>(
        "SELECT id, invitations_total, invitations_used FROM member_subscriptions WHERE member_id = ? AND status = 'active' ORDER BY end_date DESC LIMIT 1",
        [hostMember.id],
      );
      if (!sub) {
        throw errValidation("errors.noInvitationsRemaining");
      }

      const totalInv = Math.max(0, Number(sub.invitations_total ?? 0));
      const usedInv = Math.max(0, Number(sub.invitations_used ?? 0));
      if (usedInv >= totalInv) {
        throw errValidation("errors.noInvitationsRemaining", { total: totalInv, used: usedInv });
      }

      // Deduct 1 invitation from host member's subscription
      db.run(
        "UPDATE member_subscriptions SET invitations_used = invitations_used + 1, updated_at = ? WHERE id = ?",
        [stamp, sub.id],
      );

      // Record in guest_invitations
      db.run(
        `INSERT INTO guest_invitations (
          id, subscription_id, member_id, guest_name, guest_phone, notes,
          created_by, created_at, branch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          sub.id,
          hostMember.id,
          finalGuestName,
          input.guestPhone?.trim() || null,
          input.notes?.trim() || null,
          actor.userId,
          stamp,
          getLocalBranchId(db),
        ],
      );

      recordAudit(db, actor, "GUEST_INVITATION_USED", "subscription", sub.id, {
        guestName: finalGuestName,
        guestPhone: input.guestPhone?.trim() || null,
        memberCode: hostMember.member_code,
        remaining: totalInv - (usedInv + 1),
      });
    }

    // 2. Resolve or auto-create guest member record for Day Pass attendance & history tracking
    if (input.clientType === "guest" && finalGuestName) {
      const cleanPhone = input.guestPhone?.trim() || null;
      if (cleanPhone) {
        const existingMember = db.first<{ id: string }>(
          "SELECT id FROM members WHERE phone = ? AND deleted_at IS NULL LIMIT 1",
          [cleanPhone],
        );
        if (existingMember) {
          finalMemberId = existingMember.id;
        }
      }

      if (!finalMemberId) {
        const guestMemberId = randomUUID();
        const branchPrefix = getLocalBranchPrefix(db);
        const branchId = getLocalBranchId(db);
        db.run("UPDATE counters SET value = value + 1 WHERE name = 'member_code'");
        const codeValue = Number(db.scalar("SELECT value FROM counters WHERE name = 'member_code'"));
        const memberCode = formatMemberCode(codeValue, branchPrefix);
        const dept = input.guestGender === "female" ? "women" : input.guestGender === "male" ? "men" : "general";

        db.run(
          `INSERT INTO members (
            id, member_code, full_name, phone, gender, department,
            registration_date, status, notes, created_by, created_at, updated_at, branch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          [
            guestMemberId,
            memberCode,
            finalGuestName,
            cleanPhone,
            input.guestGender || null,
            dept,
            sessionDate,
            hostMember ? `ضيف دعوة من: ${hostMember.full_name} (${hostMember.member_code})` : "تذكرة تمرين يوم واحد (Day Pass)",
            actor.userId,
            stamp,
            stamp,
            branchId,
          ],
        );

        const cardBarcode = `${branchPrefix}-CRD-${String(codeValue).padStart(6, "0")}`;
        db.run(
          `INSERT INTO cards (id, barcode_value, status, kind, member_id, notes, assigned_at, created_at, updated_at)
           VALUES (?, ?, 'assigned', 'virtual', ?, ?, ?, ?, ?)`,
          [randomUUID(), cardBarcode, guestMemberId, "تذكرة يومية (Day Pass)", stamp, stamp, stamp],
        );

        finalMemberId = guestMemberId;
      }
    }

    // 2. Auto-create or link Lead in CRM for guest Day Pass
    if (shouldCreateLead && finalGuestName) {
      const cleanPhone = input.guestPhone?.trim() || null;
      let existingLead: { id: string; status: string } | null = null;
      if (cleanPhone) {
        existingLead = db.first<{ id: string; status: string }>(
          "SELECT id, status FROM leads WHERE phone = ? LIMIT 1",
          [cleanPhone],
        );
      }

      if (existingLead) {
        leadId = existingLead.id;
        const actNote = hostMember
          ? `حضور بتذكرة دعوة من العضو: ${hostMember.full_name} (${hostMember.member_code})`
          : `حضور تذكرة تمرين يوم واحد (${input.sessionName.trim()}) - المبلغ: ${Math.round(input.paidAmountMinor / 100)} ج.م`;

        db.run(
          "INSERT INTO lead_activity (id, lead_id, action, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            randomUUID(),
            leadId,
            hostMember ? "day_pass_invitation" : "day_pass",
            actNote,
            actor.userId,
            stamp,
          ],
        );
        if (existingLead.status === "lost") {
          db.run("UPDATE leads SET status = 'interested', updated_at = ? WHERE id = ?", [stamp, leadId]);
        } else {
          db.run("UPDATE leads SET updated_at = ? WHERE id = ?", [stamp, leadId]);
        }
      } else {
        leadId = randomUUID();
        const department =
          input.guestGender === "female" ? "women" : input.guestGender === "male" ? "men" : "general";
        const leadNotes = hostMember
          ? `تذكرة دعوة ضيف من العضو: ${hostMember.full_name} (${hostMember.member_code})${
              input.notes?.trim() ? " - " + input.notes.trim() : ""
            }`
          : `تذكرة تمرين يوم واحد (Day Pass) - ${input.sessionName.trim()}${
              input.notes?.trim() ? " - " + input.notes.trim() : ""
            }`;
        const leadSource = hostMember ? "referral" : "walk_in";

        db.run(
          `INSERT INTO leads (
            id, full_name, phone, email, source, interested_plan_id,
            department, assigned_employee_id, assigned_user_id, status,
            notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, ?, 'new', ?, ?, ?, ?)`,
          [
            leadId,
            finalGuestName,
            cleanPhone,
            leadSource,
            department,
            actor.userId,
            leadNotes,
            actor.userId,
            stamp,
            stamp,
          ],
        );
        db.run(
          "INSERT INTO lead_activity (id, lead_id, action, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            randomUUID(),
            leadId,
            hostMember ? "day_pass_invitation" : "day_pass",
            hostMember
              ? `حضور بتذكرة دعوة من العضو: ${hostMember.full_name} (${hostMember.member_code})`
              : `قطع تذكرة تمرين يوم واحد (${input.sessionName.trim()}) بقيمة ${Math.round(input.paidAmountMinor / 100)} ج.م`,
            actor.userId,
            stamp,
          ],
        );
        recordAudit(db, actor, "LEAD_CREATED", "lead", leadId, {
          name: finalGuestName,
          source: leadSource,
          via: hostMember ? "invitation" : "quick_session",
        });
      }
    }

    db.run(
      `INSERT INTO quick_sessions (
        id, client_type, member_id, lead_id, invitation_member_id, guest_name, guest_phone, guest_gender,
        session_name, price_minor, paid_amount_minor, method_code,
        trainer_id, session_date, session_time, attendance_recorded,
        notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.clientType,
        finalMemberId,
        leadId,
        hostMember ? hostMember.id : null,
        finalGuestName,
        input.guestPhone?.trim() || null,
        input.guestGender || null,
        input.sessionName.trim(),
        input.priceMinor,
        input.paidAmountMinor,
        input.methodCode,
        input.trainerId || null,
        sessionDate,
        sessionTime,
        attendanceRecorded,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
      ],
    );

    // Ledger entry for cash flow
    if (input.paidAmountMinor > 0) {
      db.run(
        `INSERT INTO financial_ledger (
          entry_type, ref_table, ref_id, member_id, method_code, direction,
          amount_minor, occurred_at, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "payment",
          "quick_sessions",
          id,
          finalMemberId,
          input.methodCode,
          1,
          input.paidAmountMinor,
          sessionDate,
          actor.userId,
          stamp,
        ],
      );
    }

    // Record attendance if requested
    if (finalMemberId && attendanceRecorded) {
      const attId = randomUUID();
      const branchId = getLocalBranchId(db);
      db.run(
        `INSERT INTO attendance (
          id, member_id, checkin_at, created_by, notes, branch_id
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          attId,
          finalMemberId,
          `${sessionDate} ${sessionTime}:00`,
          actor.userId,
          `تذكرة تمرين: ${input.sessionName.trim()}`,
          branchId,
        ],
      );
    }

    recordAudit(
      db,
      actor,
      "QUICK_SESSION_CREATED",
      "quick_session",
      id,
      {
        clientType: input.clientType,
        sessionName: input.sessionName,
        paidMinor: input.paidAmountMinor,
        methodCode: input.methodCode,
        leadId,
        invitationMemberId: hostMember ? hostMember.id : null,
      },
    );

    return getQuickSessionById(db, actor, id)!;
  });
}

export function getQuickSessionById(
  db: Db,
  actor: ServiceActor,
  id: string,
): QuickSessionRow | null {
  requirePermission(actor, "quick_sessions.view");
  return db.first<QuickSessionRow>(
    `SELECT q.*, 
            m.full_name AS member_name, m.member_code,
            t.full_name AS trainer_name,
            u.full_name AS creator_name,
            l.full_name AS lead_name,
            inv_m.full_name AS invitation_member_name,
            inv_m.member_code AS invitation_member_code
     FROM quick_sessions q
     LEFT JOIN members m ON q.member_id = m.id
     LEFT JOIN trainers t ON q.trainer_id = t.id
     LEFT JOIN users u ON q.created_by = u.id
     LEFT JOIN leads l ON q.lead_id = l.id
     LEFT JOIN members inv_m ON q.invitation_member_id = inv_m.id
     WHERE q.id = ?`,
    [id],
  );
}

export function listQuickSessions(
  db: Db,
  actor: ServiceActor,
  filter?: {
    startDate?: string;
    endDate?: string;
    clientType?: string;
    leadId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): { items: QuickSessionRow[]; total: number } {
  requirePermission(actor, "quick_sessions.view");

  const conditions: string[] = ["1=1"];
  const params: SqlValue[] = [];

  if (filter?.startDate) {
    conditions.push("q.session_date >= ?");
    params.push(filter.startDate);
  }
  if (filter?.endDate) {
    conditions.push("q.session_date <= ?");
    params.push(filter.endDate);
  }
  if (filter?.clientType && filter.clientType !== "all") {
    conditions.push("q.client_type = ?");
    params.push(filter.clientType);
  }
  if (filter?.leadId) {
    conditions.push("q.lead_id = ?");
    params.push(filter.leadId);
  }
  if (filter?.search && filter.search.trim()) {
    conditions.push(
      "(q.session_name LIKE ? OR q.guest_name LIKE ? OR q.guest_phone LIKE ? OR m.full_name LIKE ? OR m.member_code LIKE ? OR inv_m.full_name LIKE ? OR inv_m.member_code LIKE ?)",
    );
    const q = `%${filter.search.trim()}%`;
    params.push(q, q, q, q, q, q, q);
  }

  const whereClause = conditions.join(" AND ");
  const total = db.count(
    `SELECT COUNT(*) FROM quick_sessions q
     LEFT JOIN members m ON q.member_id = m.id
     LEFT JOIN members inv_m ON q.invitation_member_id = inv_m.id
     WHERE ${whereClause}`,
    params,
  );

  const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);
  const offset = Math.max(filter?.offset || 0, 0);

  const items = db.all<QuickSessionRow>(
    `SELECT q.*, 
            m.full_name AS member_name, m.member_code,
            t.full_name AS trainer_name,
            u.full_name AS creator_name,
            l.full_name AS lead_name,
            inv_m.full_name AS invitation_member_name,
            inv_m.member_code AS invitation_member_code
     FROM quick_sessions q
     LEFT JOIN members m ON q.member_id = m.id
     LEFT JOIN trainers t ON q.trainer_id = t.id
     LEFT JOIN users u ON q.created_by = u.id
     LEFT JOIN leads l ON q.lead_id = l.id
     LEFT JOIN members inv_m ON q.invitation_member_id = inv_m.id
     WHERE ${whereClause}
     ORDER BY q.session_date DESC, q.session_time DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return { items, total };
}

export function getQuickSessionStats(
  db: Db,
  actor: ServiceActor,
  date?: string,
): {
  totalSessionsToday: number;
  totalRevenueTodayMinor: number;
  guestSessionsToday: number;
  memberSessionsToday: number;
} {
  requirePermission(actor, "quick_sessions.view");
  const targetDate = date || todayKey();

  const row = db.first<{
    total_count: number;
    total_rev: number;
    guest_count: number;
    member_count: number;
  }>(
    `SELECT COUNT(*) AS total_count,
            COALESCE(SUM(paid_amount_minor), 0) AS total_rev,
            COALESCE(SUM(CASE WHEN client_type = 'guest' THEN 1 ELSE 0 END), 0) AS guest_count,
            COALESCE(SUM(CASE WHEN client_type = 'member' THEN 1 ELSE 0 END), 0) AS member_count
     FROM quick_sessions
     WHERE session_date = ?`,
    [targetDate],
  );

  return {
    totalSessionsToday: Number(row?.total_count || 0),
    totalRevenueTodayMinor: Number(row?.total_rev || 0),
    guestSessionsToday: Number(row?.guest_count || 0),
    memberSessionsToday: Number(row?.member_count || 0),
  };
}
