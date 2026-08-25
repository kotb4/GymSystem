import { errValidation } from "@/core/errors";
import {
  ROLES,
  PERMS,
  setDbGrants,
  requirePermission,
  type Permission,
  type RoleId,
  type ServiceActor,
} from "@/core/permissions";
import type { Db } from "@/db/engine";
import { recordAudit } from "./audit.service";

interface RolePermRow {
  role_id: string;
  permission_code: string;
}

export function loadPermissionsCache(db: Db): void {
  const rows = db.all<RolePermRow>("SELECT role_id, permission_code FROM role_permissions");
  const map: Record<string, Set<Permission>> = {};
  for (const role of ROLES) map[role] = new Set();
  for (const row of rows) {
    map[row.role_id]?.add(row.permission_code as Permission);
  }
  setDbGrants(map as Record<string, ReadonlySet<Permission>>);
}

export function getRolePermissions(db: Db, actor: ServiceActor): Record<RoleId, Permission[]> {
  requirePermission(actor, "users.view");
  const rows = db.all<RolePermRow>("SELECT role_id, permission_code FROM role_permissions");
  const result: Partial<Record<RoleId, Permission[]>> = {};
  for (const role of ROLES) result[role] = [];
  for (const row of rows) {
    result[row.role_id as RoleId]?.push(row.permission_code as Permission);
  }
  return result as Record<RoleId, Permission[]>;
}

export function getAllPermissions(db: Db, actor: ServiceActor): Permission[] {
  requirePermission(actor, "users.view");
  void db;
  return [...PERMS];
}

export function setRolePermissions(
  db: Db,
  actor: ServiceActor,
  roleId: RoleId,
  perms: Permission[],
): void {
  requirePermission(actor, "settings.edit");
  if (roleId === "owner") return;
  if (!ROLES.includes(roleId)) throw errValidation("errors.invalidRole");

  for (const perm of perms) {
    if (!PERMS.includes(perm)) throw errValidation("errors.invalidPermission");
  }

  db.transaction(() => {
    db.run("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    for (const perm of perms) {
      db.run(
        "INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)",
        [roleId, perm],
      );
    }
    recordAudit(db, actor, "SETTINGS_UPDATED", "role", roleId, { count: perms.length });
  });
}
