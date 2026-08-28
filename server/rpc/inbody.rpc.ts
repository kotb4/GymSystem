import * as inbodyService from "../../src/core/services/inbody.service";
import { a, defineService, type Fn } from "./helpers";

export const inbody = defineService({
  createAssessment: a(inbodyService.createAssessment as Fn),
  deleteAssessment: a(inbodyService.deleteAssessment as Fn),
  listAssessments: a(inbodyService.listAssessments as Fn),
  getProgress: a(inbodyService.getProgress as Fn),
  listFitnessTestDefs: a(inbodyService.listFitnessTestDefs as Fn),
  upsertFitnessTestDef: a(inbodyService.upsertFitnessTestDef as Fn),
  recordFitnessResult: a(inbodyService.recordFitnessResult as Fn),
  listFitnessResults: a(inbodyService.listFitnessResults as Fn),
});
