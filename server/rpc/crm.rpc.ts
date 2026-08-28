import * as crmService from "../../src/core/services/crm.service";
import { a, defineService, type Fn } from "./helpers";

export const crm = defineService({
  listTemplates: a(crmService.listTemplates as Fn),
  upsertTemplate: a(crmService.upsertTemplate as Fn),
  queueMessage: a(crmService.queueMessage as Fn),
  sendPendingMessages: a(crmService.sendPendingMessages as Fn),
  markManuallySent: a(crmService.markManuallySent as Fn),
  listMessages: a(crmService.listMessages as Fn),
  generateDueMessages: a(crmService.generateDueMessages as Fn),
});
