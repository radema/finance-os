import { describe, expect, it } from "vitest";
import { type MonteCarloGoal, type MonteCarloProduct, runMonteCarlo } from "./monteCarlo.ts";
import {
  chooseMix,
  defaultCriterion,
  flowsForMix,
  generateMixes,
  type MixResult,
  mixOfFlows,
  type OptimizerCriterion,
  PensionRebalanceError,
  runOptimizer,
} from "./optimizer.ts";
import { projectGoal } from "./projection.ts";
import { requiredContribution } from "./requiredContribution.ts";
import { pensionPlanSchema } from "./schemas.ts";

const names = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);
const sum = (weights: ReadonlyMap<string, number>) =>
  [...weights.values()].reduce((total, w) => total + w, 0);

describe("generateMixes (AC-79)", () => {
  it("gives 286 mixes for 4 products at 10% steps", () => {
    const mixes = generateMixes(names(4));
    expect(mixes).toHaveLength(286);
    for (const mix of mixes) expect(sum(mix)).toBeCloseTo(1, 12);
  });

  it("gives 252 mixes for 6 products at 20% steps", () => {
    const mixes = generateMixes(names(6));
    expect(mixes).toHaveLength(252);
    for (const mix of mixes) {
      expect(sum(mix)).toBeCloseTo(1, 12);
      for (const w of mix.values()) expect(Math.round(w * 100) % 20).toBe(0);
    }
  });

  it("uses 10% steps up to 4 products and 20% steps from 5", () => {
    expect(generateMixes(names(5))).toHaveLength(126); // C(9, 4): 5 units of 20% over 5 products
    expect(generateMixes(names(1))).toHaveLength(1);
    expect(generateMixes(names(2))).toHaveLength(11);
  });

  it("allows zero weights", () => {
    const mixes = generateMixes(names(2));
    expect(mixes.some((mix) => mix.get("p0") === 0)).toBe(true);
    expect(mixes.some((mix) => mix.get("p1") === 0)).toBe(true);
  });

  it("drops every mix with a weight above the 40% cap", () => {
    const mixes = generateMixes(names(4), 0.4);
    expect(mixes.length).toBeGreaterThan(0);
    expect(mixes.length).toBeLessThan(286);
    for (const mix of mixes) for (const w of mix.values()) expect(w).toBeLessThanOrEqual(0.4);
    // Inclusion-exclusion over the 286 mixes: 286 - 4 x C(8, 3) + C(4, 2) x 1 = 68 have no weight above 40%.
    expect(mixes).toHaveLength(68);
  });

  it("keeps the cap exactly: a weight equal to the cap stays", () => {
    const mixes = generateMixes(names(2), 0.6);
    expect(mixes).toHaveLength(3); // 40/60, 50/50, 60/40
  });

  it("rejects 0 and more than 6 products", () => {
    expect(() => generateMixes([])).toThrow();
    expect(() => generateMixes(names(7))).toThrow();
  });
});

describe("defaultCriterion", () => {
  it("is O1 for Need and O2 for Want and Wish", () => {
    expect(defaultCriterion("Need")).toBe("O1");
    expect(defaultCriterion("Want")).toBe("O2");
    expect(defaultCriterion("Wish")).toBe("O2");
  });
});

function row(over: Partial<MixResult> & { id: string }): MixResult {
  const { id, ...rest } = over;
  return {
    weights: new Map([[id, 1]]),
    p: 0.9,
    median: 100,
    p10: 50,
    p90: 150,
    shortfall: 0,
    detValue: 100,
    ...rest,
  };
}
const ids = (mix: MixResult) => [...mix.weights.keys()][0];

