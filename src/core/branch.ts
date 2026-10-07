import type { Db } from "@/db/engine";

/**
 * Returns the current local branch_id from branch_info, falling back to 'main'.
 */
export function getLocalBranchId(db: Db): string {
  try {
    const row = db.first<{ branch_id: string }>("SELECT branch_id FROM branch_info LIMIT 1");
    return row?.branch_id || "main";
  } catch {
    return "main";
  }
}

/**
 * Returns the configured branch prefix for member codes & cards, falling back to empty string.
 */
export function getLocalBranchPrefix(db: Db): string {
  try {
    const row = db.first<{ branch_prefix: string }>("SELECT branch_prefix FROM branch_info LIMIT 1");
    return row?.branch_prefix ? row.branch_prefix.trim().toUpperCase() : "";
  } catch {
    return "";
  }
}
