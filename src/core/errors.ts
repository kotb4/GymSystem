export type AppErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "LOCKED"
  | "INTERNAL";

export type AppErrorParams = Record<string, string | number>;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly messageKey: string;
  readonly params: AppErrorParams;

  constructor(code: AppErrorCode, messageKey: string, params?: AppErrorParams) {
    super(messageKey);
    this.name = "AppError";
    this.code = code;
    this.messageKey = messageKey;
    this.params = params ?? {};
  }
}

export function errValidation(messageKey: string, params?: AppErrorParams): AppError {
  return new AppError("VALIDATION", messageKey, params);
}

export function errNotFound(messageKey: string, params?: AppErrorParams): AppError {
  return new AppError("NOT_FOUND", messageKey, params);
}

export function errConflict(messageKey: string, params?: AppErrorParams): AppError {
  return new AppError("CONFLICT", messageKey, params);
}

export function errForbidden(): AppError {
  return new AppError("FORBIDDEN", "errors.forbidden");
}

export function errUnauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "errors.invalidCredentials");
}

export function errAccountLocked(retryAfterSeconds: number): AppError {
  return new AppError("LOCKED", "errors.accountLocked", { seconds: Math.max(1, Math.ceil(retryAfterSeconds)) });
}

/**
 * A license-gate rejection (read-only hard lock). Uses the LOCKED code (HTTP
 * 423). `reason` is one of expired_readonly | tampered | invalid and maps to an
 * i18n key owned by the frontend's describeError.
 */
export function errLicenseLocked(reason: string): AppError {
  return new AppError("LOCKED", "errors.license.blocked", { reason });
}

export function toAppError(error: unknown): AppError | null {
  return error instanceof AppError ? error : null;
}
