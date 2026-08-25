import { formatNumber } from "./number";

export const CURRENCY = "جنيه";

export function formatCurrency(amount: number): string {
  return `${formatNumber(amount)} ${CURRENCY}`;
}
