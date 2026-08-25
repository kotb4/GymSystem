import { useEffect, useRef } from "react";
import type { ServiceActor } from "@/core/permissions";
import { rpc } from "@/api/client";
import { api } from "@/api";

let ranThisSession = false;

/**
 * One-shot maintenance pass after login: closes overdue training plans and
 * takes an automatic backup when the configured interval has elapsed.
 * Both steps run through the local backend and never block the UI.
 */
export function useBootMaintenance(actor: ServiceActor | null): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!actor || startedRef.current || ranThisSession) return;
    startedRef.current = true;
    ranThisSession = true;

    void (async () => {
      try {
        await rpc("trainingPlans", "sweepExpiredPlans", []);
      } catch {
        // non-critical
      }
      try {
        const config = await api.settings.backupConfig();
        if (config.autoIntervalHours <= 0) return;
        const entries = (await api.backup.entries(1)) as Array<{ createdAt: string; verified: boolean }> | unknown[];
        const list = entries as Array<{ createdAt?: string; verified?: boolean; kind?: string }>;
        const last = list.find((e) => e.verified && (e.kind === "manual" || e.kind === "auto"));
        let due = true;
        if (last?.createdAt) {
          const elapsed = (Date.now() - Date.parse(`${last.createdAt.replace(" ", "T")}Z`)) / 3_600_000;
          due = !Number.isFinite(elapsed) || elapsed >= config.autoIntervalHours;
        }
        if (due) await api.backup.createSnapshot("auto");
      } catch {
        // auto backup is best-effort
      }
    })();
  }, [actor]);
}
