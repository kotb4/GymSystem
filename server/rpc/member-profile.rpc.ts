import * as memberProfileService from "../../src/core/services/member-profile.service";
import { a, defineService, type Fn } from "./helpers";

export const memberProfile = defineService({
  getMemberOverview: a(memberProfileService.getMemberOverview as Fn),
  listAuditForMember: a(memberProfileService.listAuditForMember as Fn),
});
