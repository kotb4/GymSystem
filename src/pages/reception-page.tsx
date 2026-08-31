import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleUserRound,
  IdCard,
  RotateCcw,
  ScanLine,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/contexts/auth-context";
import { describeError } from "@/utils/app-error";
import { trialPlanLabel } from "@/utils/trial-label";
import { api } from "@/api";
import type {
  ReceptionLookup,
  ReceptionSearchResult,
} from "@/core/services/reception.service";
import type { CheckInResult } from "@/core/services/attendance.service";
import { diffDaysKeys, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";

import { useConfiguredScanner } from "@/hooks/use-configured-scanner";
import { playErrorBuzz, playSuccessChime } from "@/utils/sound";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

const DEBOUNCE_MS = 300;

interface RecentRow {
  id: string;
  memberName: string;
  memberCode: string;
  checkinAt: string;
}

export function ReceptionPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState("");
  const [looking, setLooking] = useState(false);
  const [results, setResults] = useState<ReceptionSearchResult[]>([]);
  const [selected, setSelected] = useState<ReceptionLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitted, setSubmitted] = useState<CheckInResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [tick, setTick] = useState(0);

  const reloadRecent = useCallback(() => {
    if (!actor || !hasPermission("checkin.view_history")) return;
    let alive = true;
    api.attendance
      .recent(10)
      .then((rows) => {
        if (!alive) return;
        setRecent(
          (rows as unknown as RecentRow[]).map((r) => ({
            id: r.id,
            memberName: r.memberName,
            memberCode: r.memberCode,
            checkinAt: r.checkinAt,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actor, hasPermission]);

  useEffect(() => {
    reloadRecent();
  }, [reloadRecent, tick]);

  useEffect(() => {
    document.title = `${t("nav.reception")} — ${t("app.name")}`;
  }, [t]);

  // Debounced fuzzy search by name / phone / member-code while typing.
  useEffect(() => {
    const value = term.trim();
    if (value === "" || looking) {
      setResults([]);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      api.reception
        .search(value)
        .then((res) => {
          if (alive) setResults(res);
        })
        .catch(() => {
          if (alive) setResults([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [term, looking]);

  const applyLookup = useCallback(
    async (input: { barcode?: string; memberId?: string }) => {
      setLooking(true);
      setSubmitted(null);
      setErrorText(null);
      try {
        const lookup = await api.reception.lookup(input);
        setSelected(lookup);
        if (lookup.member && !input.memberId) setTerm(lookup.member.memberCode);
      } catch (err) {
        setErrorText(describeError(err, t));
      } finally {
        setResults([]);
        setLooking(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [t],
  );

  useConfiguredScanner((barcode) => {
    if (barcode.trim() !== "") {
      setTerm(barcode);
      void applyLookup({ barcode });
    }
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = term.trim();
    if (value === "") return;
    if (selected?.member && value === selected.member.memberCode) return;
    void applyLookup({ barcode: value });
  };

  const pickMember = (memberId: string) => {
    void applyLookup({ memberId });
  };

  const resetAll = () => {
    setTerm("");
    setResults([]);
    setSelected(null);
    setSubmitted(null);
    setErrorText(null);
    setLooking(false);
    inputRef.current?.focus();
  };

  const doCheckIn = async () => {
    if (!selected || !selected.member) return;
    setChecking(true);
    setErrorText(null);
    try {
      const result = await api.reception.checkIn({
        barcode: selected.source === "barcode" && selected.barcode ? selected.barcode : undefined,
        memberId: selected.member.id,
        deviceIdentifier: "reception",
      });
      setSubmitted(result);
      if (result.kind === "success") {
        void api.settings.soundEnabled().then((on) => {
          if (on) playSuccessChime();
        });
        toast("success", t("reception.successSub", { name: result.memberName }));
      } else if (result.kind !== "duplicate") {
        void api.settings.soundEnabled().then((on) => {
          if (on) playErrorBuzz();
        });
      }
      setTick((prev) => prev + 1);
    } catch (err) {
      setErrorText(describeError(err, t));
    } finally {
      setChecking(false);
    }
  };

  const recentColumns: Column<RecentRow>[] = [
    {
      key: "name",
      header: t("common.member"),
      render: (row) => <span className="font-bold">{row.memberName}</span>,
    },
    {
      key: "code",
      header: t("members.code"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.memberCode}
        </span>
      ),
    },
    {
      key: "time",
      header: t("common.time"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.checkinAt.slice(11, 16)}
        </span>
      ),
    },
  ];

  const showResultsList = !selected && results.length > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        <Card>
          <CardHeader title={t("reception.searchTitle")} />
          <div className="space-y-4 p-5">
            <p className="text-[13px] text-subtle">{t("reception.searchHint")}</p>
            <form onSubmit={onSubmit} className="flex items-end gap-2.5">
              <div className="flex-1">
                <Input
                  ref={inputRef}
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder={t("reception.searchPh")}
                  icon={<Search className="size-4" />}
                  disabled={looking}
                  autoFocus
                />
              </div>
              <Button type="submit" size="lg" disabled={looking || term.trim() === ""}>
                <ScanLine className="size-4" />
                {t("reception.checkin")}
              </Button>
            </form>

            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 text-xs font-bold text-neon transition-opacity hover:opacity-80"
            >
              <RotateCcw className="size-3.5" />
              {t("reception.reset")}
            </button>
          </div>
        </Card>

        {errorText && (
          <div role="alert" className="rounded-2xl border border-red/30 bg-red/10 px-4 py-3.5 text-sm font-semibold text-red">
            {errorText}
          </div>
        )}

        {submitted?.kind === "success" && submitted.memberName && (
          <ResultBanner
            kind="success"
            title={t("reception.statusValid")}
            sub={t("reception.successSub", { name: submitted.memberName })}
          />
        )}
        {submitted?.kind === "duplicate" && submitted.memberName && (
          <ResultBanner
            kind="warning"
            title={t("reception.alreadyIn")}
            sub={t("reception.duplicateSub", { n: String(submitted.secondsAgo) })}
          />
        )}
        {submitted?.kind === "denied" && submitted.memberName && (
          <ResultBanner
            kind="error"
            title={t(`reception.reasons.${submitted.reason}`)}
            sub={submitted.barcode ? submitted.barcode : ""}
          />
        )}

        {selected?.member && (
          <StatusPanel lookup={selected} checking={checking} onCheckIn={doCheckIn} />
        )}

        {!selected && showResultsList && (
          <Card>
            <CardHeader title={t("reception.selectHint")} />
            <ul className="divide-y divide-line p-2">
              {results.map((res) => (
                <SearchRow key={res.member.id} result={res} onSelect={pickMember} />
              ))}
            </ul>
          </Card>
        )}

        {!selected && !showResultsList && !errorText && (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span
                aria-hidden
                className="grid size-14 animate-pulse place-items-center rounded-2xl border border-line bg-surface text-faint"
              >
                <ScanLine className="size-6" />
              </span>
              <p className="text-sm font-semibold text-subtle">{t("reception.selectHint")}</p>
            </div>
          </Card>
        )}
      </div>

      {hasPermission("checkin.view_history") ? (
        <Card className="h-fit xl:col-span-2">
          <CardHeader title={t("reception.recent")} />
          {recent.length === 0 ? (
            <EmptyState icon={<UserRoundCheck />} title={t("reception.noRecent")} />
          ) : (
            <DataTable columns={recentColumns} data={recent} rowKey={(r) => r.id} />
          )}
        </Card>
      ) : null}
    </div>
  );
}

function SearchRow({
  result,
  onSelect,
}: {
  result: ReceptionSearchResult;
  onSelect: (memberId: string) => void;
}) {
  const t = useT();
  const elig = result.eligibility;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(result.member.id)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-colors hover:bg-white/[0.04]"
      >
        {result.member.photoFileId ? (
          <img
            src={api.files.url(result.member.photoFileId)}
            alt={result.member.fullName}
            className="size-10 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-faint">
            <CircleUserRound className="size-5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{result.member.fullName}</span>
          <span className="block text-xs text-subtle">
            <span dir="ltr" className="tabnum">
              {result.member.memberCode}
            </span>
            {result.member.phone ? ` · ${result.member.phone}` : ""}
          </span>
        </span>
        <Badge variant={elig.eligible ? "success" : "danger"} dot>
          {t(`reception.reasons.${elig.reason}`)}
        </Badge>
      </button>
    </li>
  );
}

function StatusPanel({
  lookup,
  checking,
  onCheckIn,
}: {
  lookup: ReceptionLookup;
  checking: boolean;
  onCheckIn: () => void;
}) {
  const t = useT();
  const member = lookup.member!;
  const elig = lookup.eligibility;
  const valid = elig?.eligible ?? false;
  const left = elig?.subscriptionEndsAt != null ? diffDaysKeys(elig.subscriptionEndsAt, todayKey()) : null;

  return (
    <div
      className={cn(
        "animate-pop rounded-2xl border p-5",
        valid ? "border-neon/40 bg-neon/[0.07] shadow-glow-sm" : "border-red/40 bg-red/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        {member.photoFileId ? (
          <img
            src={api.files.url(member.photoFileId)}
            alt={member.fullName}
            className="size-14 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-2xl",
              valid ? "bg-neon/15 text-neon" : "bg-red/15 text-red",
            )}
          >
            <UserRoundCheck className="size-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{member.fullName}</p>
          <p className="text-[13px] text-subtle">
            <span dir="ltr" className="tabnum">
              {member.memberCode}
            </span>
            {member.phone ? ` · ${member.phone}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={valid ? "success" : "danger"} dot>
            {valid ? t("reception.statusValid") : t("reception.statusInvalid")}
          </Badge>
          <Badge variant="neutral">
            {lookup.source === "barcode" ? t("reception.sourceBarcode") : t("reception.sourceMember")}
          </Badge>
        </div>
      </div>

      {elig ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-line/60 pt-4 text-[13px] sm:grid-cols-3">
          <Info label={t("reception.fieldPlan")} value={trialPlanLabel(elig.planName, t) ?? "—"} />
          {elig.subscriptionEndsAt && (
            <Info label={t("reception.fieldExpiry")} value={elig.subscriptionEndsAt} ltr />
          )}
          {left != null && <Info label={t("reception.fieldRemaining")} value={`${left}`} ltr />}
          {elig.sessionsRemaining != null && (
            <Info label={t("reception.sessionsLeft")} value={`${elig.sessionsRemaining}`} ltr />
          )}
          <Info
            label={t("reception.outstanding")}
            value={formatMinor(elig.outstandingMinor)}
            ltr
            tone={elig.outstandingMinor > 0 ? "red" : undefined}
          />
          <Info
            label={t("reception.lastCheckIn")}
            value={elig.lastCheckInAt ? elig.lastCheckInAt.slice(11, 16) : t("reception.noCheckInYet")}
          />
        </dl>
      ) : (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-line/60 pt-4 text-[13px] sm:grid-cols-2">
          <Info
            label={t("reception.cardStatus")}
            value={
              lookup.cardStatus === "available"
                ? t("cards.statusAvailable")
                : lookup.cardStatus === "assigned"
                  ? t("cards.statusAssigned")
                  : lookup.cardStatus === "lost"
                    ? t("cards.statusLost")
                    : lookup.cardStatus === "blocked"
                      ? t("cards.statusBlocked")
                      : "—"
            }
          />
        </dl>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line/60 pt-4">
        <p className={cn("text-[13px] font-semibold", valid ? "text-neon" : "text-red")}>
          {valid
            ? t("reception.validHint")
            : elig
              ? t(`reception.reasons.${elig.reason}`)
              : t("reception.statusInvalid")}
        </p>
        <Button size="lg" onClick={onCheckIn} loading={checking} disabled={checking || !valid}>
          {!checking && <CheckCircle2 className="size-4" />}
          {t("reception.checkin")}
        </Button>
      </div>
    </div>
  );
}

function ResultBanner({
  kind,
  title,
  sub,
}: {
  kind: "success" | "warning" | "error";
  title: string;
  sub: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "animate-pop flex items-center gap-3 rounded-2xl border px-4 py-3.5",
        kind === "success" && "border-neon/40 bg-neon/[0.07]",
        kind === "warning" && "border-amber/40 bg-amber/[0.07]",
        kind === "error" && "border-red/40 bg-red/[0.07]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          kind === "success" && "bg-neon/15 text-neon",
          kind === "warning" && "bg-amber/15 text-amber",
          kind === "error" && "bg-red/15 text-red",
        )}
      >
        {kind === "success" ? (
          <CheckCircle2 className="size-5" />
        ) : kind === "warning" ? (
          <IdCard className="size-5" />
        ) : (
          <ShieldAlert className="size-5" />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate font-extrabold">{title}</p>
        <p className="truncate text-[13px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  ltr,
  tone,
}: {
  label: string;
  value: string;
  ltr?: boolean;
  tone?: "red";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-faint">{label}</dt>
      <dd
        dir={ltr ? "ltr" : undefined}
        className={cn("mt-0.5 truncate font-bold tabnum", tone === "red" && "text-red")}
      >
        {value}
      </dd>
    </div>
  );
}
