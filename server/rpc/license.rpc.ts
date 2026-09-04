import type { Db } from "../../src/db/engine";
import type { ServiceActor } from "../../src/core/permissions";
import { errValidation } from "../../src/core/errors";
import { a, p, defineService } from "./helpers";
import {
  licenseStatus,
  activateLicense as activate,
  deactivateLicense as deactivate,
} from "../license/session";

/**
 * Offline licensing surface. `status` is universally readable so the SPA can
 * decide whether to show the activation / grace / read-only screen even while
 * the license is blocked (it is in the read-only allowlist).
 */
export const license = defineService({
  status: p((_db: Db) => {
    return licenseStatus();
  }),
  activate: a((_db: Db, _actor: ServiceActor, licJson: string) => {
    if (typeof licJson !== "string" || licJson.length === 0) {
      throw errValidation("errors.license.empty");
    }
    return activate(licJson);
  }),
  deactivate: a((_db: Db, _actor: ServiceActor) => {
    deactivate();
    return { ok: true };
  }),
});