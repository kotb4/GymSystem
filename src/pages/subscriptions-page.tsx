import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarPlus, CalendarX2, CreditCard, Info, PauseCircle, PlayCircle, RotateCcw, Snowflake, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { appConfig } from "@/config/app.config";
import { api, type Plan, type SubscriptionWithMember, type FreezeInfo } from "@/api";
import { parseDateKey, diffDaysKeys, todayKey } from "@/core/dates";
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
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";
import { FreezeSubscriptionModal } from "@/components/subscriptions/freeze-subscription-modal";
import { PackagesPage } from "@/pages/packages-page";

const EFFECTIVE_OPTIONS = ["all", "active", "upcoming", "expired", "suspended", "frozen", "cancelled"] as const;

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
  const [undoCancelTarget, setUndoCancelTarget] = useState<SubscriptionWithMember | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<SubscriptionWithMember | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<SubscriptionWithMember | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<SubscriptionWithMember | null>(null);
  const [freezeHistory, setFreezeHistory] = useState<FreezeInfo[]>([]);
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

  const onPurgeConfirm = async () => {
    if (!actor || !purgeTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.purge(purgeTarget.id);
      toast("success", t("subs.purgedToast"));
      setPurgeTarget(null);
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
    discountMinor: number;
    paidMinor: number;
    effective: Parameters<typeof subStatusMeta>[1];
    status: SubscriptionWithMember["status"];
    totalDays: number;
    remainingDays: number;
    frozenDays: number;
    subscription: SubscriptionWithMember;
  }

  const [balances, setBalances] = useState<Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }>>({});
  useEffect(() => {
    if (!actor || !hasPermission("payments.view") || data.items.length === 0) return;
    let alive = true;
    void (async () => {
      const next: Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }> = {};
      for (const s of data.items) {
        try {
          const b = await api.payments.subscriptionBalance(s.id);
          next[s.id] = { paidMinor: b.paidMinor, discountedMinor: b.discountedMinor, remainingMinor: b.remainingMinor };
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

  useEffect(() => {
    if (!detailsTarget) { setFreezeHistory([]); return; }
    let alive = true;
    api.subscriptions.freezes(detailsTarget.id).then((rows) => { if (alive) setFreezeHistory(rows); }).catch(() => { if (alive) setFreezeHistory([]); });
    return () => { alive = false; };
  }, [detailsTarget]);

  const today = todayKey();
  const rows: Row[] = data.items.map((s) => {
    const totalDays = s.startDate && s.endDate ? diffDaysKeys(s.startDate, s.endDate) + 1 : 0;
    const eff = s.effectiveStatus;
    const remainingDays = eff === "active" && s.endDate
      ? Math.max(0, diffDaysKeys(today, s.endDate) + 1)
      : eff === "expired" ? 0 : totalDays;
    return {
      id: s.id,
      memberId: s.memberId,
      memberName: s.memberName,
      memberCode: s.memberCode,
      planName: s.planName ?? "—",
      startDate: s.startDate,
      endDate: s.endDate,
      price: s.price,
      remainingMinor: balances[s.id]?.remainingMinor ?? 0,
      discountMinor: balances[s.id]?.discountedMinor ?? 0,
      paidMinor: balances[s.id]?.paidMinor ?? 0,
      effective: eff,
      status: s.status,
      totalDays,
      remainingDays,
      frozenDays: s.frozenDays,
      subscription: s,
    };
  });

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
          {row.startDate ? formatDateShort(parseDateKey(row.startDate)) : "—"}
          {" ← "}
          {row.endDate ? formatDateShort(parseDateKey(row.endDate)) : "—"}
        </span>
      ),
    },
    {
      key: "price",
      header: t("subs.pricePaid"),
      render: (row) => <span className="font-extrabold tabnum text-neon">{formatNumber(row.price)}</span>,
    },
    {
      key: "totalDays",
      header: t("subs.totalDays"),
      render: (row) => <span className="tabnum text-subtle">{row.totalDays} {t("subs.daysUnit")}</span>,
    },
    {
      key: "remainingDays",
      header: t("subs.remainingDays"),
      render: (row) => {
        if (row.effective === "expired" || row.effective === "cancelled") {
          return <span className="text-faint tabnum">—</span>;
        }
        const color = row.remainingDays <= 7 ? "text-red" : row.remainingDays <= 14 ? "text-amber" : "text-neon";
        return <span className={`font-bold tabnum ${color}`}>{row.remainingDays} {t("subs.daysUnit")}</span>;
      },
    },
    ...(hasPermission("payments.view")
      ? [
          {
            key: "discount" as const,
            header: t("subs.discount"),
            align: "end" as const,
            render: (row: Row) =>
              row.discountMinor > 0 ? (
                <span className="font-bold tabnum text-amber">{formatMinor(row.discountMinor)}</span>
              ) : (
                <span className="text-faint tabnum">—</span>
              ),
          },
          {
            key: "paid" as const,
            header: t("subs.paidAmount"),
            align: "end" as const,
            render: (row: Row) => (
              <span className="tabnum text-subtle">{formatMinor(row.paidMinor)}</span>
            ),
          },
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
          {
            key: "frozenDays" as const,
            header: t("subs.frozenDaysCount"),
            align: "end" as const,
            render: (row: Row) =>
              row.frozenDays > 0 ? (
                <span className="tabnum text-cyan flex items-center gap-1 justify-end">
                  {row.frozenDays} {t("subs.daysUnit")}
                  <Snowflake className="size-3" />
                </span>
              ) : (
                <span className="text-faint tabnum">—</span>
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

  columns.push({
    key: "actions",
    header: t("common.actions"),
    align: "end",
    render: (row) => (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label={t("subs.details")}
          onClick={() => setDetailsTarget(findSub(row.id))}
          className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
          title={t("subs.details")}
        >
          <Info className="size-4" />
        </button>
        {hasPermission("subscriptions.edit") && row.effective === "frozen" && (
          <button
            type="button"
            aria-label={t("subs.unfreeze")}
            onClick={() => {
              const sub = data.items.find((s) => s.id === row.id);
              if (sub) void api.subscriptions.unfreeze(sub.id).then(() => { toast("success", t("subs.unfrozenToast")); reload(); setPage(1); }).catch((err) => toast("error", describeError(err, t)));
            }}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
            title={t("subs.unfreeze")}
          >
            <PlayCircle className="size-4" />
          </button>
        )}
        {hasPermission("subscriptions.edit") && row.effective === "suspended" && (
          <button
            type="button"
            aria-label={t("subs.resumeSub")}
            onClick={() => {
              const sub = data.items.find((s) => s.id === row.id);
              if (sub) void onSuspendToggle(sub);
            }}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
          >
            <PlayCircle className="size-4" />
          </button>
        )}
        {hasPermission("subscriptions.edit") && row.effective === "active" && (
          <button
            type="button"
            aria-label={t("subs.suspendSub")}
            onClick={() => {
              const sub = data.items.find((s) => s.id === row.id);
              if (sub) void onSuspendToggle(sub);
            }}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
          >
            <PauseCircle className="size-4" />
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
        {hasPermission("subscriptions.freeze") && row.status === "active" && (
          <button
            type="button"
            aria-label={t("subs.freeze")}
            onClick={() => { const sub = findSub(row.id); if (sub) setFreezeTarget(sub); }}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
            title={t("subs.freeze")}
          >
            <Snowflake className="size-4" />
          </button>
        )}
          {hasPermission("subscriptions.purge") && (
            <button
              type="button"
              aria-label={t("subs.purgeAction")}
              onClick={() => setPurgeTarget(findSub(row.id))}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-red/10 hover:text-red"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {hasPermission("subscriptions.cancel") && row.status === "cancelled" && (
            <button
              type="button"
              aria-label={t("subs.undoCancel")}
              onClick={() => setUndoCancelTarget(findSub(row.id))}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
        </div>
      ),
    });

  const findSub = (id: string): SubscriptionWithMember | null =>
    data.items.find((s) => s.id === id) ?? null;

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "subs", label: t("subs.tabSubs") },
          ...(hasPermission("packages.view")
            ? [{ value: "packages", label: t("packages.tabPackages") }]
            : []),
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
            <EmptyState
              icon={<CalendarPlus />}
              title={t("subs.empty")}
              description={t("subs.emptyDesc")}
              action={
                hasPermission("subscriptions.create") ? (
                  <Button onClick={() => setSubModalOpen(true)}>
                    <CalendarPlus className="size-4" />
                    {t("subs.addSubscription")}
                  </Button>
                ) : undefined
              }
            />
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
      ) : tab === "packages" ? (
        <PackagesPage />
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
      <FreezeSubscriptionModal
        open={freezeTarget !== null}
        onClose={() => setFreezeTarget(null)}
        onSaved={() => { reload(); setPage(1); }}
        subscription={freezeTarget}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t("subs.cancelSub")}
        message={t("subs.cancelMsg")}
        loading={busy}
        onConfirm={onCancelConfirm}
      />

      <ConfirmDialog
        open={Boolean(purgeTarget)}
        onClose={() => setPurgeTarget(null)}
        title={t("subs.purgeConfirmTitle")}
        message={t("subs.purgeConfirmMsg")}
        loading={busy}
        onConfirm={onPurgeConfirm}
      />

      <ConfirmDialog
        open={Boolean(undoCancelTarget)}
        onClose={() => setUndoCancelTarget(null)}
        title={t("subs.cancelSub")}
        message={t("subs.undoCancelMsg")}
        loading={busy}
        onConfirm={async () => {
          if (!actor || !undoCancelTarget) return;
          setBusy(true);
          try {
            await api.subscriptions.undoCancel(undoCancelTarget.id);
            toast("success", t("subs.undoCancelledToast"));
            setUndoCancelTarget(null);
            reload();
          } catch (err) {
            toast("error", describeError(err, t));
          } finally {
            setBusy(false);
          }
        }}
      />

      <Modal
        open={detailsTarget !== null}
        onClose={() => setDetailsTarget(null)}
        title={t("subs.detailsTitle")}
        widthClass="max-w-lg"
      >
        {detailsTarget && (() => {
          const sub = detailsTarget;
          const totalDays = sub.startDate && sub.endDate ? diffDaysKeys(sub.startDate, sub.endDate) + 1 : 0;
          const remainingDays = sub.endDate ? diffDaysKeys(today, sub.endDate) + 1 : 0;
          const eff = sub.effectiveStatus;
          return (
            <div className="space-y-4">
              <div className="rounded-lg bg-white/5 p-3 text-sm space-y-2">
                <div className="flex justify-between"><span className="text-subtle">{t("common.member")}</span><span className="font-bold">{sub.memberName}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("common.plan")}</span><span className="font-bold">{sub.planName}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("subs.period")}</span><span dir="ltr" className="tabnum">{sub.startDate} → {sub.endDate}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("subs.totalDays")}</span><span className="tabnum">{totalDays} {t("subs.daysUnit")}</span></div>
                {eff === "active" && (
                  <div className="flex justify-between">
                    <span className="text-subtle">{t("subs.remainingDays")}</span>
                    <span className={`font-bold tabnum ${remainingDays <= 7 ? "text-red" : remainingDays <= 14 ? "text-amber" : "text-neon"}`}>{remainingDays} {t("subs.daysUnit")}</span>
                  </div>
                )}
                {sub.frozenDays > 0 && (
                  <div className="flex justify-between"><span className="text-subtle">{t("subs.frozenDaysCount")}</span><span className="tabnum text-cyan flex items-center gap-1"><Snowflake className="size-3" />{sub.frozenDays} {t("subs.daysUnit")}</span></div>
                )}
                <div className="flex justify-between"><span className="text-subtle">{t("common.status")}</span><Badge variant={subStatusMeta(t, eff).variant} dot>{subStatusMeta(t, eff).label}</Badge></div>
              </div>

                <div>
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-2"><Snowflake className="size-4 text-cyan" />{t("subs.freezeHistory")}</h4>
                  {freezeHistory.length === 0 ? (
                    <p className="text-sm text-faint">{t("subs.freezeHistoryEmpty")}</p>
                  ) : (
                    <div className="space-y-2">
                      {freezeHistory.map((f) => {
                        return (
                        <div key={f.id} className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.freezeFrom")}</span>
                            <span className="tabnum">{f.startDate}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.freezeTo")}</span>
                            <span className="tabnum">{f.endDate}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.freezeDuration")}</span>
                            <span className="tabnum">{f.durationDays} {t("subs.daysUnit")}</span>
                          </div>
                          {f.actualResumeDate && (
                            <div className="flex justify-between">
                              <span className="text-subtle">{t("subs.unfreeze")}</span>
                              <span className="tabnum">{f.actualResumeDate}</span>
                            </div>
                          )}
                          {f.reason && (
                            <div className="flex justify-between">
                              <span className="text-subtle">{t("subs.freezeReason")}</span>
                              <span className="text-subtle text-xs">{f.reason}</span>
                            </div>
                          )}
                          {f.notes && (
                            <div className="text-subtle text-xs leading-relaxed border-t border-line pt-1.5 mt-1.5">
                              {f.notes}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
            </div>
          );
        })()}
      </Modal>
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
