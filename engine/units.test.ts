import { describe, expect, it } from "vitest";
import { fromCents, fromScaled, toCents, toScaled } from "./units.ts";

describe("cents", () => {
  it("converts euros to integer cents and back", () => {
    expect(toCents(1002.95)).toBe(100295);
    expect(fromCents(100295)).toBe(1002.95);
  });

  it("rounds half away from zero, so a negative amount mirrors a positive one", () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
  });
});

describe("scaled integers", () => {
  it("converts units and prices with six decimals and back", () => {
    expect(toScaled(10.123456)).toBe(10_123_456);
    expect(fromScaled(10_123_456)).toBe(10.123456);
  });

  it("keeps the sign of a sold quantity", () => {
    expect(toScaled(-5)).toBe(-5_000_000);
    expect(toScaled(-0.0000005)).toBe(-1);
  });
});
