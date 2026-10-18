import crypto from "node:crypto";
import { nowStamp } from "@/core/dates";
import { errForbidden, errValidation } from "@/core/errors";
import type { Db, Row } from "@/db/engine";
import { requirePermission, type ServiceActor } from "@/core/permissions";
import { recordAudit } from "./audit.service";
import { isDeveloperActor } from "./developer.service";

export type BranchRole = "primary" | "replica";

export interface BranchConfig {
  branchId: string;
  branchName: string;
  branchRole: BranchRole;
  branchPrefix: string;
  remoteUrl: string | null;
  syncSecret: string;
  autoSyncEnabled: boolean;
  syncIntervalSeconds: number;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface BranchConfigRow extends Row {
  branch_id: string;
  branch_name: string;
  branch_role: BranchRole;
  branch_prefix: string;
  remote_url: string | null;
  sync_secret: string;
  auto_sync_enabled: number;
  sync_interval_seconds: number;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface SyncStatus {
  branchId: string;
  branchName: string;
  branchRole: BranchRole;
  branchPrefix: string;
  remoteUrl: string | null;
  autoSyncEnabled: boolean;
  pendingCount: number;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  state: "online" | "offline" | "syncing" | "idle";
}

export interface UpdateBranchConfigInput {
  branchName?: string;
  branchRole?: BranchRole;
  branchPrefix?: string;
  remoteUrl?: string | null;
  syncSecret?: string;
  autoSyncEnabled?: boolean;
  syncIntervalSeconds?: number;
}

export interface SyncOutboxRow extends Row {
  id: number;
  entity_type: string;
  entity_id: string;
  operation: "insert" | "update" | "delete";
  payload_json: string | null;
  occurred_at: string;
  status: "pending" | "synced" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

export interface SyncPushItem {
  id: number;
  entityType: string;
  entityId: string;
  operation: "insert" | "update" | "delete";
  occurredAt: string;
  data: Record<string, unknown> | null;
}

export interface SyncPushPayload {
  branchId: string;
  branchName?: string;
  branchPrefix?: string;
  items: SyncPushItem[];
}

export interface SyncPushResult {
  ok: boolean;
  appliedCount: number;
  acknowledgedIds: number[];
}

export interface SyncPullResult {
  ok: boolean;
  timestamp: string;
  updates: {
    members: Row[];
    cards: Row[];
    subscriptions: Row[];
    attendance: Row[];
    payments: Row[];
    plans: Row[];
  };
}

export interface SyncCycleResult {
  ok: boolean;
  pushedCount: number;
  pulledCount: number;
  error?: string;
}

function rowToConfig(row: BranchConfigRow): BranchConfig {
  return {
    branchId: row.branch_id,
    branchName: row.branch_name,
    branchRole: row.branch_role,
    branchPrefix: row.branch_prefix || "",
    remoteUrl: row.remote_url,
    syncSecret: row.sync_secret,
    autoSyncEnabled: row.auto_sync_enabled === 1,
    syncIntervalSeconds: row.sync_interval_seconds || 60,
    lastPushAt: row.last_push_at,
    lastPullAt: row.last_pull_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function getBranchConfig(db: Db): BranchConfig {
  let row = db.first<BranchConfigRow>("SELECT * FROM branch_info LIMIT 1");
  if (!row) {
    const now = nowStamp();
    db.run(
      "INSERT INTO branch_info (branch_id, branch_name, branch_role, branch_prefix, sync_secret, auto_sync_enabled, sync_interval_seconds, updated_at) " +
        "VALUES ('main', 'الفرع الرئيسي', 'primary', 'B1', 'gym-sec-default', 1, 60, ?)",
      [now],
    );
    row = db.first<BranchConfigRow>("SELECT * FROM branch_info LIMIT 1")!;
  }

  // SELF-HEALING: A replica can NEVER have branch_id === 'main' (which belongs exclusively to the primary hub)
  if (row.branch_role === "replica" && row.branch_id === "main") {
    const cleanPrefix = row.branch_prefix ? row.branch_prefix.trim().toLowerCase() : "";
    const newBranchId = cleanPrefix ? `branch-${cleanPrefix}` : "branch-2";
    db.run("UPDATE branch_info SET branch_id = ? WHERE branch_id = 'main'", [newBranchId]);
    if (cleanPrefix) {
      db.run(
        "UPDATE members SET branch_id = ? WHERE branch_id = 'main' AND member_code LIKE ?",
        [newBranchId, `${row.branch_prefix.trim().toUpperCase()}-%`],
      );
      db.run(
        "UPDATE member_subscriptions SET branch_id = ? WHERE branch_id = 'main' AND member_id IN (SELECT id FROM members WHERE branch_id = ?)",
        [newBranchId, newBranchId],
      );
    }
    row = db.first<BranchConfigRow>("SELECT * FROM branch_info LIMIT 1")!;
  }

  return rowToConfig(row);
}

export function normalizeRemoteUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url = rawUrl.trim();
  if (!url) return null;

  // Remove trailing slashes
  url = url.replace(/\/+$/, "");

  // If it's a Cloudflare tunnel domain without https:// or with http://
  if (url.includes(".trycloudflare.com") || url.includes(".cloudflare.com")) {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      url = "https://" + url;
    } else if (url.startsWith("http://")) {
      url = "https://" + url.slice(7);
    }
    return url;
  }

  // Prepend http:// if missing scheme
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "http://" + url;
  }

  // Check if port is needed for IP addresses or localhost
  try {
    const parsed = new URL(url);
    if (!parsed.port && parsed.protocol === "http:") {
      // Check if hostname is an IPv4 or localhost
      const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname);
      const isLocal = parsed.hostname === "localhost" || parsed.hostname.endsWith(".local");
      if (isIpv4 || isLocal) {
        parsed.port = "8890";
        return parsed.origin;
      }
    }
    return url;
  } catch {
    return url;
  }
}

export async function updateBranchConfig(
  db: Db,
  actor: ServiceActor,
  input: UpdateBranchConfigInput,
): Promise<BranchConfig> {
  requirePermission(actor, "settings.edit");
  if (!isDeveloperActor(actor)) {
    throw errForbidden("errors.developerOnly");
  }
  const current = getBranchConfig(db);

  const nextName = input.branchName !== undefined ? input.branchName.trim() : current.branchName;
  if (!nextName) throw errValidation("errors.branchNameRequired");

  const nextRole = input.branchRole ?? current.branchRole;
  if (nextRole !== "primary" && nextRole !== "replica") {
    throw errValidation("errors.invalidBranchRole");
  }

  const nextPrefix =
    input.branchPrefix !== undefined
      ? input.branchPrefix.trim().toUpperCase()
      : current.branchPrefix;

  let nextRemoteUrl =
    input.remoteUrl !== undefined
      ? normalizeRemoteUrl(input.remoteUrl)
      : current.remoteUrl;

  const nextSecret =
    input.syncSecret !== undefined ? input.syncSecret.trim() : current.syncSecret;
  if (!nextSecret) throw errValidation("errors.syncSecretRequired");

  const nextAutoSync =
    input.autoSyncEnabled !== undefined ? (input.autoSyncEnabled ? 1 : 0) : current.autoSyncEnabled ? 1 : 0;

  const nextInterval =
    input.syncIntervalSeconds !== undefined
      ? Math.max(10, input.syncIntervalSeconds)
      : current.syncIntervalSeconds;

  let nextBranchId = current.branchId;
  if (nextRole === "primary") {
    nextBranchId = "main";
  } else if (nextRole === "replica") {
    if (nextBranchId === "main" || !nextBranchId) {
      nextBranchId = nextPrefix ? `branch-${nextPrefix.toLowerCase()}` : "branch-2";
    }
  }

  const now = nowStamp();

  await db.transaction(async () => {
    db.run(
      "UPDATE branch_info SET " +
        "branch_id = ?, branch_name = ?, branch_role = ?, branch_prefix = ?, remote_url = ?, sync_secret = ?, " +
        "auto_sync_enabled = ?, sync_interval_seconds = ?, last_error = NULL, updated_at = ? WHERE branch_id = ?",
      [
        nextBranchId,
        nextName,
        nextRole,
        nextPrefix,
        nextRemoteUrl,
        nextSecret,
        nextAutoSync,
        nextInterval,
        now,
        current.branchId,
      ],
    );

    recordAudit(db, actor, "SETTINGS_UPDATED", "system_setting", "branch_info", {
      branchId: nextBranchId,
      branchName: nextName,
      branchRole: nextRole,
      branchPrefix: nextPrefix,
      remoteUrl: nextRemoteUrl,
    });

    if (nextRole === "replica") {
      // Ensure primary hub is recorded as 'main'
      upsertRegisteredBranch(db, "main", "الفرع الرئيسي", "primary", "B1");
      // And register replica under its distinct ID
      upsertRegisteredBranch(db, nextBranchId, nextName, "replica", nextPrefix);

      // Reassign local records that had 'main' but were created with this replica's prefix
      if (nextBranchId !== "main" && nextPrefix) {
        db.run(
          "UPDATE members SET branch_id = ? WHERE branch_id = 'main' AND member_code LIKE ?",
          [nextBranchId, `${nextPrefix}-%`],
        );
        db.run(
          "UPDATE member_subscriptions SET branch_id = ? WHERE branch_id = 'main' AND member_id IN (SELECT id FROM members WHERE branch_id = ?)",
          [nextBranchId, nextBranchId],
        );
      }
    } else {
      // Primary role: register itself as main
      upsertRegisteredBranch(db, "main", nextName, "primary", nextPrefix || "B1");
    }
  });

  return getBranchConfig(db);
}

export function getPendingOutboxCount(db: Db): number {
  return db.count("SELECT COUNT(*) FROM sync_outbox WHERE status = 'pending'");
}

export function getSyncStatus(db: Db): SyncStatus {
  const config = getBranchConfig(db);
  const pendingCount = getPendingOutboxCount(db);

  let state: SyncStatus["state"] = "idle";
  if (config.lastError) {
    state = "offline";
  } else if (config.branchRole === "replica") {
    state = config.remoteUrl ? "online" : "idle";
  } else {
    state = "online";
  }

  return {
    branchId: config.branchId,
    branchName: config.branchName,
    branchRole: config.branchRole,
    branchPrefix: config.branchPrefix,
    remoteUrl: config.remoteUrl,
    autoSyncEnabled: config.autoSyncEnabled,
    pendingCount,
    lastPushAt: config.lastPushAt,
    lastPullAt: config.lastPullAt,
    lastError: config.lastError,
    state,
  };
}

/**
 * Validates the sync secret against the local branch configuration.
 */
export function validateSyncSecret(db: Db, incomingSecret: string | undefined | null): boolean {
  if (!incomingSecret) return false;
  const config = getBranchConfig(db);
  const expected = Buffer.from(config.syncSecret.trim(), "utf8");
  const actual = Buffer.from(incomingSecret.trim(), "utf8");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Primary branch receives push items from replica branch and applies them safely.
 */
export async function applyIncomingPush(
  db: Db,
  secret: string | null | undefined,
  payload: SyncPushPayload,
): Promise<SyncPushResult> {
  if (!validateSyncSecret(db, secret)) {
    throw errForbidden();
  }

  const acknowledgedIds: number[] = [];
  const now = nowStamp();

  await db.transaction(async () => {
    // Suppress local triggers from re-outboxing incoming items
    db.run("UPDATE sync_control SET is_applying_remote = 1 WHERE id = 1");

    try {
      for (const item of payload.items) {
        if (!item.data) {
          acknowledgedIds.push(item.id);
          continue;
        }

        const { entityType, entityId, data } = item;
        const cleanPrefix = payload.branchPrefix ? payload.branchPrefix.trim().toLowerCase() : "";
        const effectiveBranchId =
          payload.branchId && payload.branchId !== "main"
            ? payload.branchId
            : (cleanPrefix ? `branch-${cleanPrefix}` : "branch-2");

        if (entityType === "members") {
          upsertMember(db, entityId, data, effectiveBranchId);
        } else if (entityType === "cards") {
          upsertCard(db, entityId, data);
        } else if (entityType === "member_subscriptions") {
          upsertSubscription(db, entityId, data, effectiveBranchId);
        } else if (entityType === "attendance") {
          upsertAttendance(db, entityId, data, effectiveBranchId);
        } else if (entityType === "payments") {
          upsertPayment(db, entityId, data, effectiveBranchId);
        }

        db.run(
          "INSERT INTO sync_inbox_log (remote_branch_id, entity_type, entity_id, operation, applied_at, result) " +
            "VALUES (?, ?, ?, ?, ?, 'ok')",
          [effectiveBranchId, entityType, entityId, item.operation, now],
        );

        upsertRegisteredBranch(
          db,
          effectiveBranchId,
          payload.branchName || effectiveBranchId,
          "replica",
          payload.branchPrefix || "",
        );

        acknowledgedIds.push(item.id);
      }
    } finally {
      db.run("UPDATE sync_control SET is_applying_remote = 0 WHERE id = 1");
    }
  });

  return {
    ok: true,
    appliedCount: acknowledgedIds.length,
    acknowledgedIds,
  };
}

/**
 * Primary branch serves newly created or updated entities to replica branch.
 */
export async function getOutgoingPull(
  db: Db,
  secret: string | null | undefined,
  since: string | null | undefined,
): Promise<SyncPullResult> {
  if (!validateSyncSecret(db, secret)) {
    throw errForbidden();
  }

  const effectiveSince = since || "1970-01-01T00:00:00.000Z";
  const now = nowStamp();

  const members = db.all<Row>(
    "SELECT * FROM members WHERE updated_at > ? OR created_at > ? ORDER BY updated_at ASC LIMIT 500",
    [effectiveSince, effectiveSince],
  );

  const cards = db.all<Row>(
    "SELECT * FROM cards WHERE updated_at > ? OR created_at > ? ORDER BY updated_at ASC LIMIT 500",
    [effectiveSince, effectiveSince],
  );

  const subscriptions = db.all<Row>(
    "SELECT * FROM member_subscriptions WHERE updated_at > ? OR created_at > ? ORDER BY updated_at ASC LIMIT 500",
    [effectiveSince, effectiveSince],
  );

  const attendance = db.all<Row>(
    "SELECT * FROM attendance WHERE checkin_at > ? ORDER BY checkin_at ASC LIMIT 500",
    [effectiveSince],
  );

  const payments = db.all<Row>(
    "SELECT * FROM payments WHERE updated_at > ? OR created_at > ? ORDER BY updated_at ASC LIMIT 500",
    [effectiveSince, effectiveSince],
  );

  const plans = db.all<Row>(
    "SELECT * FROM membership_plans WHERE updated_at > ? OR created_at > ? ORDER BY updated_at ASC LIMIT 500",
    [effectiveSince, effectiveSince],
  );

  return {
    ok: true,
    timestamp: now,
    updates: {
      members,
      cards,
      subscriptions,
      attendance,
      payments,
      plans,
    },
  };
}

/**
 * Replica branch executes one full push-pull synchronization cycle.
 */
export async function performSyncCycle(
  db: Db,
  actor?: ServiceActor,
): Promise<SyncCycleResult> {
  if (actor) {
    requirePermission(actor, "settings.view");
  }

  const config = getBranchConfig(db);
  if (config.branchRole === "primary") {
    return { ok: true, pushedCount: 0, pulledCount: 0 };
  }

  const remoteUrl = normalizeRemoteUrl(config.remoteUrl);
  if (!remoteUrl) {
    const msg = "رابط الفرع الرئيسي غير محدد";
    db.run("UPDATE branch_info SET last_error = ? WHERE branch_id = ?", [msg, config.branchId]);
    return { ok: false, pushedCount: 0, pulledCount: 0, error: msg };
  }

  let pushedCount = 0;
  let pulledCount = 0;

  try {
    // 1. PUSH PHASE
    const pending = db.all<SyncOutboxRow>(
      "SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT 100",
    );

    if (pending.length > 0) {
      const items: SyncPushItem[] = [];

      for (const row of pending) {
        let data: Record<string, unknown> | null = null;
        if (row.operation !== "delete") {
          data = fetchEntityData(db, row.entity_type, row.entity_id);
        }
        items.push({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation,
          occurredAt: row.occurred_at,
          data,
        });
      }

      const pushUrl = `${remoteUrl}/api/sync/push`;
      const pushRes = await fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": config.syncSecret,
          "User-Agent": "GymGate-Sync/1.0",
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          branchId: config.branchId,
          branchName: config.branchName,
          branchPrefix: config.branchPrefix,
          items,
        }),
      });

