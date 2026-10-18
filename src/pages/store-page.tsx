import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Barcode,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  User,
  X,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  CreditCard,
  Truck,
  CheckCircle2,
  ReceiptText,
  History,
  Award,
} from "lucide-react";
import { useFocusRow } from "@/hooks/use-focus-row";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type ProductPublic,
  type StoreSale,
  type StoreDebtRow,
  type StockMovementRow,
  type StoreReturnRow,
  type DailySalesRow,
  type ProductSalesRow,
  type StockValueRow,
} from "@/api";
import { formatMinor } from "@/core/money";
import { addDaysKey, todayKey } from "@/core/dates";
import { formatDateShort, formatTime } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchInput } from "@/components/ui/search-input";
import { MemberPickerModal } from "@/components/members/member-picker-modal";
import { BranchBadge } from "@/components/ui/branch-badge";
import { StoreReceiptActions } from "@/components/store/store-receipt-actions";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/utils/cn";

const MOVEMENT_LABEL_KEYS: Record<string, string> = {
  stock_in: "store.movement_stock_in",
  sale: "store.movement_sale",
  manual_adjust: "store.movement_manual_adjust",
  damage: "store.movement_damage",
  count_correction: "store.movement_count_correction",
  return: "store.movement_return",
  lost: "store.movement_lost",
};

type CartLine = { productId: string; name: string; unitPriceMinor: number; qty: number };

