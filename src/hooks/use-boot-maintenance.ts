import { useEffect, useRef } from "react";
import type { ServiceActor } from "@/core/permissions";
import { rpc } from "@/api/client";

let ranThisSession = false;

/**
 * One-shot maintenance pass after login: closes overdue training plans.
 * Automatic backups are owned by the SERVER-side scheduler (see
 * server/backup-scheduler.ts), so the browser must not start its own timer or
 * trigger backups — a duplicate trigger would create double snapshots.
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
    })();
  }, [actor]);
}