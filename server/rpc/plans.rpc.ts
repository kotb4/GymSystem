import * as plansService from "../../src/core/services/plans.service";
import { a, defineService, type Fn } from "./helpers";

export const plans = defineService({
  listPlans: a(plansService.listPlans as Fn),
  createPlan: a(plansService.createPlan as Fn),
  updatePlan: a(plansService.updatePlan as Fn),
});
