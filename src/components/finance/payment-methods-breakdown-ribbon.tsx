import { useEffect, useState, useCallback } from "react";
import {
  Banknote,
  CreditCard,
  Landmark,
  Smartphone,
  Zap,
  Coins,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import { api, type PaymentMethodsBreakdownResult } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { cn } from "@/utils/cn";

export interface PaymentMethodsBreakdownRibbonProps {
  selectedMethod?: string | null;
  onSelectMethod?: (methodCode: string | null) => void;
  fromKey?: string;
  toKey?: string;
  box?: "all" | "gym" | "store";
  refreshTick?: number;
  className?: string;
  title?: string;
}

const METHOD_THEMES: Record<
  string,
  {
    icon: typeof Banknote;
    border: string;
    bg: string;
    text: string;
    badgeBg: string;
    accentRing: string;
  }
> = {
  cash: {
    icon: Banknote,
    border: "border-emerald-500/30 hover:border-emerald-500/60",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    badgeBg: "bg-emerald-500/20 text-emerald-300",
    accentRing: "ring-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.35)]",
  },
  instapay: {
    icon: Zap,
    border: "border-cyan-500/30 hover:border-cyan-500/60",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    badgeBg: "bg-cyan-500/20 text-cyan-300",
    accentRing: "ring-cyan-500/80 shadow-[0_0_20px_rgba(6,182,212,0.35)]",
  },
  wallet: {
    icon: Smartphone,
    border: "border-rose-500/30 hover:border-rose-500/60",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    badgeBg: "bg-rose-500/20 text-rose-300",
    accentRing: "ring-rose-500/80 shadow-[0_0_20px_rgba(244,63,94,0.35)]",
  },
  bank_card: {
    icon: CreditCard,
    border: "border-blue-500/30 hover:border-blue-500/60",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    badgeBg: "bg-blue-500/20 text-blue-300",
    accentRing: "ring-blue-500/80 shadow-[0_0_20px_rgba(59,130,246,0.35)]",
  },
  transfer: {
    icon: Landmark,
    border: "border-purple-500/30 hover:border-purple-500/60",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    badgeBg: "bg-purple-500/20 text-purple-300",
    accentRing: "ring-purple-500/80 shadow-[0_0_20px_rgba(168,85,247,0.35)]",
  },
  other: {
    icon: HelpCircle,
    border: "border-slate-500/30 hover:border-slate-500/60",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    badgeBg: "bg-slate-500/20 text-slate-300",
    accentRing: "ring-slate-400/80 shadow-[0_0_20px_rgba(148,163,184,0.35)]",
  },
};

export function PaymentMethodsBreakdownRibbon({
  selectedMethod,
  onSelectMethod,
  fromKey,
  toKey,
  box = "all",
  refreshTick = 0,
  className,
  title = "توزيع الإيرادات المحصلة حسب طريقة الدفع",
}: PaymentMethodsBreakdownRibbonProps) {
  const [data, setData] = useState<PaymentMethodsBreakdownResult | null>(null);
  const [loading, setLoading] = useState(false);

  const loadBreakdown = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.finance.paymentMethodsBreakdown({
        fromKey: fromKey ?? todayKey(),
        toKey: toKey ?? todayKey(),
        box,
      });
      setData(res);
    } catch (err) {
      console.error("Failed to load payment methods breakdown:", err);
    } finally {
      setLoading(false);
    }
  }, [fromKey, toKey, box]);

  useEffect(() => {
    void loadBreakdown();
  }, [loadBreakdown, refreshTick]);

  if (!data && loading) {
    return (
      <div className={cn("p-4 rounded-2xl border border-white/[0.08] bg-panel/60 animate-pulse", className)}>
        <div className="h-4 w-48 bg-white/10 rounded mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 bg-white/5 rounded-xl border border-white/5" />
          ))}
        </div>
      </div>
    );
  }

  const methods = data?.methods ?? [];
  const isFiltered = Boolean(selectedMethod && selectedMethod !== "all");

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-panel/80 p-4 shadow-xl backdrop-blur-xl transition-all duration-300",
        className,
      )}
    >
      {/* Ribbon Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5 pb-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-neon/15 text-neon">
            <Coins className="size-4" />
          </div>
          <div>
            <h4 className="text-xs font-black tracking-tight text-white flex items-center gap-2">
              <span>{title}</span>
              {data && (
                <span className="rounded-full bg-white/10 text-slate-300 px-2 py-0.5 text-[10px] font-mono font-bold">
                  إجمالي الداخل: {formatMinor(data.totalInflowMinor)}
                </span>
              )}
            </h4>
            <p className="text-[11px] text-subtle">
              اضغط على أي طريقة دفع لتصفية القيود والعمليات التابعة لها فوراً
            </p>
          </div>
        </div>

        {isFiltered && onSelectMethod && (
          <button
            type="button"
            onClick={() => onSelectMethod(null)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 px-3 py-1 text-[11px] font-bold text-white transition-colors cursor-pointer border border-white/10"
          >
            <CheckCircle2 className="size-3 text-neon" />
            <span>عرض كافة الطرق (إلغاء التصفية)</span>
          </button>
        )}
      </div>

      {/* Method Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
        {methods.map((m) => {
          const theme = METHOD_THEMES[m.code] ?? METHOD_THEMES.other;
          const Icon = theme.icon;
          const isSelected = selectedMethod === m.code;

          return (
            <button
              key={m.code}
              type="button"
              onClick={() => onSelectMethod?.(isSelected ? null : m.code)}
              className={cn(
                "group relative flex flex-col justify-between p-3 rounded-xl border text-start transition-all duration-200 cursor-pointer overflow-hidden",
                theme.bg,
                theme.border,
                isSelected
                  ? cn("ring-2 scale-[1.02] shadow-lg", theme.accentRing, "bg-white/[0.08]")
                  : "hover:scale-[1.01] hover:bg-white/[0.04]",
              )}
            >
              {/* Method header & Icon */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-white group-hover:text-ink truncate">
                  {m.labelAr}
                </span>
                <div className={cn("p-1 rounded-md", theme.bg, theme.text)}>
                  <Icon className="size-3.5" />
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-0.5">
                <p dir="ltr" className={cn("font-mono font-black text-sm tracking-tight text-end", theme.text)}>
                  {formatMinor(m.inflowMinor)}
                </p>
                <div className="flex items-center justify-between text-[10px] text-subtle pt-1 border-t border-white/[0.04]">
                  <span>{m.count} عملية</span>
                  {m.percentage > 0 && (
                    <span className={cn("px-1 rounded font-bold font-mono text-[9px]", theme.badgeBg)}>
                      {m.percentage}%
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