      if (!pushRes.ok) {
        const text = await pushRes.text().catch(() => "");
        if (pushRes.status === 403) {
          throw new Error("رمز أمان المزامنة غير صحيح أو غير متطابق مع الفرع الرئيسي");
        } else if (pushRes.status === 521) {
          throw new Error("الفرع الرئيسي متوقف أو مغلق خلف نفق Cloudflare (521)");
        } else if (pushRes.status === 522 || pushRes.status === 524) {
          throw new Error("انتهت مهلة استجابة نفق Cloudflare مع السيرفر الرئيسي (522/524)");
        }
        throw new Error(`Push failed with HTTP ${pushRes.status}: ${text}`);
      }

      const pushRaw = (await pushRes.json()) as unknown;
      const pushJson: SyncPushResult = (
        typeof pushRaw === "object" && pushRaw !== null && "result" in pushRaw
          ? (pushRaw as { result: SyncPushResult }).result
          : pushRaw
      ) as SyncPushResult;
      if (pushJson.ok && Array.isArray(pushJson.acknowledgedIds) && pushJson.acknowledgedIds.length > 0) {
        const placeholders = pushJson.acknowledgedIds.map(() => "?").join(",");
        db.run(
          `UPDATE sync_outbox SET status = 'synced', last_attempt_at = ? WHERE id IN (${placeholders})`,
          [nowStamp(), ...pushJson.acknowledgedIds],
        );
        pushedCount = pushJson.acknowledgedIds.length;
      }
    }

    // 2. PULL PHASE
    const pullUrl = `${remoteUrl}/api/sync/pull`;
    const pullRes = await fetch(pullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": config.syncSecret,
        "User-Agent": "GymGate-Sync/1.0",
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        branchId: config.branchId,
        branchName: config.branchName,
        branchPrefix: config.branchPrefix,
        since: config.lastPullAt,
      }),
    });

    if (!pullRes.ok) {
      const rawText = await pullRes.text().catch(() => "");
      if (pullRes.status === 403) {
        throw new Error("رمز أمان المزامنة غير صحيح أو غير متطابق مع الفرع الرئيسي");
      } else if (pullRes.status === 502) {
        throw new Error("تعذر الوصول للفرع الرئيسي عبر Cloudflare (502 Bad Gateway) - تأكد أن النفق والسيرفر يعملان");
      } else if (pullRes.status === 521) {
        throw new Error("الفرع الرئيسي متوقف أو مغلق خلف نفق Cloudflare (521)");
      } else if (pullRes.status === 522 || pullRes.status === 524) {
        throw new Error("انتهت مهلة استجابة نفق Cloudflare مع السيرفر الرئيسي (522/524)");
      }
      const cleanSnippet = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
      throw new Error(`Pull failed with HTTP ${pullRes.status}${cleanSnippet ? ": " + cleanSnippet : ""}`);
    }

    const pullRaw = (await pullRes.json()) as unknown;
    const pullJson: SyncPullResult = (
      typeof pullRaw === "object" && pullRaw !== null && "result" in pullRaw
        ? (pullRaw as { result: SyncPullResult }).result
        : pullRaw
    ) as SyncPullResult;
    if (pullJson.ok) {
      if (pullJson.updates) {
        await db.transaction(async () => {
          db.run("UPDATE sync_control SET is_applying_remote = 1 WHERE id = 1");
          try {
            const { members, cards, subscriptions, attendance, payments, plans } = pullJson.updates;

            for (const row of plans || []) upsertPlan(db, String(row.id), row);
            for (const row of members || []) upsertMember(db, String(row.id), row);
            for (const row of cards || []) upsertCard(db, String(row.id), row);
            for (const row of subscriptions || []) upsertSubscription(db, String(row.id), row);
            for (const row of attendance || []) upsertAttendance(db, String(row.id), row);
            for (const row of payments || []) upsertPayment(db, String(row.id), row);

            pulledCount =
              (members?.length || 0) +
              (cards?.length || 0) +
              (subscriptions?.length || 0) +
              (attendance?.length || 0) +
              (payments?.length || 0);
          } finally {
            db.run("UPDATE sync_control SET is_applying_remote = 0 WHERE id = 1");
          }
        });
      }

      const now = nowStamp();
      db.run(
        "UPDATE branch_info SET last_push_at = ?, last_pull_at = ?, last_error = NULL WHERE branch_id = ?",
        [now, pullJson.timestamp || now, config.branchId],
      );
    }

    return { ok: true, pushedCount, pulledCount };
  } catch (err: unknown) {
    let errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("TimeoutError") || errorMsg.includes("aborted") || errorMsg.includes("timeout")) {
      errorMsg = "انتهت مهلة المزامنة مع الفرع الرئيسي (تأكد من استقرار الإنترنت والاتصال)";
    } else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOTFOUND")) {
      errorMsg = "تعذر الاتصال بالفرع الرئيسي - تأكد من تشغيل Tailscale أو صحة رابط Cloudflare";
    }
    db.run("UPDATE branch_info SET last_error = ? WHERE branch_id = ?", [
      errorMsg,
      config.branchId,
    ]);
    return { ok: false, pushedCount, pulledCount, error: errorMsg };
  }
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  remoteBranchName?: string;
  remoteBranchRole?: string;
  error?: string;
}

