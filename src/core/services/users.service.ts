import { hashPassword, assessPasswordStrength } from "@/core/auth/password";
import { errConflict, errForbidden, errNotFound, errValidation } from "@/core/errors";
import { requirePermission, ROLES, type RoleId, type ServiceActor } from "@/core/permissions";
import { nowStamp } from "@/core/dates";
import type { Db, Row } from "@/db/engine";
import { recordAudit } from "./audit.service";
import { isDeveloperActor } from "./developer.service";

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UserRow extends Row {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
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
  is_developer: number | null;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  roleId: RoleId;
  department: "general" | "men" | "women";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  isDeveloper?: boolean;
  token?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  roleId: RoleId;
  email?: string | null;
  phone?: string | null;
  department?: "general" | "men" | "women";
}

export interface UpdateUserInput {
  fullName?: string;
  roleId?: RoleId;
  email?: string | null;
  phone?: string | null;
  department?: "general" | "men" | "women";
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone ?? null,
    fullName: row.full_name,
    roleId: row.role_id,
    department: (row.department ?? "general") as "general" | "men" | "women",
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    isDeveloper: Number(row.is_developer ?? 0) === 1 || row.username.toLowerCase() === "kotb",
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
    "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND is_active = 1 AND COALESCE(is_developer, 0) = 0",
  );
}

export function countTotalOwners(db: Db): number {
  return db.count(
    "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND COALESCE(is_developer, 0) = 0",
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
  const isDev = isDeveloperActor(actor);
  const sql = isDev
    ? "SELECT * FROM users ORDER BY created_at ASC"
    : "SELECT * FROM users WHERE COALESCE(is_developer, 0) = 0 ORDER BY created_at ASC";
  return db
    .all<UserRow>(sql)
    .map(toPublicUser);
}

export async function createUser(db: Db, actor: ServiceActor, input: CreateUserInput): Promise<PublicUser> {
  requirePermission(actor, "users.manage");
  if (input.roleId === "owner" && actor.roleId !== "owner") throw errForbidden();
  const fullName = input.fullName.trim();
  const email = input.email?.trim() || null;
  assertValidNewUser({ ...input, fullName, email });

  if (getUserRowByUsername(db, input.username)) throw errConflict("errors.usernameTaken");

  const id = crypto.randomUUID();
  const stamp = nowStamp();
  const hash = await hashPassword(input.password);
  const phone = input.phone?.trim() || null;
  await db.transaction(() => {
    db.run(
      "INSERT INTO users (id, username, email, phone, password_hash, full_name, role_id, department, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      [id, input.username, email, phone, hash, fullName, input.roleId, input.department ?? "general", stamp, stamp],
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
  if (Number(row.is_developer ?? 0) === 1 && !isDeveloperActor(actor)) {
    throw errForbidden();
  }

  const fullName = patch.fullName?.trim();
  if (fullName === "") throw errValidation("errors.fullNameRequired");
  const email = patch.email === undefined ? row.email : patch.email?.trim() || null;
  const phone = patch.phone === undefined ? row.phone : patch.phone?.trim() || null;
  if (email && !EMAIL_RE.test(email)) throw errValidation("errors.emailInvalid");
  const roleId = patch.roleId ?? row.role_id;
  if (!ROLES.includes(roleId)) throw errValidation("errors.roleInvalid");

  // Only the owner may grant or revoke the owner role (privilege-escalation guard).
  if (roleId === "owner" && actor.roleId !== "owner") throw errForbidden();

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
      "UPDATE users SET full_name = ?, email = ?, phone = ?, role_id = ?, department = ?, updated_at = ? WHERE id = ?",
      [fullName ?? row.full_name, email, phone, roleId, dept, nowStamp(), userId],
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
  if (Number(row.is_developer ?? 0) === 1 && !isDeveloperActor(actor)) {
    throw errForbidden();
  }
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
  if (Number(row.is_developer ?? 0) === 1) {
    throw errForbidden();
  }
  const alreadyActive = Number(row.is_active) === 1;
  if (alreadyActive === isActive) return toPublicUser(row);

  if (!isActive) {
    if (actor.userId === userId) throw errValidation("errors.cannotDeactivateSelf");
    if (!isDeveloperActor(actor) && row.role_id === "owner" && countActiveOwners(db) <= 1) {
      throw errValidation("errors.lastOwner");
    }
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [isActive ? 1 : 0, nowStamp(), userId],
    );
    if (!isActive) {
      db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
    }
    recordAudit(db, actor, isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", "user", userId);
  });

  const fresh = getUserRowById(db, userId);
  if (!fresh) throw errNotFound("errors.userNotFound");
  return toPublicUser(fresh);
}
