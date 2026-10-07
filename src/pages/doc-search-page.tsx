import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Calendar,
  FileSearch,
  FileText,
  Loader2,
  Printer,
  Search,
  User,
} from "lucide-react";
import { api } from "@/api";
import type { DocNoMatch } from "@/core/services/document-numbers.service";
import type { VoucherKind } from "@/core/services/vouchers.service";
import { formatMinor } from "@/core/money";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ReceiptActions } from "@/components/finance/receipt-actions";
import { StoreReceiptActions } from "@/components/store/store-receipt-actions";

const VOUCHER_FOR: Partial<Record<DocNoMatch["kind"], VoucherKind>> = {
  refund: "refund",
  store_debt_payment: "store_debt_payment",
  cash_closing: "cash_closing",
  attendance: "attendance",
};

export function DocSearchPage() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matches, setMatches] = useState<DocNoMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debounced.length < 2) {
      setMatches([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api.documentNumbers
      .searchByDocNo(debounced)
      .then((rows) => {
        if (!alive) return;
        setMatches(rows);
      })
      .catch(() => {
        if (!alive) return;
        setMatches([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [debounced]);

  const openBlobUrl = (base64: string): string => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  };

  const printVoucher = async (m: DocNoMatch) => {
    const kind = VOUCHER_FOR[m.kind];
    if (!kind) return;
    setPrinting(m.kind + m.rowId);
    try {
      const doc = await api.vouchers.generateOperationVoucher(kind, m.rowId);
      const url = openBlobUrl(doc.base64);
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = url;
      document.body.appendChild(frame);
      let printed = false;
      const trigger = () => {
        if (printed) return;
        printed = true;
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(url, "_blank");
        }
      };
      frame.onload = trigger;
      setTimeout(() => {
        if (!printed) trigger();
      }, 1000);
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      toast("error", t("common.comingSoon"));
    } finally {
      setPrinting(null);
    }
  };

  const goToRecord = (m: DocNoMatch) => {
    navigate(m.route, { state: { focusRowId: m.rowId, focusDocNo: m.docNo } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t("docSearch.title")}
          description={t("docSearch.subtitle")}
        />

        <div className="max-w-xl px-5 pb-5">
          <Input
            label={t("docSearch.searchLabel")}
            placeholder={t("docSearch.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <p className="mt-1 text-xs text-faint">{t("docSearch.hint")}</p>
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-subtle">
          <Loader2 className="size-6 animate-spin text-neon" />
          <span>{t("docSearch.searching")}</span>
        </div>
      )}

      {!loading && debounced.length < 2 && (
        <EmptyState
          icon={<Search />}
          title={t("docSearch.emptyPromptTitle")}
          description={t("docSearch.emptyPromptDesc")}
        />
      )}

      {!loading && debounced.length >= 2 && matches.length === 0 && (
        <EmptyState
          icon={<FileSearch />}
          title={t("docSearch.noResults")}
          description={t("docSearch.hint")}
        />
      )}

      {!loading && matches.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-subtle px-1">
            <span>{t("docSearch.resultsCount", { count: matches.length })}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {matches.map((m) => (
              <div
                key={`${m.kind}-${m.rowId}`}
                className="relative flex flex-col justify-between rounded-2xl border border-line bg-panel p-5 transition-all duration-150 hover:border-line-strong hover:shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 border-b border-line/60 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-9 place-items-center rounded-xl bg-neon/10 text-neon">
                        <FileText className="size-4" />
                      </span>
                      <div>
                        <div className="font-mono text-sm font-extrabold tabnum text-ink" dir="ltr">
                          {m.docNo}
                        </div>
                        <Badge variant="neutral" className="mt-0.5">
                          {m.summary}
                        </Badge>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToRecord(m)}
                      title={t("docSearch.goToRow")}
                    >
                      <ArrowUpRight className="size-4 text-neon" />
                      {t("docSearch.goToRow")}
                    </Button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    {m.memberName && (
                      <div className="flex items-center gap-2 text-subtle">
                        <User className="size-3.5 shrink-0 text-faint" />
                        <span className="truncate font-semibold text-ink">{m.memberName}</span>
                      </div>
                    )}

                    {m.occurredAt && (
                      <div className="flex items-center gap-2 text-subtle">
                        <Calendar className="size-3.5 shrink-0 text-faint" />
                        <span dir="ltr" className="tabnum">
                          {m.occurredAt.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                    )}

                    {m.amountMinor != null && (
                      <div className="col-span-2 flex items-center justify-between rounded-xl bg-white/[0.02] p-2.5">
                        <span className="text-faint">{t("docSearch.colAmount")}</span>
                        <span dir="ltr" className="font-bold text-base text-emerald tabnum">
                          {formatMinor(m.amountMinor)} {t("common.egp")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                  {m.kind === "payment" && <ReceiptActions paymentId={m.rowId} size="sm" />}
                  {m.kind === "store_sale" && <StoreReceiptActions saleId={m.rowId} size="sm" />}
                  {VOUCHER_FOR[m.kind] && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void printVoucher(m)}
                      loading={printing === m.kind + m.rowId}
                      disabled={printing !== null}
                    >
                      <Printer className="size-3.5" />
                      {t("voucher.print")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
