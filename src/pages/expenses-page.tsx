import { useEffect, useState } from "react";
import { Pencil, Plus, ReceiptText, Tags, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type Expense, type ExpenseCategory } from "@/api";
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
import { ExpenseFormModal, ExpenseCategoriesModal, ExpenseVoidModal } from "@/components/finance/expense-form-modal";

export function ExpensesPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [methodCode, setMethodCode] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

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
        status: "active" as ExpenseStatus | "all",
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
  }, [actor, debounced, fromKey, toKey, categoryId, methodCode, page, reloadTick]);

  const totalMinor = items.reduce((sum, e) => sum + e.amountMinor, 0);

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
      key: "ref",
      header: t("exp.colRef"),
      render: (row) => <span dir="ltr" className="text-faint tabnum">{row.referenceNo ?? "—"}</span>,
    },
    { key: "by", header: t("exp.colBy"), render: (row) => <span className="text-faint">{row.createdByName}</span> },
    {
      key: "actions",
      header: t("common.actions"),
      render: (row) =>
        hasPermission("expenses.edit") ? (
          <div className="flex items-center gap-1">
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
            <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row.expense)}>
              <Undo2 className="size-3.5" />
              {t("exp.actionVoid")}
            </Button>
          </div>
        ) : (
          <span className="text-[11px] text-faint">—</span>
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

      <StatCard
        title={t("rpt.expenses")}
        subtitle={`${t("rpt.count", { count: formatNumber(total) })}`}
        value={minorToMajor(totalMinor).toFixed(2)}
        icon={<ReceiptText className="size-5" />}
        accent="red"
      />

      <Card>
        <CardHeader title={t("common.search")} />
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-5">
          <Input placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
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
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title={t("exp.empty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
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
    </div>
  );
}
