import { errValidation } from "@/core/errors";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { recordAudit } from "./audit.service";
import type { Db, Row } from "@/db/engine";

export const SETTING_KEYS = {
  gymName: "gym_name",
  currencySymbol: "currency_symbol",
  duplicateWindowSeconds: "checkin_duplicate_window_seconds",
  demoSeeded: "demo_seeded",
  gymPhone: "gym_phone",
  gymAddress: "gym_address",
  workingHours: "working_hours_text",
  workingDays: "working_days",
  scannerEnabled: "scanner_enabled",
  scannerPrefix: "scanner_prefix",
  scannerSuffix: "scanner_suffix",
  scannerMinLength: "scanner_min_length",
  scannerTimeoutMs: "scanner_timeout_ms",
  notifyExpiryDays: "notify_expiry_days",
  soundEnabled: "sound_enabled",
  dateFormat: "date_format",
  timeFormat: "time_format",
  backupAutoIntervalHours: "backup_auto_interval_hours",
  backupRetentionCount: "backup_retention_count",
  inactiveDays: "inactive_days",
  checkoutEnabled: "attendance_checkout_enabled",
  freezeExtendsExpiry: "freeze_extends_expiry",
  whatsappEnabled: "whatsapp_enabled",
  whatsappApiUrl: "whatsapp_api_url",
  allowNegativeStock: "allow_negative_stock",
} as const;

export type SettingKey = (string & {}) | (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface KeySpec {
  validate: (value: string) => string;
}

const PRINTABLE_RE = /^[\x20-\x7e]{0,8}$/;
const WORKING_DAYS_RE = /^[0-6](,[0-6])*$/;

function intInRange(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw errValidation("errors.settingValueInvalid", { min: String(min), max: String(max) });
  }
  return parsed;
}

const SPECS: Record<string, KeySpec> = {
  [SETTING_KEYS.gymName]: { validate: (v) => v },
  [SETTING_KEYS.currencySymbol]: { validate: (v) => v },
  [SETTING_KEYS.duplicateWindowSeconds]: {
    validate: (v) => String(intInRange(v, 0, 3600)),
  },
  [SETTING_KEYS.gymPhone]: { validate: (v) => v },
  [SETTING_KEYS.gymAddress]: { validate: (v) => v },
  [SETTING_KEYS.workingHours]: { validate: (v) => v.slice(0, 120) },
  [SETTING_KEYS.workingDays]: {
    validate: (v) => {
      if (!WORKING_DAYS_RE.test(v)) throw errValidation("errors.settingWorkingDaysInvalid");
      return v;
    },
  },
  [SETTING_KEYS.scannerEnabled]: {
    validate: (v) => {
      if (v !== "1" && v !== "0") throw errValidation("errors.settingBoolInvalid");
      return v;
    },
  },
  [SETTING_KEYS.scannerPrefix]: {
    validate: (v) => {
      if (!PRINTABLE_RE.test(v)) throw errValidation("errors.settingPrefixInvalid");
      return v;
    },
  },
  [SETTING_KEYS.scannerSuffix]: {
    validate: (v) => {
      if (!PRINTABLE_RE.test(v)) throw errValidation("errors.settingSuffixInvalid");
      return v;
    },
  },
  [SETTING_KEYS.scannerMinLength]: { validate: (v) => String(intInRange(v, 1, 64)) },
  [SETTING_KEYS.scannerTimeoutMs]: { validate: (v) => String(intInRange(v, 200, 20000)) },
  [SETTING_KEYS.notifyExpiryDays]: {
    validate: (v) => {
      const parts = v.split(",");
      if (parts.length === 0 || parts.length > 5) throw errValidation("errors.settingExpiryDaysInvalid");
      for (const part of parts) {
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          throw errValidation("errors.settingExpiryDaysInvalid");
        }
      }
      const unique = [...new Set(parts.map((p) => Number(p)))].sort((a, b) => a - b);
      return unique.join(",");
    },
  },
  [SETTING_KEYS.soundEnabled]: {
    validate: (v) => {
      if (v !== "1" && v !== "0") throw errValidation("errors.settingBoolInvalid");
      return v;
    },
  },
  [SETTING_KEYS.dateFormat]: {
    validate: (v) => {
      if (v !== "dmy" && v !== "mdy" && v !== "ymd") throw errValidation("errors.settingDateFormatInvalid");
      return v;
    },
  },
  [SETTING_KEYS.timeFormat]: {
    validate: (v) => {
      if (v !== "24h" && v !== "12h") throw errValidation("errors.settingTimeFormatInvalid");
      return v;
    },
  },
  [SETTING_KEYS.backupAutoIntervalHours]: { validate: (v) => String(intInRange(v, 0, 720)) },
  [SETTING_KEYS.backupRetentionCount]: { validate: (v) => String(intInRange(v, 1, 50)) },
  [SETTING_KEYS.inactiveDays]: { validate: (v) => String(intInRange(v, 1, 365)) },
  [SETTING_KEYS.checkoutEnabled]: {
    validate: (v) => {
      if (v !== "1" && v !== "0") throw errValidation("errors.settingBoolInvalid");
      return v;
    },
  },
  [SETTING_KEYS.freezeExtendsExpiry]: {
    validate: (v) => {
      if (v !== "1" && v !== "0") throw errValidation("errors.settingBoolInvalid");
      return v;
    },
  },
  [SETTING_KEYS.whatsappEnabled]: {
    validate: (v) => {
      if (v !== "1" && v !== "0") throw errValidation("errors.settingBoolInvalid");
      return v;
    },
  },
  [SETTING_KEYS.whatsappApiUrl]: {
    validate: (v) => {
      if (!/^https?:\/\/.{1,300}$/.test(v)) throw errValidation("errors.settingWhatsappUrlInvalid");
      return v;
    },
  },
};

