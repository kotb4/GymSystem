import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Banknote, BarChart3, Coins, ReceiptText, ShoppingBag, WalletCards } from "lucide-react";
import { CashSessionsPanel } from "@/pages/cash-page";

export function TreasuryPage() {
  const t = useT();
  const { hasPermission } = useAuth();

  const canSessions = hasPermission("payments.view");

  if (!canSessions) {
    return (
      <div className="space-y-5">
        <EmptyState icon={<Coins />} title={t("errors.forbidden")} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("treasury.title")}</h2>
          <p className="text-[13px] text-subtle">{t("treasury.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("payments.view") && (
            <Link to="/payments">
              <Button variant="secondary" size="sm">
                <Banknote className="size-4" />
                {t("nav.payments")}
              </Button>
            </Link>
          )}
          {hasPermission("expenses.view") && (
            <Link to="/expenses">
              <Button variant="secondary" size="sm">
                <ReceiptText className="size-4" />
                {t("nav.expenses")}
              </Button>
            </Link>
          )}
          {hasPermission("store.view") && (
            <Link to="/store">
              <Button variant="secondary" size="sm">
                <ShoppingBag className="size-4" />
                {t("nav.store")}
              </Button>
            </Link>
          )}
          {hasPermission("reports.view") && (
            <Link to="/reports">
              <Button variant="secondary" size="sm">
                <BarChart3 className="size-4" />
                {t("nav.reports")}
              </Button>
            </Link>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <WalletCards className="size-5 text-neon" />
          <h3 className="text-lg font-bold">{t("cashPage.title")}</h3>
        </div>
        <p className="text-[12px] text-faint">{t("treasury.sessionSectionHint")}</p>
        <CashSessionsPanel />
      </section>
    </div>
  );
}

export default TreasuryPage;
