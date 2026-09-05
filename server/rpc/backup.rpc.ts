import * as backupService from "../../src/core/services/backup.service";
import { a, defineService, type Fn } from "./helpers";
import { getBackupSecurityStatus, setBackupPassword, clearBackupEncryption } from "../backup-key";
import { createServerBackup } from "../backups";

export const backup = defineService({
  listBackupEntries: a(backupService.listBackupEntries as Fn),
  collectDiagnostics: a(backupService.collectDiagnostics as Fn),
  getSecurityStatus: a(getBackupSecurityStatus as Fn),
  setPassword: a(setBackupPassword as Fn),
  clearEncryption: a(clearBackupEncryption as Fn),
  createPrePurgeSnapshot: a((async (_db, actor) => {
    return createServerBackup(actor, "pre_purge");
  }) as Fn),
});