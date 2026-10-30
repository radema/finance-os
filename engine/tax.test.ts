import { describe, expect, it } from "vitest";
import { type LiquidationContext, liquidate, pensionExitRate } from "./tax.ts";

const context: LiquidationContext = {
  goalDate: "2030-12-31",
  goalId: "g",
  taxStd: 0.26,
  taxGovt: 0.125,
};

describe("liquidate", () => {
  it("taxes an ETF gain of 2,000 at 26% (AC-13)", () => {
    const r = liquidate([{ regime: "etf", value: 12_000, basis: 10_000 }], context);
    expect(r.gross).toBe(12_000);
    expect(r.tax).toBeCloseTo(520, 9);
    expect(r.net).toBeCloseTo(11_480, 9);
  });

  it("lowers the ETF rate with the white-list share (AC-13)", () => {
    const r = liquidate(
      [{ regime: "etf", value: 12_000, basis: 10_000, whiteListShare: 1 }],
      context,
    );
    expect(r.tax).toBeCloseTo(2_000 * 0.125, 9);
  });

  it("offsets the govt tax with an ETF loss credit (AC-13)", () => {
    const r = liquidate(
      [
        { regime: "etf", value: 9_000, basis: 10_000 },
        { regime: "govt", value: 14_000, basis: 10_000 },
      ],
      context,
    );
    expect(r.tax).toBeCloseTo(240, 9);
    expect(r.net).toBeCloseTo(23_000 - 240, 9);
  });

  it("does not offset an ETF gain with credits (AC-13)", () => {
    const r = liquidate(
      [
        { regime: "etf", value: 12_000, basis: 10_000 },
        { regime: "direct", value: 9_000, basis: 10_000 },
      ],
      context,
    );
    expect(r.tax).toBeCloseTo(520, 9);
  });

  it("offsets direct gains with a govt loss, in tax euros, and loses unused credit (AC-13)", () => {
    const r = liquidate(
      [
        { regime: "direct", value: 11_000, basis: 10_000 },
        { regime: "govt", value: 5_000, basis: 10_000 },
      ],
      context,
    );
    // direct tax 260, govt loss credit 625: tax floors at 0.
    expect(r.tax).toBe(0);
  });

  it.each([
    { expiry: "2030-12-31", tax: 240 },
    { expiry: "2031-06-30", tax: 240 },
    { expiry: "2031", tax: 240 },
    { expiry: "2030-12-30", tax: 500 },
    { expiry: "2029", tax: 500 },
  ])("zainetto expiring $expiry gives tax $tax (AC-13)", ({ expiry, tax }) => {
    const r = liquidate([{ regime: "govt", value: 14_000, basis: 10_000 }], {
      ...context,
      zainetto: { amount: 1_000, expiry, goalId: "g" },
    });
    expect(r.tax).toBeCloseTo(tax, 9);
  });

  it("ignores a zainetto assigned to another goal (AC-13)", () => {
    const r = liquidate([{ regime: "govt", value: 14_000, basis: 10_000 }], {
      ...context,
      zainetto: { amount: 1_000, expiry: "2035", goalId: "other" },
    });
    expect(r.tax).toBeCloseTo(500, 9);
  });

  it("charges no tax on a deposit account (AC-13)", () => {
    const r = liquidate([{ regime: "cash", value: 5_000, basis: 1_000 }], context);
    expect(r).toEqual({ gross: 5_000, tax: 0, net: 5_000 });
  });

  it("charges the exit rate on the basis of a pension fund (AC-13)", () => {
    const r = liquidate([{ regime: "pension", value: 15_000, basis: 10_000 }], {
      ...context,
      firstYear: 2020,
    });
    expect(r.tax).toBeCloseTo(1_500, 9);
    expect(r.net).toBeCloseTo(13_500, 9);
  });

  it("throws for a pension position with no firstYear", () => {
    expect(() => liquidate([{ regime: "pension", value: 1, basis: 1 }], context)).toThrow();
  });
});

describe("pensionExitRate", () => {
  it.each([
    { years: 10, rate: 0.15 },
    { years: 15, rate: 0.15 },
    { years: 20, rate: 0.135 },
    { years: 35, rate: 0.09 },
    { years: 50, rate: 0.09 },
  ])("is $rate at $years years of membership (AC-13)", ({ years, rate }) => {
    expect(pensionExitRate(2030, 2030 - years)).toBeCloseTo(rate, 12);
  });
});
