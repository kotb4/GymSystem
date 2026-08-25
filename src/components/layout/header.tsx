import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarClock,
  ChevronsUpDown,
  CircleUser,
  HardDriveDownload,
  LogOut,
  Search,
  Settings,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { routeTitleKey } from "@/routes/nav-routes";
import { useLogoutFlow } from "@/hooks/use-logout-flow";
import { useToast } from "@/components/ui/toast";
import {
  api,
} from "@/api";
import type {
  AppNotification,
  AppNotificationType,
  NotificationSeverity,
} from "@/core/services/notifications.service";
import { cn } from "@/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";

const NOTIF_ICONS: Record<AppNotificationType, React.ReactNode> = {
  expiry: <CalendarClock />,
  expired: <CalendarClock />,
  balance: <Wallet />,
  card_lost: <ShieldAlert />,
  backup: <HardDriveDownload />,
};

const NOTIF_TINTS: Record<NotificationSeverity, string> = {
  info: "bg-cyan/10 text-cyan",
  warning: "bg-amber/10 text-amber",
  danger: "bg-red/10 text-red",
};

const RELOAD_INTERVAL_MS = 60_000;

export function Header() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { actor, user } = useAuth();
  const { request: requestLogout, dialog: logoutDialog } = useLogoutFlow();
  const { toast } = useToast();
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  // read-state is pure UI preference kept in memory only (spec section 10)
  const [readIds, setReadIds] = useState<string[]>([]);

  const persistReadIds = useCallback((next: string[]) => {
    setReadIds(next);
  }, []);

  const reloadNotifications = useCallback(() => {
    if (!actor) return;
    let alive = true;
    api.notifications
      .collect()
      .then((items) => {
        if (alive) setNotifs(items);
      })
      .catch(() => {
        // notifications are best-effort
      });
    return () => {
      alive = false;
    };
  }, [actor]);

  useEffect(() => {
    const cleanup = reloadNotifications();
    const timer = window.setInterval(reloadNotifications, RELOAD_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      cleanup?.();
    };
  }, [reloadNotifications]);

  const title = t(routeTitleKey(location.pathname));
  const unreadCount = useMemo(
    () => notifs.filter((n) => !readIds.includes(n.id)).length,
    [notifs, readIds],
  );

  return (
    <header className="sticky top-0 z-[100] flex h-16 shrink-0 items-center gap-3 border-b border-line bg-base/85 px-5 backdrop-blur-md">
      <h1 className="min-w-0 truncate text-[15px] font-bold">{title}</h1>

      <div className="relative ms-2 hidden w-72 lg:block">
        <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3.5 size-4 text-faint" />
        <input
          type="search"
          placeholder={t("common.searchPlaceholder")}
          className="h-9 w-full rounded-xl border border-line bg-panel ps-10 pe-12 text-sm outline-none transition-colors placeholder:text-faint focus:border-neon/60 focus:ring-2 focus:ring-neon/15 [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="pointer-events-none absolute inset-y-0 end-0 my-auto me-3 grid h-6 place-items-center rounded-md border border-line bg-surface px-1.5 font-sans text-[10px] font-semibold text-faint">
          Ctrl K
        </kbd>
      </div>

      <div className="flex-1" />

      <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-subtle md:inline-flex">
        <span aria-hidden className="size-2 animate-pulse-dot rounded-full bg-neon" />
        {t("header.online")}
      </span>

      <Dropdown
        widthClass="w-[340px]"
        trigger={
          <button
            type="button"
            aria-label={t("header.notifications")}
            className="relative grid size-9 place-items-center rounded-lg text-subtle transition-colors hover:bg-white/5 hover:text-ink"
          >
            <Bell className="size-[18px]" />
            {unreadCount > 0 && (
              <span aria-hidden className="absolute end-1.5 top-1.5 size-2 rounded-full bg-red ring-2 ring-base" />
            )}
          </button>
        }
      >
        <div onClick={(e) => e.stopPropagation()} role="none">
          <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
            <p className="text-sm font-bold">{t("header.notifications")}</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-neon/10 px-2 py-0.5 text-[10px] font-bold tabnum">
                {unreadCount}
              </span>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifs.length === 0 && (
              <li className="px-3 py-8 text-center text-[13px] text-faint">
                {t("header.noNotifs")}
              </li>
            )}
            {notifs.map((n) => {
              const unread = !readIds.includes(n.id);
              return (
                <li key={n.id} className="flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]">
                  <span aria-hidden className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-4", NOTIF_TINTS[n.severity])}>
                    {NOTIF_ICONS[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] leading-snug", unread ? "font-bold text-ink" : "font-semibold text-subtle")}>
                      {t(n.messageKey, n.params)}
                    </p>
                  </div>
                  {unread && <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-neon" />}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => persistReadIds([...new Set([...readIds, ...notifs.map((n) => n.id)])])}
            className="w-full rounded-b-lg border-t border-line py-2.5 text-center text-xs font-bold text-neon transition-colors hover:bg-white/[0.04]"
          >
            {t("header.markAllRead")}
          </button>
        </div>
      </Dropdown>

      <Dropdown
        trigger={
          <button
            type="button"
            className="flex h-10 items-center gap-2.5 rounded-xl border border-transparent px-1 pe-2 transition-colors hover:border-line hover:bg-white/[0.03]"
          >
            <Avatar name={user?.fullName ?? "?"} size="sm" />
            <span className="hidden min-w-0 text-start xl:block">
              <span className="block truncate text-xs font-bold leading-tight">{user?.fullName}</span>
              <span className="block text-[10px] leading-tight text-faint">
                {user ? t(`roles.${user.roleId}`) : ""}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="hidden size-3.5 text-faint xl:block" />
          </button>
        }
      >
        <div className="px-3 pb-1.5 pt-1 xl:hidden">
          <p className="text-sm font-bold">{user?.fullName}</p>
          <p className="text-[11px] text-faint">{user ? t(`roles.${user.roleId}`) : ""}</p>
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
        <DropdownItem icon={<LogOut />} label={t("common.logout")} danger onClick={requestLogout} />
      </Dropdown>

      {logoutDialog}
    </header>
  );
}
