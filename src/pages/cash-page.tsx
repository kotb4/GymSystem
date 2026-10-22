import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  LockKeyhole,
  ShieldAlert,
  Trash2,
  Wallet,
} from "lucide-react";
import { useFocusRow } from "@/hooks/use-focus-row";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ExpenseCategory } from "@/api";
import type {
  CashTotalsForOpen,
  CashSession,
} from "@/core/services/cash-session.service";
import { formatMinor, toMinor } from "@/core/money";
import { todayKey, dateKey } from "@/core/dates";
import { appConfig } from "@/config/app.config";
import { formatDateShort, formatTime } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { VoucherActions } from "@/components/finance/voucher-actions";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import type { PublicUser } from "@/api";

export function CashSessionsPanel() {
  const t = useT();
  // Set when the header reference-number lookup sends us to a cash closing.
  const focusRowId = useFocusRow();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();

  const [openTotals, setOpenTotals] = useState<(CashTotalsForOpen & { session: CashSession }) | null>(null);
  const [lastClosedSession, setLastClosedSession] = useState<CashSession | null>(null);
  const [openingMajor, setOpeningMajor] = useState("");
  const [gapReason, setGapReason] = useState("");
  const [countedMajor, setCountedMajor] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CashSession[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [filterUser, setFilterUser] = useState("all");
  const [filterBox, setFilterBox] = useState<"all" | "gym" | "store">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "closed">("all");
  const [filterDiscrepancy, setFilterDiscrepancy] = useState<"all" | "exact" | "difference" | "shortage" | "surplus">("all");
  const [filterFrom, setFilterFrom] = useState(todayKey());
  const [filterTo, setFilterTo] = useState(todayKey());
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Row | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  // Deficit Resolution Modal State
  const [resolveTarget, setResolveTarget] = useState<CashSession | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveCategory, setResolveCategory] = useState("cat-cash-shortage");
  const [resolveBusy, setResolveBusy] = useState(false);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  const [closedSessionResult, setClosedSessionResult] = useState<{
    id: string;
    closingNo: string | null;
    countedMinor: number;
    expectedMinor: number;
    differenceMinor: number;
    closeNote: string | null;
  } | null>(null);
  const reload = () => setReloadTick((v) => v + 1);

  const canView = hasPermission("payments.view");
  const canViewReports = hasPermission("reports.view");
  const canViewUsers = hasPermission("users.view");
  const activeBox: "gym" | "store" = "gym";
  const isOpener = Boolean(actor && openTotals && actor.userId === openTotals.session.openedById);
  const isOwner = Boolean(actor && actor.roleId === "owner");
  const canClose = isOpener || isOwner;

  const onExportCsv = () => {
    if (items.length === 0) return;
    const headers = [
      "رقم الإقفال",
      "تاريخ الفتح",
      "تاريخ الإغلاق",
      "الموظف المسؤول (الفتح)",
      "الموظف المستلم (الإغلاق)",
      "الرصيد الافتتاحي (ج.م)",
      "الرصيد المتوقع (ج.م)",
      "الرصيد الفعلي المعدود (ج.م)",
      "فرق الجرد (ج.م)",
      "حالة الوردية",
      "الصندوق",
      "ملاحظة الإغلاق",
    ];
    const dataRows = items.map((s) => [
      s.closingNo ?? s.id.slice(0, 8),
      s.openedAt,
      s.closedAt ?? "مفتوحة حالياً",
      s.openedByName,
      s.closedByName ?? "—",
      (s.openingBalanceMinor / 100).toFixed(2),
      s.expectedClosingMinor != null ? (s.expectedClosingMinor / 100).toFixed(2) : "—",
      s.countedClosingMinor != null ? (s.countedClosingMinor / 100).toFixed(2) : "—",
      s.differenceMinor != null ? (s.differenceMinor / 100).toFixed(2) : "—",
      s.status === "open" ? "مفتوحة" : "مغلقة",
      s.box === "store" ? "المتجر (سابقاً)" : "الخزينة الموحدة",
      s.closeNote ?? "—",
    ]);
    downloadCsvWithBom(`سجل_ورديات_الخزينة_${todayKey()}`, headers, dataRows);
    toast("success", "تم تصدير سجل الورديات إلى ملف إكسيل بنجاح");
  };

  const onDrawerDeposit = async () => {
    if (!actor || !openTotals) return;
    setDepositBusy(true);
    setDepositError(null);
    try {
      await api.cash.depositToDrawer({
        amountMinor: toMinor(depositAmount || "0"),
        note: depositNote || null,
        box: openTotals.session.box,
      });
      toast("success", t("cashPage.drawerDepositSuccess"));
      setDepositOpen(false);
      setDepositAmount("");
      setDepositNote("");
      reload();
    } catch (err) {
      setDepositError(describeError(err, t));
    } finally {
      setDepositBusy(false);
    }
  };

  const onOwnerWithdraw = async () => {
    if (!actor || !openTotals) return;
    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      await api.cash.withdrawByOwner({
        amountMinor: toMinor(withdrawAmount || "0"),
        note: withdrawNote || null,
        box: openTotals.session.box,
      });
      toast("success", t("cashPage.ownerWithdrawSuccess"));
      setWithdrawOpen(false);
      setWithdrawAmount("");
      setWithdrawNote("");
      reload();
    } catch (err) {
      setWithdrawError(describeError(err, t));
    } finally {
      setWithdrawBusy(false);
    }
  };

  useEffect(() => {
    if (!actor || !canViewUsers) return;
    let alive = true;
    api.users
      .list()
      .then((u) => {
        if (alive) setUsers(u);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [actor, canViewUsers]);

  useEffect(() => {
    if (!actor || !canView) return;
    api.expenses
      .categories()
      .then(setCategories)
      .catch(console.error);
  }, [actor, canView]);

  useEffect(() => {
    if (!actor || !canView || openTotals) return;
    let alive = true;
    api.cash
      .lastClosed(filterBox === "all" ? "gym" : filterBox)
      .then((res) => {
        if (alive) setLastClosedSession(res);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [actor, canView, openTotals, filterBox, reloadTick]);

  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    void api.cash
      .openTotals(activeBox)
      .then((totals) => {
        if (alive) {
          setOpenTotals(totals as (CashTotalsForOpen & { session: CashSession }) | null);
          setCountedMajor("");
          setCloseNote("");
        }
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [actor, canView, activeBox, reloadTick]);

  useEffect(() => {
    if (!actor || !canViewReports) return;
    let alive = true;
    void api.cash
      .list({
        page,
        pageSize: appConfig.pageSize,
        status: filterStatus,
        openedById: filterUser,
        box: filterBox,
        fromKey: filterFrom || undefined,
        toKey: filterTo || undefined,
        discrepancy: filterDiscrepancy,
      })
      .then((result) => {
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [
    actor,
    canViewReports,
    page,
    filterStatus,
    filterUser,
    filterBox,
    filterFrom,
    filterTo,
    filterDiscrepancy,
    reloadTick,
  ]);

  const onOpen = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      await api.cash.open({
        openingBalanceMinor: toMinor(openingMajor || "0"),
        box: filterBox === "all" ? "gym" : filterBox,
        gapReason: gapReason.trim() || null,
      });
      toast("success", t("cashPage.openedToast"));
      setOpeningMajor("");
      setGapReason("");
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onResolveGap = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolveTarget || !resolveNote.trim()) return;
    setResolveBusy(true);
    try {
      await api.cash.resolveGap({
        sessionId: resolveTarget.id,
        note: resolveNote.trim(),
        categoryId: resolveCategory || undefined,
      });
      toast("success", "تم توجيه العجز كمصروف بنجاح ويظهر الآن في قائمة المصروفات");
      setResolveTarget(null);
      setResolveNote("");
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setResolveBusy(false);
    }
  };

  const onDeleteOpenSession = async () => {
    if (!openTotals) return;
    setBusy(true);
    setError(null);
    try {
      await api.cash.removeSession(openTotals.session.id);
      toast("success", t("cashPage.sessionDeletedToast"));
      setConfirmAbort(false);
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteSession = async () => {
    if (!deleteSessionTarget) return;
    setBusy(true);
    try {
      await api.cash.removeSession(deleteSessionTarget.id);
      toast("success", t("cashPage.sessionDeletedToast"));
      setDeleteSessionTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onClose = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !openTotals) return;
    setBusy(true);
    setError(null);
    try {
      const closed = await api.cash.close(openTotals.session.id, {
        countedClosingMinor: toMinor(countedMajor || "0"),
        closeNote: closeNote || null,
      });
      setClosedSessionResult({
        id: closed.id,
        closingNo: closed.closingNo ?? null,
        countedMinor: toMinor(countedMajor || "0"),
        expectedMinor: openTotals.expectedMinor,
        differenceMinor: toMinor(countedMajor || "0") - openTotals.expectedMinor,
        closeNote: closeNote || null,
      });
      toast("success", t("cashPage.closedToast"));
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const previewDifference =
    openTotals && countedMajor !== ""
      ? toMinor(countedMajor) - openTotals.expectedMinor
      : null;

  interface Row {
    id: string;
    openedAt: string;
    closedAt: string | null;
    openedByName: string;
    closedByName: string | null;
    openingBalanceMinor: number;
    expectedClosingMinor: number | null;
    countedClosingMinor: number | null;
    differenceMinor: number | null;
    status: "open" | "closed";
    session: CashSession;
  }

  const rows: Row[] = items.map((s) => ({
    id: s.id,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openedByName: s.openedByName,
    closedByName: s.closedByName,
    openingBalanceMinor: s.openingBalanceMinor,
    expectedClosingMinor: s.expectedClosingMinor,
    countedClosingMinor: s.countedClosingMinor,
    differenceMinor: s.differenceMinor,
    status: s.status,
    session: s,
  }));

  const columns: Column<Row>[] = [
    {
      key: "opened",
      header: t("cashPage.colOpened"),
      render: (row) => (
        <span className="tabnum text-subtle">
          {formatDateShort(new Date(row.openedAt.replace(" ", "T")))}
          <span className="ms-1.5 text-[11px] text-faint">
            {formatTime(row.openedAt)}
          </span>
        </span>
      ),
    },
    {
      key: "closed",
      header: t("cashPage.colClosed"),
      render: (row) =>
        row.closedAt ? (
          <span className="tabnum text-subtle">
            {formatDateShort(new Date(row.closedAt.replace(" ", "T")))}
            <span className="ms-1.5 text-[11px] text-faint">
              {formatTime(row.closedAt)}
            </span>
          </span>
        ) : (
          <Badge variant="warning" dot>
            {t("cashPage.statusOpen")}
          </Badge>
        ),
    },
    {
      key: "by",
      header: "الموظف المسؤول",
      render: (row) => (
        <div className="flex flex-col text-xs">
          <span className="font-semibold text-foreground flex items-center gap-1">
            <span className="text-[10px] text-faint">فتح:</span> {row.openedByName}
          </span>
          {row.closedByName && row.closedByName !== row.openedByName ? (
            <span className="text-faint flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-amber">سلّم:</span> {row.closedByName}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "opening" as const,
      header: "رصيد الافتتاح",
      render: (row: Row) => (
        <span dir="ltr" className="font-bold tabnum text-foreground">
          {formatMinor(row.openingBalanceMinor)}
        </span>
      ),
    },
    {
      key: "handoverGap" as const,
      header: "تسليم الوردية السابقة",
      render: (row: Row) => {
        const gap = row.session.interShiftGapMinor ?? 0;
        const prevClosing = row.session.previousClosingMinor;
        if (prevClosing == null) {
          return <span className="text-xs text-faint">—</span>;
        }
        if (gap === 0) {
          return (
            <Badge variant="success" className="text-[10px]">
              مطابق ({formatMinor(prevClosing)})
            </Badge>
          );
        }
        if (gap < 0) {
          const deficit = Math.abs(gap);
          const isResolved = Boolean(row.session.gapExpenseId);
          return (
            <div className="flex flex-col gap-1 items-start text-xs">
              <Badge variant={isResolved ? "warning" : "danger"} className="text-[10px]">
                عجز تسليم: {formatMinor(deficit)}
              </Badge>
              {isResolved ? (
                <Link
                  to={`/expenses?highlight=${row.session.gapExpenseId}`}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 hover:underline transition-colors group cursor-pointer"
                  title={row.session.gapReason ? `السبب: ${row.session.gapReason} — اضغط لعرض العملية في المصروفات` : "اضغط لعرض العملية في المصروفات"}
                >
                  <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                  <span>✓ موجه لمصروف</span>
                  <ExternalLink className="size-2.5 opacity-70 group-hover:opacity-100 shrink-0" />
                </Link>
              ) : (
                hasPermission("expenses.create") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setResolveTarget(row.session);
                      setResolveNote(row.session.gapReason || "");
                    }}
                    className="text-[10px] h-6 px-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold cursor-pointer"
                  >
                    توجيه العجز لمصروف
                  </Button>
                )
              )}
            </div>
          );
        }
        return (
          <Badge variant="info" className="text-[10px]">
            زيادة تسليم: +{formatMinor(gap)}
          </Badge>
        );
      },
    },
    {
      key: "expected",
      header: t("cashPage.colExpected"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum">
          {row.expectedClosingMinor == null ? "—" : formatMinor(row.expectedClosingMinor)}
        </span>
      ),
    },
    {
      key: "counted",
      header: t("cashPage.colCounted"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum">
          {row.countedClosingMinor == null ? "—" : formatMinor(row.countedClosingMinor)}
        </span>
      ),
    },
    {
      key: "diff",
      header: t("cashPage.colDiff"),
      render: (row) =>
        row.differenceMinor == null ? (
          <span className="text-faint">—</span>
        ) : (
          <div className="flex flex-col gap-1 items-start">
            <Badge variant={row.differenceMinor === 0 ? "success" : row.differenceMinor > 0 ? "warning" : "danger"}>
              <span dir="ltr" className="tabnum font-bold">
                {row.differenceMinor === 0
                  ? t("cashPage.diffZeroMatched")
                  : row.differenceMinor > 0
                    ? t("cashPage.diffSurplusLabel", { amount: formatMinor(row.differenceMinor) })
                    : t("cashPage.diffShortageStaff", { amount: formatMinor(-row.differenceMinor), name: row.openedByName })}
              </span>
            </Badge>
            {row.session.closeNote ? (
              <span className="text-[11px] text-faint max-w-48 truncate" title={row.session.closeNote}>
                {row.session.closeNote}
              </span>
            ) : null}
          </div>
        ),
    },
    {
      key: "voucher" as const,
      header: "محضر الإقفال",
      align: "center" as const,
      render: (row: Row) =>
        row.status === "closed" ? (
          <VoucherActions kind="cash_closing" rowId={row.id} size="sm" />
        ) : (
          <span className="text-xs text-faint">—</span>
        ),
    },
    ...(hasPermission("cash.purge")
      ? [
          {
            key: "actions" as const,
            header: "",
            align: "end" as const,
            render: (row: Row) => (
              <button
                type="button"
                aria-label={t("common.delete")}
                onClick={() => setDeleteSessionTarget(row)}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-red/10 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            ),
          },
        ]
      : []),
  ];

  if (!canView) {
    return <EmptyState icon={<Wallet />} title={t("errors.forbidden")} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-foreground">الخزينة النقدية والورديات</h2>
          <p className="text-xs text-subtle mt-0.5">متابعة حركة النقدية، تسليم الدرج، وجرد العجز والزيادة بين الموظفين</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-400 shadow-sm">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>الخزينة النقدية الموحدة (الجيم والمتجر والبار)</span>
          </div>
        {openTotals ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDepositError(null);
              setDepositOpen(true);
            }}
            className="border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 gap-2 font-bold"
          >
            <ArrowDownCircle className="size-4" />
            {t("cashPage.drawerDepositBtn")}
          </Button>
        ) : null}
        {openTotals && isOwner ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setWithdrawError(null);
              setWithdrawOpen(true);
            }}
            className="border border-amber/40 text-amber hover:bg-amber/10 gap-2 font-bold"
          >
            <Banknote className="size-4" />
            {t("cashPage.ownerWithdrawBtn")}
          </Button>
        ) : null}
        </div>
      </div>

      {openTotals ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title={t("cashPage.cardOpening")}
              value={formatMinor(openTotals.openingMinor)}
              icon={<Wallet className="size-5" />}
              accent="cyan"
            />
            <StatCard
              title="المقبوضات النقدية (الجيم والمتجر)"
              value={formatMinor(openTotals.cashInMinor)}
              icon={<ArrowUpCircle className="size-5" />}
              accent="neon"
            />
            <StatCard
              title={t("cashPage.cardCashOut")}
              value={formatMinor(openTotals.cashOutMinor)}
              icon={<ArrowDownCircle className="size-5" />}
              accent="amber"
            />
            <StatCard
              title="الرصيد النقدي المتوقع بالدرج"
              value={formatMinor(openTotals.expectedMinor)}
              icon={<LockKeyhole className="size-5" />}
              accent="violet"
            />
          </section>

          {hasPermission("cash.close") && (
            canClose ? (
              <Card>
                <CardHeader
                  title={t("cashPage.closeSession")}
                  description={`${t("cashPage.sessionSince")} ${formatDateShort(new Date(openTotals.session.openedAt.replace(" ", "T")))} • ${formatTime(openTotals.session.openedAt)} · الموظف المستلم: ${openTotals.session.openedByName}`}
                />
                <form onSubmit={(e) => void onClose(e)} noValidate className="space-y-4 px-5 pb-5">
                  {openTotals.expectedMinor < 0 && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300 font-semibold space-y-1">
                      <div className="flex items-center gap-2 font-bold text-rose-400">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span>تنبيه: الرصيد المتوقع بالدرج سالب ({formatMinor(openTotals.expectedMinor)})</span>
                      </div>
                      <p>
                        المصروفات النقدية المسجلة أكبر من المقبوضات. يمكنك إيداع عهدة بالدرج لتسوية الرصيد عبر زر «إيداع عهدة بالدرج» بالأعلى، أو كتابة تبرير الإغلاق في حقل الملاحظة للاعتماد.
                      </p>
                    </div>
                  )}
                  {isOwner && !isOpener && (
                    <div className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12px] font-bold text-amber flex items-center gap-2">
                      <ShieldAlert className="size-4 shrink-0" />
                      إغلاق استثنائي: أنت تقوم بإغلاق الوردية نيابة عن ({openTotals.session.openedByName}) بصلاحية المالك.
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-foreground">
                            {t("cashPage.countedBalance")}
                          </label>
                          <button
                            type="button"
                            onClick={() => setCalcOpen((v) => !v)}
                            className="flex items-center gap-1 text-[11px] font-bold text-neon hover:underline"
                          >
                            <Calculator className="size-3" />
                            {calcOpen ? "إخفاء حاسبة الفئات" : "🧮 حاسبة عد الفئات"}
                          </button>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          dir="ltr"
                          value={countedMajor}
                          onChange={(e) => setCountedMajor(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <Input
                        label={t("cashPage.closeNote")}
                        value={closeNote}
                        onChange={(e) => setCloseNote(e.target.value)}
                        disabled={busy}
                      />
                    </div>

                    {calcOpen && (
                      <DenominationCalculator
                        onApply={(totalVal) => {
                          setCountedMajor(totalVal);
                          setCalcOpen(false);
                          toast("info", `تم اعتماد الرصيد المعدود: ${totalVal} ج.م`);
                        }}
                      />
                    )}
                  </div>

                  {previewDifference !== null && Number.isFinite(previewDifference) && (
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm font-extrabold ${
                        previewDifference === 0
                          ? "border-neon/30 bg-neon/10 text-neon"
                          : previewDifference > 0
                            ? "border-amber/30 bg-amber/10 text-amber"
                            : "border-red/30 bg-red/10 text-red"
                      }`}
                    >
                      {t("cashPage.difference")}:{" "}
                      <span dir="ltr" className="tabnum">
                        {previewDifference === 0
                          ? t("cashPage.diffZeroMatched")
                          : previewDifference > 0
                            ? t("cashPage.diffSurplus", { amount: formatMinor(previewDifference) })
                            : t("cashPage.diffShortage", { amount: formatMinor(-previewDifference) })}
                      </span>
                    </div>
                  )}

                  <p className="rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5 text-[12px] font-semibold text-amber">
                    {t("cashPage.closeWarning")}
                  </p>

                  {error && (
                    <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                      {error}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button type="submit" loading={busy} disabled={busy || countedMajor === ""}>
                      <LockKeyhole className="size-4" />
                      {t("cashPage.closeBtn")}
                    </Button>
                    {hasPermission("cash.purge") && (
                      <Button type="button" variant="ghost" className="text-red hover:text-red" disabled={busy}
                        onClick={() => setConfirmAbort(true)}>
                        {t("cashPage.deleteSessionBtn")}
                      </Button>
                    )}
                  </div>
                </form>
              </Card>
            ) : (
              <Card>
                <div className="p-5 flex items-start gap-3.5">
                  <div className="grid size-10 place-items-center rounded-xl bg-amber/15 text-amber shrink-0">
                    <ShieldAlert className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-foreground">الوردية الحالية قيد التشغيل بواسطة موظف آخر</h4>
                    <p className="text-xs text-subtle leading-relaxed">
                      {t("cashPage.sessionOwnedByOther", { name: openTotals.session.openedByName })}
                    </p>
                    <p className="text-[11px] text-faint">
                      تم فتح هذه الوردية في {formatDateShort(new Date(openTotals.session.openedAt.replace(" ", "T")))} • {formatTime(openTotals.session.openedAt)}. لا يمكن استلام الدرج وفتح وردية جديدة إلا بعد قيام الموظف المسؤول ({openTotals.session.openedByName}) أو المالك بإغلاقها وتوثيق رصيدها.
                    </p>
                  </div>
                </div>
              </Card>
            )
          )}
        </>
      ) : (
        hasPermission("cash.open") && (
          <Card>
            <CardHeader
              title={t("cashPage.openSession")}
              description="بدء وردية استلام الخزينة وجرد النقدية الافتتاحية في الدرج"
            />
            <div className="px-5 pb-5 space-y-4">
              {/* بطاقة توضيحية لآخر رصيد إغلاق مرحل */}
              {lastClosedSession && (
                <div className="p-3.5 rounded-2xl border border-line bg-surface/50 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-subtle block">
                      الرصيد الفعلي المرحل من آخر وردية مغلقة (الخزينة الموحدة):
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-black text-white tabnum">
                        {formatMinor(lastClosedSession.countedClosingMinor ?? lastClosedSession.expectedClosingMinor ?? 0)}
                      </span>
                      <span className="text-xs text-subtle">
                        (الموظف: {lastClosedSession.closedByName || lastClosedSession.openedByName} • {formatDateShort(new Date(lastClosedSession.closedAt?.replace(" ", "T") || ""))} {formatTime(lastClosedSession.closedAt)})
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const prevVal = ((lastClosedSession.countedClosingMinor ?? lastClosedSession.expectedClosingMinor ?? 0) / 100).toFixed(2);
                      setOpeningMajor(prevVal);
                      toast("info", `تم ملء رصيد الفتح مطابقاً لرصيد الإغلاق السابق (${prevVal} ج.م)`);
                    }}
                    className="text-xs font-bold h-8 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                  >
                    استلام نفس رصيد الإغلاق السابق
                  </Button>
                </div>
              )}

              <form onSubmit={(e) => void onOpen(e)} noValidate className="max-w-xl space-y-4">
                <div>
                  <Input
                    label={t("cashPage.openingBalance")}
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={openingMajor}
                    onChange={(e) => setOpeningMajor(e.target.value)}
                    disabled={busy}
                    placeholder={lastClosedSession ? ((lastClosedSession.countedClosingMinor ?? lastClosedSession.expectedClosingMinor ?? 0) / 100).toFixed(2) : "0.00"}
                    autoFocus
                  />
                  <p className="mt-1 text-[11px] text-faint">{t("cashPage.openingHint")}</p>
                </div>

                {/* كشف وتنبيه العجز عند الفتح */}
                {lastClosedSession && openingMajor !== "" && (() => {
                  const prevClosing = lastClosedSession.countedClosingMinor ?? lastClosedSession.expectedClosingMinor ?? 0;
                  const entered = toMinor(openingMajor);
                  const gap = entered - prevClosing;
                  if (gap < 0) {
                    const deficit = Math.abs(gap);
                    return (
                      <div className="p-3.5 rounded-xl border border-red-500/40 bg-red-500/10 space-y-2.5 animate-in fade-in duration-200">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="size-5 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-xs font-bold text-red-300">
                              تنبيه: وجود عجز تسليم بين الوردية السابقة والوردية الجديدة!
                            </h4>
                            <p className="text-xs text-subtle mt-0.5 leading-relaxed">
                              الرصيد الفعلي في نهاية الوردية السابقة كان <span className="font-bold text-white tabnum">{formatMinor(prevClosing)}</span>، ولكنك تقوم بفتح الوردية بمبلغ <span className="font-bold text-white tabnum">{formatMinor(entered)}</span>.
                              يوجد عجز تسليم قدره <span className="font-bold text-red-400 tabnum">{formatMinor(deficit)}</span>.
                            </p>
                          </div>
                        </div>
                        <Input
                          label="توضيح مبدئي لسبب العجز (اختياري - يمكنك توجيهه كمصروف لاحقاً)"
                          placeholder="مثال: فاتورة مشتريات نثريات نسي الكاشير السابق تسجيلها، أو مسحوبات مالك..."
                          value={gapReason}
                          onChange={(e) => setGapReason(e.target.value)}
                          disabled={busy}
                          className="text-xs bg-panel/80"
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                {error && (
                  <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                    {error}
                  </p>
                )}

                <Button type="submit" loading={busy} disabled={busy} className="font-bold">
                  <Wallet className="size-4" />
                  {t("cashPage.openBtn")}
                </Button>
              </form>
            </div>
          </Card>
        )
      )}

      {canViewReports && (
      <Card>
        <CardHeader
          title={t("cashPage.historyTitle")}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={!filterFrom && !filterTo ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setFilterFrom("");
                  setFilterTo("");
                  setPage(1);
                }}
                className="text-xs h-7 px-2.5"
              >
                الكل
              </Button>
              <Button
                variant={filterFrom === todayKey() && filterTo === todayKey() ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  const today = todayKey();
                  setFilterFrom(today);
                  setFilterTo(today);
                  setPage(1);
                }}
                className="text-xs h-7 px-2.5"
              >
                اليوم
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  const sevenDaysAgo = dateKey(new Date(now.getTime() - 7 * 86400000));
                  setFilterFrom(sevenDaysAgo);
                  setFilterTo(todayKey());
                  setPage(1);
                }}
                className="text-xs h-7 px-2.5"
              >
                آخر 7 أيام
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportCsv}
                disabled={items.length === 0}
                className="text-xs h-7 px-2.5 gap-1.5 font-bold border border-emerald/40 text-emerald hover:bg-emerald/10"
              >
                <FileSpreadsheet className="size-3.5" />
                تصدير Excel
              </Button>
            </div>
          }
        />

        <div className="border-b border-line/40 bg-subtle/5 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              label="الموظف المسؤول"
              value={filterUser}
              onChange={(e) => {
                setFilterUser(e.target.value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "جميع الموظفين" },
                ...users.map((u) => ({ value: u.id, label: u.fullName || u.username })),
              ]}
            />
            <Select
              label="الدرج / الصندوق"
              value={filterBox}
              onChange={(e) => {
                setFilterBox(e.target.value as "all" | "gym" | "store");
                setPage(1);
              }}
              options={[
                { value: "all", label: "جميع الصناديق" },
                { value: "gym", label: "صندوق الجيم" },
                { value: "store", label: "صندوق المتجر" },
              ]}
            />
            <Select
              label="حالة الوردية"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as "all" | "open" | "closed");
                setPage(1);
              }}
              options={[
                { value: "all", label: "الكل" },
                { value: "open", label: "مفتوحة حالياً" },
                { value: "closed", label: "مغلقة" },
              ]}
            />
            <Select
              label="حالة المطابقة والجرد"
              value={filterDiscrepancy}
              onChange={(e) => {
                setFilterDiscrepancy(e.target.value as any);
                setPage(1);
              }}
              options={[
                { value: "all", label: "الكل" },
                { value: "exact", label: "مطابقة تماماً (بدون فرق)" },
                { value: "difference", label: "يوجد فرق (عجز أو زيادة)" },
                { value: "shortage", label: "يوجد عجز نقدي فقط" },
                { value: "surplus", label: "يوجد فائض نقدي فقط" },
              ]}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                label="من تاريخ"
                type="date"
                dir="ltr"
                value={filterFrom}
                onChange={(e) => {
                  setFilterFrom(e.target.value);
                  setPage(1);
                }}
              />
              <Input
                label="إلى تاريخ"
                type="date"
                dir="ltr"
                value={filterTo}
                onChange={(e) => {
                  setFilterTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Wallet />} title={t("cashPage.historyEmpty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} highlightRowKey={focusRowId} />
            <Pagination page={page} pageSize={appConfig.pageSize} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>
      )}

      <ConfirmDialog
        open={confirmAbort}
        onClose={() => setConfirmAbort(false)}
        title={t("cashPage.deleteSessionBtn")}
        message={t("cashPage.deleteSessionConfirm")}
        confirmLabel={t("common.confirm")}
        onConfirm={() => void onDeleteOpenSession()}
      />

      <ConfirmDialog
        open={deleteSessionTarget !== null}
        onClose={() => setDeleteSessionTarget(null)}
        title={t("cashPage.deleteSessionBtn")}
        message={t("cashPage.deleteClosedSessionConfirm")}
        confirmLabel={t("common.delete")}
        tone="danger"
        loading={busy}
        onConfirm={() => void onDeleteSession()}
      />

      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t("cashPage.ownerWithdrawTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={withdrawBusy}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              loading={withdrawBusy}
              disabled={withdrawBusy || !withdrawAmount || Number(withdrawAmount) <= 0}
              onClick={() => void onOwnerWithdraw()}
            >
              <Banknote className="size-4" />
              {t("cashPage.ownerWithdrawBtn")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-subtle leading-relaxed">
            {t("cashPage.ownerWithdrawDesc")}
          </p>
          <div className="rounded-xl border border-amber/30 bg-amber/10 p-3.5 text-xs text-amber leading-relaxed font-semibold">
            {t("cashPage.ownerWithdrawNotice")}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-subtle px-1">
              <span>النقدية المتوقعة بالصندوق حالياً:</span>
              <span dir="ltr" className="font-extrabold text-foreground">{formatMinor(openTotals?.expectedMinor ?? 0)}</span>
            </div>
            {openTotals && openTotals.expectedMinor > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[11px] text-faint">نسبة سحب:</span>
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      const val = Math.floor((openTotals.expectedMinor * pct) / 100) / 100;
                      setWithdrawAmount(val.toFixed(2));
                    }}
                    className="rounded-lg border border-line/60 bg-subtle/5 px-2 py-0.5 text-[11px] font-semibold text-subtle hover:border-amber hover:text-amber hover:bg-amber/10 transition-colors"
                  >
                    {pct === 100 ? "كامل المتاح" : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
            <Input
              label={t("cashPage.ownerWithdrawAmount")}
              type="number"
              min={0.01}
              step="0.01"
              dir="ltr"
              autoFocus
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={withdrawBusy}
            />
            <Input
              label={t("cashPage.ownerWithdrawNote")}
              placeholder={t("cashPage.ownerWithdrawNotePh")}
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              disabled={withdrawBusy}
            />
          </div>
          {withdrawError && (
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
              {withdrawError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title={t("cashPage.drawerDepositTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDepositOpen(false)} disabled={depositBusy}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2"
              loading={depositBusy}
              disabled={depositBusy || !depositAmount || Number(depositAmount) <= 0}
              onClick={() => void onDrawerDeposit()}
            >
              <ArrowDownCircle className="size-4" />
              {t("cashPage.drawerDepositBtn")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-subtle leading-relaxed">
            {t("cashPage.drawerDepositDesc")}
          </p>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300 leading-relaxed font-semibold">
            {t("cashPage.drawerDepositNotice")}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-subtle px-1">
              <span>النقدية المتوقعة بالدرج حالياً:</span>
              <span dir="ltr" className={`font-extrabold ${openTotals && openTotals.expectedMinor < 0 ? "text-rose-400" : "text-foreground"}`}>
                {formatMinor(openTotals?.expectedMinor ?? 0)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[11px] text-faint">مبالغ سريعة:</span>
              {[200, 500, 1000, 2000, 5000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setDepositAmount(String(amt))}
                  className="rounded-lg border border-line/60 bg-subtle/5 px-2 py-0.5 text-[11px] font-semibold text-subtle hover:border-emerald-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  +{amt} ج.م
                </button>
              ))}
            </div>
            <Input
              label={t("cashPage.drawerDepositAmount")}
              type="number"
              min={1}
              step="1"
              dir="ltr"
              autoFocus
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={depositBusy}
              placeholder="مثال: 500"
            />
            <Input
              label={t("cashPage.drawerDepositNote")}
              placeholder={t("cashPage.drawerDepositNotePh")}
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              disabled={depositBusy}
            />
          </div>
          {depositError && (
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
              {depositError}
            </p>
          )}
        </div>
      </Modal>

      {/* Modal 3: Post-Close Voucher & Handover Summary */}
      <Modal
        open={closedSessionResult !== null}
        onClose={() => setClosedSessionResult(null)}
        title="محضر إقفال الوردية واستلام النقدية"
        footer={
          <div className="flex items-center justify-between w-full">
            {closedSessionResult && (
              <VoucherActions kind="cash_closing" rowId={closedSessionResult.id} size="sm" />
            )}
            <Button type="button" onClick={() => setClosedSessionResult(null)}>
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        {closedSessionResult && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald/30 bg-emerald/10 text-emerald">
              <CheckCircle2 className="size-6 shrink-0" />
              <div>
                <h4 className="font-bold text-sm">تم إقفال الوردية وتوثيق الخزينة بنجاح</h4>
                <p className="text-xs text-emerald/90">
                  تم تسجيل محضر الإقفال رقم: {closedSessionResult.closingNo ?? `#${closedSessionResult.id.slice(0, 8)}`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-line bg-subtle/5 space-y-1">
                <span className="text-subtle">الرصيد الدفتري المتوقع</span>
                <p dir="ltr" className="font-mono font-bold text-base text-foreground">
                  {formatMinor(closedSessionResult.expectedMinor)}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-line bg-subtle/5 space-y-1">
                <span className="text-subtle">الرصيد الفعلي المعدود</span>
                <p dir="ltr" className="font-mono font-bold text-base text-foreground">
                  {formatMinor(closedSessionResult.countedMinor)}
                </p>
              </div>
            </div>

            <div
              className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-between ${
                closedSessionResult.differenceMinor === 0
                  ? "border-emerald/30 bg-emerald/10 text-emerald"
                  : closedSessionResult.differenceMinor > 0
                  ? "border-amber/30 bg-amber/10 text-amber"
                  : "border-red/30 bg-red/10 text-red"
              }`}
            >
              <span>نتيجة الجرد والمطابقة:</span>
              <span dir="ltr" className="font-mono text-sm">
                {closedSessionResult.differenceMinor === 0
                  ? "مطابقة تامة (بدون فرق)"
                  : closedSessionResult.differenceMinor > 0
                  ? `فائض: +${formatMinor(closedSessionResult.differenceMinor)}`
                  : `عجز: ${formatMinor(closedSessionResult.differenceMinor)}`}
              </span>
            </div>

            {closedSessionResult.closeNote && (
              <div className="p-3 rounded-xl border border-line bg-subtle/5 text-xs text-subtle">
                <span className="font-bold text-foreground">ملاحظة الإغلاق: </span>
                {closedSessionResult.closeNote}
              </div>
            )}

            <p className="text-[11px] text-faint">
              يمكنك طباعة محضر الإقفال فورياً بالضغط على زر الطباعة أدناه، أو تحميل نسخة PDF للأرشيف.
            </p>
          </div>
        )}
      </Modal>

      {/* نافذة توجيه وتبرير عجز تسليم الوردية كمصروف */}
      {resolveTarget && (
        <Modal
          open={!!resolveTarget}
          onClose={() => setResolveTarget(null)}
          title="توجيه وتبرير عجز تسليم الوردية كمصروف"
          widthClass="max-w-lg"
          footer={
            <>
              <Button
                type="submit"
                form="resolve-gap-form"
                loading={resolveBusy}
                disabled={resolveBusy || !resolveNote.trim()}
                className="bg-red-500 text-white font-bold hover:bg-red-600"
              >
                تسجيل العجز كمصروف وتأكيد
              </Button>
              <Button variant="secondary" onClick={() => setResolveTarget(null)} disabled={resolveBusy}>
                {t("common.cancel")}
              </Button>
            </>
          }
        >
          <form id="resolve-gap-form" onSubmit={(e) => void onResolveGap(e)} noValidate className="space-y-4">
            <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-subtle">الوردية المعنية:</span>
                <span className="font-bold text-white tabnum">#{resolveTarget.closingNo || resolveTarget.id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-subtle">الموظف المسؤول:</span>
                <span className="font-bold text-white">{resolveTarget.openedByName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-subtle">رصيد إغلاق الوردية السابقة:</span>
                <span className="font-bold text-white tabnum">{formatMinor(resolveTarget.previousClosingMinor || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-subtle">رصيد افتتاح هذه الوردية:</span>
                <span className="font-bold text-white tabnum">{formatMinor(resolveTarget.openingBalanceMinor)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-red-500/20 text-sm">
                <span className="font-bold text-red-300">مبلغ العجز المراد توثيقه:</span>
                <span className="font-black text-red-400 tabnum text-base">
                  {formatMinor(Math.abs(resolveTarget.interShiftGapMinor || 0))}
                </span>
              </div>
            </div>

            <Select
              label="تصنيف المصروف المراد توجيه العجز إليه"
              value={resolveCategory}
              onChange={(e) => setResolveCategory(e.target.value)}
              disabled={resolveBusy}
              options={[
                { value: "cat-cash-shortage", label: "عجز ونواقص الخزينة (عجز)" },
                ...categories
                  .filter((c) => c.id !== "cat-cash-shortage")
                  .map((c) => ({ value: c.id, label: c.nameAr })),
              ]}
            />

            <div>
              <Input
                label="أين ذهب هذا المبلغ؟ (سبب ومبرر العجز)"
                placeholder="اكتب تفاصيل سبب العجز (مثال: نثريات لم تسجل، أو مسحوبات مالك...)"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                disabled={resolveBusy}
                required
                autoFocus
              />
              <p className="mt-1 text-[11px] text-subtle">
                سيتم إنشاء قيد مصروف رسمي بهذا المبلغ والتصنيف، وسيظهر بوضوح في تقارير المصروفات والفلترة تحت تصنيف "عجز".
              </p>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** Interactive Denomination Calculator for Cashiers */
function DenominationCalculator({
  onApply,
  label = "اعتماد الرصيد",
}: {
  onApply: (totalMajor: string) => void;
  label?: string;
}) {
  const [denoms, setDenoms] = useState<Record<number, number>>({
    200: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0,
    5: 0,
    1: 0,
  });

  const total = Object.entries(denoms).reduce((acc, [denom, count]) => {
    return acc + Number(denom) * (Number(count) || 0);
  }, 0);

  const reset = () => {
    setDenoms({ 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
  };

  const update = (d: number, count: string) => {
    const val = Math.max(0, parseInt(count, 10) || 0);
    setDenoms((prev) => ({ ...prev, [d]: val }));
  };

  return (
    <div className="rounded-xl border border-line/60 bg-subtle/10 p-3.5 space-y-3">
      <div className="flex items-center justify-between border-b border-line/30 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          <Calculator className="size-4 text-neon" />
          <span>حاسبة عد النقدية والفئات الورقية (الجنيه المصري)</span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-[11px] text-faint hover:text-red transition-colors"
        >
          تفريغ العداد
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[200, 100, 50, 20, 10, 5, 1].map((d) => (
          <div key={d} className="flex flex-col gap-1 p-2 rounded-lg bg-panel border border-line/40">
            <div className="flex items-center justify-between text-[11px] font-semibold text-subtle">
              <span>فئة {d} ج.م</span>
              <span className="font-mono text-faint">={(denoms[d] || 0) * d}</span>
            </div>
            <input
              type="number"
              min={0}
              placeholder="0"
              value={denoms[d] || ""}
              onChange={(e) => update(d, e.target.value)}
              className="h-7 w-full rounded-md border border-line/50 bg-background px-2 text-center font-mono text-xs text-foreground focus:border-neon focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line/30">
        <div className="text-xs">
          <span className="text-subtle">الإجمالي المحسوب: </span>
          <span dir="ltr" className="font-mono text-sm font-black text-neon">{total} ج.م</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onApply(String(total))}
          disabled={total <= 0}
          className="text-xs h-7 px-3 border border-neon/40 text-neon hover:bg-neon/10 font-bold"
        >
          {label}: {total} ج.م
        </Button>
      </div>
    </div>
  );
}
