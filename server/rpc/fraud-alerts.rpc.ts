import * as fraudAlertsService from "../../src/core/services/fraud-alerts.service";
import { a, defineService, type Fn } from "./helpers";

export const fraudAlerts = defineService({
  scanFraudAlerts: a(fraudAlertsService.scanFraudAlerts as Fn),
});
