import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { api, type RegisteredBranch } from "@/api";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";

export interface BranchFilterProps {
  value: string;
  onChange: (branchId: string) => void;
  className?: string;
  label?: string;
  showAllOption?: boolean;
  allLabel?: string;
}

export function BranchFilter({
  value,
  onChange,
  className,
  label,
  showAllOption = true,
  allLabel,
}: BranchFilterProps) {
  const t = useT();
  const [branches, setBranches] = useState<RegisteredBranch[]>([]);

  useEffect(() => {
    let alive = true;
    api.sync
      .listBranches()
      .then((list) => {
        if (alive) setBranches(list);
      })
      .catch((err) => console.error("Failed to load registered branches:", err));
    return () => {
      alive = false;
    };
  }, []);

  // If there's only 1 branch registered and it's the main branch, still render smoothly
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-subtle whitespace-nowrap">
        <Building2 className="size-4 text-neon" />
        <span>{label ?? t("rpt.branchFilter")}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 cursor-pointer appearance-none rounded-xl border border-line bg-panel ps-3 pe-8 text-xs font-semibold text-ink outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
      >
        {showAllOption && (
          <option value="all">
            {allLabel ?? t("rpt.allBranches")}
          </option>
        )}
        {branches.map((b) => (
          <option key={b.branchId} value={b.branchId}>
            {b.branchName} {b.branchRole === "primary" ? "(الرئيسي)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
