/**
 * First-run hardening (ADR-023 follow-up).
 *
 * The unauthenticated initialization routes — `POST /api/auth/setup` and the
 * one-time `POST /api/system/import-legacy` (allowed only while no active owner
 * exists) — must never be reachable from another machine, even when the
 * operator explicitly opts into LAN binding via `GYMSYSTEM_HOST`. They are
 * therefore restricted to the loopback interface: the same-device browser
 * window / dev proxy sees `127.0.0.1`, while any LAN client is rejected.
 */

/**
 * True when the peer address is the local machine. Handles the IPv4-mapped
 * IPv6 form Node reports on dual-stack sockets (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const normalized = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  return normalized === "::1" || normalized.startsWith("127.");
}

/**
 * Whether an unauthenticated first-run action may proceed: only on the local
 * machine and only while the system is still uninitialized (no active owner).
 */
export function canAdoptFirstRun(
  hasActiveOwner: boolean,
  address: string | undefined | null,
): boolean {
  return !hasActiveOwner && isLoopbackAddress(address);
}
