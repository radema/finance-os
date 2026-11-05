import { describe, expect, it } from "vitest";
import { shrinkToPositiveDefinite } from "./correlation.ts";
import {
  lognormalParams,
  type MonteCarloGoal,
  type MonteCarloProduct,
  quantile,
  runMonteCarlo,
  simulatePaths,
} from "./monteCarlo.ts";
import { projectGoal } from "./projection.ts";

const settings = { inflation: 0.02, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 };
const noTax = { ...settings, taxStd: 0, taxGovt: 0 };
const IDENTITY = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => (i === j ? 1 : 0)));
// Order: Equity, Govt bonds, Corp bonds, Multi-asset, Cash, Gold/Commodities.
const SAMPLE = [
  [1, 0, 0.3, 0.85, 0, 0.1],
  [0, 1, 0.6, 0.4, 0, 0.2],
  [0.3, 0.6, 1, 0.55, 0, 0.1],
  [0.85, 0.4, 0.55, 1, 0, 0.15],
  [0, 0, 0, 0, 1, 0],
  [0.1, 0.2, 0.1, 0.15, 0, 1],
];
// Equity/Govt +0.9, Govt/Corp +0.9, Equity/Corp -0.9: not a possible set of correlations.
const IMPOSSIBLE = IDENTITY.map((row) => [...row]);
for (const [i, j, v] of [
  [0, 1, 0.9],
  [1, 2, 0.9],
  [0, 2, -0.9],
] as const) {
  (IMPOSSIBLE[i] as number[])[j] = v;
  (IMPOSSIBLE[j] as number[])[i] = v;
}

const equity: MonteCarloProduct = {
  regime: "etf",
  mu: 0.06,
  ter: 0.002,
  sigma: 0.15,
  assetClass: "Equity",
};

function goal(over: Partial<MonteCarloGoal> = {}): MonteCarloGoal {
  return {
    asOf: "2026-10-31",
    goal: { id: "g", targetYear: 2030, target: 20_000, contributionGrowth: 0.02 },
    monthly: 200,
    positions: [{ productId: "p", value: 5_000, basis: 4_000 }],
    products: new Map([["p", equity]]),
    weights: new Map([["p", 1]]),
    settings,
    ...over,
  };
}

const logs = (values: readonly number[], base: number) => values.map((v) => Math.log(v / base));
const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const variance = (v: readonly number[]) => {
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
};

describe("lognormalParams", () => {
  it("gives s = sqrt(ln(1 + sigma^2/(1+mu)^2)) and m = ln(1+mu) - s^2/2", () => {
    const { m, s } = lognormalParams(0.05, 0.2);
    expect(s).toBeCloseTo(Math.sqrt(Math.log(1 + 0.04 / 1.05 ** 2)), 12);
    expect(m).toBeCloseTo(Math.log(1.05) - s ** 2 / 2, 12);
  });

  it("gives s = 0 and m = ln(1+mu) when sigma is 0", () => {
    expect(lognormalParams(0.03, 0)).toEqual({ m: Math.log(1.03), s: 0 });
  });
});

