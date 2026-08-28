import { requirePermission } from "../../src/core/permissions";
import type { Db } from "../../src/db/engine";
import type { ServiceActor } from "../../src/core/permissions";
import { getDevOverrideDate, setDevOverrideDate } from "@/core/dates";
import { p, a, defineService, type Fn } from "./helpers";

export const dev = defineService({
  getOverrideDate: p((() => getDevOverrideDate()) as Fn),
  setOverrideDate: a((((_db: Db, actor: ServiceActor, date: string | null) => {
    requirePermission(actor, "settings.edit");
    setDevOverrideDate(date);
    return getDevOverrideDate();
  }) as Fn)),
});
