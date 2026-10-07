import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setup, buildActor } from "@/core/services/auth.service";
import { createUser } from "@/core/services/users.service";
import { setRolePermissions } from "@/core/services/permissions.service";
import { createMember, getMember } from "@/core/services/members.service";
import { createPlan } from "@/core/services/plans.service";
import { createSubscription } from "@/core/services/subscriptions.service";
import { recordPayment } from "@/core/services/payments.service";
import { createExpense } from "@/core/services/expenses.service";
import { performCashClose } from "@/core/services/cash.service";
import { invokeRpc } from "../server/rpc";
import * as contextModule from "../server/context";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceActor } from "@/core/permissions";

describe("Test 7: Security & Privilege Boundary Penetration Test", () => {
  let tmpDataDir: string;
  let ownerActor: ServiceActor;
  let receptionistActor: ServiceActor;
  let trainerActor: ServiceActor;
  let menOnlyStaffActor: ServiceActor;
  let femaleMemberId: string;
  let testPlanId: string;

  beforeEach(async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), "gym-security-drill-"));
    process.env.GYMSYSTEM_DATA_DIR = tmpDataDir;

    const ctx = contextModule.openDatabase();
    const db = ctx.db;

    // 1. Setup system owner
    const ownerUser = await setup(db as never, {
      gymName: "Security Test Gym",
      ownerFullName: "Head Owner",
      username: "super_owner",
      password: "SuperSecretOwnerPass@2026",
    });
    ownerActor = buildActor(ownerUser);

    // 2. Create Receptionist user (limited privileges: members.create, members.read, attendance.read/create)
    const recepUser = await createUser(db, ownerActor, {
      username: "receptionist_john",
      password: "RecepUserPass@2026",
      fullName: "John Receptionist",
      roleId: "reception",
      department: "general",
    });
    receptionistActor = buildActor(recepUser);

    // 3. Create Trainer user (privileges: only trainers / classes / inbody)
    const trainerUser = await createUser(db, ownerActor, {
      username: "trainer_coach",
      password: "TrainerPass@2026",
      fullName: "Coach Mike",
      roleId: "trainer",
      department: "general",
    });
    trainerActor = buildActor(trainerUser);

    // 4. Create Men-Only Staff user (scoped strictly to department = 'men')
    const menStaffUser = await createUser(db, ownerActor, {
      username: "men_section_staff",
      password: "MenStaffPass@2026",
      fullName: "Men Desk Staff",
      roleId: "reception",
      department: "men",
    });
    menOnlyStaffActor = buildActor(menStaffUser);

    // 5. Seed initial data: A female member
    const femaleMember = await createMember(db, ownerActor, {
      fullName: "Fatima Al-Sayed",
      phone: "01000000099",
      gender: "female",
      department: "women",
    });
    femaleMemberId = femaleMember.id;

    // Seed a test plan
    const plan = await createPlan(db, ownerActor, {
      name: "Standard 30 Days",
      kind: "time",
      durationDays: 30,
      price: 1000,
    });
    testPlanId = plan.id;
  });

  afterEach(() => {
    contextModule.closeDatabase();
    if (tmpDataDir) {
      rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it("Penetration Vector 1: Privilege Escalation - Receptionist attempting to modify role permissions or promote users", async () => {
    console.log("\n=======================================================");
    console.log("⚡ TEST 7: PRIVILEGE BOUNDARY & PENETRATION DRILL");
    console.log("=======================================================");
    console.log("\n[Vector 1] Attempting privilege escalation by receptionist...");

    const { db } = contextModule.getDbContext();

    // Direct Service Call: Receptionist trying to grant 'permissions.manage' to receptionist role
    expect(() =>
      setRolePermissions(db, receptionistActor, "reception", ["permissions.manage", "finance.manage"]),
    ).toThrow();

    // RPC Layer Call: Receptionist invoking permissions.setRolePermissions over API
    const rpcOutcome = await invokeRpc(
      receptionistActor,
      "permissions",
      "setRolePermissions",
      ["reception", ["permissions.manage", "finance.manage"]],
    );
    expect(rpcOutcome.status).toBe(403);
    expect(rpcOutcome.body.ok).toBe(false);
    if (!rpcOutcome.body.ok) {
      expect(rpcOutcome.body.error.code).toBe("FORBIDDEN");
    }
    console.log("   ✓ Blocked RPC call to permissions.setRolePermissions with 403 FORBIDDEN");

    // RPC Layer Call: Receptionist trying to create a new Owner user
    const rpcUserCreate = await invokeRpc(
      receptionistActor,
      "users",
      "createUser",
      [{
        username: "hacked_owner",
        password: "HackedPassword@2026",
        fullName: "Hacked Admin",
        roleId: "owner",
      }],
    );
    expect(rpcUserCreate.status).toBe(403);
    expect(rpcUserCreate.body.ok).toBe(false);
    console.log("   ✓ Blocked unauthorized user creation / role escalation with 403 FORBIDDEN");
  });

  it("Penetration Vector 2: Financial Vault & Treasury Access - Trainer attempting cash close, creating expenses, and tampering with ledger", async () => {
    console.log("\n[Vector 2] Attempting treasury & expense tampering by non-financial role (Trainer)...");
    const { db } = contextModule.getDbContext();

    // Direct Service Call: Trainer attempting to register expense
    await expect(
      createExpense(db, trainerActor, {
        categoryId: "general",
        amountMinor: 50000,
        paidTo: "Fake Vendor",
        box: "gym",
      }),
    ).rejects.toThrow();

    // RPC Layer Call: Trainer attempting to close cash box
    const rpcCashClose = await invokeRpc(
      trainerActor,
      "cash",
      "closeCash",
      ["gym", 500000, "Forced cash close"],
    );
    expect(rpcCashClose.status).toBe(403);
    expect(rpcCashClose.body.ok).toBe(false);
    if (!rpcCashClose.body.ok) {
      expect(rpcCashClose.body.error.code).toBe("FORBIDDEN");
    }
    console.log("   ✓ Blocked trainer cash close attempt with 403 FORBIDDEN");

    // RPC Layer Call: Trainer attempting to record arbitrary payment
    const sub = await createSubscription(db, ownerActor, {
      memberId: femaleMemberId,
      planId: testPlanId,
      startDate: "2026-10-07",
    });

    const rpcPayment = await invokeRpc(
      trainerActor,
      "payments",
      "recordPayment",
      [{
        refType: "subscription",
        refId: sub.id,
        amountMinor: 100000,
        methodCode: "cash",
        box: "gym",
      }],
    );
    expect(rpcPayment.status).toBe(403);
    expect(rpcPayment.body.ok).toBe(false);
    console.log("   ✓ Blocked trainer payment receipt creation with 403 FORBIDDEN");
  });

  it("Penetration Vector 3: Department Isolation Boundary - Men-section receptionist attempting to access Women-section member records", async () => {
    console.log("\n[Vector 3] Attempting cross-department data access (Men staff accessing Women member)...");
    const { db } = contextModule.getDbContext();

    // Direct Service Call: Men desk staff attempting to view/get female member
    expect(() =>
      getMember(db, menOnlyStaffActor, femaleMemberId),
    ).toThrow();

    // RPC Layer Call: Men desk staff fetching female member via RPC
    const rpcGetMember = await invokeRpc(
      menOnlyStaffActor,
      "members",
      "getMember",
      [femaleMemberId],
    );
    expect(rpcGetMember.status).toBe(403);
    expect(rpcGetMember.body.ok).toBe(false);
    if (!rpcGetMember.body.ok) {
      expect(rpcGetMember.body.error.code).toBe("FORBIDDEN");
    }
    console.log("   ✓ Blocked cross-department data read with 403 FORBIDDEN");

    // RPC Layer Call: Men desk staff attempting to create subscription for female member
    const rpcCreateSub = await invokeRpc(
      menOnlyStaffActor,
      "subscriptions",
      "createSubscription",
      [{
        memberId: femaleMemberId,
        planId: testPlanId,
        startDate: "2026-10-07",
      }],
    );
    expect(rpcCreateSub.status).toBe(403);
    expect(rpcCreateSub.body.ok).toBe(false);
    console.log("   ✓ Blocked cross-department subscription creation with 403 FORBIDDEN");
  });

  it("Penetration Vector 4: RPC Whitelist Integrity & Injection Shield - Invoking non-existent, un-whitelisted, or arbitrary internal prototype functions", async () => {
    console.log("\n[Vector 4] Attempting arbitrary RPC function invocation & prototype injection...");

    // Attack A: Calling non-existent service
    const fakeServiceOutcome = await invokeRpc(
      ownerActor,
      "evil_service",
      "hackDatabase",
      [],
    );
    expect(fakeServiceOutcome.status).toBe(403);
    expect(fakeServiceOutcome.body.ok).toBe(false);
    console.log("   ✓ Blocked unregistered service invocation with 403 FORBIDDEN");

    // Attack B: Calling internal prototype methods like toString, constructor, __proto__
    const protoPollutionOutcome = await invokeRpc(
      ownerActor,
      "members",
      "__proto__",
      [],
    );
    expect(protoPollutionOutcome.status).toBe(403);
    expect(protoPollutionOutcome.body.ok).toBe(false);
    console.log("   ✓ Blocked prototype lookup exploitation with 403 FORBIDDEN");

    // Attack C: Calling dangerous unexposed function on a valid service
    const unexposedFnOutcome = await invokeRpc(
      ownerActor,
      "members",
      "internalPrivateHelper",
      [],
    );
    expect(unexposedFnOutcome.status).toBe(403);
    expect(unexposedFnOutcome.body.ok).toBe(false);
    console.log("   ✓ Blocked un-whitelisted function name with 403 FORBIDDEN");

    console.log("\n✓ ALL 4 SECURITY & PRIVILEGE BOUNDARY PENETRATION VECTORS SAFELY DEFENDED.");
    console.log("=======================================================\n");
  });
});
