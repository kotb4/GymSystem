import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type AuditLogItem } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity } from "lucide-react";
import { formatDateShort, formatTime } from "@/services/format";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function ActivityTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!hasPermission("audit.view")) return;
    let alive = true;
    setLoading(true);
    api.members
      .listAuditForMember(ctx.member.id, { page, pageSize: 30 })
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

  if (!hasPermission("audit.view")) {
    return permissionDeniedNode(t);
  }

  interface Row {
    id: number;
    createdAt: string;
    action: string;
    userName: string;
    entityType: string;
  }

  const rows: Row[] = items.map((i) => ({
    id: i.id,
    createdAt: i.createdAt,
    action: i.action,
    userName: i.userName,
    entityType: i.entityType,
  }));

  const columns: Column<Row>[] = [
    {
      key: "time",
      header: t("members.activityColTime"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {formatDateShort(new Date(row.createdAt))} {formatTime(new Date(row.createdAt))}
        </span>
      ),
    },
    {
      key: "action",
      header: t("members.activityColAction"),
      render: (row) => <span className="font-semibold">{row.action}</span>,
    },
    {
      key: "user",
      header: t("members.activityColUser"),
      render: (row) => <span className="text-subtle">{row.userName}</span>,
    },
    {
      key: "type",
      header: t("common.type"),
      render: (row) => <span dir="ltr" className="tabnum text-faint">{row.entityType}</span>,
    },
  ];

  return (
    <Card>
      <CardHeader title={t("members.activityTitle")} />
      {loading ? (
        <p className="px-5 pb-5 text-[12px] text-faint">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Activity />} title={t("members.activityEmpty")} />
      ) : (
        <>
          <DataTable columns={columns} data={rows} rowKey={(r) => String(r.id)} />
          {total > rows.length && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px]">
              <span className="text-faint">
                {t("common.page")} {page}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t("common.prev")}
                </Button>
                <Button size="sm" variant="secondary" disabled={rows.length < 30 || page * 30 >= total} onClick={() => setPage((p) => p + 1)}>
                  {t("common.next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Button(props: { size?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold transition-colors hover:border-line-strong disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}
