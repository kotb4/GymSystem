import { useT } from "@/i18n";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Coins } from "lucide-react";

interface TreasuryListProps {
  hasPermission: (permission: string) => boolean;
  onViewDetail: (id: string) => void;
  onReopen: (id: string, reason: string) => void;
  onClose: (id: string, counted: string, reason: string | null) => void;
}

export function TreasuryList({
  hasPermission: _hasPermission,
  onViewDetail: _onViewDetail,
  onReopen: _onReopen,
  onClose: _onClose,
}: TreasuryListProps) {
  const t = useT();

  return (
    <Card>
      <CardHeader title={t("treasury.historyTitle")} />
      <EmptyState icon={<Coins />} title={t("treasury.noClosings")} />
    </Card>
  );
}