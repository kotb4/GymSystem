import { postJson, postRaw, rpc, request } from "./client";
import type { MeResponse } from "./client";

// Types only — the implementations live in the local backend.
import type {
  MemberInput,
  MemberListQuery,
  MemberStatus,
  PublicMember,
  SmartFilter,
  TrashedMemberInfo,
} from "@/core/services/members.service";
import type {
  CreateSubscriptionInput,
  FreezeInfo,
  Subscription,
  SubscriptionListQuery,
  SubscriptionRowStatus,
  SubscriptionWithMember,
  UpdateSubscriptionPatch,
} from "@/core/services/subscriptions.service";
import type { Plan, PlanInput } from "@/core/services/plans.service";
import type {
  Package,
  PackageInput,
  PackagePatch,
  PackageStats,
} from "@/core/services/packages.service";
import type { BulkRegisterResult, CardStatus, CardWithMember } from "@/core/services/cards.service";
import type {
  ReferralRow,
  ReferralStats,
  ReferralRewardRow,
  TopReferrerRow,
} from "@/core/services/referral.service";
import type {
  EarnRule,
  EarnRuleInput,
  LoyaltyBalance,
  LoyaltySettings,
  MemberTransactionPage,
  MemberTransactionQuery,
  RedemptionInput,
  RedemptionItem,
  RedemptionResult,
} from "@/core/services/loyalty.service";

import type { AuditListQuery, AuditLogItem } from "@/core/services/audit.service";
import type { MemberOverview } from "@/core/services/member-profile.service";
import type {
  CreateUserInput,
  PublicUser,
  UpdateUserInput,
} from "@/core/services/users.service";
import type {
  Payment,
  PaymentListQuery,
  RecordPaymentInput,
  SubscriptionBalance,
} from "@/core/services/payments.service";
import type { Expense, ExpenseCategory, ExpenseListQuery } from "@/core/services/expenses.service";
import type { CashSession, CashSessionStatus } from "@/core/services/cash-session.service";
import type {
  DashboardOperationalStats,
  DashboardOverview,
  DashboardRange,
  DashboardStats,
  DashboardSeriesResult,
} from "@/core/services/dashboard.service";
import type { FinanceOverview } from "@/core/services/finance.service";
import type { PeriodReport } from "@/core/services/financial-report.service";
import type { StaffActivityReport } from "@/core/services/staff-activity.service";
import type { AttendanceAnalytics } from "@/core/services/attendance-analytics.service";
import type { RetentionInsights } from "@/core/services/activity-insights.service";
import type { TrainerListQuery, PublicTrainer } from "@/core/services/trainers.service";
import type {
  PublicTrainingPlan,
  TrainingPlanRow,
  TrainingPlanListQuery,
} from "@/core/services/training-plans.service";
import type { AppNotification } from "@/core/services/notifications.service";
import type { AttendanceDayPoint, CheckInResult } from "@/core/services/attendance.service";
import type {
  ReceptionLookup,
  ReceptionSearchResult,
} from "@/core/services/reception.service";
import type {
  ConvertTrialInput,
  ConvertTrialResult,
  Trial,
  TrialListQuery,
  TrialStats,
  TrialStatus,
  TrialType,
} from "@/core/services/trials.service";

const membersApi = {
  get: (id: string) => rpc<PublicMember>("members", "getMember", [id]),
  create: (input: MemberInput) => rpc<PublicMember>("members", "createMember", [input]),
  update: (id: string, patch: MemberInput) => rpc<PublicMember>("members", "updateMember", [id, patch]),
  setStatus: (id: string, status: MemberStatus) =>
    rpc<PublicMember>("members", "setMemberStatus", [id, status]),
  list: (query: MemberListQuery & { smart?: SmartFilter; inactiveDays?: number } = {}) =>
    rpc<{ items: PublicMember[]; total: number }>("members", "listMembers", [query]),
  searchPicker: (term: string, limit = 8) =>
    rpc<PublicMember[]>("members", "searchMembersForPicker", [term, limit]),
  trash: (id: string, reason?: string | null) =>
    rpc<PublicMember>("members", "trashMember", [id, reason ?? null]),
  restore: (id: string) => rpc<PublicMember>("members", "restoreMember", [id]),
  purge: (id: string) => rpc<void>("members", "purgeMember", [id]),
  listTrashed: () => rpc<TrashedMemberInfo[]>("members", "listTrashedMembers", []),
  setMemberPhoto: (id: string, fileId: string) =>
    rpc<PublicMember>("members", "setMemberPhoto", [id, fileId]),
  removeMemberPhoto: (id: string) =>
    rpc<PublicMember>("members", "removeMemberPhoto", [id]),
  overview: (id: string) => rpc<MemberOverview>("memberProfile", "getMemberOverview", [id]),
  listAuditForMember: (id: string, query: { page?: number; pageSize?: number } = {}) =>
    rpc<{ items: AuditLogItem[]; total: number }>(
      "memberProfile",
      "listAuditForMember",
      [id, query],
    ),
};

const subscriptionsApi = {
  create: (input: CreateSubscriptionInput) =>
    rpc<Subscription>("subscriptions", "createSubscription", [input]),
  update: (id: string, patch: UpdateSubscriptionPatch) =>
    rpc<Subscription>("subscriptions", "updateSubscription", [id, patch]),
  setStatus: (id: string, status: SubscriptionRowStatus) =>
    rpc<Subscription>("subscriptions", "setSubscriptionStatus", [id, status]),
  purge: (id: string) => rpc<void>("subscriptions", "purgeSubscription", [id]),
  undoCancel: (id: string) => rpc<Subscription>("subscriptions", "undoCancelSubscription", [id]),
  listForMember: (memberId: string) =>
    rpc<Subscription[]>("subscriptions", "listMemberSubscriptions", [memberId]),
  list: (query: SubscriptionListQuery = {}) =>
    rpc<{ items: SubscriptionWithMember[]; total: number }>("subscriptions", "listSubscriptions", [query]),
  freezes: (subscriptionId: string) =>
    rpc<FreezeInfo[]>("subscriptions", "listSubscriptionFreezes", [subscriptionId]),
  freeze: (id: string, input: { startDate?: string | null; endDate: string; reason?: string | null; notes?: string | null }) =>
    rpc<Subscription>("subscriptions", "freezeSubscription", [id, input]),
  unfreeze: (id: string) => rpc<Subscription>("subscriptions", "unfreezeSubscription", [id]),
  renew: (id: string, input: { price?: number; notes?: string | null } = {}) =>
    rpc<{ previous: Subscription; next: Subscription; startedToday: boolean }>(
      "subscriptions",
      "renewSubscription",
      [id, input],
    ),
};

