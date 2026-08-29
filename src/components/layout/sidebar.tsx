import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Banknote,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  ConciergeBell,
  CreditCard,
  Dumbbell,
  Fingerprint,
  LayoutDashboard,
  Package as PackageIcon,
  ReceiptText,
  ScanLine,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { NAV_ROUTES } from "@/routes/nav-routes";

import { cn } from "@/utils/cn";
import { Tooltip } from "@/components/ui/tooltip";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/members": Users,
  "/checkin": ScanLine,
  "/reception": ConciergeBell,
  "/subscriptions": CalendarCheck,
  "/packages": PackageIcon,
  "/payments": Banknote,
  "/expenses": ReceiptText,
  "/cash": Wallet,
  "/treasury": Coins,
  "/reports": BarChart3,
  "/trainers": Dumbbell,
  "/cards": CreditCard,
  "/scanner": ScanSearch,
  "/health": Activity,
  "/users": UserCog,
  "/permissions": ShieldCheck,
  "/audit": ScrollText,
  "/settings": Settings,
  "/employees": Users,
  "/employee-checkin": Fingerprint,
  "/hr": CalendarClock,
};

export function Sidebar() {
  const t = useT();
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-e border-line bg-surface transition-[width] duration-200",
        collapsed ? "w-[78px]" : "w-[264px]"
      )}
    >
      <div className={cn("flex items-center px-4 pt-4", collapsed ? "justify-center px-0" : "")}>
        {collapsed ? (
          <Tooltip content={t("nav.expand")} side="start">
            <button
              type="button"
              aria-label={t("nav.expand")}
              onClick={() => setCollapsed(false)}
              className="grid size-9 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
            >
              <ChevronsLeft className="size-4.5" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={t("nav.collapse")} side="start">
            <button
              type="button"
              aria-label={t("nav.collapse")}
              onClick={() => setCollapsed(true)}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
            >
              <ChevronsRight className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3" aria-label="main">
        <ul className="space-y-1">
          {NAV_ROUTES.filter((route) => {
            if (route.permissions) return route.permissions.some((p) => hasPermission(p));
            return route.permission ? hasPermission(route.permission) : true;
          }).map((route) => {
            const Icon = ICONS[route.path] ?? LayoutDashboard;
            const active =
              route.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(route.path);
            const label = t(route.key);
            const link = (
              <NavLink
                to={route.path}
                className={cn(
                  "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-neon/50",
                  active
                    ? "bg-neon/10 text-neon shadow-glow-sm"
                    : "text-subtle hover:bg-white/[0.04] hover:text-ink",
                  collapsed && "justify-center px-0"
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute start-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-neon shadow-glow-sm"
                  />
                )}
                <Icon aria-hidden className="size-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            );
            return (
              <li key={route.path}>
                {collapsed ? (
                  <Tooltip content={label} side="start">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
