import * as cashSessionService from "../../src/core/services/cash-session.service";
import { a, defineService, type Fn } from "./helpers";

export const cash = defineService({
  getOpenCashSession: a(cashSessionService.getOpenCashSession as Fn),
  getLastClosedCashSession: a(cashSessionService.getLastClosedCashSession as Fn),
  openCashSession: a(cashSessionService.openCashSession as Fn),
  closeCashSession: a(cashSessionService.closeCashSession as Fn),
  deleteCashSession: a(cashSessionService.deleteCashSession as Fn),
  getOpenSessionTotals: a(cashSessionService.getOpenSessionTotals as Fn),
  listCashSessions: a(cashSessionService.listCashSessions as Fn),
  getCashierPerformanceSummary: a(cashSessionService.getCashierPerformanceSummary as Fn),
  withdrawByOwner: a(cashSessionService.withdrawByOwner as Fn),
  resolveInterShiftGap: a(cashSessionService.resolveInterShiftGap as Fn),
});
