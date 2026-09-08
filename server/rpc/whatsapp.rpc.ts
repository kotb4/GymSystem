import { getWhatsAppService } from "../whatsapp/index.js";
import { a, p, defineService, type Fn } from "./helpers.js";

// WhatsApp RPC handlers. The singleton service owns all state; these thin
// wrappers adapt it to the RPC's (db, actor, ...args) calling convention.
// Defined outside defineService() so the `as Fn` cast matches the expected
// `(...args: never[]) => unknown` shape (inline arrows would infer `never` params).
async function sendMembershipQr(_db: any, actor: any, input: { memberId: string }) {
  const svc = getWhatsAppService();
  return svc.sendMembershipQr(input.memberId, actor?.userId ?? "system");
}

async function hasAutoSent(_db: any, _actor: any, input: { memberId: string }) {
  return { sent: getWhatsAppService().hasAutoSent(input.memberId) };
}

async function connect(_db: any, _actor: any) {
  await getWhatsAppService().initialize();
  return { ok: true };
}

async function reconnect(_db: any, _actor: any) {
  await getWhatsAppService().reconnect();
  return { ok: true };
}

async function logout(_db: any, _actor: any) {
  await getWhatsAppService().logout();
  return { ok: true };
}

export const whatsapp = defineService({
  status: p(async () => {
    return getWhatsAppService().getStatus();
  }),
  getQr: p(async () => {
    return { qr: await getWhatsAppService().getQrCode() };
  }),
  connect: a(connect as Fn),
  reconnect: a(reconnect as Fn),
  logout: a(logout as Fn),
  sendMembershipQr: a(sendMembershipQr as Fn),
  hasAutoSent: a(hasAutoSent as Fn),
});