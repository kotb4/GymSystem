import type { Db } from "../../src/db/engine";
import { errValidation } from "../../src/core/errors";
import { p, defineService } from "./helpers";
import {
  licenseStatus,
  activateLicense as activate,
  deactivateLicense as deactivate,
} from "../license/session";

/**
 * Offline licensing surface. `status` is universally readable and `activate`/
 * `deactivate` are PLAIN (unauthenticated) functions so the activation screen
 * works WITHOUT a login — required by the total-lock policy (ADR-022: expired
 * = activation surface only). All three are always in a lock allowlist.
 */
export const license = defineService({
  status: p((_db: Db) => {
    return licenseStatus();
  }),
  activate: p((_db: Db, licJson: string) => {
    if (typeof licJson !== "string" || licJson.length === 0) {
      throw errValidation("errors.license.empty");
    }
    return activate(licJson);
  }),
  deactivate: p((_db: Db) => {
    deactivate();
    return { ok: true };
  }),
});