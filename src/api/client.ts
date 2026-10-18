import { AppError } from "@/core/errors";

/**
 * Thin HTTP bridge to the local GymGate backend (127.0.0.1).
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

const TOKEN_STORAGE_KEY = "gymgate_auth_token";
const LEGACY_TOKEN_STORAGE_KEY = "gymsystem_auth_token";
const SERVER_URL_STORAGE_KEY = "gymgate_server_url";
let inMemoryToken: string | null = null;
let inMemoryServerUrl: string | null = null;

export function getStoredServerUrl(): string | null {
  if (inMemoryServerUrl) return inMemoryServerUrl;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(SERVER_URL_STORAGE_KEY);
      if (stored) {
        inMemoryServerUrl = stored;
        return stored;
      }
    }
  } catch {
    // localStorage restricted/disabled
  }
  return null;
}

export function setStoredServerUrl(url: string | null): void {
  inMemoryServerUrl = url ? url.trim().replace(/\/+$/, "") : null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (inMemoryServerUrl) {
        window.localStorage.setItem(SERVER_URL_STORAGE_KEY, inMemoryServerUrl);
      } else {
        window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
      }
    }
  } catch {
    // localStorage restricted/disabled
  }
}

export function getStoredToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored =
        window.localStorage.getItem(TOKEN_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
      if (stored) {
        inMemoryToken = stored;
        return stored;
      }
    }
  } catch {
    // localStorage restricted/disabled
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // localStorage restricted/disabled
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("x-disable-cookies", "1");

  const serverUrl = getStoredServerUrl();
  const targetUrl = serverUrl && url.startsWith("/")
    ? `${serverUrl}${url}`
    : url;
  const isCrossOrigin = Boolean(serverUrl && typeof window !== "undefined" && !targetUrl.startsWith(window.location.origin));
  const credentialsMode: RequestCredentials = isCrossOrigin ? "omit" : "same-origin";

  let res: Response;
  try {
    res = await fetch(targetUrl, { credentials: credentialsMode, ...init, headers });
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
  featureFlags?: Record<string, boolean>;
}

export { request };
