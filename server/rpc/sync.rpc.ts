import * as syncService from "../../src/core/services/sync.service";
import { a, defineService, type Fn } from "./helpers";

export const sync = defineService({
  getConfig: a(syncService.getBranchConfig as Fn),
  updateConfig: a(syncService.updateBranchConfig as Fn),
  getStatus: a(syncService.getSyncStatus as Fn),
  triggerSync: a(syncService.performSyncCycle as Fn),
  testConnection: a(syncService.testRemoteConnection as Fn),
  listBranches: a(syncService.listRegisteredBranches as Fn),
});
