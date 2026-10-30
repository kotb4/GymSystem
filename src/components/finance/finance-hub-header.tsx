import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  BarChart3,
  ReceiptText,
  Scale,
  Wallet,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/api";
import { formatMinor } from "@/core/money";
import { cn } from "@/utils/cn";
import { ZReportModal } from "@/components/finance/z-report-modal";

export interface FinanceHubHeaderProps {
  currentSection?: "treasury" | "payments" | "expenses" | "debts" | "reports";
  onSessionClosed?: () => void;
  showNav?: boolean;
}

export function FinanceHubHeader({
  currentSection = "treasury",
  onSessionClosed,
  showNav = true,
}: FinanceHubHeaderProps) {
  const { hasPermission } = useAuth();

  const canTreasury = hasPermission("payments.view");
  const canExpenses = hasPermission("expenses.view");
  const canDebts = hasPermission("debts.view");
  const canReports = hasPermission("reports.view");
  const canCashClose = hasPermission("cash.close");

  const [zReportOpen, setZReportOpen] = useState(false);

  const [metrics, setMetrics] = useState({
    totalDebtsMinor: 0,
    openSession: false,
    openSessionClosingNo: null as string | null,
  });

  const loadMetrics = useCallback(async () => {
    try {
      const [cashSessionRes, debtsRes] = await Promise.all([
        canTreasury ? api.cash.openSession().catch(() => null) : Promise.resolve(null),
        canDebts ? api.debts.list({ limit: 1 }).catch(() => null) : Promise.resolve(null),
      ]);

      const totalDebts = debtsRes?.totalDebtMinor ?? 0;

      setMetrics({
        totalDebtsMinor: totalDebts,
        openSession: Boolean(cashSessionRes),
        openSessionClosingNo: cashSessionRes?.closingNo ?? null,
      });
    } catch {
      // fallback
    }
  }, [canTreasury, canDebts]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const handleZReportSuccess = () => {
    void loadMetrics();
    onSessionClosed?.();
  };

  // Main Finance Navigation Capsules (Strip 1)
  const navCapsules = [
    ...(canTreasury
      ? [
          {
            key: "treasury",
            path: "/treasury",
            label: "الخزينة والورديات (Z-Report)",
            icon: Wallet,
            badge: metrics.openSession ? "مفتوحة 🟢" : "مغلقة",
            badgeTone: metrics.openSession ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-700/40 text-zinc-400",
          },
          {
            key: "payments",
            path: "/payments",
            label: "سجل المدفوعات والتحصيل",
            icon: Banknote,
          },
        ]
      : []),
    ...(canExpenses
      ? [
          {
            key: "expenses",
            path: "/expenses",
            label: "المصروفات وسندات الصرف",
            icon: ReceiptText,
          },
        ]
      : []),
    ...(canDebts
      ? [
          {
            key: "debts",
            path: "/debts",
            label: "ديون ومستحقات الأعضاء",
            icon: Scale,
            badge: metrics.totalDebtsMinor > 0 ? formatMinor(metrics.totalDebtsMinor) : undefined,
            badgeTone: "bg-rose-500/20 text-rose-400 font-mono",
          },
        ]
      : []),
    ...(canReports
      ? [
          {
            key: "reports",
            path: "/reports",
            label: "التقارير المالية والسيولة",
            icon: BarChart3,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Strip 1: Finance Navigation Bar & Z-Report Action */}
      {showNav && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/[0.08] bg-panel/75 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
          <div className="flex flex-wrap items-center gap-1.5">
            {navCapsules.map((item) => {
              const isActive = currentSection === item.key;
              const Icon = item.icon;

              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all duration-200",
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
                  {item.badge && (
                    <span
                      className={cn(
                        "ms-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        item.badgeTone || "bg-neon/20 text-neon",
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* 1-Click Z-Report Action Button */}
          {canCashClose && (
            <button
              type="button"
              onClick={() => setZReportOpen(true)}
              className="group relative flex items-center gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent px-4 py-2 text-xs font-black text-amber-300 transition-all duration-200 hover:border-amber-400 hover:bg-amber-500/25 shadow-md shadow-amber-500/10 cursor-pointer active:scale-95"
            >
              <LockKeyhole className="size-3.5 text-amber-400 transition-transform group-hover:scale-110" />
              <span>⚡ تقفيل الوردية (Z-Report)</span>
            </button>
          )}
        </div>
      )}

      {/* 1-Click End of Shift / Daily Z-Report Modal */}
      <ZReportModal
        open={zReportOpen}
        onClose={() => setZReportOpen(false)}
        onSuccess={handleZReportSuccess}
      />
    </div>
  );
}