/**
 * Tests connectivity and authentication to a remote primary branch.
 */
export async function testRemoteConnection(
  db: Db,
  actor: ServiceActor,
  input?: { remoteUrl?: string; syncSecret?: string },
): Promise<TestConnectionResult> {
  requirePermission(actor, "settings.view");
  const config = getBranchConfig(db);
  const targetUrl = normalizeRemoteUrl(input?.remoteUrl ?? config.remoteUrl);
  const targetSecret = (input?.syncSecret ?? config.syncSecret)?.trim();

  if (!targetUrl) {
    return { ok: false, error: "رابط الفرع الرئيسي غير محدد" };
  }
  if (!targetSecret) {
    return { ok: false, error: "رمز أمان المزامنة غير محدد" };
  }

  const start = Date.now();
  try {
    const pingUrl = `${targetUrl}/api/sync/ping`;
    const res = await fetch(pingUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": targetSecret,
        "User-Agent": "GymGate-Sync/1.0",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        probe: true,
        branchId: config.branchId,
        branchName: config.branchName,
        branchPrefix: config.branchPrefix,
      }),
    });

    const latencyMs = Date.now() - start;

    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        latencyMs,
        error: "تم الوصول إلى الخادم ولكن رمز أمان المزامنة (Secret Key) غير متطابق",
      };
    }

    if (res.status === 521) {
      return {
        ok: false,
        error: "الخادم الرئيسي متوقف أو مغلق خلف نفق Cloudflare (Web Server Is Down - 521)",
      };
    }
    if (res.status === 522 || res.status === 524) {
      return {
        ok: false,
        error: "انتهت مهلة الاتصال بالخادم عبر نفق Cloudflare (522/524)",
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        error: `استجاب الخادم برمز خطأ (${res.status}): ${text.slice(0, 100)}`,
      };
    }

    const raw = (await res.json()) as unknown;
    const data = (
      typeof raw === "object" && raw !== null && "result" in raw
        ? (raw as { result: { ok: boolean; branchName?: string; branchRole?: string; error?: string } }).result
        : raw
    ) as {
      ok: boolean;
      branchName?: string;
      branchRole?: string;
      error?: string;
    };

    if (!data.ok) {
      return {
        ok: false,
        latencyMs,
        error: data.error || "فشل التحقق من الفرع الرئيسي",
      };
    }

    if (config.branchRole === "replica") {
      db.run("UPDATE branch_info SET last_error = NULL WHERE branch_id = ?", [config.branchId]);
    }

    return {
      ok: true,
      latencyMs,
      remoteBranchName: data.branchName || "الفرع الرئيسي",
      remoteBranchRole: data.branchRole || "primary",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("TimeoutError") || msg.includes("aborted") || msg.includes("timeout")) {
      return {
        ok: false,
        error: "انتهت مهلة الاتصال بالفرع الرئيسي (15 ثانية) - تحقق من اتصال الإنترنت أو اتصال شبكة Tailscale",
      };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return {
        ok: false,
        error: "تعذر الاتصال بعنوان الخادم (Connection Refused) - تأكد من تشغيل البرنامج على الجهاز الرئيسي ومن تشغيل Tailscale",
      };
    }
    return {
      ok: false,
      error: `تعذر الاتصال بالفرع الرئيسي: ${msg}`,
    };
  }
}

