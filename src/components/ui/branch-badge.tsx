import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { api, type RegisteredBranch } from "@/api";
import { cn } from "@/utils/cn";

let branchCache: RegisteredBranch[] | null = null;
let fetchPromise: Promise<RegisteredBranch[]> | null = null;
const listeners = new Set<(branches: RegisteredBranch[]) => void>();

export function useRegisteredBranches(): RegisteredBranch[] {
  const [branches, setBranches] = useState<RegisteredBranch[]>(branchCache || []);

  useEffect(() => {
    listeners.add(setBranches);
    if (!branchCache) {
      if (!fetchPromise) {
        fetchPromise = api.sync
          .listBranches()
          .then((list) => {
            branchCache = list;
            listeners.forEach((l) => l(list));
            return list;
          })
          .catch(() => {
            const fallback: RegisteredBranch[] = [
              {
                branchId: "main",
                branchName: "الفرع الرئيسي",
                branchRole: "primary",
                branchPrefix: "B1",
                isActive: true,
                isOnline: true,
                lastSeenAt: null,
                membersCount: 0,
                activeSubscriptionsCount: 0,
                todayAttendanceCount: 0,
                totalPaymentsMinor: 0,
              },
            ];
            branchCache = fallback;
            listeners.forEach((l) => l(fallback));
            return fallback;
          });
      }
    } else {
      setBranches(branchCache);
    }
    return () => {
      listeners.delete(setBranches);
    };
  }, []);

  return branches;
}

interface BranchBadgeProps {
  branchId?: string | null;
  className?: string;
  showFullName?: boolean;
}

export function BranchBadge({ branchId, className, showFullName = false }: BranchBadgeProps) {
  const branches = useRegisteredBranches();
  const normalizedId = branchId || "main";
  const branch = branches.find((b) => b.branchId === normalizedId);

  const isPrimary = normalizedId === "main" || branch?.branchRole === "primary";
  const name = branch?.branchName || (normalizedId === "main" ? "الفرع الرئيسي" : normalizedId);
  const prefix = branch?.branchPrefix;
  const label = showFullName ? (prefix ? `[${prefix}] ${name}` : name) : (prefix || name);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap",
        prefix ? "font-mono" : "",
        isPrimary
          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25"
          : "bg-purple-500/10 text-purple-400 border border-purple-500/25",
        className,
      )}
      title={`الفرع: ${name}${prefix ? ` (${prefix})` : ""}`}
    >
      <Building2 className="size-3 shrink-0 opacity-80" />
      <span>{label}</span>
    </span>
  );
}
