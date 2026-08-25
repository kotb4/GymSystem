import { assessPasswordStrength, hashPassword, verifyPassword } from "@/core/auth/password";
import { nowStamp, secondsBetweenStamps, stampAfterSeconds } from "@/core/dates";
import {
  errAccountLocked,
  errConflict,
  errUnauthorized,
  errValidation,
} from "@/core/errors";
import type { RoleId } from "@/core/permissions";
import { SETTING_KEYS, writeSettingInternal } from "./settings.service";
import {
  countActiveOwners,
  getUserRowById,
  getUserRowByUsername,
  toPublicUser,
  USERNAME_RE,
  type PublicUser,
  type UserRow,
} from "./users.service";
import { recordAudit } from "./audit.service";
import type { Db } from "@/db/engine";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCK_SECONDS = 300;

export function needsSetup(db: Db): boolean {
  return countActiveOwners(db) === 0;
}

export interface SetupInput {
  gymName: string;
  ownerFullName: string;
  username: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

function remainingLockSeconds(row: UserRow): number {
  if (!row.locked_until) return 0;
  const remaining = secondsBetweenStamps(row.locked_until, nowStamp());
  return remaining > 0 ? remaining : 0;
}

export async function setup(db: Db, input: SetupInput): Promise<PublicUser> {
  if (!needsSetup(db)) throw errConflict("errors.setupAlreadyDone");
  const gymName = input.gymName.trim();
  const fullName = input.ownerFullName.trim();
  const username = input.username.trim();
  if (gymName === "") throw errValidation("errors.gymNameRequired");
  if (fullName === "") throw errValidation("errors.fullNameRequired");
  if (!USERNAME_RE.test(username)) throw errValidation("errors.usernameInvalid");
  const weakness = assessPasswordStrength(input.password);
  if (weakness) throw errValidation(weakness);

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const hash = await hashPassword(input.password);

  await db.transaction(() => {
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, created_at, updated_at)\nVALUES (?, ?, NULL, ?, ?, 'owner', 1, ?, ?)",
      [id, username, hash, fullName, stamp, stamp],
    );
    writeSettingInternal(db, SETTING_KEYS.gymName, gymName);
    recordAudit(db, { userId: id, username }, "SETUP_COMPLETED", "system", null, {
      gymName,
      ownerUsername: username,
    });
  });

  const row = getUserRowById(db, id);
  if (!row) throw new Error("setup user vanished");
  return toPublicUser(row);
}

export async function login(db: Db, input: LoginInput): Promise<PublicUser> {
  const username = input.username.trim();
  const row = getUserRowByUsername(db, username);
  if (!row || Number(row.is_active) !== 1) throw errUnauthorized();

  const lockRemaining = remainingLockSeconds(row);
  if (lockRemaining > 0) throw errAccountLocked(lockRemaining);

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    const failedAttempts = Number(row.failed_attempts) + 1;
    const locked = failedAttempts >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = locked ? stampAfterSeconds(LOGIN_LOCK_SECONDS) : null;
    db.run(
      "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
      [failedAttempts, lockedUntil, nowStamp(), row.id],
    );
    recordAudit(
      db,
      { userId: row.id, username: row.username },
      "AUTH_LOGIN_FAILED",
      "user",
      row.id,
      locked ? { lockedForSeconds: LOGIN_LOCK_SECONDS } : { attempt: failedAttempts },
    );
    if (locked) throw errAccountLocked(LOGIN_LOCK_SECONDS);
    throw errUnauthorized();
  }

  const stamp = nowStamp();
  db.run(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
    [stamp, stamp, row.id],
  );
  recordAudit(db, { userId: row.id, username: row.username }, "AUTH_LOGIN", "user", row.id);
  return toPublicUser({ ...row, last_login_at: stamp });
}

export function buildActor(user: PublicUser): {
  userId: string;
  username: string;
  fullName: string;
  roleId: RoleId;
  department?: "general" | "men" | "women";
} {
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    roleId: user.roleId,
    department: user.department,
  };
}

export async function changeOwnPassword(
  db: Db,
  actorRef: { userId: string; username: string },
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = getUserRowByUsername(db, actorRef.username);
  if (!row) throw errUnauthorized();
  const ok = await verifyPassword(currentPassword, row.password_hash);
  if (!ok) throw errUnauthorized();
  const weakness = assessPasswordStrength(newPassword);
  if (weakness) throw errValidation(weakness);
  const hash = await hashPassword(newPassword);
  db.transaction(() => {
    db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [
      hash,
      nowStamp(),
      actorRef.userId,
    ]);
    recordAudit(db, actorRef, "AUTH_PASSWORD_CHANGED", "user", actorRef.userId);
  });
}
