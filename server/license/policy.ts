/**
 * Pure licensing policy — no I/O, no crypto. Fully unit-testable.
 *
 * States:
 *  - unlicensed    no license state file yet (needs activation)
 *  - active        valid signature, HWID matches, not expired
 *  - grace         signature valid + HWID matches but past `expiresAt`,
 *                  within GRACE_DAYS — full writes allowed with a warning
 *  - expired       past `expiresAt` + GRACE_DAYS — read-only
 *  - tampered      system clock rolled back > tolerance vs lastActive — read-only
 *  - invalid       license file present but unverifiable/bound to another HWID
 */

export const GRACE_DAYS = 5;
export const CLOCK_ROLLBACK_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour
export const CLOCK_ROLLBACK_GRACE_MS = CLOCK_ROLLBACK_TOLERANCE_MS * 12; // allow small boot ambient

export type LicenseStateName =
  | "unlicensed"
  | "active"
  | "grace"
  | "expired"
  | "tampered"
  | "invalid";

export interface SignedPayload {
  hwid: string;
  gym: string;
  issuedAt: number; // epoch ms
  expiresAt: number; // epoch ms
  tier: string;
}

export interface LicenseState {
  /** Running/expected HWID that the license must bind to. */
  hwid: string;
  /** Persisted monotonic last-seen clock (epoch ms), null when never booted. */
  lastActive: number | null;
  /** Verified/signed payload, null while unlicensed. */
  payload: SignedPayload | null;
  /** The running machine's system clock (epoch ms) at evaluation time. */
  now: number;
  /** Whether the persisted state file parses into a coherent shape at all. */
  filePresent: boolean;
  /** Whether the boot-time signature verification of the .lic succeeded. */
  signatureValid: boolean;
}

/** Grace cutoff in ms: expiresAt + GRACE_DAYS. */
export function graceDeadline(payload: SignedPayload): number {
  return payload.expiresAt + GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * True when writes are blocked outright (hard lockdown) — the read-only
 * RPC gate keys off this.
 */
export function isHardLocked(state: LicenseState): boolean {
  const name = evaluate(state).name;
  return name === "expired" || name === "tampered" || name === "invalid";
}

/** True when the system is unlicensed and needs the activation screen. */
export function needsActivation(state: LicenseState): boolean {
  const name = evaluate(state).name;
  return name === "unlicensed" || name === "invalid";
}

/** Human-facing snack: days remaining in grace for the banner. */
export function graceDaysRemaining(state: LicenseState, nowMs: number): number {
  const p = state.payload;
  if (!p) return 0;
  const msLeft = graceDeadline(p) - nowMs;
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

function expiryState(state: LicenseState): "active" | "grace" | "expired" {
  const p = state.payload!;
  if (state.now >= graceDeadline(p)) return "expired";
  if (state.now >= p.expiresAt) return "grace";
  return "active";
}

/**
 * Evaluate the license state machine. Order of checks matters:
 *  1. No usable file          -> unlicensed
 *  2. Signature/parse failed  -> invalid
 *  3. Clock rolled back       -> tampered (takes precedence over expiry so a
 *                                user can't rewind to dodge expiry)
 *  4. payload present         -> active/grace/expired by expiresAt vs now
 */
export function evaluate(state: LicenseState): {
  name: LicenseStateName;
  label: string;
} {
  if (!state.filePresent || !state.payload) return { name: "unlicensed", label: "unlicensed" };
  if (!state.signatureValid) return { name: "invalid", label: "invalid" };
  if (state.payload.hwid !== state.hwid) return { name: "invalid", label: "invalid" };
  if (state.lastActive != null) {
    const driftBackMs = state.lastActive - state.now;
    if (driftBackMs > CLOCK_ROLLBACK_TOLERANCE_MS + CLOCK_ROLLBACK_GRACE_MS) {
      return { name: "tampered", label: "tampered" };
    }
  }
  return { name: expiryState(state), label: expiryState(state) };
}

/**
 * Produce the next `lastActive` to persist after observing `now`. Returns null
 * when nothing changes (clock not ahead of the persisted value).
 */
export function advanceLastActive(lastActive: number | null, nowMs: number): number | null {
  if (lastActive == null || nowMs > lastActive) return nowMs;
  return null;
}

/**
 * Given a freshly parsed+verified signed payload, build the persisted license
 * state shape (resetting lastActive so the first boot of a new license can't
 * falsely trip the clock guard from leftover old timestamps).
 */
export function stateFromPayload(payload: SignedPayload, hwid: string): LicenseState {
  return {
    hwid,
    lastActive: null,
    payload,
    now: Date.now(),
    filePresent: true,
    signatureValid: true,
  };
}