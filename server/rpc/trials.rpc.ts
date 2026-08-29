import * as trialsService from "../../src/core/services/trials.service";
import { a, defineService, type Fn } from "./helpers";

export const trials = defineService({
  createTrial: a(trialsService.createTrial as Fn),
  updateTrial: a(trialsService.updateTrial as Fn),
  listTrials: a(trialsService.listTrials as Fn),
  getTrial: a(trialsService.getTrial as Fn),
  expireTrial: a(trialsService.expireTrial as Fn),
  cancelTrial: a(trialsService.cancelTrial as Fn),
  convertTrial: a(trialsService.convertTrial as Fn),
  sweepExpiredTrials: a(trialsService.sweepExpiredTrials as Fn),
  trialStats: a(trialsService.trialStats as Fn),
});
