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
