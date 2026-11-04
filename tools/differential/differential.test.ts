import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  mockCashFlow,
  mockNet,
  mockPlanVsActual,
  trackingStartOf,
  v1CashFlow,
  v1Net,
  v1PlanVsActual,
} from "./harness.ts";
import { cashFlowScenarioArb, type Scenario, scenarioArb } from "./scenario.ts";

const TOLERANCE_EUR = 0.01;

/**
 * Differential test of v1 against the copied mock engine (AC-18).
 *
 * The domain is where the two must agree: asOf in December (r = 0), commissions 0, couponRate 0,
 * contributionGrowth 0, the plain monthly contribution. The cash flow adds ralGrowth 0 and a pension
 * goal with one flow, and compares the rows from year Y0 + 2: the refund of Y0 depends on the
 * voluntary YTD, which only v1 reads. The listed differences M2, E9, S1, S2, S5, the growth exponent
 * of the first full year and plan versions lie outside it. The pension refund after the pension goal
 * ends (AC-96) is a listed difference: the mock rows are adjusted in the harness. Plan vs actual (#54) adds a `describe`
 * here with its own comparison on the same scenarios.
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

  describe("cash flow: rows from year Y0 + 2", () => {
    it("agrees within 0.01 euro on the agreed domain", () => {
      fc.assert(
        fc.property(scenarioArb, cashFlowScenarioArb, (scenario, cf) => {
          const mock = mockCashFlow(scenario, cf);
          const v1 = v1CashFlow(scenario, cf);
          expect(v1).toHaveLength(mock.length);
          for (const [index, row] of v1.entries()) {
            if (index < 2) continue;
            const expected = mock[index];
            expect(row.year).toBe(expected?.year);
            for (const key of [
              "income",
              "expenses",
              "events",
              "refund",
              "capacity",
              "planned",
            ] as const) {
              expect(
                Math.abs(row[key] / 100 - (expected?.[key] ?? Number.NaN)),
              ).toBeLessThanOrEqual(TOLERANCE_EUR);
            }
            expect(Math.abs(row.gap / 100 - (expected?.free ?? Number.NaN))).toBeLessThanOrEqual(
              TOLERANCE_EUR,
            );
          }
        }),
        { numRuns: 1_000 },
      );
    });
  });

  describe("plan vs actual: cumulative planned, actual and gap per goal", () => {
    it("agrees within 0.01 euro on buy-only ledgers", () => {
      fc.assert(
        fc.property(scenarioArb, fc.integer({ min: 0, max: 48 }), (scenario, monthsBack) => {
          const buyOnly = { ...scenario, ledger: scenario.ledger.filter((r) => r.type !== "sell") };
          const trackingStart = trackingStartOf(buyOnly, monthsBack);
          const mock = mockPlanVsActual(buyOnly, trackingStart);
          const v1 = v1PlanVsActual(buyOnly, trackingStart);
          expect([...v1.keys()]).toEqual([...mock.keys()]);
          for (const [goalId, totals] of v1) {
            const expected = mock.get(goalId);
            for (const key of ["planned", "actual", "gap"] as const) {
              expect(Math.abs(totals[key] - (expected?.[key] ?? Number.NaN))).toBeLessThanOrEqual(
                TOLERANCE_EUR,
              );
            }
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

    it("has plan vs actual with money put in, and rows before the tracking start", () => {
      const totals = (s: Scenario) => v1PlanVsActual(s, trackingStartOf(s, 12));
      const put = sample.some((s) => [...totals(s).values()].some((t) => t.actual > 0));
      expect(put).toBe(true);
      const before = sample.some((s) =>
        s.ledger.some((row) => row.type === "buy" && row.date.slice(0, 7) < trackingStartOf(s, 12)),
      );
      expect(before).toBe(true);
    });

    it("has sells in the ledger", () => {
      expect(sample.some((s) => s.ledger.some((row) => row.type === "sell"))).toBe(true);
    });
  });
});
