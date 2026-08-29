import { todayKey } from "@/core/dates";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import {
  findActiveSubscription,
  memberOutstandingMinor,
  recordCheckIn,
  type CheckInDenialReason,
  type CheckInResult,
} from "./attendance.service";
import { assignCardByBarcode, getCardByBarcode, type CardRow, type CardStatus } from "./cards.service";
import {
  getMemberRowById,
  searchMembersForPicker,
  toPublicMember,
  type MemberRow,
  type PublicMember,
} from "./members.service";
import { activeTrialForMember } from "./trials.service";

/**
 * Reception desk lookup + check-in.
 *
 * This module is a thin read/eligibility layer. It NEVER re-implements the
 * allow/reject attendance rules — eligibility for display reuses
 * `findActiveSubscription`/`memberOutstandingMinor` from attendance.service,
 * and the actual check-in is delegated to `recordCheckIn` (single source of
 * truth, including the duplicate window and session consumption).
 */

export type ReceptionEligibilityReason =
  | "VALID"
  | CheckInDenialReason
  | "FROZEN";

export interface ReceptionEligibility {
  eligible: boolean;
  reason: ReceptionEligibilityReason;
  planName: string | null;
  subscriptionEndsAt: string | null;
  sessionsRemaining: number | null;
  outstandingMinor: number;
  /** Most recent check-in timestamp (for showing duplicate risk). */
  lastCheckInAt: string | null;
}

export interface ReceptionLookup {
  source: "barcode" | "member";
  barcode: string | null;
  cardStatus: CardStatus | null;
  member: PublicMember | null;
  eligibility: ReceptionEligibility | null;
}

export interface ReceptionSearchResult {
  member: PublicMember;
  eligibility: ReceptionEligibility;
}

interface FrozenSubRow extends Row {
  id: string;
}

/** Display-only eligibility for one member. Reuses shared attendance helpers. */
function resolveEligibility(db: Db, member: MemberRow, today: string): ReceptionEligibility {
  const lastRaw = db.scalar(
    "SELECT MAX(checkin_at) FROM attendance WHERE deleted_at IS NULL AND member_id = ?",
    [member.id],
  );
  const base = (partial: Partial<ReceptionEligibility>): ReceptionEligibility => ({
    eligible: false,
    reason: "NO_ACTIVE_SUBSCRIPTION",
    planName: null,
    subscriptionEndsAt: null,
    sessionsRemaining: null,
    outstandingMinor: memberOutstandingMinor(db, member.id),
    lastCheckInAt: typeof lastRaw === "string" ? lastRaw : null,
    ...partial,
  });

  if (member.deleted_at) return base({ reason: "MEMBER_DELETED" });
  if (member.status !== "active") return base({ reason: "MEMBER_INACTIVE" });

  const sub = findActiveSubscription(db, member.id, today);
  if (!sub) {
    const frozen = db.first<FrozenSubRow>(
      "SELECT id FROM member_subscriptions WHERE member_id = ? AND status = 'suspended' AND start_date <= ? AND end_date >= ? LIMIT 1",
      [member.id, today, today],
    );
    if (frozen) return base({ reason: "FROZEN" });
    const trial = activeTrialForMember(db, member.id, today);
    if (trial) {
      return base({
        eligible: true,
        reason: "VALID",
        planName: `trial:${trial.trialType}`,
        subscriptionEndsAt: trial.endDate,
      });
    }
    return base({ reason: "NO_ACTIVE_SUBSCRIPTION" });
  }

  const planKind = (sub.plan_kind ?? "time") as "time" | "sessions" | "open";
  const sessionsTotal = sub.sessions_total == null ? null : Number(sub.sessions_total);
  const sessionsRemaining =
    sessionsTotal == null ? null : Math.max(0, sessionsTotal - Number(sub.sessions_used ?? 0));
  if (planKind === "sessions" && sessionsTotal != null && (sessionsRemaining ?? 0) <= 0) {
    return base({
      reason: "NO_SESSIONS_LEFT",
      planName: sub.plan_name,
      subscriptionEndsAt: sub.end_date,
      sessionsRemaining,
    });
  }

  return base({
    eligible: true,
    reason: "VALID",
    planName: sub.plan_name,
    subscriptionEndsAt: sub.end_date,
    sessionsRemaining: planKind === "sessions" ? sessionsRemaining : null,
  });
}

function memberLookup(
  db: Db,
  member: MemberRow,
  source: "barcode" | "member",
  barcode: string | null,
  cardStatus: CardStatus | null,
): ReceptionLookup {
  return {
    source,
    barcode,
    cardStatus,
    member: toPublicMember(member),
    eligibility: resolveEligibility(db, member, todayKey()),
  };
}

function toPublicMemberOrNull(db: Db, memberId: string): PublicMember | null {
  const row = getMemberRowById(db, memberId);
  return row ? toPublicMember(row) : null;
}

/** Search members by name / phone / member-code — returns eligibility for each. */
export function search(
  db: Db,
  actor: ServiceActor,
  term: string,
  limit = 10,
): ReceptionSearchResult[] {
  requirePermission(actor, "reception.view");
  const today = todayKey();
  return searchMembersForPicker(db, actor, term, limit).map((m) => {
    const row = getMemberRowById(db, m.id)!;
    return {
      member: toPublicMember(row),
      eligibility: resolveEligibility(db, row, today),
    };
  });
}

