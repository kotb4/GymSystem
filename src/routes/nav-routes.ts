import type { Permission } from "@/core/permissions";

export type NavGroup =
  | "overview"
  | "operations"
  | "members"
  | "fitness"
  | "store"
  | "finance"
  | "team"
  | "marketing"
  | "management";

export interface NavRoute {
  path: string;
  key: string;
  group: NavGroup;
  permission?: Permission;
  permissions?: Permission[];
  developerOnly?: boolean;
  featureFlag?: string;
}

export const NAV_GROUP_ORDER: NavGroup[] = [
  "overview",
  "operations",
  "members",
  "fitness",
  "store",
  "finance",
  "team",
  "marketing",
  "management",
];

export const NAV_ROUTES: NavRoute[] = [
  // 1. نظرة عامة
  { path: "/", key: "nav.dashboard", group: "overview", permission: "members.view" },

  // 2. الاستقبال واليومية
  { path: "/attendance", key: "nav.attendance", group: "operations", permission: "reception.view", featureFlag: "featureAttendanceEnabled" },
  { path: "/quick-sessions", key: "nav.quickSessions", group: "operations", permission: "quick_sessions.view" },

  // 3. المشتركون والاشتراكات
  { path: "/members", key: "nav.members", group: "members", permission: "members.view", featureFlag: "featureMembersEnabled" },
  { path: "/subscriptions", key: "nav.subscriptions", group: "members", permission: "subscriptions.view", featureFlag: "featureSubscriptionsEnabled" },
  { path: "/debts", key: "nav.debts", group: "members", permission: "debts.view" },
  { path: "/cards", key: "nav.cards", group: "members", permission: "cards.view", featureFlag: "featureCardsEnabled" },

  // 4. التدريب والأنشطة
  { path: "/classes", key: "nav.classes", group: "fitness", permissions: ["classes.view"], featureFlag: "featureClassesEnabled" },
  { path: "/trainers", key: "nav.trainers", group: "fitness", permission: "trainers.view", featureFlag: "featureClassesEnabled" },
  { path: "/private-training", key: "nav.privateTraining", group: "fitness", permission: "private_training.view" },

  // 5. المتجر والمشتريات
  { path: "/store", key: "nav.store", group: "store", permission: "store.view", featureFlag: "featurePosEnabled" },
  { path: "/purchases", key: "nav.purchases", group: "store", permission: "purchases.view" },

  // 6. الخزينة والمالية
  { path: "/treasury", key: "nav.treasury", group: "finance", permission: "payments.view", featureFlag: "featureTreasuryEnabled" },
  { path: "/payments", key: "nav.payments", group: "finance", permission: "payments.view", featureFlag: "featureTreasuryEnabled" },
  { path: "/expenses", key: "nav.expenses", group: "finance", permission: "expenses.view", featureFlag: "featureExpensesEnabled" },
  { path: "/reports", key: "nav.reports", group: "finance", permission: "reports.view", featureFlag: "featureReportsEnabled" },

  // 7. فريق العمل والموظفون
  { path: "/employees", key: "nav.employees", group: "team", permissions: ["employees.view", "hr.view"], featureFlag: "featureEmployeesEnabled" },
  { path: "/employee-checkin", key: "nav.employeeCheckIn", group: "team", permission: "hr.employee_checkin", featureFlag: "featureHrCheckinEnabled" },

  // 8. التسويق وعلاقات العملاء
  { path: "/crm", key: "nav.crm", group: "marketing", permissions: ["leads.view", "trials.view"], featureFlag: "featureCrmEnabled" },
  { path: "/messages", key: "nav.messages", group: "marketing", permission: "messages.view", featureFlag: "featureWhatsappEnabled" },
  { path: "/loyalty", key: "nav.loyalty", group: "marketing", permission: "loyalty.manage", featureFlag: "featureLoyaltyEnabled" },
  { path: "/referrals", key: "nav.referrals", group: "marketing", permission: "referrals.view", featureFlag: "featureReferralsEnabled" },

  // 9. إدارة النظام والأمان
  { path: "/staff", key: "nav.staff", group: "management", permission: "users.view" },
  { path: "/settings", key: "nav.settings", group: "management", permission: "settings.view" },
  { path: "/audit", key: "nav.audit", group: "management", permission: "audit.view" },
  { path: "/developer", key: "developer.navTitle", group: "management", developerOnly: true },
];

export function routeTitleKey(pathname: string): string {
  const memberProfile = pathname.match(/^\/members\/[^/]+$/);
  if (memberProfile) return "members.profileTitle";
  const match = [...NAV_ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((r) => (r.path === "/" ? pathname === "/" : pathname.startsWith(r.path)));
  return match?.key ?? "nav.dashboard";
}
