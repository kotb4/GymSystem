import { useT } from "@/i18n";
import { formatMinor } from "@/core/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { subStatusMeta } from "@/utils/status-meta";
import type { MemberOverview } from "@/core/services/member-profile.service";
import { Activity, Calendar, Dumbbell, Banknote, Clock } from "lucide-react";

interface SummaryStatsProps {
  overview: MemberOverview | null;
  outstandingMinor: number;
  loading: boolean;
}

function daysLeftColor(n: number | null): string {
  if (n == null) return "text-faint";
  if (n <= 3) return "text-red";
  if (n <= 7) return "text-amber";
  return "text-[#00D2FF]";
}

export function SummaryStats({ overview, outstandingMinor, loading }: SummaryStatsProps) {
  const t = useT();
  const active = overview?.activeSubscription ?? null;
  const kind = active?.kind ?? "time";
  const sessionsLeft =
    kind === "sessions" && active?.sessionsTotal != null
      ? Math.max(0, active.sessionsTotal - active.sessionsUsed)
      : null;
  const lastVisit = overview?.lastAttendanceAt;
  const lastVisitLabel = lastVisit
    ? lastVisit.slice(0, 10)
    : t("members.statNeverVisited");

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Cell
          label={t("members.statStatus")}
          icon={<Activity className="size-4 text-[#0055FF]" />}
          value={
            active ? (
              <Badge variant={subStatusMeta(t, "active").variant} dot>
                {subStatusMeta(t, "active").label}
              </Badge>
            ) : (
              <span className="text-xs font-bold text-faint">{t("members.statNoActiveSub")}</span>
            )
          }
        />
        <Cell
          label={t("members.statDaysLeft")}
          icon={<Calendar className="size-4 text-[#00D2FF]" />}
          value={
            active && overview?.nextSubDaysLeft != null ? (
              <span className={`text-base font-extrabold tabnum font-mono ${daysLeftColor(overview.nextSubDaysLeft)}`}>
                {overview.nextSubDaysLeft} {t("subs.daysUnit")}
              </span>
            ) : (
              <span className="text-faint tabnum">—</span>
            )
          }
        />
        <Cell
          label={t("members.statVisitsLeft")}
          icon={<Dumbbell className="size-4 text-purple-400" />}
          value={
            sessionsLeft != null ? (
              <span className="text-base font-extrabold tabnum text-ink font-mono">{sessionsLeft}</span>
            ) : (
              <span className="text-faint tabnum">—</span>
            )
          }
        />
        <Cell
          label={t("members.statBalance")}
          icon={<Banknote className={`size-4 ${outstandingMinor > 0 ? "text-red" : "text-emerald"}`} />}
          value={
            <span
              dir="ltr"
              className={
                outstandingMinor > 0
                  ? "text-base font-extrabold tabnum text-red font-mono"
                  : "text-base font-extrabold tabnum text-emerald font-mono"
              }
            >
              {formatMinor(outstandingMinor)}
            </span>
          }
        />
        <Cell
          label={t("members.statLastVisit")}
          icon={<Clock className="size-4 text-amber" />}
          value={
            <span dir="ltr" className="text-xs font-bold tabnum text-ink font-mono">
              {lastVisitLabel}
            </span>
          }
        />
      </div>
      {overview && (
        <div className="border-t border-line bg-surface/30 px-5 py-2 text-[11px] text-faint flex items-center justify-between">
          <div>
            {t("members.statVisitsThisMonth")}: <span className="font-bold tabnum text-ink">{overview.visitsThisMonth}</span>
            {loading && <span className="ms-2">…</span>}
          </div>
          <span className="text-[10px] text-subtle">GymGate Member Intelligence</span>
        </div>
      )}
    </Card>
  );
}

function Cell({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-line bg-surface/50 p-3 min-w-0 space-y-2">
      <div className="flex items-center justify-between text-faint">
        <span className="text-xs font-semibold text-subtle truncate">{label}</span>
        {icon}
      </div>
      <div>{value}</div>
    </div>
  );
}

export default SummaryStats;
