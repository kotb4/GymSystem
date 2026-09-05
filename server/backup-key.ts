import { errValidation } from "../src/core/errors";
import { requirePermission, type ServiceActor } from "../src/core/permissions";
import type { Db } from "../src/db/engine";
import { recordAudit } from "../src/core/services/audit.service";
import { readSetting, writeSettingInternal, SETTING_KEYS, parseRetentionPolicy } from "../src/core/services/settings.service";
import { loadBackupKey, storeBackupKey, deleteBackupKey, backupKeyExists, verifyStoredPassword, makeMasterKeyParams, MIN_BACKUP_PASSWORD_LENGTH, MAX_BACKUP_PASSWORD_LENGTH, type BackupKeyRef } from "./backup-crypto";
import { getDbContext, logLine } from "./context";

/**
 * Backup-encryption lifecycle (TASK-042). These run server-side because the
 * DPAPI-wrapped master key lives in the server's config dir; the DB only
 * records intent flags (`backup_encryption_enabled`, `backup_password_set`).
 */

export interface BackupSecurityStatus {
  encryptEnabled: boolean;
  passwordSet: boolean;
  keyExists: boolean;
  source: "password" | "key" | null;
  autoEnabled: boolean;
  intervalHours: number;
  location: string;
  retentionPolicy: { daily: number; weekly: number; monthly: number };
  retentionCount: number;
}

function readBool(key: string): boolean {
  try {
    return readSetting(getDbContext().db, key) === "1";
  } catch {
    return false;
  }
}

export function getBackupSecurityStatus(db: Db, actor: ServiceActor): BackupSecurityStatus {
  requirePermission(actor, "settings.view");
  const { dirs } = getDbContext();
  const ref = backupKeyExists(dirs.configDir) ? loadBackupKey(dirs.configDir) : null;
  return {
    encryptEnabled: readBool(SETTING_KEYS.backupEncryptionEnabled),
    passwordSet: readBool(SETTING_KEYS.backupPasswordSet),
    keyExists: ref !== null,
    source: ref?.source ?? null,
    autoEnabled: readBool(SETTING_KEYS.backupAutoEnabled),
    intervalHours: Number(readSetting(db, SETTING_KEYS.backupAutoIntervalHours) ?? 24),
    location: readSetting(db, SETTING_KEYS.backupLocation) ?? "",
    retentionPolicy: parseRetentionPolicy(readSetting(db, SETTING_KEYS.backupRetentionPolicy)),
    retentionCount: Number(readSetting(db, SETTING_KEYS.backupRetentionCount) ?? 10),
  };
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < MIN_BACKUP_PASSWORD_LENGTH || password.length > MAX_BACKUP_PASSWORD_LENGTH) {
    throw errValidation("errors.backupPasswordLength", {
      min: String(MIN_BACKUP_PASSWORD_LENGTH),
      max: String(MAX_BACKUP_PASSWORD_LENGTH),
    });
  }
  if (/[\x00-\x08\x0a-\x1f]/.test(password)) {
    throw errValidation("errors.backupPasswordLength", {
      min: String(MIN_BACKUP_PASSWORD_LENGTH),
      max: String(MAX_BACKUP_PASSWORD_LENGTH),
    });
  }
}

/**
 * Create or replace the password-derived master key and enable encryption.
 * When a password-based key already exists, `currentPassword` must match it.
 */
export async function setBackupPassword(
  db: Db,
  actor: ServiceActor,
  input: { password: string; currentPassword?: string },
): Promise<{ passwordSet: boolean; created: boolean }> {
  requirePermission(actor, "settings.edit");
  validatePassword(input.password);
  const { dirs } = getDbContext();

  const existing = backupKeyExists(dirs.configDir) ? loadBackupKey(dirs.configDir) : null;
  if (existing && existing.source === "password") {
    const ok = await verifyStoredPassword(dirs.configDir, input.currentPassword ?? "");
    if (!ok) throw errValidation("errors.backupCurrentPasswordWrong");
  }

  const { masterKey, params } = await makeMasterKeyParams(input.password);
  const ref: BackupKeyRef = { source: "password", masterKey, kdf: params };
  storeBackupKey(dirs.configDir, ref);

  writeSettingInternal(db, SETTING_KEYS.backupEncryptionEnabled, "1");
  writeSettingInternal(db, SETTING_KEYS.backupPasswordSet, "1");
  recordAudit(db, actor, "BACKUP_PASSWORD_SET", "backup", "encryption", {
    action: existing ? "changed" : "set",
  });
  logLine("backup key: password-derived master key stored (DPAPI-wrapped)");
  return { passwordSet: true, created: !existing };
}

/**
 * Disable + delete the stored master key. Password-based keys require the
 * correct password to be cleared.
 */
export async function clearBackupEncryption(
  db: Db,
  actor: ServiceActor,
  input: { password?: string },
): Promise<{ passwordSet: boolean }> {
  requirePermission(actor, "settings.edit");
  const { dirs } = getDbContext();

  const existing = backupKeyExists(dirs.configDir) ? loadBackupKey(dirs.configDir) : null;
  if (existing && existing.source === "password" && readBool(SETTING_KEYS.backupPasswordSet)) {
    const ok = await verifyStoredPassword(dirs.configDir, input.password ?? "");
    if (!ok) throw errValidation("errors.backupWrongPassword");
  }

  const removed = deleteBackupKey(dirs.configDir);
  writeSettingInternal(db, SETTING_KEYS.backupEncryptionEnabled, "0");
  writeSettingInternal(db, SETTING_KEYS.backupPasswordSet, "0");
  recordAudit(db, actor, "BACKUP_ENCRYPTION_CHANGED", "backup", "encryption", {
    enabled: false,
    keyRemoved: removed,
  });
  logLine("backup key: encryption disabled and master key removed");
  return { passwordSet: false };
}