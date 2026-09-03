import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { EmptyState } from "@/components/ui/empty-state";
import { Coins, WalletCards } from "lucide-react";
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
      <section>
        <h2 className="text-2xl font-extrabold tracking-tight">{t("treasury.title")}</h2>
        <p className="text-[13px] text-subtle">{t("treasury.subtitle")}</p>
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
