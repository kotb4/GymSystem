import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BellRing,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Info,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Snowflake,
  Ticket,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useDebounce } from "@/hooks/use-debounce";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { appConfig } from "@/config/app.config";
import {
  api,
  type Plan,
  type SubscriptionWithMember,
  type FreezeInfo,
  type SubscriptionStats,
  type PublicMember,
} from "@/api";
import { parseDateKey, diffDaysKeys, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";

import { formatDateShort, formatNumber } from "@/services/format";
import { subStatusMeta } from "@/utils/status-meta";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DateRange } from "@/components/ui/date-range";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";
import { FreezeSubscriptionModal } from "@/components/subscriptions/freeze-subscription-modal";
import { RenewalAlertsModal } from "@/components/subscriptions/renewal-alerts-modal";
import { BranchBadge } from "@/components/ui/branch-badge";
import { RenewModal } from "@/pages/member-profile/modals/renew-modal";
import { SettleMemberDuesModal } from "@/components/finance/settle-member-dues-modal";
import { PageHeader } from "@/components/ui/page-header";

const FILTER_PILLS = [
  { value: "all", label: "الكل" },
  { value: "active", label: "🟢 النشطة" },
  { value: "expiring", label: "⚠️ أوشكت على الانتهاء" },
  { value: "frozen", label: "❄️ المجمدة" },
  { value: "unpaid", label: "💰 عليها متبقي" },
  { value: "expired", label: "🔴 المنتهية" },
  { value: "upcoming", label: "📅 تبدأ قريباً" },
  { value: "cancelled", label: "🚫 الملغاة" },
] as const;

