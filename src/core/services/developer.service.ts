import type { Db } from "@/db/engine";
import { nowStamp } from "@/core/dates";
import type { ServiceActor } from "@/core/permissions";
import { errForbidden, errNotFound, errValidation } from "@/core/errors";
import { recordAudit } from "@/core/services/audit.service";
import { readSetting, writeSettingInternal, SETTING_KEYS } from "@/core/services/settings.service";
import { getUserRowById, toPublicUser, type PublicUser } from "@/core/services/users.service";
import { assessPasswordStrength, hashPassword } from "@/core/auth/password";
import { seedDemoData } from "@/db/seed";

const DEV_USERNAME = "kotb";
const DEV_DEFAULT_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$5Z8tOyoCX6o3W4XXt+oQow$aILAoeOLDejDQdLYOWx+4TjYdiBHLI1XXHRLsZ5SMtg";

export interface DeveloperOverviewUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roleId: string;
  department: string | null;
  isActive: boolean;
  isDeveloper: boolean;
  createdAt: string;
}

export interface DeveloperOverview {
  systemReadOnly: boolean;
  users: DeveloperOverviewUser[];
  stats: {
    membersCount: number;
    subscriptionsCount: number;
    paymentsCount: number;
    dbSizeBytes: number;
  };
}

export function isDeveloperActor(actor: ServiceActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isDeveloper === true || actor.username.toLowerCase() === DEV_USERNAME;
}

export function ensureDeveloperAccount(db: Db): void {
  const existing = db.first<{ id: string; is_active: number }>(
    "SELECT id, is_active FROM users WHERE username = ? COLLATE NOCASE",
    [DEV_USERNAME],
  );
  const stamp = nowStamp();
  if (!existing) {
    db.run(
      "INSERT INTO users (id, username, email, password_hash, full_name, role_id, department, is_active, is_developer, created_at, updated_at)\n" +
        "VALUES ('dev-kotb-superadmin', ?, 'kotb.dev@gymsystem.local', ?, 'مطور النظام', 'owner', 'general', 1, 1, ?, ?)",
      [DEV_USERNAME, DEV_DEFAULT_HASH, stamp, stamp],
    );
  } else {
    db.run(
      "UPDATE users SET is_developer = 1, is_active = 1, role_id = 'owner', updated_at = ? WHERE id = ?",
      [stamp, existing.id],
    );
  }
}

export function getDeveloperOverview(
  db: Db,
  actor: ServiceActor,
  dbSizeBytes = 0,
): DeveloperOverview {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const readOnly = readSetting(db, SETTING_KEYS.systemReadOnly) === "1";
  const rows = db.all<{
    id: string;
    username: string;
    full_name: string;
    email: string | null;
    role_id: string;
    department: string | null;
    is_active: number;
    is_developer?: number;
    created_at: string;
  }>(
    "SELECT id, username, full_name, email, role_id, department, is_active, is_developer, created_at FROM users ORDER BY is_developer DESC, created_at ASC",
  );

  const users: DeveloperOverviewUser[] = rows.map((r) => ({
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    email: r.email,
    roleId: r.role_id,
    department: r.department,
    isActive: Number(r.is_active) === 1,
    isDeveloper: Number(r.is_developer ?? 0) === 1 || r.username.toLowerCase() === DEV_USERNAME,
    createdAt: r.created_at,
  }));

  const membersCount = db.count("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL");
  const subscriptionsCount = db.count("SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active'");
  const paymentsCount = db.count("SELECT COUNT(*) FROM payments");

  return {
    systemReadOnly: readOnly,
    users,
    stats: {
      membersCount,
      subscriptionsCount,
      paymentsCount,
      dbSizeBytes,
    },
  };
}

export function setSystemReadOnly(
  db: Db,
  actor: ServiceActor,
  enabled: boolean,
): { systemReadOnly: boolean } {
  if (!isDeveloperActor(actor)) throw errForbidden();
  writeSettingInternal(db, SETTING_KEYS.systemReadOnly, enabled ? "1" : "0");
  recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "settings", "system_readonly", {
    enabled,
  });
  return { systemReadOnly: enabled };
}

