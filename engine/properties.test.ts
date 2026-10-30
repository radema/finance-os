import fc from "fast-check";
import { describe, it } from "vitest";
import { normaliseWeights, type ProductParams, projectGoal } from "./projection.ts";

const regimes = ["etf", "direct", "govt", "cash", "pension"] as const;

const productArb = fc.record({
  regime: fc.constantFrom(...regimes),
  mu: fc.double({ min: -0.05, max: 0.1, noNaN: true }),
  ter: fc.double({ min: 0, max: 0.03, noNaN: true }),
  couponRate: fc.double({ min: 0, max: 0.05, noNaN: true }),
  whiteListShare: fc.double({ min: 0, max: 1, noNaN: true }),
  value: fc.double({ min: 0, max: 50_000, noNaN: true }),
  basisRatio: fc.double({ min: 0, max: 2, noNaN: true }),
  weight: fc.double({ min: 0, max: 10, noNaN: true }),
});

describe("properties (AC-20)", () => {
  it("net is non-decreasing in the monthly contribution", () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 1, maxLength: 4 }),
        fc.double({ min: 0, max: 2_000, noNaN: true }),
        fc.double({ min: 0, max: 2_000, noNaN: true }),
        fc.integer({ min: 2026, max: 2040 }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 5_000, noNaN: true }), { nil: undefined }),
        (items, monthly, extra, targetYear, contributionGrowth, zainettoAmount) => {
          const products = new Map<string, ProductParams>();
          const weights = new Map<string, number>();
          const positions = items.map((item, i) => {
            const productId = `p${i}`;
            products.set(productId, item);
            weights.set(productId, item.weight);
            return { productId, value: item.value, basis: item.value * item.basisRatio };
          });
          const run = (m: number) =>
            projectGoal({
              asOf: "2026-04-15",
              goal: { id: "g", targetYear, target: 0, contributionGrowth },
              monthly: m,
              positions,
              products,
              weights,
              settings: {
                inflation: 0.02,
                bollo: 0.002,
                taxStd: 0.26,
                taxGovt: 0.125,
                pensionTax: 0.2,
                zainetto:
                  zainettoAmount === undefined
                    ? undefined
                    : { amount: zainettoAmount, expiry: "2045", goalId: "g" },
              },
              firstYear: 2010,
            }).net;
          const low = run(monthly);
          const high = run(monthly + extra);
          return high >= low - 1e-6 * Math.max(1, Math.abs(low));
        },
      ),
    );
  });

  it("normalised weights sum to 1", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 10 })
          .filter((ws) => ws.reduce((a, b) => a + b, 0) > 0),
        (ws) => {
          const shares = normaliseWeights(new Map(ws.map((w, i) => [`p${i}`, w])));
          const sum = [...shares.values()].reduce((a, b) => a + b, 0);
          return Math.abs(sum - 1) < 1e-9;
        },
      ),
    );
  });
});
