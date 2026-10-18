import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Bot,
  CalendarClock,
  CalendarDays,
  ChevronsUpDown,
  CircleUser,
  Coins,
  HardDriveDownload,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  ScanLine,
  Search,
  Settings,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { routeTitleKey } from "@/routes/nav-routes";
import { useLogoutFlow } from "@/hooks/use-logout-flow";
import { useToast } from "@/components/ui/toast";
import { playAlertChime } from "@/utils/sound";
import { api, type CashSession } from "@/api";
import { todayKey, setDevOverrideDate } from "@/core/dates";
import type {
  AppNotification,
  AppNotificationType,
  NotificationSeverity,
} from "@/core/services/notifications.service";
import { cn } from "@/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { SyncStatusIndicator } from "./sync-status-indicator";
import { TunnelStatusIndicator } from "./tunnel-status-indicator";
import { DocNoSearch } from "./doc-no-search";

const NOTIF_ICONS: Record<AppNotificationType, React.ReactNode> = {
  expiry: <CalendarClock />,
  expired: <CalendarClock />,
  balance: <Wallet />,
  card_lost: <ShieldAlert />,
  backup: <HardDriveDownload />,
  bot_handover: <Bot className="text-rose-400" />,
  cash_handover_deficit: <Coins className="text-rose-400" />,
};

const NOTIF_TINTS: Record<NotificationSeverity, string> = {
  info: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30",
  warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  danger: "bg-rose-500/15 text-rose-400 border border-rose-500/30",
};

const RELOAD_INTERVAL_MS = 5_000;

