import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MonteCarloGoal, MonteCarloProduct } from "./monteCarlo.ts";
import { runMonteCarlo } from "./monteCarlo.ts";
import { type ProjectionInput, projectGoal } from "./projection.ts";
import { requiredContribution } from "./requiredContribution.ts";
import { pensionPlanSchema } from "./schemas.ts";

// No tax, no inflation, no growth: a goal's net is the money put in, so the answer is known by hand.
const flat = { inflation: 0, bollo: 0, taxStd: 0, taxGovt: 0, pensionTax: 0 };
const TOLERANCE = 0.01;

function plain(over: Partial<ProjectionInput> = {}, target = 12_000): ProjectionInput {
  return {
    // r = 0: the 2027 goal year is the only step, 12 months of the monthly amount.
    asOf: "2026-12-31",
    goal: { id: "g", targetYear: 2027, target, contributionGrowth: 0 },
    monthly: 100,
    positions: [],
    products: new Map([["p", { regime: "etf", mu: 0, ter: 0 }]]),
    weights: new Map([["p", 1]]),
    settings: flat,
    ...over,
  };
}

describe("requiredContribution, deterministic (AC-57)", () => {
  it("solves the monthly amount that reaches the target", () => {
    // 12 months x X = 30,000 gives X = 2,500.
    const result = requiredContribution(plain({}, 30_000), "deterministic");
    expect(result).toBeGreaterThanOrEqual(2_500);
    expect(result).toBeLessThanOrEqual(2_500 + TOLERANCE);
  });

  it("returns 0 when the goal is met without any contribution", () => {
    const met = plain({ positions: [{ productId: "p", value: 13_000, basis: 13_000 }] });
    expect(requiredContribution(met, "deterministic")).toBe(0);
  });

  it("solves a goal that needs the largest bracket: 12 doublings of the start", () => {
    // The start is the current monthly, 100; 12 doublings reach 409,600. 12 x 400,000 is inside.
    const result = requiredContribution(plain({}, 12 * 400_000), "deterministic");
    expect(result).toBeGreaterThanOrEqual(400_000);
    expect(result).toBeLessThanOrEqual(400_000 + TOLERANCE);
  });

  it("returns null after 12 doublings when the goal is not reachable", () => {
    expect(requiredContribution(plain({}, 12 * 410_000), "deterministic")).toBeNull();
  });

  it("starts from 100 when the current monthly is below it", () => {
    // 1 EUR a month would reach only 4,096 in 12 doublings; 300,000 needs the start of 100.
    const result = requiredContribution(plain({ monthly: 1 }, 12 * 300_000), "deterministic");
    expect(result).toBeGreaterThanOrEqual(300_000);
    expect(result).toBeLessThanOrEqual(300_000 + TOLERANCE);
  });

  it("starts from 100 when the current monthly is 0", () => {
    expect(
      requiredContribution(plain({ monthly: 0 }, 12 * 400_000), "deterministic"),
    ).not.toBeNull();
    expect(requiredContribution(plain({ monthly: 0 }, 12 * 410_000), "deterministic")).toBeNull();
  });

  describe("with no contribution step left", () => {
    // r = 0 and targetYear = Y0.
    const dueAtYearEnd = (value: number) =>
      plain({
        asOf: "2026-12-31",
        goal: { id: "g", targetYear: 2026, target: 1_000, contributionGrowth: 0 },
        positions: [{ productId: "p", value, basis: value }],
      });
    // tau = 0: due before Y0.
    const dueBefore = (value: number) =>
      plain({
        goal: { id: "g", targetYear: 2025, target: 1_000, contributionGrowth: 0 },
        positions: [{ productId: "p", value, basis: value }],
      });

    it("returns 0 when the goal is already met", () => {
      expect(requiredContribution(dueAtYearEnd(1_000), "deterministic")).toBe(0);
      expect(requiredContribution(dueBefore(1_000), "deterministic")).toBe(0);
    });

    it("returns null when the goal is not met", () => {
      expect(requiredContribution(dueAtYearEnd(999), "deterministic")).toBeNull();
      expect(requiredContribution(dueBefore(999), "deterministic")).toBeNull();
    });
  });

  it("solves a goal due this year normally when r > 0", () => {
    // asOf 30 April: r = 8 months left. 8 x X = 4,000 gives X = 500.
    const thisYear = plain({
      asOf: "2026-04-30",
      goal: { id: "g", targetYear: 2026, target: 4_000, contributionGrowth: 0 },
    });
    const result = requiredContribution(thisYear, "deterministic");
    expect(result).toBeGreaterThanOrEqual(500);
    expect(result).toBeLessThanOrEqual(500 + TOLERANCE);
  });

  it("solves a multiplier of the schedule for the pension goal", () => {
    // RAL 40,000 flat, TFR 6.91%, worker 1%, employer 2%, voluntary 1,000: 4,964 a year. To 2040 the
    // net at multiplier 1 is 60,114.04 (projection.test.ts). Twice that needs a multiplier of 2.
    const pension: ProjectionInput = plain({
      goal: { id: "g", targetYear: 2040, target: 2 * 60_114.04, contributionGrowth: 0 },
      products: new Map([["p", { regime: "pension", mu: 0, ter: 0 }]]),
      firstYear: 2020,
      pension: {
        plan: pensionPlanSchema.parse({
          goalId: "g",
          firstYear: 2020,
          ral: 4_000_000,
          tfrPct: 0.0691,
          workerPct: 0.01,
          employerPct: 0.02,
          voluntary: 100_000,
          flows: [
            { productId: "p", flow: "Work", pct: 1 },
            { productId: "p", flow: "Voluntary", pct: 1 },
          ],
        }),
        deductionCapCents: 530_000,
        voluntaryYtd: 0,
      },
    });
    const result = requiredContribution(pension, "deterministic") as number;
    expect(result).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(result).toBeLessThanOrEqual(2 + 1e-4);
  });

  it("reaches the target at the returned amount and not a cent below (property)", () => {
    let solved = 0;
    let pushed = 0;
    fc.assert(
      fc.property(
        fc.record({
          regime: fc.constantFrom("etf", "direct", "govt", "cash"),
          mu: fc.double({ min: -0.02, max: 0.1, noNaN: true }),
          ter: fc.double({ min: 0, max: 0.02, noNaN: true }),
        }),
        fc.double({ min: 0, max: 50_000, noNaN: true }),
        fc.double({ min: 20_000, max: 150_000, noNaN: true }),
        fc.integer({ min: 2026, max: 2045 }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.constantFrom("2026-01-15", "2026-10-31", "2026-12-31"),
        (params, value, target, targetYear, contributionGrowth, asOf) => {
          const base: ProjectionInput = {
            asOf,
            goal: { id: "g", targetYear, target, contributionGrowth },
            monthly: 300,
            positions: [{ productId: "p", value, basis: value * 0.8 }],
            products: new Map([["p", params]]),
            weights: new Map([["p", 1]]),
            settings: {
              inflation: 0.02,
              bollo: 0.002,
              taxStd: 0.26,
              taxGovt: 0.125,
              pensionTax: 0.2,
            },
          };
          const reaches = (monthly: number) => {
            const { net, targetAtGoalDate } = projectGoal({ ...base, monthly });
            return net >= targetAtGoalDate;
          };
          const result = requiredContribution(base, "deterministic");
          if (result === null) return;
          solved++;
          expect(reaches(result)).toBe(true);
          if (result > TOLERANCE) {
            pushed++;
            expect(reaches(result - TOLERANCE)).toBe(false);
          }
        },
      ),
    );
    // The property must not pass by returning null: most cases are solved, many need a contribution.
    expect(solved).toBeGreaterThan(50);
    expect(pushed).toBeGreaterThan(20);
  });
});

describe("requiredContribution, probability (AC-57)", () => {
  const settings = { inflation: 0.02, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 };
  const identity = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => (i === j ? 1 : 0)));
  const equity: MonteCarloProduct = {
    regime: "etf",
    mu: 0.06,
    ter: 0.002,
    sigma: 0.15,
    assetClass: "Equity",
  };
  const goal = (over: Partial<MonteCarloGoal> = {}): MonteCarloGoal => ({
    asOf: "2026-10-31",
    goal: { id: "g", targetYear: 2030, target: 20_000, contributionGrowth: 0.02 },
    monthly: 200,
    positions: [{ productId: "p", value: 5_000, basis: 4_000 }],
    products: new Map([["p", equity]]),
    weights: new Map([["p", 1]]),
    settings,
    ...over,
  });
  const options = { requiredP: 0.75, correlations: identity, seed: 42, paths: 300 };
  const pSuccess = (monthly: number) =>
    runMonteCarlo({ goals: [goal({ monthly })], correlations: identity }, 42, 300).goals[0]
      ?.pSuccess as number;

  it("reaches the required probability at the returned amount and not a cent below", () => {
    const result = requiredContribution(goal(), "probability", options) as number;
    expect(result).toBeGreaterThan(0);
    expect(pSuccess(result)).toBeGreaterThanOrEqual(0.75);
    expect(pSuccess(result - TOLERANCE)).toBeLessThan(0.75);
  });

  it("needs at least as much for a higher required probability", () => {
    const low = requiredContribution(goal(), "probability", options) as number;
    const high = requiredContribution(goal(), "probability", { ...options, requiredP: 0.9 });
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("gives the deterministic answer when every volatility is 0", () => {
    const calm = goal({ products: new Map([["p", { ...equity, sigma: 0 }]]) });
    expect(requiredContribution(calm, "probability", options)).toBe(
      requiredContribution(calm, "deterministic"),
    );
  });

  it("returns null when the goal is not reachable", () => {
    expect(
      requiredContribution(
        goal({ goal: { id: "g", targetYear: 2030, target: 1e12, contributionGrowth: 0 } }),
        "probability",
        { ...options, paths: 50 },
      ),
    ).toBeNull();
  });

  it("returns 0 or null with no contribution step left, by P", () => {
    const due = (target: number) =>
      goal({
        asOf: "2026-12-31",
        goal: { id: "g", targetYear: 2026, target, contributionGrowth: 0 },
        products: new Map([["p", { ...equity, sigma: 0 }]]),
      });
    expect(requiredContribution(due(1_000), "probability", options)).toBe(0);
    expect(requiredContribution(due(1e6), "probability", options)).toBeNull();
  });

  it("throws when the options are missing", () => {
    // @ts-expect-error the types require the options; a caller that skips the types gets an error.
    expect(() => requiredContribution(goal(), "probability")).toThrow();
  });
});
