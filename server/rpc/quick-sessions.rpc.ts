import * as quickSessionService from "../../src/core/services/quick-session.service";
import { a, defineService, type Fn } from "./helpers";

export const quickSessions = defineService({
  create: a(quickSessionService.createQuickSession as Fn),
  list: a(quickSessionService.listQuickSessions as Fn),
  getById: a(quickSessionService.getQuickSessionById as Fn),
  getStats: a(quickSessionService.getQuickSessionStats as Fn),
});
