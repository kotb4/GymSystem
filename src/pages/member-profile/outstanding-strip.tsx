import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { api } from "@/api";
import { formatMinor } from "@/core/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function Stat({ title, minor, highlight }: { title: string; minor: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-faint">{title}</p>
      <p dir="ltr" className={highlight ? "text-lg font-extrabold tabnum text-red" : "font-bold tabnum text-ink"}>
        {formatMinor(minor)}
      </p>
    </div>
  );
}

export function OutstandingStrip({ memberId, version }: { memberId: string; version: number }) {
  const t = useT();
  const [data, setData] = useState<{ subscriptionsMinor: number; storeMinor: number; totalMinor: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  return (
    <Card>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <Stat title={t("members.outstandingSubs")} minor={data.subscriptionsMinor} />
        <Stat title={t("members.outstandingStore")} minor={data.storeMinor} />
        <Stat title={t("members.outstandingTotal")} minor={data.totalMinor} highlight />
      </div>
    </Card>
  );
}
