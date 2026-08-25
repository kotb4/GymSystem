import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ScanLine, ShieldAlert, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type CardWithMember } from "@/api";
import type { CheckInResult, RecentCheckIn } from "@/core/services/attendance.service";
import { diffDaysKeys, todayKey } from "@/core/dates";

import { useConfiguredScanner } from "@/hooks/use-configured-scanner";

import { playErrorBuzz, playSuccessChime } from "@/utils/sound";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarcodeField } from "@/components/ui/barcode-field";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export function CheckInPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [barcode, setBarcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentCheckIn[]>([]);
  const [quickCards, setQuickCards] = useState<CardWithMember[]>([]);
  const [tick, setTick] = useState(0);

  const reloadRecent = useCallback(() => {
    if (!actor || !hasPermission("checkin.view_history")) return;
    let alive = true;
    api.attendance
      .recent(8)
      .then((rows) => {
        if (alive) setRecent(rows as RecentCheckIn[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, hasPermission]);

  useEffect(() => {
    reloadRecent();
  }, [reloadRecent, tick]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    api.cards
      .list({ status: "assigned", pageSize: 6 })
      .then((res) => {
        if (alive) setQuickCards(res.items.slice(0, 6));
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor]);

  const submitBarcode = useCallback(
    async (raw: string) => {
      if (!actor) return;
      const value = raw.trim().toUpperCase();
      if (value === "") return;
      setSubmitting(true);
      setErrorText(null);
      try {
        const checkInResult = (await api.attendance.checkIn({
          barcode: value,
          deviceIdentifier: "desktop",
        })) as CheckInResult;
        setResult(checkInResult);
        if (checkInResult.kind === "success") {
          void api.settings.soundEnabled().then((on) => {
            if (on) playSuccessChime();
          });
          toast("success", t("checkin.successTitle", { name: checkInResult.memberName }));
        } else if (checkInResult.kind !== "duplicate") {
          void api.settings.soundEnabled().then((on) => {
            if (on) playErrorBuzz();
          });
        }
        setTick((prev) => prev + 1);
      } catch (err) {
        setErrorText(describeError(err, t));
        setResult(null);
      } finally {
        setSubmitting(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [actor, t, toast]
  );

  useConfiguredScanner((scanned) => void submitBarcode(scanned));

  useEffect(() => {
    document.title = `${t("nav.checkin")} — ${t("app.name")}`;
  }, [t]);

  interface RecentRow {
    id: string;
    memberName: string;
    memberCode: string;
    checkinAt: string;
  }

  const recentRows: RecentRow[] = recent.map((r) => ({
    id: r.id,
    memberName: r.memberName,
    memberCode: r.memberCode,
    checkinAt: r.checkinAt,
  }));

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

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        <Card>
          <CardHeader title={t("checkin.scanTitle")} />
          <div className="space-y-4 p-5">
            <p className="text-[13px] text-subtle">{t("checkin.scanHint")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitBarcode(barcode);
              }}
              className="flex items-end gap-2.5"
            >
              <div className="flex-1">
                <BarcodeField
                  id="checkin-barcode"
                  label={t("checkin.inputLabel")}
                  value={barcode}
                  onValueChange={setBarcode}
                  disabled={submitting}
                  placeholder="GYM-000101"
                />
              </div>
              <Button type="submit" size="lg" loading={submitting} disabled={submitting || barcode.trim() === ""}>
                {!submitting && <ScanLine className="size-4" />}
                {t("checkin.submit")}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setResult(null);
                setErrorText(null);
                setBarcode("");
                inputRef.current?.focus();
              }}
              className="text-xs font-bold text-neon transition-opacity hover:opacity-80"
            >
              {t("checkin.scanAgain")}
            </button>

            {quickCards.length > 0 && (
              <div className="rounded-xl border border-dashed border-line-strong bg-white/[0.02] p-3.5">
                <p className="text-[11px] font-bold text-subtle">{t("checkin.quickTitle")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {quickCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      dir="ltr"
                      onClick={() => void submitBarcode(card.barcodeValue)}
                      className="rounded-lg border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] font-semibold tracking-wider text-subtle tabnum transition-colors hover:border-neon/50 hover:text-ink"
                    >
                      {card.barcodeValue}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {errorText && (
          <div role="alert" className="rounded-2xl border border-red/30 bg-red/10 px-4 py-3.5 text-sm font-semibold text-red">
            {errorText}
          </div>
        )}

        {result?.kind === "success" && (
          <SuccessPanel result={result} />
        )}

        {result?.kind === "denied" && <DeniedPanel result={result} />}

        {!result && !errorText && (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span aria-hidden className="grid size-14 animate-pulse place-items-center rounded-2xl border border-line bg-surface text-faint">
                <ScanLine className="size-6" />
              </span>
              <p className="text-sm font-semibold text-subtle">{t("checkin.waiting")}</p>
            </div>
          </Card>
        )}
      </div>

      {hasPermission("checkin.view_history") ? (
        <Card className="h-fit xl:col-span-2">
          <CardHeader title={t("checkin.recent")} />
          {recentRows.length === 0 ? (
            <EmptyState icon={<ScanLine />} title={t("checkin.noScans")} />
          ) : (
            <DataTable columns={recentColumns} data={recentRows} rowKey={(r) => r.id} />
          )}
        </Card>
      ) : null}
    </div>
  );
}

function SuccessPanel({ result }: { result: Extract<CheckInResult, { kind: "success" }> }) {
  const t = useT();
  const left = diffDaysKeys(result.subscriptionEndsAt, todayKey());
  return (
    <div className="animate-pop rounded-2xl border border-neon/40 bg-neon/[0.07] p-5 shadow-glow-sm">
      <div className="flex items-center gap-3.5">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-neon/15 text-neon">
          <CheckCircle2 className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold">{t("checkin.successTitle", { name: result.memberName })}</p>
          <p className="text-[13px] text-subtle">{t("checkin.successSub")}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-neon/20 pt-4 text-[13px] sm:grid-cols-4">
        <Info label={t("members.code")} value={result.memberCode} ltr />
        <Info label={t("common.plan")} value={result.planName ?? "—"} />
        <Info label={t("checkin.fieldExpiry")} value={result.subscriptionEndsAt} ltr />
        <Info label={t("checkin.fieldRemaining")} value={`${left}`} ltr />
      </dl>
    </div>
  );
}

function DeniedPanel({ result }: { result: Extract<CheckInResult, { kind: "denied" }> }) {
  const t = useT();
  return (
    <div className="animate-shake rounded-2xl border border-red/40 bg-red/[0.07] p-5">
      <div className="flex items-center gap-3.5">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-red/15 text-red">
          {result.reason === "CARD_UNKNOWN" || result.reason === "CARD_NOT_LINKED" ? (
            <XCircle className="size-6" />
          ) : (
            <ShieldAlert className="size-6" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold text-red">{t(`checkin.deniedTitles.${result.reason}`)}</p>
          <p className="text-[13px] text-subtle">{t(`checkin.deniedHints.${result.reason}`)}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-red/20 pt-4 text-[13px] sm:grid-cols-3">
        <Info label={t("checkin.fieldBarcode")} value={result.barcode || "—"} ltr />
        <Info label={t("checkin.fieldReason")} value={String(result.reason)} ltr />
      </dl>
    </div>
  );
}

function Info({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-faint">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className={cn("mt-0.5 truncate font-bold tabnum")}>
        {value}
      </dd>
    </div>
  );
}
