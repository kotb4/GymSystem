import { errForbidden, errNotFound, errValidation, toAppError, AppError } from "../src/core/errors";
import { requirePermission } from "../src/core/permissions";
import type { Db } from "../src/db/engine";
import type { ServiceActor } from "../src/core/permissions";
import * as membersService from "../src/core/services/members.service";
import * as subscriptionsService from "../src/core/services/subscriptions.service";
import * as plansService from "../src/core/services/plans.service";
import * as cardsService from "../src/core/services/cards.service";
import * as attendanceService from "../src/core/services/attendance.service";
import * as auditService from "../src/core/services/audit.service";
import * as authService from "../src/core/services/auth.service";
import * as usersService from "../src/core/services/users.service";
import * as paymentsService from "../src/core/services/payments.service";
import * as expensesService from "../src/core/services/expenses.service";
import * as cashSessionService from "../src/core/services/cash-session.service";
import * as dashboardService from "../src/core/services/dashboard.service";
import * as financeService from "../src/core/services/finance.service";
import * as financialReportService from "../src/core/services/financial-report.service";
import * as staffActivityService from "../src/core/services/staff-activity.service";
import * as attendanceAnalyticsService from "../src/core/services/attendance-analytics.service";
import * as trainersService from "../src/core/services/trainers.service";
import * as trainingPlansService from "../src/core/services/training-plans.service";
import * as settingsService from "../src/core/services/settings.service";
import * as notificationsService from "../src/core/services/notifications.service";
import * as backupService from "../src/core/services/backup.service";
import * as storeService from "../src/core/services/store.service";
import * as classesService from "../src/core/services/classes.service";
import * as employeesService from "../src/core/services/employees.service";
import * as employeesHrService from "../src/core/services/employees-hr.service";
import * as inbodyService from "../src/core/services/inbody.service";
import * as crmService from "../src/core/services/crm.service";
import * as permissionsService from "../src/core/services/permissions.service";
import * as filesService from "./files.service";
import { getDbContext, logLine } from "./context";
import { recordAudit } from "../src/core/services/audit.service";
import { nowStamp } from "@/core/dates";
import { getDevOverrideDate, setDevOverrideDate } from "@/core/dates";

/**
 * The frontend never touches SQLite. It calls whitelisted service functions
 * over localhost HTTP; this module is the only bridge (spec sections 7/8).
 * Business logic stays in src/core/services — imported here unchanged.
 */

type Fn = (...args: never[]) => unknown;
interface Exposed {
  fn: Fn;
  actor: boolean;
}

const a = (fn: Fn): Exposed => ({ fn, actor: true });
const p = (fn: Fn): Exposed => ({ fn, actor: false });

