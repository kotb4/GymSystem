import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dumbbell, Plus, CalendarCheck } from "lucide-react";
import type { PlanWithNames } from "@/core/services/training-plans.service";
import { TrainingPlanFormModal } from "../modals/training-plan-form-modal";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function PtClassesTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanWithNames[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; sessionId: string; sessionDate: string | null; className: string; status: string }>>([]);
  const [formOpen, setFormOpen] = useState(false);
  const canView = hasPermission("members.view");
  const canManage = hasPermission("training.manage");
  const canClasses = hasPermission("classes.view");

  const reload = useCallback(() => {
    if (!canView) return;
    let alive = true;
    api.trainingPlans
      .list({ memberId: ctx.member.id, limit: 50 } as never)
      .then((res) => {
        if (alive) setPlans(res.items as unknown as PlanWithNames[]);
      })
      .catch((err) => console.error(err));
    if (canClasses) {
      api.classes
        .listMemberBookings(ctx.member.id, 30)
        .then((rows) => {
          if (!alive) return;
          const typed = rows as Array<{ id: string; sessionId: string; status: string }>;
          setClasses(
            typed.map((b) => ({
              id: b.id,
              sessionId: b.sessionId,
              sessionDate: null,
              className: b.sessionId.slice(0, 8),
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
          <EmptyState icon={<Dumbbell />} title={t("trainers.plansEmptyTitle")} description={t("trainers.plansEmptyDesc")} />
        ) : (
          <ul className="divide-y divide-line px-5 pb-4">
            {plans.map((plan) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{plan.trainerName}</span>
                  <span dir="ltr" className="block text-[11px] tabnum text-faint">
                    {plan.startDate} → {plan.endDate}
                  </span>
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
      {canClasses && (
        <Card>
          <CardHeader title={t("members.ptClassesTitle")} />
          {classes.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title={t("members.ptClassesEmpty")} />
          ) : (
            <ul className="divide-y divide-line px-5 pb-4">
              {classes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span dir="ltr" className="tabnum text-subtle font-mono">{c.sessionId.slice(0, 12)}</span>
                  <Badge variant={c.status === "attended" ? "success" : c.status === "cancelled" ? "neutral" : "info"}>
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
