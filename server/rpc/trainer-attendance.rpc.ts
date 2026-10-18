import * as trainerAttendanceService from "../../src/core/services/trainer-attendance.service";
import { requirePermission, type ServiceActor } from "../../src/core/permissions";
import type { Db } from "../../src/db/engine";
import { a, defineService, type Fn } from "./helpers";

export const trainerAttendance = defineService({
  list: a(((db: Db, actor: ServiceActor, date?: string, trainerId?: string) => {
    requirePermission(actor, "trainer_attendance.view");
    return trainerAttendanceService.listTrainerAttendance(db, date, trainerId);
  }) as Fn),
  getSummary: a(((db: Db, actor: ServiceActor, date?: string) => {
    requirePermission(actor, "trainer_attendance.view");
    return trainerAttendanceService.getTrainerAttendanceSummary(db, date);
  }) as Fn),
  checkIn: a(trainerAttendanceService.recordTrainerCheckIn as Fn),
  checkOut: a(trainerAttendanceService.recordTrainerCheckOut as Fn),
});