// -------------------------------------------------------------------------
// Helper entity fetchers & upserts
// -------------------------------------------------------------------------

function fetchEntityData(db: Db, entityType: string, entityId: string): Record<string, unknown> | null {
  const table =
    entityType === "members"
      ? "members"
      : entityType === "cards"
      ? "cards"
      : entityType === "member_subscriptions"
      ? "member_subscriptions"
      : entityType === "attendance"
      ? "attendance"
      : entityType === "payments"
      ? "payments"
      : null;

  if (!table) return null;
  return db.first<Row>(`SELECT * FROM ${table} WHERE id = ?`, [entityId]) ?? null;
}

function resolveLocalUserId(db: Db, userId: unknown): string | null {
  const uid = s(userId);
  if (!uid) return null;
  const exists = db.scalar("SELECT id FROM users WHERE id = ?", [uid]);
  return exists ? String(exists) : null;
}

function resolveLocalRequiredUserId(db: Db, userId: unknown): string {
  const uid = s(userId);
  if (uid) {
    const exists = db.scalar("SELECT id FROM users WHERE id = ?", [uid]);
    if (exists) return String(exists);
  }
  const ownerId =
    db.scalar("SELECT id FROM users WHERE role_id = 'owner' LIMIT 1") ||
    db.scalar("SELECT id FROM users LIMIT 1");
  return String(ownerId || "owner");
}

