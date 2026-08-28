import * as trainingPlansService from "../../src/core/services/training-plans.service";
import { a, defineService, type Fn } from "./helpers";

export const trainingPlans = defineService({
  getTrainingPlanById: a(trainingPlansService.getTrainingPlanById as Fn),
  createTrainingPlan: a(trainingPlansService.createTrainingPlan as Fn),
  updateTrainingPlan: a(trainingPlansService.updateTrainingPlan as Fn),
  endTrainingPlan: a(trainingPlansService.endTrainingPlan as Fn),
  cancelTrainingPlan: a(trainingPlansService.cancelTrainingPlan as Fn),
  reactivateTrainingPlan: a(trainingPlansService.reactivateTrainingPlan as Fn),
  listTrainingPlans: a(trainingPlansService.listTrainingPlans as Fn),
  sweepExpiredPlans: a(trainingPlansService.sweepExpiredPlans as Fn),
});
