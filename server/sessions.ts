import crypto from "node:crypto";
import type { Db } from "../src/db/engine";
import { nowStamp, stampAfterSeconds } from "../src/core/dates";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const SESSION_COOKIE = "gymsystem_session";

/** Create a server-owned session row; only the opaque token leaves the server. */
export function createSessionToken(db: Db, userId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const stamp = nowStamp();
  db.run(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)\nVALUES (?, ?, ?, ?, ?)",
    [hashToken(token), userId, stamp, stamp, stampAfterSeconds(SESSION_TTL_SECONDS)],
  );
  return token;
}

export function resolveSessionUser(
  db: Db,
  token: string | undefined,
): { id: string } | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.first<{ user_id: string; expires_at: string }>(
    "SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ?",
    [tokenHash],
  );
  if (!row) return null;
  if (row.expires_at <= nowStamp()) {
    db.run("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }
  // sliding window refresh
  db.run("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?", [
    nowStamp(),
    stampAfterSeconds(SESSION_TTL_SECONDS),
    tokenHash,
  ]);
  return { id: row.user_id };
}

export function destroySession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.run("DELETE FROM auth_sessions WHERE token_hash = ?", [hashToken(token)]);
}

export function pruneExpiredSessions(db: Db): void {
  db.run("DELETE FROM auth_sessions WHERE expires_at <= ?", [nowStamp()]);
}
