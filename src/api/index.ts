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
import type { BulkRegisterResult, CardStatus, CardWithMember } from "@/core/services/cards.service";

import type { AuditListQuery, AuditLogItem } from "@/core/services/audit.service";
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
  DashboardStats,
} from "@/core/services/dashboard.service";
import type { FinanceOverview } from "@/core/services/finance.service";
import type { PeriodReport } from "@/core/services/financial-report.service";
import type { StaffActivityReport } from "@/core/services/staff-activity.service";
import type { AttendanceAnalytics } from "@/core/services/attendance-analytics.service";
import type { TrainerListQuery, PublicTrainer } from "@/core/services/trainers.service";
import type {
  PublicTrainingPlan,
  TrainingPlanRow,
  TrainingPlanListQuery,
} from "@/core/services/training-plans.service";
import type { AppNotification } from "@/core/services/notifications.service";
import type { AttendanceDayPoint } from "@/core/services/attendance.service";

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
};

const subscriptionsApi = {
  create: (input: CreateSubscriptionInput) =>
    rpc<Subscription>("subscriptions", "createSubscription", [input]),
  update: (id: string, patch: UpdateSubscriptionPatch) =>
    rpc<Subscription>("subscriptions", "updateSubscription", [id, patch]),
  setStatus: (id: string, status: SubscriptionRowStatus) =>
    rpc<Subscription>("subscriptions", "setSubscriptionStatus", [id, status]),
  listForMember: (memberId: string) =>
    rpc<Subscription[]>("subscriptions", "listMemberSubscriptions", [memberId]),
  list: (query: SubscriptionListQuery = {}) =>
    rpc<{ items: SubscriptionWithMember[]; total: number }>("subscriptions", "listSubscriptions", [query]),
  freezes: (subscriptionId: string) =>
    rpc<FreezeInfo[]>("subscriptions", "listSubscriptionFreezes", [subscriptionId]),
  freeze: (id: string, input: { expectedResumeDate?: string | null; reason?: string | null } = {}) =>
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
  list: (query: { page?: number; pageSize?: number; status?: CashSessionStatus | "all" } = {}) =>
    rpc<{ items: CashSession[]; total: number }>("cash", "listCashSessions", [query]),
};

const dashboardApi = {
  stats: () => rpc<DashboardStats>("dashboard", "getDashboardStats", []),
  attendance: (days: 7 | 30) => rpc<AttendanceDayPoint[]>("dashboard", "getDashboardAttendance", [days]),
  expiring: (withinDays = 7) =>
    rpc<SubscriptionWithMember[]>("dashboard", "getExpiringForDashboard", [withinDays]),
  operational: () => rpc<DashboardOperationalStats>("dashboard", "getDashboardOperational", []),
};

const financeApi = {
  overview: (todayKeyStr: string, monthStartKey: string) =>
    rpc<FinanceOverview>("finance", "getFinanceOverview", [todayKeyStr, monthStartKey]),
};

const reportsApi = {
  period: (fromKey: string, toKey: string) =>
    rpc<PeriodReport>("reports", "getPeriodReport", [fromKey, toKey]),
  staffActivity: (range: { fromKey: string; toKey: string }) =>
    rpc<StaffActivityReport>("reports", "getStaffActivity", [range]),
  attendanceAnalytics: (range: { fromKey: string; toKey: string }) =>
    rpc<AttendanceAnalytics>("reports", "getAttendanceAnalytics", [range]),
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
  productId: string;
  productName: string;
  qty: number;
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

const storeApi = {
  listCategories: (includeInactive = true) =>
    rpc<Array<{ id: string; nameAr: string; isActive: boolean }>>("store", "listProductCategories", [includeInactive]),
  createCategory: (nameAr: string) => rpc<{ id: string; nameAr: string }>("store", "createProductCategory", [nameAr]),
  setCategoryActive: (id: string, isActive: boolean) => rpc<void>("store", "setProductCategoryActive", [id, isActive]),
  listProducts: (query: Record<string, unknown> = {}) =>
    rpc<{ items: ProductPublic[]; total: number }>("store", "listProducts", [query]),
  getProduct: (id: string) => rpc<ProductPublic>("store", "getProduct", [id]),
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
  listDebts: (query: Record<string, unknown> = {}) =>
    rpc<{ items: StoreDebtRow[]; total: number }>("store", "listStoreDebts", [query]),
  repayDebt: (input: { debtId: string; amountMinor: number; methodCode: string }) =>
    rpc<StoreDebtRow>("store", "repayStoreDebt", [input]),
  memberDebtTotal: (memberId: string) => rpc<number>("store", "getMemberStoreDebtTotal", [memberId]),
  stats: (range: { fromKey: string; toKey: string }) => rpc<StoreStats>("store", "getStoreStats", [range]),
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
  create: (input: { fullName: string; phone?: string | null; roleTitle?: string | null; department?: string; specialization?: string | null; joinedDate?: string | null; salaryType?: SalaryType; salaryBaseMinor?: number | null; notes?: string | null }) =>
    rpc<PublicEmployee>("employees", "createEmployee", [input]),
  update: (id: string, patch: Record<string, unknown>) => rpc<PublicEmployee>("employees", "updateEmployee", [id, patch]),
  listSalaries: (query?: { employeeId?: string; periodMonth?: string; status?: string; limit?: number }) =>
    rpc<PublicSalary[]>("employees", "listSalaries", [query ?? {}]),
  recordSalary: (input: { employeeId: string; periodMonth: string; bonusMinor?: number; deductionMinor?: number; methodCode?: string; notes?: string | null }) =>
    rpc<PublicSalary>("employees", "recordSalary", [input]),
  paySalary: (salaryId: string) => rpc<PublicSalary>("employees", "paySalary", [salaryId]),
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
  cards: cardsApi,
  attendance: attendanceApi,
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
  inbody: inbodyApi,
  crm: crmApi,
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
} from "@/core/services/subscriptions.service";
export type { Payment, PaymentListQuery, RecordPaymentInput } from "@/core/services/payments.service";
export type { ExpenseListQuery } from "@/core/services/expenses.service";
export type { MemberListQuery, MemberStatus, PublicMember, TrashedMemberInfo } from "@/core/services/members.service";
export type { Plan, PlanInput, PlanKind, PlanRow } from "@/core/services/plans.service";
export type { CashSessionStatus } from "@/core/services/cash-session.service";
export type { Expense, ExpenseCategory } from "@/core/services/expenses.service";
export type { AppNotification, AppNotificationType, NotificationSeverity } from "@/core/services/notifications.service";
export type { DiagnosticsReport, PublicBackupEntry } from "@/core/services/backup.service";
export type { PlanWithNames, PublicTrainingPlan, TrainingPlanListQuery } from "@/core/services/training-plans.service";
export type { TrainerListQuery, TrainerRow, PublicTrainer } from "@/core/services/trainers.service";
export type { PublicUser, CreateUserInput, UpdateUserInput } from "@/core/services/users.service";
export type { BulkRegisterResult, CardStatus, CardWithMember } from "@/core/services/cards.service";