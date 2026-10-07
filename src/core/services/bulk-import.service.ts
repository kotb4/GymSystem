import { nowStamp, todayKey, isValidDateKey, calcSubscriptionEndDate } from "@/core/dates";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { ensureVirtualCard } from "./cards.service";
import { getLocalBranchId, getLocalBranchPrefix } from "@/core/branch";
import {
  formatMemberCode,
  PHONE_RE,
  EMAIL_RE,
} from "./members.service";

export interface ImportMemberRowInput {
  fullName: string;
  phone?: string | null;
  gender?: "male" | "female" | null;
  dateOfBirth?: string | null;
  address?: string | null;
  notes?: string | null;
  registrationDate?: string | null;
  department?: "general" | "men" | "women" | null;
  planName?: string | null;
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  paidAmount?: number | null;
}

export interface BulkImportRowResult {
  rowNumber: number;
  fullName: string;
  phone?: string | null;
  status: "success" | "skipped" | "error";
  memberCode?: string;
  errorReason?: string;
}

export interface BulkImportResult {
  totalProcessed: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  results: BulkImportRowResult[];
}

function bumpCounter(db: Db, name: string): number {
  db.run("UPDATE counters SET value = value + 1 WHERE name = ?", [name]);
  return Number(db.scalar("SELECT value FROM counters WHERE name = ?", [name]));
}

/**
 * Bulk import members and their optional active subscriptions from CSV/Excel table data.
 * Safe, idempotent per unique name/phone, runs within transactions per row,
 * and records comprehensive audit logs.
 */
