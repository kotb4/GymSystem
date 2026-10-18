import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Info, Layers, Pencil, Plus, ReceiptText, RotateCcw, Tags, TrendingDown, Undo2, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type Expense, type ExpenseCategory, type ExpenseStats } from "@/api";
import type { ExpenseStatus } from "@/core/services/expenses.service";
import { formatMinor, minorToMajor } from "@/core/money";
import { appConfig } from "@/config/app.config";
import { formatDateShort, formatNumber } from "@/services/format";
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
import { ExpenseFormModal, ExpenseCategoriesModal, ExpenseVoidModal } from "@/components/finance/expense-form-modal";
import { BranchBadge } from "@/components/ui/branch-badge";
import { VoucherActions } from "@/components/finance/voucher-actions";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { todayKey } from "@/core/dates";
import { FinanceHubHeader } from "@/components/finance/finance-hub-header";

export function ExpensesPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") || searchParams.get("id");

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [methodCode, setMethodCode] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | "all">("active");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ExpenseStats | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [unvoidTarget, setUnvoidTarget] = useState<Expense | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

  useEffect(() => {
    if (highlightId) {
      setSearch(highlightId);
      setDebounced(highlightId);
      setStatusFilter("all");
      setCategoryId("all");
      setMethodCode("all");
      setFromKey("");
      setToKey("");
      setPage(1);
    }
  }, [highlightId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    void api.expenses
      .categories()
      .then((cats) => {
        if (alive) setCategories(cats);
      })
      .catch((err) => console.error(err));
    api.payments
      .methods()
      .then((m) => {
        if (alive) setMethods(m);
      })
      .catch((err) => console.error(err));
    api.expenses
      .stats()
      .then((res) => {
        if (alive) setStats(res);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.expenses
      .list({
        page,
        pageSize: appConfig.pageSize,
        search: debounced || undefined,
        fromKey: fromKey || undefined,
        toKey: toKey || undefined,
        categoryId,
        methodCode,
        status: statusFilter,
      })
      .then((result) => {
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, debounced, fromKey, toKey, categoryId, methodCode, statusFilter, page, reloadTick]);

  const onExportExpenses = () => {
    if (items.length === 0) {
      toast("info", t("exp.empty"));
      return;
    }
    const headers = [
      t("exp.colDate"),
      t("exp.colCategory"),
      t("exp.colDescription"),
      t("exp.colAmount"),
      t("exp.colMethod"),
      t("exp.colRef"),
      t("exp.colStatus"),
      t("exp.colBy"),
    ];
    const dataRows = items.map((e) => [
      e.expenseDate,
      e.categoryNameAr,
      e.description,
      (e.amountMinor / 100).toFixed(2),
      e.methodLabel,
      e.referenceNo ?? "—",
      e.status === "active" ? t("exp.statusActive") : t("exp.statusVoided"),
      e.createdByName,
    ]);
    downloadCsvWithBom(`المصروفات_${todayKey()}`, headers, dataRows);
    toast("success", t("exp.exportSuccess"));
  };

  interface Row {
    id: string;
    expenseDate: string;
    categoryNameAr: string;
    description: string;
    amountMinor: number;
    methodLabel: string;
    referenceNo: string | null;
    status: ExpenseStatus;
    createdByName: string;
    expense: Expense;
  }

  const rows: Row[] = items.map((e) => ({
    id: e.id,
    expenseDate: e.expenseDate,
    categoryNameAr: e.categoryNameAr,
    description: e.description,
    amountMinor: e.amountMinor,
    methodLabel: e.methodLabel,
    referenceNo: e.referenceNo,
    status: e.status,
    createdByName: e.createdByName,
    expense: e,
  }));

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: t("exp.colDate"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(new Date(`${row.expenseDate}T00:00:00`))}</span>
      ),
    },
    {
      key: "category",
      header: t("exp.colCategory"),
      render: (row) => <Badge variant="neutral">{row.categoryNameAr}</Badge>,
    },
    { key: "desc", header: t("exp.colDescription"), render: (row) => <span className="font-bold">{row.description}</span> },
    {
      key: "amount",
      header: t("exp.colAmount"),
      render: (row) => (
        <span dir="ltr" className="font-extrabold tabnum text-red">
          {formatMinor(row.amountMinor)}
        </span>
      ),
    },
    { key: "method", header: t("exp.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.expense.branchId} />,
    },
    {
      key: "ref",
      header: t("exp.colRef"),
      render: (row) => <span dir="ltr" className="text-faint tabnum">{row.referenceNo ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("exp.colStatus"),
      render: (row) =>
        row.status === "active" ? (
          <Badge variant="success">{t("exp.statusActive")}</Badge>
        ) : (
          <Badge variant="danger">{t("exp.statusVoided")}</Badge>
        ),
    },
    { key: "by", header: t("exp.colBy"), render: (row) => <span className="text-faint">{row.createdByName}</span> },
    {
      key: "actions",
      header: t("common.actions"),
      render: (row) => (
        <div className="flex items-center gap-1">
          <VoucherActions kind="expense" rowId={row.id} />
          {hasPermission("expenses.edit") && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditTarget(row.expense);
                  setFormOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
                {t("common.edit")}
              </Button>
              {row.status === "active" ? (
                <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row.expense)}>
                  <Undo2 className="size-3.5" />
                  {t("exp.actionVoid")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setUnvoidTarget(row.expense)}>
                  <RotateCcw className="size-3.5" />
                  {t("exp.actionRestore")}
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  const canCreate = hasPermission("expenses.create");

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("exp.title")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onExportExpenses}>
            <Download className="size-4" />
            {t("exp.exportExpenses")}
          </Button>
          {hasPermission("expenses.edit") && (
            <Button variant="secondary" onClick={() => setCatsOpen(true)}>
              <Tags className="size-4" />
              {t("exp.manageCategories")}
            </Button>
          )}
          {canCreate && (
            <Button
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("exp.addExpense")}
            </Button>
          )}
        </div>
      </section>

      {/* Finance Hub Navigation & Live Telemetry Strip */}
      <FinanceHubHeader currentSection="expenses" />

      {/* 4 Professional KPI Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("exp.todayExpenses")}
          subtitle={`${t("rpt.count", { count: formatNumber(stats?.todayCount ?? 0) })}`}
          value={minorToMajor(stats?.todayTotalMinor ?? 0).toFixed(2)}
          icon={<TrendingDown className="size-5" />}
          accent="amber"
        />
        <StatCard
          title={t("exp.monthExpenses")}
          subtitle={`${t("rpt.count", { count: formatNumber(stats?.monthCount ?? 0) })}`}
          value={minorToMajor(stats?.monthTotalMinor ?? 0).toFixed(2)}
          icon={<ReceiptText className="size-5" />}
          accent="red"
        />
        <StatCard
          title={t("exp.topCategory")}
          subtitle={
            stats?.topCategoryName
              ? `${formatMinor(stats.topCategoryMinor)}`
              : "—"
          }
          value={stats?.topCategoryName ?? "—"}
          icon={<Layers className="size-5" />}
          accent="cyan"
        />
        <StatCard
          title={t("exp.cashOutflow")}
          subtitle={t("dashboard.trendsThisMonth")}
          value={minorToMajor(stats?.monthCashMinor ?? 0).toFixed(2)}
          icon={<Wallet className="size-5" />}
          accent="violet"
        />
      </div>

      {highlightId && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-neon/40 bg-neon/10 text-xs font-semibold text-neon shadow-sm">
          <div className="flex items-center gap-2">
            <Info className="size-4 shrink-0 text-neon" />
            <span className="size-2 rounded-full bg-neon animate-pulse" />
            <span>
              عرض تفاصيل المصروف المسجل لتغطية عجز تسليم الوردية (المعرف: <span className="font-mono text-white">{highlightId.slice(0, 8)}...</span>)
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-xs h-7 px-2.5 text-white hover:bg-white/10"
            onClick={() => {
              setSearchParams({});
              setSearch("");
              setDebounced("");
              setStatusFilter("active");
              setPage(1);
            }}
          >
            عرض كافة المصروفات
          </Button>
        </div>
      )}

      <Card>
        <CardHeader title={t("common.search")} />
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-6">
          <Input label={t("common.search")} placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input
            label={t("pay.filterFrom")}
            type="date"
            dir="ltr"
            value={fromKey}
            onChange={(e) => {
              setFromKey(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label={t("pay.filterTo")}
            type="date"
            dir="ltr"
            value={toKey}
            onChange={(e) => {
              setToKey(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label={t("exp.filterCategory")}
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("common.all") },
              ...categories.map((c) => ({ value: c.id, label: c.nameAr })),
            ]}
          />
          <Select
            label={t("exp.colMethod")}
            value={methodCode}
            onChange={(e) => {
              setMethodCode(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("common.all") },
              ...methods.map((m) => ({ value: m.code, label: m.labelAr })),
            ]}
          />
          <Select
            label={t("exp.colStatus")}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as ExpenseStatus | "all");
              setPage(1);
            }}
            options={[
              { value: "all", label: t("exp.statusAll") },
              { value: "active", label: t("exp.statusActive") },
              { value: "voided", label: t("exp.statusVoided") },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title={t("exp.empty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} highlightRowKey={highlightId} />
            <Pagination page={page} pageSize={appConfig.pageSize} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <ExpenseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        expense={editTarget}
      />
      <ExpenseCategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} onChanged={reload} />
      <ExpenseVoidModal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onDone={reload}
        expense={voidTarget}
      />
      <ConfirmDialog
        open={unvoidTarget !== null}
        onClose={() => setUnvoidTarget(null)}
        title={t("exp.restoreConfirmTitle")}
        message={t("exp.restoreConfirmMsg")}
        onConfirm={() => {
          if (!unvoidTarget) return;
          api.expenses
            .unvoid(unvoidTarget.id)
            .then(() => {
              toast("success", t("exp.restoredToast"));
              setUnvoidTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)));
        }}
      />
    </div>
  );
}
