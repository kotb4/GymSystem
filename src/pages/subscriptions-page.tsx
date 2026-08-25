import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarPlus, CalendarX2, CreditCard, PauseCircle, PlayCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { appConfig } from "@/config/app.config";
import { api, type Plan, type SubscriptionWithMember } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatMinor } from "@/core/money";

import { formatDateShort, formatNumber } from "@/services/format";
import { subStatusMeta } from "@/utils/status-meta";
import { Card, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";

const EFFECTIVE_OPTIONS = ["all", "active", "upcoming", "expired", "suspended", "cancelled"] as const;

export function SubscriptionsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState("subs");
  const [effective, setEffective] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: SubscriptionWithMember[]; total: number }>({ items: [], total: 0 });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SubscriptionWithMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.subscriptions
      .list({
        page,
        pageSize: appConfig.pageSize,
        effective: effective as (typeof EFFECTIVE_OPTIONS)[number],
      })
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, effective, page, reloadTick]);

  const reloadPlans = useCallback(() => {
    if (!actor) return;
    api.plans
      .list(hasPermission("plans.edit"))
      .then(setPlans)
      .catch((err) => console.error(err));
  }, [actor, hasPermission]);

  useEffect(() => {
    reloadPlans();
  }, [reloadPlans]);

  useEffect(() => {
    if (searchParams.get("add") === "1" && hasPermission("subscriptions.create")) {
      setSubModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, hasPermission, setSearchParams]);

  const onCancelConfirm = async () => {
    if (!actor || !cancelTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.setStatus(cancelTarget.id, "cancelled");
      toast("success", t("subs.cancelledToast"));
      setCancelTarget(null);
      reload();
      setPage(1);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onSuspendToggle = async (sub: SubscriptionWithMember) => {
    if (!actor) return;
    const next = sub.status === "suspended" ? "active" : "suspended";
    try {
      await api.subscriptions.setStatus(sub.id, next);
      toast("success", next === "suspended" ? t("subs.suspendedToast") : t("subs.resumedToast"));
      reload();
      setPage(1);
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  interface Row {
    id: string;
    memberId: string;
    memberName: string;
    memberCode: string;
    planName: string;
    startDate: string;
    endDate: string;
    price: number;
    remainingMinor: number;
    effective: Parameters<typeof subStatusMeta>[1];
    status: SubscriptionWithMember["status"];
  }

  // outstanding balances are fetched per subscription through the backend
  const [balances, setBalances] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!actor || !hasPermission("payments.view") || data.items.length === 0) return;
    let alive = true;
    void (async () => {
      const next: Record<string, number> = {};
      for (const s of data.items) {
        try {
          next[s.id] = (await api.payments.subscriptionBalance(s.id)).remainingMinor;
        } catch {
          /* leave 0 */
        }
      }
      if (alive) setBalances(next);
    })();
    return () => {
      alive = false;
    };
  }, [actor, data.items, hasPermission]);

  const rows: Row[] = data.items.map((s) => ({
    id: s.id,
    memberId: s.memberId,
    memberName: s.memberName,
    memberCode: s.memberCode,
    planName: s.planName ?? "—",
    startDate: s.startDate,
    endDate: s.endDate,
    price: s.price,
    remainingMinor: balances[s.id] ?? 0,
    effective: s.effectiveStatus,
    status: s.status,
  }));

  const columns: Column<Row>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (row) => (
        <button
          type="button"
          onClick={() => navigate(`/members/${row.memberId}`)}
          className="flex items-center gap-2.5 text-start"
        >
          <Avatar name={row.memberName} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-bold hover:text-neon">{row.memberName}</span>
            <span dir="ltr" className="block text-[11px] text-faint tabnum">
              {row.memberCode}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: "plan",
      header: t("subs.planCol"),
      render: (row) => <span className="font-semibold">{row.planName}</span>,
    },
    {
      key: "period",
      header: t("subs.period"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(parseDateKey(row.startDate))} ← {formatDateShort(parseDateKey(row.endDate))}
        </span>
      ),
    },
    {
      key: "price",
      header: t("subs.pricePaid"),
      render: (row) => <span className="font-extrabold tabnum text-neon">{formatNumber(row.price)}</span>,
    },
    ...(hasPermission("payments.view")
      ? [
          {
            key: "balance",
            header: t("subs.balanceDue"),
            align: "end" as const,
            render: (row: Row) =>
              row.remainingMinor > 0 ? (
                <span className="font-bold tabnum text-amber">{formatMinor(row.remainingMinor)}</span>
              ) : (
                <span className="text-faint tabnum">0</span>
              ),
          },
        ]
      : []),
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = subStatusMeta(t, row.effective);
        return (
          <Badge variant={meta.variant} dot>
            {meta.label}
          </Badge>
        );
      },
    },
  ];

  if (hasPermission("subscriptions.cancel") || hasPermission("subscriptions.edit")) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {hasPermission("subscriptions.edit") && row.status !== "cancelled" && (
            <button
              type="button"
              aria-label={row.status === "suspended" ? t("subs.resumeSub") : t("subs.suspendSub")}
              onClick={() => {
                const sub = data.items.find((s) => s.id === row.id);
                if (sub) void onSuspendToggle(sub);
              }}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
            >
              {row.status === "suspended" ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
            </button>
          )}
          {hasPermission("subscriptions.cancel") && row.status === "active" && (
            <button
              type="button"
              aria-label={t("subs.cancelSub")}
              onClick={() => setCancelTarget(findSub(row.id))}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-red/10 hover:text-red"
            >
              <CalendarX2 className="size-4" />
            </button>
          )}
        </div>
      ),
    });
  }

  const findSub = (id: string): SubscriptionWithMember | null =>
    data.items.find((s) => s.id === id) ?? null;

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "subs", label: t("subs.tabSubs") },
          { value: "plans", label: t("plans.tabPlans") },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "subs" ? (
        <Card>
          <CardHeader
            title={t("nav.subscriptions")}
            action={
              hasPermission("subscriptions.create") ? (
                <Button onClick={() => setSubModalOpen(true)}>
                  <CalendarPlus className="size-4" />
                  {t("subs.addSubscription")}
                </Button>
              ) : undefined
            }
          />
          <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
            <div className="sm:w-52">
              <Select
                value={effective}
                onChange={(e) => {
                  setEffective(e.target.value);
                  setPage(1);
                }}
                options={EFFECTIVE_OPTIONS.map((s) => ({
                  value: s,
                  label: s === "all" ? t("common.all") : t(`status.${s}`),
                }))}
              />
            </div>
            <p className="text-xs font-semibold text-faint tabnum sm:ms-auto">
              {formatNumber(data.total)}
            </p>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<CalendarPlus />} title={t("subs.empty")} />
          ) : (
            <>
              <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
              <div className="border-t border-line px-5 py-3.5">
                <Pagination
                  page={page}
                  pageSize={appConfig.pageSize}
                  total={data.total}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </Card>
      ) : (
        <PlansGrid
          plans={plans}
          canCreate={hasPermission("plans.create")}
          canEdit={hasPermission("plans.edit")}
          onAdd={() => {
            setEditPlan(null);
            setPlanModalOpen(true);
          }}
          onEdit={(plan) => {
            setEditPlan(plan);
            setPlanModalOpen(true);
          }}
        />
      )}

      <SubscriptionFormModal open={subModalOpen} onClose={() => setSubModalOpen(false)} onSaved={reload} />
      <PlanFormModal open={planModalOpen} onClose={() => setPlanModalOpen(false)} onSaved={reloadPlans} plan={editPlan} />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t("subs.cancelSub")}
        message={t("subs.cancelMsg")}
        loading={busy}
        onConfirm={onCancelConfirm}
      />
    </div>
  );
}

function PlansGrid({
  plans,
  canCreate,
  canEdit,
  onAdd,
  onEdit,
}: {
  plans: Plan[];
  canCreate: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (plan: Plan) => void;
}) {
  const t = useT();

  return (
    <Card>
      <CardHeader
        title={t("plans.tabPlans")}
        action={
          canCreate ? (
            <Button onClick={onAdd}>
              <CreditCard className="size-4" />
              {t("plans.addPlan")}
            </Button>
          ) : undefined
        }
      />
      {plans.length === 0 ? (
        <EmptyState icon={<CreditCard />} title={t("plans.empty")} />
      ) : (
        <div className="grid gap-3.5 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="group relative flex flex-col rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-neon/40"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold">{plan.name}</p>
                {!plan.isActive && (
                  <Badge variant="neutral">{t("plans.inactive")}</Badge>
                )}
              </div>
              <p dir="ltr" className="mt-2 text-2xl font-extrabold tabnum text-neon">
                {formatNumber(plan.price)}
              </p>
              <p className="text-[11px] text-faint">
                {plan.durationDays} {t("common.days")}
              </p>
              {plan.description && (
                <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-subtle">{plan.description}</p>
              )}
              {canEdit && (
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onEdit(plan)}>
                  {t("common.edit")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
