import type { Permission } from "@/core/permissions";

export type NavGroup =
  | "overview"
  | "operations"
  | "finance"
  | "fitness"
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
  "finance",
  "fitness",
  "marketing",
  "management",
];

export const NAV_ROUTES: NavRoute[] = [
  { path: "/", key: "nav.dashboard", group: "overview", permission: "members.view" },
  { path: "/attendance", key: "nav.attendance", group: "operations", permission: "reception.view", featureFlag: "featureAttendanceEnabled" },
  { path: "/members", key: "nav.members", group: "operations", permission: "members.view", featureFlag: "featureMembersEnabled" },
  { path: "/subscriptions", key: "nav.subscriptions", group: "operations", permission: "subscriptions.view", featureFlag: "featureSubscriptionsEnabled" },
  { path: "/cards", key: "nav.cards", group: "operations", permission: "cards.view", featureFlag: "featureCardsEnabled" },
  { path: "/treasury", key: "nav.treasury", group: "finance", permission: "payments.view", featureFlag: "featureTreasuryEnabled" },
  { path: "/doc-search", key: "nav.docSearch", group: "operations", permission: "reports.view", featureFlag: "featureReportsEnabled" },
  { path: "/payments", key: "nav.payments", group: "finance", permission: "payments.view", featureFlag: "featureTreasuryEnabled" },
  { path: "/expenses", key: "nav.expenses", group: "finance", permission: "expenses.view", featureFlag: "featureExpensesEnabled" },
  { path: "/store", key: "nav.store", group: "finance", permission: "store.view", featureFlag: "featurePosEnabled" },
  { path: "/reports", key: "nav.reports", group: "finance", permission: "reports.view", featureFlag: "featureReportsEnabled" },
  { path: "/classes", key: "nav.classes", group: "fitness", permissions: ["classes.view", "trainers.view"], featureFlag: "featureClassesEnabled" },
  { path: "/messages", key: "nav.messages", group: "marketing", permission: "messages.view", featureFlag: "featureWhatsappEnabled" },
  { path: "/crm", key: "nav.crm", group: "marketing", permissions: ["leads.view", "trials.view"], featureFlag: "featureCrmEnabled" },
  { path: "/loyalty", key: "nav.loyalty", group: "marketing", permission: "loyalty.manage", featureFlag: "featureLoyaltyEnabled" },
  { path: "/referrals", key: "nav.referrals", group: "marketing", permission: "referrals.view", featureFlag: "featureReferralsEnabled" },
  { path: "/employees", key: "nav.employees", group: "management", permissions: ["employees.view", "hr.view"], featureFlag: "featureEmployeesEnabled" },
  { path: "/employee-checkin", key: "nav.employeeCheckIn", group: "management", permission: "hr.employee_checkin", featureFlag: "featureHrCheckinEnabled" },
  { path: "/staff", key: "nav.staff", group: "management", permission: "users.view" },
  { path: "/audit", key: "nav.audit", group: "management", permission: "audit.view" },
  { path: "/settings", key: "nav.settings", group: "management", permission: "settings.view" },
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