const plansApi = {
  list: (includeInactive = true) => rpc<Plan[]>("plans", "listPlans", [includeInactive]),
  create: (input: PlanInput) => rpc<unknown>("plans", "createPlan", [input]),
  update: (id: string, patch: PlanInput) => rpc<unknown>("plans", "updatePlan", [id, patch]),
};

const packagesApi = {
  list: (includeInactive = true) => rpc<Package[]>("packages", "listPackages", [includeInactive]),
  get: (id: string) => rpc<Package>("packages", "getPackage", [id]),
  create: (input: PackageInput) => rpc<Package>("packages", "createPackage", [input]),
  update: (id: string, patch: PackagePatch) => rpc<Package>("packages", "updatePackage", [id, patch]),
  toggle: (id: string, isActive: boolean) => rpc<Package>("packages", "setPackageActive", [id, isActive]),
  duplicate: (id: string) => rpc<Package>("packages", "duplicatePackage", [id]),
  stats: () => rpc<PackageStats>("packages", "packageStats", []),
};

const cardsApi = {
  nextBarcodePreview: () => rpc<string>("cards", "nextBarcodePreview", []),
  register: (input: { barcodeValue: string; notes?: string | null }) =>
    rpc<unknown>("cards", "registerCard", [input]),
  assignByBarcode: (input: { barcodeValue: string; memberId: string }) =>
    rpc<unknown>("cards", "assignCardByBarcode", [input]),
  unassign: (cardId: string) => rpc<unknown>("cards", "unassignCard", [cardId]),
  reportLost: (cardId: string) => rpc<unknown>("cards", "reportCardLost", [cardId]),
  setBlocked: (cardId: string, blocked: boolean) =>
    rpc<unknown>("cards", "setCardBlocked", [cardId, blocked]),
  list: (query: { page?: number; pageSize?: number; status?: CardStatus | "all"; search?: string } = {}) =>
    rpc<{ items: CardWithMember[]; total: number }>("cards", "listCards", [query]),
  listForMember: (memberId: string) => rpc<unknown[]>("cards", "listMemberCards", [memberId]),
  bulkRegister: (barcodes: string[]) => rpc<BulkRegisterResult>("cards", "registerCardsBulk", [barcodes]),
};

const attendanceApi = {
  checkIn: (input: { barcode: string; deviceIdentifier?: string }) =>
    rpc<unknown>("attendance", "recordCheckIn", [input]),
  checkOut: (memberId: string) => rpc<unknown>("attendance", "recordCheckOut", [memberId]),
  recent: (limit?: number) => rpc<unknown[]>("attendance", "listRecentCheckIns", [limit]),
  series: (days: number) => rpc<AttendanceDayPoint[]>("attendance", "attendanceSeries", [days]),
  forMember: (memberId: string, limit?: number) =>
    rpc<unknown[]>("attendance", "listAttendanceForMember", [memberId, limit]),
  delete: (attendanceId: string) => rpc<void>("attendance", "deleteAttendance", [attendanceId]),
  restore: (attendanceId: string) => rpc<void>("attendance", "restoreAttendance", [attendanceId]),
};

const receptionApi = {
  search: (term: string, limit = 10) =>
    rpc<ReceptionSearchResult[]>("reception", "search", [term, limit]),
  lookup: (input: { barcode?: string; memberId?: string }) =>
    rpc<ReceptionLookup>("reception", "lookup", [input]),
  checkIn: (input: { barcode?: string; memberId?: string; deviceIdentifier?: string }) =>
    rpc<CheckInResult>("reception", "checkIn", [input]),
};

const settingsApi = {
  readAll: () => rpc<Record<string, string>>("settings", "readAllSettings", []),
  update: (key: string, value: string) => rpc<void>("settings", "updateSetting", [key, value]),
  scannerConfig: () => rpc<{ enabled: boolean; prefix: string; suffix: string; minLength: number; timeoutMs: number; maxKeyIntervalMs: number }>("settings", "getScannerConfig", []),
  soundEnabled: () => rpc<boolean>("settings", "isSoundEnabled", []),
  backupConfig: () => rpc<{ autoIntervalHours: number; retentionCount: number }>("settings", "getBackupConfig", []),
  workingDays: () => rpc<number[]>("settings", "getWorkingDays", []),
  inactiveDays: () => rpc<number>("settings", "getInactiveDays", []),
  checkoutEnabled: () => rpc<boolean>("settings", "isCheckoutEnabled", []),
  freezeExtendsExpiry: () => rpc<boolean>("settings", "freezeExtendsExpiry", []),
};

const auditApi = {
  list: (query: AuditListQuery = {}) =>
    rpc<{ items: AuditLogItem[]; total: number }>("audit", "listAuditLogs", [query]),
};

const usersApi = {
  list: () => rpc<PublicUser[]>("users", "listUsers", []),
  create: (input: CreateUserInput) => rpc<PublicUser>("users", "createUser", [input]),
  update: (id: string, patch: UpdateUserInput) => rpc<PublicUser>("users", "updateUser", [id, patch]),
  resetPassword: (userId: string, newPassword: string) =>
    rpc<void>("users", "resetPassword", [userId, newPassword]),
  setActive: (userId: string, isActive: boolean) => rpc<void>("users", "setUserActive", [userId, isActive]),
};

const paymentsApi = {
  get: (paymentId: string) => rpc<Payment>("payments", "getPaymentById", [paymentId]),
  record: (input: RecordPaymentInput) => rpc<Payment>("payments", "recordPayment", [input]),
  refund: (paymentId: string, amountMinor: number, reason: string, methodCode?: string) =>
    rpc<Payment>("payments", "refundPayment", [paymentId, amountMinor, reason, methodCode]),
  void: (paymentId: string, reason: string) => rpc<Payment>("payments", "voidPayment", [paymentId, reason]),
  unvoid: (paymentId: string) => rpc<Payment>("payments", "unvoidPayment", [paymentId]),
  undoRefund: (paymentId: string) => rpc<Payment>("payments", "undoRefund", [paymentId]),
  subscriptionBalance: (subscriptionId: string) =>
    rpc<SubscriptionBalance>("payments", "getSubscriptionBalance", [subscriptionId]),
  list: (query: PaymentListQuery = {}) =>
    rpc<{ items: Payment[]; total: number }>("payments", "listPayments", [query]),
  methods: () => rpc<Array<{ code: string; labelAr: string }>>("payments", "listActiveMethods", []),
};

const expensesApi = {
  create: (input: unknown) => rpc<Expense>("expenses", "createExpense", [input]),
  update: (expenseId: string, patch: unknown) => rpc<Expense>("expenses", "updateExpense", [expenseId, patch]),
  void: (expenseId: string, reason: string) => rpc<Expense>("expenses", "voidExpense", [expenseId, reason]),
  unvoid: (expenseId: string) => rpc<Expense>("expenses", "unvoidExpense", [expenseId]),
  get: (expenseId: string) => rpc<Expense>("expenses", "getExpenseById", [expenseId]),
  list: (query: ExpenseListQuery = {}) =>
    rpc<{ items: Expense[]; total: number }>("expenses", "listExpenses", [query]),
  categories: (includeInactive = true) =>
    rpc<ExpenseCategory[]>("expenses", "listCategories", [includeInactive]),
  createCategory: (nameAr: string) => rpc<ExpenseCategory>("expenses", "createCategory", [nameAr]),
  setCategoryActive: (categoryId: string, isActive: boolean) =>
    rpc<void>("expenses", "setCategoryActive", [categoryId, isActive]),
};

