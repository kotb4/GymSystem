import fs from "node:fs";
import path from "node:path";
import { evaluate, isHardLocked, needsActivation, advanceLastActive, type LicenseState } from "./policy";
import { computeHwId } from "./hwid";
import { parseAndVerifyLicense } from "./crypto";
import { readLicenseState, writeLicenseState, deleteLicenseState, type LicenseStateFile } from "./store";

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
  graceDaysRemaining: number | null;
  readOnly: boolean;
  needsActivation: boolean;
  tampered: boolean;
};

let dir: string | null = null;
let currentHwid = computeHwId();
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
export function _resetLicenseSession(nextDir?: string): void {
  dir = nextDir ?? null;
  currentHwid = computeHwId();
  current = emptyState();
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
}

/**
 * Boot-time initialization: load state + .lic, re-verify, evaluate, advance
 * lastActive. Call once after directories are resolved.
 */
export function initLicenseSession(dataDir: string): void {
  dir = dataDir;
  currentHwid = computeHwId();
  const file = readLicenseState(dir);
  if (!file) {
    current = emptyState();
    return;
  }
  const licBytes = readLicFileBytes(dir);
  const payload = licBytes ? parseAndVerifyLicense(licBytes) : null;
  current = {
    hwid: currentHwid,
    lastActive: file.lastActive,
    payload,
    now: Date.now(),
    filePresent: payload != null,
    signatureValid: payload != null,
  };
  const advanced = advanceLastActive(current.lastActive, Date.now());
  if (advanced != null) {
    current.lastActive = advanced;
    persistCurrent();
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
  const remaining =
    p != null
      ? Math.max(0, Math.ceil((p.expiresAt + 5 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;
  return {
    state: ev.name,
    hwid: currentHwid,
    gym: p?.gym ?? null,
    expiresAt: p?.expiresAt ?? null,
    issuedAt: p?.issuedAt ?? null,
    tier: p?.tier ?? null,
    graceDaysRemaining: remaining,
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