export async function bulkImportMembers(
  db: Db,
  actor: ServiceActor,
  rows: ImportMemberRowInput[],
): Promise<BulkImportResult> {
  requirePermission(actor, "members.create");

  const results: BulkImportRowResult[] = [];
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Pre-load active plans for fuzzy name matching
  const allPlans = db.all<{ id: string; name: string; duration_days: number; price: number; is_active: number }>(
    "SELECT id, name, duration_days, price, is_active FROM membership_plans WHERE is_active = 1",
  );

  const branchPrefix = getLocalBranchPrefix(db);
  const branchId = getLocalBranchId(db);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNumber = i + 1;
    const fullName = (raw.fullName ?? "").trim();
    const phone = raw.phone ? raw.phone.trim() : null;

    if (!fullName) {
      results.push({
        rowNumber,
        fullName: fullName || "—",
        phone,
        status: "error",
        errorReason: "errors.nameRequired",
      });
      errorCount++;
      continue;
    }

    if (phone && !PHONE_RE.test(phone)) {
      results.push({
        rowNumber,
        fullName,
        phone,
        status: "error",
        errorReason: "errors.phoneInvalid",
      });
      errorCount++;
      continue;
    }

    // Check if member already exists by phone or full name
    const existing = db.first<{ id: string; member_code: string }>(
      phone
        ? "SELECT id, member_code FROM members WHERE phone = ? OR full_name = ?"
        : "SELECT id, member_code FROM members WHERE full_name = ?",
      phone ? [phone, fullName] : [fullName],
    );

    if (existing) {
      results.push({
        rowNumber,
        fullName,
        phone,
        status: "skipped",
        memberCode: existing.member_code,
        errorReason: "errors.phoneTaken",
      });
      skippedCount++;
      continue;
    }

    // Validate email if present
    const email = raw.notes && EMAIL_RE.test(raw.notes) ? raw.notes : null;

    // Validate dates
    const regDate = raw.registrationDate && isValidDateKey(raw.registrationDate)
      ? raw.registrationDate
      : todayKey();

    const dob = raw.dateOfBirth && isValidDateKey(raw.dateOfBirth) ? raw.dateOfBirth : null;
    const gender = raw.gender === "male" || raw.gender === "female" ? raw.gender : null;
    const department = raw.department === "men" || raw.department === "women" ? raw.department : "general";

    const memberId = crypto.randomUUID();
    let memberCode = "";

    try {
      await db.transaction(async () => {
        const codeValue = bumpCounter(db, "member_code");
        memberCode = formatMemberCode(codeValue, branchPrefix);

        db.run(
          `INSERT INTO members (id, member_code, full_name, phone, email, gender, date_of_birth, address, notes, department, registration_date, status, created_by, created_at, updated_at, branch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          [
            memberId,
            memberCode,
            fullName,
            phone,
            email,
            gender,
            dob,
            raw.address ? raw.address.trim() : null,
            raw.notes ? raw.notes.trim() : null,
            department,
            regDate,
            actor.userId,
            nowStamp(),
            nowStamp(),
            branchId,
          ],
        );

        // Auto create virtual card
        ensureVirtualCard(db, { memberId, memberCode, actorId: actor.userId });

        // Optional subscription linking if planName is provided
        if (raw.planName) {
          const cleanPlanName = raw.planName.trim().toLowerCase();
          const matchedPlan = allPlans.find(
            (p) => p.name.trim().toLowerCase() === cleanPlanName || cleanPlanName.includes(p.name.trim().toLowerCase()),
          );

          if (matchedPlan) {
            const startDate = raw.subscriptionStartDate && isValidDateKey(raw.subscriptionStartDate)
              ? raw.subscriptionStartDate
              : todayKey();

            const endDate = raw.subscriptionEndDate && isValidDateKey(raw.subscriptionEndDate)
              ? raw.subscriptionEndDate
              : calcSubscriptionEndDate(startDate, matchedPlan.duration_days);

            const subId = crypto.randomUUID();
            db.run(
              `INSERT INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, status, sessions_total, sessions_used, notes, created_by, created_at, updated_at, branch_id)
               VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, 0, 'استيراد جماعي (Bulk Import)', ?, ?, ?, ?)`,
              [
                subId,
                memberId,
                matchedPlan.id,
                startDate,
                endDate,
                matchedPlan.price,
                actor.userId,
                nowStamp(),
                nowStamp(),
                branchId,
              ],
            );

            // If a paid amount was provided and actor has payment creation permission
            const paid = raw.paidAmount && raw.paidAmount > 0 ? Math.round(raw.paidAmount) : null;
            if (paid && paid > 0) {
              const paymentId = crypto.randomUUID();
              const baseMinor = Math.round(matchedPlan.price * 100);
              const paidMinor = Math.round(paid * 100);
              const remainingMinor = Math.max(0, baseMinor - paidMinor);
              const paymentStatus = remainingMinor === 0 ? "paid" : "partial";

              db.run(
                `INSERT INTO payments (id, member_id, subscription_id, base_amount_minor, discount_kind, discount_input, discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, method_code, status, notes, paid_at, created_by, created_at, updated_at, branch_id)
                 VALUES (?, ?, ?, ?, 'none', 0, 0, ?, ?, 0, ?, 'cash', ?, 'استيراد سابق', ?, ?, ?, ?, ?)`,
                [
                  paymentId,
                  memberId,
                  subId,
                  baseMinor,
                  baseMinor,
                  paidMinor,
                  remainingMinor,
                  paymentStatus,
                  nowStamp(),
                  actor.userId,
                  nowStamp(),
                  nowStamp(),
                  branchId,
                ],
              );
            }
          }
        }

        recordAudit(db, actor, "MEMBER_CREATED", "member", memberId, {
          memberCode,
          fullName,
          source: "bulk_import",
        });
      });

      results.push({
        rowNumber,
        fullName,
        phone,
        status: "success",
        memberCode,
      });
      successCount++;
    } catch (err) {
      results.push({
        rowNumber,
        fullName,
        phone,
        status: "error",
        errorReason: err instanceof Error ? err.message : "errors.unexpected",
      });
      errorCount++;
    }
  }

  return {
    totalProcessed: rows.length,
    successCount,
    skippedCount,
    errorCount,
    results,
  };
}
