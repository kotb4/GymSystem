import { useT } from "@/i18n";
import { Card, CardHeader } from "@/components/ui/card";
import { Coins, ArrowUpCircle } from "lucide-react";

interface TreasuryDetailProps {
  closingId: string | null;
  onClose: () => void;
  onPrint: () => void;
}

export function TreasuryDetail({
  closingId,
  onClose,
  onPrint,
}: TreasuryDetailProps) {
  const t = useT();

  if (!closingId) {
    return (
      <Card>
        <CardHeader title={t("treasury.detailTitle")} />
        <div className="p-4 text-center">
          <Coins className="size-8 text-faint" />
          <p className="mt-2">{t("treasury.notFound")}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={t("treasury.detailTitle")} />
      <div className="p-4 text-center space-y-3">
        <Coins className="size-8 text-faint" />
        <p className="text-sm text-faint">
          {t("treasury.detailLoadingHint", { id: closingId })}
        </p>
        <button
          onClick={onClose}
          className="mt-2 px-3 py-1 text-sm border border-line rounded hover:bg-white/[0.03]"
        >
          <ArrowUpCircle className="inline-block size-3 me-1" />
          {t("common.back")}
        </button>
        <button
          onClick={onPrint}
          className="mt-2 px-3 py-1 text-sm bg-neon text-base rounded hover:bg-neon/90"
        >
          {t("treasury.printBtn")}
        </button>
      </div>
    </Card>
  );
}