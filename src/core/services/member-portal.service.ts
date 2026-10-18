import os from "node:os";
import { createHmac } from "node:crypto";
import type { Db } from "@/db/engine";
import type { ServiceActor } from "@/core/permissions";
import { requireAnyPermission } from "@/core/permissions";
import { errNotFound, errForbidden } from "@/core/errors";
import { getLiveOccupancy } from "@/core/services/dashboard.service";
import { readSetting, SETTING_KEYS } from "@/core/services/settings.service";
import { todayKey } from "@/core/dates";

export interface MemberPortalProfile {
  member: {
    id: string;
    memberCode: string;
    fullName: string;
    phone: string | null;
    gender: string | null;
    photoFileId: string | null;
    status: string;
    department: string;
    joinedDate: string | null;
  };
  subscription: {
    planName: string;
    startDate: string;
    endDate: string;
    daysRemaining: number;
    sessionsTotal: number | null;
    sessionsRemaining: number | null;
    status: string;
    isFrozen: boolean;
  } | null;
  attendance: Array<{
    id: string;
    date: string;
    checkinTime: string;
    checkoutTime: string | null;
  }>;
  inbody: {
    latest: {
      date: string;
      weightKg: number | null;
      heightCm: number | null;
      bodyFatPercent: number | null;
      muscleMassKg: number | null;
      bmi: number | null;
    } | null;
  };
  totalDebtMinor: number;
  liveOccupancyNow: number;
  gymInfo: {
    name: string;
    phone: string;
    address: string;
  };
}

const PORTAL_SECRET_FALLBACK = "gymgate_member_portal_token_secret_2026";

function getPortalSecret(db: Db): string {
  const custom = readSetting(db, "sync_secret");
  return custom?.trim() || PORTAL_SECRET_FALLBACK;
}

export function createPortalToken(db: Db, memberId: string, memberCode: string): string {
  const timestamp = Date.now().toString(36);
  const secret = getPortalSecret(db);
  const raw = `${memberId}:${memberCode}:${timestamp}`;
  const sig = createHmac("sha256", secret).update(raw).digest("base64url").slice(0, 24);
  return `${memberId}.${memberCode}.${timestamp}.${sig}`;
}

export function verifyPortalToken(db: Db, token: string): { memberId: string; memberCode: string } {
  const parts = token.trim().split(".");
  if (parts.length !== 4) throw errForbidden("errors.portalInvalidToken");
  const [memberId, memberCode, timestamp, sig] = parts;
  const secret = getPortalSecret(db);
  const raw = `${memberId}:${memberCode}:${timestamp}`;
  const expectedSig = createHmac("sha256", secret).update(raw).digest("base64url").slice(0, 24);
  if (sig !== expectedSig) {
    throw errForbidden("errors.portalInvalidToken");
  }
  return { memberId, memberCode };
}

