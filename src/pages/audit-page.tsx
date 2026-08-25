import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { useT } from "@/i18n";
import { AUDIT_ACTIONS, type AuditAction } from "@/core/audit-actions";
import { api, type AuditListQuery } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
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
  );
}
