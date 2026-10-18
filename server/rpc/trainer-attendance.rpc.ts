import * as trainerAttendanceService from "../../src/core/services/trainer-attendance.service";
import { a, p, defineService, type Fn } from "./helpers";

export const trainerAttendance = defineService({
  list: p(trainerAttendanceService.listTrainerAttendance as Fn),
  getSummary: p(trainerAttendanceService.getTrainerAttendanceSummary as Fn),
  checkIn: a(trainerAttendanceService.recordTrainerCheckIn as Fn),
  checkOut: a(trainerAttendanceService.recordTrainerCheckOut as Fn),
});
