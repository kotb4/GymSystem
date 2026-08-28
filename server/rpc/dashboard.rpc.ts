import * as dashboardService from "../../src/core/services/dashboard.service";
import { a, defineService, type Fn } from "./helpers";

export const dashboard = defineService({
  getDashboardStats: a(dashboardService.getDashboardStats as Fn),
  getDashboardAttendance: a(dashboardService.getDashboardAttendance as Fn),
  getExpiringForDashboard: a(dashboardService.getExpiringForDashboard as Fn),
  getDashboardOperational: a(dashboardService.getDashboardOperational as Fn),
  getDashboardSeries: a(dashboardService.getDashboardSeries as Fn),
  getDashboardOverview: a(dashboardService.getDashboardOverview as Fn),
});