export function getLocalNetworkIp(): string | null {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const list = nets[name];
      if (!list) continue;
      for (const net of list) {
        if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254")) {
          return net.address;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Generates direct portal link for a member to view his profile & live occupancy.
 */
export function getMemberPortalUrl(
  db: Db,
  actor: ServiceActor,
  memberId: string,
  origin?: string,
): {
  url: string;
  token: string;
  memberCode: string;
  memberName: string;
  liveOccupancy: number;
  lanUrl: string;
  localUrl: string;
  tunnelUrl?: string;
} {
  requireAnyPermission(actor, ["members.view", "members.create", "cards.send", "messages.send"]);
  const member = db.first<{ id: string; member_code: string; full_name: string }>(
    "SELECT id, member_code, full_name FROM members WHERE id = ? AND deleted_at IS NULL",
    [memberId],
  );
  if (!member) throw errNotFound("errors.memberNotFound");

  const token = createPortalToken(db, member.id, member.member_code);
  const tokenParam = `token=${encodeURIComponent(token)}&code=${encodeURIComponent(member.member_code)}`;

  const savedTunnel = readSetting(db, SETTING_KEYS.tunnelUrl)?.trim() || "";
  const lanIp = getLocalNetworkIp();
  const port = process.env.GYMSYSTEM_PORT || "8890";

  const lanBase = lanIp ? `http://${lanIp}:${port}` : "";
  const isCustomOrigin = Boolean(
    origin &&
    origin.trim() !== "" &&
    !origin.includes("127.0.0.1") &&
    !origin.includes("localhost"),
  );
  const localBase = isCustomOrigin && origin ? origin : `http://127.0.0.1:${port}`;

  const tunnelLink = savedTunnel ? `${savedTunnel.replace(/\/$/, "")}/#/portal?${tokenParam}` : undefined;
  const lanLink = lanBase ? `${lanBase}/#/portal?${tokenParam}` : `${localBase}/#/portal?${tokenParam}`;
  const localLink = isCustomOrigin && origin
    ? `${origin.replace(/\/$/, "")}/#/portal?${tokenParam}`
    : `${localBase}/#/portal?${tokenParam}`;

  const chosenUrl = isCustomOrigin
    ? localLink
    : tunnelLink || (lanBase ? lanLink : localLink);

  const liveOccupancy = getLiveOccupancy(db);

  return {
    url: chosenUrl,
    token,
    memberCode: member.member_code,
    memberName: member.full_name,
    liveOccupancy,
    lanUrl: lanLink,
    localUrl: localLink,
    tunnelUrl: tunnelLink,
  };
}

/**
 * Public profile data lookup. Resolves member via token or member code or phone number.
 */
export function getMemberPortalProfile(
  db: Db,
  input: { token?: string; code?: string; phone?: string },
): MemberPortalProfile {
  const token = input.token?.trim();
  if (!token) {
    throw errForbidden("errors.portalTokenRequired");
  }

  const { memberId } = verifyPortalToken(db, token);

  const member = db.first<{
    id: string;
    member_code: string;
    full_name: string;
    phone: string | null;
    gender: string | null;
    photo_file_id: string | null;
    status: string;
    department: string;
    registration_date: string | null;
  }>(
    "SELECT id, member_code, full_name, phone, gender, photo_file_id, status, department, registration_date FROM members WHERE id = ? AND deleted_at IS NULL",
    [memberId],
  );

  if (!member) throw errNotFound("errors.memberNotFound");

  // Active subscription
  const today = todayKey();
  const sub = db.first<{
    id: string;
    plan_name: string;
    start_date: string;
    end_date: string;
    status: string;
    sessions_total: number | null;
    sessions_used: number | null;
    frozen_at: string | null;
  }>(
    `SELECT ms.id, COALESCE(p.name, 'اشتراك عام') as plan_name, ms.start_date, ms.end_date, ms.status,
            ms.sessions_total, ms.sessions_used, ms.frozen_at
     FROM member_subscriptions ms
     LEFT JOIN membership_plans p ON ms.plan_id = p.id
     WHERE ms.member_id = ?
     ORDER BY CASE WHEN ms.status = 'active' THEN 1 WHEN ms.status = 'suspended' THEN 2 ELSE 3 END,
              ms.end_date DESC
     LIMIT 1`,
    [member.id],
  );

  let subscriptionInfo: MemberPortalProfile["subscription"] = null;
  if (sub) {
    const endDateMs = new Date(sub.end_date).getTime();
    const todayMs = new Date(today).getTime();
    const diffDays = Math.ceil((endDateMs - todayMs) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, diffDays);

    let sessionsRemaining: number | null = null;
    if (sub.sessions_total != null) {
      sessionsRemaining = Math.max(0, sub.sessions_total - (sub.sessions_used ?? 0));
    }

    subscriptionInfo = {
      planName: sub.plan_name,
      startDate: sub.start_date,
      endDate: sub.end_date,
      daysRemaining,
      sessionsTotal: sub.sessions_total,
      sessionsRemaining,
      status: sub.status,
      isFrozen: Boolean(sub.frozen_at),
    };
  }

  // Last 10 attendance records
  const attendanceRows = db.all<{
    id: string;
    checkin_at: string;
    checkout_at: string | null;
  }>(
    `SELECT id, checkin_at, checkout_at 
     FROM attendance 
     WHERE member_id = ? AND deleted_at IS NULL
     ORDER BY checkin_at DESC 
     LIMIT 10`,
    [member.id],
  );

  const attendance = attendanceRows.map((r) => ({
    id: r.id,
    date: r.checkin_at.slice(0, 10),
    checkinTime: r.checkin_at.slice(11, 16),
    checkoutTime: r.checkout_at ? r.checkout_at.slice(11, 16) : null,
  }));

  // InBody latest assessment
  const inbodyRow = db.first<{
    assessment_date: string;
    weight_kg: number | null;
    height_cm: number | null;
    body_fat_percent: number | null;
    muscle_mass_kg: number | null;
    bmi: number | null;
  }>(
    `SELECT assessment_date, weight_kg, height_cm, body_fat_percent, muscle_mass_kg, bmi
     FROM body_assessments
     WHERE member_id = ?
     ORDER BY assessment_date DESC, created_at DESC
     LIMIT 1`,
    [member.id],
  );

  // Total store & financial debt
  const storeDebt = db.first<{ total: number }>(
    `SELECT COALESCE(SUM(original_minor - paid_minor), 0) as total
     FROM store_debts 
     WHERE member_id = ? AND status = 'open'`,
    [member.id],
  )?.total ?? 0;

  // Live gym occupancy
  const liveOccupancyNow = getLiveOccupancy(db);

  // Gym settings info
  const gymName = readSetting(db, SETTING_KEYS.gymName) || "GymGate";
  const gymPhone = readSetting(db, SETTING_KEYS.gymPhone) || "";
  const gymAddress = readSetting(db, SETTING_KEYS.gymAddress) || "";

  return {
    member: {
      id: member.id,
      memberCode: member.member_code,
      fullName: member.full_name,
      phone: member.phone,
      gender: member.gender,
      photoFileId: member.photo_file_id,
      status: member.status,
      department: member.department,
      joinedDate: member.registration_date,
    },
    subscription: subscriptionInfo,
    attendance,
    inbody: {
      latest: inbodyRow ? {
        date: inbodyRow.assessment_date,
        weightKg: inbodyRow.weight_kg,
        heightCm: inbodyRow.height_cm,
        bodyFatPercent: inbodyRow.body_fat_percent,
        muscleMassKg: inbodyRow.muscle_mass_kg,
        bmi: inbodyRow.bmi,
      } : null,
    },
    totalDebtMinor: storeDebt,
    liveOccupancyNow,
    gymInfo: {
      name: gymName,
      phone: gymPhone,
      address: gymAddress,
    },
  };
}

/**
 * Live gym occupancy counter (can be polled or refreshed without full profile reload).
 */
export function getLiveGymOccupancy(db: Db): {
  occupancyNow: number;
  gymName: string;
  updatedAt: string;
} {
  const occupancyNow = getLiveOccupancy(db);
  const gymName = readSetting(db, SETTING_KEYS.gymName) || "GymGate";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const updatedAt = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { occupancyNow, gymName, updatedAt };
}