export function SubscriptionsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Top Tabs: "subs" | "plans"
  const [tab, setTab] = useState<"subs" | "plans">("subs");
  const [effective, setEffective] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search.trim(), 250);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: SubscriptionWithMember[]; total: number }>({
    items: [],
    total: 0,
  });
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  // Modals state
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [defaultPlanCategory, setDefaultPlanCategory] = useState<"gym" | "academy">("gym");
  const [presetPlanId, setPresetPlanId] = useState<string | undefined>(undefined);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [deletePlanTarget, setDeletePlanTarget] = useState<Plan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SubscriptionWithMember | null>(null);
  const [undoCancelTarget, setUndoCancelTarget] = useState<SubscriptionWithMember | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<SubscriptionWithMember | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<SubscriptionWithMember | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<SubscriptionWithMember | null>(null);
  const [freezeHistory, setFreezeHistory] = useState<FreezeInfo[]>([]);
  const [renewalModalOpen, setRenewalModalOpen] = useState(false);

  // Quick Action Modals (Renew & Settle Dues)
  const [renewTarget, setRenewTarget] = useState<{
    sub: SubscriptionWithMember;
    member: PublicMember | null;
  } | null>(null);
  const [settleTargetMember, setSettleTargetMember] = useState<PublicMember | null>(null);

  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

  // Reset page when search changes
  useEffect(() => {
    setPage(1);
  }, [debounced]);

  // Load subscriptions list
  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.subscriptions
      .list({
        page,
        pageSize: appConfig.pageSize,
        effective: effective as never,
        search: debounced || undefined,
      })
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, effective, debounced, page, reloadTick]);

  // Load KPI Stats
  const reloadStats = useCallback(() => {
    if (!actor) return;
    api.subscriptions
      .stats()
      .then(setStats)
      .catch((err) => console.error("Failed to load subscription stats:", err));
  }, [actor]);

  useEffect(() => {
    reloadStats();
  }, [reloadStats, reloadTick]);

  // Load Plans
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

  // Deep-link to open add subscription modal
  useEffect(() => {
    if (searchParams.get("add") === "1" && hasPermission("subscriptions.create")) {
      setSubModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, hasPermission, setSearchParams]);

  // Load freeze history when details target changes
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

  // Quick Action: Open Settle Dues
  const handleOpenSettleDues = async (memberId: string) => {
    try {
      const member = await api.members.get(memberId);
      setSettleTargetMember(member);
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  // Quick Action: Open Renew
  const handleOpenRenew = async (sub: SubscriptionWithMember) => {
    try {
      let member: PublicMember | null = null;
      try {
        member = await api.members.get(sub.memberId);
      } catch {
        /* proceed even if member get fails */
      }
      setRenewTarget({ sub, member });
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  // Confirm Handlers
  const onCancelConfirm = async () => {
    if (!actor || !cancelTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.setStatus(cancelTarget.id, "cancelled");
      toast("success", t("subs.cancelledToast"));
      setCancelTarget(null);
      reload();
      reloadStats();
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
      reloadStats();
      setPage(1);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onPlanDeleteConfirm = async () => {
    if (!actor || !deletePlanTarget) return;
    setBusy(true);
    try {
      const res = await api.plans.delete(deletePlanTarget.id);
      if (res.softDeactivated) {
        toast("info", "تم إلغاء تفعيل الخطة بدلاً من حذفها النهائي نظراً لوجود اشتراكات سابقة مسجلة بها");
      } else {
        toast("success", "تم حذف الخطة بنجاح نهائياً");
      }
      setDeletePlanTarget(null);
      reloadPlans();
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
      reloadStats();
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
    planCategory: "gym" | "academy";
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

  const today = todayKey();
  const rows: Row[] = data.items.map((s) => {
    const totalDays = s.startDate && s.endDate ? diffDaysKeys(s.startDate, s.endDate) + 1 : 0;
    const eff = s.effectiveStatus;
    const remainingDays =
      eff === "active" && s.endDate
        ? Math.max(0, diffDaysKeys(today, s.endDate) + 1)
        : eff === "expired"
          ? 0
          : totalDays;
    return {
      id: s.id,
      memberId: s.memberId,
      memberName: s.memberName,
      memberCode: s.memberCode,
      planName: s.planName ?? "—",
      planCategory: s.category ?? "gym",
      startDate: s.startDate,
      endDate: s.endDate,
      price: s.price,
      remainingMinor: s.remainingMinor ?? 0,
      discountMinor: s.discountMinor ?? 0,
      paidMinor: s.paidMinor ?? 0,
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
          className="flex items-center gap-2.5 text-start group"
        >
          <Avatar name={row.memberName} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-bold text-ink group-hover:text-primary transition-colors">
              {row.memberName}
            </span>
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
      render: (row) => (
        <div>
          <span className="font-semibold block text-sm">{row.planName}</span>
          <span className="inline-block mt-0.5">
            {row.planCategory === "academy" ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                🥋 أكاديمية
              </span>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                🏋️‍♂️ صالة جيم
              </span>
            )}
          </span>
        </div>
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.subscription.branchId} />,
    },
    {
      key: "period",
      header: t("subs.period"),
      render: (row) => (
        <DateRange
          start={row.startDate ? formatDateShort(parseDateKey(row.startDate)) : null}
          end={row.endDate ? formatDateShort(parseDateKey(row.endDate)) : null}
        />
      ),
    },
    {
      key: "remainingDays",
      header: t("subs.remainingDays"),
      render: (row) => {
        if (row.effective === "expired" || row.effective === "cancelled") {
          return <span className="text-faint tabnum text-xs">منتهي</span>;
        }
        if (row.effective === "frozen") {
          return (
            <span className="inline-flex items-center gap-1 font-bold text-xs text-cyan tabnum">
              <Snowflake className="size-3" />
              <span>مجمد ({row.frozenDays} يوم)</span>
            </span>
          );
        }
        const isUrgent = row.remainingDays <= 7;
        const color = isUrgent
          ? "bg-red/15 text-red border border-red/30 animate-pulse"
          : row.remainingDays <= 14
            ? "bg-amber/15 text-amber border border-amber/30"
            : "bg-emerald/15 text-emerald border border-emerald/30";
        return (
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold tabnum ${color}`}>
            {row.remainingDays} {t("subs.daysUnit")}
          </span>
        );
      },
    },
    {
      key: "financials",
      header: "الماليات والمتبقي",
      render: (row) => (
        <div className="text-xs space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-faint">السعر:</span>
            <span className="font-bold tabnum text-ink">{formatNumber(row.price)} ج.م</span>
          </div>
          {row.remainingMinor > 0 ? (
            <div className="flex items-center gap-1 text-amber">
              <span className="text-[11px] font-semibold">متبقي:</span>
              <span className="font-extrabold tabnum">{formatMinor(row.remainingMinor)}</span>
            </div>
          ) : (
            <span className="text-[11px] text-emerald font-semibold flex items-center gap-0.5">
              <CheckCircle2 className="size-3" />
              مسدد بالكامل
            </span>
          )}
        </div>
      ),
    },
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
    {
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* Quick Settle Dues shortcut */}
          {hasPermission("payments.create") && row.remainingMinor > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-[11px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 gap-1"
              onClick={() => void handleOpenSettleDues(row.memberId)}
              title="سداد المتبقي المالي لهذا الاشتراك"
            >
              <DollarSign className="size-3" />
              <span>سداد</span>
            </Button>
          )}

          {/* Quick Renew shortcut */}
          {hasPermission("subscriptions.create") &&
            (row.effective === "expired" || row.remainingDays <= 7) && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[11px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 gap-1"
                onClick={() => void handleOpenRenew(row.subscription)}
                title="تجديد الاشتراك فورياً"
              >
                <RotateCcw className="size-3" />
                <span>تجديد</span>
              </Button>
            )}

          {/* Quick Unfreeze */}
          {(hasPermission("subscriptions.freeze") || hasPermission("subscriptions.edit")) && row.effective === "frozen" && (
            <button
              type="button"
              aria-label={t("subs.unfreeze")}
              onClick={() => {
                const sub = data.items.find((s) => s.id === row.id);
                if (sub)
                  void api.subscriptions
                    .unfreeze(sub.id)
                    .then(() => {
                      toast("success", t("subs.unfrozenToast"));
                      reload();
                      reloadStats();
                    })
                    .catch((err) => toast("error", describeError(err, t)));
              }}
              className="grid size-7 place-items-center rounded-lg text-cyan hover:bg-cyan/15 transition-colors"
              title={t("subs.unfreeze")}
            >
              <PlayCircle className="size-4" />
            </button>
          )}

          {/* Quick Freeze */}
          {hasPermission("subscriptions.freeze") && row.effective === "active" && (
            <button
              type="button"
              aria-label={t("subs.freeze")}
              onClick={() => {
                const sub = data.items.find((s) => s.id === row.id);
                if (sub) setFreezeTarget(sub);
              }}
              className="grid size-7 place-items-center rounded-lg text-faint hover:bg-cyan/10 hover:text-cyan transition-colors"
              title={t("subs.freeze")}
            >
              <Snowflake className="size-4" />
            </button>
          )}

          {/* Quick Suspend / Resume */}
          {hasPermission("subscriptions.edit") && row.effective === "suspended" && (
            <button
              type="button"
              aria-label={t("subs.resumeSub")}
              onClick={() => void onSuspendToggle(row.subscription)}
              className="grid size-7 place-items-center rounded-lg text-emerald hover:bg-emerald/15 transition-colors"
              title={t("subs.resumeSub")}
            >
              <PlayCircle className="size-4" />
            </button>
          )}
          {hasPermission("subscriptions.edit") && row.effective === "active" && (
            <button
              type="button"
              aria-label={t("subs.suspendSub")}
              onClick={() => void onSuspendToggle(row.subscription)}
              className="grid size-7 place-items-center rounded-lg text-faint hover:bg-white/5 hover:text-subtle transition-colors"
              title={t("subs.suspendSub")}
            >
              <PauseCircle className="size-4" />
            </button>
          )}



          {/* Subscription Details Modal */}
          <button
            type="button"
            aria-label={t("subs.details")}
            onClick={() => setDetailsTarget(row.subscription)}
            className="grid size-7 place-items-center rounded-lg text-faint hover:bg-white/5 hover:text-subtle transition-colors"
            title={t("subs.details")}
          >
            <Info className="size-4" />
          </button>

          {/* Cancel Subscription */}
          {hasPermission("subscriptions.cancel") && row.status === "active" && (
            <button
              type="button"
              aria-label={t("subs.cancelSub")}
              onClick={() => setCancelTarget(row.subscription)}
              className="grid size-7 place-items-center rounded-lg text-faint hover:bg-red/10 hover:text-red transition-colors"
              title={t("subs.cancelSub")}
            >
              <CalendarX2 className="size-4" />
            </button>
          )}

          {/* Undo Cancel */}
          {hasPermission("subscriptions.cancel") && row.status === "cancelled" && (
            <button
              type="button"
              aria-label={t("subs.undoCancel")}
              onClick={() => setUndoCancelTarget(row.subscription)}
              className="grid size-7 place-items-center rounded-lg text-faint hover:bg-white/5 hover:text-subtle transition-colors"
              title={t("subs.undoCancel")}
            >
              <RotateCcw className="size-4" />
            </button>
          )}

          {/* Purge Subscription */}
          {hasPermission("subscriptions.purge") && (
            <button
              type="button"
              aria-label={t("subs.purgeAction")}
              onClick={() => setPurgeTarget(row.subscription)}
              className="grid size-7 place-items-center rounded-lg text-faint hover:bg-red/10 hover:text-red transition-colors"
              title={t("subs.purgeAction")}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={Ticket}
        title={tab === "subs" ? "سجل اشتراكات الأعضاء" : "باقات وخطط الأسعار"}
        subtitle={
          tab === "subs"
            ? "متابعة الاشتراكات النشطة، التجديدات، فترات التجميد، وإدارة العقود"
            : "تعريف وتخصيص باقات الجيم والأكاديميات وحصص التدريب والأسعار"
        }
        badge={
          stats && tab === "subs" ? (
            <Badge variant="neutral" className="font-mono text-xs">
              {formatNumber(stats.activeCount)} اشتراك نشط
            </Badge>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasPermission("subscriptions.edit") && tab === "subs" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRenewalModalOpen(true)}
              >
                <BellRing className="size-4 text-emerald" />
                <span>تذكيرات التجديد (WhatsApp)</span>
              </Button>
            )}
            {hasPermission("plans.create") && tab === "plans" && (
              <Button
                size="sm"
                className="bg-primary text-white font-bold shadow-glow-sm"
                onClick={() => {
                  setEditPlan(null);
                  setPlanModalOpen(true);
                }}
              >
                <CreditCard className="size-4" />
                <span>إضافة باقة جديدة</span>
              </Button>
            )}
            {hasPermission("subscriptions.create") && tab === "subs" && (
              <Button
                size="sm"
                onClick={() => setSubModalOpen(true)}
                className="bg-primary text-white font-bold shadow-glow-sm"
              >
                <CalendarPlus className="size-4" />
                <span>{t("subs.addSubscription")}</span>
              </Button>
            )}
          </div>
        }
      />

      {/* 2. SUB-SECTION TABS SWITCHER */}
      <div className="flex items-center justify-between">
        <Tabs
          items={[
            { value: "subs", label: "📋 سجل الاشتراكات" },
            { value: "plans", label: "🏷️ باقات وخطط الأسعار" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as "subs" | "plans")}
        />
      </div>

      {/* TAB 1: Subscriptions Table & KPIs */}
      {tab === "subs" && (
        <div className="space-y-4">
          {/* Top KPI Stats Strip */}
          {stats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Active Subs */}
              <button
                type="button"
                onClick={() => setEffective("active")}
                className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all ${
                  effective === "active"
                    ? "border-emerald/60 bg-emerald/10 shadow-lg shadow-emerald/5"
                    : "border-line bg-surface hover:border-emerald/30 hover:bg-emerald/5"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-subtle">
                  <span className="font-semibold">الاشتراكات النشطة</span>
                  <CheckCircle2 className="size-4 text-emerald" />
                </div>
                <p className="text-2xl font-black tabnum text-ink">{formatNumber(stats.activeCount)}</p>
                <span className="text-[11px] text-emerald font-medium">عضو يتدرب حالياً</span>
              </button>

              {/* Expiring Soon */}
              <button
                type="button"
                onClick={() => setEffective("expiring")}
                className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all ${
                  effective === "expiring"
                    ? "border-amber/60 bg-amber/10 shadow-lg shadow-amber/5"
                    : "border-line bg-surface hover:border-amber/30 hover:bg-amber/5"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-subtle">
                  <span className="font-semibold">توشك على الانتهاء</span>
                  <AlertCircle className="size-4 text-amber" />
                </div>
                <p className="text-2xl font-black tabnum text-amber">{formatNumber(stats.expiringCount)}</p>
                <span className="text-[11px] text-amber font-medium">خلال 7 أيام للمتابعة</span>
              </button>

              {/* Frozen Subs */}
              <button
                type="button"
                onClick={() => setEffective("frozen")}
                className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all ${
                  effective === "frozen"
                    ? "border-cyan/60 bg-cyan/10 shadow-lg shadow-cyan/5"
                    : "border-line bg-surface hover:border-cyan/30 hover:bg-cyan/5"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-subtle">
                  <span className="font-semibold">الاشتراكات المجمدة</span>
                  <Snowflake className="size-4 text-cyan" />
                </div>
                <p className="text-2xl font-black tabnum text-cyan">{formatNumber(stats.frozenCount)}</p>
                <span className="text-[11px] text-cyan font-medium">تجميد عضوية مؤقت</span>
              </button>

              {/* Unpaid Dues */}
              <button
                type="button"
                onClick={() => setEffective("unpaid")}
                className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all ${
                  effective === "unpaid"
                    ? "border-amber-500/60 bg-amber-500/10 shadow-lg shadow-amber-500/5"
                    : "border-line bg-surface hover:border-amber-500/30 hover:bg-amber-500/5"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-subtle">
                  <span className="font-semibold">مستحقات ومتبقي مالي</span>
                  <DollarSign className="size-4 text-amber-400" />
                </div>
                <p className="text-xl font-black tabnum text-amber-400 truncate">
                  {formatMinor(stats.unpaidDuesMinor)}
                </p>
                <span className="text-[11px] text-subtle font-medium">
                  على {formatNumber(stats.unpaidCount)} اشتراك للتحصيل
                </span>
              </button>
            </div>
          )}

          {/* Subscriptions Card */}
          <Card>
            {/* Search and Quick Filters Strip */}
            <div className="p-4 border-b border-line space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
                <div className="w-full sm:w-80">
                  <SearchInput
                    value={search}
                    onValueChange={setSearch}
                    placeholder="بحث باسم المشترك، الهاتف، أو كود العضوية..."
                  />
                </div>
                <span className="text-xs font-semibold text-faint tabnum">
                  إجمالي النتائج: {formatNumber(data.total)}
                </span>
              </div>

              {/* Quick Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {FILTER_PILLS.map((pill) => {
                  const active = effective === pill.value;
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() => {
                        setEffective(pill.value);
                        setPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        active
                          ? "bg-primary text-white shadow-sm"
                          : "bg-surface border border-line text-subtle hover:text-ink hover:bg-white/[0.04]"
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Table or Empty State */}
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
        </div>
      )}

      {/* TAB 2: Pricing Plans */}
      {tab === "plans" && (
        <PlansGrid
          plans={plans}
          canCreate={hasPermission("plans.create")}
          canEdit={hasPermission("plans.edit")}
          onAdd={(cat) => {
            setDefaultPlanCategory(cat ?? "gym");
            setEditPlan(null);
            setPlanModalOpen(true);
          }}
          onEdit={(plan) => {
            setEditPlan(plan);
            setPlanModalOpen(true);
          }}
          onDelete={(plan) => {
            setDeletePlanTarget(plan);
          }}
          onSubscribe={(plan) => {
            setDefaultPlanCategory(plan.category ?? "gym");
            setPresetPlanId(plan.id);
            setSubModalOpen(true);
          }}
        />
      )}

      {/* Modals */}
      <SubscriptionFormModal
        open={subModalOpen}
        onClose={() => {
          setSubModalOpen(false);
          setPresetPlanId(undefined);
        }}
        onSaved={() => {
          reload();
          reloadStats();
        }}
        defaultCategory={defaultPlanCategory}
        presetPlanId={presetPlanId}
      />

      <PlanFormModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        onSaved={reloadPlans}
        plan={editPlan}
        defaultCategory={defaultPlanCategory}
      />

      <FreezeSubscriptionModal
        open={freezeTarget !== null}
        onClose={() => setFreezeTarget(null)}
        onSaved={() => {
          reload();
          reloadStats();
          setPage(1);
        }}
        subscription={freezeTarget}
      />

      {/* Renew Modal */}
      {renewTarget && (
        <RenewModal
          open={true}
          sub={renewTarget.sub}
          member={renewTarget.member}
          onClose={() => setRenewTarget(null)}
          onDone={() => {
            setRenewTarget(null);
            reload();
            reloadStats();
          }}
        />
      )}

      {/* Settle Member Dues Modal */}
      {settleTargetMember && (
        <SettleMemberDuesModal
          open={true}
          member={settleTargetMember}
          onClose={() => setSettleTargetMember(null)}
          onSaved={() => {
            setSettleTargetMember(null);
            reload();
            reloadStats();
          }}
        />
      )}

      {/* Confirm Dialogs */}
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
            reloadStats();
          } catch (err) {
            toast("error", describeError(err, t));
          } finally {
            setBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={deletePlanTarget !== null}
        title="حذف الخطة"
        message={deletePlanTarget ? `هل أنت متأكد من حذف الخطة «${deletePlanTarget.name}»؟` : ""}
        onClose={() => setDeletePlanTarget(null)}
        onConfirm={onPlanDeleteConfirm}
        loading={busy}
      />

      {/* Details Modal */}
      <Modal
        open={detailsTarget !== null}
        onClose={() => setDetailsTarget(null)}
        title={t("subs.detailsTitle")}
        widthClass="max-w-lg"
      >
        {detailsTarget && (() => {
          const sub = detailsTarget;
          const totalDays =
            sub.startDate && sub.endDate ? diffDaysKeys(sub.startDate, sub.endDate) + 1 : 0;
          const remainingDays = sub.endDate ? diffDaysKeys(today, sub.endDate) + 1 : 0;
          const eff = sub.effectiveStatus;
          return (
            <div className="space-y-4">
              <div className="rounded-xl bg-white/[0.03] p-4 text-sm space-y-2.5 border border-line">
                <div className="flex justify-between">
                  <span className="text-subtle">{t("common.member")}</span>
                  <span className="font-bold">{sub.memberName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">{t("common.plan")}</span>
                  <span className="font-bold">{sub.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">{t("subs.period")}</span>
                  <DateRange start={sub.startDate} end={sub.endDate} />
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">{t("subs.totalDays")}</span>
                  <span className="tabnum font-semibold">
                    {totalDays} {t("subs.daysUnit")}
                  </span>
                </div>
                {eff === "active" && (
                  <div className="flex justify-between">
                    <span className="text-subtle">{t("subs.remainingDays")}</span>
                    <span
                      className={`font-bold tabnum ${
                        remainingDays <= 7
                          ? "text-red"
                          : remainingDays <= 14
                            ? "text-amber"
                            : "text-neon"
                      }`}
                    >
                      {remainingDays} {t("subs.daysUnit")}
                    </span>
                  </div>
                )}
                {sub.frozenDays > 0 && (
                  <div className="flex justify-between">
                    <span className="text-subtle">{t("subs.frozenDaysCount")}</span>
                    <span className="tabnum text-cyan flex items-center gap-1 font-semibold">
                      <Snowflake className="size-3" />
                      {sub.frozenDays} {t("subs.daysUnit")}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-line">
                  <span className="text-subtle">{t("common.status")}</span>
                  <Badge variant={subStatusMeta(t, eff).variant} dot>
                    {subStatusMeta(t, eff).label}
                  </Badge>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold mb-2 flex items-center gap-2 text-ink">
                  <Snowflake className="size-4 text-cyan" />
                  <span>{t("subs.freezeHistory")}</span>
                </h4>
                {freezeHistory.length === 0 ? (
                  <p className="text-sm text-faint bg-white/[0.02] p-3 rounded-xl border border-line text-center">
                    {t("subs.freezeHistoryEmpty")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {freezeHistory.map((f) => (
                      <div
                        key={f.id}
                        className="rounded-xl bg-white/[0.03] p-3 text-sm space-y-1.5 border border-line"
                      >
                        <div className="flex justify-between">
                          <span className="text-subtle">{t("subs.freezeFrom")}</span>
                          <span className="tabnum font-semibold">{f.startDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-subtle">{t("subs.freezeTo")}</span>
                          <span className="tabnum font-semibold">{f.endDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-subtle">{t("subs.freezeDuration")}</span>
                          <span className="tabnum font-semibold text-cyan">
                            {f.durationDays} {t("subs.daysUnit")}
                          </span>
                        </div>
                        {f.actualResumeDate && (
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.unfreeze")}</span>
                            <span className="tabnum text-emerald font-semibold">
                              {f.actualResumeDate}
                            </span>
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
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <RenewalAlertsModal open={renewalModalOpen} onClose={() => setRenewalModalOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redesigned & Beautiful Plans Grid
// ---------------------------------------------------------------------------

function PlansGrid({
  plans,
  canCreate,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  onSubscribe,
}: {
  plans: Plan[];
  canCreate: boolean;
  canEdit: boolean;
  onAdd: (category?: "gym" | "academy") => void;
  onEdit: (plan: Plan) => void;
  onDelete: (plan: Plan) => void;
  onSubscribe: (plan: Plan) => void;
}) {
  const t = useT();
  const [categoryFilter, setCategoryFilter] = useState<"all" | "gym" | "academy">("all");

  const gymPlans = plans.filter((p) => (p.category ?? "gym") !== "academy");
  const academyPlans = plans.filter((p) => p.category === "academy");
  const displayedPlans =
    categoryFilter === "all"
      ? plans
      : categoryFilter === "gym"
        ? gymPlans
        : academyPlans;

  return (
    <Card>
      <CardHeader
        title={t("plans.tabPlans")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                  categoryFilter === "all"
                    ? "bg-primary text-white shadow-sm"
                    : "text-subtle hover:text-ink"
                }`}
              >
                الكل ({plans.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter("gym")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                  categoryFilter === "gym"
                    ? "bg-cyan-500 text-black shadow-sm"
                    : "text-subtle hover:text-ink"
                }`}
              >
                🏋️‍♂️ صالة الجيم ({gymPlans.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter("academy")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                  categoryFilter === "academy"
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-subtle hover:text-ink"
                }`}
              >
                🥋 باقات الأكاديميات ({academyPlans.length})
              </button>
            </div>
            {canCreate && (
              <Button onClick={() => onAdd(categoryFilter === "academy" ? "academy" : "gym")}>
                <CreditCard className="size-4" />
                <span>
                  {categoryFilter === "academy" ? "إضافة باقة أكاديمية" : t("plans.addPlan")}
                </span>
              </Button>
            )}
          </div>
        }
      />

      {displayedPlans.length === 0 ? (
        <EmptyState icon={<CreditCard />} title={t("plans.empty")} />
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayedPlans.map((plan) => {
            const isAcademy = plan.category === "academy";
            const isSessions = plan.kind === "sessions";
            return (
              <div
                key={plan.id}
                className={`group relative flex flex-col justify-between rounded-2xl border p-4.5 transition-all hover:shadow-lg ${
                  isAcademy
                    ? "border-amber-500/30 bg-amber-500/[0.02] hover:border-amber-500/60"
                    : "border-line bg-surface hover:border-cyan-500/50"
                }`}
              >
                <div>
                  {/* Category & Status Badge Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isAcademy ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/30">
                          🥋 أكاديمية / حصص
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-bold text-cyan-300 border border-cyan-500/30">
                          🏋️‍♂️ جيم وصالة
                        </span>
                      )}
                      {isSessions && plan.sessionsCount != null && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 px-2 py-0.5 text-[11px] font-bold text-purple-300 border border-purple-500/30">
                          🎟️ {plan.sessionsCount} حصة
                        </span>
                      )}
                    </div>
                    {!plan.isActive && <Badge variant="neutral">{t("plans.inactive")}</Badge>}
                  </div>

                  {/* Plan Name */}
                  <h3 className="mt-2.5 font-bold text-base text-ink leading-tight">{plan.name}</h3>

                  {/* Price Banner */}
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-black tabnum text-primary">
                      {formatNumber(plan.price)}
                    </span>
                    <span className="text-xs font-bold text-subtle">ج.م</span>
                    <span className="text-xs text-faint mx-1">/</span>
                    <span className="text-xs font-semibold text-subtle">
                      {plan.durationDays} يوم
                    </span>
                  </div>

                  {/* Plan Features Chips */}
                  <div className="mt-3.5 space-y-2 border-t border-line/60 pt-3 text-xs">
                    {/* Guest Invitations Chip */}
                    <div className="flex items-center justify-between text-subtle">
                      <span className="flex items-center gap-1.5">
                        <Ticket className="size-3.5 text-cyan" />
                        <span>دعوات الضيوف:</span>
                      </span>
                      {plan.invitationsCount > 0 ? (
                        <span className="font-bold text-cyan-300">
                          {plan.invitationsCount} دعوة مجانية
                        </span>
                      ) : (
                        <span className="text-faint">غير مشمولة</span>
                      )}
                    </div>

                    {/* Freeze allowance */}
                    <div className="flex items-center justify-between text-subtle">
                      <span className="flex items-center gap-1.5">
                        <Snowflake className="size-3.5 text-cyan" />
                        <span>إمكانية التجميد:</span>
                      </span>
                      {plan.durationDays >= 30 ? (
                        <span className="font-semibold text-emerald-300">متاح للمشترك</span>
                      ) : (
                        <span className="text-faint">غير متاح</span>
                      )}
                    </div>

                    {/* Sessions count if applicable */}
                    {isSessions && plan.sessionsCount != null && (
                      <div className="flex items-center justify-between text-subtle">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-purple-400" />
                          <span>رصيد الحصص:</span>
                        </span>
                        <span className="font-bold text-purple-300">
                          {plan.sessionsCount} حصة تدريبية
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {plan.description && (
                    <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-subtle border-t border-line/40 pt-2">
                      {plan.description}
                    </p>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="mt-4 pt-3 border-t border-line flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 text-xs font-bold"
                    onClick={() => onSubscribe(plan)}
                  >
                    <CalendarPlus className="size-3.5" />
                    <span>اشتراك</span>
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2.5 hover:text-ink"
                        onClick={() => onEdit(plan)}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red hover:bg-red/10 hover:text-red px-2"
                        onClick={() => onDelete(plan)}
                        title="حذف الخطة"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
