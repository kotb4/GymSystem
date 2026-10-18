import { ArrowLeft } from "lucide-react";

export interface DateRangeProps {
  start?: string | null;
  end?: string | null;
  className?: string;
  variant?: "arrow" | "text";
}

/**
 * Standard RTL Date Range Display:
 * In RTL layout (Arabic), flex items flow naturally from Right to Left:
 * [Start Date (Right)]  ← [ArrowLeft (Middle)]  [End Date (Left)]
 *
 * Each date is isolated in its own <span dir="ltr"> to prevent BiDi
 * algorithm text flipping with hyphens and Arabic characters.
 */
export function DateRange({
  start,
  end,
  className = "",
  variant = "arrow",
}: DateRangeProps) {
  if (!start && !end) return <span className="text-faint">—</span>;
  if (!start) return <span dir="ltr" className="tabnum font-medium">{end}</span>;
  if (!end) return <span dir="ltr" className="tabnum font-medium">{start}</span>;

  if (variant === "text") {
    return (
      <span className={`inline-flex items-center gap-1 text-subtle text-xs ${className}`}>
        <span>من</span>
        <span dir="ltr" className="tabnum font-semibold text-ink">{start}</span>
        <span>إلى</span>
        <span dir="ltr" className="tabnum font-semibold text-ink">{end}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-subtle ${className}`}>
      <span dir="ltr" className="tabnum font-medium text-ink">{start}</span>
      <ArrowLeft className="size-3 shrink-0 text-faint" aria-hidden="true" />
      <span dir="ltr" className="tabnum font-medium text-ink">{end}</span>
    </span>
  );
}
