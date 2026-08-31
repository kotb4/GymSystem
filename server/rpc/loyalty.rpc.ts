import * as loyaltyService from "../../src/core/services/loyalty.service";
import { a, defineService, type Fn } from "./helpers";

export const loyalty = defineService({
  getSettings: a(loyaltyService.getLoyaltySettings as Fn),
  updateSettings: a(loyaltyService.updateLoyaltySettings as Fn),
  getEarnRules: a(loyaltyService.getEarnRules as Fn),
  upsertEarnRule: a(loyaltyService.upsertEarnRule as Fn),
  removeEarnRule: a(loyaltyService.removeEarnRule as Fn),
  getRedemptionCatalog: a(loyaltyService.getRedemptionCatalog as Fn),
  upsertRedemption: a(loyaltyService.upsertRedemption as Fn),
  setRedemptionActive: a(loyaltyService.setRedemptionActive as Fn),
  getMemberBalance: a(loyaltyService.getMemberBalance as Fn),
  listMemberTransactions: a(loyaltyService.listMemberTransactions as Fn),
  adjustPoints: a(loyaltyService.adjustPoints as Fn),
  redeemReward: a(loyaltyService.redeemReward as Fn),
});
