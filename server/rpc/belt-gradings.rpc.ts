import * as gradingsService from "../../src/core/services/belt-gradings.service";
import { a, p, defineService, type Fn } from "./helpers";

export const beltGradings = defineService({
  listMemberGradings: a(gradingsService.listMemberGradings as Fn),
  listAllGradings: a(gradingsService.listAllGradings as Fn),
  recordGrading: a(gradingsService.recordGrading as Fn),
  deleteGrading: a(gradingsService.deleteGrading as Fn),
  buildParentAttendanceMessage: p(gradingsService.buildParentAttendanceMessage as Fn),
});
