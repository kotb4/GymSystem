import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, FileText, Loader2, Printer, Search } from "lucide-react";
import { api } from "@/api";
import type { DocNoMatch } from "@/core/services/document-numbers.service";
import type { VoucherKind } from "@/core/services/vouchers.service";
import { formatMinor } from "@/core/money";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/utils/cn";

const MIN_CHARS = 1;
const DEBOUNCE_MS = 220;

/**
 * Which kinds have a printable voucher in the shared template.
 * payments and store sales already have their own full receipts, and returns
 * have no standalone document, so they are intentionally absent.
 */
const VOUCHER_FOR: Partial<Record<DocNoMatch["kind"], VoucherKind>> = {
  refund: "refund",
  store_debt_payment: "store_debt_payment",
  cash_closing: "cash_closing",
  attendance: "attendance",
  expense: "expense",
};

/**
 * Lookup by the printed reference number.
 *
 * This is the operator's "customer read the number off the receipt" workflow:
 * type (or paste) the number, get the matching operation, jump to it. Matching
 * is intentionally fuzzy on digits so a partially read number still resolves.
 */
export function DocNoSearch() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DocNoMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_CHARS) {
      setMatches([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.documentNumbers
        .searchByDocNo(term)
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
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (m: DocNoMatch) => {
    setOpen(false);
    setQuery("");
    setMatches([]);

    if (m.kind === "store_sale") {
      navigate("/store", {
        state: {
          focusRowId: m.rowId,
          focusDocNo: m.docNo,
          storeTab: "sales",
          autoOpen: true,
        },
      });
      return;
    }

    if (m.kind === "store_return") {
      navigate("/store", {
        state: {
          focusRowId: m.rowId,
          focusDocNo: m.docNo,
          storeTab: "returns",
          autoOpen: true,
        },
      });
      return;
    }

    if (m.kind === "store_debt_payment") {
      navigate("/store", {
        state: {
          focusRowId: m.rowId,
          focusDocNo: m.docNo,
          storeTab: "debts",
          autoOpen: true,
        },
      });
      return;
    }

    if (m.kind === "payment") {
      navigate("/payments", {
        state: {
          focusRowId: m.rowId,
          focusDocNo: m.docNo,
          autoOpen: true,
        },
      });
      return;
    }

    if (m.kind === "refund") {
      navigate("/payments", {
        state: {
          focusRowId: m.rowId,
          focusDocNo: m.docNo,
          paymentTab: "refunds",
          autoOpen: true,
        },
      });
      return;
    }

    navigate(m.route, {
      state: {
        focusRowId: m.rowId,
        focusDocNo: m.docNo,
        autoOpen: true,
      },
    });
  };

  const openBlobUrl = (base64: string): string => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  };

  /** Print the matched operation's voucher straight from the lookup result. */
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
      window.setTimeout(() => {
        if (!printed) trigger();
      }, 1000);
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      toast("error", t("common.comingSoon"));
    } finally {
      setPrinting(null);
    }
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const term = query.trim();
      if (!term) return;

      if (matches.length > 0) {
        go(matches[0]);
        return;
      }

      setLoading(true);
      try {
        const rows = await api.documentNumbers.searchByDocNo(term);
        if (rows.length > 0) {
          go(rows[0]);
        } else {
          toast("warning", t("header.docNoSearchNoResults"));
        }
      } catch {
        toast("warning", t("header.docNoSearchNoResults"));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div ref={boxRef} className="relative ms-2 w-64 sm:w-80 md:w-96">
      <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3.5 size-4 text-faint" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t("header.docNoSearchPlaceholder")}
        aria-label={t("header.docNoSearch")}
        title={t("header.docNoSearchHint")}
        className="h-9 w-full rounded-xl border border-line bg-surface/90 ps-10 pe-14 text-sm outline-none transition-all placeholder:text-faint focus:border-primary/60 focus:bg-surface focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="pointer-events-none absolute inset-y-0 end-0 my-auto me-2.5 grid h-5.5 place-items-center rounded-md border border-line-strong bg-panel px-1.5 font-sans text-[10px] font-semibold text-slate-400">
        Ctrl K
      </kbd>

      {open && query.trim().length >= MIN_CHARS && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-line bg-panel-elevated shadow-xl">
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-4 text-xs text-faint">
              <Loader2 className="size-3.5 animate-spin" />
              {t("header.docNoSearchSearching")}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-4 text-xs text-faint">{t("header.docNoSearchNoResults")}</p>
          ) : (
            <>
              <p className="border-b border-line px-3 py-1.5 text-[10px] font-bold text-faint">
                {t("header.docNoSearchResults")}
              </p>
              <ul className="max-h-80 overflow-y-auto">
                {matches.map((m) => (
                  <li key={`${m.kind}-${m.rowId}`}>
                    <button
                      type="button"
                      onClick={() => go(m)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-white/[0.04]"
                    >
                      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-neon/10 text-neon">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-mono text-[12px] font-bold tabnum text-ink" dir="ltr">
                            {m.docNo}
                          </span>
                          <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-subtle">
                            {m.summary}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                          {m.memberName && <span className="truncate">{m.memberName}</span>}
                          {m.amountMinor != null && (
                            <span className="shrink-0 tabnum">{formatMinor(m.amountMinor)} {t("common.egp")}</span>
                          )}
                          {m.occurredAt && <span className="shrink-0 tabnum">{m.occurredAt.slice(0, 10)}</span>}
                        </span>
                      </span>
                      <CornerDownLeft aria-hidden className={cn("size-3.5 shrink-0 text-faint")} />
                    </button>
                    {VOUCHER_FOR[m.kind] && (
                      <button
                        type="button"
                        onClick={() => void printVoucher(m)}
                        disabled={printing !== null}
                        title={t("voucher.print")}
                        aria-label={t("voucher.print")}
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-subtle transition-colors hover:bg-white/[0.06] hover:text-neon disabled:opacity-50"
                      >
                        {printing === m.kind + m.rowId ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Printer className="size-4" />
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
