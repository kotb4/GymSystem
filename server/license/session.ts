import fs from "node:fs";
import path from "node:path";
import { evaluate, isHardLocked, needsActivation, advanceLastActive, type LicenseState, type SignedPayload } from "./policy";
import { computeHwId } from "./hwid";
import { parseAndVerifyLicense } from "./crypto";
import { readLicenseState, writeLicenseState, deleteLicenseState, type LicenseStateFile } from "./store";
import { nowStamp } from "../../src/core/dates";
import type { Db, Row } from "../../src/db/engine";

// ---------------------------------------------------------------------------
// License anti-rollback marker (TASK-036-F1). The signed `.lic` and
// `license.json` live in configDir OUTSIDE SQLite, so a user could simply
// delete them to revert to an unlicensed, fully-writable state with no expiry
// ceiling. `license_activation` (a row in gym.db, keyed by HWID) is written
// whenever a VERIFIED payload is active and survives cert/state deletion. When
// no signed payload is present at boot, the marker enforces the recorded grant
// bounds (expiry + grace) and the monotonic last_active clock guard instead of
// falling back to `unlicensed`. Deleting license.json + license.lic therefore
// can neither extend the grant nor re-open writes after it lapsed.
// ---------------------------------------------------------------------------

interface ActivationMarkerRow {
  activatedAt: number;
  issuedAt: number;
  expiresAt: number;
  gym: string | null;
  tier: string | null;
  lastActive: number | null;
}

function readMarker(database: Db | null, hwid: string): ActivationMarkerRow | null {
  if (!database) return null;
  try {
    const row = database.first<Row>(
      "SELECT activated_at, issued_at, expires_at, gym, tier, last_active\nFROM license_activation WHERE hwid = ?",
      [hwid],
    );
    if (!row) return null;
    return {
      activatedAt: Number(row.activated_at),
      issuedAt: Number(row.issued_at),
      expiresAt: Number(row.expires_at),
      gym: row.gym == null ? null : String(row.gym),
      tier: row.tier == null ? null : String(row.tier),
      lastActive: row.last_active == null ? null : Number(row.last_active),
    };
  } catch {
    return null;
  }
}

/** Write/refresh the marker from a VERIFIED payload. Best-effort, never breaks the app. */
function upsertMarker(
  database: Db | null,
  hwid: string,
  payload: SignedPayload | null,
  lastActive: number | null,
): void {
  if (!database || !payload) return;
  try {
    database.run(
      "INSERT INTO license_activation (hwid, activated_at, issued_at, expires_at, gym, tier, last_active, created_at, updated_at)\n" +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n" +
        "ON CONFLICT(hwid) DO UPDATE SET\n" +
        "  issued_at = excluded.issued_at,\n" +
        "  expires_at = excluded.expires_at,\n" +
        "  gym = excluded.gym,\n" +
        "  tier = excluded.tier,\n" +
        "  last_active = MAX(license_activation.last_active, excluded.last_active),\n" +
        "  updated_at = excluded.updated_at",
      [
        hwid,
        Date.now(),
        payload.issuedAt,
        payload.expiresAt,
        payload.gym,
        payload.tier,
        lastActive,
        nowStamp(),
        nowStamp(),
      ],
    );
  } catch {
    /* marker upkeep must never break boot/store */
  }
}

/** Advance the marker's monotonic clock. Best-effort. */
function updateMarkerLastActive(database: Db | null, hwid: string, lastActive: number | null): void {
  if (!database || lastActive == null) return;
  try {
    database.run(
      "UPDATE license_activation SET last_active = MAX(license_activation.last_active, ?), updated_at = ? WHERE hwid = ?",
      [lastActive, nowStamp(), hwid],
    );
  } catch {
    /* best effort */
  }
}

/** Remove the marker. Used ONLY by explicit in-app deactivation (user consent). */
function deleteMarker(database: Db | null, hwid: string): void {
  if (!database) return;
  try {
    database.run("DELETE FROM license_activation WHERE hwid = ?", [hwid]);
  } catch {
    /* best effort */
  }
}

/**
 * Runtime license session. Loaded once at boot; the signed `.lic` is kept at
 * `configDir/license.lic` and re-verified at boot (never trust the state cache
 * payload alone). Provides the single RPC read-only gate.
 */

const LIC_FILE = "license.lic";

