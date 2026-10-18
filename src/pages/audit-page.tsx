import { useEffect, useMemo, useState } from "react";
import { ScrollText, ShieldAlert, Eye, Download } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { AUDIT_ACTIONS, type AuditAction } from "@/core/audit-actions";
import { api, type AuditListQuery, type FraudAlertsSummary } from "@/api";
import { parseDateKey, todayKey } from "@/core/dates";
import { formatDateShort, formatTime } from "@/services/format";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { PageHeader } from "@/components/ui/page-header";

const PAGE_SIZE = 20;

interface Row {
  id: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

const FIELD_LABELS: Record<string, string> = {
  reason: "سبب العملية",
  amount: "المبلغ",
  amount_minor: "المبلغ (قرش)",
  price: "السعر",
  price_minor: "السعر (قرش)",
  discount: "الخصم",
  discount_minor: "الخصم (قرش)",
  count: "العدد",
  quantity: "الكمية",
  name: "الاسم",
  title: "العنوان",
  status: "الحالة",
  days: "عدد الأيام",
  role: "الدور والصلاحية",
  phone: "رقم الهاتف",
  method: "طريقة الدفع",
  notes: "الملاحظات",
  barcode: "الباركود",
  code: "الكود",
  branch_id: "معرف الفرع",
  branchId: "معرف الفرع",
  skipped: "تم التخطي",
  old_value: "القيمة السابقة",
  new_value: "القيمة الجديدة",
  success: "النتيجة",
  member_id: "معرف العضو",
  memberId: "معرف العضو",
  plan_id: "معرف الباقة",
  planId: "معرف الباقة",
  subscription_id: "معرف الاشتراك",
  subscriptionId: "معرف الاشتراك",
  invoice_id: "رقم الفاتورة",
  invoiceId: "رقم الفاتورة",
  type: "النوع",
  category: "التصنيف",
  source: "المصدر",
};

function formatMetaValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "نعم" : "لا";
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function getMetaPreview(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  if (meta.reason && typeof meta.reason === "string") {
    return `السبب: ${meta.reason}`;
  }
  if (meta.name && typeof meta.name === "string") {
    return `${meta.name}`;
  }
  if (meta.count !== undefined) {
    return `العدد: ${meta.count}`;
  }
  if (meta.amount !== undefined || meta.amount_minor !== undefined) {
    const amt = meta.amount ?? (typeof meta.amount_minor === "number" ? meta.amount_minor / 100 : "");
    return `المبلغ: ${amt}`;
  }
  return "";
}

const ACTION_CATEGORIES = [
  { id: "all", label: "كافة الإجراءات" },
  { id: "security", label: "الأمان والنظام", prefixes: ["AUTH_", "USER_", "SETUP_", "BACKUP_", "SETTINGS_"] },
  { id: "finance", label: "المالية والخزينة", prefixes: ["PAYMENT_", "REFUND_", "EXPENSE_", "CASH_", "DEBT_"] },
  { id: "members", label: "الأعضاء والكروت", prefixes: ["MEMBER_", "CARD_", "LEAD_", "TRIAL_", "REFERRAL_", "LOYALTY_"] },
  { id: "subscriptions", label: "الاشتراكات والباقات", prefixes: ["PLAN_", "SUBSCRIPTION_", "PACKAGE_", "PROMO_"] },
  { id: "attendance", label: "الحضور والاستقبال", prefixes: ["CHECKIN_", "ATTENDANCE_", "QUICK_SESSION_"] },
  { id: "store", label: "المتجر والمخزون", prefixes: ["STORE_", "PURCHASE_", "SUPPLIER_"] },
  { id: "classes", label: "الحصص والتدريب", prefixes: ["CLASS_", "TRAINER_", "TRAINING_", "ASSESSMENT_"] },
  { id: "hr", label: "الموارد البشرية", prefixes: ["EMPLOYEE_", "SALARY_", "HR_", "SHIFT_"] },
  { id: "destructive", label: "عمليات الحذف والتحويل", substrings: ["DELETE", "PURGE", "CANCEL", "VOID", "ARCHIVE"] },
];

export function AuditPage() {
  const t = useT();
  const { toast } = useToast();
  const [action, setAction] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    items: Array<Omit<Row, "metadata"> & { metadata?: unknown }>;
    total: number;
  }>({ items: [], total: 0 });
  const [fraudSummary, setFraudSummary] = useState<FraudAlertsSummary | null>(null);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  const filteredActions = useMemo(() => {
    if (category === "all") return AUDIT_ACTIONS;
    const cat = ACTION_CATEGORIES.find((c) => c.id === category);
    if (!cat) return AUDIT_ACTIONS;
    return AUDIT_ACTIONS.filter((a) => {
      if (cat.prefixes && cat.prefixes.some((p) => a.startsWith(p))) return true;
      if (cat.substrings && cat.substrings.some((s) => a.includes(s))) return true;
      return false;
    });
  }, [category]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

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
      search: debounced || undefined,
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
  }, [action, debounced, page]);

  const onExportAudit = () => {
    if (rows.length === 0) {
      toast("info", t("audit.empty"));
      return;
    }
    const headers = [
      t("common.time"),
      t("audit.user"),
      t("audit.filterAction"),
      t("audit.entity"),
      t("audit.details"),
    ];
    const dataRows = rows.map((r) => [
      r.createdAt,
      r.userName,
      r.action,
      `${r.entityType}${r.entityId ? ` (#${r.entityId})` : ""}`,
      r.metadata ? JSON.stringify(r.metadata) : "",
    ]);
    downloadCsvWithBom(`سجل_التدقيق_والرقابة_${todayKey()}`, headers, dataRows);
    toast("success", t("audit.exportSuccess"));
  };

  const rows: Row[] = data.items.map((item) => ({
    id: item.id,
    userName: item.userName,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    createdAt: item.createdAt,
    metadata: (item.metadata as Record<string, unknown>) || null,
  }));

  const columns: Column<Row>[] = [
    {
      key: "time",
      header: t("common.time"),
      render: (row) => (
        <span className="tabnum text-subtle">
          {formatDateShort(parseDateKey(row.createdAt.slice(0, 10)))}
          <span className="text-faint"> · {formatTime(row.createdAt)}</span>
        </span>
      ),
    },
    {
      key: "user",
      header: t("audit.user"),
      render: (row) => <span className="font-semibold text-foreground">{row.userName}</span>,
    },
    {
      key: "action",
      header: t("audit.filterAction"),
      render: (row) => {
        const actionLabel = t(`audit.actions.${row.action}`);
        return (
          <span className="font-semibold text-foreground">
            {actionLabel.startsWith("audit.actions.") ? row.action : actionLabel}
          </span>
        );
      },
    },
    {
      key: "entity",
      header: t("audit.entity"),
      render: (row) => {
        const rawEntity = t(`audit.entities.${row.entityType}`);
        const entityLabel = rawEntity.startsWith("audit.entities.") ? row.entityType : rawEntity;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{entityLabel}</span>
            {row.entityId ? (
              <span dir="ltr" className="tabnum text-xs text-subtle">
                #{row.entityId.slice(0, 8)}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "details",
      header: t("audit.details"),
      render: (row) => {
        const hasMeta = row.metadata && Object.keys(row.metadata).length > 0;
        if (!hasMeta) {
          return <span className="text-faint">—</span>;
        }

        const preview = getMetaPreview(row.metadata);

        return (
          <div className="flex items-center gap-2">
            {preview ? (
              <span className="text-xs text-subtle max-w-[140px] truncate" title={preview}>
                {preview}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedRow(row)}
              className="h-7 px-2 text-xs text-primary hover:text-primary-hover gap-1"
            >
              <Eye className="size-3.5" />
              <span>{t("audit.viewDetails")}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={ScrollText}
        title={t("nav.audit")}
        subtitle="سجل العمليات والرقابة الأمنية ومكافحة التلاعب وتتبع حركات المستخدمين"
        badge={
          <Badge variant="neutral" className="font-mono text-xs">
            {data.total} عملية مسجلة
          </Badge>
        }
      />

      {/* Anti-Fraud & Operational Risk Alerts Card */}
      {fraudSummary && fraudSummary.totalAlerts > 0 && (
        <Card>
          <CardHeader
            title={t("audit.fraudTitle")}
            description={t("audit.fraudDesc", {
              count: fraudSummary.totalAlerts,
              days: fraudSummary.scanWindowDays,
            })}
            action={
              <div className="flex items-center gap-2">
                {fraudSummary.criticalCount > 0 && (
                  <Badge variant="danger">
                    {t("audit.fraudCritical")}: {fraudSummary.criticalCount}
                  </Badge>
                )}
                {fraudSummary.highCount > 0 && (
                  <Badge variant="warning">
                    {t("audit.fraudHigh")}: {fraudSummary.highCount}
                  </Badge>
                )}
                <Badge variant="neutral">
                  {t("audit.fraudTotal", { count: fraudSummary.totalAlerts })}
                </Badge>
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
                      {alert.actorName && (
                        <span>
                          {t("audit.performedBy")}: {alert.actorName}
                        </span>
                      )}
                      <span>
                        • {t("audit.timestamp")}: {formatDateShort(parseDateKey(alert.timestamp.slice(0, 10)))} • {formatTime(alert.timestamp)}
                      </span>
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
                    ? t("audit.fraudCritical")
                    : alert.severity === "high"
                      ? t("audit.fraudHigh")
                      : t("audit.fraudNotice")}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t("nav.audit")} />

        {/* Quick Category Capsule Filters for 211 Actions */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5 border-b border-line bg-surface/30">
          {ACTION_CATEGORIES.map((cat) => {
            const count =
              cat.id === "all"
                ? AUDIT_ACTIONS.length
                : AUDIT_ACTIONS.filter((a) => {
                    if (cat.prefixes && cat.prefixes.some((p) => a.startsWith(p))) return true;
                    if (cat.substrings && cat.substrings.some((s) => a.includes(s))) return true;
                    return false;
                  }).length;
            const active = category === cat.id;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategory(cat.id);
                  setAction("all");
                  setPage(1);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all duration-200",
                  active
                    ? "bg-neon/15 text-neon border border-neon/40 shadow-glow-sm"
                    : "text-subtle hover:text-ink hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <span>{cat.label}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
          <div className="sm:w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("audit.searchPh")}
            />
          </div>
          <div className="sm:w-64">
            <Select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              options={[
                { value: "all", label: category === "all" ? t("common.all") : `كافة إجراءات (${ACTION_CATEGORIES.find((c) => c.id === category)?.label})` },
                ...filteredActions.map((a: string) => {
                  const label = t(`audit.actions.${a}`);
                  return {
                    value: a,
                    label: label.startsWith("audit.actions.") ? a : label,
                  };
                }),
              ]}
            />
          </div>
          <div className="flex items-center gap-3 sm:ms-auto">
            <Button variant="secondary" size="sm" onClick={onExportAudit}>
              <Download className="size-3.5" />
              {t("audit.exportAudit")}
            </Button>
            <p className="text-xs font-semibold text-faint tabnum">
              {data.total} {t("audit.recordsCount")}
            </p>
          </div>
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

      <Modal
        open={Boolean(selectedRow)}
        onClose={() => setSelectedRow(null)}
        title={t("audit.details")}
        footer={
          <Button variant="secondary" onClick={() => setSelectedRow(null)}>
            {t("audit.closeDetails")}
          </Button>
        }
      >
        {selectedRow && (
          <div className="space-y-4 p-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-panel p-3">
              <div>
                <span className="text-xs text-subtle block mb-1">{t("audit.colAction")}</span>
                <span className="font-semibold text-foreground">
                  {t(`audit.actions.${selectedRow.action}`) || selectedRow.action}
                </span>
              </div>
              <div>
                <span className="text-xs text-subtle block mb-1">{t("audit.user")}</span>
                <span className="font-semibold text-foreground">{selectedRow.userName}</span>
              </div>
              <div>
                <span className="text-xs text-subtle block mb-1">{t("audit.entity")}</span>
                <span className="font-medium text-foreground">
                  {t(`audit.entities.${selectedRow.entityType}`) || selectedRow.entityType}
                  {selectedRow.entityId ? ` (#${selectedRow.entityId.slice(0, 8)})` : ""}
                </span>
              </div>
              <div>
                <span className="text-xs text-subtle block mb-1">{t("audit.timestamp")}</span>
                <span className="tabnum text-foreground inline-block">
                  {formatDateShort(parseDateKey(selectedRow.createdAt.slice(0, 10)))} • {formatTime(selectedRow.createdAt)}
                </span>
              </div>
            </div>

            {selectedRow.metadata && Object.keys(selectedRow.metadata).length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-subtle">{t("audit.details")}</h4>
                <div className="rounded-xl border border-line divide-y divide-line/60 bg-panel overflow-hidden">
                  {Object.entries(selectedRow.metadata).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between p-2.5 text-xs">
                      <span className="font-medium text-subtle">
                        {FIELD_LABELS[k] || k}:
                      </span>
                      <span className="font-mono text-foreground font-semibold tabnum max-w-[240px] truncate" dir="auto">
                        {formatMetaValue(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-faint py-4">
                {t("audit.noDetails")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