function resolveLocalFileId(db: Db, fileId: unknown): string | null {
  const fid = s(fileId);
  if (!fid) return null;
  const exists = db.scalar("SELECT id FROM files WHERE id = ?", [fid]);
  return exists ? String(exists) : null;
}

function resolveLocalCardId(db: Db, cardId: unknown): string | null {
  const cid = s(cardId);
  if (!cid) return null;
  const exists = db.scalar("SELECT id FROM cards WHERE id = ?", [cid]);
  return exists ? String(exists) : null;
}

function resolveLocalSubscriptionId(db: Db, subId: unknown): string | null {
  const sid = s(subId);
  if (!sid) return null;
  const exists = db.scalar("SELECT id FROM member_subscriptions WHERE id = ?", [sid]);
  return exists ? String(exists) : null;
}

function upsertMember(db: Db, id: string, data: Record<string, unknown>, branchId?: string): void {
  const existing = db.first<{ id: string; updated_at: string }>(
    "SELECT id, updated_at FROM members WHERE id = ?",
    [id],
  );

  let targetBranch = s(data.branch_id);
  const memberCode = sReq(data.member_code, "");
  if (!targetBranch || (targetBranch === "main" && branchId && branchId !== "main")) {
    targetBranch = branchId || "main";
  }
  if (targetBranch === "main" && memberCode.startsWith("B2-")) {
    targetBranch = "branch-2";
  }
  const safePhotoId = resolveLocalFileId(db, data.photo_file_id);
  const safeDeletedBy = resolveLocalUserId(db, data.deleted_by);

  if (existing) {
    const remoteUpdated = s(data.updated_at, "");
    if (remoteUpdated && remoteUpdated < existing.updated_at) {
      return; // Local is newer, keep local
    }
    db.run(
      "UPDATE members SET full_name = ?, phone = ?, email = ?, gender = ?, date_of_birth = ?, " +
        "address = ?, notes = ?, registration_date = ?, status = ?, height_cm = ?, weight_kg = ?, " +
        "emergency_contact_name = ?, emergency_contact_phone = ?, department = ?, photo_file_id = ?, " +
        "deleted_at = ?, deleted_by = ?, deletion_reason = ?, branch_id = ?, home_branch_only = ?, updated_at = ? WHERE id = ?",
      [
        sReq(data.full_name, ""),
        s(data.phone),
        s(data.email),
        s(data.gender),
        s(data.date_of_birth),
        s(data.address),
        s(data.notes),
        sReq(data.registration_date, nowStamp().slice(0, 10)),
        sReq(data.status, "active"),
        n(data.height_cm),
        n(data.weight_kg),
        s(data.emergency_contact_name),
        s(data.emergency_contact_phone),
        sReq(data.department, "general"),
        safePhotoId,
        s(data.deleted_at),
        safeDeletedBy,
        s(data.deletion_reason),
        targetBranch,
        data.home_branch_only ? 1 : 0,
        sReq(data.updated_at, nowStamp()),
        id,
      ],
    );
  } else {
    // Avoid member_code collision
    let memberCode = sReq(data.member_code, "");
    const codeTaken = db.scalar("SELECT id FROM members WHERE member_code = ?", [memberCode]);
    if (codeTaken && codeTaken !== id) {
      memberCode = `${memberCode}-${id.slice(0, 4)}`;
    }

    db.run(
      "INSERT INTO members (id, member_code, full_name, phone, email, gender, date_of_birth, address, notes, " +
        "registration_date, status, height_cm, weight_kg, emergency_contact_name, emergency_contact_phone, " +
        "department, photo_file_id, deleted_at, deleted_by, deletion_reason, branch_id, home_branch_only, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        memberCode,
        sReq(data.full_name, ""),
        s(data.phone),
        s(data.email),
        s(data.gender),
        s(data.date_of_birth),
        s(data.address),
        s(data.notes),
        sReq(data.registration_date, nowStamp().slice(0, 10)),
        sReq(data.status, "active"),
        n(data.height_cm),
        n(data.weight_kg),
        s(data.emergency_contact_name),
        s(data.emergency_contact_phone),
        sReq(data.department, "general"),
        safePhotoId,
        s(data.deleted_at),
        safeDeletedBy,
        s(data.deletion_reason),
        targetBranch,
        data.home_branch_only ? 1 : 0,
        sReq(data.created_at, nowStamp()),
        sReq(data.updated_at, nowStamp()),
      ],
    );
  }
}

