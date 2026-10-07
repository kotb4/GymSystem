import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { api, type MemberOutstanding } from "@/api";
import { formatMinor } from "@/core/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ChevronDown, ChevronUp, ShoppingBag, Calendar } from "lucide-react";

function Stat({ title, minor, highlight }: { title: string; minor: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-faint">{title}</p>
      <p dir="ltr" className={highlight ? "text-lg font-extrabold tabnum text-red font-mono" : "font-bold tabnum text-ink font-mono"}>
        {formatMinor(minor)}
      </p>
    </div>
  );
}

export function OutstandingStrip({
  memberId,
  version,
  onPay,
}: {
  memberId: string;
  version: number;
  onPay?: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<MemberOutstanding | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.finance
      .outstandingForMember(memberId)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch(() => {
        if (alive) {
          setData(null);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [memberId, version, attempt]);

  if (failed) {
    return (
      <Card className="border-amber/30 bg-amber/[0.05]">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-sm font-bold text-amber">{t("members.outstandingError")}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
            {t("health.rerun")}
          </Button>
        </div>
      </Card>
    );
  }

  if (!data || data.totalMinor === 0) {
    return (
      <Card className="border-emerald/25 bg-emerald/[0.04]">
        <div className="px-5 py-3 text-sm font-bold text-emerald">✓ {t("members.noOutstanding")}</div>
      </Card>
    );
  }

  const hasItems = (data.subscriptions?.length ?? 0) > 0 || (data.storeDebts?.length ?? 0) > 0;

  return (
    <Card className="border-red/30 bg-red/[0.02] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="grid gap-6 sm:grid-cols-3 flex-1">
          <Stat title={t("members.outstandingSubs")} minor={data.subscriptionsMinor} />
          <Stat title={t("members.outstandingStore")} minor={data.storeMinor} />
          <Stat title={t("members.outstandingTotal")} minor={data.totalMinor} highlight />
        </div>
        <div className="flex items-center gap-2">
          {hasItems && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setExpanded((prev) => !prev)}
              className="gap-1.5 text-xs"
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span>{expanded ? t("pay.hideBreakdown") : t("pay.viewBreakdown")}</span>
            </Button>
          )}
          {onPay && (
            <Button size="sm" variant="primary" onClick={onPay} className="gap-1.5">
              <Banknote className="size-4" />
              <span>{t("reception.payOutstanding")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Expandable detailed breakdown list */}
      {expanded && hasItems && (
        <div className="border-t border-red/20 bg-black/10 px-5 py-3.5 space-y-2.5">
          <p className="text-xs font-bold text-subtle">{t("pay.viewBreakdown")}:</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.subscriptions?.map((sub) => (
              <div
                key={sub.subscriptionId}
                className="flex items-center justify-between rounded-xl border border-line bg-surface/80 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-3.5 text-neon" />
                    <span className="font-bold truncate">{sub.planName}</span>
                    <Badge variant="info" className="text-[10px] py-0">
                      {t("pay.settleItemSubscription")}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-subtle mt-0.5">
                    {sub.startDate} ← {sub.endDate}
                  </p>
                </div>
                <div className="text-end shrink-0 ms-2">
                  <span dir="ltr" className="font-extrabold text-red font-mono block">
                    {formatMinor(sub.remainingMinor)}
                  </span>
                  <span className="text-[10px] text-faint block">
                    {t("pay.settlePaidSoFar", { amount: formatMinor(sub.paidMinor + sub.discountMinor) })}
                  </span>
                </div>
              </div>
            ))}

            {data.storeDebts?.map((debt) => (
              <div
                key={debt.debtId}
                className="flex items-center justify-between rounded-xl border border-line bg-surface/80 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="size-3.5 text-amber" />
                    <span className="font-bold truncate">{debt.saleNo}</span>
                    <Badge variant="warning" className="text-[10px] py-0">
                      {t("pay.settleItemStoreDebt")}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-subtle mt-0.5">
                    {debt.createdAt ? debt.createdAt.slice(0, 10) : ""}
                  </p>
                </div>
                <div className="text-end shrink-0 ms-2">
                  <span dir="ltr" className="font-extrabold text-red font-mono block">
                    {formatMinor(debt.remainingMinor)}
                  </span>
                  <span className="text-[10px] text-faint block">
                    {t("pay.settlePaidSoFar", { amount: formatMinor(debt.paidMinor) })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
