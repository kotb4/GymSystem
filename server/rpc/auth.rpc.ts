import * as authService from "../../src/core/services/auth.service";
import type { ServiceActor } from "../../src/core/permissions";
import { p, defineService, type Fn } from "./helpers";

export const auth = defineService({
  needsSetup: p(authService.needsSetup as Fn),
  changeOwnPassword: {
    fn: ((db: unknown, actor: ServiceActor, current: string, next: string) =>
      authService.changeOwnPassword(
        db as never,
        { userId: actor.userId, username: actor.username },
        current,
        next,
      )) as Fn,
    actor: true,
  },
});