function upsertCard(db: Db, id: string, data: Record<string, unknown>): void {
  const existing = db.first<{ id: string; updated_at: string }>(
    "SELECT id, updated_at FROM cards WHERE id = ?",
    [id],
  );

  const rawMemberId = s(data.member_id);
  const safeMemberId =
    rawMemberId && db.scalar("SELECT id FROM members WHERE id = ?", [rawMemberId])
      ? rawMemberId
      : null;

  if (existing) {
    db.run(
      "UPDATE cards SET status = ?, kind = ?, member_id = ?, notes = ?, assigned_at = ?, unassigned_at = ?, updated_at = ? WHERE id = ?",
      [
        sReq(data.status, "available"),
        sReq(data.kind, "physical"),
        safeMemberId,
        s(data.notes),
        s(data.assigned_at),
        s(data.unassigned_at),
        sReq(data.updated_at, nowStamp()),
        id,
      ],
    );
  } else {
    // Avoid barcode collision
    let barcode = sReq(data.barcode_value, "");
    const barcodeTaken = db.scalar("SELECT id FROM cards WHERE barcode_value = ?", [barcode]);
    if (barcodeTaken && barcodeTaken !== id) {
      barcode = `${barcode}-${id.slice(0, 4)}`;
    }

    db.run(
      "INSERT INTO cards (id, barcode_value, status, kind, member_id, notes, assigned_at, unassigned_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        barcode,
        sReq(data.status, "available"),
        sReq(data.kind, "physical"),
        safeMemberId,
        s(data.notes),
        s(data.assigned_at),
        s(data.unassigned_at),
        sReq(data.created_at, nowStamp()),
        sReq(data.updated_at, nowStamp()),
      ],
    );
  }
}

function upsertSubscription(db: Db, id: string, data: Record<string, unknown>, branchId?: string): void {
  const existing = db.first<{ id: string; updated_at: string }>(
    "SELECT id, updated_at FROM member_subscriptions WHERE id = ?",
    [id],
  );

  const memberId = sReq(data.member_id, "");
  if (!existing && !db.scalar("SELECT id FROM members WHERE id = ?", [memberId])) {
    return;
  }

  let planId = sReq(data.plan_id, "");
  if (!db.scalar("SELECT id FROM membership_plans WHERE id = ?", [planId])) {
    const fallbackPlan = db.scalar("SELECT id FROM membership_plans LIMIT 1");
    if (fallbackPlan) planId = String(fallbackPlan);
    else return;
  }

  let targetBranch = s(data.branch_id);
  if (!targetBranch || (targetBranch === "main" && branchId && branchId !== "main")) {
    targetBranch = branchId || "main";
  }

  if (existing) {
    db.run(
      "UPDATE member_subscriptions SET plan_id = ?, start_date = ?, end_date = ?, price = ?, status = ?, notes = ?, branch_id = ?, updated_at = ? WHERE id = ?",
      [
        planId,
        sReq(data.start_date, ""),
        sReq(data.end_date, ""),
        nReq(data.price, 0),
        sReq(data.status, "active"),
        s(data.notes),
        targetBranch,
        sReq(data.updated_at, nowStamp()),
        id,
      ],
    );
  } else {
    db.run(
      "INSERT INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, status, notes, branch_id, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        memberId,
        planId,
        sReq(data.start_date, ""),
        sReq(data.end_date, ""),
        nReq(data.price, 0),
        sReq(data.status, "active"),
        s(data.notes),
        targetBranch,
        sReq(data.created_at, nowStamp()),
        sReq(data.updated_at, nowStamp()),
      ],
    );
  }
}

function upsertAttendance(db: Db, id: string, data: Record<string, unknown>, branchId?: string): void {
  const existing = db.first<{ id: string }>("SELECT id FROM attendance WHERE id = ?", [id]);
  let targetBranch = s(data.branch_id);
  if (!targetBranch || (targetBranch === "main" && branchId && branchId !== "main")) {
    targetBranch = branchId || "main";
  }
  const memberId = sReq(data.member_id, "");
  if (!db.scalar("SELECT id FROM members WHERE id = ?", [memberId])) {
    return;
  }

  if (!existing) {
    db.run(
      "INSERT INTO attendance (id, member_id, card_id, subscription_id, checkin_at, created_by, device_identifier, notes, branch_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        memberId,
        resolveLocalCardId(db, data.card_id),
        resolveLocalSubscriptionId(db, data.subscription_id),
        sReq(data.checkin_at, nowStamp()),
        resolveLocalRequiredUserId(db, data.created_by),
        s(data.device_identifier),
        s(data.notes),
        targetBranch,
      ],
    );
  }
}

function upsertPayment(db: Db, id: string, data: Record<string, unknown>, branchId?: string): void {
  const existing = db.first<{ id: string }>("SELECT id FROM payments WHERE id = ?", [id]);
  let targetBranch = s(data.branch_id);
  if (!targetBranch || (targetBranch === "main" && branchId && branchId !== "main")) {
    targetBranch = branchId || "main";
  }
  if (existing) {
    db.run(
      "UPDATE payments SET status = ?, paid_amount_minor = ?, remaining_amount_minor = ?, refunded_amount_minor = ?, branch_id = ?, updated_at = ? WHERE id = ?",
      [
        sReq(data.status, "paid"),
        nReq(data.paid_amount_minor, 0),
        nReq(data.remaining_amount_minor, 0),
        nReq(data.refunded_amount_minor, 0),
        targetBranch,
        sReq(data.updated_at, nowStamp()),
        id,
      ],
    );
  } else {
    const memberId = sReq(data.member_id, "");
    if (!db.scalar("SELECT id FROM members WHERE id = ?", [memberId])) {
      return;
    }

    const createdBy = resolveLocalRequiredUserId(db, data.created_by);
    const safeSubId = resolveLocalSubscriptionId(db, data.subscription_id);

    const baseMinor = nReq(data.base_amount_minor, 0);
    const discMinor = nReq(data.discount_amount_minor, 0);
    const netMinor = data.net_amount_minor !== undefined && data.net_amount_minor !== null
      ? nReq(data.net_amount_minor, baseMinor - discMinor)
      : baseMinor - discMinor;

    db.run(
      "INSERT INTO payments (id, member_id, subscription_id, base_amount_minor, discount_kind, discount_input, " +
        "discount_amount_minor, net_amount_minor, paid_amount_minor, refunded_amount_minor, remaining_amount_minor, " +
        "method_code, status, reference_no, notes, client_ref, paid_at, created_by, branch_id, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        sReq(data.member_id, ""),
        safeSubId,
        baseMinor,
        sReq(data.discount_kind, "none"),
        nReq(data.discount_input, 0),
        discMinor,
        netMinor,
        nReq(data.paid_amount_minor, 0),
        nReq(data.refunded_amount_minor, 0),
        nReq(data.remaining_amount_minor, 0),
        sReq(data.method_code, "cash"),
        sReq(data.status, "paid"),
        s(data.reference_no),
        s(data.notes),
        s(data.client_ref),
        sReq(data.paid_at, nowStamp()),
        createdBy,
        targetBranch,
        sReq(data.created_at, nowStamp()),
        sReq(data.updated_at, nowStamp()),
      ],
    );
  }
}

