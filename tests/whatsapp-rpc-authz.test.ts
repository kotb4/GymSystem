import { describe, expect, it } from "vitest";

import { whatsapp } from "../server/rpc/whatsapp.rpc.js";
import type { ServiceActor } from "@/core/permissions";
import { createTestDb } from "./helpers/test-db.js";

/**
 * The WhatsApp RPC surface is the only bridge to the in-process WhatsApp
 * session, so it MUST be gated by the permission catalogue: `whatsapp.view`
 * for session reads, `whatsapp.manage` for every state change. Denial happens
 * before the service is touched, which is why these tests never launch a
 * browser (the real client only starts on connect()).
 * Registry wiring itself is asserted by scripts/check-rpc-consistency.cjs.
 */
const db = createTestDb();

function actor(roleId: ServiceActor["roleId"]): ServiceActor {
  return { userId: `u-${roleId}`, username: roleId, fullName: roleId, roleId };
}

async function call(fnName: keyof typeof whatsapp, who: ServiceActor, args: unknown[] = []): Promise<unknown> {
  const exposed = whatsapp[fnName];
  const callArgs = exposed.actor ? [db, who, ...args] : [db, ...args];
  const invoke = exposed.fn as unknown as (...callArgs: unknown[]) => Promise<unknown>;
  return invoke(...callArgs);
}

const HANDLERS = ["status", "getQr", "connect", "reconnect", "logout", "sendMembershipQr", "hasAutoSent"] as const;

describe("whatsapp RPC authorization", () => {
  it("exposes every handler as actor-aware (so permission checks can run)", () => {
    for (const name of HANDLERS) {
      expect(whatsapp[name], `whatsapp.${name} must be registered`).toBeTruthy();
      expect(whatsapp[name].actor, `whatsapp.${name} must be actor-aware`).toBe(true);
    }
  });

  it("denies session reads for a role without whatsapp.view", async () => {
    await expect(call("status", actor("trainer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("getQr", actor("trainer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies session changes for a view-only role (reception has whatsapp.view only)", async () => {
    await expect(call("connect", actor("reception"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("reconnect", actor("reception"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("logout", actor("reception"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("sendMembershipQr", actor("reception"), [{ memberId: "m-1" }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(call("hasAutoSent", actor("reception"), [{ memberId: "m-1" }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies sending for a role without whatsapp.manage (owner/manager keep it)", async () => {
    await expect(call("sendMembershipQr", actor("trainer"), [{ memberId: "m-1" }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows session reads for roles holding whatsapp.view", async () => {
    const info = (await call("status", actor("reception"))) as { status: string };
    expect(info.status).toBe("DISCONNECTED");
  });
});