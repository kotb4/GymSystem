import { useT } from "@/i18n";
import { formatMinor } from "@/core/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { subStatusMeta } from "@/utils/status-meta";
import type { MemberOverview } from "@/core/services/member-profile.service";

interface SummaryStatsProps {
  overview: MemberOverview | null;
  outstandingMinor: number;
  loading: boolean;
}

function daysLeftColor(n: number | null): string {
  if (n == null) return "text-faint";
  if (n <= 3) return "text-red";
  if (n <= 7) return "text-amber";
  return "text-neon";
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
    <Card>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <Cell
          label={t("members.statStatus")}
          value={
            active ? (
              <Badge variant={subStatusMeta(t, "active").variant} dot>
                {subStatusMeta(t, "active").label}
              </Badge>
            ) : (
              <span className="text-sm font-semibold text-faint">{t("members.statNoActiveSub")}</span>
            )
          }
        />
        <Cell
          label={t("members.statDaysLeft")}
          value={
            active && overview?.nextSubDaysLeft != null ? (
              <span className={`text-lg font-extrabold tabnum ${daysLeftColor(overview.nextSubDaysLeft)}`}>
                {overview.nextSubDaysLeft} {t("subs.daysUnit")}
              </span>
            ) : (
              <span className="text-faint tabnum">—</span>
            )
          }
        />
        <Cell
          label={t("members.statVisitsLeft")}
          value={
            sessionsLeft != null ? (
              <span className="text-lg font-extrabold tabnum text-ink">{sessionsLeft}</span>
            ) : (
              <span className="text-faint tabnum">—</span>
            )
          }
        />
        <Cell
          label={t("members.statBalance")}
          value={
            <span
              dir="ltr"
              className={
                outstandingMinor > 0
                  ? "text-lg font-extrabold tabnum text-red"
                  : "text-lg font-extrabold tabnum text-emerald"
              }
            >
              {formatMinor(outstandingMinor)}
            </span>
          }
        />
        <Cell
          label={t("members.statLastVisit")}
          value={
            <span dir="ltr" className="text-sm font-bold tabnum text-ink">
              {lastVisitLabel}
            </span>
          }
        />
      </div>
      {overview && (
        <div className="border-t border-line px-5 py-2 text-[11px] text-faint">
          {t("members.statVisitsThisMonth")}: <span className="font-bold tabnum text-ink">{overview.visitsThisMonth}</span>
          {loading && <span className="ms-2">…</span>}
        </div>
      )}
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-faint">{label}</p>
      <div>{value}</div>
    </div>
  );
}
