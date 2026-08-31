import * as referralService from "../../src/core/services/referral.service";
import { a, defineService, type Fn } from "./helpers";

export const referral = defineService({
  getSettings: a(referralService.getReferralSettings as Fn),
  updateSettings: a(referralService.updateReferralSettings as Fn),
  getMemberCode: a(referralService.getMemberReferralCode as Fn),
  list: a(referralService.listReferrals as Fn),
  get: a(referralService.getReferral as Fn),
  create: a(referralService.createReferral as Fn),
  cancel: a(referralService.cancelReferral as Fn),
  convert: a(referralService.convertReferral as Fn),
  stats: a(referralService.getReferralStats as Fn),
  topReferrers: a(referralService.listTopReferrers as Fn),
  listRewards: a(referralService.listReferralRewards as Fn),
});
