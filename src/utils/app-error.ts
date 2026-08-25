import { toAppError } from "@/core/errors";
import type { TFunction } from "@/i18n";

export function describeError(error: unknown, t: TFunction): string {
  const appError = toAppError(error);
  if (!appError) return t("errors.unexpected");
  return t(appError.messageKey, appError.params);
}
