import * as memberMessagesService from "../../src/core/services/member-messages.service";
import { a, defineService, type Fn } from "./helpers";

export const memberMessages = defineService({
  listConversations: a(memberMessagesService.listMemberConversations as Fn),
  getMessages: a(memberMessagesService.getMemberMessages as Fn),
  sendMessage: a(memberMessagesService.sendMemberMessage as Fn),
});
