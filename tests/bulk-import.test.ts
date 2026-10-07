import { beforeEach, describe, expect, it } from "vitest";
import { buildActor, setup } from "@/core/services/auth.service";
import { createPlan } from "@/core/services/plans.service";
import { bulkImportMembers } from "@/core/services/bulk-import.service";
import { getMemberRowById } from "@/core/services/members.service";
import { parseCsv } from "@/utils/csv-helper";
import type { Db } from "@/db/engine";
import { createTestDb } from "./helpers/test-db";

let db: Db;
let owner: ReturnType<typeof buildActor>;

beforeEach(async () => {
  db = createTestDb();
  const ownerUser = await setup(db, {
    gymName: "Yassen Mohamed Kotb | 01288536381",
    ownerFullName: "المالك",
    username: "owner",
    password: "Owner@2026",
  });
  owner = buildActor(ownerUser);
});

describe("bulkImportMembers service & CSV helper", () => {
  it("parses CSV lines correctly with quotes and commas", () => {
    const csv = `الاسم,الهاتف,النوع\r\n"أحمد محمد, كابتن",01012345678,ذكر\r\nمحمود علي,01111111111,ذكر`;
    const rows = parseCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[1][0]).toBe("أحمد محمد, كابتن");
    expect(rows[1][1]).toBe("01012345678");
    expect(rows[2][0]).toBe("محمود علي");
  });

  it("normalizes day/month/year format (DD/MM/YYYY) to standard ISO YYYY-MM-DD", async () => {
    const { normalizeDateInput } = await import("@/utils/csv-helper");
    expect(normalizeDateInput("15/05/1995")).toBe("1995-05-15");
    expect(normalizeDateInput("1-10-2026")).toBe("2026-10-01");
    expect(normalizeDateInput("2026-10-05")).toBe("2026-10-05");
  });

  it("imports members successfully and auto-creates their virtual cards", async () => {
    await createPlan(db, owner, { name: "شهري", durationDays: 30, price: 300 });

    const result = await bulkImportMembers(db, owner, [
      {
        fullName: "عضو جديد 1",
        phone: "01011112222",
        gender: "male",
        department: "general",
        planName: "شهري",
        subscriptionStartDate: "2026-10-01",
        paidAmount: 300,
      },
      {
        fullName: "عضو جديد 2",
        phone: "01033334444",
        gender: "male",
        department: "men",
      },
    ]);

    expect(result.totalProcessed).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.skippedCount).toBe(0);

    // Verify virtual card creation
    const card = db.first<{ id: string; barcode_value: string; kind: string }>(
      "SELECT c.* FROM cards c JOIN members m ON m.id = c.member_id WHERE m.phone = '01011112222'",
    );
    expect(card).toBeDefined();
    expect(card?.kind).toBe("virtual");

    // Verify subscription was linked
    const sub = db.first<{ id: string; price: number; status: string }>(
      "SELECT s.* FROM member_subscriptions s JOIN members m ON m.id = s.member_id WHERE m.phone = '01011112222'",
    );
    expect(sub).toBeDefined();
    expect(sub?.price).toBe(300);
    expect(sub?.status).toBe("active");
  });

  it("skips duplicate phone or member names gracefully without stopping", async () => {
    // Insert initial
    await bulkImportMembers(db, owner, [
      { fullName: "عضو متكرر", phone: "01099998888" },
    ]);

    // Import again with same phone
    const secondResult = await bulkImportMembers(db, owner, [
      { fullName: "عضو متكرر", phone: "01099998888" },
      { fullName: "عضو مميز آخر", phone: "01077776666" },
    ]);

    expect(secondResult.successCount).toBe(1);
    expect(secondResult.skippedCount).toBe(1);
    expect(secondResult.results[0].status).toBe("skipped");
    expect(secondResult.results[1].status).toBe("success");
  });

  it("handles validation errors per row without rolling back other successful rows", async () => {
    const result = await bulkImportMembers(db, owner, [
      { fullName: "", phone: "01012345678" }, // invalid name
      { fullName: "عضو سليم", phone: "01088887777" },
    ]);

    expect(result.errorCount).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.results[0].status).toBe("error");
    expect(result.results[1].status).toBe("success");
  });
});
