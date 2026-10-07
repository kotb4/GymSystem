import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type Payment } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { CreditCard, ShoppingBag } from "lucide-react";
import { formatMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { ReceiptActions } from "@/components/finance/receipt-actions";
import { StoreReceiptActions } from "@/components/store/store-receipt-actions";
import type { StoreSale, StoreReturnRow } from "@/api";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function PaymentsTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    if (!hasPermission("payments.view")) return;
    let alive = true;
    setLoading(true);
    api.payments
      .list({ memberId: ctx.member.id, page, pageSize })
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hasPermission, ctx.member.id, ctx.reloadTick, page]);

  if (!hasPermission("payments.view")) {
    return permissionDeniedNode(t);
  }

  const columns: Column<Payment>[] = [
    {
      key: "date",
      header: t("members.paymentsColDate"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(new Date(row.paidAt))}
        </span>
      ),
    },
    {
      key: "net",
      header: t("members.paymentsColNet"),
      align: "end",
      render: (row) => <span dir="ltr" className="tabnum">{formatMinor(row.netAmountMinor)}</span>,
    },
    {
      key: "paid",
      header: t("members.paymentsColPaid"),
      align: "end",
      render: (row) => <span dir="ltr" className="tabnum font-bold">{formatMinor(row.paidAmountMinor)}</span>,
    },
    {
      key: "remaining",
      header: t("members.paymentsColRemaining"),
      align: "end",
      render: (row) =>
        row.remainingAmountMinor > 0 ? (
          <span dir="ltr" className="tabnum font-bold text-amber">{formatMinor(row.remainingAmountMinor)}</span>
        ) : (
          <span className="text-faint tabnum">0</span>
        ),
    },
    {
      key: "method",
      header: t("members.paymentsColMethod"),
      render: (row) => <span className="text-subtle">{row.methodLabel || row.methodCode}</span>,
    },
    {
      key: "status",
      header: t("members.paymentsColStatus"),
      render: (row) => {
        const variant = row.status === "paid" ? "success" : row.status === "partial" ? "warning" : row.status === "refunded" ? "info" : "neutral";
        return (
          <Badge variant={variant} dot>
            {row.status}
          </Badge>
        );
      },
    },
    ...(hasPermission("pdf.receipt")
      ? [
          {
            key: "receipt" as const,
            header: "" as const,
            render: (row: Payment) =>
              row.status === "voided" ? null : <ReceiptActions paymentId={row.id} />,
          },
        ]
      : []),
  ];

  const [storeSales, setStoreSales] = useState<StoreSale[]>([]);
  const [storeReturns, setStoreReturns] = useState<Array<Omit<StoreReturnRow, "items">>>([]);
  const [storeLoading, setStoreLoading] = useState(false);

  useEffect(() => {
    if (!hasPermission("store.view")) return;
    let alive = true;
    setStoreLoading(true);
    api.store
      .listSales({ memberId: ctx.member.id, pageSize: 50, page: 1 })
      .then((res) => {
        if (!alive) return;
        setStoreSales(res.items);
        setStoreLoading(false);
      })
      .catch(() => {
        if (alive) setStoreLoading(false);
      });
    api.store
      .listReturns({ memberId: ctx.member.id, pageSize: 50, page: 1 })
      .then((res) => {
        if (!alive) return;
        setStoreReturns(res.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, ctx.member.id, ctx.reloadTick]);

  const storeColumns: Column<StoreSale>[] = [
    {
      key: "no",
      header: t("store.colSaleNo"),
      render: (r) => (
        <span dir="ltr" className={`tabnum font-bold ${r.status === "voided" || r.returnStatus === "full" ? "line-through text-subtle" : ""}`}>
          {r.saleNo}
        </span>
      ),
    },
    {
      key: "date",
      header: t("store.colDate"),
      render: (r) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(new Date(r.soldAt))}
        </span>
      ),
    },
    {
      key: "total",
      header: t("store.colTotal"),
      align: "end",
      render: (r) => {
        const isVoided = r.status === "voided";
        const isFullyReturned = r.returnStatus === "full";
        const isPartiallyReturned = r.returnStatus === "partial";
        return (
          <div className="text-end">
            <span
              dir="ltr"
              className={`tabnum font-bold ${isVoided || isFullyReturned ? "line-through text-subtle" : "text-emerald"}`}
            >
              {formatMinor(r.totalMinor)}
            </span>
            {isPartiallyReturned && (r.returnedTotalMinor ?? 0) > 0 && (
              <span dir="ltr" className="block text-[11px] text-amber font-semibold">
                -{formatMinor(r.returnedTotalMinor ?? 0)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: t("store.colStatus"),
      render: (r) => (
        <div className="flex flex-col gap-1 items-start">
          {r.status === "voided" ? (
            <Badge variant="danger">{t("exp.statusVoided")}</Badge>
          ) : r.returnStatus === "full" ? (
            <Badge variant="danger">{t("store.statusFullyReturned")}</Badge>
          ) : r.returnStatus === "partial" ? (
            <Badge variant="warning">{t("store.statusPartiallyReturned")}</Badge>
          ) : (
            <Badge variant="success">{t("exp.statusActive")}</Badge>
          )}
          {r.isCredit && (
            <Badge variant={r.debtStatus === "settled" ? "info" : "warning"} dot>
              {r.debtStatus === "settled" ? "آجل مسدد" : "آجل غير مسدد"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "receipt",
      header: t("pdf.receiptTitle"),
      render: (r) => <StoreReceiptActions saleId={r.id} size="sm" />,
    },
  ];

  const returnColumns: Column<Omit<StoreReturnRow, "items">>[] = [
    {
      key: "no",
      header: t("store.returnNoCol"),
      render: (r) => <span dir="ltr" className="tabnum font-bold text-red">{r.returnNo}</span>,
    },
    {
      key: "sale",
      header: t("store.colSaleNo"),
      render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.saleNo}</span>,
    },
    {
      key: "date",
      header: t("store.colDate"),
      render: (r) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(new Date(r.createdAt))}
        </span>
      ),
    },
    {
      key: "total",
      header: t("store.colTotal"),
      align: "end",
      render: (r) => <span dir="ltr" className="tabnum font-bold text-red">-{formatMinor(r.totalMinor)}</span>,
    },
    {
      key: "reason",
      header: t("store.returnReason"),
      render: (r) => r.reason ?? "—",
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("members.paymentsTitle")} />
        {loading ? (
          <p className="px-5 pb-5 text-[12px] text-faint">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={<CreditCard />} title={t("members.paymentsEmpty")} />
        ) : (
          <>
            <DataTable columns={columns} data={items} rowKey={(r) => r.id} />
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px]">
              <span className="text-faint">
                {t("common.page")} {page} / {Math.max(1, Math.ceil(total / pageSize))} · {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold transition-colors hover:border-line-strong disabled:opacity-40"
                >
                  {t("common.prev")}
                </button>
                <button
                  type="button"
                  disabled={page * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold transition-colors hover:border-line-strong disabled:opacity-40"
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      {hasPermission("store.view") && (
        <Card>
          <CardHeader title={t("store.tabSales")} />
          {storeLoading ? (
            <p className="px-5 pb-5 text-[12px] text-faint">{t("common.loading")}</p>
          ) : storeSales.length === 0 ? (
            <EmptyState icon={<ShoppingBag />} title={t("store.noMemberPurchases")} />
          ) : (
            <DataTable columns={storeColumns} data={storeSales} rowKey={(r) => r.id} />
          )}
        </Card>
      )}

      {hasPermission("store.view") && storeReturns.length > 0 && (
        <Card>
          <CardHeader title={t("store.tabMemberReturns")} />
          <DataTable columns={returnColumns} data={storeReturns} rowKey={(r) => r.id} />
        </Card>
      )}
    </div>
  );
}