export type LicensePublicStatus = {
  state: string;
  hwid: string;
  gym: string | null;
  expiresAt: number | null;
  issuedAt: number | null;
  tier: string | null;
  /** Days left before the license expires (active) or before grace ends (grace). 0 when locked. */
  daysRemaining: number;
  /** Alias kept for backward-compat: days left until the grace window ends. */
  graceDaysRemaining: number | null;
  readOnly: boolean;
  needsActivation: boolean;
  tampered: boolean;
};

let dir: string | null = null;
let db: Db | null = null;
let currentHwid = computeHwId();
let testHwidOverride: string | null = null;
let current: LicenseState = {
  hwid: currentHwid,
  lastActive: null,
  payload: null,
  now: Date.now(),
  filePresent: false,
  signatureValid: false,
};

function emptyState(): LicenseState {
  return {
    hwid: currentHwid,
    lastActive: null,
    payload: null,
    now: Date.now(),
    filePresent: false,
    signatureValid: false,
  };
}

/** Reset module state between boots/tests. */
export function _resetLicenseSession(nextDir?: string, database?: Db | null): void {
  dir = nextDir ?? null;
  db = database ?? null;
  currentHwid = testHwidOverride ?? computeHwId();
  current = emptyState();
}

/** Test-only: pin the expected HWID across boots. Never call in production code. */
export function _overrideHwIdForTest(hwid: string | null): void {
  testHwidOverride = hwid;
  currentHwid = hwid ?? computeHwId();
}

function licFile(dirP: string): string {
  return path.join(dirP, LIC_FILE);
}