export const REGISTRY: Record<string, Record<string, Exposed>> = {
  members: {
    getMember: a(membersService.getMember as Fn),
    createMember: a(membersService.createMember as Fn),
    updateMember: a(membersService.updateMember as Fn),
    setMemberStatus: a(membersService.setMemberStatus as Fn),
    listMembers: a(membersService.listMembers as Fn),
    searchMembersForPicker: a(membersService.searchMembersForPicker as Fn),
    trashMember: a(membersService.trashMember as Fn),
    restoreMember: a(membersService.restoreMember as Fn),
    purgeMember: {
      fn: (async (dbUnknown: unknown, actor: ServiceActor, memberId: string) => {
        const db = dbUnknown as Db;
        const before = membersService.getMemberRowById(db, memberId);
        const photoMeta =
          before?.photo_file_id != null
            ? (() => {
                try {
                  return filesService.getFileMeta(db as never, String(before.photo_file_id));
                } catch {
                  return null;
                }
              })()
            : null;
        await membersService.purgeMember(db, actor, memberId);
        if (photoMeta) filesService.unlinkFileBytes(photoMeta);
      }) as Fn,
      actor: true,
    },
    listTrashedMembers: a(membersService.listTrashedMembers as Fn),
    setMemberPhoto: {
      fn: ((dbUnknown: unknown, actor: ServiceActor, memberId: string, fileId: string) => {
        const db = dbUnknown as Db;
        requirePermission(actor, "members.edit");
        const row = membersService.getMemberRowById(db, memberId);
        if (!row) throw errNotFound("errors.memberNotFound");
        const meta = filesService.getFileMeta(db as never, fileId);
        if (meta.kind !== "member_photo") throw errValidation("errors.file.kindInvalid");
        db.transaction(() => {
          if (row.photo_file_id) filesService.deleteFile(db, actor, String(row.photo_file_id));
          db.run("UPDATE members SET photo_file_id = ?, updated_at = ? WHERE id = ?", [
            fileId,
            nowStamp(),
            memberId,
          ]);
          recordAudit(db, actor, "MEMBER_PHOTO_CHANGED", "member", memberId, { fileId });
        });
        return membersService.toPublicMember(membersService.getMemberRowById(db, memberId)!);
      }) as Fn,
      actor: true,
    },
    removeMemberPhoto: {
      fn: ((dbUnknown: unknown, actor: ServiceActor, memberId: string) => {
        const db = dbUnknown as Db;
        requirePermission(actor, "members.edit");
        const row = membersService.getMemberRowById(db, memberId);
        if (!row) throw errNotFound("errors.memberNotFound");
        if (row.photo_file_id) {
          const fileId = String(row.photo_file_id);
          db.transaction(() => {
            db.run("UPDATE members SET photo_file_id = NULL WHERE id = ?", [memberId]);
            filesService.deleteFile(db, actor, fileId);
            recordAudit(db, actor, "MEMBER_PHOTO_CHANGED", "member", memberId, { removed: true });
          });
        }
        return membersService.toPublicMember(membersService.getMemberRowById(db, memberId)!);
      }) as Fn,
      actor: true,
    },
  },
  subscriptions: {
    createSubscription: a(subscriptionsService.createSubscription as Fn),
    updateSubscription: a(subscriptionsService.updateSubscription as Fn),
    setSubscriptionStatus: a(subscriptionsService.setSubscriptionStatus as Fn),
    undoCancelSubscription: a(subscriptionsService.undoCancelSubscription as Fn),
    listMemberSubscriptions: a(subscriptionsService.listMemberSubscriptions as Fn),
    listSubscriptions: a(subscriptionsService.listSubscriptions as Fn),
    listExpiringSubscriptions: a(subscriptionsService.listExpiringSubscriptions as Fn),
    countActiveSubscriptions: p(subscriptionsService.countActiveSubscriptions as Fn),
    listSubscriptionFreezes: a(subscriptionsService.listSubscriptionFreezes as Fn),
    freezeSubscription: a(subscriptionsService.freezeSubscription as Fn),
    unfreezeSubscription: a(subscriptionsService.unfreezeSubscription as Fn),
    renewSubscription: a(subscriptionsService.renewSubscription as Fn),
    purgeSubscription: a(subscriptionsService.purgeSubscription as Fn),
  },
  plans: {
    listPlans: a(plansService.listPlans as Fn),
    createPlan: a(plansService.createPlan as Fn),
    updatePlan: a(plansService.updatePlan as Fn),
  },
  cards: {
    nextBarcodePreview: p(cardsService.nextBarcodePreview as Fn),
    registerCard: a(cardsService.registerCard as Fn),
    assignCardByBarcode: a(cardsService.assignCardByBarcode as Fn),
    unassignCard: a(cardsService.unassignCard as Fn),
    reportCardLost: a(cardsService.reportCardLost as Fn),
    setCardBlocked: a(cardsService.setCardBlocked as Fn),
    listCards: a(cardsService.listCards as Fn),
    listMemberCards: a(cardsService.listMemberCards as Fn),
    registerCardsBulk: a(cardsService.registerCardsBulk as Fn),
  },
  attendance: {
    recordCheckIn: a(attendanceService.recordCheckIn as Fn),
    recordCheckOut: a(attendanceService.recordCheckOut as Fn),
    listRecentCheckIns: a(attendanceService.listRecentCheckIns as Fn),
    countCheckInsOnDate: p(attendanceService.countCheckInsOnDate as Fn),
    listAttendanceForMember: a(attendanceService.listAttendanceForMember as Fn),
    deleteAttendance: a(attendanceService.deleteAttendance as Fn),
    restoreAttendance: a(attendanceService.restoreAttendance as Fn),
    attendanceSeries: p(attendanceService.attendanceSeries as Fn),
    duplicateWindowSeconds: p(attendanceService.duplicateWindowSeconds as Fn),
  },
  audit: {
    listAuditLogs: a(auditService.listAuditLogs as Fn),
  },
  auth: {
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
  },
  users: {
    listUsers: a(usersService.listUsers as Fn),
    createUser: a(usersService.createUser as Fn),
    updateUser: a(usersService.updateUser as Fn),
    resetPassword: a(usersService.resetPassword as Fn),
    setUserActive: a(usersService.setUserActive as Fn),
  },
  payments: {
    getPaymentById: a(paymentsService.getPaymentById as Fn),
    recordPayment: a(paymentsService.recordPayment as Fn),
    refundPayment: a(paymentsService.refundPayment as Fn),
    voidPayment: a(paymentsService.voidPayment as Fn),
    unvoidPayment: a(paymentsService.unvoidPayment as Fn),
    undoRefund: a(paymentsService.undoRefund as Fn),
    getSubscriptionBalance: a(paymentsService.getSubscriptionBalance as Fn),
    listPayments: a(paymentsService.listPayments as Fn),
    listActiveMethods: p(paymentsService.listActiveMethods as Fn),
  },
  expenses: {
    createExpense: a(expensesService.createExpense as Fn),
    updateExpense: a(expensesService.updateExpense as Fn),
    voidExpense: a(expensesService.voidExpense as Fn),
    unvoidExpense: a(expensesService.unvoidExpense as Fn),
    getExpenseById: a(expensesService.getExpenseById as Fn),
    listExpenses: a(expensesService.listExpenses as Fn),
    listCategories: p(expensesService.listCategories as Fn),
    createCategory: a(expensesService.createCategory as Fn),
    setCategoryActive: a(expensesService.setCategoryActive as Fn),
  },
  cash: {
    getOpenCashSession: a(cashSessionService.getOpenCashSession as Fn),
    openCashSession: a(cashSessionService.openCashSession as Fn),
    closeCashSession: a(cashSessionService.closeCashSession as Fn),
    deleteCashSession: a(cashSessionService.deleteCashSession as Fn),
    getOpenSessionTotals: a(cashSessionService.getOpenSessionTotals as Fn),
    listCashSessions: a(cashSessionService.listCashSessions as Fn),
  },
  dashboard: {
    getDashboardStats: a(dashboardService.getDashboardStats as Fn),
    getDashboardAttendance: a(dashboardService.getDashboardAttendance as Fn),
    getExpiringForDashboard: a(dashboardService.getExpiringForDashboard as Fn),
    getDashboardOperational: a(dashboardService.getDashboardOperational as Fn),
  },
  finance: {
    getFinanceOverview: a(financeService.getFinanceOverview as Fn),
    getMemberOutstanding: a(financeService.getMemberOutstanding as Fn),
    listLedgerEntries: a(financeService.listLedgerEntries as Fn),
  },
  reports: {
    getPeriodReport: a(financialReportService.getPeriodReport as Fn),
    getStaffActivity: a(staffActivityService.getStaffActivity as Fn),
    getAttendanceAnalytics: a(attendanceAnalyticsService.getAttendanceAnalytics as Fn),
  },
  trainers: {
    createTrainer: a(trainersService.createTrainer as Fn),
    updateTrainer: a(trainersService.updateTrainer as Fn),
    setTrainerActive: a(trainersService.setTrainerActive as Fn),
    listTrainers: a(trainersService.listTrainers as Fn),
  },
  trainingPlans: {
    getTrainingPlanById: a(trainingPlansService.getTrainingPlanById as Fn),
    createTrainingPlan: a(trainingPlansService.createTrainingPlan as Fn),
    updateTrainingPlan: a(trainingPlansService.updateTrainingPlan as Fn),
    endTrainingPlan: a(trainingPlansService.endTrainingPlan as Fn),
    cancelTrainingPlan: a(trainingPlansService.cancelTrainingPlan as Fn),
    reactivateTrainingPlan: a(trainingPlansService.reactivateTrainingPlan as Fn),
    listTrainingPlans: a(trainingPlansService.listTrainingPlans as Fn),
    sweepExpiredPlans: a(trainingPlansService.sweepExpiredPlans as Fn),
  },
  settings: {
    readAllSettings: a(settingsService.readAllSettings as Fn),
    updateSetting: a(settingsService.updateSetting as Fn),
    getScannerConfig: p(settingsService.getScannerConfig as Fn),
    isSoundEnabled: p(settingsService.isSoundEnabled as Fn),
    getBackupConfig: a(settingsService.getBackupConfig as Fn),
    getWorkingDays: p(settingsService.getWorkingDays as Fn),
    getInactiveDays: p(settingsService.getInactiveDays as Fn),
    isCheckoutEnabled: p(settingsService.isCheckoutEnabled as Fn),
    freezeExtendsExpiry: p(settingsService.freezeExtendsExpiry as Fn),
  },
  notifications: {
    collectNotifications: a(notificationsService.collectNotifications as Fn),
  },
  backup: {
    listBackupEntries: a(backupService.listBackupEntries as Fn),
    collectDiagnostics: a(backupService.collectDiagnostics as Fn),
  },
  store: {
    listProductCategories: a(storeService.listProductCategories as Fn),
    createProductCategory: a(storeService.createProductCategory as Fn),
    setProductCategoryActive: a(storeService.setProductCategoryActive as Fn),
    purgeProduct: a(storeService.purgeProduct as Fn),
    listProducts: a(storeService.listProducts as Fn),
    getProduct: a(storeService.getProduct as Fn),
    createProduct: a(storeService.createProduct as Fn),
    updateProduct: a(storeService.updateProduct as Fn),
    adjustStock: a(storeService.adjustStock as Fn),
    listStockMovements: a(storeService.listStockMovements as Fn),
    createSale: a(storeService.createSale as Fn),
    getSale: a(storeService.getSale as Fn),
    listSales: a(storeService.listSales as Fn),
    voidStoreSale: a(storeService.voidStoreSale as Fn),
    unvoidStoreSale: a(storeService.unvoidStoreSale as Fn),
    listStoreDebts: a(storeService.listStoreDebts as Fn),
    repayStoreDebt: a(storeService.repayStoreDebt as Fn),
    getMemberStoreDebtTotal: a(storeService.getMemberStoreDebtTotal as Fn),
    getStoreStats: a(storeService.getStoreStats as Fn),
  },
  classes: {
    listClasses: a(classesService.listClasses as Fn),
    createClass: a(classesService.createClass as Fn),
    updateClass: a(classesService.updateClass as Fn),
    createClassSession: a(classesService.createClassSession as Fn),
    listSessions: a(classesService.listSessions as Fn),
    cancelClassSession: a(classesService.cancelClassSession as Fn),
    uncancelClassSession: a(classesService.uncancelClassSession as Fn),
    completeClassSession: a(classesService.completeClassSession as Fn),
    listBookings: a(classesService.listBookings as Fn),
    listMemberBookings: a(classesService.listMemberBookings as Fn),
    bookMember: a(classesService.bookMember as Fn),
    cancelBooking: a(classesService.cancelBooking as Fn),
    setBookingStatus: a(classesService.setBookingStatus as Fn),
  },
  employees: {
    purgeEmployee: a(employeesService.purgeEmployee as Fn),
    listEmployees: a(employeesService.listEmployees as Fn),
    createEmployee: a(employeesService.createEmployee as Fn),
    updateEmployee: a(employeesService.updateEmployee as Fn),
    listSalaries: a(employeesService.listSalaries as Fn),
    recordSalary: a(employeesService.recordSalary as Fn),
    paySalary: a(employeesService.paySalary as Fn),
  },
  employeesHr: {
    clockIn: a(employeesHrService.clockIn as Fn),
    clockOut: a(employeesHrService.clockOut as Fn),
    upsertAttendance: a(employeesHrService.upsertAttendance as Fn),
    listAttendance: a(employeesHrService.listAttendance as Fn),
    requestLeave: a(employeesHrService.requestLeave as Fn),
    listLeaves: a(employeesHrService.listLeaves as Fn),
    decideLeave: a(employeesHrService.decideLeave as Fn),
    cancelLeave: a(employeesHrService.cancelLeave as Fn),
    getLeaveBalance: a(employeesHrService.getLeaveBalance as Fn),
    listDeductions: a(employeesHrService.listDeductions as Fn),
    listIncentives: a(employeesHrService.listIncentives as Fn),
    addDeduction: a(employeesHrService.addDeduction as Fn),
    addIncentive: a(employeesHrService.addIncentive as Fn),
    monthlySalarySummary: a(employeesHrService.monthlySalarySummary as Fn),
    employeeDailyActivity: a(employeesHrService.employeeDailyActivity as Fn),
  },
  inbody: {
    createAssessment: a(inbodyService.createAssessment as Fn),
    deleteAssessment: a(inbodyService.deleteAssessment as Fn),
    listAssessments: a(inbodyService.listAssessments as Fn),
    getProgress: a(inbodyService.getProgress as Fn),
    listFitnessTestDefs: a(inbodyService.listFitnessTestDefs as Fn),
    upsertFitnessTestDef: a(inbodyService.upsertFitnessTestDef as Fn),
    recordFitnessResult: a(inbodyService.recordFitnessResult as Fn),
    listFitnessResults: a(inbodyService.listFitnessResults as Fn),
  },
  crm: {
    listTemplates: a(crmService.listTemplates as Fn),
    upsertTemplate: a(crmService.upsertTemplate as Fn),
    queueMessage: a(crmService.queueMessage as Fn),
    sendPendingMessages: a(crmService.sendPendingMessages as Fn),
    markManuallySent: a(crmService.markManuallySent as Fn),
    listMessages: a(crmService.listMessages as Fn),
    generateDueMessages: a(crmService.generateDueMessages as Fn),
  },
  permissions: {
    getRolePermissions: a(permissionsService.getRolePermissions as Fn),
    getAllPermissions: a(permissionsService.getAllPermissions as Fn),
    setRolePermissions: a(permissionsService.setRolePermissions as Fn),
  },
  dev: {
    getOverrideDate: p((() => getDevOverrideDate()) as Fn),
    setOverrideDate: a((((_db: Db, actor: ServiceActor, date: string | null) => {
      requirePermission(actor, "settings.edit");
      setDevOverrideDate(date);
      return getDevOverrideDate();
    }) as Fn)),
  },
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
            : appError.code === "NOT_FOUND" || appError.code === "CONFLICT" || appError.code === "VALIDATION"
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
  logLine(`rpc internal error: ${error instanceof Error ? (error.stack ?? String(error)) : String(error)}`);
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
    const service = REGISTRY[serviceName];
    const exposed = service?.[fnName];
    if (!service || !exposed) throw errForbidden();
    const callArgs = [db, ...(exposed.actor ? [actor] : []), ...args] as never[];
    const result = await exposed.fn(...callArgs);
    return { status: 200, body: { ok: true, result } };
  } catch (error) {
    const mapped = serializeError(error);
    return { status: mapped.status, body: { ok: false, error: mapped.error } };
  }
}
