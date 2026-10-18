import { Link, useLocation } from "react-router-dom";
import {
  Banknote,
  BarChart3,
  CreditCard,
  Dumbbell,
  Fingerprint,
  Flame,
  Gift,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  ReceiptText,
  ScanLine,
  ScrollText,
  Settings,
  Share2,
  ShieldAlert,
  ShoppingBag,
  Ticket,
  Truck,
  UserCheck,
  Users,
  UsersRound,
  Zap,
  Scale,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { NAV_ROUTES, type NavGroup, type NavRoute } from "@/routes/nav-routes";
import { cn } from "@/utils/cn";

export interface SectionItemMeta {
  label: string;
  icon: LucideIcon;
}

export const SECTION_ITEM_META: Record<string, SectionItemMeta> = {
  // 1. Operations — الاستقبال واليومية
  "/attendance": { label: "تسجيل الحضور والاستقبال", icon: ScanLine },
  "/quick-sessions": { label: "تذاكر اليوم الواحد", icon: Zap },

  // 2. Members — المشتركون والاشتراكات
  "/members": { label: "دليل المشتركين والأعضاء", icon: UsersRound },
  "/subscriptions": { label: "الاشتراكات وباقات الأسعار", icon: Ticket },
  "/debts": { label: "مديونيات ومستحقات الأعضاء", icon: Scale },
  "/cards": { label: "البطاقات والكروت الذكية", icon: CreditCard },

  // 3. Fitness — التدريب والأنشطة
  "/classes": { label: "الحصص الجماعية والأنشطة", icon: Dumbbell },
  "/trainers": { label: "المدربون ومستحقاتهم", icon: UsersRound },
  "/private-training": { label: "التدريب الخاص (PT)", icon: Flame },
  "/trainer-attendance": { label: "حضور ومناوبات المدربين", icon: UserCheck },

  // 4. Store — المتجر والمشتريات
  "/store": { label: "نقطة بيع المتجر (POS)", icon: ShoppingBag },
  "/purchases": { label: "المشتريات وفواتير الموردين", icon: Truck },

  // 5. Finance — الخزينة والمالية
  "/treasury": { label: "الخزينة والورديات (Z-Report)", icon: Coins },
  "/payments": { label: "سجل المدفوعات والتحصيل", icon: Banknote },
  "/expenses": { label: "المصروفات وسندات الصرف", icon: ReceiptText },
  "/reports": { label: "التقارير المالية والأرباح", icon: BarChart3 },

  // 6. Team — فريق العمل والموظفون
  "/employees": { label: "شؤون الموظفين والرواتب", icon: Users },
  "/employee-checkin": { label: "بصمة وحضور الموظفين", icon: Fingerprint },

  // 7. Marketing — التسويق وعلاقات العملاء
  "/crm": { label: "العملاء المحتملين والتجارب (CRM)", icon: MessageSquare },
  "/messages": { label: "مركز رسائل الواتساب والتنبيهات", icon: MessagesSquare },
  "/loyalty": { label: "برنامج نقاط الولاء والمكافآت", icon: Gift },
  "/referrals": { label: "نظام إحالات ومشاركات الأعضاء", icon: Share2 },

  // 8. Management — إدارة النظام والأمان
  "/staff": { label: "المستخدمون والصلاحيات", icon: UsersRound },
  "/settings": { label: "الإعدادات العامة للنظام", icon: Settings },
  "/audit": { label: "سجل العمليات والرقابة", icon: ScrollText },
  "/developer": { label: "لوحة المطور والأمان (DEV)", icon: ShieldAlert },
};

export const GROUP_META: Record<NavGroup, { title: string; icon: LucideIcon; color: string }> = {
  overview: { title: "نظرة عامة", icon: LayoutDashboard, color: "text-blue-400" },
  operations: { title: "الاستقبال واليومية", icon: ScanLine, color: "text-emerald-400" },
  members: { title: "المشتركون والاشتراكات", icon: Users, color: "text-cyan-400" },
  fitness: { title: "التدريب والأنشطة", icon: Dumbbell, color: "text-amber-400" },
  store: { title: "المتجر والمبيعات", icon: ShoppingBag, color: "text-orange-400" },
  finance: { title: "الخزينة والمالية", icon: Coins, color: "text-emerald-400" },
  team: { title: "فريق العمل والموظفون", icon: UserCheck, color: "text-purple-400" },
  marketing: { title: "التسويق وعلاقات العملاء", icon: MessagesSquare, color: "text-rose-400" },
  management: { title: "إدارة النظام والأمان", icon: Settings, color: "text-slate-400" },
};

export function resolveNavGroup(pathname: string): NavGroup | null {
  if (pathname === "/") return "overview";

  // Check prefix matches, longest path first
  const routes = [...NAV_ROUTES]
    .filter((r) => r.path !== "/")
    .sort((a, b) => b.path.length - a.path.length);

  for (const r of routes) {
    if (pathname === r.path || pathname.startsWith(r.path + "/")) {
      return r.group;
    }
  }

  return null;
}

export function isRouteActive(routePath: string, currentPath: string): boolean {
  if (routePath === "/") return currentPath === "/";
  if (routePath === "/members") {
    return currentPath === "/members" || currentPath.startsWith("/members/");
  }
  return currentPath === routePath || currentPath.startsWith(routePath + "/");
}

export function SectionCapsuleNav() {
  const t = useT();
  const location = useLocation();
  const { hasPermission, isFeatureEnabled, user } = useAuth();

  const activeGroup = resolveNavGroup(location.pathname);
  if (!activeGroup || activeGroup === "overview") return null;

  const isRouteVisible = (route: NavRoute) => {
    if (route.developerOnly && user?.isDeveloper !== true) return false;
    if (route.featureFlag && !isFeatureEnabled(route.featureFlag)) return false;
    if (route.permissions) {
      return route.permissions.some((p) => hasPermission(p));
    }
    if (route.permission) {
      return hasPermission(route.permission);
    }
    return true;
  };

  const visibleRoutes = NAV_ROUTES.filter(
    (r) => r.group === activeGroup && isRouteVisible(r)
  );

  // If section only has 1 accessible route, no sub-navigation bar is needed
  if (visibleRoutes.length <= 1) return null;

  const groupInfo = GROUP_META[activeGroup];
  const GroupIcon = groupInfo?.icon ?? LayoutDashboard;

  return (
    <nav
      aria-label="شريط التنقل السريع بين شاشات القسم"
      className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl sm:rounded-full border border-panel-border/50 bg-[#080c14]/85 p-1.5 sm:p-2 backdrop-blur-xl shadow-lg shadow-black/20"
    >
      {/* Navigation Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleRoutes.map((route) => {
          const meta = SECTION_ITEM_META[route.path];
          const label = meta?.label ?? t(route.key);
          const Icon = meta?.icon ?? Users;
          const isActive = isRouteActive(route.path, location.pathname);

          return (
            <Link
              key={route.path}
              to={route.path}
              className={cn(
                "group relative flex items-center gap-2 rounded-full px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold transition-all duration-200 select-none",
                isActive
                  ? "bg-neon/15 border border-neon/60 text-white shadow-[0_0_12px_rgba(57,255,20,0.25)]"
                  : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent"
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-200 group-hover:scale-110 shrink-0",
                  isActive ? "text-neon" : "text-subtle"
                )}
              />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>

      {/* Section Department Badge */}
      <div className="hidden md:flex items-center gap-2 pe-3 ps-2 text-[11px] font-bold border-s border-white/[0.08] select-none">
        <GroupIcon className={cn("size-3.5 shrink-0", groupInfo?.color ?? "text-slate-400")} />
        <span className="text-slate-400 font-medium">{groupInfo?.title ?? t(`nav.group.${activeGroup}`)}</span>
      </div>
    </nav>
  );
}
