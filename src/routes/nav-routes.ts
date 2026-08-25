import type { Permission } from "@/core/permissions";

export interface NavRoute {
  path: string;
  key: string;
  permission: Permission;
}

export const NAV_ROUTES: NavRoute[] = [
  { path: "/", key: "nav.dashboard", permission: "members.view" },
  { path: "/members", key: "nav.members", permission: "members.view" },
  { path: "/checkin", key: "nav.checkin", permission: "checkin.create" },
  { path: "/subscriptions", key: "nav.subscriptions", permission: "subscriptions.view" },
  { path: "/payments", key: "nav.payments", permission: "payments.view" },
  { path: "/store", key: "nav.store", permission: "store.view" },
  { path: "/classes", key: "nav.classes", permission: "classes.view" },
  { path: "/expenses", key: "nav.expenses", permission: "expenses.view" },
  { path: "/cash", key: "nav.cash", permission: "payments.view" },
  { path: "/employees", key: "nav.employees", permission: "employees.view" },
  { path: "/crm", key: "nav.crm", permission: "crm.send" },
  { path: "/reports", key: "nav.reports", permission: "reports.view" },
  { path: "/trainers", key: "nav.trainers", permission: "trainers.view" },
  { path: "/cards", key: "nav.cards", permission: "cards.view" },
  { path: "/scanner", key: "nav.scannerDiagnostics", permission: "checkin.create" },
  { path: "/health", key: "nav.health", permission: "diagnostics.view" },
  { path: "/users", key: "nav.users", permission: "users.view" },
  { path: "/permissions", key: "nav.permissions", permission: "users.view" },
  { path: "/audit", key: "nav.audit", permission: "audit.view" },
  { path: "/settings", key: "nav.settings", permission: "settings.view" },
];

export function routeTitleKey(pathname: string): string {
  const memberProfile = pathname.match(/^\/members\/[^/]+$/);
  if (memberProfile) return "members.profileTitle";
  const match = [...NAV_ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((r) => (r.path === "/" ? pathname === "/" : pathname.startsWith(r.path)));
  return match?.key ?? "nav.dashboard";
}
