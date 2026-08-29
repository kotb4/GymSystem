import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type Payment } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { CreditCard } from "lucide-react";
import { formatMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Badge } from "@/components/ui/badge";
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
  ];

  return (
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
  );
}
