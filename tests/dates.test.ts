import { describe, expect, it } from "vitest";
import {
  diffDaysKeys,
  safeDiffDaysKeys,
  safeParseDateKey,
  parseDateKey,
  addDaysKey,
  todayKey,
  dateKey,
} from "@/core/dates";

describe("parseDateKey / safeParseDateKey", () => {
  it("parses a valid YYYY-MM-DD key", () => {
    const d = parseDateKey("2026-02-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(15);
  });

  it("safeParseDateKey returns a Date for a valid key", () => {
    expect(safeParseDateKey("2026-01-31")).not.toBeNull();
  });

  it("safeParseDateKey returns null for null/undefined/empty/garbage", () => {
    expect(safeParseDateKey(null)).toBeNull();
    expect(safeParseDateKey(undefined)).toBeNull();
    expect(safeParseDateKey("")).toBeNull();
    expect(safeParseDateKey("not-a-date")).toBeNull();
    expect(safeParseDateKey("2026/01/01")).toBeNull();
    expect(safeParseDateKey("01-01-2026")).toBeNull();
    expect(safeParseDateKey("2026-1-1")).toBeNull();
    expect(safeParseDateKey("2026-1")).toBeNull();
    expect(safeParseDateKey("abc-de-fg")).toBeNull();
  });
});

describe("diffDaysKeys / safeDiffDaysKeys", () => {
  it("diffDaysKeys returns positive when toKey is after fromKey", () => {
    expect(diffDaysKeys("2026-01-01", "2026-01-11")).toBe(10);
    expect(diffDaysKeys("2026-01-01", "2026-02-01")).toBe(31);
  });

  it("diffDaysKeys returns 0 for same day", () => {
    expect(diffDaysKeys("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("safeDiffDaysKeys returns null when either key is invalid", () => {
    expect(safeDiffDaysKeys(null, "2026-01-01")).toBeNull();
    expect(safeDiffDaysKeys("2026-01-01", null)).toBeNull();
    expect(safeDiffDaysKeys("bad", "2026-01-01")).toBeNull();
  });

  it("safeDiffDaysKeys returns the diff for valid keys", () => {
    expect(safeDiffDaysKeys("2026-01-01", "2026-01-11")).toBe(10);
  });
});

describe("addDaysKey / todayKey / dateKey round-trip", () => {
  it("addDaysKey moves forward by days", () => {
    expect(addDaysKey("2026-01-30", 5)).toBe("2026-02-04");
  });

  it("dateKey formats a Date as YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("todayKey is a valid YYYY-MM-DD string", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
