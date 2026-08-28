import * as financeService from "../../src/core/services/finance.service";
import { a, defineService, type Fn } from "./helpers";

export const finance = defineService({
  getFinanceOverview: a(financeService.getFinanceOverview as Fn),
  getMemberOutstanding: a(financeService.getMemberOutstanding as Fn),
  listLedgerEntries: a(financeService.listLedgerEntries as Fn),
});
