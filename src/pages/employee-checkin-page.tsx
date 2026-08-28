import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, LogOut, ScanLine, User } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicAttendance } from "@/api";
import { useConfiguredScanner } from "@/hooks/use-configured-scanner";
import { playErrorBuzz, playSuccessChime } from "@/utils/sound";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarcodeField } from "@/components/ui/barcode-field";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/utils/cn";

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function EmployeeCheckInPage() {
  const t = useT();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"in" | "out">("in");
  const [barcode, setBarcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicAttendance | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const submit = useCallback(
    async (raw: string) => {
      const value = raw.trim().toUpperCase();
      if (value === "") return;
      setSubmitting(true);
      setErrorText(null);
      try {
        const res =
          mode === "in"
            ? await api.employeesHr.clockInByBarcode({ barcode: value })
            : await api.employeesHr.clockOutByBarcode({ barcode: value });
        setResult(res);
        setBarcode("");
        void api.settings.soundEnabled().then((on) => {
          if (on) playSuccessChime();
        });
        toast(
          "success",
          mode === "in" ? t("hr.clockInToast") : t("hr.clockOutToast")
        );
      } catch (err) {
        setResult(null);
        setErrorText(describeError(err, t));
        void api.settings.soundEnabled().then((on) => {
          if (on) playErrorBuzz();
        });
      } finally {
        setSubmitting(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [mode, t, toast]
  );

  useConfiguredScanner((scanned) => void submit(scanned));

  useEffect(() => {
    document.title = `${t("nav.employeeCheckIn")} — ${t("app.name")}`;
  }, [t]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader title={t("nav.employeeCheckIn")} />
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("in")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                mode === "in"
                  ? "border-neon bg-neon/10 text-neon"
                  : "border-line text-subtle hover:border-line-strong"
              )}
            >
              <LogIn className="size-4" /> {t("hr.clockIn")}
            </button>
            <button
              type="button"
              onClick={() => setMode("out")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                mode === "out"
                  ? "border-red bg-red/10 text-red"
                  : "border-line text-subtle hover:border-line-strong"
              )}
            >
              <LogOut className="size-4" /> {t("hr.clockOut")}
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(barcode);
            }}
            className="flex items-end gap-2.5"
          >
            <div className="flex-1">
              <BarcodeField
                id="emp-checkin-barcode"
                label={t("hr.scanEmployeeBarcode")}
                value={barcode}
                onValueChange={setBarcode}
                disabled={submitting}
                placeholder="EMP-000001"
              />
            </div>
            <Button type="submit" size="lg" loading={submitting} disabled={submitting || barcode.trim() === ""}>
              {!submitting && <ScanLine className="size-4" />}
              {t("checkin.submit")}
            </Button>
          </form>

          {errorText && (
            <p className="rounded-xl border border-red/30 bg-red/10 px-4 py-2.5 text-sm font-bold text-red">
              {errorText}
            </p>
          )}

          {result && (
            <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
              <div className="flex items-center gap-2">
                <div className="grid size-9 place-items-center rounded-lg bg-neon/10 text-neon">
                  <User className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-extrabold">{result.employeeName}</div>
                  <div className="text-[11px] text-subtle">{result.dateKey}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg bg-surface p-2.5">
                  <div className="text-[11px] text-subtle">{t("hr.clockInAt")}</div>
                  <div dir="ltr" className="font-bold tabnum">{result.clockInAt.slice(11, 19)}</div>
                </div>
                <div className="rounded-lg bg-surface p-2.5">
                  <div className="text-[11px] text-subtle">{t("hr.clockOutAt")}</div>
                  <div dir="ltr" className="font-bold tabnum">{result.clockOutAt ? result.clockOutAt.slice(11, 19) : "—"}</div>
                </div>
              </div>
              {result.workedMinutes > 0 && (
                <p className="flex items-center justify-center gap-2 text-sm">
                  <span className="text-subtle">{t("hr.workedHours")}:</span>
                  <span dir="ltr" className="font-bold tabnum">{hoursLabel(result.workedMinutes)}</span>
                </p>
              )}
            </div>
          )}

          {!result && !errorText && (
            <EmptyState icon={<ScanLine />} title={t("hr.scanEmployeeBarcode")} />
          )}
        </div>
      </Card>
    </div>
  );
}
