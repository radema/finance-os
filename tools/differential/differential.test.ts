import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mockNet, v1Net } from "./harness.ts";
import { type Scenario, scenarioArb } from "./scenario.ts";

const TOLERANCE_EUR = 0.01;

/**
 * Differential test of v1 against the copied mock engine (AC-18).
 *
 * The domain is where the two must agree: asOf in December (r = 0), commissions 0, couponRate 0,
 * contributionGrowth 0, the plain monthly contribution (the pension schedule is S3). The listed
 * differences M2, E9, S1, S2, S5, the growth exponent of the first full year and plan versions lie
 * outside it. Cash flow (#42) and plan vs actual (#54) add a `describe` here with their own
 * comparison on the same scenarios.
 */
describe("mock differential (AC-18)", () => {
  describe("goal projection: deterministic net per goal", () => {
    it("agrees within 0.01 euro on the agreed domain", () => {
      fc.assert(
        fc.property(scenarioArb, (scenario) => {
          const mock = mockNet(scenario);
          const v1 = v1Net(scenario);
          expect([...v1.keys()]).toEqual([...mock.keys()]);
          for (const [goalId, net] of v1) {
            expect(Math.abs(net - (mock.get(goalId) ?? Number.NaN))).toBeLessThanOrEqual(
              TOLERANCE_EUR,
            );
          }
        }),
        { numRuns: 1_000 },
      );
    });
  });

  describe("known gaps: a goal due now", () => {
    // Both goals are due in 2023 and the asOf date is 2024-12-01, so they are liquidated at asOf.
    // The mock reads the goal year (targetYear); projectGoal reads the asOf date. The spec points
    // both ways (liquidated at asOf; exit rate and zainetto expiry by targetYear). Open: the user
    // decides. Each test pins both outputs; when the engines agree, replace it with the plain check.
    const base = {
      asOf: "2024-12-01",
      settings: { inflation: 0, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 },
      firstYear: 1990,
      goals: [{ id: "g0", targetYear: 2023, target: 0, monthly: 0, weights: { p0: 1 } }],
    };
    const opening = (price: number): Scenario["ledger"] => [
      { date: "2024-01-10", goalId: "g0", productId: "p0", type: "opening", qty: 1_000, price },
    ];

    it("pension exit rate: mock 9.6% (2023), v1 9.3% (2024)", () => {
      const scenario: Scenario = {
        ...base,
        products: [{ id: "p0", regime: "pension", mu: 0, ter: 0, whiteListShare: 0, price: 10 }],
        ledger: opening(10),
      };
      expect(mockNet(scenario).get("g0")).toBeCloseTo(9_040, 2);
      expect(v1Net(scenario).get("g0")).toBeCloseTo(9_070, 2);
    });

    it("zainetto expired on 2023-12-31: the mock applies it, v1 does not", () => {
      const scenario: Scenario = {
        ...base,
        zainetto: { amount: 1_000, expiryYear: 2023, goalId: "g0" },
        products: [{ id: "p0", regime: "direct", mu: 0, ter: 0, whiteListShare: 0, price: 12 }],
        ledger: opening(10),
      };
      expect(mockNet(scenario).get("g0")).toBeCloseTo(11_740, 2);
      expect(v1Net(scenario).get("g0")).toBeCloseTo(11_480, 2);
    });
  });

  describe("generator coverage", () => {
    const sample = fc.sample(scenarioArb, { numRuns: 500, seed: 1 });
    const dueNow = (s: Scenario) => s.goals.some((g) => g.targetYear < Number(s.asOf.slice(0, 4)));
    const dueLater = (s: Scenario) =>
      s.goals.some((g) => g.targetYear >= Number(s.asOf.slice(0, 4)));

    it.each(["etf", "direct", "govt", "cash", "pension"] as const)(
      "holds the %s regime with a weight",
      (regime) => {
        const hit = sample.some((s) =>
          s.goals.some((g) =>
            s.products.some((p) => p.regime === regime && (g.weights[p.id] ?? 0) > 0),
          ),
        );
        expect(hit).toBe(true);
      },
    );

    it("has goals due now and goals due later", () => {
      expect(sample.some(dueNow)).toBe(true);
      expect(sample.some(dueLater)).toBe(true);
    });

    it("has a zainetto that applies to a goal", () => {
      const applies = (s: Scenario) =>
        s.zainetto !== undefined &&
        s.zainetto.amount > 0 &&
        s.goals.some((g) => g.id === s.zainetto?.goalId && g.targetYear <= s.zainetto.expiryYear);
      expect(sample.some(applies)).toBe(true);
    });

    it("has sells in the ledger", () => {
      expect(sample.some((s) => s.ledger.some((row) => row.type === "sell"))).toBe(true);
    });
  });
});
