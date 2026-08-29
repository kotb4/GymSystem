import * as dailyClosingService from "../../src/core/services/daily-closing.service";
import { a, defineService, type Fn } from "./helpers";

export const dailyClosing = defineService({
  getOrCreateDailyClosing: a(dailyClosingService.getOrCreateDailyClosing as Fn),
  recordCountedCash: a(dailyClosingService.recordCountedCash as Fn),
  closeDailyClosing: a(dailyClosingService.closeDailyClosing as Fn),
  reopenDailyClosing: a(dailyClosingService.reopenDailyClosing as Fn),
  getDailyClosingById: a(dailyClosingService.getDailyClosingById as Fn),
  listDailyClosings: a(dailyClosingService.listDailyClosings as Fn),
  getTreasurySnapshot: a(dailyClosingService.getTreasurySnapshot as Fn),
  listTreasurySnapshotsForDate: a(dailyClosingService.listTreasurySnapshotsForDate as Fn),
});
