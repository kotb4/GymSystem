import { useCallback, useEffect, useState } from "react";
import { Dumbbell, Flame, UserCheck, Users, UsersRound } from "lucide-react";
import { useT } from "@/i18n";
import { api } from "@/api";
import { StatCard } from "@/components/ui/stat-card";
import { TrainersTab } from "@/components/classes/trainers-tab";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";

export function TrainersPage() {
  const t = useT();

  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    presentNow: 0,
    ptPlans: 0,
    classesCount: 0,
  });

  const reloadStats = useCallback(() => {
    Promise.all([
      api.trainers.list(),
      api.classes.list({}),
    ])
      .then(([trainersList, classesList]) => {
        const activeTrainers = trainersList.filter((tr) => tr.isActive).length;
        const totalPtPlans = trainersList.reduce(
          (sum, tr) => sum + ((tr as unknown as { activePlans?: number }).activePlans ?? 0),
          0,
        );

        const now = new Date();
        const currentDayOfWeek = now.getDay();
        const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

        const presentNow = trainersList.filter((tr) => {
          if (!tr.isActive) return false;
          const schedule = (tr as any).workingSchedule as any[] | null;
          if (!schedule || !Array.isArray(schedule)) return false;
          const todaySlot = schedule.find((s) => s.dayOfWeek === currentDayOfWeek);
          if (!todaySlot || !todaySlot.isActive) return false;
          if (!todaySlot.startTime || !todaySlot.endTime) return true;
          return currentTime >= todaySlot.startTime && currentTime <= todaySlot.endTime;
        }).length;

        setStats({
          total: trainersList.length,
          active: activeTrainers,
          presentNow,
          ptPlans: totalPtPlans,
          classesCount: classesList.length,
        });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    reloadStats();
  }, [reloadStats]);

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={UsersRound}
        title={t("trainers.pageTitle")}
        subtitle={t("trainers.pageSub")}
        badge={
          <Badge variant="neutral" className="font-mono text-xs">
            {stats.active} نشط من {stats.total}
          </Badge>
        }
      />

      {/* Quick KPI Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="size-5 text-neon" />}
          accent="neon"
          title={t("trainers.totalTrainers")}
          value={String(stats.total)}
          subtitle={`${stats.active} ${t("status.active")}`}
        />
        <StatCard
          icon={<UserCheck className="size-5 text-emerald-400" />}
          accent="emerald"
          title="متواجدون بالصالة الآن 🟢"
          value={String(stats.presentNow)}
          subtitle={`${stats.active} مدرب نشط`}
        />
        <StatCard
          icon={<Flame className="size-5 text-amber-400" />}
          accent="amber"
          title={t("trainers.ptSubscriptions")}
          value={String(stats.ptPlans)}
          subtitle={t("trainers.privateClients")}
        />
        <StatCard
          icon={<Dumbbell className="size-5 text-cyan-400" />}
          accent="cyan"
          title={t("trainers.groupClasses")}
          value={String(stats.classesCount)}
          subtitle={t("trainers.activeSchedules")}
        />
      </div>

      {/* Main Trainers Management Table */}
      <TrainersTab onTrainerChanged={reloadStats} />
    </div>
  );
}
