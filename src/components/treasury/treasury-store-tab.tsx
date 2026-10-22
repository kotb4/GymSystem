import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag,
  Package,
  ReceiptText,
  DollarSign,
  ExternalLink,
  CreditCard,
  Percent,
  Sparkles,
} from "lucide-react";
import { api, type StoreSale, type StoreStats } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PaymentMethodsBreakdownRibbon } from "@/components/finance/payment-methods-breakdown-ribbon";
import { cn } from "@/utils/cn";

export interface TreasuryStoreTabProps {
  fromKey?: string;
  toKey?: string;
  onRefresh?: () => void;
}

export function TreasuryStoreTab({ fromKey, toKey }: TreasuryStoreTabProps) {
  const today = todayKey();
  const from = fromKey || today;
  const to = toKey || today;

  const [stats, setStats] = useState<StoreStats | null>(null);
  const [sales, setSales] = useState<StoreSale[]>([]);
  const [totalSales, setTotalSales] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, salesRes] = await Promise.all([
        api.store.stats({ fromKey: from, toKey: to }).catch(() => null),
        api.store.listSales({
          limit: 15,
          methodCode: selectedMethod && selectedMethod !== "all" ? selectedMethod : undefined,
        }).catch(() => ({ items: [], total: 0 })),
      ]);
      setStats(statsRes);
      setSales(salesRes.items);
      setTotalSales(salesRes.total);
    } catch (err) {
      console.error("Failed to load store integration data in treasury:", err);
    }
  }, [from, to, selectedMethod]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const revenue = stats?.revenueMinor ?? 0;
  const cost = stats?.costMinor ?? 0;
  const grossProfit = stats?.grossProfitMinor ?? 0;
  const marginPercent = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
  const openDebt = stats?.creditOpenMinor ?? 0;

  const columns: Column<StoreSale>[] = [
    {
      key: "saleNo",
      header: "رقم الفاتورة",
      render: (r) => (
        <span className="font-mono text-xs font-bold text-ink">
          {r.saleNo || r.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "memberName",
      header: "العميل / المشترك",
      render: (r) => (
        <span className="text-xs font-semibold text-white">
          {r.memberName || "عميل نقدي (زائر)"}
        </span>
      ),
    },
    {
      key: "soldAt",
      header: "الوقت والتاريخ",
      render: (r) => (
        <span className="text-[11px] font-mono text-subtle" dir="ltr">
          {r.soldAt.slice(0, 16)}
        </span>
      ),
    },
    {
      key: "methodCode",
      header: "طريقة الدفع",
      render: (r) => {
        const isCredit = r.isCredit;
        if (isCredit) {
          return <Badge variant="warning">آجل على الحساب</Badge>;
        }
        return (
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-slate-200">
            {r.methodCode === "cash"
              ? "نقدي"
              : r.methodCode === "instapay"
              ? "انستاباي"
              : r.methodCode === "wallet"
              ? "محفظة"
              : r.methodCode === "bank_card"
              ? "فيزا / كارت"
              : r.methodCode}
          </span>
        );
      },
    },
    {
      key: "totalMinor",
      header: "قيمة الفاتورة",
      render: (r) => (
        <span className="font-mono text-xs font-bold text-emerald-400" dir="ltr">
          {formatMinor(r.totalMinor)}
        </span>
      ),
    },
    {
      key: "costTotalMinor",
      header: "التكلفة",
      render: (r) => (
        <span className="font-mono text-xs text-subtle" dir="ltr">
          {formatMinor(r.costTotalMinor)}
        </span>
      ),
    },
    {
      key: "grossProfitMinor",
      header: "الربح",
      render: (r) => {
        const profit = r.grossProfitMinor;
        const tone = profit > 0 ? "text-neon font-black" : profit === 0 ? "text-subtle" : "text-rose-400 font-bold";
        return (
          <span className={cn("font-mono text-xs", tone)} dir="ltr">
            {profit > 0 ? `+${formatMinor(profit)}` : formatMinor(profit)}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) => (
        <Badge variant={r.status === "completed" ? "success" : "danger"}>
          {r.status === "completed" ? "مكتملة" : "ملغاة"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Action Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-2xl border border-white/[0.08] bg-panel/70 shadow-lg backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-neon/15 text-neon shadow-lg shadow-neon/10">
            <ShoppingBag className="size-6" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              <span>مبيعات وأرباح المتجر والبار</span>
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5 font-bold border border-emerald-500/30">
                مدمج مع الخزينة
              </span>
            </h3>
            <p className="text-xs text-subtle">
              متابعة مباشرة لتدفقات مبيعات المكملات، التكاليف، وهوامش الأرباح من داخل شاشة الخزينة
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link to="/store">
            <Button size="sm" className="bg-neon hover:bg-neon/90 text-slate-950 font-black gap-1.5 shadow-lg shadow-neon/20">
              <ExternalLink className="size-3.5" />
              <span>فتح نقطة بيع المتجر (POS)</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Store Profit & Financial KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Metric 1: Total Store Sales */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-panel/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-subtle text-xs mb-2">
            <span>إجمالي المبيعات</span>
            <DollarSign className="size-4 text-emerald-400" />
          </div>
          <div dir="ltr" className="font-mono text-xl font-black text-white text-end">
            {formatMinor(revenue)}
          </div>
          <p className="text-[10px] text-subtle pt-1 mt-1 border-t border-white/[0.04]">
            {stats?.salesCount ?? 0} عملية بيع
          </p>
        </div>

        {/* Metric 2: COGS Cost */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-panel/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-subtle text-xs mb-2">
            <span>تكلفة البضاعة</span>
            <Package className="size-4 text-amber-400" />
          </div>
          <div dir="ltr" className="font-mono text-xl font-black text-slate-300 text-end">
            {formatMinor(cost)}
          </div>
          <p className="text-[10px] text-subtle pt-1 mt-1 border-t border-white/[0.04]">
            سعر التكلفة التوريدية
          </p>
        </div>

        {/* Metric 3: Gross Profit */}
        <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 flex flex-col justify-between shadow-lg shadow-emerald-500/5">
          <div className="flex items-center justify-between text-emerald-400 text-xs mb-2 font-bold">
            <span>مجمل الربح الصافي</span>
            <Sparkles className="size-4 text-emerald-400" />
          </div>
          <div dir="ltr" className="font-mono text-xl font-black text-emerald-300 text-end">
            +{formatMinor(grossProfit)}
          </div>
          <p className="text-[10px] text-emerald-400/80 pt-1 mt-1 border-t border-emerald-500/20 font-bold">
            هامش ربح: {marginPercent}%
          </p>
        </div>

        {/* Metric 4: Profit Margin */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-panel/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-subtle text-xs mb-2">
            <span>نسبة الربحية</span>
            <Percent className="size-4 text-cyan-400" />
          </div>
          <div dir="ltr" className="font-mono text-xl font-black text-cyan-300 text-end">
            {marginPercent}%
          </div>
          <p className="text-[10px] text-subtle pt-1 mt-1 border-t border-white/[0.04]">
            معدل العائد على المبيعات
          </p>
        </div>

        {/* Metric 5: Open Store Debts */}
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-panel/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-subtle text-xs mb-2">
            <span>ديون المتجر (آجل)</span>
            <CreditCard className="size-4 text-rose-400" />
          </div>
          <div dir="ltr" className="font-mono text-xl font-black text-rose-300 text-end">
            {formatMinor(openDebt)}
          </div>
          <p className="text-[10px] text-subtle pt-1 mt-1 border-t border-white/[0.04]">
            {stats?.creditOpenCount ?? 0} ذمة معلقة
          </p>
        </div>
      </div>

      {/* Payment Methods Breakdown Ribbon specifically for Store */}
      <PaymentMethodsBreakdownRibbon
        box="store"
        fromKey={from}
        toKey={to}
        selectedMethod={selectedMethod}
        onSelectMethod={setSelectedMethod}
        title="توزيع مبيعات المتجر حسب طريقة التحصيل"
      />

      {/* Recent Store Sales Table with Profit Column */}
      <Card className="border-white/[0.08] bg-panel/80">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <ReceiptText className="size-4 text-neon" />
              <span>فواتير مبيعات المتجر وربحية كل فاتورة</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-subtle font-mono">
                {totalSales} فاتورة
              </span>
            </div>
          }
          description="سجل تفصيلي لأحدث عمليات البيع بالمتجر موضحاً قيمة الفاتورة والتكلفة والربح المحقق وطريقة الدفع"
        />
        <div className="p-4">
          {sales.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag />}
              title="لا توجد مبيعات في الفترة المحددة"
              description="لم يتم تسجيل مبيعات للمتجر في هذا النطاق الزمني أو لهذه الطريقة المحددة."
            />
          ) : (
            <DataTable<StoreSale> columns={columns} data={sales} rowKey={(r) => r.id} />
          )}
        </div>
      </Card>
    </div>
  );
}
