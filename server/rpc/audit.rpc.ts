import * as auditService from "../../src/core/services/audit.service";
import { a, defineService, type Fn } from "./helpers";

export const audit = defineService({
  listAuditLogs: a(auditService.listAuditLogs as Fn),
});
