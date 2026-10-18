import { useEffect, useState } from "react";
import { Users, ShieldCheck, Activity, KeyRound, UserCheck, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type PublicUser } from "@/api";
import { diffDaysKeys, todayKey } from "@/core/dates";
import { cn } from "@/utils/cn";
import { UsersTab } from "@/components/staff/users-tab";
import { PermissionsTab } from "@/components/staff/permissions-tab";

type StaffTab = "users" | "permissions";

export function StaffPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<StaffTab>("users");
  const [users, setUsers] = useState<PublicUser[]>([]);

  const showUsers = hasPermission("users.view");
  const showPerms = hasPermission("users.view");

  useEffect(() => {
    if (tab === "users" && !showUsers && showPerms) setTab("permissions");
    if (tab === "permissions" && !showPerms && showUsers) setTab("users");
  }, [tab, showUsers, showPerms]);

  useEffect(() => {
    if (showUsers) {
      api.users
        .list()
        .then(setUsers)
        .catch(() => {});
    }
  }, [showUsers]);

  if (!showUsers && !showPerms) return null;

  const totalUsers = users.length;
  const activeStaff = users.filter((u) => u.isActive).length;
  const uniqueRolesCount = new Set(users.map((u) => u.roleId)).size;
  const today = todayKey();
  const onlineSessions = users.filter((u) => {
    if (!u.lastLoginAt) return false;
    const loginDay = u.lastLoginAt.slice(0, 10);
    return diffDaysKeys(today, loginDay) <= 1;
  }).length;
  const lockedOrInactive = users.filter((u) => !u.isActive).length;

  return (
    <div className="space-y-4">
      {/* Top Header Hub */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F1420]/80 p-3.5 rounded-2xl border border-white/[0.08] shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-neon/20 to-blue-500/10 border border-neon/30 text-neon shadow-glow-sm">
            <Users className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2">
              <span>فريق العمل وإدارة الصلاحيات</span>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-neon/15 border border-neon/30 text-neon text-xs font-bold font-mono">
                <span className="size-2 rounded-full bg-neon animate-pulse" />
                <span>{activeStaff} حساب نشط</span>
              </span>
            </h1>
            <p className="text-[11px] text-slate-400 font-medium">
              إدارة حسابات الموظفين، الأدوار الوظيفية، ومصفوفة الصلاحيات الموحدة
            </p>
          </div>
        </div>

        {/* Tab Switcher - Glass Capsule Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-panel/60 backdrop-blur-md border border-panel-border/50">
          {showUsers && (
            <button
              type="button"
              onClick={() => setTab("users")}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                tab === "users"
                  ? "bg-neon/15 text-neon border border-neon/40 shadow-glow-sm"
                  : "text-subtle hover:text-ink hover:bg-white/[0.05]"
              )}
            >
              <Users className="size-3.5" />
              <span>{t("nav.users")}</span>
              <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
                {totalUsers}
              </span>
            </button>
          )}

          {showPerms && (
            <button
              type="button"
              onClick={() => setTab("permissions")}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                tab === "permissions"
                  ? "bg-neon/15 text-neon border border-neon/40 shadow-glow-sm"
                  : "text-subtle hover:text-ink hover:bg-white/[0.05]"
              )}
            >
              <ShieldCheck className="size-3.5" />
              <span>{t("nav.permissions")}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
                126 صلاحية
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Staff KPI Strip (4 KPI cards) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Card 1: Active Staff */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 backdrop-blur-md transition-all duration-200 hover:border-emerald-500/50 hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-subtle">كادر العمل النشط</span>
            <div className="size-6 rounded-lg bg-emerald-500/15 text-emerald-400 grid place-items-center">
              <UserCheck className="size-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabnum font-mono text-2xl font-black text-emerald-400">
              {activeStaff}
            </span>
            <span className="text-[11px] text-subtle">من إجمالي {totalUsers}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400/80">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>حسابات مفعلة بالمنظومة</span>
          </div>
        </div>

        {/* Card 2: Roles Count */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 backdrop-blur-md transition-all duration-200 hover:border-cyan-500/50 hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-subtle">الأدوار الموزعة</span>
            <div className="size-6 rounded-lg bg-cyan-500/15 text-cyan-400 grid place-items-center">
              <ShieldCheck className="size-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabnum font-mono text-2xl font-black text-cyan-400">
              4
            </span>
            <span className="text-[11px] text-subtle">أدوار نظامية ({uniqueRolesCount} مستخدمة)</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-cyan-400/80">
            <Users className="size-3" />
            <span>مالك • مدير • استقبال • مدرب</span>
          </div>
        </div>

        {/* Card 3: Online / Recent Sessions */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 backdrop-blur-md transition-all duration-200 hover:border-violet-500/50 hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-subtle">الجلسات الأخيرة</span>
            <div className="size-6 rounded-lg bg-violet-500/15 text-violet-400 grid place-items-center">
              <Activity className="size-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabnum font-mono text-2xl font-black text-violet-400">
              {onlineSessions}
            </span>
            <span className="text-[11px] text-subtle">نشط مؤخراً</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-violet-400/80">
            <span className="size-1.5 rounded-full bg-violet-400" />
            <span>تسجيل دخول خلال 24 ساعة</span>
          </div>
        </div>

        {/* Card 4: Security Status / Inactive Accounts */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 backdrop-blur-md transition-all duration-200 hover:border-amber-500/50 hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-subtle">حالات الإيقاف والأمان</span>
            <div className="size-6 rounded-lg bg-amber-500/15 text-amber-400 grid place-items-center">
              <KeyRound className="size-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn(
              "tabnum font-mono text-2xl font-black",
              lockedOrInactive > 0 ? "text-amber-400" : "text-emerald-400"
            )}>
              {lockedOrInactive}
            </span>
            <span className="text-[11px] text-subtle">حساب معطل</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400/80">
            <ShieldAlert className="size-3" />
            <span>{lockedOrInactive === 0 ? "كافة الحسابات آمنة ونشطة" : "حسابات موقوفة تتطلب مراجعة"}</span>
          </div>
        </div>
      </div>

      {/* Main Tab Content */}
      {tab === "users" && showUsers && <UsersTab />}
      {tab === "permissions" && showPerms && <PermissionsTab />}
    </div>
  );
}
