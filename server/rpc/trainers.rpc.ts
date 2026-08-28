import * as trainersService from "../../src/core/services/trainers.service";
import { a, defineService, type Fn } from "./helpers";

export const trainers = defineService({
  createTrainer: a(trainersService.createTrainer as Fn),
  updateTrainer: a(trainersService.updateTrainer as Fn),
  setTrainerActive: a(trainersService.setTrainerActive as Fn),
  listTrainers: a(trainersService.listTrainers as Fn),
});
