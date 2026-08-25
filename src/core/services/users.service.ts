import { hashPassword, assessPasswordStrength } from "@/core/auth/password";
import { errConflict, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, ROLES, type RoleId, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UserRow extends Row {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  full_name: string;
  role_id: RoleId;
  is_active: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  department: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  roleId: RoleId;
  department: "general" | "men" | "women";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  roleId: RoleId;
  email?: string | null;
  department?: "general" | "men" | "women";
}

export interface UpdateUserInput {
  fullName?: string;
  roleId?: RoleId;
  email?: string | null;
  department?: "general" | "men" | "women";
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    roleId: row.role_id,
    department: (row.department ?? "general") as "general" | "men" | "women",
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function getUserRowById(db: Db, userId: string): UserRow | null {
  return db.first<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
}

export function getUserRowByUsername(db: Db, username: string): UserRow | null {
  return db.first<UserRow>("SELECT * FROM users WHERE username = ? COLLATE NOCASE", [username]);
}

export function countActiveOwners(db: Db): number {
  return db.count(
    "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND is_active = 1",
  );
}

function assertValidNewUser(input: CreateUserInput): void {
  if (!USERNAME_RE.test(input.username)) throw errValidation("errors.usernameInvalid");
  if (input.fullName.trim() === "") throw errValidation("errors.fullNameRequired");
  if (!ROLES.includes(input.roleId)) throw errValidation("errors.roleInvalid");
  if (input.email && !EMAIL_RE.test(input.email)) throw errValidation("errors.emailInvalid");
  const weakness = assessPasswordStrength(input.password);
  if (weakness) throw errValidation(weakness);
}

export function listUsers(db: Db, actor: ServiceActor): PublicUser[] {
  requirePermission(actor, "users.view");
  return db
    .all<UserRow>("SELECT * FROM users ORDER BY created_at ASC")
    .map(toPublicUser);
}

export async function createUser(db: Db, actor: ServiceActor, input: CreateUserInput): Promise<PublicUser> {
  requirePermission(actor, "users.manage");
  const fullName = input.fullName.trim();
  const email = input.email?.trim() || null;
  assertValidNewUser({ ...input, fullName, email });

  if (getUserRowByUsername(db, input.username)) throw errConflict("errors.usernameTaken");

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const hash = await hashPassword(input.password);
  await db.transaction(() => {
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, department, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      [id, input.username, email, hash, fullName, input.roleId, input.department ?? "general", stamp, stamp],
    );
    recordAudit(db, actor, "USER_CREATED", "user", id, { username: input.username, roleId: input.roleId });
  });

  const row = getUserRowById(db, id);
  if (!row) throw new Error("user vanished after insert");
  return toPublicUser(row);
}

export async function updateUser(
  db: Db,
  actor: ServiceActor,
  userId: string,
  patch: UpdateUserInput,
): Promise<PublicUser> {
  requirePermission(actor, "users.manage");
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");

  const fullName = patch.fullName?.trim();
  if (fullName === "") throw errValidation("errors.fullNameRequired");
  const email = patch.email === undefined ? row.email : patch.email?.trim() || null;
  if (email && !EMAIL_RE.test(email)) throw errValidation("errors.emailInvalid");
  const roleId = patch.roleId ?? row.role_id;
  if (!ROLES.includes(roleId)) throw errValidation("errors.roleInvalid");

  if (
    row.role_id === "owner" &&
    Number(row.is_active) === 1 &&
    roleId !== "owner" &&
    countActiveOwners(db) <= 1
  ) {
    throw errValidation("errors.lastOwner");
  }

  await db.transaction(async () => {
    const dept = patch.department ?? ((row.department ?? "general") as "general" | "men" | "women");
    db.run(
      "UPDATE users SET full_name = ?, email = ?, role_id = ?, department = ?, updated_at = ? WHERE id = ?",
      [fullName ?? row.full_name, email, roleId, dept, nowStamp(), userId],
    );
    recordAudit(db, actor, "USER_UPDATED", "user", userId, {
      fullName: fullName ?? row.full_name,
      roleId,
    });
  });

  const fresh = getUserRowById(db, userId);
  if (!fresh) throw errNotFound("errors.userNotFound");
  return toPublicUser(fresh);
}

export async function resetPassword(
  db: Db,
  actor: ServiceActor,
  userId: string,
  newPassword: string,
): Promise<void> {
  requirePermission(actor, "users.manage");
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");
  const weakness = assessPasswordStrength(newPassword);
  if (weakness) throw errValidation(weakness);

  const hash = await hashPassword(newPassword);
  await db.transaction(async () => {
    db.run(
      "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [hash, nowStamp(), userId],
    );
    recordAudit(db, actor, "USER_PASSWORD_RESET", "user", userId);
  });
}

export async function setUserActive(
  db: Db,
  actor: ServiceActor,
  userId: string,
  isActive: boolean,
): Promise<PublicUser> {
  requirePermission(actor, "users.manage");
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");
  const alreadyActive = Number(row.is_active) === 1;
  if (alreadyActive === isActive) return toPublicUser(row);

  if (!isActive) {
    if (actor.userId === userId) throw errValidation("errors.cannotDeactivateSelf");
    if (row.role_id === "owner" && countActiveOwners(db) <= 1) {
      throw errValidation("errors.lastOwner");
    }
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [isActive ? 1 : 0, nowStamp(), userId],
    );
    recordAudit(db, actor, isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", "user", userId);
  });

  const fresh = getUserRowById(db, userId);
  if (!fresh) throw errNotFound("errors.userNotFound");
  return toPublicUser(fresh);
}
