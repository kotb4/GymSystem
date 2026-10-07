import fs from "node:fs";
import os from "node:os";
import { requirePermission } from "../../src/core/permissions";
import type { Db } from "../../src/db/engine";
import type { ServiceActor } from "../../src/core/permissions";
import { errForbidden } from "../../src/core/errors";
import { getDevOverrideDate, setDevOverrideDate } from "@/core/dates";
import {
  isDeveloperActor,
  getDeveloperOverview,
  setSystemReadOnly,
  toggleUserActive,
  suspendAllNonDevUsers,
  activateAllUsers,
  devResetUserPassword,
  devDeleteUser,
  devSeedDemoData,
  devRunIntegrityCheck,
  devVacuumDatabase,
  devResetOwnerEmergency,
  getFeatureFlags,
  setFeatureFlag,
  type FeatureFlags,
} from "../../src/core/services/developer.service";
import {
  grantEmergencyGrace,
  resetClockTamper,
  deactivateLicense,
  activateLicense,
  licenseStatus,
} from "../license/session";
import { getDbContext, purgeEntireDataDirectory, clearServerLogs } from "../context";
import { p, a, defineService, type Fn } from "./helpers";

export const dev = defineService({
  getOverrideDate: p((() => getDevOverrideDate()) as Fn),
  setOverrideDate: a((((_db: Db, actor: ServiceActor, date: string | null) => {
    requirePermission(actor, "settings.edit");
    setDevOverrideDate(date);
    return getDevOverrideDate();
  }) as Fn)),

  getOverview: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    let dbSizeBytes = 0;
    try {
      const dbFile = getDbContext().dirs.dbFile;
      if (dbFile && fs.existsSync(dbFile)) {
        dbSizeBytes = fs.statSync(dbFile).size;
      }
    } catch {
      /* best effort */
    }
    return getDeveloperOverview(db, actor, dbSizeBytes);
  }) as Fn),

  setSystemReadOnly: a(((db: Db, actor: ServiceActor, enabled: boolean) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return setSystemReadOnly(db, actor, Boolean(enabled));
  }) as Fn),

  toggleUserActive: a(((db: Db, actor: ServiceActor, userId: string, isActive: boolean) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return toggleUserActive(db, actor, String(userId), Boolean(isActive));
  }) as Fn),

  suspendAllNonDevUsers: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return suspendAllNonDevUsers(db, actor);
  }) as Fn),

  activateAllUsers: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return activateAllUsers(db, actor);
  }) as Fn),

  grantEmergencyGrace: a(((_db: Db, actor: ServiceActor, days?: number) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    grantEmergencyGrace(Number(days ?? 7));
    return licenseStatus();
  }) as Fn),

  resetClockTamper: a(((_db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    resetClockTamper();
    return licenseStatus();
  }) as Fn),

  deactivateLicense: a(((_db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    deactivateLicense();
    return licenseStatus();
  }) as Fn),

  activateLicense: a(((_db: Db, actor: ServiceActor, licenseJson: string) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return activateLicense(String(licenseJson));
  }) as Fn),

  resetUserPassword: a(((db: Db, actor: ServiceActor, userId: string, newPass: string) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return devResetUserPassword(db, actor, String(userId), String(newPass));
  }) as Fn),

  deleteUser: a(((db: Db, actor: ServiceActor, userId: string) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return devDeleteUser(db, actor, String(userId));
  }) as Fn),

  seedDemoData: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return devSeedDemoData(db, actor);
  }) as Fn),

  purgeDataDirectory: a(((_db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return purgeEntireDataDirectory();
  }) as Fn),

  runIntegrityCheck: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return devRunIntegrityCheck(db, actor);
  }) as Fn),

  vacuumDatabase: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    devVacuumDatabase(db, actor);
    let dbSizeBytes = 0;
    try {
      const dbFile = getDbContext().dirs.dbFile;
      if (dbFile && fs.existsSync(dbFile)) {
        dbSizeBytes = fs.statSync(dbFile).size;
      }
    } catch {
      /* best effort */
    }
    return { success: true, dbSizeBytes };
  }) as Fn),

  clearServerLogs: a(((_db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return clearServerLogs();
  }) as Fn),

  resetOwnerEmergency: a(((db: Db, actor: ServiceActor, newPass: string) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return devResetOwnerEmergency(db, actor, String(newPass));
  }) as Fn),

  getFeatureFlags: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return getFeatureFlags(db, actor);
  }) as Fn),

  setFeatureFlag: a(((db: Db, actor: ServiceActor, flag: keyof FeatureFlags, enabled: boolean) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    return setFeatureFlag(db, actor, flag, Boolean(enabled));
  }) as Fn),

  getSystemTelemetry: a(((db: Db, actor: ServiceActor) => {
    if (!isDeveloperActor(actor)) throw errForbidden();
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const dirs = getDbContext().dirs;
    const sqliteVersion = String(db.scalar("SELECT sqlite_version()") ?? "unknown");

    let logSizeBytes = 0;
    try {
      const logFile = `${dirs.logsDir}/server.log`;
      if (fs.existsSync(logFile)) {
        logSizeBytes = fs.statSync(logFile).size;
      }
    } catch {
      /* best effort */
    }

    return {
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSeconds: os.uptime(),
      },
      cpu: {
        model: cpus[0]?.model ?? "Unknown CPU",
        cores: cpus.length,
        speed: cpus[0]?.speed ?? 0,
      },
      memory: {
        processRssBytes: mem.rss,
        processHeapUsedBytes: mem.heapUsed,
        processHeapTotalBytes: mem.heapTotal,
        systemTotalBytes: totalMem,
        systemFreeBytes: freeMem,
      },
      process: {
        nodeVersion: process.version,
        uptimeSeconds: process.uptime(),
        pid: process.pid,
      },
      database: {
        sqliteVersion,
        dbPath: dirs.dbFile,
        backupsDir: dirs.backupsDir,
        filesDir: dirs.filesDir,
        logsDir: dirs.logsDir,
        logSizeBytes,
      },
    };
  }) as Fn),
});