export async function toggleUserActive(
  db: Db,
  actor: ServiceActor,
  userId: string,
  isActive: boolean,
): Promise<PublicUser> {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");

  if (actor.userId === userId && !isActive) {
    throw errValidation("errors.cannotDeactivateSelf");
  }

  await db.transaction(async () => {
    db.run(
      "UPDATE users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [isActive ? 1 : 0, nowStamp(), userId],
    );
    if (!isActive) {
      db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
    }
    recordAudit(db, actor, isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", "user", userId, {
      byDeveloper: true,
    });
  });

  const fresh = getUserRowById(db, userId);
  if (!fresh) throw errNotFound("errors.userNotFound");
  return toPublicUser(fresh);
}

export function suspendAllNonDevUsers(db: Db, actor: ServiceActor): { affected: number } {
  if (!isDeveloperActor(actor)) throw errForbidden();
  let affected = 0;
  db.transaction(() => {
    const rows = db.all<{ id: string }>(
      "SELECT id FROM users WHERE COALESCE(is_developer, 0) = 0 AND username != ? COLLATE NOCASE AND is_active = 1",
      [DEV_USERNAME],
    );
    affected = rows.length;
    db.run(
      "UPDATE users SET is_active = 0, updated_at = ? WHERE COALESCE(is_developer, 0) = 0 AND username != ? COLLATE NOCASE",
      [nowStamp(), DEV_USERNAME],
    );
    db.run(
      "DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE COALESCE(is_developer, 0) = 0 AND username != ? COLLATE NOCASE)",
      [DEV_USERNAME],
    );
    recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "users", "all", {
      action: "suspend_all_users",
      affected,
    });
  });
  return { affected };
}

export function activateAllUsers(db: Db, actor: ServiceActor): { affected: number } {
  if (!isDeveloperActor(actor)) throw errForbidden();
  let affected = 0;
  db.transaction(() => {
    const rows = db.all<{ id: string }>("SELECT id FROM users WHERE is_active = 0");
    affected = rows.length;
    db.run(
      "UPDATE users SET is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE is_active = 0",
      [nowStamp()],
    );
    recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "users", "all", {
      action: "activate_all_users",
      affected,
    });
  });
  return { affected };
}

export async function devResetUserPassword(
  db: Db,
  actor: ServiceActor,
  userId: string,
  newPass: string,
): Promise<void> {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");
  const weakness = assessPasswordStrength(newPass);
  if (weakness) throw errValidation(weakness);

  const hash = await hashPassword(newPass);
  await db.transaction(async () => {
    db.run(
      "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [hash, nowStamp(), userId],
    );
    db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
    recordAudit(db, actor, "USER_PASSWORD_RESET", "user", userId, { byDeveloper: true });
  });
}

export function devDeleteUser(
  db: Db,
  actor: ServiceActor,
  userId: string,
): { success: boolean; deletedUsername: string } {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const row = getUserRowById(db, userId);
  if (!row) throw errNotFound("errors.userNotFound");

  if (row.is_developer || row.username.toLowerCase() === DEV_USERNAME) {
    throw errValidation("errors.cannotDeleteDeveloper");
  }
  if (actor.userId === userId) {
    throw errValidation("errors.cannotDeleteSelf");
  }

  db.transaction(() => {
    // 1. Destroy all active sessions
    db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);

    // 2. Safely detach or reassign foreign keys pointing to users(id)
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );

    for (const { name } of tables) {
      if (name === "users" || name === "auth_sessions") continue;
      try {
        const fks = db.all<{ table: string; from: string; to: string }>(
          `PRAGMA foreign_key_list(${name})`,
        );
        for (const fk of fks) {
          if (fk.table.toLowerCase() === "users") {
            const colInfo = db.all<{ name: string; notnull: number }>(`PRAGMA table_info(${name})`);
            const col = colInfo.find((c) => c.name === fk.from);
            if (col && col.notnull === 1) {
              db.run(`UPDATE ${name} SET ${fk.from} = ? WHERE ${fk.from} = ?`, [actor.userId, userId]);
            } else {
              db.run(`UPDATE ${name} SET ${fk.from} = NULL WHERE ${fk.from} = ?`, [userId]);
            }
          }
        }
      } catch {
        /* best effort across dynamic schema / views */
      }
    }

    // 3. Delete the user
    db.run("DELETE FROM users WHERE id = ?", [userId]);

    recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "user", userId, {
      action: "delete_user",
      username: row.username,
      byDeveloper: true,
    });
  });

  return { success: true, deletedUsername: row.username };
}

