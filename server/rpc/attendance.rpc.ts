import * as attendanceService from "../../src/core/services/attendance.service";
import { a, p, defineService, type Fn } from "./helpers";

export const attendance = defineService({
  recordCheckIn: a(attendanceService.recordCheckIn as Fn),
  recordCheckOut: a(attendanceService.recordCheckOut as Fn),
  listRecentCheckIns: a(attendanceService.listRecentCheckIns as Fn),
  countCheckInsOnDate: p(attendanceService.countCheckInsOnDate as Fn),
  listAttendanceForMember: a(attendanceService.listAttendanceForMember as Fn),
  deleteAttendance: a(attendanceService.deleteAttendance as Fn),
  restoreAttendance: a(attendanceService.restoreAttendance as Fn),
  attendanceSeries: p(attendanceService.attendanceSeries as Fn),
  duplicateWindowSeconds: p(attendanceService.duplicateWindowSeconds as Fn),
});
