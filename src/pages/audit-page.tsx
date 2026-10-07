import { useEffect, useState } from "react";
import { ScrollText, ShieldAlert } from "lucide-react";
import { useT } from "@/i18n";
import { AUDIT_ACTIONS, type AuditAction } from "@/core/audit-actions";
import { api, type AuditListQuery, type FraudAlertsSummary } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

const PAGE_SIZE = 20;

interface Row {
  id: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  details: string;
}

export function AuditPage() {
  const t = useT();
  const [action, setAction] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    items: Array<Omit<Row, "details"> & { metadata?: unknown }>;
    total: number;
  }>({ items: [], total: 0 });
  const [fraudSummary, setFraudSummary] = useState<FraudAlertsSummary | null>(null);

  useEffect(() => {
    let alive = true;
    api.fraudAlerts
      .scan(14)
      .then((res) => {
        if (alive) setFraudSummary(res);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const query: AuditListQuery = {
      page,
      pageSize: PAGE_SIZE,
      action: action === "all" ? undefined : (action as AuditAction),
    };
    api.audit
      .list(query)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [action, page]);

  const rows: Row[] = data.items.map((item) => ({
    id: item.id,
    userName: item.userName,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    createdAt: item.createdAt,
    details: item.metadata ? JSON.stringify(item.metadata) : "",
  }));

  const columns: Column<Row>[] = [
    {
      key: "time",
      header: t("common.time"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(parseDateKey(row.createdAt.slice(0, 10)))}
          <span className="text-faint"> · {row.createdAt.slice(11, 16)}</span>
        </span>
      ),
    },
    {
      key: "user",
      header: t("audit.user"),
      render: (row) => <span className="font-semibold">{row.userName}</span>,
    },
    {
      key: "action",
      header: t("audit.filterAction"),
      render: (row) => <span className="font-semibold">{t(`audit.actions.${row.action}`)}</span>,
    },
    {
      key: "entity",
      header: t("audit.entity"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.entityType}
          {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}
        </span>
      ),
    },
    {
      key: "details",
      header: t("audit.details"),
      render: (row) =>
        row.details ? (
          <span dir="ltr" className="line-clamp-1 max-w-[220px] font-mono text-[11px] text-faint">
            {row.details}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Anti-Fraud & Operational Risk Alerts Card */}
      {fraudSummary && fraudSummary.totalAlerts > 0 && (
        <Card>
          <CardHeader
            title="تنبيهات الأمان والرقابة المالية (Anti-Fraud & Audit Alerts)"
            description={`تم رصد ${fraudSummary.totalAlerts} عمليات تتطلب مراجعة إدارية خلال آخر ${fraudSummary.scanWindowDays} يوماً (إلغاءات، خصومات استثنائية، أو فروق نقدية)`}
            action={
              <div className="flex items-center gap-2">
                {fraudSummary.criticalCount > 0 && (
                  <Badge variant="danger">حرجة: {fraudSummary.criticalCount}</Badge>
                )}
                {fraudSummary.highCount > 0 && (
                  <Badge variant="warning">مرتفعة: {fraudSummary.highCount}</Badge>
                )}
                <Badge variant="neutral">إجمالي التنبيهات: {fraudSummary.totalAlerts}</Badge>
              </div>
            }
          />
          <div className="divide-y divide-line/60 overflow-hidden">
            {fraudSummary.alerts.slice(0, 10).map((alert) => (
              <div key={alert.id} className="p-4 flex items-center justify-between text-sm">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 p-1.5 rounded-lg border ${
                      alert.severity === "critical"
                        ? "bg-red/10 border-red/30 text-red"
                        : alert.severity === "high"
                          ? "bg-amber/10 border-amber/30 text-amber"
                          : "bg-blue/10 border-blue/30 text-blue"
                    }`}
                  >
                    <ShieldAlert className="size-4" />
                  </div>
                  <div>
                    <div className="font-bold text-foreground">{alert.description}</div>
                    <div className="text-xs text-subtle flex items-center gap-2 mt-1">
                      {alert.actorName && <span>بواسطة: {alert.actorName}</span>}
                      <span>• التاريخ: {alert.timestamp.slice(0, 16)}</span>
                    </div>
                  </div>
                </div>

                <Badge
                  variant={
                    alert.severity === "critical"
                      ? "danger"
                      : alert.severity === "high"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {alert.severity === "critical"
                    ? "خطورة حرجة"
                    : alert.severity === "high"
                      ? "خطورة مرتفعة"
                      : "تنبيه تشغيلي"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t("nav.audit")} />
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
        <div className="sm:w-64">
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("common.all") },
              ...AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) })),
            ]}
          />
        </div>
        <p className="text-xs font-semibold text-faint tabnum sm:ms-auto">{data.total}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("audit.empty")} />
      ) : (
        <>
          <DataTable columns={columns} data={rows} rowKey={(r) => String(r.id)} />
          <div className="border-t border-line px-5 py-3.5">
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </div>
        </>
      )}
    </Card>
  </div>
  );
}
