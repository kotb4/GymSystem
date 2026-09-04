import { useCallback, useEffect, useState } from "react";
import { Dumbbell, MoreHorizontal, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PlanWithNames } from "@/api";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";

export function PlansTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trainers.manage");

  const [plans, setPlans] = useState<PlanWithNames[]>([]);
  const [planAction, setPlanAction] = useState<{ plan: PlanWithNames; kind: "end" | "cancel" } | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<PlanWithNames | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!actor || !hasPermission("trainers.view")) return;
    let alive = true;
    api.trainingPlans
      .list({ limit: 100 })
      .then((r) => {
        if (alive) setPlans(r.items as unknown as PlanWithNames[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, hasPermission]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onPlanTransition = async () => {
    if (!actor || !planAction) return;
    setBusy(true);
    try {
      if (planAction.kind === "end") {
        await api.trainingPlans.end(planAction.plan.id);
      } else {
        await api.trainingPlans.cancel(planAction.plan.id);
      }
      toast("success", t("trainers.planStatusToast"));
      setPlanAction(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PlanWithNames>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (row) => (
        <span>
          <span className="block font-bold">{row.memberName}</span>
          <span dir="ltr" className="block text-[11px] text-faint">{row.memberCode}</span>
        </span>
      ),
    },
    {
      key: "trainer",
      header: t("nav.trainers"),
      render: (row) => <span className="text-subtle">{row.trainerName}</span>,
    },
    {
      key: "range",
      header: t("trainers.planRange"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.startDate} → {row.endDate}
        </span>
      ),
    },
    {
      key: "status",
      header: t("status.title"),
      render: (row) => (
        <Badge
          variant={
            row.status === "active" ? "success" : row.status === "ended" ? "info" : "neutral"
          }
        >
          {t(`trainers.plan_${row.status}`)}
        </Badge>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) =>
        row.status === "active" ? (
          <Dropdown
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("common.actions")}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            <DropdownItem
              label={t("trainers.planEnd")}
              onClick={() => setPlanAction({ plan: row, kind: "end" })}
            />
            <DropdownDivider />
            <DropdownItem
              label={t("trainers.planCancel")}
              danger
              onClick={() => setPlanAction({ plan: row, kind: "cancel" })}
            />
          </Dropdown>
        ) : (row.status === "cancelled" || row.status === "ended") && row.endDate >= todayKey() ? (
          <button
            type="button"
            aria-label={t("trainers.planReactivate")}
            onClick={() => setReactivateTarget(row)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
          >
            <RotateCcw className="size-4" />
          </button>
        ) : null,
    });
  }

  return (
    <Card>
      <CardHeader title={t("cls.tabMemberPlans")} />
      {plans.length === 0 ? (
        <EmptyState
          icon={<Dumbbell />}
          title={t("trainers.plansEmptyTitle")}
          description={t("trainers.plansEmptyDesc")}
        />
      ) : (
        <DataTable columns={columns} data={plans} rowKey={(r) => r.id} />
      )}

      <ConfirmDialog
        open={planAction !== null}
        onClose={() => setPlanAction(null)}
        onConfirm={() => void onPlanTransition()}
        title={t(
          planAction?.kind === "end" ? "trainers.planEndTitle" : "trainers.planCancelTitle",
        )}
        message={t(
          planAction?.kind === "end" ? "trainers.planEndMessage" : "trainers.planCancelMessage",
          { member: planAction?.plan.memberName ?? "" },
        )}
        confirmLabel={t(planAction?.kind === "end" ? "trainers.planEnd" : "trainers.planCancel")}
        loading={busy}
        tone={planAction?.kind === "cancel" ? "danger" : "primary"}
      />

      <ConfirmDialog
        open={reactivateTarget !== null}
        onClose={() => setReactivateTarget(null)}
        onConfirm={async () => {
          if (!actor || !reactivateTarget) return;
          setBusy(true);
          try {
            await api.trainingPlans.reactivate(reactivateTarget.id);
            toast("success", t("trainers.planReactivatedToast"));
            setReactivateTarget(null);
            reload();
          } catch (err) {
            toast("error", describeError(err, t));
          } finally {
            setBusy(false);
          }
        }}
        title={t("trainers.planReactivate")}
        message={t("trainers.planReactivateConfirmMsg")}
        confirmLabel={t("trainers.planReactivate")}
        loading={busy}
      />
    </Card>
  );
}