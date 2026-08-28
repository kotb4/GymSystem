import * as expensesService from "../../src/core/services/expenses.service";
import { a, p, defineService, type Fn } from "./helpers";

export const expenses = defineService({
  createExpense: a(expensesService.createExpense as Fn),
  updateExpense: a(expensesService.updateExpense as Fn),
  voidExpense: a(expensesService.voidExpense as Fn),
  unvoidExpense: a(expensesService.unvoidExpense as Fn),
  getExpenseById: a(expensesService.getExpenseById as Fn),
  listExpenses: a(expensesService.listExpenses as Fn),
  listCategories: p(expensesService.listCategories as Fn),
  createCategory: a(expensesService.createCategory as Fn),
  setCategoryActive: a(expensesService.setCategoryActive as Fn),
});
