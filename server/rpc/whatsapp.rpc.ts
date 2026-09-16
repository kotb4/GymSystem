import { requirePermission } from "../../src/core/permissions";
import type { ServiceActor } from "../../src/core/permissions";
import type { Db } from "../../src/db/engine";
import { getWhatsAppService } from "../whatsapp/index.js";
import { a, defineService, type Fn } from "./helpers.js";

// WhatsApp RPC handlers. The singleton service owns all state; these thin
// wrappers adapt it to the RPC's (db, actor, ...args) calling convention and
// enforce the permission catalogue: reading session state needs
// `whatsapp.view`, every state change (connect/reconnect/logout/send) needs
// `whatsapp.manage` — the card is a UI convenience, the backend is the gate.
// Defined outside defineService() so the `as Fn` cast matches the expected
// `(...args: never[]) => unknown` shape (inline arrows would infer `never` params).
function status(_db: Db, actor: ServiceActor) {
  requirePermission(actor, "whatsapp.view");
  return getWhatsAppService().getStatus();
}

async function getQr(_db: Db, actor: ServiceActor) {
  requirePermission(actor, "whatsapp.view");
  return { qr: await getWhatsAppService().getQrCode() };
}

async function sendMembershipQr(_db: Db, actor: ServiceActor, input: { memberId: string }) {
  requirePermission(actor, "whatsapp.manage");
  const svc = getWhatsAppService();
  return svc.sendMembershipQr(input.memberId, actor?.userId ?? "system");
}

async function hasAutoSent(_db: Db, actor: ServiceActor, input: { memberId: string }) {
  requirePermission(actor, "whatsapp.manage");
  return { sent: getWhatsAppService().hasAutoSent(input.memberId) };
}

async function connect(_db: Db, actor: ServiceActor) {
  requirePermission(actor, "whatsapp.manage");
  await getWhatsAppService().initialize();
  return { ok: true };
}

async function reconnect(_db: Db, actor: ServiceActor) {
  requirePermission(actor, "whatsapp.manage");
  await getWhatsAppService().reconnect();
  return { ok: true };
}

async function logout(_db: Db, actor: ServiceActor) {
  requirePermission(actor, "whatsapp.manage");
  await getWhatsAppService().logout();
  return { ok: true };
}

export const whatsapp = defineService({
  status: a(status as Fn),
  getQr: a(getQr as Fn),
  connect: a(connect as Fn),
  reconnect: a(reconnect as Fn),
  logout: a(logout as Fn),
  sendMembershipQr: a(sendMembershipQr as Fn),
  hasAutoSent: a(hasAutoSent as Fn),
});