export function Header({ onOpenMobileNav }: { onOpenMobileNav?: () => void } = {}) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { actor, user, hasPermission } = useAuth();
  const { request: requestLogout, dialog: logoutDialog } = useLogoutFlow();
  const { toast } = useToast();
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Live operational badges
  const [liveOccupants, setLiveOccupants] = useState<number | null>(null);
  const [currentCashSession, setCurrentCashSession] = useState<CashSession | null>(null);

  const fetchOperationalData = useCallback(() => {
    if (!actor) return;
    api.attendance
      .liveOccupants()
      .then((res) => setLiveOccupants(res.totalNow))
      .catch(() => {});

    api.cash
      .openSession()
      .then(setCurrentCashSession)
      .catch(() => {});
  }, [actor]);

  useEffect(() => {
    fetchOperationalData();
    const interval = window.setInterval(fetchOperationalData, 30_000);
    return () => window.clearInterval(interval);
  }, [fetchOperationalData]);

  const today = todayKey();
  const [devDate, setDevDate] = useState(today);
  const [devOverride, setDevOverride] = useState<string | null>(null);
  const devInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!actor) return;
    api.dev.getOverrideDate().then((d) => {
      setDevOverride(d);
      setDevOverrideDate(d);
      if (d) setDevDate(d);
      else setDevDate(today);
    }).catch(() => {});
  }, [actor, today]);

  const applyDevDate = async (val: string | null) => {
    try {
      const res = await api.dev.setOverrideDate(val);
      setDevOverride(res);
      setDevOverrideDate(res);
      window.location.reload();
    } catch {
      toast("error", "فشل تحديث تاريخ المطور");
    }
  };

  const persistReadIds = useCallback((next: string[]) => {
    setReadIds(next);
  }, []);

  const prevHandoverCountRef = useRef<number>(0);

  const reloadNotifications = useCallback(() => {
    if (!actor) return;
    api.notifications
      .collect()
      .then((items) => {
        if (!isMountedRef.current) return;
        setNotifs(items);
        const handoverNotif = items.find((i) => i.type === "bot_handover");
        const currentCount = handoverNotif ? handoverNotif.count : 0;
        if (currentCount > prevHandoverCountRef.current) {
          playAlertChime();
          toast("warning", "🔔 عميل يطلب التحدث مع الاستقبال عبر واتساب (طلب محادثة 0)!");
        }
        prevHandoverCountRef.current = currentCount;
      })
      .catch(() => {
        // notifications are best-effort
      });
  }, [actor, toast]);

  useEffect(() => {
    reloadNotifications();
    const timer = window.setInterval(reloadNotifications, RELOAD_INTERVAL_MS);

    const onFocus = () => reloadNotifications();
    const onCustomReload = () => reloadNotifications();
    window.addEventListener("focus", onFocus);
    window.addEventListener("reload-notifications", onCustomReload);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("reload-notifications", onCustomReload);
    };
  }, [reloadNotifications]);

  const title = t(routeTitleKey(location.pathname));
  const unreadCount = useMemo(
    () => notifs.filter((n) => !readIds.includes(n.id)).length,
    [notifs, readIds],
  );

  return (
    <header className="sticky top-0 z-[100] flex h-14 sm:h-16 shrink-0 items-center gap-2 sm:gap-3 border-b border-white/[0.08] bg-[#070b12]/90 px-3 sm:px-5 backdrop-blur-2xl shadow-sm">
      {onOpenMobileNav && (
        <button
          type="button"
          aria-label={t("nav.openMenu")}
          onClick={onOpenMobileNav}
          className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
        >
          <Menu className="size-5" />
        </button>
      )}

      {/* Breadcrumb Title */}
      <div className="flex items-center gap-2">
        <Link
          to="/"
          className="text-xs font-bold text-slate-400 hover:text-[#00D2FF] transition-colors hidden sm:inline"
        >
          {t("nav.home")}
        </Link>
        <span className="text-xs font-bold text-slate-600 hidden sm:inline">/</span>
        <h1 className="min-w-0 truncate text-sm sm:text-base font-black text-white tracking-wide bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text">
          {title}
        </h1>
      </div>

      {/* Global Document / Number Search */}
      {hasPermission("reports.view") ? (
        <DocNoSearch />
      ) : (
        <div className="relative ms-2 hidden w-72 lg:block">
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3.5 size-4 text-slate-400" />
          <input
            type="search"
            placeholder={t("common.searchPlaceholder")}
            className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] ps-10 pe-14 text-sm text-white outline-none transition-all placeholder:text-slate-500 focus:border-[#00D2FF]/60 focus:bg-white/[0.06] focus:ring-1 focus:ring-[#00D2FF]/20 [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="pointer-events-none absolute inset-y-0 end-0 my-auto me-2.5 grid h-5.5 place-items-center rounded-md border border-white/10 bg-white/[0.06] px-1.5 font-sans text-[10px] font-semibold text-slate-400">
            Ctrl K
          </kbd>
        </div>
      )}

      <div className="flex-1" />

      {/* Live Gym Occupancy Pill */}
      {liveOccupants !== null && liveOccupants > 0 && (
        <Tooltip content="اضغط للانتقال إلى شاشة الاستقبال والحضور" side="bottom">
          <Link
            to="/attendance"
            className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all md:inline-flex shadow-glow-sm"
          >
            <ScanLine className="size-3.5 text-emerald-400" />
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{liveOccupants} داخل الصالة</span>
          </Link>
        </Tooltip>
      )}

      {/* Live Cashier Shift Pill */}
      {hasPermission("payments.view") && (
        <Tooltip content={currentCashSession ? `وردية الخزينة #${currentCashSession.closingNo || 1} مفتوحة` : "الخزينة: لا توجد وردية مفتوحة حالياً"} side="bottom">
          <Link
            to="/treasury"
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all xl:inline-flex",
              currentCashSession
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            )}
          >
            <Coins className="size-3.5" />
            <span>{currentCashSession ? `الوردية #${currentCashSession.closingNo || 1} مفتوحة` : "الوردية مغلقة"}</span>
          </Link>
        </Tooltip>
      )}

      {/* System Status Pill */}
      <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 md:inline-flex">
        <span aria-hidden className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
        {t("header.online")}
      </span>

      {/* Fullscreen Toggle Button */}
      <Tooltip content={isFullscreen ? "الخروج من ملء الشاشة (Esc)" : "ملء الشاشة بالكامل (⛶)"} side="bottom">
        <button
          type="button"
          onClick={toggleFullscreen}
          className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-all hover:bg-white/[0.08] hover:text-white"
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </Tooltip>

      {/* Developer Date Simulator */}
      {user?.isDeveloper === true && (
        <div className="hidden items-center gap-1.5 rounded-full border border-dashed border-amber-500/40 bg-amber-500/10 px-2.5 py-1 md:inline-flex">
          <CalendarDays className="size-3.5 text-amber-400" />
          <input
            ref={devInputRef}
            type="date"
            value={devDate}
            max="2099-12-31"
            onChange={(e) => { setDevDate(e.target.value); void applyDevDate(e.target.value); }}
            className="h-5 w-[110px] cursor-pointer bg-transparent text-[11px] font-bold tabnum text-amber-400 outline-none [color-scheme:dark]"
            title={t("header.devDateTitle")}
          />
          {devOverride && (
            <button
              type="button"
              onClick={() => void applyDevDate(null)}
              className="grid size-4 place-items-center rounded text-amber-400 transition-colors hover:bg-amber-500/20"
              title={t("header.devDateReset")}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      <TunnelStatusIndicator />
      <SyncStatusIndicator />

      {/* Notifications Dropdown */}
      <Dropdown
        widthClass="w-[350px]"
        trigger={
          <button
            type="button"
            aria-label={t("header.notifications")}
            className="relative grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-all hover:bg-white/[0.08] hover:text-white"
          >
            <Bell className="size-[18px]" />
            {unreadCount > 0 && (
              <span aria-hidden className="absolute -top-0.5 -end-0.5 size-2.5 rounded-full bg-rose-500 ring-2 ring-[#070b12] animate-pulse" />
            )}
          </button>
        }
      >
        <div onClick={(e) => e.stopPropagation()} role="none" className="p-1">
          <div className="flex items-center justify-between px-3 pb-2 pt-2 border-b border-white/[0.06]">
            <p className="text-xs font-bold text-white">{t("header.notifications")}</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30 px-2 py-0.5 text-[10px] font-bold tabnum">
                {unreadCount} جديد
              </span>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-white/[0.04] custom-scrollbar">
            {notifs.length === 0 && (
              <li className="px-3 py-8 text-center text-xs text-slate-500">
                {t("header.noNotifs")}
              </li>
            )}
            {notifs.map((n) => {
              const unread = !readIds.includes(n.id);
              const handleClick = () => {
                if (n.type === "bot_handover") {
                  navigate("/messages?tab=bot&section=handovers");
                } else if (n.type === "cash_handover_deficit") {
                  navigate("/treasury");
                } else if (n.type === "expiry" || n.type === "expired") {
                  navigate("/subscriptions");
                } else if (n.type === "balance") {
                  navigate("/finance");
                } else if (n.type === "card_lost") {
                  navigate("/cards");
                } else if (n.type === "backup") {
                  navigate("/settings");
                }
              };
              return (
                <li
                  key={n.id}
                  onClick={handleClick}
                  className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-white/[0.04] cursor-pointer"
                >
                  <span aria-hidden className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4", NOTIF_TINTS[n.severity])}>
                    {NOTIF_ICONS[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-xs leading-snug", unread ? "font-bold text-white" : "font-medium text-slate-400")}>
                      {t(n.messageKey, n.params)}
                    </p>
                  </div>
                  {unread && <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#00D2FF]" />}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => persistReadIds([...new Set([...readIds, ...notifs.map((n) => n.id)])])}
            className="w-full rounded-xl border-t border-white/[0.06] py-2 text-center text-xs font-bold text-[#00D2FF] transition-colors hover:bg-white/[0.04]"
          >
            {t("header.markAllRead")}
          </button>
        </div>
      </Dropdown>

      {/* User Profile Dropdown */}
      <Dropdown
        trigger={
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 transition-all hover:border-white/20 hover:bg-white/[0.06]"
          >
            <Avatar name={user?.fullName ?? "?"} size="sm" />
            <span className="hidden min-w-0 text-start xl:block">
              <span className="block truncate text-xs font-bold leading-tight text-white">{user?.fullName || user?.username}</span>
              <span className="block text-[10px] leading-tight text-slate-400 font-mono uppercase">
                {user ? t(`roles.${user.roleId}`) : ""}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="hidden size-3.5 text-slate-400 xl:block" />
          </button>
        }
      >
        <div className="px-3 pb-2 pt-1.5 border-b border-white/[0.06] xl:hidden">
          <p className="text-xs font-bold text-white">{user?.fullName || user?.username}</p>
          <p className="text-[10px] text-slate-400 font-mono uppercase">{user ? t(`roles.${user.roleId}`) : ""}</p>
        </div>
        <DropdownItem
          icon={<CircleUser />}
          label={t("header.profile")}
          onClick={() => toast("info", t("common.comingSoon"))}
        />
        <DropdownItem
          icon={<Settings />}
          label={t("nav.settings")}
          onClick={() => navigate("/settings")}
        />
        <DropdownDivider />
        <div className="px-3 py-1.5 text-[9px] font-semibold text-slate-400 flex items-center justify-between">
          <span className="font-sans font-bold text-slate-300">KOTB Digital Solutions</span>
          <span className="size-1 rounded-full bg-[#00D2FF]" />
        </div>
        <DropdownItem icon={<LogOut />} label={t("common.logout")} danger onClick={requestLogout} />
      </Dropdown>

      {logoutDialog}
    </header>
  );
}