const cashApi = {
  openSession: () => rpc<CashSession | null>("cash", "getOpenCashSession", []),
  open: (input: { openingBalanceMinor: number; box?: "gym" | "store" }) =>
    rpc<CashSession>("cash", "openCashSession", [input]),
  close: (sessionId: string, input: { countedClosingMinor: number; closeNote?: string | null }) =>
    rpc<CashSession>("cash", "closeCashSession", [
      sessionId,
      input.countedClosingMinor,
      input.closeNote ?? null,
    ]),
  openTotals: () => rpc<unknown>("cash", "getOpenSessionTotals", []),
  removeSession: (sessionId: string) => rpc<void>("cash", "deleteCashSession", [sessionId]),
  list: (query: { page?: number; pageSize?: number; status?: CashSessionStatus | "all" } = {}) =>
    rpc<{ items: CashSession[]; total: number }>("cash", "listCashSessions", [query]),
};

const dashboardApi = {
  stats: () => rpc<DashboardStats>("dashboard", "getDashboardStats", []),
  attendance: (days: 7 | 30) => rpc<AttendanceDayPoint[]>("dashboard", "getDashboardAttendance", [days]),
  expiring: (withinDays = 7) =>
    rpc<SubscriptionWithMember[]>("dashboard", "getExpiringForDashboard", [withinDays]),
  operational: () => rpc<DashboardOperationalStats>("dashboard", "getDashboardOperational", []),
  series: (
    key: "today" | "7d" | "30d" | "month" | "year" | "custom",
    custom?: DashboardRange,
  ) => rpc<DashboardSeriesResult>("dashboard", "getDashboardSeries", [key, custom]),
  overview: (
    key: "today" | "7d" | "30d" | "month" | "year" | "custom",
    custom?: DashboardRange,
  ) => rpc<DashboardOverview>("dashboard", "getDashboardOverview", [key, custom]),
};

const financeApi = {
  overview: (todayKeyStr: string, monthStartKey: string) =>
    rpc<FinanceOverview>("finance", "getFinanceOverview", [todayKeyStr, monthStartKey]),
  outstandingForMember: (memberId: string) =>
    rpc<{ subscriptionsMinor: number; storeMinor: number; totalMinor: number }>(
      "finance",
      "getMemberOutstanding",
      [memberId],
    ),
};

const reportsApi = {
  period: (fromKey: string, toKey: string) =>
    rpc<PeriodReport>("reports", "getPeriodReport", [fromKey, toKey]),
  staffActivity: (range: { fromKey: string; toKey: string }) =>
    rpc<StaffActivityReport>("reports", "getStaffActivity", [range]),
  attendanceAnalytics: (range: { fromKey: string; toKey: string }) =>
    rpc<AttendanceAnalytics>("reports", "getAttendanceAnalytics", [range]),
  retentionInsights: (range: { fromKey: string; toKey: string }) =>
    rpc<RetentionInsights>("reports", "getRetentionInsights", [range]),
};

const trainersApi = {
  list: (query: TrainerListQuery = {}) => rpc<PublicTrainer[]>("trainers", "listTrainers", [query]),
  create: (input: Partial<PublicTrainer>) => rpc<unknown>("trainers", "createTrainer", [input]),
  update: (trainerId: string, patch: Partial<PublicTrainer>) =>
    rpc<unknown>("trainers", "updateTrainer", [trainerId, patch]),
  setActive: (trainerId: string, isActive: boolean) =>
    rpc<unknown>("trainers", "setTrainerActive", [trainerId, isActive]),
};

const trainingPlansApi = {
  get: (planId: string) => rpc<PublicTrainingPlan>("trainingPlans", "getTrainingPlanById", [planId]),
  create: (input: TrainingPlanRow) => rpc<PublicTrainingPlan>("trainingPlans", "createTrainingPlan", [input]),
  update: (planId: string, patch: Partial<Partial<TrainingPlanRow & { trainerId: string }> | TrainingPlanRow>) =>
    rpc<PublicTrainingPlan>("trainingPlans", "updateTrainingPlan", [planId, patch]),
  end: (planId: string) => rpc<PublicTrainingPlan>("trainingPlans", "endTrainingPlan", [planId]),
  cancel: (planId: string) => rpc<PublicTrainingPlan>("trainingPlans", "cancelTrainingPlan", [planId]),
  reactivate: (planId: string) => rpc<PublicTrainingPlan>("trainingPlans", "reactivateTrainingPlan", [planId]),
  list: (query: TrainingPlanListQuery = {}) =>
    rpc<{ items: PublicTrainingPlan[]; total: number }>("trainingPlans", "listTrainingPlans", [query]),
};

const notificationsApi = {
  collect: () => rpc<AppNotification[]>("notifications", "collectNotifications", []),
};

const backupApi = {
  entries: (limit = 30) => rpc<unknown[]>("backup", "listBackupEntries", [limit]),
  diagnostics: () => rpc<Record<string, unknown>>("backup", "collectDiagnostics", []),
  createSnapshot: (kind: "manual" | "auto") =>
    postJson<{ fileName: string; sizeBytes: number }>("/api/backups/create", { kind }),
  downloadUrl: (fileName: string) => `/api/backups/download?file=${encodeURIComponent(fileName)}`,
  restoreBytes: (bytes: Uint8Array) => postRaw<Record<string, unknown>>("/api/system/restore", bytes),
  importLegacyBytes: (bytes: Uint8Array) =>
    postRaw<Record<string, unknown>>("/api/system/import-legacy", bytes),
};

// ------------------------------ store/POS --------------------------------

