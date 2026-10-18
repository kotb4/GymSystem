import * as memberPortalService from "../../src/core/services/member-portal.service";
import { a, p, defineService, type Fn } from "./helpers";

export const memberPortal = defineService({
  getProfile: p(memberPortalService.getMemberPortalProfile as Fn),
  getLiveOccupancy: p(memberPortalService.getLiveGymOccupancy as Fn),
  getUrl: a(memberPortalService.getMemberPortalUrl as Fn),
});