describe("chooseMix tie-breaks (AC-80)", () => {
  it("O1 takes the highest P10 among feasible mixes, ties to the higher P", () => {
    const rows = [
      row({ id: "a", p: 0.8, p10: 70 }),
      row({ id: "b", p: 0.85, p10: 70 }),
      row({ id: "c", p: 0.99, p10: 60 }),
      row({ id: "d", p: 0.4, p10: 900 }), // not feasible
    ];
    const result = chooseMix(rows, "O1", 0.75);
    expect(ids(result.chosen)).toBe("b");
    expect(result.notFeasible).toBe(false);
  });

  it("O2 takes the highest median among feasible mixes, ties to the higher P", () => {
    const rows = [
      row({ id: "a", p: 0.8, median: 120 }),
      row({ id: "b", p: 0.9, median: 120 }),
      row({ id: "c", p: 0.99, median: 100 }),
      row({ id: "d", p: 0.4, median: 900 }),
    ];
    expect(ids(chooseMix(rows, "O2", 0.75).chosen)).toBe("b");
  });

  it("O5 takes the lowest monthly needed among feasible mixes, ties to the higher median", () => {
    const rows = [
      row({ id: "a", monthlyNeeded: 300, median: 100 }),
      row({ id: "b", monthlyNeeded: 200, median: 100 }),
      row({ id: "c", monthlyNeeded: 200, median: 130 }),
      row({ id: "d", monthlyNeeded: 10, p: 0.4 }), // not feasible
    ];
    expect(ids(chooseMix(rows, "O5", 0.75).chosen)).toBe("c");
  });

  it("O5 puts a mix with no reachable amount (null) last", () => {
    const rows = [row({ id: "a", monthlyNeeded: null }), row({ id: "b", monthlyNeeded: 500 })];
    expect(ids(chooseMix(rows, "O5", 0.75).chosen)).toBe("b");
  });

  it("O4 takes the highest P with no feasibility filter, ties to the higher median", () => {
    const rows = [
      row({ id: "a", p: 0.5, median: 100 }),
      row({ id: "b", p: 0.6, median: 100 }),
      row({ id: "c", p: 0.6, median: 110 }),
    ];
    const result = chooseMix(rows, "O4", 0.5);
    expect(ids(result.chosen)).toBe("c");
    expect(result.notFeasible).toBe(false);
  });

  it("O4 flags notFeasible when even the best P is below the required value", () => {
    const rows = [row({ id: "a", p: 0.5 }), row({ id: "b", p: 0.6 })];
    const result = chooseMix(rows, "O4", 0.9);
    expect(ids(result.chosen)).toBe("b");
    expect(result.notFeasible).toBe(true);
  });

  it("keeps the candidate order when everything is tied", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    for (const criterion of ["O1", "O2", "O4"] as const) {
      expect(ids(chooseMix(rows, criterion, 0.5).chosen)).toBe("a");
    }
    const needed = rows.map((r) => ({ ...r, monthlyNeeded: 100 }));
    expect(ids(chooseMix(needed, "O5", 0.5).chosen)).toBe("a");
  });

  it("returns the highest-P mix with notFeasible when no mix reaches the required P", () => {
    const rows = [
      row({ id: "a", p: 0.4, p10: 900, monthlyNeeded: 10 }),
      row({ id: "b", p: 0.6, p10: 1, monthlyNeeded: 900 }),
      row({ id: "c", p: 0.6, p10: 2, monthlyNeeded: 800 }),
    ];
    for (const criterion of ["O1", "O2", "O5"] as const) {
      const result = chooseMix(rows, criterion, 0.9);
      expect(ids(result.chosen)).toBe("b"); // highest P; the tie keeps the candidate order
      expect(result.notFeasible).toBe(true);
    }
  });

  it("counts P equal to the required value as feasible", () => {
    const result = chooseMix([row({ id: "a", p: 0.75 })], "O1", 0.75);
    expect(result.notFeasible).toBe(false);
  });

  it("names the rule that chose the mix", () => {
    const rows = [row({ id: "a", monthlyNeeded: 1 })];
    const names = new Set<string>();
    for (const criterion of ["O1", "O2", "O4", "O5"] as const) {
      const { ruleName, ruleText } = chooseMix(rows, criterion, 0.5);
      expect(ruleName.startsWith(criterion)).toBe(true);
      expect(ruleText.length).toBeGreaterThan(0);
      expect(ruleText).not.toContain("\n");
      names.add(ruleName);
    }
    expect(names.size).toBe(4);
    expect(chooseMix(rows, "O1", 0.99).ruleText).not.toBe(chooseMix(rows, "O1", 0.5).ruleText);
  });
});

