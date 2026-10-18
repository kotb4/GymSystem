import { useEffect, useState, useMemo, useCallback } from "react";
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
  LogOut,
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
  Zap,
  Scale,
  Truck,
  Flame,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { NAV_GROUP_ORDER, NAV_ROUTES, type NavRoute } from "@/routes/nav-routes";
import { cn } from "@/utils/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/api";
import { useLogoutFlow } from "@/hooks/use-logout-flow";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/members": Users,
  "/attendance": ScanLine,
  "/quick-sessions": Zap,
  "/treasury": Coins,
  "/debts": Scale,
  "/purchases": Truck,
  "/subscriptions": CalendarCheck,
  "/payments": Banknote,
  "/expenses": ReceiptText,
  "/reports": BarChart3,
  "/store": ShoppingBag,
  "/trainers": UsersRound,
  "/classes": Dumbbell,
  "/private-training": Flame,
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

const GROUP_META: Record<string, { icon: LucideIcon; color: string; badgeColor: string }> = {
  overview: { icon: LayoutDashboard, color: "text-blue-400", badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  operations: { icon: ScanLine, color: "text-emerald-400", badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  members: { icon: Users, color: "text-cyan-400", badgeColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  fitness: { icon: Dumbbell, color: "text-amber-400", badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  store: { icon: ShoppingBag, color: "text-orange-400", badgeColor: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  finance: { icon: Coins, color: "text-emerald-400", badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  team: { icon: UserCheck, color: "text-purple-400", badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  marketing: { icon: MessagesSquare, color: "text-rose-400", badgeColor: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  management: { icon: Settings, color: "text-slate-400", badgeColor: "bg-slate-500/10 text-slate-300 border-slate-500/20" },
};

const QUICK_PINNED: Array<{ path: string; label: string; icon: LucideIcon; perm?: string; color: string }> = [
  { path: "/attendance", label: "الاستقبال", icon: ScanLine, perm: "reception.view", color: "hover:text-emerald-400 hover:border-emerald-500/40" },
  { path: "/members", label: "المشتركون", icon: Users, perm: "members.view", color: "hover:text-cyan-400 hover:border-cyan-500/40" },
  { path: "/subscriptions", label: "الاشتراكات", icon: CalendarCheck, perm: "subscriptions.view", color: "hover:text-amber-400 hover:border-amber-500/40" },
  { path: "/treasury", label: "الخزينة", icon: Coins, perm: "payments.view", color: "hover:text-emerald-400 hover:border-emerald-500/40" },
];

export function Sidebar() {
  const t = useT();
  const { hasPermission, user, isFeatureEnabled, actor } = useAuth();
  const location = useLocation();
  const { request: requestLogout, dialog: logoutDialog } = useLogoutFlow();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("gymgate_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("gymgate_sidebar_collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Search filter query
  const [searchQuery, setSearchQuery] = useState("");

  // Live operational badges
  const [liveOccupancy, setLiveOccupancy] = useState<number | null>(null);
  const [hasOpenShift, setHasOpenShift] = useState<boolean>(false);

  const fetchLiveTelemetry = useCallback(() => {
    if (!actor) return;
    // Live Occupancy
    api.attendance
      .liveOccupants()
      .then((res) => setLiveOccupancy(res.totalNow))
      .catch(() => {});

    // Open Cash Session
    api.cash
      .openSession()
      .then((session) => setHasOpenShift(Boolean(session)))
      .catch(() => {});
  }, [actor]);

  useEffect(() => {
    fetchLiveTelemetry();
    const interval = window.setInterval(fetchLiveTelemetry, 25_000);
    return () => window.clearInterval(interval);
  }, [fetchLiveTelemetry]);

  // Track collapsed groups for accordion behavior (persisted in localStorage)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved =
        localStorage.getItem("gymgate_sidebar_groups") ??
        localStorage.getItem("gymsystem_sidebar_groups");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try {
        localStorage.setItem("gymgate_sidebar_groups", JSON.stringify(next));
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

  const isRouteVisible = useCallback(
    (route: NavRoute) => {
      if (route.developerOnly && user?.isDeveloper !== true) return false;
      if (route.featureFlag && !isFeatureEnabled(route.featureFlag)) return false;
      if (route.permissions) {
        return route.permissions.some((p) => hasPermission(p));
      }
      if (route.permission) {
        return hasPermission(route.permission);
      }
      return true;
    },
    [user, isFeatureEnabled, hasPermission]
  );

  return (
    <>
      <aside
        className={cn(
          "sticky top-0 hidden lg:flex h-screen shrink-0 flex-col border-e border-white/[0.08] bg-[#080c14]/95 backdrop-blur-2xl transition-[width] duration-300 select-none z-30 shadow-[4px_0_30px_rgba(0,0,0,0.6)]",
          collapsed ? "w-[76px]" : "w-[276px]"
        )}
      >
        {/* Brand Header with KOTB Identity */}
        <div
          className={cn(
            "relative flex items-center justify-between px-3.5 py-3 min-h-[72px] border-b border-white/[0.07] bg-gradient-to-b from-[#0055FF]/20 via-[#0A0F1D]/80 to-transparent",
            collapsed ? "justify-center px-0" : ""
          )}
        >
          {!collapsed ? (
            <div className="min-w-0 flex-1 pe-2 flex items-center gap-2.5">
              <div className="relative group/logo">
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#0055FF]/40 to-[#00D2FF]/30 blur-sm opacity-70 group-hover/logo:opacity-100 transition-opacity" />
                <div className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-[#0B101D] border border-[#0055FF]/50 shadow-md p-1.5">
                  <img src="/branding/kotb-k-icon.png" alt="K" className="size-full object-contain select-none" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-black leading-none text-white tracking-tight font-sans">
                    GymGate
                  </span>
                  <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-[#0055FF]/25 text-[#00D2FF] border border-[#0055FF]/40 font-mono">
                    v2.5
                  </span>
                </div>
                <p className="text-[9px] font-bold tracking-wider text-slate-400 font-mono mt-1 truncate">
                  KOTB Digital Solutions
                </p>
              </div>
            </div>
          ) : (
            <Tooltip content="GymGate — KOTB Digital Solutions" side="start">
              <div className="relative group/logo">
                <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-[#0055FF]/40 to-[#00D2FF]/30 blur-xs" />
                <div className="relative grid size-9 place-items-center rounded-xl bg-[#0B101D] border border-[#0055FF]/50 p-1.5">
                  <img src="/branding/kotb-k-icon.png" alt="K" className="size-full object-contain select-none" />
                </div>
              </div>
            </Tooltip>
          )}

          {collapsed ? (
            <Tooltip content={t("nav.expand")} side="start">
              <button
                type="button"
                aria-label={t("nav.expand")}
                onClick={toggleCollapsed}
                className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-300 transition-all hover:bg-neon/15 hover:text-neon hover:border-neon/40 shadow-sm"
              >
                <ChevronsLeft className="size-4" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t("nav.collapse")} side="start">
              <button
                type="button"
                aria-label={t("nav.collapse")}
                onClick={toggleCollapsed}
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition-all hover:bg-white/[0.08] hover:text-white shrink-0"
              >
                <ChevronsRight className="size-4" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Top Search & Fast Navigation Deck (Expanded Mode Only) */}
        {!collapsed && (
          <div className="px-3 pt-3 pb-1 space-y-2 border-b border-white/[0.05] bg-white/[0.01]">
            {/* Quick Live Search Bar */}
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-2.5 size-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث سريع في الشاشات..."
                className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] ps-8 pe-7 text-xs text-white placeholder:text-slate-500 outline-none transition-all focus:border-[#00D2FF]/60 focus:bg-white/[0.06] focus:ring-1 focus:ring-[#00D2FF]/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 end-0 my-auto me-2 grid size-4 place-items-center rounded-full text-slate-400 hover:text-white"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Quick Favorites Row (when not actively searching) */}
            {!searchQuery && (
              <div className="flex items-center justify-between gap-1 pt-0.5 pb-1">
                {QUICK_PINNED.map((pin) => {
                  if (pin.perm && !hasPermission(pin.perm as any)) return null;
                  const Icon = pin.icon;
                  const active = location.pathname.startsWith(pin.path);
                  return (
                    <Tooltip key={pin.path} content={pin.label} side="bottom">
                      <NavLink
                        to={pin.path}
                        className={cn(
                          "flex-1 flex flex-col items-center justify-center py-1.5 rounded-lg border text-center transition-all group/pin",
                          active
                            ? "bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF] font-bold shadow-glow-sm"
                            : "bg-white/[0.02] border-white/[0.05] text-slate-400 hover:bg-white/[0.06] hover:text-white"
                        )}
                      >
                        <Icon className="size-3.5 transition-transform group-hover/pin:scale-110" />
                        <span className="text-[9px] font-medium mt-0.5 leading-none truncate max-w-[50px]">{pin.label}</span>
                      </NavLink>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Navigation List */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-3 custom-scrollbar" aria-label="main">
          {NAV_GROUP_ORDER.map((group) => {
            const visible = NAV_ROUTES.filter((route) => {
              if (route.group !== group) return false;
              if (!isRouteVisible(route)) return false;
              if (!searchQuery.trim()) return true;

              const label = t(route.key).toLowerCase();
              const q = searchQuery.trim().toLowerCase();
              return label.includes(q) || route.path.toLowerCase().includes(q);
            });

            if (visible.length === 0) return null;

            // When searching, auto-expand all matched groups
            const isGroupCollapsed =
              !collapsed && !searchQuery.trim() && collapsedGroups[group] && activeGroup !== group;

            return (
              <div key={group} className="space-y-1">
                {/* Group Header (Collapsible) */}
                {!collapsed && group !== "overview" && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-bold tracking-tight text-slate-300 hover:text-white hover:bg-white/[0.04] transition-all group/header"
                  >
                    <span className="flex items-center gap-2">
                      {(() => {
                        const GroupIcon = GROUP_META[group]?.icon ?? LayoutDashboard;
                        const groupColor = GROUP_META[group]?.color ?? "text-slate-400";
                        return (
                          <div className="grid size-5 place-items-center rounded-md bg-white/[0.04] border border-white/[0.05]">
                            <GroupIcon className={cn("size-3 shrink-0", groupColor)} />
                          </div>
                        );
                      })()}
                      <span className="font-extrabold text-slate-200">{t(`nav.group.${group}`)}</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full border",
                          GROUP_META[group]?.badgeColor ?? "bg-white/[0.04] text-slate-400 border-white/[0.06]"
                        )}
                      >
                        {visible.length}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 text-slate-400 transition-transform duration-200 group-hover/header:text-white",
                          isGroupCollapsed && "-rotate-90"
                        )}
                      />
                    </div>
                  </button>
                )}

                {/* Collapsed Group Divider */}
                {collapsed && group !== "overview" && (
                  <div className="my-2 border-t border-white/[0.08] mx-2" />
                )}

                {/* Items List */}
                {(!isGroupCollapsed || group === "overview") && (
                  <ul className="space-y-1 pt-0.5">
                    {visible.map((route) => {
                      const Icon = ICONS[route.path] ?? LayoutDashboard;
                      const active =
                        route.path === "/"
                          ? location.pathname === "/"
                          : location.pathname.startsWith(route.path);
                      const label = t(route.key);

                      // Dynamic Telemetry Badges
                      const isAttendanceRoute = route.path === "/attendance";
                      const isTreasuryRoute = route.path === "/treasury";

                      const link = (
                        <NavLink
                          to={route.path}
                          className={cn(
                            "group relative flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-xs font-semibold outline-none transition-all duration-200",
                            active
                              ? "bg-gradient-to-r from-neon/20 via-neon/10 to-transparent text-white font-bold border border-neon/35 shadow-[0_0_15px_rgba(0,210,255,0.12)]"
                              : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 hover:border-white/[0.07] border border-transparent",
                            collapsed && "justify-center px-0 h-10 w-10 mx-auto"
                          )}
                        >
                          {/* Active Accent Bar */}
                          {active && !collapsed && (
                            <span
                              aria-hidden
                              className="absolute start-0 top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-e-full bg-neon shadow-[0_0_10px_#00D2FF]"
                            />
                          )}

                          <div
                            className={cn(
                              "grid size-7 place-items-center rounded-lg transition-all",
                              active
                                ? "bg-neon/25 text-neon shadow-[0_0_8px_rgba(0,210,255,0.4)]"
                                : "text-slate-400 group-hover:text-white group-hover:bg-white/[0.06]"
                            )}
                          >
                            <Icon aria-hidden className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                          </div>

                          {!collapsed && (
                            <span className="truncate flex-1 tracking-tight text-[12px]">{label}</span>
                          )}

                          {/* Live Attendance Counter Badge */}
                          {!collapsed && isAttendanceRoute && liveOccupancy !== null && liveOccupancy > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span>{liveOccupancy}</span>
                            </span>
                          )}

                          {/* Live Cashier Active Shift Badge */}
                          {!collapsed && isTreasuryRoute && hasOpenShift && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              مفتوحة
                            </span>
                          )}

                          {/* Developer Badge */}
                          {!collapsed && route.developerOnly && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold border border-amber-500/30">
                              DEV
                            </span>
                          )}

                          {/* Collapsed dot indicators */}
                          {collapsed && isAttendanceRoute && liveOccupancy !== null && liveOccupancy > 0 && (
                            <span className="absolute top-1 end-1 size-2 rounded-full bg-emerald-400 ring-2 ring-[#080c14]" />
                          )}
                          {collapsed && isTreasuryRoute && hasOpenShift && (
                            <span className="absolute top-1 end-1 size-2 rounded-full bg-emerald-400 ring-2 ring-[#080c14]" />
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

        {/* Executive User & Attribution Dock */}
        <div className="p-2 border-t border-white/[0.08] bg-[#05070B] space-y-2">
          {!collapsed ? (
            <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/50 p-2.5 backdrop-blur-md shadow-lg space-y-2">
              {/* User row */}
              {user && (
                <div className="flex items-center gap-2.5">
                  <div className="relative size-8 shrink-0 rounded-xl bg-gradient-to-br from-[#0055FF]/30 to-[#00D2FF]/20 border border-[#0055FF]/40 text-[#00D2FF] font-black text-xs flex items-center justify-center shadow-sm">
                    {user.username.slice(0, 2).toUpperCase()}
                    <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-400 border border-[#05070B]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-white truncate">{user.fullName || user.username}</p>
                      {user.isDeveloper && (
                        <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" title="Developer" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block truncate">
                      {user.roleId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={requestLogout}
                    title="تسجيل الخروج الآمن"
                    className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <LogOut className="size-3.5" />
                  </button>
                </div>
              )}

              {/* KOTB Corporate Brand Presence */}
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <img src="/branding/kotb-k-icon.png" alt="K" className="size-3.5 object-contain" />
                  <span className="font-bold text-[10px] text-white font-sans tracking-wide">KOTB Digital Solutions</span>
                </div>
                <span className="text-[9px] font-bold text-[#00D2FF] font-mono tracking-tight">
                  Enterprise
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-1">
              {user && (
                <Tooltip content={`${user.fullName || user.username} (${user.roleId})`} side="start">
                  <div className="relative size-8 shrink-0 rounded-xl bg-gradient-to-br from-[#0055FF]/30 to-[#00D2FF]/20 border border-[#0055FF]/40 text-[#00D2FF] font-black text-xs flex items-center justify-center">
                    {user.username.slice(0, 2).toUpperCase()}
                    <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-400 border border-[#05070B]" />
                  </div>
                </Tooltip>
              )}
              <Tooltip content="تسجيل الخروج الآمن" side="start">
                <button
                  type="button"
                  onClick={requestLogout}
                  className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <LogOut className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content="GymGate — Powered by KOTB Digital Solutions" side="start">
                <div className="size-8 rounded-lg border border-[#0055FF]/30 bg-[#080B11] p-1 flex items-center justify-center cursor-default">
                  <img src="/branding/kotb-k-icon.png" alt="K" className="size-4 object-contain" />
                </div>
              </Tooltip>
            </div>
          )}
        </div>
      </aside>
      {logoutDialog}
    </>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { hasPermission, user, isFeatureEnabled } = useAuth();
  const location = useLocation();
  const [drawerSearch, setDrawerSearch] = useState("");

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
        className="fixed inset-0 animate-fade-in bg-black/80 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.openMenu")}
        className="fixed inset-y-0 start-0 z-10 flex w-[295px] max-w-[85vw] flex-col border-e border-white/10 bg-[#080c14] shadow-2xl animate-in slide-in-from-start duration-200"
      >
        {/* Drawer Header with KOTB Identity */}
        <div className="flex min-h-[72px] shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3 bg-gradient-to-b from-[#0055FF]/20 via-[#0A0F1D]/80 to-transparent">
          <div className="min-w-0 flex-1 pe-2 flex items-center gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#0B101D] border border-[#0055FF]/50 shadow-sm p-1.5">
              <img src="/branding/kotb-k-icon.png" alt="K" className="size-full object-contain select-none" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-black leading-none text-white tracking-tight font-sans">
                  GymGate
                </span>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-[#0055FF]/25 text-[#00D2FF] border border-[#0055FF]/40 font-mono">
                  v2.5
                </span>
              </div>
              <p className="text-[9px] font-bold tracking-wider text-slate-400 font-mono mt-0.5 truncate uppercase">
                KOTB Digital Solutions
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white shrink-0"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Drawer Search Filter */}
        <div className="px-3 pt-3 pb-2 border-b border-white/[0.06]">
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-2.5 size-3.5 text-slate-400" />
            <input
              type="text"
              value={drawerSearch}
              onChange={(e) => setDrawerSearch(e.target.value)}
              placeholder="بحث في الشاشات..."
              className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] ps-8 pe-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#00D2FF]/60"
            />
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto p-3 custom-scrollbar" aria-label="mobile">
          <ul className="space-y-3">
            {NAV_GROUP_ORDER.map((group) => {
              const visible = NAV_ROUTES.filter((route) => {
                if (route.group !== group) return false;
                if (route.developerOnly && user?.isDeveloper !== true) return false;
                if (route.featureFlag && !isFeatureEnabled(route.featureFlag)) return false;
                if (route.permissions && !route.permissions.some((p) => hasPermission(p))) return false;
                if (route.permission && !hasPermission(route.permission)) return false;
                if (drawerSearch.trim()) {
                  const label = t(route.key).toLowerCase();
                  const q = drawerSearch.trim().toLowerCase();
                  return label.includes(q) || route.path.toLowerCase().includes(q);
                }
                return true;
              });

              if (visible.length === 0) return null;

              return (
                <li key={group} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-extrabold text-slate-400">
                    {(() => {
                      const GroupIcon = GROUP_META[group]?.icon ?? LayoutDashboard;
                      const groupColor = GROUP_META[group]?.color ?? "text-slate-400";
                      return <GroupIcon className={cn("size-3.5", groupColor)} />;
                    })()}
                    <span>{t(`nav.group.${group}`)}</span>
                  </div>
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
                              "flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-xs font-semibold transition-all",
                              active
                                ? "bg-neon/15 text-white font-bold border border-neon/30"
                                : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                            )}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate flex-1">{label}</span>
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

        {/* Footer */}
        <div className="p-3 border-t border-white/[0.08] bg-[#05070B] text-center space-y-1">
          <p className="text-[10px] text-slate-400">
            GymGate — Powered by <strong className="text-white">KOTB Digital Solutions</strong>
          </p>
          <p className="text-[10px] font-medium text-slate-500 font-sans">
            قُطب للحلول الرقمية • Enterprise Edition
          </p>
        </div>
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
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-white/[0.08] bg-[#080c14]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl lg:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
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
              "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center transition-all",
              active ? "text-neon font-bold" : "text-slate-400 hover:text-white"
            )}
          >
            <div
              className={cn(
                "grid size-8 place-items-center rounded-xl transition-all",
                active && "bg-neon/15 shadow-glow-sm text-neon border border-neon/30"
              )}
            >
              <Icon className="size-4" />
            </div>
            <span className="text-[10px] leading-none truncate max-w-[64px] font-semibold">{item.label}</span>
          </NavLink>
        );
      })}

      {/* Menu / Drawer Toggle */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("nav.more")}
        className="flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center text-slate-400 hover:text-white transition-colors"
      >
        <div className="grid size-8 place-items-center rounded-xl transition-all">
          <Menu className="size-4" />
        </div>
        <span className="text-[10px] leading-none font-semibold">{t("nav.more")}</span>
      </button>
    </div>
  );
}