export async function devSeedDemoData(
  db: Db,
  actor: ServiceActor,
): Promise<{ success: boolean; membersCount: number; subscriptionsCount: number }> {
  if (!isDeveloperActor(actor)) throw errForbidden();

  await seedDemoData(db);

  const membersCount = Number(db.scalar("SELECT COUNT(*) FROM members WHERE deleted_at IS NULL") ?? 0);
  const subscriptionsCount = Number(db.scalar("SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active'") ?? 0);

  recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "system", "demo_seed", {
    action: "seed_demo_data",
    membersCount,
    subscriptionsCount,
    byDeveloper: true,
  });

  return { success: true, membersCount, subscriptionsCount };
}

export interface DbIntegrityResult {
  integrity: string;
  foreignKeysOk: boolean;
  fkViolations: Array<{ table: string; rowid: number; parent: string; fkid: number }>;
}

export function devRunIntegrityCheck(db: Db, actor: ServiceActor): DbIntegrityResult {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const integrity = String(db.scalar("PRAGMA integrity_check") ?? "unknown");
  const fkViolations = db.all<{ table: string; rowid: number; parent: string; fkid: number }>(
    "PRAGMA foreign_key_check",
  );
  recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "database", "integrity_check", {
    integrity,
    fkViolationCount: fkViolations.length,
  });
  return {
    integrity,
    foreignKeysOk: fkViolations.length === 0,
    fkViolations,
  };
}

export function devVacuumDatabase(db: Db, actor: ServiceActor): { success: boolean } {
  if (!isDeveloperActor(actor)) throw errForbidden();
  db.exec("VACUUM");
  recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "database", "vacuum", { success: true });
  return { success: true };
}

export async function devResetOwnerEmergency(
  db: Db,
  actor: ServiceActor,
  newPass: string,
): Promise<{ success: boolean; username: string }> {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const owner = db.first<{ id: string; username: string }>(
    "SELECT id, username FROM users WHERE role_id = 'owner' AND username != ? COLLATE NOCASE ORDER BY created_at ASC LIMIT 1",
    [DEV_USERNAME],
  );
  if (!owner) throw errNotFound("errors.userNotFound");

  const weakness = assessPasswordStrength(newPass);
  if (weakness) throw errValidation(weakness);

  const hash = await hashPassword(newPass);
  await db.transaction(async () => {
    db.run(
      "UPDATE users SET password_hash = ?, is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [hash, nowStamp(), owner.id],
    );
    db.run("DELETE FROM auth_sessions WHERE user_id = ?", [owner.id]);
    recordAudit(db, actor, "USER_PASSWORD_RESET", "user", owner.id, {
      byDeveloper: true,
      emergencyOwnerReset: true,
    });
  });

  return { success: true, username: owner.username };
}

export interface FeatureFlags {
  featureAttendanceEnabled: boolean;
  featureMembersEnabled: boolean;
  featureSubscriptionsEnabled: boolean;
  featureCardsEnabled: boolean;
  featureTreasuryEnabled: boolean;
  featureExpensesEnabled: boolean;
  featurePosEnabled: boolean;
  featureReportsEnabled: boolean;
  featureClassesEnabled: boolean;
  featureInbodyEnabled: boolean;
  featureWhatsappEnabled: boolean;
  featureCrmEnabled: boolean;
  featureLoyaltyEnabled: boolean;
  featureReferralsEnabled: boolean;
  featureEmployeesEnabled: boolean;
  featureHrCheckinEnabled: boolean;
  featureMultibranchEnabled: boolean;
}