function readLicFileBytes(dirP: string): string | null {
  try {
    const file = licFile(dirP);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function writeLicFile(dirP: string, content: string): void {
  fs.mkdirSync(dirP, { recursive: true });
  const file = licFile(dirP);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function deleteLicFile(dirP: string): void {
  const file = licFile(dirP);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function persistCurrent(): void {
  if (!dir) return;
  const file: LicenseStateFile = {
    formatVersion: 1,
    hwid: current.hwid,
    lastActive: current.lastActive,
    payload: current.payload,
  };
  writeLicenseState(dir, file);
  upsertMarker(db, current.hwid, current.payload, current.lastActive);
}

/**
 * Boot-time initialization: load state + .lic, re-verify, evaluate, advance
 * lastActive. Call once after directories are resolved. When an optional Db
 * is provided, the license_activation marker is kept in sync and used as the
 * fallback grant source if the signed files are ever deleted.
 */
export function initLicenseSession(dataDir: string, database?: Db | null): void {
  dir = dataDir;
  db = database ?? null;
  currentHwid = testHwidOverride ?? computeHwId();
  const file = readLicenseState(dir);
  const licBytes = readLicFileBytes(dir);
  const payload = licBytes ? parseAndVerifyLicense(licBytes) : null;
  const marker = payload ? null : readMarker(db, currentHwid);
  if (payload) {
    current = {
      hwid: currentHwid,
      lastActive: file?.lastActive ?? null,
      payload,
      now: Date.now(),
      filePresent: true,
      signatureValid: true,
    };
  } else if (marker) {
    // Signed files are gone, but this HWID was activated before — honour the
    // recorded grant period and keep enforcing the clock guard.
    current = {
      hwid: currentHwid,
      lastActive: marker.lastActive,
      payload: {
        hwid: currentHwid,
        gym: marker.gym ?? "",
        issuedAt: marker.issuedAt,
        expiresAt: marker.expiresAt,
        tier: marker.tier ?? "",
      },
      now: Date.now(),
      filePresent: true,
      signatureValid: true,
    };
  } else {
    current = emptyState();
  }
  const advanced = advanceLastActive(current.lastActive, Date.now());
  if (advanced != null) {
    current.lastActive = advanced;
    persistCurrent();
  } else {
    // Keep the marker self-healing/backfilled even when the clock did not move.
    updateMarkerLastActive(db, currentHwid, current.lastActive);
    upsertMarker(db, currentHwid, payload, current.lastActive);
  }
}

/** Refresh the clock guard (call periodically + on activation). */
export function refreshLicenseClock(): void {
  const advanced = advanceLastActive(current.lastActive, Date.now());
  if (advanced != null) {
    current.lastActive = advanced;
    if (dir) persistCurrent();
  }
}

/** Current in-memory evaluated policy state name. */
export function licenseStateName(): string {
  current.now = Date.now();
  return evaluate(current).name;
}

/** Public status object for the API/banner. */
export function licenseStatus(): LicensePublicStatus {
  current.now = Date.now();
  const ev = evaluate(current);
  const p = current.payload;
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const graceRemaining =
    p != null ? Math.max(0, Math.ceil((p.expiresAt + 5 * DAY - now) / DAY)) : null;
  let daysRemaining = 0;
  if (p != null) {
    if (ev.name === "active") {
      daysRemaining = Math.max(0, Math.ceil((p.expiresAt - now) / DAY));
    } else if (ev.name === "grace") {
      daysRemaining = graceRemaining ?? 0;
    }
  }
  return {
    state: ev.name,
    hwid: currentHwid,
    gym: p?.gym ?? null,
    expiresAt: p?.expiresAt ?? null,
    issuedAt: p?.issuedAt ?? null,
    tier: p?.tier ?? null,
    daysRemaining,
    graceDaysRemaining: graceRemaining,
    readOnly: isHardLocked(current),
    needsActivation: needsActivation(current),
    tampered: ev.name === "tampered",
  };
}

/**
 * Activate with a signed .lic JSON string. Accepts only when the signature
 * verifies AND the payload HWID matches THIS machine. Throws on failure with
 * an i18n-able AppError.
 */
export function activateLicense(licJson: string): LicensePublicStatus {
  return _activateWithPublicKey(licJson);
}

/** Internal/test seam: run activation against an explicit public key (default embedded). */
export function _activateWithPublicKey(licJson: string, publicKeyPem?: string): LicensePublicStatus {
  const payload = parseAndVerifyLicense(licJson, publicKeyPem);
  if (!payload) throw Object.assign(new Error("LICENSE_INVALID"), { code: "LICENSE_INVALID" });
  if (payload.hwid !== currentHwid) {
    throw Object.assign(new Error("LICENSE_HWID_MISMATCH"), { code: "LICENSE_HWID_MISMATCH" });
  }
  if (!dir) throw Object.assign(new Error("LICENSE_NO_DIR"), { code: "LICENSE_NO_DIR" });
  writeLicFile(dir, licJson);
  current = {
    hwid: currentHwid,
    lastActive: null,
    payload,
    now: Date.now(),
    filePresent: true,
    signatureValid: true,
  };
  persistCurrent();
  return licenseStatus();
}

export function deactivateLicense(): void {
  if (dir) deleteLicFile(dir);
  if (dir) deleteLicenseState(dir);
  deleteMarker(db, currentHwid);
  current = emptyState();
}

// ---------------------------------------------------------------------------
// Read-only gate. When the license is hard-locked (expired past grace,
// tampered, invalid), ONLY the keys below (service.fn) are dispatched; every
// other RPC returns a LOCKED error.
// ---------------------------------------------------------------------------

const READONLY_ALLOWLIST: ReadonlySet<string> = new Set([
  "license.status",
  "license.activate",
  "license.deactivate",
  "auth.needsSetup",
  "settings.readAllSettings",
  "settings.getScannerConfig",
  "settings.isSoundEnabled",
  "settings.getWorkingDays",
  "settings.getInactiveDays",
  "settings.isCheckoutEnabled",
  "settings.freezeExtendsExpiry",
  "settings.getBackupConfig",
  "notifications.collectNotifications",
  "dashboard.getDashboardStats",
  "dashboard.getDashboardAttendance",
  "dashboard.getExpiringForDashboard",
  "dashboard.getDashboardOperational",
  "dashboard.getDashboardSeries",
  "dashboard.getDashboardOverview",
  "reports.getPeriodReport",
  "reports.getStaffActivity",
  "reports.getAttendanceAnalytics",
  "reports.getRetentionInsights",
  "members.getMember",
  "members.listMembers",
  "members.searchMembersForPicker",
  "members.listTrashedMembers",
  "memberProfile.getMemberOverview",
  "memberProfile.listAuditForMember",
  "cards.nextBarcodePreview",
  "cards.listCards",
  "cards.listMemberCards",
  "plans.listPlans",
  "packages.listPackages",
  "packages.getPackage",
  "packages.packageStats",
  "subscriptions.listMemberSubscriptions",
  "subscriptions.listSubscriptions",
  "subscriptions.listExpiringSubscriptions",
  "subscriptions.countActiveSubscriptions",
  "subscriptions.listSubscriptionFreezes",
  "attendance.listRecentCheckIns",
  "attendance.countCheckInsOnDate",
  "attendance.listAttendanceForMember",
  "attendance.attendanceSeries",
  "attendance.duplicateWindowSeconds",
  "finance.getFinanceOverview",
  "finance.getMemberOutstanding",
  "finance.listLedgerEntries",
  "payments.getPaymentById",
  "payments.getSubscriptionBalance",
  "payments.listPayments",
  "payments.listActiveMethods",
  "expenses.getExpenseById",
  "expenses.listExpenses",
  "expenses.listCategories",
  "cash.getOpenCashSession",
  "cash.getOpenSessionTotals",
  "cash.listCashSessions",
  "store.listProductCategories",
  "store.listProducts",
  "store.getProduct",
  "store.listStockMovements",
  "store.listSales",
  "store.getSale",
  "store.listStoreDebts",
  "store.getMemberStoreDebtTotal",
  "store.getStoreStats",
  "store.listStoreReturns",
  "store.getStoreReturn",
  "store.getDailySalesReport",
  "store.getProductSalesReport",
  "store.getStockValue",
  "store.listLowStockProducts",
  "classes.listClasses",
  "classes.listSessions",
  "classes.listBookings",
  "classes.listMemberBookings",
  "employees.listEmployees",
  "employees.listSalaries",
  "employeesHr.listAttendance",
  "employeesHr.listLeaves",
  "employeesHr.getLeaveBalance",
  "employeesHr.listDeductions",
  "employeesHr.listIncentives",
  "employeesHr.monthlySalarySummary",
  "employeesHr.employeeDailyActivity",
  "employeesHr.employeeMonthlyHours",
  "trainers.listTrainers",
  "trainingPlans.getTrainingPlanById",
  "trainingPlans.listTrainingPlans",
  "inbody.listAssessments",
  "inbody.getProgress",
  "inbody.listFitnessTestDefs",
  "inbody.listFitnessResults",
  "crm.listTemplates",
  "crm.listMessages",
  "audit.listAuditLogs",
  "users.listUsers",
  "backup.listBackupEntries",
  "backup.collectDiagnostics",
  "reception.search",
  "reception.lookup",
  "permissions.getRolePermissions",
  "permissions.getAllPermissions",
  "referral.getSettings",
  "referral.getMemberCode",
  "referral.list",
  "referral.get",
  "referral.stats",
  "referral.topReferrers",
  "referral.listRewards",
  "loyalty.getSettings",
  "loyalty.getEarnRules",
  "loyalty.getRedemptionCatalog",
  "loyalty.getMemberBalance",
  "loyalty.listMemberTransactions",
  "lead.listLeads",
  "lead.getLead",
  "lead.listFollowups",
  "lead.todayFollowups",
  "lead.listActivity",
  "lead.leadStats",
  "trials.getTrial",
  "trials.listTrials",
  "trials.trialStats",
  "dev.getOverrideDate",
]);

/**
 * Returns a short reason key when a RPC must be blocked in read-only mode,
 * else null (allowed).
 */
export function rpcBlockReason(
  service: string,
  fn: string,
): "expired_readonly" | "tampered" | "invalid" | null {
  if (!isHardLocked(current)) return null;
  if (READONLY_ALLOWLIST.has(`${service}.${fn}`)) return null;
  const ev = evaluate(current);
  if (ev.name === "tampered") return "tampered";
  if (ev.name === "invalid") return "invalid";
  return "expired_readonly";
}

/** True when the session is in a usable (write-enabled) state. */
export function canWrite(): boolean {
  return !isHardLocked(current);
}

/** Test-only: inject a synthetic license state. */
export function _setSessionForTest(state: Partial<LicenseState>): void {
  const hwid =
    state.hwid ??
    state.payload?.hwid ??
    currentHwid;
  currentHwid = hwid;
  current = {
    hwid,
    lastActive: state.lastActive ?? null,
    payload: state.payload ?? null,
    now: state.now ?? Date.now(),
    filePresent: state.filePresent ?? false,
    signatureValid: state.signatureValid ?? false,
  };
}