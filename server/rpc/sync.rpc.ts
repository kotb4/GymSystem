import * as syncService from "../../src/core/services/sync.service";
import { a, p, defineService, type Fn } from "./helpers";

export const sync = defineService({
  getConfig: p(syncService.getBranchConfig as Fn),
  updateConfig: a(syncService.updateBranchConfig as Fn),
  getStatus: p(syncService.getSyncStatus as Fn),
  triggerSync: a(syncService.performSyncCycle as Fn),
  testConnection: a(syncService.testRemoteConnection as Fn),
  listBranches: p(syncService.listRegisteredBranches as Fn),
});
