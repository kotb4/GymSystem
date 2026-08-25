import { useEffect, useMemo, useState } from "react";
import { Banknote, RotateCcw, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type Payment } from "@/api";
import type { PaymentStatus } from "@/core/services/payments.service";
import { formatMinor, minorToMajor } from "@/core/money";
import { appConfig } from "@/config/app.config";
import { formatDateShort, formatNumber } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PaymentFormModal } from "@/components/finance/payment-form-modal";
import { PaymentRefundModal, PaymentVoidModal } from "@/components/finance/payment-actions";

const STATUS_OPTIONS: Array<{ value: string; key: string }> = [
  { value: "all", key: "common.all" },
  { value: "paid", key: "payStatus.paid" },
  { value: "partial", key: "payStatus.partial" },
  { value: "voided", key: "payStatus.voided" },
  { value: "refunded", key: "payStatus.refunded" },
];

function statusVariant(status: PaymentStatus): BadgeVariant {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  return "danger";
}

export function PaymentsPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [status, setStatus] = useState("all");
  const [methodCode, setMethodCode] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
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
    api.payments
      .methods()
      .then((m) => {
        if (alive) setMethods(m);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.payments
      .list({
        page,
        pageSize: appConfig.pageSize,
        search: debounced || undefined,
        fromKey: fromKey || undefined,
        toKey: toKey || undefined,
        status: status as PaymentStatus | "all",
        methodCode,
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
  }, [actor, debounced, fromKey, toKey, status, methodCode, page, reloadTick]);

  const stats = useMemo(() => {
    let collectedMinor = 0;
    let remainingMinor = 0;
    for (const p of items) {
      if (p.status === "paid" || p.status === "partial") collectedMinor += p.paidAmountMinor;
      if (p.status === "partial") remainingMinor += p.remainingAmountMinor;
    }
    return { collectedMinor, remainingMinor, count: total };
  }, [items, total]);

  interface Row {
    id: string;
    paidAt: string;
    memberName: string;
    purpose: string;
    netMinor: number;
    discountMinor: number;
    paidMinor: number;
    remainingMinor: number;
    methodLabel: string;
    status: PaymentStatus;
    createdByName: string;
    payment: Payment;
  }

  const rows: Row[] = items.map((p) => ({
    id: p.id,
    paidAt: p.paidAt,
    memberName: `${p.memberName} · ${p.memberCode}`,
    purpose: p.planName ?? t("pay.noSub"),
    netMinor: p.netAmountMinor,
    discountMinor: p.discountAmountMinor,
    paidMinor: p.paidAmountMinor,
    remainingMinor: p.remainingAmountMinor,
    methodLabel: p.methodLabel,
    status: p.status,
    createdByName: p.createdByName,
    payment: p,
  }));

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: t("pay.colDate"),
      render: (row) => (
        <span className="tabnum text-subtle">
          {formatDateShort(new Date(row.paidAt.replace(" ", "T")))}
          <span dir="ltr" className="ms-1 text-[11px] text-faint">
            {row.paidAt.slice(11, 16)}
          </span>
        </span>
      ),
    },
    {
      key: "member",
      header: t("pay.colMember"),
      render: (row) => <span className="font-bold">{row.memberName}</span>,
    },
    { key: "purpose", header: t("pay.colPlan"), render: (row) => <span className="text-subtle">{row.purpose}</span> },
    {
      key: "net",
      header: t("pay.colNet"),
      render: (row) => (
        <div>
          <span dir="ltr" className="font-extrabold tabnum">
            {formatMinor(row.netMinor)}
          </span>
          {row.discountMinor > 0 && (
            <span dir="ltr" className="ms-1 text-[11px] font-bold text-amber tabnum">
              −{formatMinor(row.discountMinor)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "paid",
      header: t("pay.colPaid"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum text-emerald">
          {formatMinor(row.paidMinor)}
        </span>
      ),
    },
    {
      key: "remaining",
      header: t("pay.colRemaining"),
      render: (row) =>
        row.status === "voided" ? (
          <span className="text-faint">—</span>
        ) : row.remainingMinor > 0 ? (
          <span dir="ltr" className="font-bold tabnum text-red">
            {formatMinor(row.remainingMinor)}
          </span>
        ) : (
          <span className="text-faint">0.00</span>
        ),
    },
    { key: "method", header: t("pay.colMethod"), render: (row) => <span className="text-subtle">{row.methodLabel}</span> },
    {
      key: "status",
      header: t("pay.colStatus"),
      render: (row) => (
        <Badge variant={statusVariant(row.status)} dot>
          {t(`payStatus.${row.status}`)}
        </Badge>
      ),
    },
    { key: "by", header: t("pay.colBy"), render: (row) => <span className="text-faint">{row.createdByName}</span> },
    {
      key: "actions",
      header: t("common.actions"),
      render: (row) =>
        row.payment.status !== "voided" && row.payment.status !== "refunded" ? (
          <div className="flex items-center gap-1">
            {hasPermission("payments.refund") && row.payment.paidAmountMinor > row.payment.refundedAmountMinor && (
              <Button variant="ghost" size="sm" onClick={() => setRefundTarget(row.payment)}>
                <RotateCcw className="size-3.5" />
                {t("pay.actionRefund")}
              </Button>
            )}
            {hasPermission("payments.void") && row.payment.refundedAmountMinor === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row.payment)}>
                <Undo2 className="size-3.5" />
                {t("pay.actionVoid")}
              </Button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-faint">—</span>
        ),
    },
  ];

  const canCreate = hasPermission("payments.create");

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("pay.title")}</h2>
        </div>
        {canCreate && (
          <Button onClick={() => setFormOpen(true)}>
            <Banknote className="size-4" />
            {t("pay.addPayment")}
          </Button>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title={t("rpt.revenue")}
          subtitle={`${t("rpt.count", { count: formatNumber(stats.count) })}`}
          value={minorToMajor(stats.collectedMinor).toFixed(2)}
          icon={<Banknote className="size-5" />}
          accent="neon"
        />
        <StatCard
          title={t("pay.colRemaining")}
          subtitle={t("payStatus.partial")}
          value={minorToMajor(stats.remainingMinor).toFixed(2)}
          icon={<RotateCcw className="size-5" />}
          accent="amber"
        />
      </section>

      <Card>
        <CardHeader title={t("common.search")} />
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-5">
          <Input
            placeholder={t("pay.searchPh")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            label={t("pay.filterStatus")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))}
          />
          <Select
            label={t("pay.filterMethod")}
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
          <EmptyState icon={<Banknote />} title={t("pay.empty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            <Pagination
              page={page}
              pageSize={appConfig.pageSize}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <PaymentFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
      <PaymentRefundModal
        open={refundTarget !== null}
        onClose={() => setRefundTarget(null)}
        onDone={reload}
        payment={refundTarget}
      />
      <PaymentVoidModal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onDone={reload}
        payment={voidTarget}
      />
    </div>
  );
}
