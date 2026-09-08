export { WhatsAppService } from "./service.js";
export { WhatsAppClient } from "./client.js";
export { WHATSAPP_STATUS } from "./types.js";
export type { WhatsAppStatus, WhatsAppSessionInfo, SendQrResult } from "./types.js";

import { WhatsAppService } from "./service.js";

/** Get the singleton service instance. */
export function getWhatsAppService(): WhatsAppService {
  return WhatsAppService.getInstance();
}