// A two-product bucket: equity (high return, high risk) and bonds (low return, low risk).
const SETTINGS = { inflation: 0.02, bollo: 0, taxStd: 0, taxGovt: 0, pensionTax: 0.2 };
const equity: MonteCarloProduct = {
  regime: "etf",
  mu: 0.07,
  ter: 0.002,
  sigma: 0.18,
  assetClass: "Equity",
};
const bonds: MonteCarloProduct = {
  regime: "etf",
  mu: 0.025,
  ter: 0.002,
  sigma: 0.05,
  assetClass: "Govt bonds",
};
const CORRELATIONS = [
  [1, 0.2, 0, 0, 0, 0],
  [0.2, 1, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 1],
];
const bucket: MonteCarloGoal = {
  asOf: "2026-10-31",
  goal: { id: "g", targetYear: 2031, target: 26_000, contributionGrowth: 0 },
  monthly: 400,
  positions: [{ productId: "e", value: 6_000, basis: 5_000 }],
  products: new Map([
    ["e", equity],
    ["b", bonds],
  ]),
  weights: new Map([["e", 1]]),
  settings: SETTINGS,
};
const SEED = 42;
const PATHS = 300;
const PATHS_O5 = 200;

/** The choice by a plain loop: one simulation per mix, one sort per criterion. */
function bruteForce(criterion: OptimizerCriterion, requiredP: number) {
  const paths = criterion === "O5" ? PATHS_O5 : PATHS;
  const rows = generateMixes(["e", "b"]).map((weights) => {
    const goal = { ...bucket, weights };
    const result = runMonteCarlo({ goals: [goal], correlations: CORRELATIONS }, SEED, paths)
      .goals[0];
    return {
      weights,
      p: result?.pSuccess as number,
      median: result?.p50.at(-1) as number,
      p10: result?.p10.at(-1) as number,
      needed:
        criterion === "O5"
          ? (requiredContribution(goal, "probability", {
              requiredP,
              correlations: CORRELATIONS,
              seed: SEED,
              paths,
            }) ?? Number.POSITIVE_INFINITY)
          : 0,
    };
  });
  const feasible = rows.filter((r) => r.p >= requiredP);
  const by = {
    O1: (a: (typeof rows)[0], b: (typeof rows)[0]) => b.p10 - a.p10 || b.p - a.p,
    O2: (a: (typeof rows)[0], b: (typeof rows)[0]) => b.median - a.median || b.p - a.p,
    O5: (a: (typeof rows)[0], b: (typeof rows)[0]) => a.needed - b.needed || b.median - a.median,
    O4: (a: (typeof rows)[0], b: (typeof rows)[0]) => b.p - a.p || b.median - a.median,
  }[criterion];
  const pool = criterion === "O4" ? rows : feasible;
  const chosen = pool.length > 0 ? pool.toSorted(by)[0] : rows.toSorted((a, b) => b.p - a.p)[0];
  return { chosen, rows, feasibleCount: feasible.length };
}

const input = (criterion: OptimizerCriterion, requiredP: number) => ({
  bucket,
  products: ["e", "b"],
  criterion,
  requiredP,
  seed: SEED,
  correlations: CORRELATIONS,
  mode: "new" as const,
});

