import { useEffect, useState, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  CreditCard,
  Dumbbell,
  Fingerprint,
  Gift,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  MessageSquare,
  ReceiptText,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  ShoppingBag,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { NAV_GROUP_ORDER, NAV_ROUTES } from "@/routes/nav-routes";
import { cn } from "@/utils/cn";
import { Tooltip } from "@/components/ui/tooltip";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/members": Users,
  "/attendance": ScanLine,
  "/treasury": Coins,
  "/subscriptions": CalendarCheck,
  "/doc-search": Search,
  "/payments": Banknote,
  "/expenses": ReceiptText,
  "/reports": BarChart3,
  "/store": ShoppingBag,
  "/classes": Dumbbell,
  "/employees": Users,
  "/employee-checkin": Fingerprint,
  "/staff": UsersRound,
  "/crm": MessageSquare,
  "/referrals": Share2,
  "/messages": MessagesSquare,
  "/cards": CreditCard,
  "/loyalty": Gift,
  "/settings": Settings,
  "/audit": ScrollText,
  "/developer": ShieldAlert,
};

export function Sidebar() {
  const t = useT();
  const { hasPermission, user, isFeatureEnabled } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // Track collapsed groups for accordion behavior (persisted in localStorage)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("gymsystem_sidebar_groups");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try {
        localStorage.setItem("gymsystem_sidebar_groups", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Determine which group has active child to keep it expanded automatically
  const activeGroup = useMemo(() => {
    for (const route of NAV_ROUTES) {
      const active =
        route.path === "/"
          ? location.pathname === "/"
          : location.pathname.startsWith(route.path);
      if (active) return route.group;
    }
    return null;
  }, [location.pathname]);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden lg:flex h-screen shrink-0 flex-col border-e border-white/[0.08] bg-[#0c1017]/95 backdrop-blur-xl transition-[width] duration-300 select-none z-30 shadow-2xl",
        collapsed ? "w-[76px]" : "w-[272px]"
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3.5 py-3 min-h-[64px] border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent",
          collapsed ? "justify-center px-0" : ""
        )}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1 pe-2">
            <p className="text-[13px] font-black leading-snug text-ink tracking-tight select-text">
              {t("app.name")}
            </p>
            <p className="text-[10px] font-bold tracking-wider text-neon font-mono mt-0.5">
              Gym Management System
            </p>
          </div>
        )}

        {collapsed ? (
          <Tooltip content={t("nav.expand")} side="start">
            <button
              type="button"
              aria-label={t("nav.expand")}
              onClick={() => setCollapsed(false)}
              className="grid size-9 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-subtle transition-all hover:bg-neon/10 hover:text-neon hover:border-neon/30"
            >
              <ChevronsLeft className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={t("nav.collapse")} side="start">
            <button
              type="button"
              aria-label={t("nav.collapse")}
              onClick={() => setCollapsed(true)}
              className="grid size-8 place-items-center rounded-lg text-faint transition-all hover:bg-white/[0.06] hover:text-ink shrink-0"
            >
              <ChevronsRight className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4 custom-scrollbar" aria-label="main">
        {NAV_GROUP_ORDER.map((group) => {
          const visible = NAV_ROUTES.filter((route) => {
            if (route.group !== group) return false;
            if (route.developerOnly) return user?.isDeveloper === true;
            if (route.featureFlag && !isFeatureEnabled(route.featureFlag)) return false;
            return route.permissions
              ? route.permissions.some((p) => hasPermission(p))
              : route.permission
                ? hasPermission(route.permission)
                : true;
          });

          if (visible.length === 0) return null;

          const isGroupCollapsed = !collapsed && collapsedGroups[group] && activeGroup !== group;

          return (
            <div key={group} className="space-y-1">
              {/* Group Header (Collapsible) */}
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] transition-colors group/header"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-slate-500 group-hover/header:bg-neon transition-colors" />
                    <span>{t(`nav.group.${group}`)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-slate-500 font-semibold px-1 rounded bg-white/[0.03]">
                      {visible.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 text-slate-500 transition-transform duration-200 group-hover/header:text-slate-300",
                        isGroupCollapsed && "-rotate-90"
                      )}
                    />
                  </div>
                </button>
              )}

              {/* Items List */}
              {!isGroupCollapsed && (
                <ul className="space-y-1 pt-0.5">
                  {visible.map((route) => {
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
                          "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-xs font-semibold outline-none transition-all duration-200",
                          active
                            ? "bg-gradient-to-r from-neon/15 via-neon/10 to-transparent text-neon border border-neon/30 font-bold shadow-glow-sm"
                            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 hover:border-white/[0.06] border border-transparent",
                          collapsed && "justify-center px-0 h-10 w-10 mx-auto"
                        )}
                      >
                        {/* Active Accent Bar */}
                        {active && !collapsed && (
                          <span
                            aria-hidden
                            className="absolute start-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-e-full bg-neon shadow-glow-sm"
                          />
                        )}

                        <div
                          className={cn(
                            "grid size-7 place-items-center rounded-lg transition-all",
                            active
                              ? "bg-neon/20 text-neon shadow-glow-sm"
                              : "text-slate-400 group-hover:text-slate-200 group-hover:bg-white/[0.06]"
                          )}
                        >
                          <Icon aria-hidden className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                        </div>

                        {!collapsed && (
                          <span className="truncate flex-1 tracking-tight">{label}</span>
                        )}

                        {/* Developer badge indicator */}
                        {!collapsed && route.developerOnly && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neon/15 text-neon font-bold border border-neon/20">
                            DEV
                          </span>
                        )}
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
              )}
            </div>
          );
        })}
      </nav>

      {/* User & Role Footer */}
      {user && (
        <div className={cn("p-3 border-t border-white/[0.06] bg-black/30", collapsed ? "flex justify-center" : "")}>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl p-2 transition-all border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05]",
              collapsed ? "justify-center size-10 p-0" : ""
            )}
          >
            <div className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-neon/20 to-cyan/20 border border-neon/30 text-neon font-black text-xs uppercase shadow-glow-sm">
              {user.username.slice(0, 2)}
              <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-400 border border-[#0c1017]" />
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold text-ink truncate">{user.fullName || user.username}</p>
                  {user.isDeveloper && (
                    <span className="size-1.5 rounded-full bg-neon animate-pulse" />
                  )}
                </div>
                <p className="text-[10px] text-faint truncate font-mono uppercase tracking-wider">
                  {user.roleId}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { hasPermission, user, isFeatureEnabled } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150] lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.openMenu")}
        className="fixed inset-y-0 start-0 z-10 flex w-[285px] max-w-[85vw] flex-col border-e border-white/10 bg-surface shadow-2xl animate-in slide-in-from-start duration-200"
      >
        {/* Drawer Header */}
        <div className="flex min-h-[64px] shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 pe-2">
            <p className="text-[13px] font-black leading-snug text-ink tracking-tight select-text">
              {t("app.name")}
            </p>
            <p className="text-[10px] font-bold tracking-wider text-neon font-mono mt-0.5">
              Gym Management System
            </p>
          </div>
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-white/5 hover:text-ink shrink-0"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto p-3" aria-label="mobile">
          <ul className="space-y-3">
            {NAV_GROUP_ORDER.map((group) => {
              const visible = NAV_ROUTES.filter((route) => {
                if (route.group !== group) return false;
                if (route.developerOnly) return user?.isDeveloper === true;
                if (route.featureFlag && !isFeatureEnabled(route.featureFlag)) return false;
                return route.permissions
                  ? route.permissions.some((p) => hasPermission(p))
                  : route.permission
                    ? hasPermission(route.permission)
                    : true;
              });
              if (visible.length === 0) return null;
              return (
                <li key={group}>
                  <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-faint">
                    {t(`nav.group.${group}`)}
                  </p>
                  <ul className="space-y-1">
                    {visible.map((route) => {
                      const Icon = ICONS[route.path] ?? LayoutDashboard;
                      const active =
                        route.path === "/"
                          ? location.pathname === "/"
                          : location.pathname.startsWith(route.path);
                      const label = t(route.key);
                      return (
                        <li key={route.path}>
                          <NavLink
                            to={route.path}
                            onClick={onClose}
                            className={cn(
                              "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold outline-none transition-all duration-150",
                              active
                                ? "bg-neon/10 text-neon shadow-glow-sm border border-neon/20 font-bold"
                                : "text-subtle hover:bg-white/[0.05] hover:text-ink",
                            )}
                          >
                            {active && (
                              <span
                                aria-hidden
                                className="absolute start-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-neon shadow-glow-sm"
                              />
                            )}
                            <Icon aria-hidden className="size-[18px] shrink-0" />
                            <span className="truncate">{label}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export function MobileBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const t = useT();
  const location = useLocation();
  const { hasPermission, isFeatureEnabled } = useAuth();

  const items = [
    { path: "/", label: t("nav.dashboard"), icon: LayoutDashboard, perm: "members.view" },
    { path: "/members", label: t("nav.members"), icon: Users, perm: "members.view", flag: "featureMembersEnabled" },
    { path: "/attendance", label: t("nav.attendance"), icon: ScanLine, perm: "reception.view", flag: "featureAttendanceEnabled" },
    { path: "/treasury", label: t("nav.treasury"), icon: Coins, perm: "payments.view", flag: "featureTreasuryEnabled" },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-line/60 bg-base/92 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {items.map((item) => {
        if (item.perm && !hasPermission(item.perm as any)) return null;
        if (item.flag && !isFeatureEnabled(item.flag)) return null;
        const active =
          item.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.path);
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center transition-colors",
              active ? "text-neon font-bold" : "text-subtle hover:text-ink"
            )}
          >
            <div
              className={cn(
                "grid size-8 place-items-center rounded-xl transition-all",
                active && "bg-neon/10 shadow-glow-sm text-neon"
              )}
            >
              <Icon className="size-4.5" />
            </div>
            <span className="text-[10px] leading-none truncate max-w-[64px]">{item.label}</span>
          </NavLink>
        );
      })}

      {/* Menu / Drawer Toggle */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("nav.more")}
        className="flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center text-subtle hover:text-ink transition-colors"
      >
        <div className="grid size-8 place-items-center rounded-xl transition-all">
          <Menu className="size-4.5" />
        </div>
        <span className="text-[10px] leading-none">{t("nav.more")}</span>
      </button>
    </div>
  );
}