function upsertPlan(db: Db, id: string, data: Record<string, unknown>): void {
  const existing = db.first<{ id: string }>("SELECT id FROM membership_plans WHERE id = ?", [id]);
  if (existing) {
    db.run(
      "UPDATE membership_plans SET name = ?, duration_days = ?, price = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?",
      [
        sReq(data.name, ""),
        nReq(data.duration_days, 30),
        nReq(data.price, 0),
        s(data.description),
        nReq(data.is_active, 1),
        sReq(data.updated_at, nowStamp()),
        id,
      ],
    );
  } else {
    let name = sReq(data.name, "");
    const nameTaken = db.scalar("SELECT id FROM membership_plans WHERE name = ?", [name]);
    if (nameTaken && nameTaken !== id) {
      name = `${name} (${id.slice(0, 4)})`;
    }

    db.run(
      "INSERT INTO membership_plans (id, name, duration_days, price, description, is_active, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        name,
        nReq(data.duration_days, 30),
        nReq(data.price, 0),
        s(data.description),
        nReq(data.is_active, 1),
        sReq(data.created_at, nowStamp()),
        sReq(data.updated_at, nowStamp()),
      ],
    );
  }
}

function s(val: unknown, fallback: string | null = null): string | null {
  if (val === undefined || val === null) return fallback;
  return String(val);
}

function sReq(val: unknown, fallback: string): string {
  if (val === undefined || val === null) return fallback;
  return String(val);
}

function n(val: unknown, fallback: number | null = null): number | null {
  if (val === undefined || val === null || val === "") return fallback;
  const num = Number(val);
  return isNaN(num) ? fallback : num;
}

function nReq(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === "") return fallback;
  const num = Number(val);
  return isNaN(num) ? fallback : num;
}

export interface RegisteredBranch {
  branchId: string;
  branchName: string;
  branchRole: string;
  branchPrefix: string;
  isActive: boolean;
  lastSeenAt: string | null;
  isOnline: boolean;
  membersCount: number;
  activeSubscriptionsCount: number;
  todayAttendanceCount: number;
  totalPaymentsMinor: number;
}

export function listRegisteredBranches(db: Db): RegisteredBranch[] {
  const local = db.first<BranchConfigRow>("SELECT * FROM branch_info LIMIT 1");
  const localBranchId = local?.branch_id || "main";

  const hasTable =
    db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'registered_branches'") > 0;
  if (!hasTable) {
    return [
      {
        branchId: localBranchId,
        branchName: local?.branch_name || "الفرع الرئيسي",
        branchRole: local?.branch_role || "primary",
        branchPrefix: local?.branch_prefix || "",
        isActive: true,
        lastSeenAt: local?.updated_at || null,
        isOnline: true,
        membersCount: db.count("SELECT COUNT(*) FROM members WHERE branch_id = ? AND deleted_at IS NULL", [localBranchId]),
        activeSubscriptionsCount: db.count("SELECT COUNT(*) FROM member_subscriptions WHERE branch_id = ? AND status = 'active'", [localBranchId]),
        todayAttendanceCount: db.count("SELECT COUNT(*) FROM attendance WHERE branch_id = ? AND date(checkin_at) = date('now', 'localtime')", [localBranchId]),
        totalPaymentsMinor: Number(db.scalar("SELECT COALESCE(SUM(paid_amount_minor), 0) FROM payments WHERE branch_id = ? AND status = 'paid'", [localBranchId]) || 0),
      },
    ];
  }

  if (local?.branch_role === "replica") {
    const mainRow = db.first<{ branch_name: string; branch_role: string }>(
      "SELECT branch_name, branch_role FROM registered_branches WHERE branch_id = 'main'",
    );
    if (!mainRow || mainRow.branch_role !== "primary" || (local.branch_name && mainRow.branch_name === local.branch_name)) {
      upsertRegisteredBranch(db, "main", "الفرع الرئيسي", "primary", "B1");
    }
  } else if (local?.branch_role === "primary") {
    const localId = local.branch_id || "main";
    const mainRow = db.first<{ branch_name: string; branch_role: string; branch_prefix: string }>(
      "SELECT branch_name, branch_role, branch_prefix FROM registered_branches WHERE branch_id = ?",
      [localId],
    );
    if (
      !mainRow ||
      mainRow.branch_role !== "primary" ||
      mainRow.branch_name !== local.branch_name ||
      mainRow.branch_prefix !== (local.branch_prefix || "B1")
    ) {
      // Remove any erroneous replica overwrite
      db.run("DELETE FROM registered_branches WHERE branch_id = ? AND branch_role = 'replica'", [localId]);
      upsertRegisteredBranch(db, localId, local.branch_name || "الفرع الرئيسي", "primary", local.branch_prefix || "B1");
    }

    // Auto-heal on primary: reassign any members created with replica prefix (B2-) to branch-2
    try {
      db.run("UPDATE members SET branch_id = 'branch-2' WHERE branch_id = 'main' AND member_code LIKE 'B2-%'");
      db.run(
        "UPDATE member_subscriptions SET branch_id = 'branch-2' WHERE branch_id = 'main' AND member_id IN (SELECT id FROM members WHERE branch_id = 'branch-2')",
      );
      // Ensure branch-2 exists in registered_branches if B2 members exist
      const b2Count = db.count("SELECT COUNT(*) FROM members WHERE branch_id = 'branch-2'");
      if (b2Count > 0) {
        upsertRegisteredBranch(db, "branch-2", "الفرع الثاني", "replica", "B2");
      }
    } catch {
      /* ignore */
    }
  }

  const hasPrefixCol = db.count("SELECT COUNT(*) FROM pragma_table_info('registered_branches') WHERE name = 'branch_prefix'") > 0;
  const hasLastSeenCol = db.count("SELECT COUNT(*) FROM pragma_table_info('registered_branches') WHERE name = 'last_seen_at'") > 0;

  const cols = `branch_id, branch_name, branch_role, is_active${hasPrefixCol ? ", branch_prefix" : ""}${hasLastSeenCol ? ", last_seen_at" : ""}`;
  const rows = db.all<{
    branch_id: string;
    branch_name: string;
    branch_role: string;
    is_active: number;
    branch_prefix?: string;
    last_seen_at?: string | null;
  }>(`SELECT ${cols} FROM registered_branches ORDER BY (branch_role = 'primary') DESC, branch_name ASC`);

  if (rows.length === 0) {
    return [
      {
        branchId: localBranchId,
        branchName: local?.branch_name || "الفرع الرئيسي",
        branchRole: local?.branch_role || "primary",
        branchPrefix: local?.branch_prefix || "",
        isActive: true,
        lastSeenAt: local?.updated_at || null,
        isOnline: true,
        membersCount: db.count("SELECT COUNT(*) FROM members WHERE branch_id = ? AND deleted_at IS NULL", [localBranchId]),
        activeSubscriptionsCount: db.count("SELECT COUNT(*) FROM member_subscriptions WHERE branch_id = ? AND status = 'active'", [localBranchId]),
        todayAttendanceCount: db.count("SELECT COUNT(*) FROM attendance WHERE branch_id = ? AND date(checkin_at) = date('now', 'localtime')", [localBranchId]),
        totalPaymentsMinor: Number(db.scalar("SELECT COALESCE(SUM(paid_amount_minor), 0) FROM payments WHERE branch_id = ? AND status = 'paid'", [localBranchId]) || 0),
      },
    ];
  }

  const nowMs = Date.now();
  const ONLINE_THRESHOLD_MS = 60 * 1000;

  return rows.map((r) => {
    const isPrimary = r.branch_role === "primary" || r.branch_id === localBranchId;
    let isOnline = false;
    if (isPrimary) {
      isOnline = true;
    } else if (r.last_seen_at) {
      const seenMs = new Date(r.last_seen_at.replace(" ", "T")).getTime();
      const diffMs = nowMs - seenMs;
      isOnline = !isNaN(seenMs) && diffMs >= 0 && diffMs <= ONLINE_THRESHOLD_MS;
    }

    const membersCount = db.count(
      "SELECT COUNT(*) FROM members WHERE branch_id = ? AND deleted_at IS NULL",
      [r.branch_id],
    );
    const activeSubscriptionsCount = db.count(
      "SELECT COUNT(*) FROM member_subscriptions WHERE branch_id = ? AND status = 'active'",
      [r.branch_id],
    );
    const todayAttendanceCount = db.count(
      "SELECT COUNT(*) FROM attendance WHERE branch_id = ? AND date(checkin_at) = date('now', 'localtime')",
      [r.branch_id],
    );
    const totalPaymentsMinor = Number(
      db.scalar(
        "SELECT COALESCE(SUM(paid_amount_minor), 0) FROM payments WHERE branch_id = ? AND status = 'paid'",
        [r.branch_id],
      ) || 0,
    );

    return {
      branchId: r.branch_id,
      branchName: r.branch_name,
      branchRole: r.branch_role,
      branchPrefix: r.branch_prefix || (isPrimary ? (local?.branch_prefix || "") : ""),
      isActive: r.is_active === 1,
      lastSeenAt: isPrimary ? (local?.updated_at || null) : (r.last_seen_at || null),
      isOnline,
      membersCount,
      activeSubscriptionsCount,
      todayAttendanceCount,
      totalPaymentsMinor,
    };
  });
}