describe("runMonteCarlo", () => {
  const inputs = { goals: [goal()], correlations: SAMPLE };

  it("gives identical outputs for the same seed and different ones for another seed (AC-52)", () => {
    const a = runMonteCarlo(inputs, 42, 300);
    expect(runMonteCarlo(inputs, 42, 300)).toEqual(a);
    expect(runMonteCarlo(inputs, 43, 300)).not.toEqual(a);
  });

  it("returns the sorted net of every path at the goal date, the sample the quantiles come from", () => {
    const [result] = runMonteCarlo(inputs, 42, 300).goals;
    const outcomes = result?.outcomes ?? [];
    expect(outcomes).toHaveLength(300);
    expect(outcomes).toEqual(outcomes.toSorted((a, b) => a - b));
    expect(quantile(outcomes, 0.5)).toBe(result?.p50.at(-1));
  });

  it("returns the median net equal to the deterministic net when sigma is 0 (AC-53)", () => {
    const products = new Map<string, MonteCarloProduct>([
      ["p", { ...equity, sigma: 0 }],
      [
        "b",
        {
          regime: "govt",
          mu: 0.04,
          ter: 0.001,
          couponRate: 0.02,
          sigma: 0,
          assetClass: "Govt bonds",
        },
      ],
      ["c", { regime: "cash", mu: 0.02, ter: 0, sigma: 0, assetClass: "Cash" }],
    ]);
    const flat = goal({
      products,
      positions: [
        { productId: "p", value: 5_000, basis: 6_000 },
        { productId: "b", value: 3_000, basis: 2_500 },
        { productId: "c", value: 1_000, basis: 1_000 },
      ],
      weights: new Map([
        ["p", 2],
        ["b", 1],
        ["c", 1],
      ]),
      settings: { ...settings, bollo: 0.002 },
    });
    const { goals } = runMonteCarlo({ goals: [flat], correlations: SAMPLE }, 1, 50);
    const deterministic = projectGoal(flat);
    const [dist] = goals;
    expect(dist?.p50).toHaveLength(5);
    expect(dist?.p50.at(-1)).toBeCloseTo(deterministic.net, 8);
    expect(dist?.p10.at(-1)).toBeCloseTo(deterministic.net, 8);
    expect(dist?.p90.at(-1)).toBeCloseTo(deterministic.net, 8);
  });

  it("orders P10 <= P50 <= P90 in every step, one entry per step", () => {
    const [dist] = runMonteCarlo(inputs, 5, 500).goals;
    expect(dist?.goalId).toBe("g");
    expect(dist?.p50).toHaveLength(5);
    for (let k = 0; k < 5; k++) {
      expect(dist?.p10[k]).toBeLessThanOrEqual(dist?.p50[k] as number);
      expect(dist?.p50[k]).toBeLessThanOrEqual(dist?.p90[k] as number);
    }
    expect(dist?.p90.at(-1)).toBeGreaterThan(dist?.p10.at(-1) as number);
  });

  it("gives P(success) 1 and shortfall 0 when the target is below the net, and the gap when above", () => {
    const flat = (target: number) =>
      goal({
        goal: { id: "g", targetYear: 2028, target, contributionGrowth: 0 },
        products: new Map([["p", { ...equity, sigma: 0 }]]),
      });
    const net = projectGoal(flat(0)).net;
    const below = runMonteCarlo({ goals: [flat(1_000)], correlations: SAMPLE }, 1, 20).goals[0];
    expect(below).toMatchObject({ pSuccess: 1, avgShortfall: 0 });
    const target = 20_000;
    const above = runMonteCarlo({ goals: [flat(target)], correlations: SAMPLE }, 1, 20).goals[0];
    const targetAtGoalDate = projectGoal(flat(target)).targetAtGoalDate;
    expect(above?.pSuccess).toBe(0);
    expect(above?.avgShortfall).toBeCloseTo(targetAtGoalDate - net, 8);
  });

  it("counts the share of paths at or above the target and the mean shortfall over all paths", () => {
    const target = 9_000;
    const risky = goal({ goal: { id: "g", targetYear: 2028, target, contributionGrowth: 0 } });
    const { nets, targets } = simulatePaths({ goals: [risky], correlations: SAMPLE }, 9, 400);
    const last = nets[0]?.at(-1) as number[];
    const t = targets[0] as number;
    const [dist] = runMonteCarlo({ goals: [risky], correlations: SAMPLE }, 9, 400).goals;
    expect(dist?.pSuccess).toBeCloseTo(last.filter((n) => n >= t).length / 400, 12);
    expect(dist?.avgShortfall).toBeCloseTo(mean(last.map((n) => Math.max(0, t - n))), 8);
    expect(dist?.pSuccess).toBeGreaterThan(0);
    expect(dist?.pSuccess).toBeLessThan(1);
  });

  it("scales the stub shock so the sample variance of stub log-returns is f * s^2 (AC-55)", () => {
    // Goal due in the stub year: one step, f = 2/12. No tax, no contribution: net = growth.
    const stub = goal({
      goal: { id: "g", targetYear: 2026, target: 0, contributionGrowth: 0 },
      monthly: 0,
      positions: [{ productId: "p", value: 1_000, basis: 1_000 }],
      products: new Map([["p", { ...equity, ter: 0 }]]),
      settings: noTax,
    });
    const paths = 20_000;
    const { nets } = simulatePaths({ goals: [stub], correlations: SAMPLE }, 11, paths);
    expect(nets[0]).toHaveLength(1);
    const f = 2 / 12;
    const { m, s } = lognormalParams(equity.mu, equity.sigma);
    const stepLogs = logs(nets[0]?.[0] as number[], 1_000);
    // Sampling error of a variance is about sqrt(2/N) = 1%: allow 5%.
    expect(Math.abs(variance(stepLogs) / (f * s * s) - 1)).toBeLessThan(0.05);
    expect(mean(stepLogs)).toBeCloseTo(f * m, 3);
  });

  it("gives a full year the variance s^2", () => {
    const year = goal({
      goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
      monthly: 0,
      positions: [{ productId: "p", value: 1_000, basis: 1_000 }],
      products: new Map([["p", { ...equity, ter: 0 }]]),
      settings: noTax,
    });
    const { nets } = simulatePaths({ goals: [year], correlations: SAMPLE }, 12, 20_000);
    const [first, second] = nets[0] as [number[], number[]];
    const stepOne = logs(first, 1_000);
    const stepTwo = second.map((v, i) => Math.log(v / (first[i] as number)));
    const { s } = lognormalParams(equity.mu, equity.sigma);
    expect(Math.abs(variance(stepTwo) / (s * s) - 1)).toBeLessThan(0.05);
    expect(Math.abs(variance(stepOne) / ((2 / 12) * s * s) - 1)).toBeLessThan(0.05);
  });

  it("shares one correlated shock array across goals: classes follow the matrix", () => {
    const oneStep = (assetClass: MonteCarloProduct["assetClass"], id: string): MonteCarloGoal =>
      goal({
        goal: { id, targetYear: 2027, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 1_000, basis: 1_000 }],
        products: new Map([["p", { ...equity, ter: 0, assetClass }]]),
        settings: noTax,
      });
    const { nets } = simulatePaths(
      { goals: [oneStep("Equity", "a"), oneStep("Multi-asset", "b")], correlations: SAMPLE },
      21,
      20_000,
    );
    const a = logs(nets[0]?.[1] as number[], 1_000);
    const b = logs(nets[1]?.[1] as number[], 1_000);
    const ma = mean(a);
    const mb = mean(b);
    const cov = a.reduce((s, x, i) => s + (x - ma) * ((b[i] as number) - mb), 0) / (a.length - 1);
    expect(cov / Math.sqrt(variance(a) * variance(b))).toBeCloseTo(0.85, 1);
  });

  it("does not change a goal's paths when another goal with a longer horizon is added", () => {
    const alone = simulatePaths(inputs, 3, 100).nets[0];
    const longer = goal({ goal: { id: "h", targetYear: 2040, target: 0, contributionGrowth: 0 } });
    const together = simulatePaths({ goals: [goal(), longer], correlations: SAMPLE }, 3, 100)
      .nets[0];
    expect(together).toEqual(alone);
  });

  it("uses the same first paths whatever the path count", () => {
    const few = simulatePaths(inputs, 3, 50).nets[0]?.at(-1) as number[];
    const many = simulatePaths(inputs, 3, 200).nets[0]?.at(-1) as number[];
    expect(many.slice(0, 50)).toEqual(few);
  });

  it("liquidates a path with credits: a loss path pays no tax on the gain of another bucket product", () => {
    const losers = goal({
      goal: { id: "g", targetYear: 2026, target: 0, contributionGrowth: 0 },
      monthly: 0,
      positions: [
        { productId: "d", value: 1_100, basis: 1_000 },
        { productId: "e", value: 900, basis: 1_000 },
      ],
      products: new Map<string, MonteCarloProduct>([
        ["d", { regime: "direct", mu: 0, ter: 0, sigma: 0, assetClass: "Equity" }],
        ["e", { regime: "etf", mu: 0, ter: 0, sigma: 0, assetClass: "Equity" }],
      ]),
      weights: new Map(),
    });
    const [dist] = runMonteCarlo({ goals: [losers], correlations: SAMPLE }, 1, 10).goals;
    // Gain 100 x 26% = 26 tax euros, offset by the ETF loss 100 x 26% = 26: net = gross.
    expect(dist?.p50[0]).toBeCloseTo(2_000, 9);
  });

  describe("correlation matrix", () => {
    it("is not flagged when positive definite", () => {
      expect(runMonteCarlo(inputs, 1, 10).correlationShrunk).toBe(false);
    });

    it("shrinks a non-positive-definite matrix with the #21 function and flags it (AC-56)", () => {
      const pair = (assetClass: MonteCarloProduct["assetClass"], id: string): MonteCarloGoal =>
        goal({
          goal: { id, targetYear: 2027, target: 0, contributionGrowth: 0 },
          monthly: 0,
          positions: [{ productId: "p", value: 1_000, basis: 1_000 }],
          products: new Map([["p", { ...equity, ter: 0, assetClass }]]),
          settings: noTax,
        });
      const both = {
        goals: [pair("Equity", "a"), pair("Govt bonds", "b")],
        correlations: IMPOSSIBLE,
      };
      const result = runMonteCarlo(both, 8, 100);
      expect(result.correlationShrunk).toBe(true);
      const expected = shrinkToPositiveDefinite(IMPOSSIBLE).matrix[0]?.[1] as number;
      expect(expected).toBeLessThan(0.9);
      const { nets } = simulatePaths(both, 8, 20_000);
      const a = logs(nets[0]?.[1] as number[], 1_000);
      const b = logs(nets[1]?.[1] as number[], 1_000);
      const ma = mean(a);
      const mb = mean(b);
      const cov = a.reduce((s, x, i) => s + (x - ma) * ((b[i] as number) - mb), 0) / (a.length - 1);
      expect(cov / Math.sqrt(variance(a) * variance(b))).toBeCloseTo(expected, 1);
    });
  });

  it("handles a goal due now: one point, no randomness", () => {
    const due = goal({ goal: { id: "g", targetYear: 2025, target: 3_000, contributionGrowth: 0 } });
    const [dist] = runMonteCarlo({ goals: [due], correlations: SAMPLE }, 1, 20).goals;
    expect(dist?.p50).toHaveLength(1);
    expect(dist?.p50[0]).toBeCloseTo(projectGoal(due).net, 9);
    expect(dist?.pSuccess).toBe(1);
  });

  it("rejects a correlation matrix that is not 6 x 6", () => {
    expect(() => runMonteCarlo({ goals: [goal()], correlations: [[1]] }, 1, 10)).toThrow();
  });
});
