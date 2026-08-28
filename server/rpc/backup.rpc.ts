import * as backupService from "../../src/core/services/backup.service";
import { a, defineService, type Fn } from "./helpers";

export const backup = defineService({
  listBackupEntries: a(backupService.listBackupEntries as Fn),
  collectDiagnostics: a(backupService.collectDiagnostics as Fn),
});