export function getFeatureFlags(db: Db, actor: ServiceActor): FeatureFlags {
  if (!isDeveloperActor(actor)) throw errForbidden();
  return {
    featureAttendanceEnabled: (readSetting(db, SETTING_KEYS.featureAttendanceEnabled) ?? "1") !== "0",
    featureMembersEnabled: (readSetting(db, SETTING_KEYS.featureMembersEnabled) ?? "1") !== "0",
    featureSubscriptionsEnabled: (readSetting(db, SETTING_KEYS.featureSubscriptionsEnabled) ?? "1") !== "0",
    featureCardsEnabled: (readSetting(db, SETTING_KEYS.featureCardsEnabled) ?? "1") !== "0",
    featureTreasuryEnabled: (readSetting(db, SETTING_KEYS.featureTreasuryEnabled) ?? "1") !== "0",
    featureExpensesEnabled: (readSetting(db, SETTING_KEYS.featureExpensesEnabled) ?? "1") !== "0",
    featurePosEnabled: (readSetting(db, SETTING_KEYS.featurePosEnabled) ?? "1") !== "0",
    featureReportsEnabled: (readSetting(db, SETTING_KEYS.featureReportsEnabled) ?? "1") !== "0",
    featureClassesEnabled: (readSetting(db, SETTING_KEYS.featureClassesEnabled) ?? "1") !== "0",
    featureInbodyEnabled: (readSetting(db, SETTING_KEYS.featureInbodyEnabled) ?? "1") !== "0",
    featureWhatsappEnabled: (readSetting(db, SETTING_KEYS.featureWhatsappEnabled) ?? "1") !== "0",
    featureCrmEnabled: (readSetting(db, SETTING_KEYS.featureCrmEnabled) ?? "1") !== "0",
    featureLoyaltyEnabled: (readSetting(db, SETTING_KEYS.featureLoyaltyEnabled) ?? "1") !== "0",
    featureReferralsEnabled: (readSetting(db, SETTING_KEYS.featureReferralsEnabled) ?? "1") !== "0",
    featureEmployeesEnabled: (readSetting(db, SETTING_KEYS.featureEmployeesEnabled) ?? "1") !== "0",
    featureHrCheckinEnabled: (readSetting(db, SETTING_KEYS.featureHrCheckinEnabled) ?? "1") !== "0",
    featureMultibranchEnabled: (readSetting(db, SETTING_KEYS.featureMultibranchEnabled) ?? "1") !== "0",
  };
}

export function setFeatureFlag(
  db: Db,
  actor: ServiceActor,
  flag: keyof FeatureFlags,
  enabled: boolean,
): FeatureFlags {
  if (!isDeveloperActor(actor)) throw errForbidden();
  const settingKeyMap: Record<keyof FeatureFlags, (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]> = {
    featureAttendanceEnabled: SETTING_KEYS.featureAttendanceEnabled,
    featureMembersEnabled: SETTING_KEYS.featureMembersEnabled,
    featureSubscriptionsEnabled: SETTING_KEYS.featureSubscriptionsEnabled,
    featureCardsEnabled: SETTING_KEYS.featureCardsEnabled,
    featureTreasuryEnabled: SETTING_KEYS.featureTreasuryEnabled,
    featureExpensesEnabled: SETTING_KEYS.featureExpensesEnabled,
    featurePosEnabled: SETTING_KEYS.featurePosEnabled,
    featureReportsEnabled: SETTING_KEYS.featureReportsEnabled,
    featureClassesEnabled: SETTING_KEYS.featureClassesEnabled,
    featureInbodyEnabled: SETTING_KEYS.featureInbodyEnabled,
    featureWhatsappEnabled: SETTING_KEYS.featureWhatsappEnabled,
    featureCrmEnabled: SETTING_KEYS.featureCrmEnabled,
    featureLoyaltyEnabled: SETTING_KEYS.featureLoyaltyEnabled,
    featureReferralsEnabled: SETTING_KEYS.featureReferralsEnabled,
    featureEmployeesEnabled: SETTING_KEYS.featureEmployeesEnabled,
    featureHrCheckinEnabled: SETTING_KEYS.featureHrCheckinEnabled,
    featureMultibranchEnabled: SETTING_KEYS.featureMultibranchEnabled,
  };
  const key = settingKeyMap[flag];
  if (!key) throw errValidation("errors.settingKeyInvalid");
  writeSettingInternal(db, key, enabled ? "1" : "0");
  recordAudit(db, actor, "DEVELOPER_ACTION_EXECUTED", "feature_flag", flag, { enabled });
  return getFeatureFlags(db, actor);
}



