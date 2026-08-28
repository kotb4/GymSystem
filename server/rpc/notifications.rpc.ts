import * as notificationsService from "../../src/core/services/notifications.service";
import { a, defineService, type Fn } from "./helpers";

export const notifications = defineService({
  collectNotifications: a(notificationsService.collectNotifications as Fn),
});