describe("runOptimizer against a brute-force loop (AC-80)", () => {
  for (const criterion of ["O1", "O2", "O4", "O5"] as const) {
    it(`${criterion} chooses the same mix`, () => {
      const requiredP = 0.85;
      const expected = bruteForce(criterion, requiredP);
      expect(expected.feasibleCount).toBeGreaterThan(0);
      expect(expected.feasibleCount).toBeLessThan(11);
      const result = runOptimizer(input(criterion, requiredP));
      expect(result.mixes).toHaveLength(11);
      expect(result.chosen.weights).toEqual(expected.chosen?.weights);
      expect(result.chosen.p).toBe(expected.chosen?.p);
      expect(result.notFeasible).toBe(false);
      expect(result.ruleName.startsWith(criterion)).toBe(true);
      expect(result.ruleText.length).toBeGreaterThan(0);
    });
  }

  it("O2 chooses a different mix from O1 and O4 on this fixture, so the rules are told apart", () => {
    const [o1, o2, o4] = (["O1", "O2", "O4"] as const).map((criterion) =>
      runOptimizer(input(criterion, 0.85)).chosen.weights.get("e"),
    );
    expect(o2).not.toBe(o1);
    expect(o2).not.toBe(o4);
  });

  it("returns each mix's outcomes: P, median, P10, P90, shortfall and deterministic value", () => {
    const { mixes } = runOptimizer(input("O1", 0.5));
    const mix = mixes[3] as MixResult;
    const goal = { ...bucket, weights: mix.weights };
    const distribution = runMonteCarlo({ goals: [goal], correlations: CORRELATIONS }, SEED, PATHS)
      .goals[0];
    expect(mix.p).toBe(distribution?.pSuccess);
    expect(mix.median).toBe(distribution?.p50.at(-1));
    expect(mix.p10).toBe(distribution?.p10.at(-1));
    expect(mix.p90).toBe(distribution?.p90.at(-1));
    expect(mix.shortfall).toBe(distribution?.avgShortfall);
    expect(mix.detValue).toBe(projectGoal(goal).net);
    expect(mix.monthlyNeeded).toBeUndefined();
    expect(mix.p10).toBeLessThanOrEqual(mix.median);
    expect(mix.median).toBeLessThanOrEqual(mix.p90);
  });

  it("O5 runs 200 paths and returns the monthly needed per mix", () => {
    const { mixes } = runOptimizer(input("O5", 0.5));
    const mix = mixes[5] as MixResult;
    const goal = { ...bucket, weights: mix.weights };
    expect(mix.monthlyNeeded).toBe(
      requiredContribution(goal, "probability", {
        requiredP: 0.5,
        correlations: CORRELATIONS,
        seed: SEED,
        paths: PATHS_O5,
      }),
    );
    const distribution = runMonteCarlo(
      { goals: [goal], correlations: CORRELATIONS },
      SEED,
      PATHS_O5,
    ).goals[0];
    expect(mix.p).toBe(distribution?.pSuccess);
  });

  it("returns the highest-P mix with notFeasible when no mix reaches the required P", () => {
    const requiredP = 0.999;
    const expected = bruteForce("O1", requiredP);
    expect(expected.feasibleCount).toBe(0);
    const result = runOptimizer(input("O1", requiredP));
    expect(result.notFeasible).toBe(true);
    expect(result.chosen.weights).toEqual(expected.chosen?.weights);
    expect(result.chosen.p).toBe(Math.max(...result.mixes.map((m) => m.p)));
  });

  it("applies the per-product maximum to the candidates", () => {
    const result = runOptimizer({ ...input("O2", 0.5), maxPerProduct: 0.6 });
    expect(result.mixes).toHaveLength(3);
    for (const mix of result.mixes)
      for (const w of mix.weights.values()) expect(w).toBeLessThanOrEqual(0.6);
  });

  it("keeps the bucket's holdings: the mix changes only the weights of new money", () => {
    const first = runOptimizer(input("O2", 0.5)).mixes[0] as MixResult; // all new money in "b"
    expect(first.weights.get("e")).toBe(0);
    const withoutHoldings = projectGoal({ ...bucket, positions: [], weights: first.weights });
    // The 6,000 held in "e" stays in the bucket and grows at 7% less 0.2% TER for 5 years or more.
    const holdingAtGoal = first.detValue - withoutHoldings.net;
    expect(holdingAtGoal).toBeGreaterThan(6_000 * 1.3);
    expect(holdingAtGoal).toBeLessThan(6_000 * 1.5);
  });

  it("is deterministic: same input and seed give the same result", () => {
    expect(runOptimizer(input("O1", 0.5))).toEqual(runOptimizer(input("O1", 0.5)));
  });

  it("throws when the cap leaves no mix", () => {
    expect(() =>
      runOptimizer({ ...input("O1", 0.5), products: ["e"], maxPerProduct: 0.5 }),
    ).toThrow();
  });
});

