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
 * Ensures the request originates directly and physically from the local machine,
 * and was NOT proxied through Cloudflare Tunnel, reverse proxies, or external tunnels.
 */
export function isDirectPhysicalLocalRequest(
  addressOrReq:
    | string
    | undefined
    | null
    | { socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined> },
): boolean {
  if (!addressOrReq) return false;
  if (typeof addressOrReq === "string") {
    return isLoopbackAddress(addressOrReq);
  }
  const address = addressOrReq.socket?.remoteAddress;
  if (!isLoopbackAddress(address)) return false;
  const headers = addressOrReq.headers ?? {};
  // If proxy / tunnel forwarding headers exist, this arrived through a tunnel / reverse proxy
  if (
    headers["cf-connecting-ip"] ||
    headers["x-forwarded-for"] ||
    headers["x-real-ip"] ||
    headers["cf-ray"] ||
    headers["cf-visitor"]
  ) {
    return false;
  }
  return true;
}

/**
 * Whether an unauthenticated first-run action may proceed: only on the local
 * machine and only while the system is still uninitialized (no active owner).
 */
export function canAdoptFirstRun(
  hasActiveOwner: boolean,
  addressOrReq:
    | string
    | undefined
    | null
    | { socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined> },
): boolean {
  return !hasActiveOwner && isDirectPhysicalLocalRequest(addressOrReq);
}

