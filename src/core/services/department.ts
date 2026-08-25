import { errForbidden } from "@/core/errors";
import {
  roleHasPermission,
  type DepartmentScope,
  type ServiceActor,
} from "@/core/permissions";

/**
 * Department data isolation enforced at the service layer (never the UI).
 * Bypass rules: owner role, an explicit `members.view_all_departments`
 * grant, or a staff account scoped to 'general'. Otherwise a men/women
 * account may only touch members of its own section or section-less
 * ('general') records.
 */

export function mayBypassDepartment(actor: ServiceActor): boolean {
  return (
    actor.roleId === "owner" ||
    roleHasPermission(actor.roleId, "members.view_all_departments")
  );
}

function effectiveDepartment(actor: ServiceActor): DepartmentScope {
  return (actor.department ?? "general") as DepartmentScope;
}

/** IDOR guard for single-member operations; throws FORBIDDEN on cross-section access. */
export function assertDepartmentAccess(
  actor: ServiceActor,
  memberDepartment: string | null,
): void {
  if (mayBypassDepartment(actor)) return;
  const dept = effectiveDepartment(actor);
  if (dept === "general") return;
  const memberDept = memberDepartment ?? "general";
  if (memberDept !== dept && memberDept !== "general") {
    throw errForbidden();
  }
}

/** WHERE-fragment for list queries; alias must point at the members table. */
export function departmentScopeCondition(
  actor: ServiceActor,
  alias = "m",
): { sql: string; params: string[] } {
  if (mayBypassDepartment(actor)) return { sql: "", params: [] };
  const dept = effectiveDepartment(actor);
  if (dept === "general") return { sql: "", params: [] };
  return {
    sql: ` AND ${alias}.department IN (?, 'general')`,
    params: [dept],
  };
}

/** Resolves a member's department by id, treating unknown ids as 'general'. */
export function memberDepartmentById(db: import("@/db/engine").Db, memberId: string): string {
  return (
    db.first<{ department: string }>(
      "SELECT department FROM members WHERE id = ?",
      [memberId],
    )?.department ?? "general"
  );
}