// Rebalance now (AC-81). Holdings: 6,000 in "e" on a basis of 5,000, so a gain of 1,000 taxed at 26%.
const TAXED = { ...SETTINGS, taxStd: 0.26, taxGovt: 0.125 };
const taxedBucket: MonteCarloGoal = { ...bucket, settings: TAXED };
const rebalanceInput = (over: object = {}) => ({
  ...input("O2", 0.5),
  bucket: taxedBucket,
  mode: "rebalance" as const,
  ...over,
});

describe("runOptimizer, rebalance now (AC-81)", () => {
  it("reports the tax of selling the holdings at asOf: 1,000 gain x 26% = 260", () => {
    const result = runOptimizer(rebalanceInput());
    expect(result.switchTax).toBeCloseTo(260, 9);
  });

  it("reinvests the proceeds net of tax (6,000 - 260 = 5,740) on a basis equal to that value", () => {
    // One product: the mix is 100% "e". Opening state after the switch: value 5,740, basis 5,740.
    const result = runOptimizer(rebalanceInput({ products: ["e"] }));
    const switched = projectGoal({
      ...taxedBucket,
      positions: [{ productId: "e", value: 5_740, basis: 5_740 }],
      weights: new Map([["e", 1]]),
    });
    const notReset = projectGoal({
      ...taxedBucket,
      positions: [{ productId: "e", value: 5_740, basis: 5_000 }],
      weights: new Map([["e", 1]]),
    });
    const [mix] = result.mixes as [MixResult];
    expect(mix.detValue).toBeCloseTo(switched.net, 6);
    // With the old basis the exit tax would be higher: the reset is what the result shows.
    expect(mix.detValue).toBeGreaterThan(notReset.net + 100);
  });

  it("splits the reinvested value by the mix: 40% of 5,740 goes to 'b'", () => {
    const { mixes } = runOptimizer(rebalanceInput());
    const mix = mixes.find((m) => m.weights.get("e") === 0.6) as MixResult;
    const goal = {
      ...taxedBucket,
      weights: mix.weights,
      positions: [
        { productId: "e", value: 5_740 * 0.6, basis: 5_740 * 0.6 },
        { productId: "b", value: 5_740 * 0.4, basis: 5_740 * 0.4 },
      ],
    };
    expect(mix.detValue).toBeCloseTo(projectGoal(goal).net, 6);
  });

  it("'new' mode charges no tax and keeps the holdings", () => {
    const result = runOptimizer({ ...rebalanceInput(), mode: "new" });
    expect(result.switchTax).toBe(0);
    const mix = result.mixes[0] as MixResult;
    expect(mix.detValue).toBeCloseTo(projectGoal({ ...taxedBucket, weights: mix.weights }).net, 6);
  });

  it("charges no tax when the holdings are at a loss, and uses the zainetto of the goal", () => {
    const loss = {
      ...taxedBucket,
      positions: [{ productId: "e", value: 4_000, basis: 5_000 }],
    };
    expect(runOptimizer(rebalanceInput({ bucket: loss })).switchTax).toBe(0);
    const withZainetto = {
      ...taxedBucket,
      positions: [{ productId: "d", value: 1_000, basis: 500 }],
      products: new Map([...taxedBucket.products, ["d", { ...equity, regime: "direct" as const }]]),
      settings: { ...TAXED, zainetto: { amount: 500, expiry: "2027", goalId: "g" } },
    };
    // Gain 500 x 26% = 130, credit 500 x 26% = 130: no tax.
    expect(runOptimizer(rebalanceInput({ bucket: withZainetto })).switchTax).toBeCloseTo(0, 9);
  });

  it("uses the zainetto once: the sale takes 130 of its 260 tax credit, the goal date gets the rest", () => {
    // Direct product held: value 1,500 on a basis of 1,000 (gain 500 x 26% = 130). Zainetto 1,000 of loss
    // = 260 of credit, so the sale pays no tax and uses 130 of credit: 500 of loss is left.
    const direct = { ...equity, regime: "direct" as const };
    const zainetto = { amount: 1_000, expiry: "2035", goalId: "g" };
    const zBucket: MonteCarloGoal = {
      ...taxedBucket,
      positions: [{ productId: "d", value: 1_500, basis: 1_000 }],
      products: new Map([["d", direct]]),
      weights: new Map([["d", 1]]),
      settings: { ...TAXED, zainetto },
    };
    const result = runOptimizer(rebalanceInput({ bucket: zBucket, products: ["d"] }));
    expect(result.switchTax).toBeCloseTo(0, 9);
    const afterSale = (left: number) =>
      projectGoal({
        ...zBucket,
        positions: [{ productId: "d", value: 1_500, basis: 1_500 }],
        settings: { ...TAXED, zainetto: { ...zainetto, amount: left } },
      }).net;
    const [mix] = result.mixes as [MixResult];
    expect(mix.detValue).toBeCloseTo(afterSale(500), 6);
    // Counting the whole zainetto again would add 130 of credit at the goal date.
    expect(afterSale(1_000)).toBeGreaterThan(afterSale(500) + 100);
  });

  it("refuses a pension bucket with a typed error", () => {
    const pensionProduct: MonteCarloProduct = { ...bonds, regime: "pension" };
    const pensionBucket: MonteCarloGoal = {
      ...taxedBucket,
      positions: [{ productId: "f", value: 6_000, basis: 5_000 }],
      products: new Map([["f", pensionProduct]]),
      weights: new Map([["f", 1]]),
      firstYear: 2020,
    };
    const run = () => runOptimizer(rebalanceInput({ bucket: pensionBucket, products: ["f"] }));
    expect(run).toThrow(PensionRebalanceError);
    // "New money only" is not refused: the holdings stay.
    expect(() =>
      runOptimizer({ ...rebalanceInput({ bucket: pensionBucket, products: ["f"] }), mode: "new" }),
    ).not.toThrow();
  });
});

