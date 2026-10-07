/**
 * Cloudflare Tunnel Token helper.
 * Extracts the raw token whether pasted directly, as a service install command,
 * or as a tunnel run command.
 */
export function extractTunnelToken(input: string): string {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Pattern 1: cloudflared.exe service install <token> OR cloudflared service install <token>
  // or cloudflared tunnel run --token <token>
  const tokenFlagMatch = trimmed.match(/(?:--token\s+|service\s+install\s+)([A-Za-z0-9_.-]+)/i);
  if (tokenFlagMatch && tokenFlagMatch[1]) {
    return tokenFlagMatch[1].trim();
  }

  // Pattern 2: Cloudflare tunnel token (JWT-like base64 starting with eyJh...)
  const eyMatch = trimmed.match(/eyJh[A-Za-z0-9_.-]+/);
  if (eyMatch && trimmed.length > 50 && (trimmed.includes(" ") || trimmed.includes("\n"))) {
    return eyMatch[0].trim();
  }

  return trimmed;
}
