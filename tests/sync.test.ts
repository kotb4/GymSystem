import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { createMember } from "@/core/services/members.service";
import {
  getBranchConfig,
  updateBranchConfig,
  getSyncStatus,
  getPendingOutboxCount,
  validateSyncSecret,
  applyIncomingPush,
  getOutgoingPull,
  performSyncCycle,
  normalizeRemoteUrl,
  testRemoteConnection,
  listRegisteredBranches,
  upsertRegisteredBranch,
} from "@/core/services/sync.service";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;
let reception: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = { ...buildActor(ownerUser), isDeveloper: true };

  const recUser = await createUser(db, owner, {
    username: "receptionist",
    fullName: "موظف الاستقبال",
    roleId: "reception",
    password: "Password@123",
  });
  reception = buildActor(recUser);
});

describe("Offline-First Multi-Branch Sync Service", () => {
  it("initializes with default primary branch configuration", () => {
    const config = getBranchConfig(db);
    expect(config.branchId).toBe("main");
    expect(config.branchName).toBe("الفرع الرئيسي");
    expect(config.branchRole).toBe("primary");
    expect(config.autoSyncEnabled).toBe(true);
    expect(config.syncSecret).toBeTruthy();
  });

  it("updates branch configuration when authorized", async () => {
    const updated = await updateBranchConfig(db, owner, {
      branchName: "فرع الإسكندرية",
      branchRole: "replica",
      branchPrefix: "ALX",
      remoteUrl: "https://gym-server.trycloudflare.com",
      syncSecret: "custom-secret-key-123",
    });

    expect(updated.branchName).toBe("فرع الإسكندرية");
    expect(updated.branchRole).toBe("replica");
    expect(updated.branchPrefix).toBe("ALX");
    expect(updated.remoteUrl).toBe("https://gym-server.trycloudflare.com");
    expect(updated.syncSecret).toBe("custom-secret-key-123");
  });

  it("rejects branch configuration updates without permission", async () => {
    await expect(
      updateBranchConfig(db, reception, {
        branchName: "فرع محظور",
      }),
    ).rejects.toThrow();
  });

  it("rejects branch configuration updates for non-developer account", async () => {
    const nonDevUser = { ...owner, isDeveloper: false };
    await expect(
      updateBranchConfig(db, nonDevUser, {
        branchName: "فرع محظور",
      }),
    ).rejects.toThrow();
  });

  it("automatically queues created members in sync_outbox", async () => {
    const initialCount = getPendingOutboxCount(db);

    await createMember(db, owner, {
      fullName: "محمد أحمد علي",
      phone: "01011112222",
      gender: "male",
    });

    const newCount = getPendingOutboxCount(db);
    // Creates member + virtual card = 2 queued items
    expect(newCount).toBe(initialCount + 2);

    const memberOutbox = db.first<{ entity_type: string; operation: string }>(
      "SELECT * FROM sync_outbox WHERE entity_type = 'members' ORDER BY id DESC LIMIT 1",
    );
    expect(memberOutbox).not.toBeNull();
    expect(memberOutbox?.entity_type).toBe("members");
    expect(memberOutbox?.operation).toBe("insert");

    const cardOutbox = db.first<{ entity_type: string; operation: string }>(
      "SELECT * FROM sync_outbox WHERE entity_type = 'cards' ORDER BY id DESC LIMIT 1",
    );
    expect(cardOutbox).not.toBeNull();
    expect(cardOutbox?.entity_type).toBe("cards");
  });

  it("validates sync secret correctly and is safe against timing attacks", () => {
    const config = getBranchConfig(db);
    expect(validateSyncSecret(db, config.syncSecret)).toBe(true);
    expect(validateSyncSecret(db, ` ${config.syncSecret} `)).toBe(true);
    expect(validateSyncSecret(db, "wrong-secret")).toBe(false);
    expect(validateSyncSecret(db, config.syncSecret + "-extra")).toBe(false);
    expect(validateSyncSecret(db, config.syncSecret.slice(0, -1))).toBe(false);
    expect(validateSyncSecret(db, "")).toBe(false);
    expect(validateSyncSecret(db, null)).toBe(false);
    expect(validateSyncSecret(db, undefined)).toBe(false);
  });

  it("applies incoming push on primary branch and avoids echo triggers", async () => {
    const config = getBranchConfig(db);
    const memberId = "remote-member-uuid-101";

    const pushResult = await applyIncomingPush(db, config.syncSecret, {
      branchId: "branch-2",
      items: [
        {
          id: 1,
          entityType: "members",
          entityId: memberId,
          operation: "insert",
          occurredAt: new Date().toISOString(),
          data: {
            id: memberId,
            member_code: "B2-0001",
            full_name: "عميل الفرع الثاني",
            phone: "01233334444",
            gender: "male",
            status: "active",
          },
        },
      ],
    });

    expect(pushResult.ok).toBe(true);
    expect(pushResult.appliedCount).toBe(1);

    // Verify member exists in database
    const member = db.first<{ full_name: string }>("SELECT full_name FROM members WHERE id = ?", [memberId]);
    expect(member?.full_name).toBe("عميل الفرع الثاني");

    // Verify inbox log was written
    const log = db.first<{ remote_branch_id: string }>(
      "SELECT remote_branch_id FROM sync_inbox_log WHERE entity_id = ?",
      [memberId],
    );
    expect(log?.remote_branch_id).toBe("branch-2");
  });

  it("serves outgoing pull records modified since given timestamp", async () => {
    const config = getBranchConfig(db);

    await createMember(db, owner, {
      fullName: "عضو جديد للمزامنة",
      phone: "01122223333",
      gender: "male",
    });

    const pullResult = await getOutgoingPull(db, config.syncSecret, "2020-01-01T00:00:00.000Z");
    expect(pullResult.ok).toBe(true);
    expect(pullResult.updates.members.length).toBeGreaterThan(0);
    expect(pullResult.timestamp).toBeTruthy();
  });

  it("handles offline sync failure gracefully when remote is unreachable", async () => {
    await updateBranchConfig(db, owner, {
      branchRole: "replica",
      remoteUrl: "http://127.0.0.1:59999", // Unreachable port
      syncSecret: "secret",
    });

    const result = await performSyncCycle(db, owner);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    const status = getSyncStatus(db);
    expect(status.state).toBe("offline");
    expect(status.lastError).toBeTruthy();
  });

  describe("normalizeRemoteUrl", () => {
    it("handles null and empty values", () => {
      expect(normalizeRemoteUrl(null)).toBeNull();
      expect(normalizeRemoteUrl(undefined)).toBeNull();
      expect(normalizeRemoteUrl("")).toBeNull();
      expect(normalizeRemoteUrl("   ")).toBeNull();
    });

    it("normalizes Tailscale IP without protocol or port", () => {
      expect(normalizeRemoteUrl("100.94.93.115")).toBe("http://100.94.93.115:8890");
    });

    it("normalizes Tailscale IP with port but without protocol", () => {
      expect(normalizeRemoteUrl("100.94.93.115:8890")).toBe("http://100.94.93.115:8890");
    });

    it("preserves Tailscale IP with http and port", () => {
      expect(normalizeRemoteUrl("http://100.94.93.115:8890/")).toBe("http://100.94.93.115:8890");
    });

    it("normalizes Cloudflare Tunnel URL without https", () => {
      expect(normalizeRemoteUrl("my-gym.trycloudflare.com")).toBe("https://my-gym.trycloudflare.com");
      expect(normalizeRemoteUrl("http://my-gym.trycloudflare.com/")).toBe("https://my-gym.trycloudflare.com");
      expect(normalizeRemoteUrl("https://my-gym.trycloudflare.com")).toBe("https://my-gym.trycloudflare.com");
    });

    it("normalizes localhost and LAN IPs", () => {
      expect(normalizeRemoteUrl("192.168.1.100")).toBe("http://192.168.1.100:8890");
      expect(normalizeRemoteUrl("localhost")).toBe("http://localhost:8890");
    });
  });

  describe("testRemoteConnection", () => {
    it("returns error if remoteUrl is missing", async () => {
      const res = await testRemoteConnection(db, owner, {
        remoteUrl: "",
        syncSecret: "some-secret",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("رابط الفرع الرئيسي غير محدد");
    });

    it("returns error if syncSecret is missing", async () => {
      const res = await testRemoteConnection(db, owner, {
        remoteUrl: "http://100.94.93.115:8890",
        syncSecret: "",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("رمز أمان المزامنة غير محدد");
    });

    it("handles connection refused gracefully", async () => {
      const res = await testRemoteConnection(db, owner, {
        remoteUrl: "http://127.0.0.1:59998",
        syncSecret: "some-secret",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("تعذر الاتصال");
    });
  });

  describe("Multi-Branch Live Registration & Monitoring", () => {
    it("registers and updates replica branch with prefix and tracks last_seen_at", () => {
      upsertRegisteredBranch(db, "branch_2", "فرع التجمع", "replica", "B2");

      const branches = listRegisteredBranches(db);
      expect(branches.length).toBe(2);

      const replica = branches.find((b) => b.branchId === "branch_2");
      expect(replica).toBeDefined();
      expect(replica?.branchName).toBe("فرع التجمع");
      expect(replica?.branchPrefix).toBe("B2");
      expect(replica?.branchRole).toBe("replica");
      expect(replica?.isOnline).toBe(true);
      expect(replica?.lastSeenAt).toBeTruthy();
    });

    it("reports replica as offline if last_seen_at is older than 60s threshold", () => {
      upsertRegisteredBranch(db, "branch_old", "فرع قديم", "replica", "BO");
      const oldDate = new Date(Date.now() - 90 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const oldStamp = `${oldDate.getFullYear()}-${pad(oldDate.getMonth() + 1)}-${pad(oldDate.getDate())} ${pad(oldDate.getHours())}:${pad(oldDate.getMinutes())}:${pad(oldDate.getSeconds())}`;
      db.run("UPDATE registered_branches SET last_seen_at = ? WHERE branch_id = 'branch_old'", [oldStamp]);

      const branches = listRegisteredBranches(db);
      const oldBranch = branches.find((b) => b.branchId === "branch_old");
      expect(oldBranch).toBeDefined();
      expect(oldBranch?.isOnline).toBe(false);
    });

    it("stamps incoming push records with the branch_id and reflects in branch metrics", async () => {
      const secret = getBranchConfig(db).syncSecret;

      await applyIncomingPush(db, secret, {
        branchId: "branch_east",
        branchName: "فرع شرق",
        branchPrefix: "E1",
        items: [
          {
            id: 1,
            entityType: "members",
            entityId: "mem_remote_1",
            operation: "insert",
            occurredAt: new Date().toISOString(),
            data: {
              full_name: "عضو الفرع الثاني",
              phone: "01099998888",
              registration_date: "2026-09-26",
              status: "active",
            },
          },
          {
            id: 2,
            entityType: "payments",
            entityId: "pay_remote_1",
            operation: "insert",
            occurredAt: new Date().toISOString(),
            data: {
              member_id: "mem_remote_1",
              paid_amount_minor: 50000,
              base_amount_minor: 50000,
              status: "paid",
            },
          },
        ],
      });

      const branches = listRegisteredBranches(db);
      const branchEast = branches.find((b) => b.branchId === "branch_east");
      expect(branchEast).toBeDefined();
      expect(branchEast?.branchName).toBe("فرع شرق");
      expect(branchEast?.branchPrefix).toBe("E1");
      expect(branchEast?.membersCount).toBe(1);
      expect(branchEast?.totalPaymentsMinor).toBe(50000);
      expect(branchEast?.isOnline).toBe(true);
    });
  });
});
