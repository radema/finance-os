import { describe, expect, it } from "vitest";
import { FIXTURE_MONTHS, monthlySample } from "./monthlyFixture.ts";

describe("monthlySample", () => {
  const data = monthlySample();

  it("has a close for every product in each of the 60 months", () => {
    for (const { id } of data.products) {
      const months = data.prices.filter((price) => price.productId === id).map((p) => p.month);
      expect(months).toHaveLength(FIXTURE_MONTHS);
      expect(new Set(months).size).toBe(FIXTURE_MONTHS);
    }
    expect(data.prices.at(-1)?.month).toBe("2026-10");
  });

  it("has ledger rows in every month of every goal, from the first month to the last", () => {
    const months = new Set(data.ledger.map((row) => row.date.slice(0, 7)));
    expect(months.size).toBe(FIXTURE_MONTHS);
    expect(data.ledger.length).toBeGreaterThan(200);
  });

  it("keeps the synthetic names and ISINs of the sample", () => {
    for (const product of data.products) {
      expect(product.name.startsWith("Sample ")).toBe(true);
      expect(product.isin === "" || product.isin.startsWith("ZZ")).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(monthlySample()).toEqual(data);
  });
});
