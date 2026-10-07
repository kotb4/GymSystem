import * as invitationsService from "../../src/core/services/invitations.service";
import { a, defineService, type Fn } from "./helpers";

export const invitations = defineService({
  useGuestInvitation: a(invitationsService.useGuestInvitation as Fn),
  listSubscriptionInvitations: a(invitationsService.listSubscriptionInvitations as Fn),
  getMemberInvitationsSummary: a(invitationsService.getMemberInvitationsSummary as Fn),
});