export interface ProductPublic {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  sku: string | null;
  barcode: string | null;
  costMinor: number;
  priceMinor: number;
  stockQty: number;
  minStockQty: number;
  supplierName: string | null;
  isActive: boolean;
  lowStock: boolean;
}
export interface StoreSaleItem {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  returnedQty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}
export interface StoreSale {
  id: string;
  saleNo: string;
  itemsTotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  costTotalMinor: number;
  grossProfitMinor: number;
  methodCode: string;
  memberId: string | null;
  memberName: string | null;
  isCredit: boolean;
  status: "completed" | "voided";
  soldAt: string;
  items: StoreSaleItem[];
}
export interface StoreDebtRow {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  originalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: "open" | "settled";
  saleNo: string;
  createdAt: string;
}
export interface StockMovementRow {
  id: string;
  productName: string;
  movementType: string;
  delta: number;
  resultQty: number;
  unitCostMinor: number | null;
  notes: string | null;
  createdAt: string;
}
export interface StoreStats {
  salesCount: number;
  revenueMinor: number;
  costMinor: number;
  grossProfitMinor: number;
  creditOpenCount: number;
  creditOpenMinor: number;
  lowStockCount: number;
}
export interface StoreReturnItemRow {
  id: string;
  returnId: string;
  saleItemId: string;
  productId: string;
  productName: string;
  qty: number;
  unitPriceMinor: number;
  unitCostMinor: number;
  lineTotalMinor: number;
}
export interface StoreReturnRow {
  id: string;
  returnNo: string;
  saleId: string;
  saleNo: string;
  memberId: string | null;
  memberName: string | null;
  itemsTotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  reason: string | null;
  box: string;
  createdBy: string;
  createdAt: string;
  items: StoreReturnItemRow[];
}
export interface DailySalesRow {
  dateKey: string;
  salesCount: number;
  revenueMinor: number;
  costMinor: number;
  returnsCount: number;
  returnsMinor: number;
  netMinor: number;
  grossProfitMinor: number;
}
export interface ProductSalesRow {
  productId: string;
  productName: string;
  categoryName: string | null;
  unitsSold: number;
  unitsReturned: number;
  netUnits: number;
  revenueMinor: number;
  costMinor: number;
  grossProfitMinor: number;
}
export interface StockValueRow {
  totalCostMinor: number;
  potentialRetailMinor: number;
  potentialGrossProfitMinor: number;
  productCount: number;
}

const storeApi = {
  listCategories: (includeInactive = true) =>
    rpc<Array<{ id: string; nameAr: string; isActive: boolean }>>("store", "listProductCategories", [includeInactive]),
  createCategory: (nameAr: string) => rpc<{ id: string; nameAr: string }>("store", "createProductCategory", [nameAr]),
  setCategoryActive: (id: string, isActive: boolean) => rpc<void>("store", "setProductCategoryActive", [id, isActive]),
  listProducts: (query: Record<string, unknown> = {}) =>
    rpc<{ items: ProductPublic[]; total: number }>("store", "listProducts", [query]),
  getProduct: (id: string) => rpc<ProductPublic>("store", "getProduct", [id]),
purgeProduct: (id: string) => rpc<void>("store", "purgeProduct", [id]),
  createProduct: (input: Partial<ProductPublic>) => rpc<ProductPublic>("store", "createProduct", [input]),
  updateProduct: (id: string, patch: Partial<ProductPublic>) => rpc<ProductPublic>("store", "updateProduct", [id, patch]),
  adjustStock: (input: { productId: string; movementType: string; delta: number; unitCostMinor?: number | null; notes?: string | null }) =>
    rpc<ProductPublic>("store", "adjustStock", [input]),
  listStockMovements: (query: { productId?: string; limit?: number } = {}) =>
    rpc<StockMovementRow[]>("store", "listStockMovements", [query]),
  createSale: (input: { items: Array<{ productId: string; qty: number }>; discountMinor?: number; methodCode: string; memberId?: string | null; isCredit?: boolean; notes?: string | null }) =>
    rpc<StoreSale>("store", "createSale", [input]),
  getSale: (id: string) => rpc<StoreSale>("store", "getSale", [id]),
  listSales: (query: Record<string, unknown> = {}) =>
    rpc<{ items: StoreSale[]; total: number }>("store", "listSales", [query]),
  voidStoreSale: (id: string, reason: string) => rpc<void>("store", "voidStoreSale", [id, reason]),
  unvoidStoreSale: (id: string) => rpc<void>("store", "unvoidStoreSale", [id]),
  listDebts: (query: Record<string, unknown> = {}) =>
    rpc<{ items: StoreDebtRow[]; total: number }>("store", "listStoreDebts", [query]),
  repayDebt: (input: { debtId: string; amountMinor: number; methodCode: string }) =>
    rpc<StoreDebtRow>("store", "repayStoreDebt", [input]),
  memberDebtTotal: (memberId: string) => rpc<number>("store", "getMemberStoreDebtTotal", [memberId]),
  stats: (range: { fromKey: string; toKey: string }) => rpc<StoreStats>("store", "getStoreStats", [range]),
  returnSale: (input: { saleId: string; lines: Array<{ saleItemId: string; qty: number }>; discountMinor?: number; reason?: string | null }) =>
    rpc<StoreReturnRow>("store", "returnStoreSale", [input]),
  getReturn: (returnId: string) => rpc<StoreReturnRow>("store", "getStoreReturn", [returnId]),
  listReturns: (query: Record<string, unknown> = {}) =>
    rpc<{ items: Array<Omit<StoreReturnRow, "items">>; total: number }>("store", "listStoreReturns", [query]),
  dailySalesReport: (range: { fromKey: string; toKey: string }) =>
    rpc<DailySalesRow[]>("store", "getDailySalesReport", [range]),
  productSalesReport: (range: { fromKey: string; toKey: string }) =>
    rpc<ProductSalesRow[]>("store", "getProductSalesReport", [range]),
  stockValue: () => rpc<StockValueRow>("store", "getStockValue", []),
  lowStockProducts: (query?: { limit?: number }) =>
    rpc<ProductPublic[]>("store", "listLowStockProducts", [query ?? {}]),
};

// ------------------------------- classes ---------------------------------

export interface GymClass {
  id: string;
  name: string;
  description: string | null;
  trainerId: string | null;
  trainerName: string | null;
  location: string | null;
  capacity: number;
  consumesSession: boolean;
  isActive: boolean;
}
export interface ClassSession {
  id: string;
  classId: string;
  className: string;
  trainerName: string | null;
  location: string | null;
  consumesSession: boolean;
  sessionDate: string;
  startTime: string;
  durationMin: number;
  capacity: number;
  bookedCount: number;
  attendedCount: number;
  status: "scheduled" | "done" | "cancelled";
}
export interface BookingRow {
  id: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  status: "booked" | "attended" | "cancelled" | "no_show";
  consumedSubscriptionId: string | null;
  bookedAt: string;
}

