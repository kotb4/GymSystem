import * as employeesService from "../../src/core/services/employees.service";
import { a, defineService, type Fn } from "./helpers";

export const employees = defineService({
  purgeEmployee: a(employeesService.purgeEmployee as Fn),
  listEmployees: a(employeesService.listEmployees as Fn),
  createEmployee: a(employeesService.createEmployee as Fn),
  updateEmployee: a(employeesService.updateEmployee as Fn),
  listSalaries: a(employeesService.listSalaries as Fn),
  recordSalary: a(employeesService.recordSalary as Fn),
  paySalary: a(employeesService.paySalary as Fn),
});