// The pension goal (AC-80): the mix sets the plan's flows, since the goal ignores its weights.
describe("runOptimizer on the pension goal", () => {
  const pensionProducts = new Map<string, MonteCarloProduct>([
    ["a", { ...equity, regime: "pension" }],
    ["f", { ...bonds, regime: "pension" }],
  ]);
  const pensionBucket = (flows: { productId: string; flow: "Work" | "Voluntary"; pct: number }[]) =>
    ({
      ...bucket,
      goal: { id: "g", targetYear: 2036, target: 60_000, contributionGrowth: 0 },
      positions: [],
      products: pensionProducts,
      weights: new Map([["f", 1]]),
      firstYear: 2020,
      pension: {
        plan: pensionPlanSchema.parse({
          goalId: "g",
          firstYear: 2020,
          ral: 4_000_000,
          workerPct: 0.01,
          employerPct: 0.02,
          voluntary: 100_000,
          flows,
        }),
        deductionCapCents: 530_000,
        voluntaryYtd: 0,
      },
    }) satisfies MonteCarloGoal;
  const run = (criterion: OptimizerCriterion, flows = [] as Parameters<typeof pensionBucket>[0]) =>
    runOptimizer({
      ...input(criterion, 0),
      bucket: pensionBucket(flows),
      products: ["a", "f"],
    });

  it("gives different outcomes to different mixes", () => {
    const { mixes } = run("O2");
    const medians = new Set(mixes.map((mix) => mix.median));
    expect(medians.size).toBe(mixes.length);
  });

  it("chooses the mix the criterion picks, not the first candidate", () => {
    const { chosen, mixes } = run("O2");
    expect(chosen.median).toBe(Math.max(...mixes.map((mix) => mix.median)));
    expect(chosen.weights).not.toEqual(mixes[0]?.weights);
  });

  it("works from the plan's own flows: a plan with no flows takes Work and Voluntary", () => {
    const both = [
      { productId: "f", flow: "Work" as const, pct: 1 },
      { productId: "f", flow: "Voluntary" as const, pct: 1 },
    ];
    const workOnly = both.slice(0, 1);
    // No flows runs as a plan with both kinds, and not as one with Work alone.
    expect(run("O2").chosen.median).toBe(run("O2", both).chosen.median);
    expect(run("O2").chosen.median).not.toBe(run("O2", workOnly).chosen.median);
  });
});

