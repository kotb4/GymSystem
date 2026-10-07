import * as renewalAlertsService from "../../src/core/services/renewal-alerts.service";
import { a, defineService, type Fn } from "./helpers";

export const renewalAlerts = defineService({
  listExpiringSubscriptionsForRenewal: a(renewalAlertsService.listExpiringSubscriptionsForRenewal as Fn),
  sendRenewalReminders: a(renewalAlertsService.sendRenewalReminders as Fn),
});
