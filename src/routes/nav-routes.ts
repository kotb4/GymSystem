import type { Permission } from "@/core/permissions";

export type NavGroup =
  | "overview"
  | "daily"
  | "subscriptions"
  | "finance"
  | "store"
  | "training"
  | "team"
  | "comms"
  | "maintenance"
  | "security";

export interface NavRoute {
  path: string;
  key: string;
  group: NavGroup;
  permission?: Permission;
  permissions?: Permission[];
}

export const NAV_GROUP_ORDER: NavGroup[] = [
  "overview",
  "daily",
  "subscriptions",
  "finance",
  "store",
  "training",
  "team",
  "comms",
  "maintenance",
  "security",
];

export const NAV_ROUTES: NavRoute[] = [
  { path: "/", key: "nav.dashboard", group: "overview", permission: "members.view" },
  { path: "/members", key: "nav.members", group: "daily", permission: "members.view" },
  { path: "/checkin", key: "nav.checkin", group: "daily", permission: "checkin.create" },
  { path: "/reception", key: "nav.reception", group: "daily", permission: "reception.view" },
  { path: "/cash", key: "nav.cash", group: "daily", permission: "payments.view" },
  { path: "/treasury", key: "nav.treasury", group: "daily", permission: "cash.daily_close" },
  { path: "/subscriptions", key: "nav.subscriptions", group: "subscriptions", permission: "subscriptions.view" },
  { path: "/packages", key: "nav.packages", group: "subscriptions", permission: "packages.view" },
  { path: "/payments", key: "nav.payments", group: "finance", permission: "payments.view" },
  { path: "/expenses", key: "nav.expenses", group: "finance", permission: "expenses.view" },
  { path: "/reports", key: "nav.reports", group: "finance", permission: "reports.view" },
  { path: "/store", key: "nav.store", group: "store", permission: "store.view" },
  { path: "/trainers", key: "nav.trainers", group: "training", permission: "trainers.view" },
  { path: "/classes", key: "nav.classes", group: "training", permission: "classes.view" },
  { path: "/employees", key: "nav.employees", group: "team", permissions: ["employees.view", "hr.view"] },
  { path: "/employee-checkin", key: "nav.employeeCheckIn", group: "team", permission: "hr.employee_checkin" },
  { path: "/staff", key: "nav.staff", group: "team", permission: "users.view" },
  { path: "/crm", key: "nav.crm", group: "comms", permissions: ["crm.send", "leads.view", "trials.view"] },
  { path: "/cards", key: "nav.cards", group: "maintenance", permission: "cards.view" },
  { path: "/loyalty", key: "nav.loyalty", group: "maintenance", permission: "loyalty.manage" },
  { path: "/settings", key: "nav.settings", group: "maintenance", permission: "settings.view" },
  { path: "/audit", key: "nav.audit", group: "security", permission: "audit.view" },
];

export function routeTitleKey(pathname: string): string {
  const memberProfile = pathname.match(/^\/members\/[^/]+$/);
  if (memberProfile) return "members.profileTitle";
  const match = [...NAV_ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((r) => (r.path === "/" ? pathname === "/" : pathname.startsWith(r.path)));
  return match?.key ?? "nav.dashboard";
}
