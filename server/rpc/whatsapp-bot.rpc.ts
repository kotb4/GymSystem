import * as whatsappBotService from "../../src/core/services/whatsapp-bot.service";
import { a, defineService, type Fn } from "./helpers";

export const whatsappBot = defineService({
  getConfig: a(whatsappBotService.getWhatsAppBotConfig as Fn),
  saveConfig: a(whatsappBotService.saveWhatsAppBotConfig as Fn),
  simulate: a(whatsappBotService.simulateWhatsAppBot as Fn),
  listHandovers: a(whatsappBotService.listBotHandovers as Fn),
  resolveHandover: a(whatsappBotService.resolveBotHandover as Fn),
  countPendingHandovers: a(whatsappBotService.countPendingBotHandovers as Fn),
});
