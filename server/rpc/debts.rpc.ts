import * as debtsService from "../../src/core/services/debts.service";
import { a, defineService, type Fn } from "./helpers";

export const debts = defineService({
  list: a(debtsService.listMemberDebts as Fn),
  pay: a(debtsService.payMemberDebt as Fn),
  settleBatch: a(debtsService.settleMemberDuesBatch as Fn),
});
