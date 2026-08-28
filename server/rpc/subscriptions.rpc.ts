import * as subscriptionsService from "../../src/core/services/subscriptions.service";
import { a, p, defineService, type Fn } from "./helpers";

export const subscriptions = defineService({
  createSubscription: a(subscriptionsService.createSubscription as Fn),
  updateSubscription: a(subscriptionsService.updateSubscription as Fn),
  setSubscriptionStatus: a(subscriptionsService.setSubscriptionStatus as Fn),
  undoCancelSubscription: a(subscriptionsService.undoCancelSubscription as Fn),
  listMemberSubscriptions: a(subscriptionsService.listMemberSubscriptions as Fn),
  listSubscriptions: a(subscriptionsService.listSubscriptions as Fn),
  listExpiringSubscriptions: a(subscriptionsService.listExpiringSubscriptions as Fn),
  countActiveSubscriptions: p(subscriptionsService.countActiveSubscriptions as Fn),
  listSubscriptionFreezes: a(subscriptionsService.listSubscriptionFreezes as Fn),
  freezeSubscription: a(subscriptionsService.freezeSubscription as Fn),
  unfreezeSubscription: a(subscriptionsService.unfreezeSubscription as Fn),
  renewSubscription: a(subscriptionsService.renewSubscription as Fn),
  purgeSubscription: a(subscriptionsService.purgeSubscription as Fn),
});
