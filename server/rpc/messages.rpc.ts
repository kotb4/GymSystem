import * as messagesService from "../../src/core/services/messages.service";
import { a, defineService, type Fn } from "./helpers";

export const messages = defineService({
  listRecipients: a(messagesService.listRecipients as Fn),
  sendMessage: a(messagesService.sendMessage as Fn),
  sendSegment: a(messagesService.sendSegment as Fn),
  listMessageHistory: a(messagesService.listMessageHistory as Fn),
  getMessagesConfig: a(messagesService.getMessagesConfig as Fn),
});