const EDITABLE_KEYS = new Set<string>(Object.keys(SPECS));

interface SettingRow extends Row {
  key: string;
  value: string;
}

export function readAllSettings(db: Db, actor: ServiceActor): Record<string, string> {
  requirePermission(actor, "settings.view");
  const rows = db.all<SettingRow>("SELECT key, value FROM settings");
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function readSetting(db: Db, key: string): string | null {
  const row = db.first<SettingRow>("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : null;
}

export function writeSettingInternal(db: Db, key: string, value: string): void {
  db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?)\nON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export function writeSettingInternalIfMissing(db: Db, key: string, value: string): void {
  if (readSetting(db, key) == null) writeSettingInternal(db, key, value);
}

export async function updateSetting(
  db: Db,
  actor: ServiceActor,
  key: string,
  value: string,
): Promise<void> {
  requirePermission(actor, "settings.edit");
  if (!EDITABLE_KEYS.has(key)) throw errValidation("errors.settingKeyInvalid", { key });
  const spec = SPECS[key];
  if (!spec) throw errValidation("errors.settingKeyInvalid", { key });
  const trimmed = value.trim();
  if (trimmed === "") throw errValidation("errors.settingValueRequired");
  const normalized = spec.validate(trimmed);
  await db.transaction(async () => {
    writeSettingInternal(db, key, normalized);
    recordAudit(db, actor, "SETTINGS_UPDATED", "setting", key, { value: normalized });
  });
}

function toBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return raw === "1";
}

function toInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.round(parsed);
}

export interface ScannerConfig {
  enabled: boolean;
  prefix: string;
  suffix: string;
  minLength: number;
  timeoutMs: number;
  maxKeyIntervalMs: number;
}

export function getScannerConfig(db: Db): ScannerConfig {
  return {
    enabled: toBool(readSetting(db, SETTING_KEYS.scannerEnabled), true),
    prefix: readSetting(db, SETTING_KEYS.scannerPrefix) ?? "",
    suffix: readSetting(db, SETTING_KEYS.scannerSuffix) ?? "",
    minLength: toInt(readSetting(db, SETTING_KEYS.scannerMinLength), 4, 1, 64),
    timeoutMs: toInt(readSetting(db, SETTING_KEYS.scannerTimeoutMs), 5000, 200, 20000),
    maxKeyIntervalMs: 80,
  };
}

export function getExpiryThresholds(db: Db): number[] {
  const raw = readSetting(db, SETTING_KEYS.notifyExpiryDays);
  const fallback = [1, 3, 7];
  if (raw == null) return fallback;
  const parsed = raw
    .split(",")
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  if (parsed.length === 0) return fallback;
  return [...new Set(parsed)].sort((a, b) => a - b);
}

export function isSoundEnabled(db: Db): boolean {
  return toBool(readSetting(db, SETTING_KEYS.soundEnabled), false);
}

export interface BackupConfig {
  autoIntervalHours: number;
  retentionCount: number;
}

export function getBackupConfig(db: Db, actor: ServiceActor): BackupConfig {
  requirePermission(actor, "settings.view");
  return {
    autoIntervalHours: toInt(readSetting(db, SETTING_KEYS.backupAutoIntervalHours), 24, 0, 720),
    retentionCount: toInt(readSetting(db, SETTING_KEYS.backupRetentionCount), 10, 1, 50),
  };
}

export function getWorkingDays(db: Db): number[] {
  const raw = readSetting(db, SETTING_KEYS.workingDays);
  const fallback = [0, 1, 2, 3, 4];
  if (raw == null || !WORKING_DAYS_RE.test(raw)) return fallback;
  return [...new Set(raw.split(",").map((d) => Number(d)))].sort((a, b) => a - b);
}

export function getInactiveDays(db: Db): number {
  return toInt(readSetting(db, SETTING_KEYS.inactiveDays), 7, 1, 365);
}

export function isCheckoutEnabled(db: Db): boolean {
  return toBool(readSetting(db, SETTING_KEYS.checkoutEnabled), false);
}

export function freezeExtendsExpiry(db: Db): boolean {
  return toBool(readSetting(db, SETTING_KEYS.freezeExtendsExpiry), true);
}

export interface WhatsAppConfig {
  enabled: boolean;
  apiUrl: string;
}

export function getWhatsAppConfig(db: Db): WhatsAppConfig {
  return {
    enabled:
      toBool(readSetting(db, SETTING_KEYS.whatsappEnabled), false) &&
      (readSetting(db, SETTING_KEYS.whatsappApiUrl) ?? "") !== "",
    apiUrl: readSetting(db, SETTING_KEYS.whatsappApiUrl) ?? "",
  };
}
