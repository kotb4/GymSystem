import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ScanLine, ScanSearch, XCircle } from "lucide-react";
import { useT } from "@/i18n";
import { api, type ScannerConfig } from "@/api";
import { nowStamp } from "@/core/dates";
import { useBarcodeScanner } from "@/hooks/use-barcode";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

interface ScanRecord {
  id: number;
  value: string;
  length: number;
  at: string;
  validFormat: boolean;
}

let scanSeq = 0;

export function ScannerDiagnosticsPage() {
  const t = useT();
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [config, setConfig] = useState<ScannerConfig | null>(null);

  useEffect(() => {
    api.settings
      .scannerConfig()
      .then((loaded) => setConfig(loaded as ScannerConfig))
      .catch(() => setConfig(null));
  }, []);

  const onScan = useCallback((barcode: string) => {
    const BARCODE_RE = /^[A-Za-z0-9-]{4,32}$/;
    scanSeq += 1;
    setScans((prev) =>
      [
        {
          id: scanSeq,
          value: barcode,
          length: barcode.length,
          at: nowStamp(),
          validFormat: BARCODE_RE.test(barcode),
        },
        ...prev,
      ].slice(0, 10),
    );
  }, []);

  useBarcodeScanner(onScan, true);

  const columns: Column<ScanRecord>[] = [
    {
      key: "value",
      header: t("scanner.colValue"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum">
          {row.value}
        </span>
      ),
    },
    {
      key: "length",
      header: t("scanner.colLength"),
      render: (row) => <span className="tabnum text-subtle">{row.length}</span>,
    },
    {
      key: "at",
      header: t("scanner.colTime"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.at}
        </span>
      ),
    },
    {
      key: "valid",
      header: t("scanner.colStatus"),
      render: (row) => (
        <Badge variant={row.validFormat ? "success" : "danger"} dot>
          {row.validFormat ? t("scanner.valid") : t("scanner.invalid")}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ScanSearch aria-hidden className="size-4 text-neon" />
              {t("scanner.title")}
            </span>
          }
        />
        <div className="grid gap-4 p-5 lg:grid-cols-3">
          <div className="rounded-xl border border-line bg-panel p-4">
            <p className="text-[13px] font-bold text-subtle">{t("scanner.configEnabled")}</p>
            <p className="mt-1.5">
              <Badge variant={config?.enabled ? "success" : "neutral"} dot>
                {config?.enabled ? t("scanner.on") : t("scanner.off")}
              </Badge>
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("scanner.configHint")}</p>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4">
            <p className="text-[13px] font-bold text-subtle">{t("scanner.configAffixes")}</p>
            <p dir="ltr" className="mt-1.5 font-mono text-sm font-bold text-ink">
              prefix: [{config?.prefix || "—"}] suffix: [{config?.suffix || "—"}]
            </p>
            <p dir="ltr" className="mt-2 tabnum text-[11px] leading-relaxed text-faint">
              min={config?.minLength ?? 4} · timeout={config?.timeoutMs ?? 5000}ms
            </p>
          </div>
          <div className="flex flex-col justify-between rounded-xl border border-neon/30 bg-neon/5 p-4">
            <div>
              <p className="text-[13px] font-bold text-neon">{t("scanner.tryTitle")}</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">{t("scanner.tryHint")}</p>
            </div>
            <ScanLine aria-hidden className="size-8 self-end text-neon/70" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ScanLine aria-hidden className="size-4 text-subtle" />
              {t("scanner.historyTitle")}
            </span>
          }
          action={
            scans.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => setScans([])}>
                {t("common.clear")}
              </Button>
            ) : undefined
          }
        />
        {scans.length === 0 ? (
          <EmptyState icon={<ScanLine />} title={t("scanner.emptyTitle")} description={t("scanner.emptyHint")} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              {scans[0].validFormat ? (
                <CheckCircle2 aria-hidden className="size-4 text-emerald" />
              ) : (
                <XCircle aria-hidden className="size-4 text-red" />
              )}
              <span className="text-[13px] font-bold">{t("scanner.lastScan")}</span>
              <span dir="ltr" className="font-mono text-sm font-extrabold text-ink">
                {scans[0].value}
              </span>
            </div>
            <DataTable columns={columns} data={scans} rowKey={(r) => String(r.id)} />
          </>
        )}
      </Card>
    </div>
  );
}
