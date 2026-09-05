import { execFileSync } from "node:child_process";

/**
 * Windows DPAPI (CurrentUser scope) via PowerShell's ProtectedData, as a tiny
 * keep-out-of-the-way helper. This is the "secure OS mechanism" used to store
 * the backup master key at rest (TASK-042): the key is protected by the
 * authenticated Windows user profile, so it is never written to disk in
 * plaintext.
 *
 * Injection safety: every value passed into the generated command is BASE64
 * (`[A-Za-z0-9+/=]` only) — no user-controlled text ever reaches PowerShell,
 * and `execFileSync` does not go through a shell. The script itself is a fixed
 * constant string.
 *
 * Pathological environments where PowerShell is missing/unavailable surface as
 * DPAPI_ERROR here; callers fall back to a restrictive-permission file storage
 * and record that fact (see backup-crypto.ts).
 */

const DPAPI_ENTROPY_B64 = Buffer.from("GymSystem:backup-key:v1", "utf8").toString("base64");

export class DpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpapiError";
  }
}

const ENCRYPT_TEMPLATE =
  "$b=[Convert]::FromBase64String('{DATA}');" +
  "$e=[Convert]::FromBase64String('{ENT}');" +
  "$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$e,'CurrentUser');" +
  "[Convert]::ToBase64String($p)";

const DECRYPT_TEMPLATE =
  "$b=[Convert]::FromBase64String('{DATA}');" +
  "$e=[Convert]::FromBase64String('{ENT}');" +
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$e,'CurrentUser');" +
  "[Convert]::ToBase64String($p)";

function runPowershell(script: string): string {
  try {
    const stdout = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    return stdout;
  } catch (error) {
    throw new DpapiError(
      `DPAPI unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/** Protect `bytes` with DPAPI CurrentUser scope; returns the wrapped bytes. */
export function dpapiProtect(bytes: Uint8Array): Buffer {
  const data = Buffer.from(bytes).toString("base64");
  const out = runPowershell(
    ENCRYPT_TEMPLATE.replace("{DATA}", data).replace("{ENT}", DPAPI_ENTROPY_B64),
  );
  const base64 = out.trim();
  if (!base64) throw new DpapiError("DPAPI returned empty data");
  return Buffer.from(base64, "base64");
}

/** Unprotect `wrapped` (produced by `dpapiProtect`); returns the plain bytes. */
export function dpapiUnprotect(wrapped: Uint8Array): Buffer {
  const data = Buffer.from(wrapped).toString("base64");
  const out = runPowershell(
    DECRYPT_TEMPLATE.replace("{DATA}", data).replace("{ENT}", DPAPI_ENTROPY_B64),
  );
  const base64 = out.trim();
  if (!base64) throw new DpapiError("DPAPI returned empty data");
  return Buffer.from(base64, "base64");
}