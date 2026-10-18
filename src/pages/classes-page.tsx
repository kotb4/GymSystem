import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Trophy,
  CalendarDays,
  CheckCircle2,
  Users,
  Plus,
  Dumbbell,
  Sparkles,
  Coins,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";
import { api } from "@/api";
import { todayKey } from "@/core/dates";
import { Button } from "@/components/ui/button";
import { ClassesTab } from "@/components/classes/classes-tab";
import { ScheduleTab } from "@/components/classes/schedule-tab";
import { TrainersTab } from "@/components/classes/trainers-tab";
import { PlansTab } from "@/components/classes/plans-tab";
import { ClassProfitsTab } from "@/components/classes/class-profits-tab";
import { PageHeader } from "@/components/ui/page-header";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";

export function ClassesPage({ initialTab }: { initialTab?: string } = {}) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const canClasses = hasPermission("classes.view");
  const canTrainers = hasPermission("trainers.view");
  const canManagePlans = hasPermission("plans.create") || hasPermission("classes.manage");
  const [tab, setTab] = useState(initialTab ?? (canTrainers ? "trainers" : "classes"));
  const [createPlanOpen, setCreatePlanOpen] = useState(false);

  const [metrics, setMetrics] = useState({
    totalClasses: 0,
    todaySessions: 0,
    consumesSessions: 0,
    totalCapacity: 0,
  });

  const reloadMetrics = useCallback(() => {
    if (!canClasses) return;
    Promise.all([
      api.classes.list({}),
      api.classes.listSessions({ fromDate: todayKey(), toDate: todayKey(), status: "all", limit: 150 }),
    ])
      .then(([classes, sessions]) => {
        setMetrics({
          totalClasses: classes.length,
          todaySessions: sessions.length,
          consumesSessions: classes.filter((c) => c.consumesSession).length,
          totalCapacity: classes.reduce((sum, c) => sum + (c.capacity || 0), 0),
        });
      })
      .catch(console.error);
  }, [canClasses]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab") || initialTab;
    if (requestedTab && ["trainers", "schedule", "classes", "profits", "plans"].includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [searchParams, initialTab]);

  useEffect(() => {
    reloadMetrics();
  }, [reloadMetrics, tab]);

  const onTabChange = (val: string) => {
    setTab(val);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", val);
      return next;
    });
  };

  const items = useMemo(() => {
    const list: Array<{ value: string; label: string; icon: any; badge?: string | number }> = [];
    if (canTrainers) {
      list.push({ value: "trainers", label: "المدربون ومستحقاتهم", icon: Dumbbell });
    }
    if (canClasses) {
      list.push({ value: "schedule", label: "جدول المواعيد الأسبوعي", icon: CalendarDays, badge: metrics.todaySessions ? `${metrics.todaySessions} اليوم` : undefined });
      list.push({ value: "classes", label: "سجل الحضور والكشوفات", icon: Users, badge: metrics.totalClasses || undefined });
      list.push({ value: "profits", label: "التقارير المالية والأرباح", icon: Coins });
    }
    if (tab === "plans") {
      list.push({ value: "plans", label: t("cls.tabMemberPlans"), icon: Sparkles });
    }
    return list;
  }, [canClasses, canTrainers, metrics, tab, t]);

  const active = items.some((i) => i.value === tab) ? tab : items[0]?.value ?? "trainers";

  return (
    <div className="space-y-5">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={Trophy}
        title="منظومة الأكاديميات والحصص والتمارين الجماعية"
        subtitle="إدارة الحصص القتالية واللياقة، جداول المواعيد الأسبوعية، كشوفات الحضور الفورية، وأرباح ومستحقات المدربين"
        actions={
          canManagePlans && (
            <Button
              size="sm"
              onClick={() => setCreatePlanOpen(true)}
              className="bg-primary text-white font-bold shadow-glow-sm gap-1.5 text-xs"
            >
              <Plus className="size-4" />
              <span>إضافة باقة أكاديمية جديدة</span>
            </Button>
          )
        }
      />

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => onTabChange("classes")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            active === "classes"
              ? "border-amber-500/60 bg-amber-500/10 shadow-sm shadow-amber-500/10"
              : "border-amber-500/15 bg-gradient-to-br from-panel to-amber-500/5 hover:border-amber-500/30",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">إجمالي الأكاديميات</span>
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-400">
              <Trophy className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white tabnum">{metrics.totalClasses}</span>
            <span className="text-[10px] text-faint">نشاط مسجل</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("schedule")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            active === "schedule"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-neon/20 bg-gradient-to-br from-panel to-neon/5 hover:border-neon/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">حصص اليوم المجدولة</span>
            <span className="grid size-7 place-items-center rounded-lg bg-neon/15 text-neon">
              <CalendarDays className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-neon tabnum">{metrics.todaySessions}</span>
            <span className="text-[10px] text-faint">جلسة اليوم</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("classes")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            "border-emerald-500/15 bg-gradient-to-br from-panel to-emerald-500/5 hover:border-emerald-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">تستهلك رصيد اشتراكات</span>
            <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white tabnum">{metrics.consumesSessions}</span>
            <span className="text-[10px] text-faint">حصة مرتبطة</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("schedule")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            "border-cyan-500/15 bg-gradient-to-br from-panel to-cyan-500/5 hover:border-cyan-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">السعة الاستيعابية</span>
            <span className="grid size-7 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Users className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white tabnum">{metrics.totalCapacity}</span>
            <span className="text-[10px] text-faint">متدرب كحد أقصى</span>
          </div>
        </button>
      </div>

      {/* Glass Capsule Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-panel/70 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {items.map((item) => {
          const isActive = active === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onTabChange(item.value)}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-amber-500/20 via-amber-500/15 to-transparent text-white border border-amber-500/50 shadow-md shadow-amber-500/10"
                  : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-amber-400" : "text-subtle",
                )}
              />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className="ms-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {active === "trainers" ? (
        <TrainersTab />
      ) : active === "schedule" ? (
        <ScheduleTab />
      ) : active === "profits" ? (
        <ClassProfitsTab />
      ) : active === "plans" ? (
        <PlansTab />
      ) : (
        <ClassesTab />
      )}

      {createPlanOpen && (
        <PlanFormModal
          open={createPlanOpen}
          defaultCategory="academy"
          onClose={() => setCreatePlanOpen(false)}
          onSaved={() => {
            setCreatePlanOpen(false);
            reloadMetrics();
          }}
        />
      )}
    </div>
  );
}