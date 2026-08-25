import { addDaysKey, nowStamp, todayKey } from "@/core/dates";
import { roleHasPermission, type ServiceActor } from "@/core/permissions";
import type { Db, Row } from "@/db/engine";
import { getBackupConfig, getExpiryThresholds } from "./settings.service";

export type AppNotificationType =
  | "expiry"
  | "expired"
  | "balance"
  | "card_lost"
  | "backup";

export type NotificationSeverity = "info" | "warning" | "danger";

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  severity: NotificationSeverity;
  messageKey: string;
  params: Record<string, string | number>;
  count: number;
}

interface CountRow extends Row {
  cnt: number;
}

function countActiveSubsEndingWithin(db: Db, fromKey: string, toKey: string): number {
  return Number(
    db.first<CountRow>(
      "SELECT COUNT(*) AS cnt FROM member_subscriptions WHERE status = 'active' AND end_date >= ? AND end_date <= ?",
      [fromKey, toKey],
    )?.cnt ?? 0,
  );
}

interface BalanceRow extends Row {
  cnt: number;
  total_minor: number;
}

function outstandingBalance(db: Db): { count: number; totalMinor: number } {
  const row = db.first<BalanceRow>(
    "WITH paid AS (\n  SELECT subscription_id, SUM(paid_amount_minor) AS paid_minor\n  FROM payments\n  WHERE subscription_id IS NOT NULL AND status IN ('partial', 'paid')\n  GROUP BY subscription_id\n)\nSELECT COUNT(*) AS cnt,\n  COALESCE(SUM(MAX(CAST(ROUND(s.price * 100) AS INTEGER) - COALESCE(p.paid_minor, 0), 0)), 0) AS total_minor\nFROM member_subscriptions s\nLEFT JOIN paid p ON p.subscription_id = s.id\nWHERE s.status = 'active'",
  );
  return {
    count: Number(row?.cnt ?? 0),
    totalMinor: Number(row?.total_minor ?? 0),
  };
}

const BACKUP_STALE_HOURS = 72;

function lastSuccessfulBackupStamp(db: Db): string | null {
  const row = db.first<{ last_at: string }>(
    "SELECT MAX(created_at) AS last_at FROM backups_log WHERE verified = 1",
  );
  return row?.last_at ?? null;
}

function hoursSince(stamp: string, now: string): number {
  const toMs = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);
  const diff = toMs(now) - toMs(stamp);
  return Number.isFinite(diff) ? Math.max(0, diff / 3_600_000) : Number.POSITIVE_INFINITY;
}

/**
 * Collects operational notifications computed live from the database.
 * Items are permission-filtered so users only see what they may view.
 */
export function collectNotifications(db: Db, actor: ServiceActor): AppNotification[] {
  const items: AppNotification[] = [];
  const mayExpiry = roleHasPermission(actor.roleId, "subscriptions.view");
  const mayBalance = roleHasPermission(actor.roleId, "payments.view");
  const mayCards = roleHasPermission(actor.roleId, "cards.view");
  const maySettings = roleHasPermission(actor.roleId, "settings.view");

  const today = todayKey();

  if (mayExpiry) {
    const expiredCount = db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE status = 'active' AND end_date < ?",
      [today],
    );
    if (expiredCount > 0) {
      items.push({
        id: "expired",
        type: "expired",
        severity: "danger",
        messageKey: "notifs.expired",
        params: { count: expiredCount },
        count: expiredCount,
      });
    }

    for (const days of getExpiryThresholds(db)) {
      const count = countActiveSubsEndingWithin(db, today, addDaysKey(today, days - 1));
      if (count > 0) {
        items.push({
          id: `expiry:${days}`,
          type: "expiry",
          severity: days <= 1 ? "warning" : "info",
          messageKey: days === 1 ? "notifs.expiryTomorrow" : "notifs.expiryDays",
          params: { count, days },
          count,
        });
      }
    }
  }

  if (mayBalance) {
    const outstanding = outstandingBalance(db);
    if (outstanding.count > 0 && outstanding.totalMinor > 0) {
      items.push({
        id: "balance",
        type: "balance",
        severity: "info",
        messageKey: "notifs.outstanding",
        params: { count: outstanding.count },
        count: outstanding.count,
      });
    }
  }

  if (mayCards) {
    const lostCards = db.count("SELECT COUNT(*) FROM cards WHERE status = 'lost'");
    if (lostCards > 0) {
      items.push({
        id: "card_lost",
        type: "card_lost",
        severity: "warning",
        messageKey: "notifs.lostCards",
        params: { count: lostCards },
        count: lostCards,
      });
    }
  }

  if (maySettings) {
    const backupConfig = getBackupConfig(db, actor);
    if (backupConfig.autoIntervalHours > 0 || backupConfig.retentionCount > 0) {
      const lastAt = lastSuccessfulBackupStamp(db);
      const stale = lastAt == null || hoursSince(lastAt, nowStamp()) >= BACKUP_STALE_HOURS;
      if (stale) {
        items.push({
          id: "backup",
          type: "backup",
          severity: lastAt == null ? "warning" : "warning",
          messageKey: lastAt == null ? "notifs.noBackup" : "notifs.staleBackup",
          params: {},
          count: 1,
        });
      }
    }
  }

  return items;
}
