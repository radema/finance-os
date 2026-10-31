import { describe, expect, it } from "vitest";
import { priceAge } from "./priceAge.ts";

const ASOF = "2026-03-15";
const price = (month: string, priceDate: string) => ({ month, priceDate });

describe("priceAge", () => {
  describe("provider product", () => {
    const provider = { priceSource: "provider" } as const;

    it("is old when the latest close is 8 days before today", () => {
      expect(priceAge(provider, [price("2026-03", "2026-03-07")], ASOF, 7).old).toBe(true);
    });

    it("is not old when the latest close is 7 days before today", () => {
      expect(priceAge(provider, [price("2026-03", "2026-03-08")], ASOF, 7).old).toBe(false);
    });

    it("reads the threshold from the argument", () => {
      const prices = [price("2026-03", "2026-03-07")];
      expect(priceAge(provider, prices, ASOF, 8).old).toBe(false);
      expect(priceAge(provider, prices, ASOF, 3).old).toBe(true);
    });

    it("uses the latest close, not the first one stored", () => {
      const prices = [price("2026-02", "2026-02-27"), price("2026-03", "2026-03-14")];
      expect(priceAge(provider, prices, ASOF, 7).old).toBe(false);
    });

    it("counts days across a month end", () => {
      expect(priceAge(provider, [price("2026-02", "2026-02-28")], "2026-03-08", 7).old).toBe(true);
      expect(priceAge(provider, [price("2026-02", "2026-02-28")], "2026-03-07", 7).old).toBe(false);
    });

    it("is not old when the close is dated after today", () => {
      expect(priceAge(provider, [price("2026-04", "2026-04-30")], ASOF, 7).old).toBe(false);
    });
  });

  describe.each(["manual", "csv"] as const)("%s product", (priceSource) => {
    const product = { priceSource };

    it("is not old with the previous month-end price present, however old its date", () => {
      expect(priceAge(product, [price("2026-02", "2026-02-01")], ASOF, 7).old).toBe(false);
    });

    it("is old when the previous month-end price is missing", () => {
      const prices = [price("2026-01", "2026-01-31"), price("2026-03", "2026-03-15")];
      expect(priceAge(product, prices, ASOF, 7).old).toBe(true);
    });

    it("takes the month before the clock month across a year end", () => {
      expect(priceAge(product, [price("2025-12", "2025-12-31")], "2026-01-10", 7).old).toBe(false);
      expect(priceAge(product, [price("2025-11", "2025-11-30")], "2026-01-10", 7).old).toBe(true);
    });
  });

  it("treats a product with no price as old, for every source", () => {
    for (const priceSource of ["provider", "manual", "csv"] as const) {
      const age = priceAge({ priceSource }, [], ASOF, 7);
      expect(age.old).toBe(true);
      expect(age.reason).toMatch(/no price/i);
    }
  });

  it("gives a reason for each verdict", () => {
    const old = priceAge({ priceSource: "provider" }, [price("2026-03", "2026-03-07")], ASOF, 7);
    expect(old.reason).toBe("Latest close is 8 days old; the limit is 7.");
    const current = priceAge({ priceSource: "manual" }, [price("2026-02", "2026-02-28")], ASOF, 7);
    expect(current.reason).toBe("The 2026-02 month-end price is stored.");
    const missing = priceAge({ priceSource: "csv" }, [price("2026-03", "2026-03-01")], ASOF, 7);
    expect(missing.reason).toBe("The 2026-02 month-end price is missing.");
  });
});