describe("flowsForMix and mixOfFlows", () => {
  const mix = new Map([
    ["a", 3],
    ["f", 1],
    ["z", 0],
  ]);

  it("gives every flow the plan has the rescaled weights, and drops a zero weight", () => {
    const current = [{ productId: "f", flow: "Voluntary" as const, pct: 1 }];
    expect(flowsForMix(mix, current)).toEqual([
      { productId: "a", flow: "Voluntary", pct: 0.75 },
      { productId: "f", flow: "Voluntary", pct: 0.25 },
    ]);
  });

  it("gives Work and Voluntary to a plan with no flows", () => {
    expect(flowsForMix(new Map([["a", 1]]), []).map((flow) => flow.flow)).toEqual([
      "Work",
      "Voluntary",
    ]);
  });

  it("round-trips: the weights of the flows are the mix", () => {
    const back = mixOfFlows(flowsForMix(mix, []));
    expect(back.get("a")).toBeCloseTo(0.75);
    expect(back.get("f")).toBeCloseTo(0.25);
    expect(back.has("z")).toBe(false);
  });
});

// Speed (AC-83). A long goal (20 years) is the slowest case; each test times only runOptimizer.
const SPEED_PRODUCTS = new Map<string, MonteCarloProduct>([
  ["e", equity],
  ["b", bonds],
  ["w", { ...equity, mu: 0.06, sigma: 0.16 }],
  ["g", { ...bonds, mu: 0.03, sigma: 0.08, assetClass: "Gold/Commodities" }],
]);
const speedBucket: MonteCarloGoal = {
  ...bucket,
  goal: { id: "g", targetYear: 2046, target: 150_000, contributionGrowth: 0.02 },
  products: SPEED_PRODUCTS,
};
const ELAPSED_LIMIT_MS = { full: 3_000, spendLeast: 10_000 };
// Own timeout, well above the budgets: a slow machine fails the budget assertion, not the runner.
const TEST_TIMEOUT_MS = 60_000;

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

describe("optimizer speed (AC-83)", () => {
  it(
    "runs 286 mixes x 300 paths in under 3 s",
    () => {
      const { value, ms } = timed(() =>
        runOptimizer({
          ...input("O2", 0.5),
          bucket: speedBucket,
          products: ["e", "b", "w", "g"],
        }),
      );
      expect(value.mixes).toHaveLength(286);
      expect(ms).toBeLessThan(ELAPSED_LIMIT_MS.full);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "runs 'spend least' with 3 products in under 10 s",
    () => {
      const { value, ms } = timed(() =>
        runOptimizer({
          ...input("O5", 0.8),
          bucket: speedBucket,
          products: ["e", "b", "w"],
        }),
      );
      expect(value.mixes).toHaveLength(66);
      expect(ms).toBeLessThan(ELAPSED_LIMIT_MS.spendLeast);
    },
    TEST_TIMEOUT_MS,
  );
});