const classesApi = {
  list: (query?: { search?: string; includeInactive?: boolean }) =>
    rpc<GymClass[]>("classes", "listClasses", [query ?? {}]),
  create: (input: { name: string; description?: string | null; trainerId?: string | null; location?: string | null; capacity: number; consumesSession?: boolean }) =>
    rpc<GymClass>("classes", "createClass", [input]),
  update: (id: string, patch: Record<string, unknown>) => rpc<GymClass>("classes", "updateClass", [id, patch]),
  createSession: (classId: string, input: { sessionDate: string; startTime: string; durationMin?: number; capacity?: number }) =>
    rpc<ClassSession>("classes", "createClassSession", [classId, input]),
  listSessions: (query?: { fromDate?: string; toDate?: string; classId?: string; status?: string; limit?: number }) =>
    rpc<ClassSession[]>("classes", "listSessions", [query ?? {}]),
  cancelSession: (sessionId: string, reason: string) => rpc<void>("classes", "cancelClassSession", [sessionId, reason]),
  uncancelSession: (sessionId: string) => rpc<void>("classes", "uncancelClassSession", [sessionId]),
  completeSession: (sessionId: string) => rpc<ClassSession>("classes", "completeClassSession", [sessionId]),
  listBookings: (sessionId: string) => rpc<BookingRow[]>("classes", "listBookings", [sessionId]),
  listMemberBookings: (memberId: string, limit?: number) =>
    rpc<BookingRow[]>("classes", "listMemberBookings", [memberId, limit]),
  book: (input: { sessionId: string; memberId: string; overrideCapacity?: boolean }) =>
    rpc<BookingRow>("classes", "bookMember", [input]),
  cancelBooking: (bookingId: string) => rpc<void>("classes", "cancelBooking", [bookingId]),
  setBookingStatus: (bookingId: string, status: "booked" | "attended" | "no_show") =>
    rpc<BookingRow>("classes", "setBookingStatus", [bookingId, status]),
};

// --------------------------- employees/salaries --------------------------

export type SalaryType = "monthly" | "daily" | "per_class" | "custom";
export interface PublicEmployee {
  id: string;
  fullName: string;
  phone: string | null;
  roleTitle: string | null;
  department: "general" | "men" | "women";
  specialization: string | null;
  joinedDate: string | null;
  salaryType: SalaryType;
  salaryBaseMinor: number | null;
  monthlySalaryMinor: number | null;
  isActive: boolean;
  notes: string | null;
  userId: string | null;
  barcode: string | null;
  annualLeaveDays: number | null;
  sickLeaveDays: number | null;
  unpaidLeaveDays: number | null;
}
export interface PublicSalary {
  id: string;
  employeeId: string;
  employeeName: string;
  periodMonth: string;
  baseMinor: number;
  bonusMinor: number;
  deductionMinor: number;
  netMinor: number;
  methodCode: string;
  status: "pending" | "paid";
  paidAt: string | null;
  notes: string | null;
}

const employeesApi = {
  list: (query?: { search?: string; includeInactive?: boolean }) =>
    rpc<PublicEmployee[]>("employees", "listEmployees", [query ?? {}]),
  create: (input: { fullName: string; phone?: string | null; roleTitle?: string | null; department?: string; specialization?: string | null; joinedDate?: string | null; salaryType?: SalaryType; salaryBaseMinor?: number | null; notes?: string | null; userId?: string | null }) =>
    rpc<PublicEmployee>("employees", "createEmployee", [input]),
  update: (id: string, patch: Record<string, unknown>) => rpc<PublicEmployee>("employees", "updateEmployee", [id, patch]),
  listSalaries: (query?: { employeeId?: string; periodMonth?: string; status?: string; limit?: number }) =>
    rpc<PublicSalary[]>("employees", "listSalaries", [query ?? {}]),
  recordSalary: (input: { employeeId: string; periodMonth: string; bonusMinor?: number; deductionMinor?: number; methodCode?: string; notes?: string | null }) =>
    rpc<PublicSalary>("employees", "recordSalary", [input]),
  paySalary: (salaryId: string) => rpc<PublicSalary>("employees", "paySalary", [salaryId]),
  purge: (id: string) => rpc<void>("employees", "purgeEmployee", [id]),
};

// --------------------------- employees HR (attendance/leaves/etc) ---------

export type LeaveType = "annual" | "sick" | "unpaid" | "emergency";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export interface PublicAttendance {
  id: string;
  employeeId: string;
  employeeName: string;
  dateKey: string;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number;
  isLate: boolean;
  notes: string | null;
}
export interface PublicLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  requestedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
}
export interface PublicHrAmount {
  id: string;
  employeeId: string;
  employeeName: string;
  amountMinor: number;
  reason: string;
  dateKey: string;
}
export interface PublicLeaveBalance {
  type: LeaveType;
  entitlement: number;
  used: number;
  remaining: number;
  limited: boolean;
}
export interface PublicSalarySummary {
  employeeId: string;
  employeeName: string;
  periodMonth: string;
  baseMinor: number;
  incentivesMinor: number;
  deductionsMinor: number;
  unpaidLeaveDays: number;
  unpaidLeaveImpactMinor: number;
  attendedDays: number;
  netMinor: number;
  alreadyRecorded: boolean;
}
export interface PublicDailyActivity {
  employeeId: string;
  employeeName: string;
  dateKey: string;
  totals: {
    attendanceIn: number;
    attendanceOut: number;
    subscriptionsSold: number;
    subscriptionsTotalMinor: number;
    storeSales: number;
    storeSalesTotalMinor: number;
    paymentsReceived: number;
    paymentsTotalMinor: number;
    expensesRecorded: number;
    expensesTotalMinor: number;
    auditedActions: number;
  };
  entries: Array<{ time: string; category: string; label: string; reference: string | null; amountMinor: number }>;
}

export interface EmployeeDailyWorked {
  dateKey: string;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number;
  isLate: boolean;
}

export interface EmployeeMonthlyHoursResult {
  employeeId: string;
  employeeName: string;
  month: string;
  days: EmployeeDailyWorked[];
}

export interface LeaveEntitlementResult {
  employeeId: string;
  annualDays: number | null;
  sickDays: number | null;
  unpaidDays: number | null;
}

export interface EnsureSalariesResult {
  created: number;
  periodMonth: string;
}

