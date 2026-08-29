import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type FreezeInfo } from "@/api";
import type { CardWithMember } from "@/core/services/cards.service";
import type { Subscription } from "@/core/services/subscriptions.service";
import { cardStatusMeta, subStatusMeta } from "@/utils/status-meta";
import { diffDaysKeys, todayKey, parseDateKey } from "@/core/dates";
import { formatMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  CalendarPlus,
  CalendarX2,
  CreditCard,
  Info,
  PauseCircle,
  PlayCircle,
  Snowflake,
  Trash2,
} from "lucide-react";
import { FreezeSubscriptionModal } from "@/components/subscriptions/freeze-subscription-modal";
import { RenewModal } from "../modals/renew-modal";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function MembershipTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  if (!hasPermission("subscriptions.view") && !hasPermission("cards.view")) {
    return permissionDeniedNode(t);
  }
  return (
    <div className="space-y-4">
      {hasPermission("cards.view") && <CardsCard ctx={ctx} />}
      {hasPermission("subscriptions.view") && <SubsCard ctx={ctx} />}
    </div>
  );
}

function CardsCard({ ctx }: TabProps) {
  const t = useT();
  const [cards, setCards] = useState<CardWithMember[]>([]);
  const reload = useCallback(() => {
    let alive = true;
    api.cards
      .listForMember(ctx.member.id)
      .then((rows) => {
        if (alive) setCards(rows as CardWithMember[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [ctx.member.id]);
  useEffect(() => {
    reload();
  }, [reload, ctx.reloadTick]);
  interface Row {
    id: string;
    barcodeValue: string;
    status: CardWithMember["status"];
    assignedAt: string | null;
  }
  const rows: Row[] = cards.map((c) => ({
    id: c.id,
    barcodeValue: c.barcodeValue,
    status: c.status,
    assignedAt: c.assignedAt,
  }));
  const columns: Column<Row>[] = [
    {
      key: "barcode",
      header: t("cards.barcode"),
      render: (row) => (
        <span dir="ltr" className="font-mono font-bold tracking-wider">
          {row.barcodeValue}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = cardStatusMeta(t, row.status);
        return (
          <Badge variant={meta.variant} dot>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: "assigned",
      header: t("cards.assignedAt"),
      render: (row) =>
        row.assignedAt ? (
          <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.assignedAt.slice(0, 10)))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];
  return (
    <Card>
      <CardHeader title={t("members.tabCards")} />
      {rows.length === 0 ? (
        <EmptyState icon={<CreditCard />} title={t("members.noCards")} />
      ) : (
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
      )}
    </Card>
  );
}

function SubsCard({ ctx }: TabProps) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [renewSub, setRenewSub] = useState<Subscription | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Subscription | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Subscription | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<Subscription | null>(null);
  const [freezeHistory, setFreezeHistory] = useState<FreezeInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [balances, setBalances] = useState<Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }>>({});

  const reload = useCallback(() => {
    if (!actor) return;
    let alive = true;
    api.subscriptions
      .listForMember(ctx.member.id)
      .then((rows) => {
        if (alive) setSubs(rows);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, ctx.member.id]);
  useEffect(() => {
    reload();
  }, [reload, ctx.reloadTick]);

  useEffect(() => {
    if (!actor || !hasPermission("payments.view") || subs.length === 0) return;
    let alive = true;
    void (async () => {
      const next: Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }> = {};
      for (const s of subs) {
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
  }, [actor, hasPermission, subs]);

  useEffect(() => {
    if (!detailsTarget) {
      setFreezeHistory([]);
      return;
    }
    let alive = true;
    api.subscriptions
      .freezes(detailsTarget.id)
      .then((rows) => {
        if (alive) setFreezeHistory(rows);
      })
      .catch(() => {
        if (alive) setFreezeHistory([]);
      });
    return () => {
      alive = false;
    };
  }, [detailsTarget]);

  const doPurge = async () => {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.purge(purgeTarget.id);
      toast("success", t("subs.purgedToast"));
      setPurgeTarget(null);
      reload();
      ctx.reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.setStatus(cancelTarget.id, "cancelled");
      toast("success", t("subs.cancelledToast"));
      setCancelTarget(null);
      reload();
      ctx.reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const doSuspendToggle = async (sub: Subscription) => {
    const next = sub.status === "suspended" ? "active" : "suspended";
    try {
      await api.subscriptions.setStatus(sub.id, next);
      toast("success", next === "suspended" ? t("subs.suspendedToast") : t("subs.resumedToast"));
      reload();
      ctx.reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  interface Row {
    id: string;
    planName: string;
    startDate: string;
    endDate: string;
    price: number;
    remainingMinor: number;
    discountMinor: number;
    paidMinor: number;
    effective: Parameters<typeof subStatusMeta>[1];
    totalDays: number;
    remainingDays: number;
    frozenDays: number;
    subscription: Subscription;
  }
  const today = todayKey();
  const rows: Row[] = subs.map((s) => {
    let eff: Row["effective"] = "expired";
    if (s.status === "suspended") eff = "suspended";
    else if (s.status === "cancelled") eff = "cancelled";
    else if (s.startDate && today < s.startDate) eff = "upcoming";
    else if (s.startDate && s.endDate && today >= s.startDate && today <= s.endDate) eff = "active";
    const totalDays = s.startDate && s.endDate ? diffDaysKeys(s.startDate, s.endDate) + 1 : 0;
    const remainingDays = eff === "active" && s.endDate
      ? Math.max(0, diffDaysKeys(today, s.endDate) + 1)
      : eff === "expired" ? 0 : totalDays;
    return {
      id: s.id,
      planName: s.planName ?? "-",
      startDate: s.startDate,
      endDate: s.endDate,
      price: s.price,
      remainingMinor: balances[s.id]?.remainingMinor ?? 0,
      discountMinor: balances[s.id]?.discountedMinor ?? 0,
      paidMinor: balances[s.id]?.paidMinor ?? 0,
      effective: eff,
      totalDays,
      remainingDays,
      frozenDays: s.frozenDays,
      subscription: s,
    };
  });
  const filteredRows = statusFilter === "all" ? rows : rows.filter((r) => r.effective === statusFilter);

  const columns: Column<Row>[] = [
    {
      key: "plan",
      header: t("common.plan"),
      render: (row) => <span className="font-bold">{row.planName}</span>,
    },
    {
      key: "period",
      header: t("subs.period"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.startDate} ← {row.endDate}
        </span>
      ),
    },
    {
      key: "price",
      header: t("subs.price"),
      render: (row) => <span className="font-bold tabnum">{row.price}</span>,
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
            render: (row: Row) => <span className="tabnum text-subtle">{formatMinor(row.paidMinor)}</span>,
          },
          {
            key: "balance" as const,
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
                <span className="tabnum text-cyan flex items-center gap-1">
                  <Snowflake className="size-3" />
                  {row.frozenDays} {t("subs.daysUnit")}
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
        const original = subs.find((s) => s.id === row.id);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant} dot>
              {meta.label}
            </Badge>
            <button
              type="button"
              aria-label={t("subs.details")}
              onClick={() => {
                if (original) setDetailsTarget(original);
              }}
              className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              title={t("subs.details")}
            >
              <Info className="size-3.5" />
            </button>
            {hasPermission("subscriptions.edit") && row.effective === "frozen" && (
              <button
                type="button"
                aria-label={t("subs.unfreeze")}
                onClick={() => {
                  if (original)
                    void api.subscriptions
                      .unfreeze(original.id)
                      .then(() => {
                        toast("success", t("subs.unfrozenToast"));
                        reload();
                        ctx.reload();
                      })
                      .catch((err) => toast("error", describeError(err, t)));
                }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
                title={t("subs.unfreeze")}
              >
                <PlayCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.edit") && row.effective === "suspended" && (
              <button
                type="button"
                aria-label={t("subs.resumeSub")}
                onClick={() => {
                  if (original) void doSuspendToggle(original);
                }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
                title={t("subs.resumeSub")}
              >
                <PlayCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.edit") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.suspendSub")}
                onClick={() => {
                  if (original) void doSuspendToggle(original);
                }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
                title={t("subs.suspendSub")}
              >
                <PauseCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.cancel") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.cancelSub")}
                onClick={() => {
                  if (original) setCancelTarget(original);
                }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-red/10 hover:text-red"
                title={t("subs.cancelSub")}
              >
                <CalendarX2 className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.freeze") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.suspendSub")}
                onClick={() => {
                  if (original) setFreezeTarget(original);
                }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
                title={t("subs.suspendSub")}
              >
                <Snowflake className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.create") && (row.effective === "active" || row.effective === "expired") && (
              <Button size="sm" variant="secondary" onClick={() => {
                if (original) setRenewSub(original);
              }}>
                {t("subs.renew")}
              </Button>
            )}
            {hasPermission("subscriptions.purge") && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red hover:text-red"
                title={t("subs.purgeAction")}
                onClick={() => {
                  if (original) setPurgeTarget(original);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t("members.tabSubs")}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: t("subs.filterAll") },
                { value: "active", label: t("subs.filterActive") },
                { value: "upcoming", label: t("subs.filterUpcoming") },
                { value: "expired", label: t("subs.filterExpired") },
                { value: "suspended", label: t("subs.filterSuspended") },
                { value: "frozen", label: t("status.frozen") },
                { value: "cancelled", label: t("subs.filterCancelled") },
              ]}
            />
            {hasPermission("subscriptions.create") && ctx.member.status !== "archived" && (
              <Button onClick={() => ctx.onAddSubscription()}>
                <CalendarPlus className="size-4" />
                {t("subs.addSubscription")}
              </Button>
            )}
          </div>
        }
      />
      {filteredRows.length === 0 ? (
        <EmptyState icon={<CalendarPlus />} title={t("members.noSubs")} />
      ) : (
        <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.id} />
      )}
      {renewSub && (
        <RenewModal
          sub={renewSub}
          open
          onClose={() => setRenewSub(null)}
          onDone={() => {
            setRenewSub(null);
            reload();
            ctx.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={t("subs.purgeConfirmTitle")}
        message={
          purgeTarget
            ? `${purgeTarget.planName} · ${purgeTarget.startDate} → ${purgeTarget.endDate} — ${t("subs.purgeConfirmMsg")}`
            : ""
        }
        confirmLabel={t("subs.purgeAction")}
        onConfirm={() => void doPurge()}
      />
      <FreezeSubscriptionModal
        open={freezeTarget !== null}
        onClose={() => setFreezeTarget(null)}
        onSaved={() => {
          reload();
          ctx.reload();
        }}
        subscription={freezeTarget as Subscription}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t("subs.cancelSub")}
        message={t("subs.cancelMsg")}
        loading={busy}
        onConfirm={() => void doCancel()}
      />
      <Modal
        open={detailsTarget !== null}
        onClose={() => setDetailsTarget(null)}
        title={t("subs.detailsTitle")}
        widthClass="max-w-lg"
      >
        {detailsTarget &&
          (() => {
            const sub = detailsTarget;
            const totalDays = sub.startDate && sub.endDate ? diffDaysKeys(sub.startDate, sub.endDate) + 1 : 0;
            const remainingDays = sub.endDate ? diffDaysKeys(today, sub.endDate) + 1 : 0;
            let eff: "active" | "expired" | "upcoming" | "cancelled" | "suspended" = "expired";
            if (sub.status === "suspended") eff = "suspended";
            else if (sub.status === "cancelled") eff = "cancelled";
            else if (today < sub.startDate) eff = "upcoming";
            else if (today >= sub.startDate && today <= sub.endDate) eff = "active";
            return (
              <div className="space-y-4">
                <div className="rounded-lg bg-white/5 p-3 text-sm space-y-2">
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
                      {freezeHistory.map((f) => (
                        <div key={f.id} className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
                          <div className="flex justify-between"><span className="text-subtle">{t("subs.freezeFrom")}</span><span className="tabnum">{f.startDate}</span></div>
                          <div className="flex justify-between"><span className="text-subtle">{t("subs.freezeTo")}</span><span className="tabnum">{f.endDate}</span></div>
                          <div className="flex justify-between"><span className="text-subtle">{t("subs.freezeDuration")}</span><span className="tabnum">{f.durationDays} {t("subs.daysUnit")}</span></div>
                          {f.actualResumeDate && (
                            <div className="flex justify-between"><span className="text-subtle">{t("subs.unfreeze")}</span><span className="tabnum">{f.actualResumeDate}</span></div>
                          )}
                          {f.reason && (
                            <div className="flex justify-between"><span className="text-subtle">{t("subs.freezeReason")}</span><span className="text-subtle text-xs">{f.reason}</span></div>
                          )}
                          {f.notes && (
                            <div className="text-subtle text-xs leading-relaxed border-t border-line pt-1.5 mt-1.5">{f.notes}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
      </Modal>
    </Card>
  );
}
