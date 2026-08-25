import { errValidation } from "./errors";

export type DiscountKind = "none" | "fixed" | "percent";

export const MAX_PERCENT = 100;

export function toMinor(major: number | string): number {
  const raw = typeof major === "string" ? Number(major.replace(/,/g, "").trim()) : major;
  if (!Number.isFinite(raw)) return NaN;
  return Math.round(raw * 100);
}

export function minorToMajor(minor: number): number {
  return Math.round(minor) / 100;
}

const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMinor(minor: number): string {
  return nf2.format(Math.round(minor) / 100);
}

export function parsePercent(value: number | string): number {
  const raw = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(raw)) return NaN;
  return Math.round(raw * 100) / 100;
}

export interface DiscountComputation {
  kind: DiscountKind;
  inputValue: number;
  discountMinor: number;
  netMinor: number;
}

export function computeDiscount(
  baseMinor: number,
  kind: DiscountKind,
  inputValue: number,
): DiscountComputation {
  assertNonNegativeInteger(baseMinor, "errors.finance.invalidAmount");
  if (!Number.isInteger(baseMinor)) throw errValidation("errors.finance.invalidAmount");
  if (kind === "none") {
    return { kind, inputValue: 0, discountMinor: 0, netMinor: baseMinor };
  }
  if (!Number.isFinite(inputValue) || inputValue <= 0) {
    throw errValidation("errors.finance.discountMustBePositive");
  }
  if (kind === "percent") {
    const pct = parsePercent(inputValue);
    if (!Number.isFinite(pct) || pct <= 0 || pct > MAX_PERCENT) {
      throw errValidation("errors.finance.discountPercentRange", { max: MAX_PERCENT });
    }
    const discountMinor = Math.round((baseMinor * pct) / MAX_PERCENT);
    return { kind, inputValue: pct, discountMinor, netMinor: baseMinor - discountMinor };
  }
  const fixedMinor = Math.round(inputValue);
  if (fixedMinor > baseMinor) {
    throw errValidation("errors.finance.discountExceedsAmount");
  }
  return { kind, inputValue: fixedMinor, discountMinor: fixedMinor, netMinor: baseMinor - fixedMinor };
}

export function assertNonNegativeInteger(value: number, messageKey: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw errValidation(messageKey);
  }
}

export interface PaymentSplit {
  netMinor: number;
  paidMinor: number;
  remainingMinor: number;
}

export function computePaymentSplit(netMinor: number, paidMinor: number): PaymentSplit {
  assertNonNegativeInteger(netMinor, "errors.finance.invalidAmount");
  assertNonNegativeInteger(paidMinor, "errors.finance.invalidAmount");
  if (paidMinor > netMinor) throw errValidation("errors.finance.overpay");
  return { netMinor, paidMinor, remainingMinor: netMinor - paidMinor };
}
