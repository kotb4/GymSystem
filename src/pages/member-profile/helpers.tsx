import { useEffect, useState } from "react";
import { api } from "@/api";
import type { MemberOverview } from "@/core/services/member-profile.service";

export function useMemberOverview(memberId: string, reloadTick: number) {
  const [overview, setOverview] = useState<MemberOverview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!memberId) return;
    let alive = true;
    setLoading(true);
    api.members
      .overview(memberId)
      .then((data) => {
        if (alive) {
          setOverview(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [memberId, reloadTick]);
  return { overview, loading };
}

export function permissionDeniedNode(t: (k: string) => string) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-6 text-center text-sm text-faint">
      {t("members.noPermission")}
    </div>
  );
}
