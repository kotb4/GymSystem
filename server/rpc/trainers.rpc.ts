import * as trainersService from "../../src/core/services/trainers.service";
import { a, defineService, type Fn } from "./helpers";

export const trainers = defineService({
  createTrainer: a(trainersService.createTrainer as Fn),
  updateTrainer: a(trainersService.updateTrainer as Fn),
  deleteTrainer: a(trainersService.deleteTrainer as Fn),
  setTrainerActive: a(trainersService.setTrainerActive as Fn),
  listTrainers: a(trainersService.listTrainers as Fn),
  linkTrainerToEmployee: a(trainersService.linkTrainerToEmployee as Fn),
  createEmployeeForTrainer: a(trainersService.createEmployeeForTrainer as Fn),
  recordTrainerPayout: a(trainersService.recordTrainerPayout as Fn),
  listTrainerPayouts: a(trainersService.listTrainerPayouts as Fn),
  deleteTrainerPayout: a(trainersService.deleteTrainerPayout as Fn),
  getTrainerFinancialSummary: a(trainersService.getTrainerFinancialSummary as Fn),
  getTrainerDetailedStatement: a(trainersService.getTrainerDetailedStatement as Fn),
});