const employeesHrApi = {
  clockIn: (input: { employeeId?: string | null; at?: string | null; dateKey?: string | null; notes?: string | null }) =>
    rpc<PublicAttendance>("employeesHr", "clockIn", [input]),
  clockOut: (input: { employeeId?: string | null; at?: string | null; dateKey?: string | null }) =>
    rpc<PublicAttendance>("employeesHr", "clockOut", [input]),
  upsertAttendance: (input: { employeeId: string; dateKey: string; clockInAt: string; clockOutAt?: string | null; notes?: string | null }) =>
    rpc<PublicAttendance>("employeesHr", "upsertAttendance", [input]),
  listAttendance: (query?: { month?: string; employeeId?: string | null }) =>
    rpc<PublicAttendance[]>("employeesHr", "listAttendance", [query ?? {}]),
  requestLeave: (input: { employeeId?: string | null; leaveType: LeaveType; startDate: string; endDate: string; reason?: string | null }) =>
    rpc<PublicLeave>("employeesHr", "requestLeave", [input]),
  updateLeave: (input: { leaveId: string; leaveType: LeaveType; startDate: string; endDate: string; reason?: string | null }) =>
    rpc<PublicLeave>("employeesHr", "updateLeave", [input]),
  listLeaves: (query?: { status?: LeaveStatus | "all"; employeeId?: string | null; month?: string | null }) =>
    rpc<PublicLeave[]>("employeesHr", "listLeaves", [query ?? {}]),
  decideLeave: (input: { leaveId: string; approve: boolean; decisionNote?: string | null }) =>
    rpc<PublicLeave>("employeesHr", "decideLeave", [input]),
  cancelLeave: (leaveId: string) => rpc<PublicLeave>("employeesHr", "cancelLeave", [leaveId]),
  getLeaveBalance: (input: { employeeId?: string | null; year?: string | null }) =>
    rpc<PublicLeaveBalance[]>("employeesHr", "getLeaveBalance", [input]),
  listDeductions: (query?: { month?: string; employeeId?: string | null }) =>
    rpc<PublicHrAmount[]>("employeesHr", "listDeductions", [query ?? {}]),
  listIncentives: (query?: { month?: string; employeeId?: string | null }) =>
    rpc<PublicHrAmount[]>("employeesHr", "listIncentives", [query ?? {}]),
  addDeduction: (input: { employeeId: string; amountMinor: number; reason: string; dateKey?: string | null }) =>
    rpc<PublicHrAmount>("employeesHr", "addDeduction", [input]),
  addIncentive: (input: { employeeId: string; amountMinor: number; reason: string; dateKey?: string | null }) =>
    rpc<PublicHrAmount>("employeesHr", "addIncentive", [input]),
  updateDeduction: (input: { id: string; amountMinor: number; reason: string; dateKey?: string | null }) =>
    rpc<PublicHrAmount>("employeesHr", "updateDeduction", [input]),
  updateIncentive: (input: { id: string; amountMinor: number; reason: string; dateKey?: string | null }) =>
    rpc<PublicHrAmount>("employeesHr", "updateIncentive", [input]),
  deleteDeduction: (id: string) => rpc<void>("employeesHr", "deleteDeduction", [id]),
  deleteIncentive: (id: string) => rpc<void>("employeesHr", "deleteIncentive", [id]),
  monthlySalarySummary: (input: { employeeId: string; periodMonth: string }) =>
    rpc<PublicSalarySummary>("employeesHr", "monthlySalarySummary", [input]),
  employeeDailyActivity: (input: { employeeId: string; dateKey: string }) =>
    rpc<PublicDailyActivity>("employeesHr", "employeeDailyActivity", [input]),
  employeeMonthlyHours: (input: { employeeId: string; month?: string }) =>
    rpc<EmployeeMonthlyHoursResult>("employeesHr", "employeeMonthlyHours", [input]),
  setLeaveEntitlements: (input: { employeeId: string; annualDays?: number | null; sickDays?: number | null; unpaidDays?: number | null }) =>
    rpc<LeaveEntitlementResult>("employeesHr", "setLeaveEntitlements", [input]),
  ensureSalariesForMonth: (input: { periodMonth: string }) =>
    rpc<EnsureSalariesResult>("employeesHr", "ensureSalariesForMonth", [input]),
  clockInByBarcode: (input: { barcode: string; at?: string | null; dateKey?: string | null; notes?: string | null }) =>
    rpc<PublicAttendance>("employeesHr", "clockInByBarcode", [input]),
  clockOutByBarcode: (input: { barcode: string; at?: string | null; dateKey?: string | null }) =>
    rpc<PublicAttendance>("employeesHr", "clockOutByBarcode", [input]),
  setEmployeeBarcode: (employeeId: string, barcode?: string | null) =>
    rpc<{ employeeId: string; barcode: string | null }>("employeesHr", "setEmployeeBarcode", [{ employeeId, barcode }]),
};

// ------------------------------ InBody -----------------------------------

export interface PublicAssessment {
  id: string;
  memberId: string;
  assessmentDate: string;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  bmi: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string | null;
  trainerId: string | null;
  createdAt: string;
}
export interface ProgressComparison {
  latest: PublicAssessment | null;
  previous: PublicAssessment | null;
  deltas: Array<{ field: string; latest: number | null; previous: number | null; delta: number | null }>;
}
export interface FitnessTestDef {
  id: string;
  name: string;
  unit: string | null;
  isActive: boolean;
}
export interface FitnessResultRow {
  id: string;
  defName: string;
  unit: string | null;
  value: number;
  testDate: string;
  notes: string | null;
}

const inbodyApi = {
  createAssessment: (input: Record<string, unknown>) => rpc<PublicAssessment>("inbody", "createAssessment", [input]),
  deleteAssessment: (id: string) => rpc<void>("inbody", "deleteAssessment", [id]),
  list: (memberId: string, limit?: number) => rpc<PublicAssessment[]>("inbody", "listAssessments", [memberId, limit]),
  progress: (memberId: string) => rpc<ProgressComparison>("inbody", "getProgress", [memberId]),
  listDefs: (activeOnly = false) => rpc<FitnessTestDef[]>("inbody", "listFitnessTestDefs", [activeOnly]),
  upsertDef: (input: { name: string; unit?: string | null }) =>
    rpc<FitnessTestDef>("inbody", "upsertFitnessTestDef", [input]),
  recordResult: (input: { defId: string; memberId: string; value: number; testDate: string; notes?: string | null }) =>
    rpc<{ id: string }>("inbody", "recordFitnessResult", [input]),
  listResults: (query: { memberId?: string; defId?: string; limit?: number }) =>
    rpc<FitnessResultRow[]>("inbody", "listFitnessResults", [query]),
};

// -------------------------------- CRM ------------------------------------

export type CrmStatus =
  | "pending"
  | "sent"
  | "manual_opened"
  | "failed"
  | "skipped_no_provider"
  | "skipped_no_phone";
