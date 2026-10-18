import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setup, buildActor } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { isDeveloperActor } from "@/core/services/developer.service";
import {
  createPortalToken,
  verifyPortalToken,
  PORTAL_TOKEN_TTL_MS,
} from "@/core/services/member-portal.service";
import {
  validateSyncSecret,
  getBranchConfig,
} from "@/core/services/sync.service";
import { invokeRpc } from "../server/rpc";
import * as contextModule from "../server/context";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceActor } from "@/core/permissions";

describe("Security Audit Remediation Drill (TASK-264)", () => {
  let tmpDataDir: string;
  let ownerActor: ServiceActor;
  let managerActor: ServiceActor;
  let receptionistActor: ServiceActor;
  let trainerActor: ServiceActor;

  beforeEach(async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), "gym-security-remediation-"));
    process.env.GYMSYSTEM_DATA_DIR = tmpDataDir;

    const ctx = contextModule.openDatabase();
    const db = ctx.db;

    const ownerUser = await setup(db as never, {
      gymName: "Security Gym",
      ownerFullName: "System Owner",
      username: "owner",
      password: "OwnerPassword@2026",
    });
    ownerActor = buildActor(ownerUser);

    const managerUser = await createUser(db, ownerActor, {
      username: "gym_manager",
      fullName: "Manager",
      roleId: "manager",
      password: "ManagerPassword@2026",
    });
    managerActor = buildActor(managerUser);

    const recepUser = await createUser(db, ownerActor, {
      username: "reception_desk",
      fullName: "Receptionist",
      roleId: "reception",
      password: "ReceptionPassword@2026",
    });
    receptionistActor = buildActor(recepUser);

    const trainerUser = await createUser(db, ownerActor, {
      username: "gym_coach",
      fullName: "Coach",
      roleId: "trainer",
      password: "TrainerPassword@2026",
    });
    trainerActor = buildActor(trainerUser);
  });

  afterEach(() => {
    contextModule.closeDatabase();
    if (tmpDataDir) {
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  describe("F-001 Remediation: Sync Config & Secret Exposure Boundary", () => {
    it("owner receives unmasked syncSecret via RPC", async () => {
      const outcome = await invokeRpc(ownerActor, "sync", "getConfig", []);
      expect(outcome.status).toBe(200);
      expect(outcome.body.ok).toBe(true);
      if (outcome.body.ok) {
        const config = outcome.body.result as { syncSecret: string; branchId: string };
        expect(config.branchId).toBe("main");
        expect(config.syncSecret).toBeTruthy();
        expect(config.syncSecret).not.toBe("********");
      }
    });

    it("manager receives masked syncSecret (********) via RPC", async () => {
      const outcome = await invokeRpc(managerActor, "sync", "getConfig", []);
      expect(outcome.status).toBe(200);
      expect(outcome.body.ok).toBe(true);
      if (outcome.body.ok) {
        const config = outcome.body.result as { syncSecret: string };
        expect(config.syncSecret).toBe("********");
      }
    });

    it("receptionist without settings.view is rejected with 403 on sync.getConfig", async () => {
      const outcome = await invokeRpc(receptionistActor, "sync", "getConfig", []);
      expect(outcome.status).toBe(403);
      expect(outcome.body.ok).toBe(false);
    });

    it("validateSyncSecret uses constant-time hash comparison and rejects invalid secrets", () => {
      const db = contextModule.getDbContext().db;
      const currentSecret = getBranchConfig(db).syncSecret;
      expect(validateSyncSecret(db, currentSecret)).toBe(true);
      expect(validateSyncSecret(db, "wrong-secret")).toBe(false);
      expect(validateSyncSecret(db, currentSecret.slice(0, -1))).toBe(false); // one char shorter
      expect(validateSyncSecret(db, currentSecret + "x")).toBe(false); // one char longer
      expect(validateSyncSecret(db, "")).toBe(false);
      expect(validateSyncSecret(db, null)).toBe(false);
    });
  });

  describe("P3-003 Remediation: Member Portal Token Expiry and Integrity", () => {
    it("verifies valid token within TTL window", () => {
      const db = contextModule.getDbContext().db;
      const token = createPortalToken(db, "mem-123", "B1-MEM-000001");
      const verified = verifyPortalToken(db, token);
      expect(verified.memberId).toBe("mem-123");
      expect(verified.memberCode).toBe("B1-MEM-000001");
    });

    it("rejects expired portal token older than 30 days", () => {
      const db = contextModule.getDbContext().db;
      // Synthesize a token with timestamp from 31 days ago
      const expiredMs = Date.now() - (PORTAL_TOKEN_TTL_MS + 24 * 60 * 60 * 1000);
      const expiredTimestamp = expiredMs.toString(36);
      const raw = `mem-123:B1-MEM-000001:${expiredTimestamp}`;
      const { createHmac } = require("node:crypto");
      const secret = "gymgate_member_portal_token_secret_2026";
      const sig = createHmac("sha256", secret).update(raw).digest("base64url").slice(0, 24);
      const expiredToken = `mem-123.B1-MEM-000001.${expiredTimestamp}.${sig}`;

      expect(() => verifyPortalToken(db, expiredToken)).toThrow();
    });

    it("rejects token with future timestamp", () => {
      const db = contextModule.getDbContext().db;
      const futureMs = Date.now() + 2 * 60 * 60 * 1000;
      const futureTimestamp = futureMs.toString(36);
      const raw = `mem-123:B1-MEM-000001:${futureTimestamp}`;
      const { createHmac } = require("node:crypto");
      const secret = "gymgate_member_portal_token_secret_2026";
      const sig = createHmac("sha256", secret).update(raw).digest("base64url").slice(0, 24);
      const futureToken = `mem-123.B1-MEM-000001.${futureTimestamp}.${sig}`;

      expect(() => verifyPortalToken(db, futureToken)).toThrow();
    });
  });

  describe("P3-005 Remediation: Developer Privilege strictly DB-backed", () => {
    it("rejects user named 'kotb' if is_developer flag is false", () => {
      const fakeKotbActor: ServiceActor = {
        userId: "user-kotb-fake",
        username: "kotb",
        roleId: "reception",
        department: "general",
        isDeveloper: false,
      };
      expect(isDeveloperActor(fakeKotbActor)).toBe(false);
    });

    it("grants developer privilege strictly when isDeveloper flag is true", () => {
      const realDevActor: ServiceActor = {
        userId: "dev-kotb-real",
        username: "any_developer_name",
        roleId: "owner",
        department: "general",
        isDeveloper: true,
      };
      expect(isDeveloperActor(realDevActor)).toBe(true);
    });
  });

  describe("Trainer Attendance RPC Surface Hardening", () => {
    it("denies unprivileged trainer from listing trainer attendance without trainer_attendance.view", async () => {
      const outcome = await invokeRpc(trainerActor, "trainerAttendance", "list", []);
      expect(outcome.status).toBe(403);
    });

    it("allows owner to list trainer attendance", async () => {
      const outcome = await invokeRpc(ownerActor, "trainerAttendance", "list", []);
      expect(outcome.status).toBe(200);
      expect(outcome.body.ok).toBe(true);
    });
  });
});
