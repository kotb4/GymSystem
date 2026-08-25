import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const t = useT();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const navBtn =
    "grid size-8 place-items-center rounded-lg border border-line bg-panel text-subtle transition-colors hover:text-ink hover:border-line-strong disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-faint tabnum" aria-live="polite">
        {from}–{to} / {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t("common.previous")}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={navBtn}
        >
          <ChevronRight className="size-4" />
        </button>
        <span className={cn("min-w-16 text-center text-xs font-semibold text-subtle tabnum")}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          aria-label={t("common.next")}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className={navBtn}
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>
    </div>
  );
}