export interface CrmTemplate {
  code: string;
  bodyAr: string;
  isActive: boolean;
}
export interface CrmMessageRow {
  id: string;
  memberId: string;
  memberName: string;
  templateCode: string | null;
  channel: string;
  body: string;
  phone: string | null;
  status: CrmStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

const crmApi = {
  listTemplates: (includeInactive = true) => rpc<CrmTemplate[]>("crm", "listTemplates", [includeInactive]),
  upsertTemplate: (input: { code: string; bodyAr: string; isActive?: boolean }) =>
    rpc<CrmTemplate>("crm", "upsertTemplate", [input]),
  queueMessage: (input: { memberId: string; templateCode?: string; customBody?: string; vars?: Record<string, string | number>; dedupeKey?: string }) =>
    rpc<{ id: string; status: CrmStatus; duplicate: boolean }>("crm", "queueMessage", [input]),
  sendPending: (limit?: number) =>
    rpc<{ sent: number; failed: number; skipped: number }>("crm", "sendPendingMessages", [limit ?? 50]),
  markManuallySent: (messageId: string) => rpc<void>("crm", "markManuallySent", [messageId]),
  listMessages: (query?: { status?: CrmStatus | "all"; memberId?: string; limit?: number }) =>
    rpc<CrmMessageRow[]>("crm", "listMessages", [query ?? {}]),
  generateDue: () => rpc<{ queued: number; duplicates: number; skippedNoPhone: number }>("crm", "generateDueMessages", []),
};

// ------------------------------ leads --------------------------------------

export type LeadStatus = "new" | "contacted" | "interested" | "trial" | "joined" | "lost";
export type LeadSource =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "referral"
  | "walk_in"
  | "existing_member"
  | "other";

export interface Lead {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  interestedPlanId: string | null;
  interestedPlanName: string | null;
  department: "general" | "men" | "women";
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  status: LeadStatus;
  notes: string | null;
  lostReason: string | null;
  convertedMemberId: string | null;
  contactedAt: string | null;
  interestedAt: string | null;
  trialAt: string | null;
  joinedAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadFollowup {
  id: string;
  leadId: string;
  leadName: string;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  action: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface LeadStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  bySource: Record<LeadSource, number>;
  newThisMonth: number;
  joined: number;
  lost: number;
  conversionRate: number;
  dueFollowups: number;
  todayFollowupsCount: number;
}

export interface ConvertLeadResult {
  memberId: string;
  memberCode: string;
  memberName: string;
  linkedExisting: boolean;
}

const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "interested", "trial", "joined", "lost"];

const leadApi = {
  create: (input: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
    source: LeadSource;
    interestedPlanId?: string | null;
    department?: "general" | "men" | "women";
    assignedEmployeeId?: string | null;
    notes?: string | null;
  }) => rpc<Lead>("lead", "createLead", [input]),
  update: (
    leadId: string,
    patch: {
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      source?: LeadSource;
      interestedPlanId?: string | null;
      department?: "general" | "men" | "women";
      assignedEmployeeId?: string | null;
      notes?: string | null;
      status?: LeadStatus;
      lostReason?: string | null;
    },
  ) => rpc<Lead>("lead", "updateLead", [leadId, patch]),
  list: (query?: {
    status?: LeadStatus | "all";
    source?: LeadSource | "all";
    department?: "general" | "men" | "women" | "all";
    search?: string;
    assignedEmployeeId?: string;
    page?: number;
    pageSize?: number;
  }) => rpc<{ items: Lead[]; total: number }>("lead", "listLeads", [query ?? {}]),
  get: (leadId: string) => rpc<Lead>("lead", "getLead", [leadId]),
  remove: (leadId: string) => rpc<void>("lead", "deleteLead", [leadId]),
  listFollowups: (leadId: string) => rpc<LeadFollowup[]>("lead", "listFollowups", [leadId]),
  addFollowup: (leadId: string, input: { dueDate: string; dueTime?: string | null; note?: string | null }) =>
    rpc<LeadFollowup>("lead", "addFollowup", [leadId, input]),
  updateFollowup: (
    followupId: string,
    patch: { dueDate?: string; dueTime?: string | null; note?: string | null },
  ) => rpc<LeadFollowup>("lead", "updateFollowup", [followupId, patch]),
  completeFollowup: (followupId: string, done?: boolean) =>
    rpc<LeadFollowup>("lead", "completeFollowup", [followupId, done ?? true]),
  todayFollowups: () => rpc<LeadFollowup[]>("lead", "todayFollowups", []),
  listActivity: (leadId: string) => rpc<LeadActivity[]>("lead", "listActivity", [leadId]),
  addActivity: (leadId: string, action: string, note?: string) =>
    rpc<void>("lead", "addActivity", [leadId, action, note]),
  convert: (leadId: string, existingMemberId?: string) =>
    rpc<ConvertLeadResult>("lead", "convertLead", [{ leadId, existingMemberId }]),
  stats: () => rpc<LeadStats>("lead", "leadStats", []),
  statuses: LEAD_STATUSES,
};

// ------------------------------ trials -------------------------------------

export const TRIAL_TYPES: TrialType[] = ["free", "paid", "day_1", "day_3", "day_7", "custom"];
export const TRIAL_STATUSES: TrialStatus[] = ["active", "expired", "converted", "cancelled"];

const trialApi = {
  create: (input: {
    trialType: TrialType;
    leadId?: string | null;
    memberId?: string | null;
    phone?: string | null;
    preferredPlanId?: string | null;
    department?: "general" | "men" | "women";
    startDate?: string;
    endDate?: string;
    notes?: string | null;
  }) => rpc<Trial>("trials", "createTrial", [input]),
  update: (trialId: string, patch: {
    trialType?: TrialType;
    memberId?: string | null;
    phone?: string | null;
    preferredPlanId?: string | null;
    department?: "general" | "men" | "women";
    startDate?: string;
    endDate?: string;
    notes?: string | null;
  }) => rpc<Trial>("trials", "updateTrial", [trialId, patch]),
  list: (query?: TrialListQuery) => rpc<{ items: Trial[]; total: number }>("trials", "listTrials", [query ?? {}]),
  get: (trialId: string) => rpc<Trial>("trials", "getTrial", [trialId]),
  expire: (trialId: string) => rpc<Trial>("trials", "expireTrial", [trialId]),
  cancel: (trialId: string, reason?: string | null) => rpc<Trial>("trials", "cancelTrial", [trialId, reason ?? null]),
  convert: (input: ConvertTrialInput) => rpc<ConvertTrialResult>("trials", "convertTrial", [input]),
  sweepExpired: () => rpc<number>("trials", "sweepExpiredTrials", []),
  stats: () => rpc<TrialStats>("trials", "trialStats", []),
  types: TRIAL_TYPES,
  statuses: TRIAL_STATUSES,
};

// ----------------------------- files/photos ------------------------------