export function upsertRegisteredBranch(
  db: Db,
  branchId: string,
  branchName: string,
  branchRole: string = "replica",
  branchPrefix: string = "",
): void {
  const hasTable =
    db.count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'registered_branches'") > 0;
  if (!hasTable) return;

  const local = db.first<{ branch_id: string; branch_name: string; branch_role: string; branch_prefix: string }>(
    "SELECT branch_id, branch_name, branch_role, branch_prefix FROM branch_info LIMIT 1",
  );

  // CRITICAL GUARD: Protect primary hub identity
  // If this database is the primary hub, NEVER allow an incoming replica or sync to overwrite 'main'
  if (local?.branch_role === "primary") {
    if (branchRole === "replica" && (branchId === "main" || branchId === local.branch_id)) {
      const cleanPrefix = branchPrefix ? branchPrefix.trim().toLowerCase() : "";
      branchId = cleanPrefix ? `branch-${cleanPrefix}` : "branch-2";
    }
    if (branchId === "main" || branchId === local.branch_id) {
      branchRole = "primary";
      branchName = local.branch_name || "الفرع الرئيسي";
      branchPrefix = local.branch_prefix || "B1";
    }
  }

  const now = nowStamp();
  const hasPrefixCol = db.count("SELECT COUNT(*) FROM pragma_table_info('registered_branches') WHERE name = 'branch_prefix'") > 0;

  if (hasPrefixCol) {
    db.run(
      "INSERT INTO registered_branches (branch_id, branch_name, branch_role, branch_prefix, is_active, last_seen_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, 1, ?, ?, ?) " +
        "ON CONFLICT(branch_id) DO UPDATE SET " +
        "branch_name = CASE WHEN excluded.branch_name != excluded.branch_id AND excluded.branch_name != '' THEN excluded.branch_name ELSE registered_branches.branch_name END, " +
        "branch_role = excluded.branch_role, " +
        "branch_prefix = CASE WHEN excluded.branch_prefix != '' THEN excluded.branch_prefix ELSE registered_branches.branch_prefix END, " +
        "last_seen_at = excluded.last_seen_at, " +
        "updated_at = excluded.updated_at",
      [branchId, branchName, branchRole, branchPrefix, now, now, now],
    );
  } else {
    db.run(
      "INSERT INTO registered_branches (branch_id, branch_name, branch_role, is_active, created_at, updated_at) " +
        "VALUES (?, ?, ?, 1, ?, ?) " +
        "ON CONFLICT(branch_id) DO UPDATE SET " +
        "branch_name = CASE WHEN excluded.branch_name != excluded.branch_id AND excluded.branch_name != '' THEN excluded.branch_name ELSE registered_branches.branch_name END, " +
        "branch_role = excluded.branch_role, " +
        "updated_at = excluded.updated_at",
      [branchId, branchName, branchRole, now, now],
    );
  }
}