/**
 * Resolve a single input (scanned barcode OR member-code) to a member and its
 * live eligibility, WITHOUT recording attendance. Unknown barcode with no
 * matching member-code returns a no-member lookup (CARD_UNKNOWN).
 */
export function lookup(
  db: Db,
  actor: ServiceActor,
  input: { barcode?: string; memberId?: string },
): ReceptionLookup {
  requirePermission(actor, "reception.view");

  if (input.memberId) {
    const member = getMemberRowById(db, input.memberId);
    if (!member) {
      return {
        source: "member",
        barcode: null,
        cardStatus: null,
        member: null,
        eligibility: null,
      };
    }
    return memberLookup(db, member, "member", null, null);
  }

  const barcode = (input.barcode ?? "").trim().toUpperCase();
  if (barcode === "") {
    return {
      source: "barcode",
      barcode: null,
      cardStatus: null,
      member: null,
      eligibility: null,
    };
  }

  const card = getCardByBarcode(db, barcode);
  if (card) {
    if (card.status === "lost") {
      return {
        source: "barcode",
        barcode: card.barcode_value,
        cardStatus: "lost",
        member: card.member_id ? toPublicMemberOrNull(db, card.member_id) : null,
        eligibility: {
          eligible: false,
          reason: "CARD_LOST",
          planName: null,
          subscriptionEndsAt: null,
          sessionsRemaining: null,
          outstandingMinor: 0,
          lastCheckInAt: null,
        },
      };
    }
    if (card.status === "blocked") {
      return {
        source: "barcode",
        barcode: card.barcode_value,
        cardStatus: "blocked",
        member: card.member_id ? toPublicMemberOrNull(db, card.member_id) : null,
        eligibility: {
          eligible: false,
          reason: "CARD_BLOCKED",
          planName: null,
          subscriptionEndsAt: null,
          sessionsRemaining: null,
          outstandingMinor: 0,
          lastCheckInAt: null,
        },
      };
    }
    if (!card.member_id) {
      return {
        source: "barcode",
        barcode: card.barcode_value,
        cardStatus: card.status,
        member: null,
        eligibility: {
          eligible: false,
          reason: "CARD_NOT_LINKED",
          planName: null,
          subscriptionEndsAt: null,
          sessionsRemaining: null,
          outstandingMinor: 0,
          lastCheckInAt: null,
        },
      };
    }
    const member = getMemberRowById(db, card.member_id);
    if (!member) {
      return {
        source: "barcode",
        barcode: card.barcode_value,
        cardStatus: card.status,
        member: null,
        eligibility: {
          eligible: false,
          reason: "MEMBER_DELETED",
          planName: null,
          subscriptionEndsAt: null,
          sessionsRemaining: null,
          outstandingMinor: 0,
          lastCheckInAt: null,
        },
      };
    }
    return memberLookup(db, member, "barcode", card.barcode_value, card.status);
  }

  // Not a known card: fall back to member-code lookup
  const byCode = db.first<MemberRow>("SELECT * FROM members WHERE member_code = ?", [barcode]);
  if (byCode) return memberLookup(db, byCode, "member", null, null);

  return {
    source: "barcode",
    barcode,
    cardStatus: null,
    member: null,
    eligibility: {
      eligible: false,
      reason: "CARD_UNKNOWN",
      planName: null,
      subscriptionEndsAt: null,
      sessionsRemaining: null,
      outstandingMinor: 0,
      lastCheckInAt: null,
    },
  };
}

/**
 * Record attendance for a member resolved from the desk. If a barcode was
 * provided use it directly (delegates to `recordCheckIn`). Otherwise pick the
 * member's assigned card — auto-registering+assigning one from the member code
 * when none exists — then delegate so duplicate/session rules stay intact.
 */
export async function checkIn(
  db: Db,
  actor: ServiceActor,
  input: { barcode?: string; memberId?: string; deviceIdentifier?: string },
): Promise<CheckInResult> {
  requirePermission(actor, "reception.view");

  let barcode = (input.barcode ?? "").trim().toUpperCase();
  if (barcode !== "") {
    return recordCheckIn(db, actor, { barcode, deviceIdentifier: input.deviceIdentifier });
  }

  const memberId = input.memberId;
  if (!memberId) {
    return { kind: "denied", reason: "CARD_UNKNOWN", barcode: "" };
  }
  const member = getMemberRowById(db, memberId);
  if (!member) {
    return { kind: "denied", reason: "MEMBER_DELETED", barcode: "", memberName: undefined };
  }

  const hasCard = Number(
    db.scalar("SELECT COUNT(*) FROM cards WHERE member_id = ? AND status = 'assigned'", [memberId]) ?? 0,
  );
  if (hasCard > 0) {
    const card = db.first<CardRow>(
      "SELECT * FROM cards WHERE member_id = ? AND status = 'assigned' ORDER BY assigned_at DESC LIMIT 1",
      [memberId],
    );
    if (card) {
      return recordCheckIn(db, actor, {
        barcode: card.barcode_value,
        deviceIdentifier: input.deviceIdentifier,
      });
    }
  }

  // No card — auto-register + assign one keyed by member code so the desk can
  // check the member in immediately; the member code satisfies the barcode
  // format and stays unique per member.
  const autoBarcode = member.member_code;
  await assignCardByBarcode(db, actor, { barcodeValue: autoBarcode, memberId: member.id });
  return recordCheckIn(db, actor, {
    barcode: autoBarcode,
    deviceIdentifier: input.deviceIdentifier,
  });
}
