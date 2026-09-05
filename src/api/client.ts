import { AppError } from "@/core/errors";

/**
 * Thin HTTP bridge to the local GymSystem backend (127.0.0.1).
 * The browser never opens SQLite and never stores business data —
 * sessions live server-side in an HttpOnly cookie.
 */

export interface SerializedError {
  name: string;
  code: string;
  messageKey: string;
  params: Record<string, string | number>;
}

function toError(payload: unknown, status: number): Error {
  const raw = payload as { error?: SerializedError } | null;
  if (raw && raw.error && typeof raw.error.messageKey === "string") {
    return new AppError(
      (raw.error.code as AppError["code"]) ?? "INTERNAL",
      raw.error.messageKey,
      raw.error.params,
    );
  }
  if (status === 401) return new AppError("UNAUTHORIZED", "errors.invalidCredentials");
  return new AppError("INTERNAL", "errors.unexpected");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    // backend not reachable (should not happen in the packaged app)
    throw new AppError("INTERNAL", "boot.failed");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  if (!res.ok || (body !== null && typeof body === "object" && (body as { ok?: boolean }).ok === false)) {
    throw toError(body, res.status);
  }
  return ((body as { result?: T }) ?? {})?.result as T;
}

export async function rpc<T>(service: string, fn: string, args: unknown[] = []): Promise<T> {
  return request<T>("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, fn, args }),
  });
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postRaw<T>(url: string, bytes: Uint8Array, headers: Record<string, string> = {}): Promise<T> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...headers },
    body: buffer,
  });
}

export interface MeResponse {
  /** Full user when a valid session exists; null otherwise. */
  user: {
    id: string;
    username: string;
    fullName: string;
    roleId: string;
    department?: "general" | "men" | "women";
  } | null;
  needsSetup: boolean;
}

export { request };
