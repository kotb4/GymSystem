import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { nowStamp, todayKey } from "@/core/dates";
import { recordAudit } from "./audit.service";

export type DiscountType = "percentage" | "fixed";

export interface PromoCodeRow extends Row {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  min_spend_minor: number;
  max_uses: number | null;
  times_used: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromoCode {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minSpendMinor: number;
  maxUses: number | null;
  timesUsed: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

export interface PromoCodeInput {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minSpendMinor?: number;
  maxUses?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
}

export interface ValidatePromoResult {
  valid: boolean;
  code: string;
  promoId: string;
  discountType: DiscountType;
  discountValue: number;
  calculatedDiscountMinor: number;
  errorKey?: string;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function toPromo(row: PromoCodeRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minSpendMinor: Number(row.min_spend_minor || 0),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    timesUsed: Number(row.times_used || 0),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    isActive: Number(row.is_active) === 1,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function createPromoCode(
  db: Db,
  actor: ServiceActor,
  input: PromoCodeInput,
): Promise<PromoCode> {
  requirePermission(actor, "promo.manage");

  const code = normalizeCode(input.code);
  if (!code) throw errValidation("errors.promoCodeRequired");
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw errValidation("errors.promoCodeInvalidFormat");

  if (input.discountValue <= 0) throw errValidation("errors.discountValueInvalid");
  if (input.discountType === "percentage" && input.discountValue > 100) {
    throw errValidation("errors.discountPercentageTooHigh");
  }

  const existing = db.first<PromoCodeRow>("SELECT id FROM promo_codes WHERE code = ?", [code]);
  if (existing) throw errConflict("errors.promoCodeExists", { code });

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const minSpendMinor = Math.max(0, Math.round(input.minSpendMinor ?? 0));
  const maxUses = input.maxUses ? Math.max(1, Math.round(input.maxUses)) : null;

  await db.transaction(async () => {
    db.run(
      `INSERT INTO promo_codes (id, code, discount_type, discount_value, min_spend_minor, max_uses, times_used, valid_from, valid_to, is_active, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?)`,
      [
        id,
        code,
        input.discountType,
        input.discountValue,
        minSpendMinor,
        maxUses,
        input.validFrom || null,
        input.validTo || null,
        input.notes?.trim() || null,
        actor.userId,
        stamp,
        stamp,
      ],
    );

    recordAudit(db, actor, "PROMO_CODE_CREATED", "promo", id, {
      code,
      discountType: input.discountType,
      discountValue: input.discountValue,
    });
  });

  const row = db.first<PromoCodeRow>("SELECT * FROM promo_codes WHERE id = ?", [id]);
  if (!row) throw new Error("promo code vanished");
  return toPromo(row);
}

export function listPromoCodes(
  db: Db,
  actor: ServiceActor,
  includeInactive = true,
): PromoCode[] {
  requirePermission(actor, "promo.view");
  const where = includeInactive ? "" : "WHERE is_active = 1";
  const rows = db.all<PromoCodeRow>(`SELECT * FROM promo_codes ${where} ORDER BY created_at DESC`);
  return rows.map(toPromo);
}

export interface ValidatePromoInput {
  code: string;
  orderAmountMinor?: number;
  spendAmountMinor?: number;
}

export function validatePromoCode(
  db: Db,
  actorOrInput: ServiceActor | ValidatePromoInput | string,
  inputOrSpend?: ValidatePromoInput | string | number,
  optionalSpendMinor?: number,
): ValidatePromoResult {
  let rawCode = "";
  let spendAmountMinor = 0;

  const isActor =
    typeof actorOrInput === "object" &&
    actorOrInput !== null &&
    "userId" in actorOrInput &&
    "roleId" in actorOrInput;

  const target = isActor ? inputOrSpend : actorOrInput;
  const secondarySpend = isActor ? optionalSpendMinor : inputOrSpend;

  if (typeof target === "object" && target !== null) {
    rawCode = target.code ?? "";
    spendAmountMinor = Number(target.orderAmountMinor ?? target.spendAmountMinor ?? 0);
  } else {
    rawCode = String(target || "");
    spendAmountMinor = typeof secondarySpend === "number" ? secondarySpend : Number(secondarySpend || 0);
  }

  const code = normalizeCode(rawCode);
  const row = db.first<PromoCodeRow>("SELECT * FROM promo_codes WHERE code = ?", [code]);
  if (!row || Number(row.is_active) !== 1) {
    return {
      valid: false,
      code,
      promoId: "",
      discountType: "fixed",
      discountValue: 0,
      calculatedDiscountMinor: 0,
      errorKey: "errors.promoCodeInvalid",
    };
  }

  const today = todayKey();
  if (row.valid_from && today < row.valid_from) {
    return {
      valid: false,
      code,
      promoId: row.id,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      calculatedDiscountMinor: 0,
      errorKey: "errors.promoCodeNotStarted",
    };
  }
  if (row.valid_to && today > row.valid_to) {
    return {
      valid: false,
      code,
      promoId: row.id,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      calculatedDiscountMinor: 0,
      errorKey: "errors.promoCodeExpired",
    };
  }

  if (row.max_uses != null && Number(row.times_used) >= Number(row.max_uses)) {
    return {
      valid: false,
      code,
      promoId: row.id,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      calculatedDiscountMinor: 0,
      errorKey: "errors.promoCodeMaxUsesReached",
    };
  }

  const minSpend = Number(row.min_spend_minor || 0);
  if (spendAmountMinor < minSpend) {
    return {
      valid: false,
      code,
      promoId: row.id,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      calculatedDiscountMinor: 0,
      errorKey: "errors.promoCodeMinSpendNotMet",
    };
  }

  let calculatedDiscountMinor = 0;
  if (row.discount_type === "percentage") {
    calculatedDiscountMinor = Math.round((spendAmountMinor * Number(row.discount_value)) / 100);
  } else {
    // Fixed amount in piastres (discount_value stored as whole EGP or piastres)
    calculatedDiscountMinor = Math.round(Number(row.discount_value) * 100);
  }
  calculatedDiscountMinor = Math.min(spendAmountMinor, calculatedDiscountMinor);

  return {
    valid: true,
    code,
    promoId: row.id,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    calculatedDiscountMinor,
  };
}

export async function togglePromoCode(
  db: Db,
  actor: ServiceActor,
  id: string,
  isActive: boolean,
): Promise<PromoCode> {
  requirePermission(actor, "promo.manage");
  const row = db.first<PromoCodeRow>("SELECT * FROM promo_codes WHERE id = ?", [id]);
  if (!row) throw errNotFound("errors.promoCodeNotFound");

  await db.transaction(async () => {
    db.run("UPDATE promo_codes SET is_active = ?, updated_at = ? WHERE id = ?", [
      isActive ? 1 : 0,
      nowStamp(),
      id,
    ]);
    recordAudit(db, actor, "PROMO_CODE_TOGGLED", "promo", id, {
      code: row.code,
      isActive,
    });
  });

  const fresh = db.first<PromoCodeRow>("SELECT * FROM promo_codes WHERE id = ?", [id]);
  if (!fresh) throw new Error("promo vanished");
  return toPromo(fresh);
}