export function StorePage() {
  const location = useLocation();
  const state = location.state as { storeTab?: string; focusDocNo?: string; autoOpen?: boolean; focusRowId?: string } | null;
  const focusRowId = useFocusRow();
  const { hasPermission } = useAuth();
  const canProfit = hasPermission("store.profit");

  const [tab, setTab] = useState<string>(() => {
    if (state?.storeTab) return state.storeTab;
    if (state?.focusRowId) return "sales";
    return "pos";
  });

  const [stats, setStats] = useState({
    salesCount: 0,
    revenueMinor: 0,
    costMinor: 0,
    grossProfitMinor: 0,
    creditOpenCount: 0,
    creditOpenMinor: 0,
    lowStockCount: 0,
  });

  const [bestSeller, setBestSeller] = useState<ProductSalesRow | null>(null);

  const loadStats = useCallback(() => {
    const today = todayKey();
    api.store
      .stats({ fromKey: today, toKey: today })
      .then(setStats)
      .catch(console.error);

    if (canProfit) {
      api.store
        .productSalesReport({ fromKey: today, toKey: today })
        .then((rows) => {
          if (rows && rows.length > 0) {
            const sorted = [...rows].sort((a, b) => (b.netUnits - a.netUnits) || (b.revenueMinor - a.revenueMinor));
            const top = sorted.find((r) => r.unitsSold > 0) || null;
            setBestSeller(top);
          } else {
            setBestSeller(null);
          }
        })
        .catch(() => setBestSeller(null));
    }
  }, [canProfit]);

  useEffect(() => {
    loadStats();
  }, [loadStats, tab]);

  useEffect(() => {
    if (state?.storeTab) {
      setTab(state.storeTab);
    } else if (state?.focusRowId || focusRowId) {
      setTab("sales");
    }
  }, [state, focusRowId]);

  return (
    <div className="space-y-5">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={ShoppingCart}
        title="متجر النادي ونقاط البيع السريعة والمخزون"
        subtitle="إدارة المبيعات السريعة (POS)، المنتجات والمكملات، فواتير المبيعات، مرتجعات البضائع، ديون الأعضاء، والمشتريات"
        actions={
          <Button
            variant={tab === "pos" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTab("pos")}
            className="gap-1.5 text-xs font-bold shadow-glow-sm"
          >
            <ShoppingCart className="size-3.5" />
            <span>نقطة بيع سريعة (POS)</span>
          </Button>
        }
      />

      {/* 5 KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setTab("sales")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            tab === "sales"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-neon/20 bg-gradient-to-br from-panel to-neon/5 hover:border-neon/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">مبيعات اليوم</span>
            <span className="grid size-7 place-items-center rounded-lg bg-neon/15 text-neon">
              <ShoppingCart className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-neon tabnum">{formatMinor(stats.revenueMinor)}</span>
            <span className="text-[11px] font-bold text-white">ج.م</span>
          </div>
          <span className="mt-1 block text-[10px] text-faint tabnum">
            {stats.salesCount} عملية بيع منجزة اليوم (عرض الفواتير ←)
          </span>
        </button>

        {/* Today's Best Seller Telemetry Card */}
        <button
          type="button"
          onClick={() => setTab("reports")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer group",
            tab === "reports"
              ? "border-amber-400/60 bg-amber-400/10 shadow-sm shadow-amber-400/10"
              : "border-amber-500/20 bg-gradient-to-br from-panel to-amber-500/5 hover:border-amber-500/50",
          )}
          title="عرض تقرير مبيعات المنتجات والأكثر طلباً"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-amber-400">الأكثر مبيعاً اليوم</span>
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:scale-110 transition-transform">
              <Award className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            {bestSeller ? (
              <>
                <span className="text-sm font-black text-white block truncate line-clamp-1" title={bestSeller.productName}>
                  {bestSeller.productName}
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-xs font-bold text-amber-300 tabnum">{bestSeller.netUnits} قطعة</span>
                  <span className="text-[10px] text-faint">({formatMinor(bestSeller.revenueMinor)} ج.م)</span>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-subtle block">لا توجد مبيعات</span>
                <span className="text-[10px] text-faint block mt-0.5">لم تسجل مبيعات منتجات اليوم بعد</span>
              </>
            )}
          </div>
          <span className="mt-1 block text-[10px] text-amber-400/80 group-hover:underline">
            عرض تقرير المنتجات الأكثر طلباً ←
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("reports")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            tab === "reports"
              ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10"
              : "border-emerald-500/15 bg-gradient-to-br from-panel to-emerald-500/5 hover:border-emerald-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">أرباح اليوم المحققة</span>
            <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white tabnum">{formatMinor(stats.grossProfitMinor)}</span>
            <span className="text-[11px] font-bold text-emerald-400">ج.م</span>
          </div>
          <span className="mt-1 block text-[10px] text-faint">
            صافي أرباح المبيعات بعد التكلفة (التقرير ←)
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("products")}
          className={cn(
            "p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            tab === "products"
              ? "border-amber-500/60 bg-amber-500/10 shadow-sm shadow-amber-500/10"
              : "border-amber-500/15 bg-gradient-to-br from-panel to-amber-500/5 hover:border-amber-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">نواقص المخزون</span>
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-400">
              <AlertTriangle className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-400 tabnum">{stats.lowStockCount}</span>
            <span className="text-[10px] text-faint">منتج منخفض</span>
          </div>
          <span className="mt-1 block text-[10px] text-amber-400/80">
            بلغت حد إعادة الطلب الأدنى (إدارة المخزون ←)
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("debts")}
          className={cn(
            "col-span-2 sm:col-span-1 p-3.5 rounded-2xl border text-start transition-all duration-200 cursor-pointer",
            tab === "debts"
              ? "border-rose-500/60 bg-rose-500/10 shadow-sm shadow-rose-500/10"
              : "border-rose-500/15 bg-gradient-to-br from-panel to-rose-500/5 hover:border-rose-500/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-subtle">ديون المتجر الآجلة</span>
            <span className="grid size-7 place-items-center rounded-lg bg-rose-500/10 text-rose-400">
              <CreditCard className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-rose-400 tabnum">{formatMinor(stats.creditOpenMinor)}</span>
            <span className="text-[11px] font-bold text-rose-400">ج.م</span>
          </div>
          <span className="mt-1 block text-[10px] text-faint tabnum">
            {stats.creditOpenCount} فاتورة آجلة غير مسددة (سداد الآجل ←)
          </span>
        </button>
      </div>

      {/* Glass Capsule Tab Strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-panel-border/50 bg-panel/60 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {[
          { value: "pos", label: "نقطة بيع سريعة (POS)", icon: ShoppingCart },
          { value: "products", label: "دليل المنتجات والمخزون", icon: Package, badge: stats.lowStockCount > 0 ? `نواقص: ${stats.lowStockCount}` : undefined, badgeTone: "bg-amber-500/20 text-amber-400" },
          { value: "sales", label: "فواتير وسجل المبيعات", icon: ReceiptText, badge: stats.salesCount > 0 ? stats.salesCount : undefined },
          { value: "returns", label: "مرتجعات البضائع", icon: Undo2 },
          { value: "debts", label: "ديون المتجر الآجلة", icon: CreditCard, badge: stats.creditOpenCount > 0 ? stats.creditOpenCount : undefined, badgeTone: "bg-rose-500/20 text-rose-400 font-mono" },
          { value: "movements", label: "حركات الجرد والمخزون", icon: History },
          { value: "reports", label: "أرباح وتقارير المتجر", icon: TrendingUp },
        ].map((item) => {
          const isActive = tab === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                "group relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-neon/15 border border-neon/60 text-white shadow-[0_0_12px_rgba(57,255,20,0.25)]"
                  : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-neon" : "text-subtle",
                )}
              />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={cn(
                    "ms-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    item.badgeTone || "bg-neon/20 text-neon",
                  )}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {tab === "pos" && <PosTab onDone={() => setTab("sales")} onSaleCompleted={loadStats} />}
      {tab === "products" && <ProductsTab />}
      {tab === "sales" && <SalesTab highlightRowKey={focusRowId} autoOpenSaleId={state?.focusRowId || focusRowId} />}
      {tab === "returns" && <ReturnsTab highlightRowKey={focusRowId} />}
      {tab === "debts" && <DebtsTab highlightRowKey={focusRowId} />}
      {tab === "movements" && <MovementsTab />}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}

// ---------------------------------- POS -----------------------------------

function PosTab({ onDone, onSaleCompleted }: { onDone: () => void; onSaleCompleted?: () => void }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [products, setProducts] = useState<ProductPublic[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountMajor, setDiscountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [isCredit, setIsCredit] = useState(false);
  const [selectedMember, setSelectedMember] = useState<{ id: string; fullName: string } | null>(null);
  const [memberDebt, setMemberDebt] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedSale, setCompletedSale] = useState<StoreSale | null>(null);
  const canCredit = hasPermission("store.credit");

  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);

  useEffect(() => {
    api.payments.methods().then(setMethods).catch(console.error);
  }, []);

  const loadProducts = useCallback(() => {
    api.store
      .listProducts({ includeInactive: false })
      .then((r) => setProducts(r.items))
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (selectedMember) {
      api.store
        .memberDebtTotal(selectedMember.id)
        .then(setMemberDebt)
        .catch(() => setMemberDebt(null));
    } else {
      setMemberDebt(null);
    }
  }, [selectedMember]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.categoryName) set.add(p.categoryName);
    }
    return Array.from(set);
  }, [products]);

  const addToCart = (p: ProductPublic) => {
    if (p.stockQty <= 0) {
      toast("error", `عفواً، المنتج "${p.name}" غير متوفر في المخزون`);
      return;
    }
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) {
        if (found.qty >= p.stockQty) {
          toast("warning", `الكمية المطلوبة وصلت للحد الأقصى المتوفر بالمخزون (${p.stockQty})`);
          return prev;
        }
        return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { productId: p.id, name: p.name, unitPriceMinor: p.priceMinor, qty: 1 }];
    });
  };

  const changeQty = (productId: string, delta: number) => {
    const product = products.find((p) => p.id === productId);
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        const newQty = l.qty + delta;
        if (newQty <= 0) return l;
        if (product && newQty > product.stockQty) {
          toast("warning", `الكمية المتوفرة بالمخزون هي ${product.stockQty} فقط`);
          return l;
        }
        return { ...l, qty: newQty };
      }),
    );
  };

  const removeLine = (productId: string) =>
    setCart((prev) => prev.filter((l) => l.productId !== productId));

  const itemsTotalMinor = cart.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);
  const discountMinor = Math.min(Math.round(Number(discountMajor || 0) * 100), itemsTotalMinor);
  const totalMinor = itemsTotalMinor - discountMinor;

  const handleBarcodeOrSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    const match = products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === q.toLowerCase()) ||
        p.name.toLowerCase() === q.toLowerCase(),
    );
    if (match) {
      addToCart(match);
      setTerm("");
    }
  };

  const completeSale = async () => {
    if (!actor || cart.length === 0) return;
    if (isCredit && !selectedMember) {
      toast("error", t("store.pickMemberCredit"));
      return;
    }
    setSubmitting(true);
    try {
      const sale = await api.store.createSale({
        items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
        discountMinor,
        methodCode,
        memberId: selectedMember ? selectedMember.id : null,
        isCredit,
      });
      toast("success", t("store.saleDoneToast", { no: sale.saleNo }));
      setCompletedSale(sale);
      setCart([]);
      setDiscountMajor("");
      setIsCredit(false);
      setSelectedMember(null);
      loadProducts();
      onSaleCompleted?.();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = useMemo(() => {
    let result = products;
    const q = term.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          (p.categoryName && p.categoryName.toLowerCase().includes(q)),
      );
    }
    if (selectedCategory !== "all") {
      result = result.filter((p) => p.categoryName === selectedCategory);
    }
    if (lowStockOnly) {
      result = result.filter((p) => p.lowStock);
    }
    return result;
  }, [products, term, selectedCategory, lowStockOnly]);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Products Selection Section (3 cols) */}
      <Card className="lg:col-span-3 flex flex-col">
        <div className="p-4 border-b border-line space-y-3">
          {/* Search / Barcode Input */}
          <form onSubmit={handleBarcodeOrSearchSubmit} className="relative">
            <Barcode className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3.5 size-4 text-neon" />
            <input
              type="search"
              placeholder="ابحث باسم المنتج أو امسح الباركود بجهاز القارئ..."
              value={term}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-panel ps-10 pe-24 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
              autoFocus
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm("")}
                className="absolute inset-y-0 end-20 grid w-7 place-items-center text-faint hover:text-subtle"
              >
                <X className="size-4" />
              </button>
            )}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="absolute inset-y-1.5 end-1.5 text-xs px-2.5"
            >
              بحث / إدخال
            </Button>
          </form>

          {/* Quick Categories Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => { setSelectedCategory("all"); setLowStockOnly(false); }}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                selectedCategory === "all" && !lowStockOnly
                  ? "bg-neon/15 text-neon border border-neon/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              الكل ({products.length})
            </button>
            <button
              type="button"
              onClick={() => { setLowStockOnly(!lowStockOnly); setSelectedCategory("all"); }}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                lowStockOnly
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              <AlertTriangle className="size-3" />
              نواقص ({products.filter((p) => p.lowStock).length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => { setSelectedCategory(cat); setLowStockOnly(false); }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                  selectedCategory === cat
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div className="flex-1 p-4 overflow-y-auto max-h-[620px]">
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon={<Package />}
              title="لا توجد منتجات مطابقة"
              description="تأكد من كتابة الاسم أو الباركود بشكل صحيح، أو اختر تصنيفاً آخر."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((p) => {
                const inCart = cart.find((l) => l.productId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    disabled={p.stockQty <= 0}
                    className={cn(
                      "group relative flex flex-col justify-between rounded-2xl border p-3.5 text-start transition-all duration-200",
                      p.stockQty <= 0
                        ? "border-line/40 bg-panel/40 opacity-40 cursor-not-allowed"
                        : inCart
                        ? "border-neon/60 bg-neon/[0.03] shadow-md shadow-neon/10"
                        : "border-line bg-panel hover:border-neon/40 hover:shadow-md hover:shadow-black/20",
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="block text-sm font-bold text-white group-hover:text-neon transition-colors line-clamp-2">
                          {p.name}
                        </span>
                        {p.categoryName && (
                          <Badge variant="neutral" className="text-[10px] shrink-0">
                            {p.categoryName}
                          </Badge>
                        )}
                      </div>
                      {p.barcode && (
                        <span dir="ltr" className="block text-[10px] text-faint tabnum mt-0.5">
                          {p.barcode}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2">
                      <span className="text-sm font-black text-neon tabnum">
                        {formatMinor(p.priceMinor)} ج.م
                      </span>
                      <div className="flex items-center gap-1.5">
                        {inCart && (
                          <span className="rounded-md bg-neon/20 px-1.5 py-0.5 text-[10px] font-extrabold text-neon">
                            في السلة ({inCart.qty})
                          </span>
                        )}
                        {p.lowStock && (
                          <Link
                            to="/purchases"
                            state={{ defaultProductId: p.id, defaultProductName: p.name, autoCreate: true }}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 transition-colors"
                            title="فتح فاتورة شراء وتوريد للمنتج"
                          >
                            <Truck className="size-2.5" />
                            <span>طلب توريد 🚚</span>
                          </Link>
                        )}
                        <Badge
                          variant={p.stockQty <= 0 ? "danger" : p.lowStock ? "warning" : "success"}
                          dot
                          className="text-[11px] font-semibold"
                        >
                          {p.stockQty <= 0 ? "نفد" : `رصيد: ${p.stockQty}`}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Cart & Checkout Panel (2 cols) */}
      <Card className="lg:col-span-2 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-4 text-neon" />
              <h3 className="font-extrabold text-sm text-white">سلة المشتريات</h3>
              {cart.length > 0 && (
                <span className="rounded-full bg-neon/15 px-2 py-0.5 text-[11px] font-bold text-neon">
                  {cart.reduce((s, l) => s + l.qty, 0)} قطع
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="text-xs text-faint hover:text-red transition-colors flex items-center gap-1"
              >
                <Trash2 className="size-3" />
                تفريغ
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<Barcode />}
                title={t("store.emptyCart")}
                description="اختر منتجات من القائمة أو امسح الباركود لإضافتها إلى السلة."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line/60 px-4 max-h-[300px] overflow-y-auto">
              {cart.map((l) => (
                <li key={l.productId} className="flex items-center gap-2.5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-white">{l.name}</span>
                    <span dir="ltr" className="block text-[11px] text-faint tabnum">
                      {formatMinor(l.unitPriceMinor)} ج.م
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="-"
                      onClick={() => changeQty(l.productId, -1)}
                      className="grid size-9 place-items-center rounded-xl border border-line bg-surface/80 text-subtle hover:text-neon hover:border-neon/50 hover:bg-neon/10 active:scale-95 transition-all cursor-pointer"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span dir="ltr" className="w-8 text-center font-black text-sm tabnum text-white">
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      aria-label="+"
                      onClick={() => changeQty(l.productId, 1)}
                      className="grid size-9 place-items-center rounded-xl border border-line bg-surface/80 text-subtle hover:text-neon hover:border-neon/50 hover:bg-neon/10 active:scale-95 transition-all cursor-pointer"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <span dir="ltr" className="w-20 text-end font-black tabnum text-neon">
                    {formatMinor(l.unitPriceMinor * l.qty)} ج.م
                  </span>
                  <button
                    type="button"
                    aria-label={t("common.delete")}
                    onClick={() => removeLine(l.productId)}
                    className="grid size-9 place-items-center rounded-xl text-faint hover:text-red hover:bg-red/10 active:scale-95 transition-all cursor-pointer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Checkout Inputs & Actions */}
        {cart.length > 0 && (
          <div className="space-y-3.5 border-t border-line p-5 bg-panel/60">
            {/* Total Before Discount */}
            <div className="flex justify-between text-sm font-bold text-subtle">
              <span>{t("store.total")}</span>
              <span dir="ltr" className="tabnum font-extrabold text-white">
                {formatMinor(itemsTotalMinor)} ج.م
              </span>
            </div>

            {/* Discount & Presets */}
            <div>
              <Input
                label={`${t("store.discount")} (ج.م)`}
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={discountMajor}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setDiscountMajor(e.target.value)}
                placeholder="0"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {[5, 10, 20, 50].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDiscountMajor(String(val))}
                    className="rounded bg-surface/80 border border-white/5 px-2 py-0.5 text-[10px] font-semibold text-faint hover:text-neon hover:border-neon/30"
                  >
                    {val} ج.م
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDiscountMajor(String(Math.round(itemsTotalMinor * 0.1) / 100))}
                  className="rounded bg-surface/80 border border-white/5 px-2 py-0.5 text-[10px] font-semibold text-faint hover:text-neon hover:border-neon/30"
                >
                  10%
                </button>
                {discountMajor && (
                  <button
                    type="button"
                    onClick={() => setDiscountMajor("")}
                    className="rounded bg-surface/80 border border-white/5 px-2 py-0.5 text-[10px] font-semibold text-red hover:bg-red/10"
                  >
                    مسح
                  </button>
                )}
              </div>
            </div>

            {/* Payment Method */}
            <Select
              label={t("store.method")}
              value={methodCode}
              onChange={(e) => setMethodCode(e.target.value)}
              options={
                methods.length > 0
                  ? methods.map((m) => ({ value: m.code, label: m.labelAr }))
                  : [
                      { value: "cash", label: "نقدي (خزينة المتجر)" },
                      { value: "bank_card", label: "بطاقة بنكية / فيزا" },
                      { value: "transfer", label: "تحويل / محفظة إلكترونية" },
                      { value: "other", label: "أخرى" },
                    ]
              }
            />

            {/* Member Association */}
            <div className="space-y-1.5 rounded-xl border border-line bg-surface/40 p-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-subtle">{t("store.linkedMember")}</span>
                {selectedMember && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMember(null);
                      setIsCredit(false);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-red"
                  >
                    <X className="size-3" />
                    {t("common.clear")}
                  </button>
                )}
              </div>

              {selectedMember ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-sm">
                    <span className="flex items-center gap-1.5 font-bold text-white">
                      <User className="size-4 text-neon" />
                      {selectedMember.fullName}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                      {t("common.edit")}
                    </Button>
                  </div>

                  {memberDebt !== null && memberDebt > 0 && (
                    <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-400">
                      <span>مديونية سابقة على العضو:</span>
                      <span dir="ltr" className="tabnum font-extrabold">{formatMinor(memberDebt)} ج.م</span>
                    </div>
                  )}

                  {canCredit && (
                    <label className="flex items-center gap-2 pt-1 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isCredit}
                        onChange={(e) => setIsCredit(e.target.checked)}
                        className="accent-neon size-4 rounded"
                      />
                      <span>تسجيل كفاتورة بيع آجل (على حساب مديونية العضو)</span>
                    </label>
                  )}
                </div>
              ) : (
                <Button variant="secondary" size="sm" fullWidth onClick={() => setPickerOpen(true)}>
                  <User className="size-3.5" />
                  {t("store.pickMember")}
                </Button>
              )}
            </div>

            {/* Net Total & Complete Button */}
            <div className="rounded-xl border border-neon/20 bg-neon/10 p-3 flex items-baseline justify-between">
              <span className="text-sm font-extrabold text-white">{t("pay.summaryNet")}</span>
              <div className="flex items-baseline gap-1">
                <span dir="ltr" className="text-2xl font-black text-neon tabnum">
                  {formatMinor(totalMinor)}
                </span>
                <span className="text-xs font-bold text-neon">ج.م</span>
              </div>
            </div>

            <Button
              fullWidth
              size="lg"
              variant="primary"
              loading={submitting}
              disabled={submitting || cart.length === 0}
              onClick={() => void completeSale()}
              className="font-black text-sm py-3 shadow-lg shadow-neon/15"
            >
              <ShoppingCart className="size-4 me-1" />
              <span>{t("store.completeSale")}</span>
            </Button>
          </div>
        )}
      </Card>

      <MemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          setSelectedMember(m);
          setPickerOpen(false);
        }}
      />

      {/* Completed Sale Receipt Modal */}
      {completedSale && (
        <Modal
          open
          onClose={() => setCompletedSale(null)}
          title={`تم تسجيل الفاتورة بنجاح — ${completedSale.saleNo}`}
          widthClass="max-w-md"
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="primary"
                onClick={() => setCompletedSale(null)}
                className="gap-1.5"
              >
                <Plus className="size-4" />
                <span>عملية بيع جديدة</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCompletedSale(null);
                  onDone();
                }}
              >
                <span>سجل المبيعات</span>
              </Button>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-emerald-400">
              <CheckCircle2 className="size-6 shrink-0" />
              <div>
                <p className="font-extrabold text-sm text-white">
                  تم تسجيل الفاتورة رقم <span dir="ltr">{completedSale.saleNo}</span>
                </p>
                <p className="text-xs text-slate-300 mt-0.5">
                  إجمالي المبلغ: <span className="font-bold text-emerald-400">{formatMinor(completedSale.totalMinor)} ج.م</span>
                  {completedSale.isCredit ? " (آجل على حساب العضو)" : ""}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/5 bg-panel p-3">
              <p className="text-xs font-bold text-subtle mb-2">طباعة وتصدير الإيصال:</p>
              <StoreReceiptActions saleId={completedSale.id} size="md" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// -------------------------------- products --------------------------------

function ProductsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<ProductPublic[]>([]);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "low_stock" | "active" | "inactive">("all");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ProductPublic | null>(null);
  const [stockTarget, setStockTarget] = useState<ProductPublic | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ProductPublic | null>(null);
  const { toast } = useToast();

  const reload = useCallback(() => {
    api.store.listProducts({ includeInactive: true }).then((r) => setItems(r.items)).catch(console.error);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const doPurge = async () => {
    if (!purgeTarget) return;
    try {
      await api.store.purgeProduct(purgeTarget.id);
      toast("success", t("store.productPurgedToast"));
      setPurgeTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const filteredItems = useMemo(() => {
    let result = items;
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          (p.supplierName && p.supplierName.toLowerCase().includes(q)) ||
          (p.categoryName && p.categoryName.toLowerCase().includes(q)),
      );
    }
    if (filterMode === "low_stock") {
      result = result.filter((p) => p.lowStock);
    } else if (filterMode === "active") {
      result = result.filter((p) => p.isActive);
    } else if (filterMode === "inactive") {
      result = result.filter((p) => !p.isActive);
    }
    return result;
  }, [items, search, filterMode]);

  const columns: Column<ProductPublic>[] = [
    {
      key: "name",
      header: t("store.name"),
      render: (r) => (
        <div>
          <span className="font-bold text-white block">{r.name}</span>
          {r.barcode && <span dir="ltr" className="text-[10px] text-faint tabnum">{r.barcode}</span>}
        </div>
      ),
    },
    { key: "cat", header: t("store.category"), render: (r) => r.categoryName ?? "—" },
    {
      key: "cost",
      header: "التكلفة",
      render: (r) => <span dir="ltr" className="tabnum text-subtle">{formatMinor(r.costMinor)} ج.م</span>,
    },
    {
      key: "price",
      header: t("store.price"),
      render: (r) => (
        <div>
          <span dir="ltr" className="tabnum font-bold text-neon block">{formatMinor(r.priceMinor)} ج.م</span>
          {r.costMinor > 0 && (
            <span className="text-[10px] text-emerald-400 block tabnum font-semibold">
              هامش: {formatMinor(r.priceMinor - r.costMinor)} ج.م
            </span>
          )}
        </div>
      ),
    },
    {
      key: "stock",
      header: t("store.stock"),
      render: (r) => (
        <Badge variant={r.stockQty <= 0 ? "danger" : r.lowStock ? "warning" : "success"} dot>
          {r.stockQty} {r.lowStock ? "(منخفض)" : ""}
        </Badge>
      ),
    },
    {
      key: "active",
      header: t("common.status"),
      render: (r) => (
        <span className={r.isActive ? "text-emerald-400 text-xs font-semibold" : "text-faint text-xs"}>
          {r.isActive ? "● نشط" : "○ متوقف"}
        </span>
      ),
    },
    ...(hasPermission("store.products") || hasPermission("store.inventory") || hasPermission("store.purge")
      ? [{
          key: "actions",
          header: t("common.actions"),
          align: "end" as const,
          render: (r: ProductPublic) => (
            <div className="flex items-center justify-end gap-1.5">
              {r.lowStock && (
                <Link
                  to="/purchases"
                  state={{ defaultProductId: r.id, defaultProductName: r.name, autoCreate: true }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/30 px-2.5 py-1 rounded-lg border border-amber-500/40 transition-all shadow-sm"
                  title="طلب توريد وشراء جديد للمخزون"
                >
                  <Truck className="size-3" />
                  <span>طلب توريد 🚚</span>
                </Link>
              )}
              {hasPermission("store.products") && (
                <Button size="sm" variant="secondary" onClick={() => { setEditing(r); setEditOpen(true); }}>{t("common.edit")}</Button>
              )}
              {hasPermission("store.inventory") && (
                <Button size="sm" variant="ghost" onClick={() => setStockTarget(r)}>{t("store.restock")}</Button>
              )}
              {hasPermission("store.purge") && (
                <Button size="sm" variant="ghost" className="text-red hover:text-red" title={t("store.purgeProductAction")} onClick={() => setPurgeTarget(r)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("store.tabProducts")}
          action={
            hasPermission("store.products") ? (
              <Button onClick={() => { setEditing(null); setEditOpen(true); }} className="gap-1.5 text-xs font-bold">
                <Plus className="size-4" />
                {t("store.addProduct")}
              </Button>
            ) : undefined
          }
        />

        {/* Search & Quick Filter Pills */}
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="بحث باسم المنتج، الباركود، أو المورد..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                filterMode === "all"
                  ? "bg-neon/15 text-neon border border-neon/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              الكل ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("low_stock")}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                filterMode === "low_stock"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              <AlertTriangle className="size-3" />
              نواقص ({items.filter((p) => p.lowStock).length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("active")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                filterMode === "active"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              نشط ({items.filter((p) => p.isActive).length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("inactive")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                filterMode === "inactive"
                  ? "bg-slate-500/15 text-slate-300 border border-slate-500/30"
                  : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
              )}
            >
              متوقف ({items.filter((p) => !p.isActive).length})
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="لا توجد منتجات مطابقة"
            description={items.length === 0 ? "ابدأ بإضافة منتج جديد لدليل منتجات المتجر." : "جرّب تغيير كلمات البحث أو إعادة ضبط الفلتر."}
          />
        ) : (
          <DataTable columns={columns} data={filteredItems} rowKey={(r) => r.id} />
        )}
      </Card>
      {editOpen && (
        <ProductFormModal
          product={editing}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); reload(); }}
        />
      )}
      {stockTarget && (
        <StockModal
          product={stockTarget}
          onClose={() => setStockTarget(null)}
          onSaved={() => { setStockTarget(null); reload(); }}
        />
      )}
      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={t("store.purgeProductAction")}
        message={purgeTarget ? `${purgeTarget.name} — ${t("store.purgeProductConfirm")}` : ""}
        confirmLabel={t("common.delete")}
        onConfirm={() => void doPurge()}
      />
    </>
  );
}

function ProductFormModal({ product, onClose, onSaved }: { product: ProductPublic | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: product?.name ?? "",
    costMajor: product ? String(product.costMinor / 100) : "",
    priceMajor: product ? String(product.priceMinor / 100) : "",
    stockQty: product ? String(product.stockQty) : "0",
    minStockQty: product ? String(product.minStockQty) : "3",
    barcode: product?.barcode ?? "",
    supplierName: product?.supplierName ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        costMinor: Math.round(Number(form.costMajor || 0) * 100),
        priceMinor: Math.round(Number(form.priceMajor || 0) * 100),
        minStockQty: Number(form.minStockQty || 0),
        barcode: form.barcode || null,
        supplierName: form.supplierName || null,
      };
      if (product) await api.store.updateProduct(product.id, payload);
      else await api.store.createProduct({ ...payload, stockQty: Number(form.stockQty || 0) });
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={product ? t("store.editProduct") : t("store.addProduct")} widthClass="max-w-lg"
      footer={<><Button type="submit" form="product-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="product-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <Input label={t("store.name")} value={form.name} onChange={set("name")} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("store.cost")} type="number" step="0.01" min={0} dir="ltr" value={form.costMajor} onChange={set("costMajor")} />
          <Input label={t("store.price")} type="number" step="0.01" min={0} dir="ltr" value={form.priceMajor} onChange={set("priceMajor")} />
        </div>
        {!product && <Input label={t("store.stock")} type="number" min={0} dir="ltr" value={form.stockQty} onChange={set("stockQty")} />}
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("store.barcode")} dir="ltr" value={form.barcode} onChange={set("barcode")} />
          <Input label={t("store.supplier")} value={form.supplierName} onChange={set("supplierName")} />
        </div>
        <Input label={t("store.minStock")} type="number" min={0} dir="ltr" value={form.minStockQty} onChange={set("minStockQty")} />
      </form>
    </Modal>
  );
}

function StockModal({ product, onClose, onSaved }: { product: ProductPublic; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [delta, setDelta] = useState("");
  const [notes, setNotes] = useState("");
  const [movementType, setMovementType] = useState("stock_in");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.store.adjustStock({ productId: product.id, movementType, delta: Math.trunc(Number(delta)), notes: notes || null });
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t("store.restock")} — ${product.name}`} widthClass="max-w-sm"
      footer={<><Button type="submit" form="stock-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="stock-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3.5">
        <Select label="" value={movementType} onChange={(e) => setMovementType(e.target.value)} options={[
          { value: "stock_in", label: "توريد" },
          { value: "manual_adjust", label: "تسوية يدوية" },
          { value: "damage", label: "تالف" },
          { value: "lost", label: "مفقود" },
          { value: "count_correction", label: "تصحيح جرد" },
        ]} />
        <Input label={`${t("store.qty")} (+/-)`} type="number" dir="ltr" value={delta} onChange={(e: ChangeEvent<HTMLInputElement>) => setDelta(e.target.value)} autoFocus />
        <p className="text-[11px] text-faint">{t("store.restockDeltaHint")}</p>
        <Input label={t("common.notes")} value={notes} onChange={(e: ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)} />
      </form>
    </Modal>
  );
}

// --------------------------------- sales ----------------------------------

function SalesTab({
  highlightRowKey,
  autoOpenSaleId,
}: {
  highlightRowKey?: string | null;
  autoOpenSaleId?: string | null;
}) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<StoreSale[]>([]);
  const [viewing, setViewing] = useState<StoreSale | null>(null);
  const [voidTarget, setVoidTarget] = useState<StoreSale | null>(null);
  const [unvoidSaleTarget, setUnvoidSaleTarget] = useState<StoreSale | null>(null);
  const [returnTarget, setReturnTarget] = useState<StoreSale | null>(null);
  const [returnLoadingId, setReturnLoadingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(() => {
    api.store.listSales({}).then((r) => setItems(r.items)).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const openDetails = (saleId: string) => {
    api.store.getSale(saleId).then(setViewing).catch(console.error);
  };

  useEffect(() => {
    const targetId = autoOpenSaleId || highlightRowKey;
    if (!targetId) return;
    api.store
      .getSale(targetId)
      .then((sale) => {
        setViewing(sale);
        setItems((prev) => {
          if (prev.some((s) => s.id === sale.id)) return prev;
          return [sale, ...prev];
        });
      })
      .catch((err) => console.error("Failed to auto-open focused sale:", err));
  }, [autoOpenSaleId, highlightRowKey]);

  const handleOpenReturn = async (sale: StoreSale) => {
    try {
      setReturnLoadingId(sale.id);
      const full = await api.store.getSale(sale.id);
      setReturnTarget(full);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setReturnLoadingId(null);
    }
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    try {
      await api.store.voidStoreSale(voidTarget.id, reason);
      toast("success", t("store.voidedToast"));
      setVoidTarget(null);
      setReason("");
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<StoreSale>[] = [
    { key: "no", header: t("store.colSaleNo"), render: (r) => (
      <button type="button" onClick={() => openDetails(r.id)} className="font-bold tabnum hover:text-neon" dir="ltr">{r.saleNo}</button>
    ) },
    {
      key: "date",
      header: "تاريخ وتوقيت البيع",
      render: (r: StoreSale) => (
        <span className="tabnum text-subtle text-xs flex flex-col">
          <span>{formatDateShort(new Date(r.soldAt.replace(" ", "T")))}</span>
          <span className="text-[11px] text-faint" dir="ltr">
            {formatTime(r.soldAt)}
          </span>
        </span>
      ),
    },
    { key: "member", header: t("store.colMember"), render: (r) => r.memberName ?? "—" },
    { key: "branch", header: t("common.branch"), render: (r) => <BranchBadge branchId={r.branchId} /> },
    { key: "total", header: t("store.colTotal"), render: (r) => (
      <div className="flex flex-col">
        <span dir="ltr" className={`tabnum font-bold ${r.status === "voided" || r.returnStatus === "full" ? "line-through text-subtle" : ""}`}>
          {formatMinor(r.totalMinor)}
        </span>
        {r.returnStatus === "full" && (
          <span className="text-[11px] text-red font-semibold">{t("store.statusFullyReturned")}</span>
        )}
        {r.returnStatus === "partial" && (
          <span dir="ltr" className="text-[11px] text-amber font-semibold">
            {t("store.returnedTag")}: -{formatMinor(r.returnedTotalMinor ?? 0)}
          </span>
        )}
      </div>
    ) },
    { key: "profit", header: t("store.colProfit"), render: (r) =>
      hasPermission("store.profit")
        ? <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span>
        : <span>—</span> },
    { key: "status", header: t("store.colStatus"), render: (r) => (
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
    ) },
    {
      key: "receipt",
      header: t("pdf.receiptTitle"),
      render: (r: StoreSale) => <StoreReceiptActions saleId={r.id} size="sm" />,
    },
    ...(hasPermission("store.void_sale") || hasPermission("store.return")
      ? [{
          key: "actions",
          header: "",
          align: "end" as const,
          render: (r: StoreSale) => {
            if (r.status !== "completed") {
              return hasPermission("store.void_sale") ? (
                <button type="button" aria-label={t("store.actionRestore")} onClick={() => setUnvoidSaleTarget(r)} className="text-faint hover:text-subtle"><RotateCcw className="size-4" /></button>
              ) : null;
            }
            return (
              <div className="flex items-center justify-end gap-1.5">
                {hasPermission("store.return") && r.returnStatus !== "full" && (
                  <button
                    type="button"
                    aria-label={t("store.makeReturn")}
                    disabled={returnLoadingId === r.id}
                    onClick={() => void handleOpenReturn(r)}
                    className="text-faint hover:text-amber disabled:opacity-50"
                  >
                    <Undo2 className="size-4" />
                  </button>
                )}
                {hasPermission("store.void_sale") && (
                  <button type="button" aria-label={t("store.voidSale")} onClick={() => setVoidTarget(r)} className="text-faint hover:text-red"><Trash2 className="size-4" /></button>
                )}
              </div>
            );
          },
        }]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader title={t("store.tabSales")} />
        {items.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={columns} data={items} rowKey={(r) => r.id} highlightRowKey={highlightRowKey} />}
      </Card>
      <Modal open={voidTarget !== null} onClose={() => setVoidTarget(null)} title={t("store.voidSale")} widthClass="max-w-xs"
        footer={<><Button variant="danger" type="submit" form="void-form">{t("common.confirm")}</Button><Button variant="secondary" onClick={() => setVoidTarget(null)}>{t("common.cancel")}</Button></>}>
        <form id="void-form" onSubmit={(e) => { e.preventDefault(); void doVoid(); }} className="space-y-3.5">
          <p className="text-sm text-subtle">{voidTarget?.saleNo}</p>
          <Input label={t("store.voidReason")} value={reason} onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} autoFocus />
        </form>
      </Modal>
      <ConfirmDialog
        open={unvoidSaleTarget !== null}
        onClose={() => setUnvoidSaleTarget(null)}
        title={t("store.restoreConfirmTitle")}
        message={t("store.restoreConfirmMsg")}
        onConfirm={() => {
          if (!unvoidSaleTarget) return;
          api.store
            .unvoidStoreSale(unvoidSaleTarget.id)
            .then(() => {
              toast("success", t("store.restoredToast"));
              setUnvoidSaleTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)));
        }}
      />
      {returnTarget && (
        <ReturnModal
          sale={returnTarget}
          onClose={() => setReturnTarget(null)}
          onDone={() => { setReturnTarget(null); reload(); }}
        />
      )}
      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={viewing.saleNo}
          widthClass="max-w-md"
          footer={
            <div className="flex items-center justify-between w-full">
              <StoreReceiptActions saleId={viewing.id} size="md" />
              <Button variant="secondary" onClick={() => setViewing(null)}>{t("common.close")}</Button>
            </div>
          }
        >
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2 text-xs">
            {viewing.returnStatus === "full" ? (
              <Badge variant="danger">{t("store.statusFullyReturned")}</Badge>
            ) : viewing.returnStatus === "partial" ? (
              <Badge variant="warning">{t("store.statusPartiallyReturned")}</Badge>
            ) : (
              <Badge variant="success">{t("exp.statusActive")}</Badge>
            )}
            {(viewing.returnedTotalMinor ?? 0) > 0 && (
              <span dir="ltr" className="tabnum text-red font-bold">
                {t("store.returnedTotal")}: -{formatMinor(viewing.returnedTotalMinor ?? 0)}
              </span>
            )}
          </div>
          <ul className="divide-y divide-line text-sm">
            {viewing.items.map((it, i) => (
              <li key={`${it.productId}-${i}`} className="flex justify-between py-2">
                <span>
                  {it.productName} × {it.qty}
                  {it.returnedQty > 0 && (
                    <span className="ms-1.5 text-xs text-red font-semibold">({t("store.returnedTag")}: {it.returnedQty})</span>
                  )}
                </span>
                <span dir="ltr" className={`tabnum ${it.returnedQty >= it.qty ? "line-through text-subtle" : ""}`}>
                  {formatMinor(it.lineTotalMinor)}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

// ------------------------------- returns ----------------------------------

function ReturnModal({ sale, onClose, onDone }: { sale: StoreSale; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [fullSale, setFullSale] = useState<StoreSale | null>(sale.items && sale.items.length > 0 ? sale : null);
  const [loading, setLoading] = useState<boolean>(!sale.items || sale.items.length === 0);
  const [lines, setLines] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (sale.items && sale.items.length > 0) {
      for (const it of sale.items) init[it.id] = String(Math.max(0, it.qty - it.returnedQty));
    }
    return init;
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!sale.items || sale.items.length === 0) {
      setLoading(true);
      api.store
        .getSale(sale.id)
        .then((s) => {
          if (!alive) return;
          setFullSale(s);
          const init: Record<string, string> = {};
          for (const it of s.items) {
            init[it.id] = String(Math.max(0, it.qty - it.returnedQty));
          }
          setLines(init);
        })
        .catch((err) => {
          if (!alive) return;
          toast("error", describeError(err, t));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else {
      setFullSale(sale);
      const init: Record<string, string> = {};
      for (const it of sale.items) {
        init[it.id] = String(Math.max(0, it.qty - it.returnedQty));
      }
      setLines(init);
      setLoading(false);
    }
    return () => {
      alive = false;
    };
  }, [sale, t, toast]);

  const activeSale = fullSale ?? sale;
  const returnable = (activeSale.items || []).filter((it) => it.qty - it.returnedQty > 0);
  const itemsTotal = returnable.reduce((s, it) => s + it.unitPriceMinor * Math.max(0, Math.min(Number(lines[it.id] || 0), it.qty - it.returnedQty)), 0);
  const totalMinor = itemsTotal;

  const submit = async () => {
    const chosen = returnable
      .map((it) => ({ id: it.id, qty: Math.floor(Number(lines[it.id] || 0)) }))
      .filter((l) => l.qty > 0);
    if (chosen.length === 0) {
      toast("error", t("store.emptyReturn"));
      return;
    }
    setBusy(true);
    try {
      const ret = await api.store.returnSale({
        saleId: activeSale.id,
        lines: chosen.map((l) => ({ saleItemId: l.id, qty: l.qty })),
        reason: reason || null,
      });
      toast("success", t("store.returnToast", { no: ret.returnNo }));
      onDone();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Modal open onClose={onClose} title={`${t("store.makeReturn")} — ${sale.saleNo}`} widthClass="max-w-md">
        <p className="text-sm text-subtle py-8 text-center">{t("common.loading")}</p>
      </Modal>
    );
  }

  if (activeSale.isCredit && activeSale.debtStatus !== "settled") {
    return (
      <Modal open onClose={onClose} title={t("store.makeReturn")} widthClass="max-w-sm"
        footer={<Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>}>
        <p className="text-sm text-subtle">{t("store.returnBlockedCredit")}</p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`${t("store.makeReturn")} — ${activeSale.saleNo}`} widthClass="max-w-md"
      footer={<><Button type="submit" form="return-form" loading={busy}>{t("store.returnSubmit")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="return-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3.5">
        {returnable.length === 0 ? (
          <p className="text-sm text-subtle">{t("store.noReturnable")}</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {returnable.map((it) => {
                const max = it.qty - it.returnedQty;
                return (
                  <li key={it.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{it.productName}</span>
                      <span dir="ltr" className="block text-[11px] text-faint tabnum">{t("store.returnAvailable")}: {max}</span>
                    </span>
                    <span dir="ltr" className="w-16 text-end tabnum text-subtle">{formatMinor(it.unitPriceMinor * Math.max(0, Math.min(Number(lines[it.id] || 0), max)))}</span>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      dir="ltr"
                      className="w-16 rounded-lg border border-line bg-panel px-2 py-1.5 text-center tabnum"
                      value={lines[it.id] ?? "0"}
                      onChange={(e) => setLines((p) => ({ ...p, [it.id]: e.target.value }))}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between border-t border-line pt-2.5 text-base font-extrabold text-neon">
              <span>{t("store.returnHeader")}</span>
              <span dir="ltr" className="tabnum">{formatMinor(totalMinor)}</span>
            </div>
            <Input label={t("store.returnReason")} value={reason} onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} />
          </>
        )}
      </form>
    </Modal>
  );
}

function ReturnsTab({ highlightRowKey }: { highlightRowKey?: string | null }) {
  const t = useT();
  const [rows, setRows] = useState<Array<Omit<StoreReturnRow, "items">>>([]);
  const [viewing, setViewing] = useState<StoreReturnRow | null>(null);
  const reload = useCallback(() => {
    api.store.listReturns({}).then((r) => setRows(r.items)).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const openDetails = (returnId: string) => {
    api.store.getReturn(returnId).then(setViewing).catch(console.error);
  };

  const columns: Column<Omit<StoreReturnRow, "items">>[] = [
    { key: "no", header: t("store.returnNoCol"), render: (r) => (
      <button type="button" onClick={() => openDetails(r.id)} className="font-bold tabnum hover:text-neon" dir="ltr">{r.returnNo}</button>
    ) },
    { key: "sale", header: t("store.colSaleNo"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.saleNo}</span> },
    { key: "member", header: t("store.colMember"), render: (r) => r.memberName ?? "—" },
    { key: "total", header: t("store.colTotal"), render: (r) => <span dir="ltr" className="tabnum font-bold text-red">{formatMinor(r.totalMinor)}</span> },
    { key: "reason", header: t("store.returnReason"), render: (r) => r.reason ?? "—" },
    {
      key: "date",
      header: t("store.colDate"),
      render: (r) => (
        <span className="tabnum text-subtle text-xs flex flex-col">
          <span>{formatDateShort(new Date(r.createdAt.replace(" ", "T")))}</span>
          <span className="text-[11px] text-faint" dir="ltr">
            {formatTime(r.createdAt)}
          </span>
        </span>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader title={t("store.tabReturns")} />
        {rows.length === 0 ? <EmptyState icon={<Package />} title={t("store.emptyReturns")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} highlightRowKey={highlightRowKey} />}
      </Card>
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.returnNo} widthClass="max-w-md">
          <div className="mb-2 flex justify-between text-sm text-subtle">
            <span>{viewing.saleNo}</span>
            <span dir="ltr" className="tabnum font-bold text-red">{formatMinor(viewing.totalMinor)}</span>
          </div>
          <ul className="divide-y divide-line text-sm">
            {viewing.items.map((it, i) => (
              <li key={`${it.id}-${i}`} className="flex justify-between py-2">
                <span>{it.productName} × {it.qty}</span>
                <span dir="ltr" className="tabnum">{formatMinor(it.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

// --------------------------------- debts ----------------------------------

function DebtsTab({ highlightRowKey }: { highlightRowKey?: string | null }) {
  const t = useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<StoreDebtRow[]>([]);
  const [search, setSearch] = useState("");
  const [repayTarget, setRepayTarget] = useState<StoreDebtRow | null>(null);
  const [amountMajor, setAmountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);

  const reload = useCallback(() => {
    api.store.listDebts({ status: "open" }).then((r) => setRows(r.items)).catch(console.error);
    api.payments.methods().then(setMethods).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const repay = async () => {
    if (!repayTarget) return;
    try {
      await api.store.repayDebt({ debtId: repayTarget.id, amountMinor: Math.round(Number(amountMajor || 0) * 100), methodCode });
      toast("success", t("store.repaidToast"));
      setRepayTarget(null);
      setAmountMajor("");
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.memberName.toLowerCase().includes(q) ||
        r.memberCode.toLowerCase().includes(q) ||
        r.saleNo.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalOutstandingMinor = rows.reduce((s, r) => s + r.remainingMinor, 0);

  const columns: Column<StoreDebtRow>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (r) => (
        <div>
          <Link to={`/members/${r.memberId}`} className="font-bold text-white hover:text-neon underline-offset-2 hover:underline block">
            {r.memberName}
          </Link>
          <span dir="ltr" className="block text-[11px] text-faint tabnum">
            {r.memberCode}
          </span>
        </div>
      ),
    },
    { key: "saleNo", header: t("store.colSaleNo"), render: (r) => <span dir="ltr" className="tabnum font-bold text-subtle">{r.saleNo}</span> },
    {
      key: "original",
      header: "أصل الدين",
      render: (r) => <span dir="ltr" className="tabnum text-faint">{formatMinor(r.originalMinor)} ج.م</span>,
    },
    {
      key: "remaining",
      header: t("store.debtRemaining"),
      render: (r) => (
        <span dir="ltr" className="font-extrabold tabnum text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
          {formatMinor(r.remainingMinor)} ج.م
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setRepayTarget(r);
            setAmountMajor((r.remainingMinor / 100).toFixed(2));
          }}
          className="text-xs font-bold"
        >
          {t("store.repay")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("store.tabDebts")}
          action={
            rows.length > 0 ? (
              <span className="text-xs text-subtle flex items-center gap-1.5 font-bold">
                <span>إجمالي الديون المعلقة:</span>
                <span dir="ltr" className="text-sm font-black text-rose-400 tabnum bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20">
                  {formatMinor(totalOutstandingMinor)} ج.م
                </span>
              </span>
            ) : undefined
          }
        />

        {/* Search */}
        <div className="border-b border-line p-4">
          <div className="max-w-xs">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="بحث باسم العضو، الكود، أو رقم الفاتورة..."
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title={rows.length === 0 ? t("subs.balancePaid") : "لا توجد ديون تطابق البحث"}
            description={rows.length === 0 ? "جميع حسابات مبيعات المتجر الآجلة مسددة بالكامل." : "تأكد من كتابة الاسم أو الكود بشكل صحيح."}
          />
        ) : (
          <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.id} highlightRowKey={highlightRowKey} />
        )}
      </Card>

      {repayTarget && (
        <Modal
          open
          onClose={() => setRepayTarget(null)}
          title={`${t("store.repay")} — ${repayTarget.memberName}`}
          widthClass="max-w-sm"
          footer={
            <>
              <Button type="submit" form="repay-form" variant="primary">{t("common.confirm")}</Button>
              <Button variant="secondary" onClick={() => setRepayTarget(null)}>{t("common.cancel")}</Button>
            </>
          }
        >
          <form id="repay-form" onSubmit={(e) => { e.preventDefault(); void repay(); }} className="space-y-3.5">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
              <span className="text-xs text-subtle block">الرصيد المتبقي المستحق:</span>
              <span dir="ltr" className="text-xl font-black text-rose-400 tabnum block mt-0.5">
                {formatMinor(repayTarget.remainingMinor)} ج.م
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-subtle">{t("store.repayAmount")}:</label>
                <button
                  type="button"
                  onClick={() => setAmountMajor((repayTarget.remainingMinor / 100).toFixed(2))}
                  className="text-[11px] font-bold text-neon hover:underline"
                >
                  ⚡ سداد كامل الدين
                </button>
              </div>
              <Input
                type="number"
                step="0.01"
                min={0}
                dir="ltr"
                value={amountMajor}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAmountMajor(e.target.value)}
                autoFocus
              />
            </div>

            <Select
              label={t("store.method")}
              value={methodCode}
              onChange={(e) => setMethodCode(e.target.value)}
              options={
                methods.length > 0
                  ? methods.map((m) => ({ value: m.code, label: m.labelAr }))
                  : [
                      { value: "cash", label: "نقدي (خزينة المتجر)" },
                      { value: "bank_card", label: "بطاقة بنكية" },
                      { value: "transfer", label: "تحويل / محفظة" },
                    ]
              }
            />
          </form>
        </Modal>
      )}
    </>
  );
}

// ------------------------------- movements --------------------------------

function MovementsTab() {
  const t = useT();
  const [rows, setRows] = useState<StockMovementRow[]>([]);
  useEffect(() => {
    api.store.listStockMovements({ limit: 120 }).then(setRows).catch(console.error);
  }, []);

  const columns: Column<StockMovementRow>[] = [
    {
      key: "date",
      header: t("common.date"),
      render: (r) => (
        <span className="tabnum text-subtle text-xs flex flex-col">
          <span>{formatDateShort(new Date(r.createdAt.replace(" ", "T")))}</span>
          <span className="text-[11px] text-faint" dir="ltr">
            {formatTime(r.createdAt)}
          </span>
        </span>
      ),
    },
    { key: "product", header: t("store.name"), render: (r) => <span className="font-bold">{r.productName}</span> },
    { key: "type", header: "", render: (r) => t(MOVEMENT_LABEL_KEYS[r.movementType] ?? r.movementType, {} as never) },
    { key: "delta", header: t("store.qty"), render: (r) => <Badge variant={r.delta > 0 ? "success" : "danger"}>{r.delta > 0 ? `+${r.delta}` : `${r.delta}`}</Badge> },
    { key: "result", header: t("store.stock"), render: (r) => <span dir="ltr" className="tabnum">{r.resultQty}</span> },
  ];

  return (
    <Card>
      <CardHeader title={t("store.tabMovements")} />
      {rows.length === 0 ? <EmptyState icon={<Package />} title={t("audit.empty")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
    </Card>
  );
}

// -------------------------------- reports ---------------------------------

function ReportsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const defaultFrom = addDaysKey(todayKey(), -29);
  const [fromKey, setFromKey] = useState(defaultFrom);
  const [toKey, setToKey] = useState(todayKey());
  const [daily, setDaily] = useState<DailySalesRow[]>([]);
  const [products, setProducts] = useState<ProductSalesRow[]>([]);
  const [stockValue, setStockValue] = useState<StockValueRow | null>(null);
  const [lowStock, setLowStock] = useState<ProductPublic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const canProfit = hasPermission("store.profit");

  const load = useCallback(() => {
    if (!canProfit) { setLoaded(true); return; }
    const range = { fromKey, toKey };
    api.store.dailySalesReport(range).then(setDaily).catch(console.error);
    api.store.productSalesReport(range).then(setProducts).catch(console.error);
    api.store.stockValue().then(setStockValue).catch(console.error);
    api.store.lowStockProducts({ limit: 20 }).then(setLowStock).catch(console.error);
    setLoaded(true);
  }, [canProfit, fromKey, toKey]);

  useEffect(() => { load(); }, [load]);

  if (!canProfit) {
    return <Card><CardHeader title={t("store.tabReports")} /><p className="px-5 pb-5 text-sm text-subtle">{t("common.noPermission")}</p></Card>;
  }

  const dailyCols: Column<DailySalesRow>[] = [
    { key: "date", header: t("store.colDateKey"), render: (r) => <span dir="ltr" className="tabnum font-bold">{r.dateKey}</span> },
    { key: "count", header: t("store.colSalesCount"), render: (r) => <span className="tabnum">{r.salesCount}</span> },
    { key: "net", header: t("store.colNetMinor"), render: (r) => <span dir="ltr" className="tabnum font-bold">{formatMinor(r.netMinor)}</span> },
    { key: "returns", header: t("store.colReturnsCount"), render: (r) => r.returnsCount > 0 ? <span className="tabnum text-red">-{r.returnsMinor / 100} ({r.returnsCount})</span> : <span>—</span> },
    { key: "profit", header: t("store.colProfit"), render: (r) => <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span> },
  ];

  const prodCols: Column<ProductSalesRow>[] = [
    { key: "product", header: t("store.name"), render: (r) => <span className="font-bold">{r.productName}</span> },
    { key: "cat", header: t("store.category"), render: (r) => r.categoryName ?? "—" },
    { key: "units", header: t("store.colUnitsSold"), render: (r) => <span className="tabnum">{r.unitsSold}</span> },
    { key: "returned", header: t("store.colUnitsReturned"), render: (r) => r.unitsReturned > 0 ? <span className="tabnum text-red">{r.unitsReturned}</span> : <span className="tabnum text-subtle">0</span> },
    { key: "net", header: t("store.colNetUnits"), render: (r) => <span className="tabnum font-bold">{r.netUnits}</span> },
    { key: "revenue", header: t("store.colTotal"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.revenueMinor)}</span> },
    { key: "profit", header: t("store.colProfit"), render: (r) => <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span> },
  ];

  const lowStockCols: Column<ProductPublic>[] = [
    { key: "name", header: t("store.name"), render: (r) => <span className="font-bold">{r.name}</span> },
    { key: "stock", header: t("store.stock"), render: (r) => <Badge variant="danger">{r.stockQty}</Badge> },
    { key: "min", header: t("store.minStock"), render: (r) => <span className="tabnum">{r.minStockQty}</span> },
    { key: "value", header: t("store.stockCostValue"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.stockQty * r.costMinor)}</span> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("store.tabReports")}
          action={
            <div className="flex items-end gap-2">
              <div className="w-40"><Input type="date" dir="ltr" value={fromKey} onChange={(e) => setFromKey(e.target.value)} /></div>
              <div className="w-40"><Input type="date" dir="ltr" value={toKey} onChange={(e) => setToKey(e.target.value)} /></div>
              <Button size="sm" onClick={load}>{t("rpt.apply")}</Button>
            </div>
          }
        />
      </Card>

      {stockValue && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ValueCard label={t("store.stockCostValue")} value={formatMinor(stockValue.totalCostMinor)} />
          <ValueCard label={t("store.stockRetailValue")} value={formatMinor(stockValue.potentialRetailMinor)} />
          <ValueCard label={t("store.stockPotentialProfit")} value={formatMinor(stockValue.potentialGrossProfitMinor)} positive />
          <ValueCard label={t("store.stockProductCount")} value={String(stockValue.productCount)} />
        </div>
      )}

      {loaded && (
        <>
          <Card>
            <CardHeader title={t("store.reportDailySales")} />
            {daily.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={dailyCols} data={daily} rowKey={(r) => r.dateKey} />}
          </Card>
          <Card>
            <CardHeader title={t("store.reportBestSellers")} />
            {products.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={prodCols} data={products} rowKey={(r) => r.productId} />}
          </Card>
          <Card>
            <CardHeader title={t("store.reportLowStock")} />
            {lowStock.length === 0 ? <EmptyState icon={<Package />} title={t("store.reportLowStock")} /> : <DataTable columns={lowStockCols} data={lowStock} rowKey={(r) => r.id} />}
          </Card>
        </>
      )}
    </div>
  );
}

function ValueCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card>
      <div className="p-4">
        <p className="text-[11px] text-subtle">{label}</p>
        <p dir="ltr" className={`mt-1 text-lg font-extrabold tabnum ${positive ? "text-emerald" : ""}`}>{value}</p>
      </div>
    </Card>
  );
}
