import * as managerOverrideService from "../../src/core/services/manager-override.service";
import { a, p, defineService, type Fn } from "./helpers";

export const managerOverride = defineService({
  verify: a(managerOverrideService.verifyManagerOverride as Fn),
  setPin: a(managerOverrideService.setManagerOverridePin as Fn),
  hasPin: p(managerOverrideService.hasManagerOverridePin as Fn),
});
