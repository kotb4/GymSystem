import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import { recordAudit } from "./audit.service";
import { getMemberRowById } from "./members.service";
import { getSubscriptionRow } from "./subscriptions.service";
import { createLead } from "./lead.service";
import { getLocalBranchId } from "@/core/branch";

export interface GuestInvitationRow extends Row {
  id: string;
  subscription_id: string;
  member_id: string;
  guest_name: string;
  guest_phone: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  branch_id: string | null;
}

export interface GuestInvitation {
  id: string;
  subscriptionId: string;
  memberId: string;
  guestName: string;
  guestPhone: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  branchId: string | null;
}

export interface UseInvitationInput {
  subscriptionId: string;
  guestName: string;
  guestPhone?: string | null;
  notes?: string | null;
}

export interface MemberInvitationsSummary {
  subscriptionId: string;
  invitationsTotal: number;
  invitationsUsed: number;
  invitationsRemaining: number;
  history: GuestInvitation[];
}

export async function useGuestInvitation(
  db: Db,
  actor: ServiceActor,
  input: UseInvitationInput,
): Promise<GuestInvitation> {
  requirePermission(actor, "invitations.manage");

  const guestName = input.guestName.trim();
  if (!guestName) throw errValidation("errors.guestNameRequired");
  const guestPhone = input.guestPhone?.trim() || null;

  const sub = getSubscriptionRow(db, input.subscriptionId);
  if (!sub) throw errNotFound("errors.subscriptionNotFound");
  if (sub.status !== "active") throw errConflict("errors.subscriptionNotActive");

  const total = Math.max(0, Number(sub.invitations_total ?? 0));
  const used = Math.max(0, Number(sub.invitations_used ?? 0));
  if (used >= total) {
    throw errConflict("errors.noInvitationsRemaining", { total, used });
  }

  const member = getMemberRowById(db, sub.member_id);
  if (!member) throw errNotFound("errors.memberNotFound");

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const branchId = getLocalBranchId(db);

  await db.transaction(async () => {
    // 1. Increment invitations_used
    db.run(
      "UPDATE member_subscriptions SET invitations_used = invitations_used + 1, updated_at = ? WHERE id = ?",
      [stamp, sub.id],
    );

    // 2. Insert invitation record
    db.run(
      `INSERT INTO guest_invitations (id, subscription_id, member_id, guest_name, guest_phone, notes, created_by, created_at, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sub.id,
        member.id,
        guestName,
        guestPhone,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
        branchId,
      ],
    );

    // 3. Record audit
    recordAudit(db, actor, "GUEST_INVITATION_USED", "subscription", sub.id, {
      invitationId: id,
      guestName,
      guestPhone,
      memberCode: member.member_code,
      remaining: total - (used + 1),
    });

    // 4. Automatically create a Lead in CRM if guestPhone is provided
    if (guestPhone) {
      try {
        await createLead(db, actor, {
          fullName: guestName,
          phone: guestPhone,
          source: "referral",
          department: (member.department ?? "general") as "general" | "men" | "women",
          notes: `دعوة ضيف من العضو ${member.full_name} (${member.member_code})`,
        });
      } catch {
        // Silently skip if phone already exists in leads
      }
    }
  });

  return {
    id,
    subscriptionId: sub.id,
    memberId: member.id,
    guestName,
    guestPhone,
    notes: input.notes?.trim() || null,
    createdByName: actor.username,
    createdAt: stamp,
    branchId,
  };
}

export function listSubscriptionInvitations(
  db: Db,
  actor: ServiceActor,
  subscriptionId: string,
): GuestInvitation[] {
  requirePermission(actor, "subscriptions.view");
  const rows = db.all<GuestInvitationRow & { user_name: string | null }>(
    `SELECT gi.*, u.username as user_name
     FROM guest_invitations gi
     LEFT JOIN users u ON u.id = gi.created_by
     WHERE gi.subscription_id = ?
     ORDER BY gi.created_at DESC`,
    [subscriptionId],
  );

  return rows.map((r) => ({
    id: r.id,
    subscriptionId: r.subscription_id,
    memberId: r.member_id,
    guestName: r.guest_name,
    guestPhone: r.guest_phone,
    notes: r.notes,
    createdByName: r.user_name,
    createdAt: r.created_at,
    branchId: r.branch_id,
  }));
}

export function getMemberInvitationsSummary(
  db: Db,
  actor: ServiceActor,
  memberId: string,
): MemberInvitationsSummary | null {
  requirePermission(actor, "subscriptions.view");
  // Find currently active subscription for this member
  const sub = db.first<Row & { id: string; invitations_total: number; invitations_used: number }>(
    `SELECT id, invitations_total, invitations_used
     FROM member_subscriptions
     WHERE member_id = ? AND status = 'active'
     ORDER BY end_date DESC LIMIT 1`,
    [memberId],
  );

  if (!sub) return null;

  const total = Math.max(0, Number(sub.invitations_total ?? 0));
  const used = Math.max(0, Number(sub.invitations_used ?? 0));
  const history = listSubscriptionInvitations(db, actor, sub.id);

  return {
    subscriptionId: sub.id,
    invitationsTotal: total,
    invitationsUsed: used,
    invitationsRemaining: Math.max(0, total - used),
    history,
  };
}