async function uploadFile(kind: string, file: File): Promise<{ id: string; kind: string; sizeBytes: number }> {
  const bytes = await file.arrayBuffer();
  return request(`/api/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type || "application/octet-stream")}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
}

function fileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

export const api = {
  members: membersApi,
  subscriptions: subscriptionsApi,
  plans: plansApi,
  packages: packagesApi,
  cards: cardsApi,
  attendance: attendanceApi,
  reception: receptionApi,
  settings: settingsApi,
  audit: auditApi,
  users: usersApi,
  payments: paymentsApi,
  expenses: expensesApi,
  cash: cashApi,
  dashboard: dashboardApi,
  finance: financeApi,
  reports: reportsApi,
  trainers: trainersApi,
  trainingPlans: trainingPlansApi,
  notifications: notificationsApi,
  backup: backupApi,
  store: storeApi,
  classes: classesApi,
  employees: employeesApi,
  employeesHr: employeesHrApi,
  inbody: inbodyApi,
  crm: crmApi,
  lead: leadApi,
  trials: trialApi,
  files: { upload: uploadFile, url: fileUrl },
  auth: {
    /** Session probe used by the auth context; mirrors GET /api/auth/me. */
    me: () => request<MeResponse>("/api/auth/me"),
  },
  permissions: {
    getRolePermissions: () =>
      rpc<Record<string, string[]>>("permissions", "getRolePermissions", []),
    getAllPermissions: () =>
      rpc<string[]>("permissions", "getAllPermissions", []),
    setRolePermissions: (roleId: string, perms: string[]) =>
      rpc<void>("permissions", "setRolePermissions", [roleId, perms]),
  },
  dev: {
    getOverrideDate: () =>
      rpc<string | null>("dev", "getOverrideDate", []),
    setOverrideDate: (date: string | null) =>
      rpc<string | null>("dev", "setOverrideDate", [date]),
  },
  referral: {
    getSettings: () =>
      rpc<{ rewardType: "free_days" | "credit"; rewardValue: number }>("referral", "getSettings", []),
    updateSettings: (settings: { rewardType?: "free_days" | "credit"; rewardValue?: number }) =>
      rpc<{ rewardType: "free_days" | "credit"; rewardValue: number }>("referral", "updateSettings", [settings]),
    getMemberCode: (memberId: string) =>
      rpc<string>("referral", "getMemberCode", [memberId]),
    list: (query: Record<string, unknown> = {}) =>
      rpc<{ items: ReferralRow[]; total: number }>("referral", "list", [query]),
    get: (id: string) =>
      rpc<ReferralRow>("referral", "get", [id]),
    create: (input: { referrerMemberId: string; referredName: string; referredPhone?: string | null; notes?: string | null }) =>
      rpc<ReferralRow>("referral", "create", [input]),
    cancel: (id: string) =>
      rpc<ReferralRow>("referral", "cancel", [id]),
    convert: (referralId: string, memberId: string) =>
      rpc<ReferralRow>("referral", "convert", [referralId, memberId]),
    stats: (referrerId?: string) =>
      rpc<ReferralStats>("referral", "stats", [referrerId]),
    topReferrers: (limit?: number) =>
      rpc<TopReferrerRow[]>("referral", "topReferrers", [limit]),
    listRewards: (referrerId?: string) =>
      rpc<ReferralRewardRow[]>("referral", "listRewards", [referrerId]),
  },
  loyalty: {
    getSettings: () =>
      rpc<LoyaltySettings>("loyalty", "getSettings", []),
    updateSettings: (patch: Partial<LoyaltySettings>) =>
      rpc<LoyaltySettings>("loyalty", "updateSettings", [patch]),
    getEarnRules: () =>
      rpc<EarnRule[]>("loyalty", "getEarnRules", []),
    upsertEarnRule: (input: EarnRuleInput) =>
      rpc<EarnRule>("loyalty", "upsertEarnRule", [input]),
    removeEarnRule: (action: string) =>
      rpc<void>("loyalty", "removeEarnRule", [action]),
    getRedemptionCatalog: () =>
      rpc<RedemptionItem[]>("loyalty", "getRedemptionCatalog", []),
    upsertRedemption: (input: RedemptionInput) =>
      rpc<RedemptionItem>("loyalty", "upsertRedemption", [input]),
    setRedemptionActive: (id: string, active: boolean) =>
      rpc<RedemptionItem>("loyalty", "setRedemptionActive", [id, active]),
    getMemberBalance: (memberId: string) =>
      rpc<LoyaltyBalance>("loyalty", "getMemberBalance", [memberId]),
    listMemberTransactions: (memberId: string, query: MemberTransactionQuery = {}) =>
      rpc<MemberTransactionPage>("loyalty", "listMemberTransactions", [memberId, query]),
    adjustPoints: (memberId: string, points: number, reason: string) =>
      rpc<number>("loyalty", "adjustPoints", [memberId, points, reason]),
    redeemReward: (memberId: string, rewardId: string) =>
      rpc<RedemptionResult>("loyalty", "redeemReward", [memberId, rewardId]),
  },
};

export default api;

export { rpc, postJson, postRaw } from "./client";
export type { MeResponse } from "./client";

export interface ScannerConfig {
  enabled: boolean;
  prefix: string;
  suffix: string;
  minLength: number;
  timeoutMs: number;
  maxKeyIntervalMs: number;
}

export type { AuditListQuery, AuditAction, AuditLogItem } from "@/core/services/audit.service";
export type {
  CreateSubscriptionInput,
  SubscriptionListQuery,
  UpdateSubscriptionPatch,
  Subscription,
  SubscriptionWithMember,
  SubscriptionRowStatus,
  FreezeInfo,
} from "@/core/services/subscriptions.service";
export type { Payment, PaymentListQuery, RecordPaymentInput } from "@/core/services/payments.service";
export type { ExpenseListQuery } from "@/core/services/expenses.service";
export type { MemberListQuery, MemberStatus, PublicMember, TrashedMemberInfo } from "@/core/services/members.service";
export type { MemberOverview } from "@/core/services/member-profile.service";
export type { Plan, PlanInput, PlanKind, PlanRow } from "@/core/services/plans.service";
export type { Package, PackageInput, PackageModel, PackagePatch, PackageStats, AccessArea } from "@/core/services/packages.service";
export type { CashSessionStatus } from "@/core/services/cash-session.service";
export type { Expense, ExpenseCategory } from "@/core/services/expenses.service";
export type { AppNotification, AppNotificationType, NotificationSeverity } from "@/core/services/notifications.service";
export type { DiagnosticsReport, PublicBackupEntry } from "@/core/services/backup.service";
export type { PlanWithNames, PublicTrainingPlan, TrainingPlanListQuery } from "@/core/services/training-plans.service";
export type { TrainerListQuery, TrainerRow, PublicTrainer } from "@/core/services/trainers.service";
export type { PublicUser, CreateUserInput, UpdateUserInput } from "@/core/services/users.service";
export type { BulkRegisterResult, CardStatus, CardWithMember } from "@/core/services/cards.service";
export type {
  ConvertTrialInput,
  ConvertTrialResult,
  Trial,
  TrialListQuery,
  TrialStats,
  TrialStatus,
  TrialType,
} from "@/core/services/trials.service";
export type {
  ReferralRow,
  ReferralStats,
  ReferralRewardRow,
  ReferralListQuery,
  ReferralSettings,
  CreateReferralInput,
  TopReferrerRow,
} from "@/core/services/referral.service";
export type {
  LoyaltySettings,
  EarnRule,
  EarnRuleInput,
  EarnAction,
  RewardType,
  RedemptionItem,
  RedemptionInput,
  LoyaltyTransactionRow,
  LoyaltyBalance,
  MemberTransactionQuery,
  MemberTransactionPage,
  RedemptionResult,
} from "@/core/services/loyalty.service";