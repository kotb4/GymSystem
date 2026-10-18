import { toAppError, AppError, errForbidden, errLicenseLocked } from "../../src/core/errors";
import type { ServiceActor } from "../../src/core/permissions";
import { getDbContext, logLine } from "../context";
import { rpcBlockReason, refreshLicenseClock } from "../license/session";
import type { Exposed } from "./helpers";

import { members } from "./members.rpc";
import { subscriptions } from "./subscriptions.rpc";
import { plans } from "./plans.rpc";
import { packages } from "./packages.rpc";
import { cards } from "./cards.rpc";
import { attendance } from "./attendance.rpc";
import { audit } from "./audit.rpc";
import { auth } from "./auth.rpc";
import { users } from "./users.rpc";
import { payments } from "./payments.rpc";
import { expenses } from "./expenses.rpc";
import { cash } from "./cash.rpc";
import { dashboard } from "./dashboard.rpc";
import { finance } from "./finance.rpc";
import { reports } from "./reports.rpc";
import { trainers } from "./trainers.rpc";
import { trainingPlans } from "./training-plans.rpc";
import { settings } from "./settings.rpc";
import { notifications } from "./notifications.rpc";
import { backup } from "./backup.rpc";
import { store } from "./store.rpc";
import { classes } from "./classes.rpc";
import { employees } from "./employees.rpc";
import { employeesHr } from "./employees-hr.rpc";
import { inbody } from "./inbody.rpc";
import { permissions } from "./permissions.rpc";
import { reception } from "./reception.rpc";
import { lead } from "./lead.rpc";
import { trials } from "./trials.rpc";
import { dev } from "./dev.rpc";
import { memberProfile } from "./member-profile.rpc";
import { referral } from "./referral.rpc";
import { loyalty } from "./loyalty.rpc";
import { messages } from "./messages.rpc";
import { license } from "./license.rpc";
import { documentNumbers } from "./document-numbers.rpc";
import { fraudAlerts } from "./fraud-alerts.rpc";
import { invitations } from "./invitations.rpc";
import { pdf } from "./pdf.rpc";
import { promo } from "./promo.rpc";
import { renewalAlerts } from "./renewal-alerts.rpc";
import { shifts } from "./shifts.rpc";
import { sync } from "./sync.rpc";
import { vouchersService } from "./vouchers.rpc";
import { quickSessions } from "./quick-sessions.rpc";
import { debts } from "./debts.rpc";
import { purchases } from "./purchases.rpc";
import { privateTraining } from "./private-training.rpc";
import { announcements } from "./announcements.rpc";
import { trainerAttendance } from "./trainer-attendance.rpc";
import { memberMessages } from "./member-messages.rpc";
import { memberPortal } from "./member-portal.rpc";
import { beltGradings } from "./belt-gradings.rpc";
import { whatsappBot } from "./whatsapp-bot.rpc";

/**
 * The frontend never touches SQLite. It calls whitelisted service functions
 * over localhost HTTP; this module is the only bridge (spec sections 7/8).
 * Business logic stays in src/core/services — imported here unchanged.
 * The registry is split across server/rpc/<domain>.rpc.ts for maintainability.
 */
export const REGISTRY: Record<string, Record<string, Exposed>> = {
  members,
  subscriptions,
  plans,
  packages,
  cards,
  attendance,
  audit,
  auth,
  users,
  payments,
  expenses,
  cash,
  dashboard,
  finance,
  reports,
  trainers,
  trainingPlans,
  settings,
  notifications,
  backup,
  store,
  classes,
  employees,
  employeesHr,
  inbody,
  permissions,
  reception,
  lead,
  trials,
  dev,
  memberProfile,
  referral,
  loyalty,
  messages,
  license,
  documentNumbers,
  fraudAlerts,
  invitations,
  pdf,
  promo,
  renewalAlerts,
  shifts,
  sync,
  vouchersService,
  quickSessions,
  debts,
  purchases,
  privateTraining,
  announcements,
  trainerAttendance,
  memberMessages,
  memberPortal,
  beltGradings,
  whatsappBot,
};

export interface SerializedError {
  name: "AppError";
  code: AppError["code"];
  messageKey: string;
  params: Record<string, string | number>;
}

export interface RpcOutcome {
  status: number;
  body: { ok: true; result: unknown } | { ok: false; error: SerializedError };
}

function serializeError(error: unknown): { status: number; error: SerializedError } {
  const appError = toAppError(error);
  if (appError) {
    const status =
      appError.code === "UNAUTHORIZED"
        ? 401
        : appError.code === "FORBIDDEN"
          ? 403
          : appError.code === "LOCKED"
            ? 423
            : appError.code === "NOT_FOUND" ||
                appError.code === "CONFLICT" ||
                appError.code === "VALIDATION"
              ? 400
              : 500;
    return {
      status,
      error: {
        name: "AppError",
        code: appError.code,
        messageKey: appError.messageKey,
        params: appError.params,
      },
    };
  }
  logLine(
    `rpc internal error: ${error instanceof Error ? (error.stack ?? String(error)) : String(error)}`,
  );
  return {
    status: 500,
    error: { name: "AppError", code: "INTERNAL", messageKey: "errors.unexpected", params: {} },
  };
}

export async function invokeRpc(
  actor: ServiceActor,
  serviceName: string,
  fnName: string,
  args: unknown[],
): Promise<RpcOutcome> {
  const { db } = getDbContext();
  try {
    refreshLicenseClock();
    if (!Object.hasOwn(REGISTRY, serviceName)) throw errForbidden();
    const service = REGISTRY[serviceName];
    if (!service || !Object.hasOwn(service, fnName)) throw errForbidden();
    const exposed = service[fnName];
    if (!exposed || typeof exposed.fn !== "function") throw errForbidden();
    const blocked = rpcBlockReason(serviceName, fnName);
    if (blocked) throw errLicenseLocked(blocked);
    const callArgs = [db, ...(exposed.actor ? [actor] : []), ...args] as never[];
    const result = await exposed.fn(...callArgs);
    return { status: 200, body: { ok: true, result } };
  } catch (error) {
    const mapped = serializeError(error);
    return { status: mapped.status, body: { ok: false, error: mapped.error } };
  }
}
