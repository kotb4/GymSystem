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
  Coins,
  FileSpreadsheet,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Clock3,
  LockKeyhole,
} from "lucide-react";
import { CashSessionsPanel } from "@/pages/cash-page";
import { PaymentMethodsBreakdownRibbon } from "@/components/finance/payment-methods-breakdown-ribbon";
import { ZReportModal } from "@/components/finance/z-report-modal";
import {
  api,
  type LedgerEntry,
  type PublicUser,
} from "@/api";
import { formatMinor } from "@/core/money";
import { formatDateShort, formatTime } from "@/services/format";
import { appConfig } from "@/config/app.config";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { cn } from "@/utils/cn";

type TreasuryTab = "sessions" | "ledger";

export function TreasuryPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<TreasuryTab>("sessions");
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [zReportOpen, setZReportOpen] = useState(false);

  const canView = hasPermission("payments.view");
  const canViewReports = hasPermission("reports.view");
  const canCashClose = hasPermission("cash.close");

  if (!canView) {
    return (
      <div className="space-y-5">
        <EmptyState icon={<Coins />} title={t("errors.forbidden")} />
      </div>
    );
  }

  const subTabs = [
    { value: "sessions", label: "الورديات اليومية وتقفيل الوردية", icon: Clock3 },
    ...(canViewReports
      ? [
          { value: "ledger", label: "سجل القيود المحاسبي المباشر", icon: ReceiptText },
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
        {canCashClose && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setZReportOpen(true)}
            className="border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 font-bold gap-2 cursor-pointer h-10 shadow-md shadow-amber-500/10"
          >
            <LockKeyhole className="size-4 text-amber-400" />
            <span>⚡ تقفيل الوردية (Z-Report)</span>
          </Button>
        )}
      </section>

      {/* Real-time Payment Methods Distribution Ribbon (كاش، انستاباي، فيزا، محفظة...) */}
      <PaymentMethodsBreakdownRibbon
        selectedMethod={selectedMethod}
        onSelectMethod={(method) => {
          setSelectedMethod(method);
          if (method && activeTab !== "ledger") {
            setActiveTab("ledger");
          }
        }}
      />

      {/* Z-Report Modal */}
      <ZReportModal
        open={zReportOpen}
        onClose={() => setZReportOpen(false)}
      />

      {/* Strip 4: Glass Capsule Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-panel/75 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {subTabs.map((st) => {
          const isActive = activeTab === st.value;
          const Icon = st.icon;
          return (
            <button
              key={st.value}
              type="button"
              onClick={() => setActiveTab(st.value as TreasuryTab)}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 cursor-pointer",
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
          <CashSessionsPanel />
        </section>
      )}

      {/* Tab 2: Live Financial Ledger (سجل القيود وحركات الخزينة المباشرة) */}
      {canViewReports && activeTab === "ledger" && (
        <section className="space-y-4">
          <p className="text-xs text-subtle">{t("treasury.ledgerDesc")}</p>
          <TreasuryLedgerPanel
            selectedMethod={selectedMethod}
            onSelectMethod={setSelectedMethod}
          />
        </section>
      )}
    </div>
  );
}

interface TreasuryLedgerPanelProps {
  selectedMethod?: string | null;
  onSelectMethod?: (method: string | null) => void;
}

/** Component for Tab 3: Financial Ledger Entries */
function TreasuryLedgerPanel({ selectedMethod, onSelectMethod }: TreasuryLedgerPanelProps = {}) {
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
  const [methodCode, setMethodCode] = useState(selectedMethod || "all");
  const { toast } = useToast();

  useEffect(() => {
    if (selectedMethod !== undefined) {
      setMethodCode(selectedMethod || "all");
      setPage(1);
    }
  }, [selectedMethod]);

  const handleMethodChange = (val: string) => {
    setMethodCode(val);
    setPage(1);
    if (onSelectMethod) {
      onSelectMethod(val === "all" ? null : val);
    }
  };

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
        methodCode: methodCode !== "all" ? methodCode : undefined,
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
  }, [page, fromKey, toKey, createdBy, box, direction, entryType, methodCode]);

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
              label="طريقة الدفع"
              value={methodCode}
              onChange={(e) => handleMethodChange(e.target.value)}
              options={[
                { value: "all", label: "جميع وسائل الدفع" },
                { value: "cash", label: "💵 كاش / نقدي" },
                { value: "instapay", label: "⚡ انستاباي (InstaPay)" },
                { value: "wallet", label: "📱 محفظة إلكترونية" },
                { value: "bank_card", label: "💳 فيزا / كارت بنكي" },
                { value: "transfer", label: "🏛️ تحويل بنكي" },
                { value: "other", label: "🏷️ أخرى" },
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

          {/* Quick Filter Pills for Payment Methods */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/30">
            <span className="text-[11px] font-bold text-subtle">طريقة الدفع:</span>
            {[
              { value: "all", label: "الكل" },
              { value: "cash", label: "💵 كاش" },
              { value: "instapay", label: "⚡ انستاباي" },
              { value: "wallet", label: "📱 محفظة" },
              { value: "bank_card", label: "💳 فيزا" },
              { value: "transfer", label: "🏛️ تحويل" },
            ].map((pill) => (
              <button
                key={pill.value}
                type="button"
                onClick={() => handleMethodChange(pill.value)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  methodCode === pill.value
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-xs shadow-cyan-500/20"
                    : "bg-subtle/5 text-subtle border border-line/50 hover:bg-subtle/10"
                }`}
              >
                {pill.label}
              </button>
            ))}
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

export default TreasuryPage;
