import * as ptService from "../../src/core/services/private-training.service";
import { a, defineService, type Fn } from "./helpers";

export const privateTraining = defineService({
  createPackage: a(ptService.createPTPackage as Fn),
  listPackages: a(ptService.listPTPackages as Fn),
  create: a(ptService.createPrivateTraining as Fn),
  recordSession: a(ptService.recordPTSession as Fn),
  getById: a(ptService.getPrivateTrainingById as Fn),
  list: a(ptService.listPrivateTrainings as Fn),
  getSummary: a(ptService.getPTSummary as Fn),
});
