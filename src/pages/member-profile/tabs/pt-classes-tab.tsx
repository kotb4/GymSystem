import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PrivateTrainingRow } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DateRange } from "@/components/ui/date-range";
import { Dumbbell, Plus, CalendarCheck, Flame, Clock } from "lucide-react";
import type { PlanWithNames } from "@/core/services/training-plans.service";
import { TrainingPlanFormModal } from "../modals/training-plan-form-modal";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";
import { formatMinor } from "@/core/money";
import { formatTime } from "@/services/format";

export function PtClassesTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanWithNames[]>([]);
  const [ptTrainings, setPtTrainings] = useState<PrivateTrainingRow[]>([]);
  const [classes, setClasses] = useState<
    Array<{
      id: string;
      sessionId: string;
      sessionDate: string | null;
      sessionStartTime: string | null;
      className: string;
      status: string;
    }>
  >([]);
  const [formOpen, setFormOpen] = useState(false);
  const canView = hasPermission("members.view");
  const canManage = hasPermission("training.manage");
  const canClasses = hasPermission("classes.view");

  const reload = useCallback(() => {
    if (!canView) return;
    let alive = true;

    // 1. Custom training plans
    api.trainingPlans
      .list({ memberId: ctx.member.id, limit: 50 } as never)
      .then((res) => {
        if (alive) setPlans(res.items as unknown as PlanWithNames[]);
      })
      .catch((err) => console.error(err));

    // 2. Real private training packages (PT)
    api.privateTraining
      .listTrainings({ memberId: ctx.member.id, limit: 50 })
      .then((res) => {
        if (alive) setPtTrainings(res.items);
      })
      .catch(() => undefined);

    // 3. Class bookings with joined class details
    if (canClasses) {
      api.classes
        .listMemberBookings(ctx.member.id, 50)
        .then((rows) => {
          if (!alive) return;
          const typed = rows as Array<{
            id: string;
            sessionId: string;
            sessionDate?: string | null;
            sessionStartTime?: string | null;
            className?: string | null;
            status: string;
          }>;
          setClasses(
            typed.map((b) => ({
              id: b.id,
              sessionId: b.sessionId,
              sessionDate: b.sessionDate ?? null,
              sessionStartTime: b.sessionStartTime ?? null,
              className: b.className || "حصة تدريبية",
              status: b.status,
            })),
          );
        })
        .catch(() => undefined);
    }

    return () => {
      alive = false;
    };
  }, [canView, canClasses, ctx.member.id]);

  useEffect(() => {
    reload();
  }, [reload, ctx.reloadTick]);

  if (!canView) {
    return permissionDeniedNode(t);
  }

  const onTransition = async (planId: string, kind: "end" | "cancel") => {
    try {
      if (kind === "end") await api.trainingPlans.end(planId);
      else await api.trainingPlans.cancel(planId);
      toast("success", t("trainers.planStatusToast"));
      reload();
      ctx.reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Real Private Training Packages (PT) */}
      <Card>
        <CardHeader title="اشتراكات التدريب الخاص (Private Training - PT)" />
        {ptTrainings.length === 0 ? (
          <EmptyState
            icon={<Flame className="size-8 text-subtle" />}
            title="لا توجد اشتراكات تدريب خاص"
            description="لم يتم تسجيل أي باقات تدريب خاص (PT) لهذا المتدرب بعد."
          />
        ) : (
          <ul className="divide-y divide-line px-5 pb-4">
            {ptTrainings.map((pt) => {
              const percent =
                pt.total_sessions > 0
                  ? Math.min(100, Math.round((pt.completed_sessions / pt.total_sessions) * 100))
                  : 0;
              return (
                <li key={pt.id} className="py-3.5 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Flame className="size-4 text-amber-400" />
                      <span className="font-bold text-foreground">
                        {pt.package_name || "باقة تدريب خاص"}
                      </span>
                      <span className="text-xs text-subtle">
                        (كابتن / {pt.trainer_name})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {pt.remaining_amount_minor > 0 && (
                        <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          متبقي: {formatMinor(pt.remaining_amount_minor)}
                        </span>
                      )}
                      <Badge
                        variant={
                          pt.status === "active"
                            ? "success"
                            : pt.status === "completed"
                            ? "info"
                            : pt.status === "cancelled"
                            ? "neutral"
                            : "danger"
                        }
                      >
                        {pt.status === "active"
                          ? "نشط"
                          : pt.status === "completed"
                          ? "مكتمل"
                          : pt.status === "cancelled"
                          ? "ملغي"
                          : "منتهي"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-subtle">
                    <div className="flex items-center gap-2">
                      <span>
                        الحصص المنفذة: <strong className="text-foreground font-mono">{pt.completed_sessions}</strong> من{" "}
                        <strong className="text-foreground font-mono">{pt.total_sessions}</strong>
                      </span>
                      <span className="text-faint font-mono">({percent}%)</span>
                    </div>
                    <div className="font-mono text-faint">
                      <span>{pt.start_date}</span>
                      <span className="mx-1">←</span>
                      <span>{pt.end_date}</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 2. Group Class Bookings with joined details & 12h time */}
      {canClasses && (
        <Card>
          <CardHeader title={t("members.ptClassesTitle")} />
          {classes.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title={t("members.ptClassesEmpty")} />
          ) : (
            <ul className="divide-y divide-line px-5 pb-4">
              {classes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="space-y-0.5">
                    <span className="block font-bold text-foreground">{c.className}</span>
                    <div className="flex items-center gap-2 text-xs text-subtle font-mono">
                      {c.sessionDate && <span>{c.sessionDate}</span>}
                      {c.sessionStartTime && (
                        <span className="flex items-center gap-1 text-primary">
                          <Clock className="size-3" />
                          {formatTime(c.sessionStartTime)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={
                      c.status === "attended"
                        ? "success"
                        : c.status === "cancelled"
                        ? "neutral"
                        : c.status === "no_show"
                        ? "danger"
                        : "info"
                    }
                  >
                    {c.status === "attended"
                      ? "حاضر"
                      : c.status === "cancelled"
                      ? "ملغي"
                      : c.status === "no_show"
                      ? "غياب"
                      : "محجوز"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 3. Custom Training Plans */}
      <Card>
        <CardHeader
          title={t("members.tabTraining")}
          action={
            canManage && ctx.member.status !== "archived" ? (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" />
                {t("trainers.planAdd")}
              </Button>
            ) : undefined
          }
        />
        {plans.length === 0 ? (
          <EmptyState
            icon={<Dumbbell />}
            title={t("trainers.plansEmptyTitle")}
            description={t("trainers.plansEmptyDesc")}
          />
        ) : (
          <ul className="divide-y divide-line px-5 pb-4">
            {plans.map((plan) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{plan.trainerName}</span>
                  <DateRange start={plan.startDate} end={plan.endDate} className="text-[11px] text-faint" />
                </span>
                {plan.notes && (
                  <span className="max-w-xs truncate rounded-lg bg-surface px-2.5 py-1 text-[12px] text-subtle">
                    {plan.notes}
                  </span>
                )}
                <Badge
                  variant={plan.status === "active" ? "success" : plan.status === "ended" ? "info" : "neutral"}
                >
                  {t(`trainers.plan_${plan.status}`)}
                </Badge>
                {canManage && plan.status === "active" && (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => void onTransition(plan.id, "end")}>
                      {t("trainers.planEnd")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void onTransition(plan.id, "cancel")}>
                      {t("common.cancel")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <TrainingPlanFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          member={ctx.member}
          onSaved={() => {
            setFormOpen(false);
            reload();
            ctx.reload();
          }}
        />
      </Card>
    </div>
  );
}
