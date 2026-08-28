import * as financialReportService from "../../src/core/services/financial-report.service";
import * as staffActivityService from "../../src/core/services/staff-activity.service";
import * as attendanceAnalyticsService from "../../src/core/services/attendance-analytics.service";
import { a, defineService, type Fn } from "./helpers";

export const reports = defineService({
  getPeriodReport: a(financialReportService.getPeriodReport as Fn),
  getStaffActivity: a(staffActivityService.getStaffActivity as Fn),
  getAttendanceAnalytics: a(attendanceAnalyticsService.getAttendanceAnalytics as Fn),
});
