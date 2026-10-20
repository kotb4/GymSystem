import { errForbidden, errUnauthorized, errValidation } from "@/core/errors";
import { requirePermission, roleHasPermission, type RoleId, type ServiceActor } from "@/core/permissions";
import { recordAudit } from "./audit.service";
import { verifyPassword } from "@/core/auth/password";
import { readSetting, writeSettingInternal } from "./settings.service";
import type { Db } from "@/db/engine";
import crypto from "node:crypto";

export interface ManagerOverrideInput {
  pin?: string;
  username?: string;
  password?: string;
  reason?: string;
  entityType?: string;
  entityId?: string;
}

export interface ManagerOverrideResult {
  success: boolean;
  authorizedBy: string;
  managerId: string;
  roleId: RoleId;
  token: string;
}

export const SETTING_MANAGER_PIN = "manager_override_pin";

export async function verifyManagerOverride(
  db: Db,
  actor: ServiceActor,
  input: ManagerOverrideInput,
): Promise<ManagerOverrideResult> {
  let authorizedUser: { id: string; username: string; role_id: RoleId } | null = null;

  // Option 1: Quick PIN verification
  if (input.pin && input.pin.trim()) {
    const configuredPin = readSetting(db, SETTING_MANAGER_PIN);
    if (!configuredPin || configuredPin.trim() !== input.pin.trim()) {
      throw errValidation("errors.managerOverrideInvalidPin");
    }
    // Find active manager or owner to associate with PIN override
    const managerUser = db.first<{ id: string; username: string; role_id: string }>(
      "SELECT id, username, role_id FROM users WHERE role_id IN ('owner', 'manager') AND is_active = 1 ORDER BY (role_id = 'owner') DESC, created_at ASC LIMIT 1",
    );
    if (!managerUser) {
      throw errForbidden("errors.managerOverrideNotAuthorized");
    }
    authorizedUser = {
      id: managerUser.id,
      username: managerUser.username,
      role_id: managerUser.role_id as RoleId,
    };
  }
  // Option 2: Username + Password verification
  else if (input.username && input.password) {
    const user = db.first<{ id: string; username: string; password_hash: string; role_id: string; is_active: number }>(
      "SELECT id, username, password_hash, role_id, is_active FROM users WHERE (username = ? COLLATE NOCASE OR user_code = ? COLLATE NOCASE) AND is_active = 1",
      [input.username.trim(), input.username.trim()],
    );
    if (!user) {
      throw errUnauthorized();
    }
    const isManagerOrOwner =
      user.role_id === "owner" ||
      user.role_id === "manager" ||
      roleHasPermission(user.role_id as RoleId, "members.view_all_departments");
    if (!isManagerOrOwner) {
      throw errForbidden("errors.managerOverrideNotAuthorized");
    }
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) {
      throw errUnauthorized();
    }
    authorizedUser = {
      id: user.id,
      username: user.username,
      role_id: user.role_id as RoleId,
    };
  } else {
    throw errValidation("errors.invalidCredentials");
  }

  const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

  recordAudit(db, actor, "MANAGER_OVERRIDE", input.entityType ?? "system", input.entityId ?? null, {
    authorizedBy: authorizedUser.username,
    managerRole: authorizedUser.role_id,
    reason: input.reason ?? "cross_department",
  });

  return {
    success: true,
    authorizedBy: authorizedUser.username,
    managerId: authorizedUser.id,
    roleId: authorizedUser.role_id,
    token,
  };
}

export function setManagerOverridePin(db: Db, actor: ServiceActor, pin: string): void {
  requirePermission(actor, "settings.edit");
  const trimmed = pin.trim();
  if (trimmed && !/^\d{4,6}$/.test(trimmed)) {
    throw errValidation("errors.managerOverrideInvalidPin");
  }
  writeSettingInternal(db, SETTING_MANAGER_PIN, trimmed);
  recordAudit(db, actor, "SETTINGS_UPDATED", "setting", SETTING_MANAGER_PIN, {
    value: trimmed ? "***" : "",
  });
}

export function hasManagerOverridePin(db: Db): boolean {
  const pin = readSetting(db, SETTING_MANAGER_PIN);
  return Boolean(pin && pin.trim().length >= 4);
}
