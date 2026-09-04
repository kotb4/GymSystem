import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/core/auth/password";
import {
  addDaysKey,
  calcSubscriptionEndDate,
  diffDaysKeys,
  isValidDateKey,
  nowStamp,
} from "@/core/dates";
import { createTestDb } from "./helpers/test-db";

describe("database bootstrap", () => {
  it("runs migrations and creates base tables", () => {
    const db = createTestDb();
    expect(db.count("SELECT COUNT(*) FROM roles")).toBe(4);
    expect(db.count("SELECT COUNT(*) FROM permissions")).toBeGreaterThan(20);
    expect(db.count("SELECT COUNT(*) FROM role_permissions")).toBeGreaterThan(20);
    expect(db.scalar("SELECT value FROM counters WHERE name = 'card_barcode'")).toBe(100);
    expect(db.count("SELECT COUNT(*) FROM schema_migrations")).toBe(29);
    expect(db.count("SELECT COUNT(*) FROM payment_methods")).toBeGreaterThan(0);
    expect(db.count("SELECT COUNT(*) FROM trainers")).toBe(0);
    expect(db.count("SELECT COUNT(*) FROM training_plans")).toBe(0);
    expect(db.count("SELECT COUNT(*) FROM backups_log")).toBe(0);
    expect(db.count("SELECT COUNT(*) FROM license_activation")).toBe(0);
  });

  it("rolls back failed transactions", async () => {
    const db = createTestDb();
    await expect(
      db.transaction(async () => {
        db.run("INSERT INTO settings (key, value) VALUES ('a', '1')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(db.count("SELECT COUNT(*) FROM settings WHERE key = 'a'")).toBe(0);
  });

  it("commits nested transactions exactly once", async () => {
    const db = createTestDb();
    await db.transaction(async () => {
      await db.transaction(() => {
        db.run("INSERT INTO settings (key, value) VALUES ('a', '1')");
      });
    });
    expect(db.count("SELECT COUNT(*) FROM settings WHERE key = 'a'")).toBe(1);
  });

  it("enforces foreign keys", () => {
    const db = createTestDb();
    expect(() =>
      db.run("INSERT INTO members (id, member_code, full_name, registration_date, created_at, updated_at)\nVALUES ('m1', 'MEM-000001', 'x', '2026-01-01', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"),
    ).not.toThrow();
    expect(() =>
      db.run(
        "INSERT INTO attendance (id, member_id, checkin_at) VALUES ('a1', 'missing-member', '2026-01-01 10:00:00')",
      ),
    ).toThrow();
  });
});

describe("password hashing", () => {
  it("verifies argon2id hashes", async () => {
    const hash = await hashPassword("gym123456");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("gym123456", hash)).toBe(true);
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });
});

describe("date utilities", () => {
  it("calculates inclusive subscription end dates", () => {
    expect(calcSubscriptionEndDate("2026-08-01", 30)).toBe("2026-08-30");
    expect(calcSubscriptionEndDate("2026-01-01", 365)).toBe("2026-12-31");
    expect(diffDaysKeys("2026-08-01", "2026-08-31")).toBe(30);
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(isValidDateKey("2026-02-29")).toBe(false);
    expect(isValidDateKey(nowStamp().slice(0, 10))).toBe(true);
  });
});
