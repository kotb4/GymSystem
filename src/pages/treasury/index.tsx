import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  FileSpreadsheet,
  ReceiptText,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
  Clock3,
} from "lucide-react";
import { CashSessionsPanel } from "@/pages/cash-page";
import {
  api,
  type CashierPerformanceItem,
  type LedgerEntry,
  type PublicUser,
} from "@/api";
import { formatMinor } from "@/core/money";
import { formatDateShort, formatTime } from "@/services/format";
import { appConfig } from "@/config/app.config";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { FinanceHubHeader } from "@/components/finance/finance-hub-header";
import { cn } from "@/utils/cn";

type TreasuryTab = "sessions" | "ledger" | "cashiers";

export function TreasuryPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<TreasuryTab>("sessions");

  const canView = hasPermission("payments.view");
  const canViewReports = hasPermission("reports.view");

  if (!canView) {
    return (
      <div className="space-y-5">
        <EmptyState icon={<Coins />} title={t("errors.forbidden")} />
      </div>
    );
  }

  const subTabs = [
    { value: "sessions", label: "الورديات اليومية وتقفيل الوردية (Z-Report)", icon: Clock3 },
    ...(canViewReports
      ? [
          { value: "ledger", label: "سجل القيود المحاسبي المباشر", icon: ReceiptText },
          { value: "cashiers", label: "أداء وتحصيل الكاشير", icon: Users },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{t("treasury.title")}</h2>
          <p className="text-[13px] text-subtle mt-1">{t("treasury.subtitle")}</p>
        </div>
      </section>

      {/* Finance Hub Navigation & Live Telemetry Strip */}
      <FinanceHubHeader currentSection="treasury" />

      {/* Glass Capsule Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-panel-border/50 bg-panel/60 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {subTabs.map((st) => {
          const isActive = activeTab === st.value;
          const Icon = st.icon;
          return (
            <button
              key={st.value}
              type="button"
              onClick={() => setActiveTab(st.value as TreasuryTab)}
              className={cn(
                "group flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-neon/15 border border-neon/60 text-white shadow-[0_0_12px_rgba(57,255,20,0.25)]"
                  : "border border-transparent text-subtle hover:text-white hover:bg-surface/60",
              )}
            >
              <Icon className={cn("size-4 transition-transform group-hover:scale-110", isActive ? "text-neon" : "text-subtle")} />
              <span>{st.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Cash Sessions (الورديات اليومية والخزائن) */}
      {activeTab === "sessions" && (
        <section className="space-y-4">
          <p className="text-xs text-subtle">{t("treasury.sessionsDesc")}</p>
          <CashSessionsPanel />
        </section>
      )}

      {/* Tab 2: Live Financial Ledger (سجل القيود وحركات الخزينة المباشرة) */}
      {canViewReports && activeTab === "ledger" && (
        <section className="space-y-4">
          <p className="text-xs text-subtle">{t("treasury.ledgerDesc")}</p>
          <TreasuryLedgerPanel />
        </section>
      )}

      {/* Tab 3: Cashier Performance Summary (ملخص أداء وتحصيل الكاشير) */}
      {canViewReports && activeTab === "cashiers" && (
        <section className="space-y-4">
          <p className="text-xs text-subtle">{t("treasury.cashiersDesc")}</p>
          <CashierPerformancePanel />
        </section>
      )}
    </div>
  );
}

/** Component for Tab 2: Financial Ledger Entries */
function TreasuryLedgerPanel() {
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalInMinor, setTotalInMinor] = useState(0);
  const [totalOutMinor, setTotalOutMinor] = useState(0);
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<PublicUser[]>([]);

  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [createdBy, setCreatedBy] = useState("all");
  const [box, setBox] = useState<"all" | "gym" | "store">("all");
  const [direction, setDirection] = useState<"all" | "1" | "-1">("all");
  const [entryType, setEntryType] = useState("all");
  const { toast } = useToast();

  const onExportLedgerCsv = () => {
    if (items.length === 0) return;
    const headers = [
      "رقم القيد",
      "التاريخ والوقت",
      "نوع القيد",
      "الاتجاه",
      "المبلغ (ج.م)",
      "البيان / المرجع",
      "الخزينة",
      "طريقة الدفع",
      "الموظف المسجل",
    ];
    const dataRows = items.map((r) => [
      `#${r.id}`,
      r.occurredAt,
      r.entryType === "payment"
        ? "تحصيل دفعة"
        : r.entryType === "refund"
        ? "استرداد مالي"
        : r.entryType === "expense"
        ? "سند صرف / مصروف"
        : r.entryType === "reversal_payment"
        ? "إلغاء دفعة"
        : r.entryType,
      r.direction === 1 ? "وارد (+)" : "صادر (−)",
      (r.amountMinor / 100).toFixed(2),
      r.memberName ? `${r.memberName} (${r.memberCode || ""})` : `${r.refTable} #${r.refId}`,
      r.box === "gym" ? "الجيم" : "المتجر",
      r.methodLabel,
      r.createdByName,
    ]);
    downloadCsvWithBom(`سجل_قيود_الخزينة_${new Date().toISOString().slice(0, 10)}`, headers, dataRows);
    toast("success", "تم تصدير سجل القيود المحاسبية إلى إكسيل بنجاح");
  };

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    let alive = true;
    api.finance
      .ledger({
        page,
        pageSize: appConfig.pageSize,
        fromKey: fromKey || undefined,
        toKey: toKey || undefined,
        createdBy: createdBy !== "all" ? createdBy : undefined,
        box,
        direction: direction === "all" ? "all" : (Number(direction) as 1 | -1),
        entryType: entryType !== "all" ? entryType : undefined,
      })
      .then((res) => {
        if (alive) {
          setItems(res.items);
          setTotal(res.total);
          setTotalInMinor(res.totalInMinor);
          setTotalOutMinor(res.totalOutMinor);
        }
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      alive = false;
    };
  }, [page, fromKey, toKey, createdBy, box, direction, entryType]);

  const columns: Column<LedgerEntry>[] = [
    {
      key: "id",
      header: "#",
      render: (row) => (
        <span dir="ltr" className="font-mono text-[11px] text-faint">
          #{row.id}
        </span>
      ),
    },
    {
      key: "time",
      header: "التاريخ والوقت",
      render: (row) => (
        <span className="tabnum text-subtle text-xs">
          {formatDateShort(new Date(row.occurredAt.replace(" ", "T")))}
          <span className="ms-1.5 text-[11px] text-faint">
            {formatTime(row.occurredAt)}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: "نوع القيد",
      render: (row) => {
        if (row.entryType === "payment") {
          return <Badge variant="success">تحصيل دفعة</Badge>;
        }
        if (row.entryType === "refund") {
          return <Badge variant="danger">استرداد مالي</Badge>;
        }
        if (row.entryType === "expense") {
          return <Badge variant="warning">سند صرف / مصروف</Badge>;
        }
        if (row.entryType === "reversal_payment") {
          return <Badge variant="neutral">إلغاء دفعة (تسوية)</Badge>;
        }
        return <Badge variant="neutral">{row.entryType}</Badge>;
      },
    },
    {
      key: "direction",
      header: "الاتجاه",
      render: (row) =>
        row.direction === 1 ? (
          <span className="flex items-center gap-1 font-bold text-emerald text-xs">
            <ArrowDownLeft className="size-3.5 text-emerald" />
            وارد (+)
          </span>
        ) : (
          <span className="flex items-center gap-1 font-bold text-red text-xs">
            <ArrowUpRight className="size-3.5 text-red" />
            صادر (−)
          </span>
        ),
    },
    {
      key: "amount",
      header: "المبلغ",
      render: (row) => (
        <span
          dir="ltr"
          className={`font-extrabold tabnum text-sm ${
            row.direction === 1 ? "text-emerald" : "text-red"
          }`}
        >
          {row.direction === 1 ? "+" : "−"}
          {formatMinor(row.amountMinor)}
        </span>
      ),
    },
    {
      key: "details",
      header: "البيان / العضو المرتبط",
      render: (row) => (
        <div className="flex flex-col text-xs">
          {row.memberName ? (
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <span>{row.memberName}</span>
              {row.memberCode ? (
                <span className="font-mono text-[10px] text-faint">({row.memberCode})</span>
              ) : null}
            </span>
          ) : (
            <span className="text-subtle font-mono text-[11px]">مرجع: {row.refTable} #{row.refId.slice(0, 8)}</span>
          )}
        </div>
      ),
    },
    {
      key: "box",
      header: "الخزينة",
      render: (row) => (
        <Badge variant={row.box === "gym" ? "primary" : "warning"}>
          {row.box === "gym" ? "الجيم" : "المتجر"}
        </Badge>
      ),
    },
    {
      key: "method",
      header: "طريقة الدفع",
      render: (row) => <span className="text-subtle text-xs font-semibold">{row.methodLabel}</span>,
    },
    {
      key: "by",
      header: "الموظف المسجل",
      render: (row) => (
        <span className="text-foreground text-xs font-medium">
          {row.createdByName}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Aggregate KPI summary for the filtered transactions */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="إجمالي المقبوضات الواردة (+)"
          value={formatMinor(totalInMinor)}
          icon={<TrendingUp className="size-5" />}
          accent="neon"
        />
        <StatCard
          title="إجمالي المصروفات الصادرة (−)"
          value={formatMinor(totalOutMinor)}
          icon={<TrendingDown className="size-5" />}
          accent="amber"
        />
        <StatCard
          title="صافي حركة الخزينة"
          value={formatMinor(totalInMinor - totalOutMinor)}
          icon={<Coins className="size-5" />}
          accent="cyan"
        />
      </section>

      {/* Filter Toolbar */}
      <Card>
        <CardHeader
          title="تصفية حركات الخزينة والقيود"
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={!fromKey && !toKey ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setFromKey("");
                  setToKey("");
                  setPage(1);
                }}
                className="text-xs h-7 px-2.5"
              >
                الكل
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  setFromKey(today);
                  setToKey(today);
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
                  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
                  setFromKey(sevenDaysAgo);
                  setToKey(now.toISOString().slice(0, 10));
                  setPage(1);
                }}
                className="text-xs h-7 px-2.5"
              >
                آخر 7 أيام
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportLedgerCsv}
                disabled={items.length === 0}
                className="text-xs h-7 px-2.5 gap-1.5 font-bold border border-emerald/40 text-emerald hover:bg-emerald/10"
              >
                <FileSpreadsheet className="size-3.5" />
                تصدير Excel
              </Button>
            </div>
          }
        />
        <div className="border-b border-line/40 bg-subtle/5 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              label="الموظف المسؤول"
              value={createdBy}
              onChange={(e) => {
                setCreatedBy(e.target.value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "جميع الموظفين والمسؤولين" },
                ...users.map((u) => {
                  const roleLabel =
                    u.roleId === "owner"
                      ? " (المالك)"
                      : u.roleId === "manager"
                        ? " (المدير)"
                        : u.roleId === "reception"
                          ? " (استقبال)"
                          : u.roleId === "trainer"
                            ? " (مدرب)"
                            : "";
                  const codePrefix = u.userCode ? `[${u.userCode}] ` : "";
                  return {
                    value: u.id,
                    label: `${codePrefix}${u.fullName || u.username}${roleLabel}`,
                  };
                }),
              ]}
            />
            <Select
              label="الخزينة / الصندوق"
              value={box}
              onChange={(e) => {
                setBox(e.target.value as "all" | "gym" | "store");
                setPage(1);
              }}
              options={[
                { value: "all", label: "الكل" },
                { value: "gym", label: "خزينة الجيم" },
                { value: "store", label: "خزينة المتجر" },
              ]}
            />
            <Select
              label="اتجاه الحركة"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as "all" | "1" | "-1");
                setPage(1);
              }}
              options={[
                { value: "all", label: "الكل (وارد وصادر)" },
                { value: "1", label: "وارد فقط (+)" },
                { value: "-1", label: "صادر فقط (−)" },
              ]}
            />
            <Select
              label="نوع القيد"
              value={entryType}
              onChange={(e) => {
                setEntryType(e.target.value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "جميع أنواع القيود" },
                { value: "payment", label: "تحصيل مدفوعات" },
                { value: "refund", label: "استرداد مالي" },
                { value: "expense", label: "سند صرف / مصروف" },
                { value: "reversal_payment", label: "إلغاء دفعة" },
              ]}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                label="من تاريخ"
                type="date"
                dir="ltr"
                value={fromKey}
                onChange={(e) => {
                  setFromKey(e.target.value);
                  setPage(1);
                }}
              />
              <Input
                label="إلى تاريخ"
                type="date"
                dir="ltr"
                value={toKey}
                onChange={(e) => {
                  setToKey(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {/* Quick Filter Pills for entryType */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/30">
            <span className="text-[11px] font-bold text-subtle">تصفية نوع القيد:</span>
            {[
              { value: "all", label: "الكل" },
              { value: "payment", label: "تحصيل مدفوعات" },
              { value: "expense", label: "سند صرف / مصروف" },
              { value: "refund", label: "استرداد مالي" },
              { value: "reversal_payment", label: "تسوية وإلغاء دفعة" },
            ].map((pill) => (
              <button
                key={pill.value}
                type="button"
                onClick={() => {
                  setEntryType(pill.value);
                  setPage(1);
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  entryType === pill.value
                    ? "bg-neon/15 text-neon border border-neon/40 shadow-xs shadow-neon/20"
                    : "bg-subtle/5 text-subtle border border-line/50 hover:bg-subtle/10"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState icon={<Coins />} title="لا توجد حركات قيود مطابقة للشروط" />
        ) : (
          <>
            <DataTable columns={columns} data={items} rowKey={(r) => String(r.id)} />
            <Pagination
              page={page}
              pageSize={appConfig.pageSize}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}

/** Component for Tab 3: Cashier Performance Summary */
function CashierPerformancePanel() {
  const [items, setItems] = useState<CashierPerformanceItem[]>([]);
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const { toast } = useToast();

  const onExportCashiersCsv = () => {
    if (items.length === 0) return;
    const headers = [
      "الموظف / الكاشير",
      "اسم المستخدم",
      "عدد الورديات",
      "إجمالي المقبوضات (ج.م)",
      "إجمالي النقد المعدود (ج.م)",
      "الورديات المطابقة",
      "حالات العجز",
      "حالات الفائض",
      "صافي فرق الجرد (ج.م)",
      "نسبة المطابقة (%)",
    ];
    const dataRows = items.map((r) => [
      r.fullName || r.username,
      `@${r.username}`,
      r.sessionsCount,
      (r.totalCollectionsMinor / 100).toFixed(2),
      (r.totalCountedMinor / 100).toFixed(2),
      r.exactCount,
      r.shortageCount,
      r.surplusCount,
      (r.totalDifferenceMinor / 100).toFixed(2),
      `${r.sessionsCount > 0 ? Math.round((r.exactCount / r.sessionsCount) * 100) : 100}%`,
    ]);
    downloadCsvWithBom(`تقرير_أداء_الكاشير_${new Date().toISOString().slice(0, 10)}`, headers, dataRows);
    toast("success", "تم تصدير تقرير أداء الكاشير إلى إكسيل بنجاح");
  };

  useEffect(() => {
    let alive = true;
    api.cash
      .cashierSummary({
        fromKey: fromKey || undefined,
        toKey: toKey || undefined,
      })
      .then((res) => {
        if (alive) {
          setItems(res);
        }
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      alive = false;
    };
  }, [fromKey, toKey]);

  const columns: Column<CashierPerformanceItem>[] = [
    {
      key: "name",
      header: "اسم الموظف / الكاشير",
      render: (row) => (
        <div className="flex flex-col text-xs">
          <span className="font-bold text-foreground text-sm">{row.fullName || row.username}</span>
          <span className="text-[11px] text-faint">@{row.username}</span>
        </div>
      ),
    },
    {
      key: "sessions",
      header: "عدد الورديات",
      render: (row) => (
        <span className="tabnum font-bold text-foreground">{row.sessionsCount}</span>
      ),
    },
    {
      key: "collections",
      header: "إجمالي المقبوضات المحصلة",
      render: (row) => (
        <span dir="ltr" className="tabnum font-extrabold text-emerald text-sm">
          {formatMinor(row.totalCollectionsMinor)}
        </span>
      ),
    },
    {
      key: "counted",
      header: "إجمالي النقد المعدود بالدرج",
      render: (row) => (
        <span dir="ltr" className="tabnum font-bold text-foreground">
          {formatMinor(row.totalCountedMinor)}
        </span>
      ),
    },
    {
      key: "exact",
      header: "ورديات مطابقة تماماً",
      render: (row) => (
        <span className="flex items-center gap-1 text-emerald font-semibold text-xs">
          <CheckCircle2 className="size-3.5" />
          {row.exactCount} وردية
        </span>
      ),
    },
    {
      key: "discrepancies",
      header: "الورديات غير المطابقة",
      render: (row) => (
        <div className="flex flex-col gap-1 text-xs">
          {row.shortageCount > 0 ? (
            <span className="text-red font-bold flex items-center gap-1">
              <ShieldAlert className="size-3" />
              عجز في {row.shortageCount} وردية
            </span>
          ) : null}
          {row.surplusCount > 0 ? (
            <span className="text-amber font-bold">فائض في {row.surplusCount} وردية</span>
          ) : null}
          {row.shortageCount === 0 && row.surplusCount === 0 ? (
            <span className="text-faint">لا يوجد أي عجز أو زيادة</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "diff",
      header: "صافي فرق الجرد",
      render: (row) => (
        <span
          dir="ltr"
          className={`tabnum font-extrabold text-sm ${
            row.totalDifferenceMinor === 0
              ? "text-faint"
              : row.totalDifferenceMinor < 0
              ? "text-red"
              : "text-amber"
          }`}
        >
          {row.totalDifferenceMinor === 0
            ? "0.00"
            : row.totalDifferenceMinor > 0
            ? `+${formatMinor(row.totalDifferenceMinor)}`
            : formatMinor(row.totalDifferenceMinor)}
        </span>
      ),
    },
    {
      key: "accuracy",
      header: "نسبة المطابقة",
      render: (row) => {
        const rate = row.sessionsCount > 0 ? Math.round((row.exactCount / row.sessionsCount) * 100) : 100;
        return (
          <Badge variant={rate === 100 ? "success" : rate >= 80 ? "warning" : "danger"}>
            {rate}% مطابقة
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Date filter presets */}
      <Card>
        <CardHeader
          title="ملخص ومقارنة أداء مسؤولي الخزينة والكاشير"
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={!fromKey && !toKey ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setFromKey("");
                  setToKey("");
                }}
                className="text-xs h-7 px-2.5"
              >
                الكل
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  setFromKey(today);
                  setToKey(today);
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
                  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
                  setFromKey(sevenDaysAgo);
                  setToKey(now.toISOString().slice(0, 10));
                }}
                className="text-xs h-7 px-2.5"
              >
                آخر 7 أيام
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportCashiersCsv}
                disabled={items.length === 0}
                className="text-xs h-7 px-2.5 gap-1.5 font-bold border border-emerald/40 text-emerald hover:bg-emerald/10"
              >
                <FileSpreadsheet className="size-3.5" />
                تصدير Excel
              </Button>
            </div>
          }
        />
        <div className="border-b border-line/40 bg-subtle/5 p-4 flex flex-wrap items-center gap-3">
          <Input
            label="من تاريخ"
            type="date"
            dir="ltr"
            value={fromKey}
            onChange={(e) => setFromKey(e.target.value)}
          />
          <Input
            label="إلى تاريخ"
            type="date"
            dir="ltr"
            value={toKey}
            onChange={(e) => setToKey(e.target.value)}
          />
        </div>

        {items.length === 0 ? (
          <EmptyState icon={<Users />} title="لا توجد بيانات مسجلة للكاشير في هذه الفترة" />
        ) : (
          <DataTable columns={columns} data={items} rowKey={(r) => r.userId} />
        )}
      </Card>
    </div>
  );
}

export default TreasuryPage;
