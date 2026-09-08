import { rpc } from "./client.js";
import type { WhatsAppSessionInfo, SendQrResult } from "../../server/whatsapp/types.js";

export const whatsappApi = {
  status: () => rpc<WhatsAppSessionInfo>("whatsapp", "status", []),
  getQr: () => rpc<{ qr: string | null }>("whatsapp", "getQr", []),
  connect: () => rpc<{ ok: boolean }>("whatsapp", "connect", []),
  reconnect: () => rpc<{ ok: boolean }>("whatsapp", "reconnect", []),
  logout: () => rpc<{ ok: boolean }>("whatsapp", "logout", []),
  sendMembershipQr: (memberId: string) =>
    rpc<SendQrResult>("whatsapp", "sendMembershipQr", [{ memberId }]),
  hasAutoSent: (memberId: string) =>
    rpc<{ sent: boolean }>("whatsapp", "hasAutoSent", [{ memberId }]),
};
