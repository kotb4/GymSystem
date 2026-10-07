import * as shiftsService from "../../src/core/services/shifts.service";
import { a, defineService, type Fn } from "./helpers";

export const shifts = defineService({
  getActiveShift: a(shiftsService.getActiveShift as Fn),
  openShift: a(shiftsService.openShift as Fn),
  getShiftSummary: a(shiftsService.getShiftSummary as Fn),
  closeShift: a(shiftsService.closeShift as Fn),
  listShifts: a(shiftsService.listShifts as Fn),
});
