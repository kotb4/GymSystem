import type { Db } from "../../src/db/engine";
import { errValidation } from "../../src/core/errors";
import { requirePermission, type ServiceActor } from "../../src/core/permissions";
import { p, a, defineService } from "./helpers";
import {
  licenseStatus,
  activateLicense as activate,
  deactivateLicense as deactivate,
  executeDeveloperAction,
} from "../license/session";

/**
 * Offline licensing surface. `status` is universally readable and `activate`/
 * `executeDeveloperAction` are PLAIN functions so the activation / recovery screen
 * works WITHOUT a login — required by the total-lock policy (ADR-022).
 * `deactivate` is protected by `settings.edit` so unauthorized network requests cannot wipe the license.
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
  deactivate: a((_db: Db, actor: ServiceActor) => {
    requirePermission(actor, "settings.edit");
    deactivate();
    return { ok: true };
  }),
  executeDeveloperAction: p(async (db: Db, actionJson: string) => {
    if (typeof actionJson !== "string" || actionJson.trim().length === 0) {
      throw errValidation("errors.license.actionTokenInvalid");
    }
    return await executeDeveloperAction(db, actionJson.trim());
  }),
});