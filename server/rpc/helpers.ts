import type { Db } from "../../src/db/engine";
import type { ServiceActor } from "../../src/core/permissions";

/**
 * RPC contract types + small building blocks shared by every domain module.
 * A "service" is a map of function-name → { fn, actor }. Functions whose
 * signature starts with `(db, actor, ...)` are marked `a()` (actor-aware);
 * plain `(db, ...)` callbacks are marked `p()`.
 */

export type Fn = (...args: never[]) => unknown;

export interface Exposed {
  fn: Fn;
  actor: boolean;
}

export const a = (fn: Fn): Exposed => ({ fn, actor: true });
export const p = (fn: Fn): Exposed => ({ fn, actor: false });

/**
 * Typed builder for a domain's RPC surface. `defineService` exists so each
 * <domain>.rpc.ts is statically checked to only expose Fn entries; the runtime
 * behaviour is identical to hand-rolled records built from `a()`/`p()`.
 */
export function defineService<T extends Record<string, Exposed>>(entries: T): T {
  return entries;
}

/** Invocation signature used by the caller: zero or more `db`/`actor` prefixed args. */
export type Invoke = (db: Db, actor: ServiceActor, ...args: never[]) => unknown;
