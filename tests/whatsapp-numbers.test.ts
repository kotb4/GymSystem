import { describe, expect, it } from "vitest";
import { normalizeEgyNumber } from "../whatsapp-gateway/numbers.js";

describe("normalizeEgyNumber (gateway shared)", () => {
  it("accepts common Egyptian mobile formats", () => {
    expect(normalizeEgyNumber("01012345678")).toBe("201012345678");
    expect(normalizeEgyNumber("01112345678")).toBe("201112345678");
    expect(normalizeEgyNumber("01212345678")).toBe("201212345678");
    expect(normalizeEgyNumber("01512345678")).toBe("201512345678");
    expect(normalizeEgyNumber("+201012345678")).toBe("201012345678");
    expect(normalizeEgyNumber("00201112345678")).toBe("201112345678");
    expect(normalizeEgyNumber("201212345678")).toBe("201212345678");
    expect(normalizeEgyNumber("1012345678")).toBe("201012345678");
  });

  it("strips formatting and whitespace", () => {
    expect(normalizeEgyNumber("010 1234 5678")).toBe("201012345678");
    expect(normalizeEgyNumber("012-123-456-78")).toBe("201212345678");
    expect(normalizeEgyNumber(" 0111-111-2222 ")).toBe("201111112222");
    expect(normalizeEgyNumber("+2 (010) 1234-5678")).toBe("201012345678");
  });

  it("rejects landlines and invalid numbers", () => {
    expect(normalizeEgyNumber("0223456789")).toBeNull();
    expect(normalizeEgyNumber("023456789")).toBeNull();
    expect(normalizeEgyNumber("1600000000")).toBeNull();
    expect(normalizeEgyNumber("1300000000")).toBeNull();
    expect(normalizeEgyNumber("9999999999")).toBeNull();
    expect(normalizeEgyNumber("12345")).toBeNull();
    expect(normalizeEgyNumber("123456789")).toBeNull();
    expect(normalizeEgyNumber("")).toBeNull();
    expect(normalizeEgyNumber("abc")).toBeNull();
    expect(normalizeEgyNumber(null)).toBeNull();
  });

  it("does not double-prefix an already-country-coded mobile", () => {
    expect(normalizeEgyNumber("201012345678")).toBe("201012345678");
    expect(normalizeEgyNumber("2010112345678")).toBeNull();
  });
});