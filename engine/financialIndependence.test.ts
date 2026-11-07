import { describe, expect, it } from "vitest";
import {
  type FiGoal,
  type FiInput,
  fiLevels,
  projectFinancialIndependence,
} from "./financialIndependence.ts";
import { type MonteCarloProduct, runMonteCarlo } from "./monteCarlo.ts";
import { fireSettingsSchema } from "./schemas.ts";

const IDENTITY = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].map((j) => (i === j ? 1 : 0)));
const settings = { inflation: 0.02, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 };
// 31 December: f = 0, so the point k >= 1 has t = k - 1 real years and no stub is left.
const AS_OF = "2026-12-31";
const FIRE = fireSettingsSchema.parse({});

const etf: MonteCarloProduct = {
  regime: "etf",
  mu: 0,
  ter: 0,
  sigma: 0,
  assetClass: "Equity",
};
const pensionFund: MonteCarloProduct = {
  regime: "pension",
  mu: 0,
  ter: 0,
  sigma: 0,
  assetClass: "Multi-asset",
};

function goal(over: Partial<FiGoal> & { id?: string } = {}): FiGoal {
  const { id = "g", ...rest } = over;
  return {
    asOf: AS_OF,
    goal: { id, targetYear: 2026, target: 5_000, contributionGrowth: 0 },
    monthly: 0,
    positions: [{ productId: "p", value: 10_000, basis: 8_000 }],
    products: new Map([["p", etf]]),
    weights: new Map([["p", 1]]),
    settings,
    countsTowardFi: true,
    ...rest,
  };
}

function input(over: Partial<FiInput> = {}): FiInput {
  return {
    asOf: AS_OF,
    goals: [goal()],
    correlations: IDENTITY,
    fire: FIRE,
    essential: 1_000,
    optional: 500,
    expenseGrowth: 0,
    inflation: 0.02,
    ...over,
  };
}

describe("fireSettingsSchema", () => {
  it("defaults to includePension true, 12 months, 200, 300 and 200", () => {
    expect(fireSettingsSchema.parse({})).toEqual({
      efFromGoal: null,
      efMonths: 12,
      baristaMult: 200,
      l2Mult: 300,
      l3Mult: 200,
      includePension: true,
    });
  });
});

describe("fiLevels", () => {
  it("gives Financial security = efMonths x essential, Barista FIRE = 200 x essential, Lean FIRE = 300 x essential, Financial Freedom = Lean FIRE + 200 x optional (AC-59)", () => {
    expect(fiLevels(input({ essential: 1_000, optional: 500 }))).toEqual([
      12_000, 200_000, 300_000, 400_000,
    ]);
  });

  it("takes Level 1 from the target of the efFromGoal goal", () => {
    const fire = { ...FIRE, efFromGoal: "ef" };
    const ef = goal({
      id: "ef",
      goal: { id: "ef", targetYear: 2030, target: 7_500, contributionGrowth: 0 },
    });
    expect(fiLevels(input({ fire, goals: [goal(), ef] }))[0]).toBe(7_500);
  });

  it("falls back to efMonths when the efFromGoal goal does not exist", () => {
    expect(fiLevels(input({ fire: { ...FIRE, efFromGoal: "gone" } }))[0]).toBe(12_000);
  });
});

describe("projectFinancialIndependence targets", () => {
  it("keeps L2 = 200,000, L3 = 300,000 and L4 = 400,000 flat in every year when expenseGrowth = 0 (AC-59)", () => {
    const { points } = projectFinancialIndependence(input({ expenseGrowth: 0 }), 1, 10);
    expect(points).toHaveLength(42);
    for (const point of points) {
      expect(point.targets[1]).toBeCloseTo(200_000, 6);
      expect(point.targets[2]).toBeCloseTo(300_000, 6);
      expect(point.targets[3]).toBeCloseTo(400_000, 6);
    }
  });

  it("grows L3 (Lean FIRE) to about 403,000 at t = 10 when expenseGrowth is 3%, whatever the inflation (AC-59)", () => {
    for (const inflation of [0.02, 0.05]) {
      const { points } = projectFinancialIndependence(
        input({ expenseGrowth: 0.03, inflation }),
        1,
        10,
      );
      const ten = points.find((point) => point.t === 10);
      expect(ten?.targets[2]).toBeGreaterThan(402_500);
      expect(ten?.targets[2]).toBeLessThan(403_500);
      expect(points[0]?.targets[2]).toBe(300_000);
    }
  });

  it("puts today at t = 0 and counts real years from asOf, with the stub as the first step", () => {
    const { points } = projectFinancialIndependence(
      input({ asOf: "2026-10-31", goals: [goal({ asOf: "2026-10-31" })] }),
      1,
      5,
    );
    expect(points[0]).toMatchObject({ t: 0, year: 2026 });
    expect(points[1]?.t).toBeCloseTo(2 / 12, 12);
    expect(points[1]?.year).toBe(2026);
    expect(points[2]?.t).toBeCloseTo(2 / 12 + 1, 12);
    expect(points[2]?.year).toBe(2027);
    expect(points[41]?.year).toBe(2066);
    expect(points[41]?.t).toBeCloseTo(2 / 12 + 40, 12);
  });
});

describe("projectFinancialIndependence wealth", () => {
  it("is net of the liquidation tax today and projected, in today's euros (AC-60)", () => {
    // 10,000 with basis 8,000, ETF taxed 26%: today 10,000 - 0.26 x 2,000 = 9,480.
    // mu = 5%: 10,500 after one year, tax 0.26 x 2,500 = 650, net 9,850, deflated by 1.02.
    const projected = input({
      goals: [goal({ products: new Map([["p", { ...etf, mu: 0.05 }]]) })],
    });
    const result = projectFinancialIndependence(projected, 1, 10);
    expect(result.wealthToday).toEqual({ total: 9_480, nonPension: 9_480, pension: 0 });
    expect(result.points[0]?.total).toEqual({
      p10: 9_480,
      p50: 9_480,
      p90: 9_480,
      deterministic: 9_480,
    });
    expect(result.points[2]?.t).toBe(1);
    expect(result.points[2]?.total.deterministic).toBeCloseTo(9_850 / 1.02, 8);
    // With no volatility the median is the deterministic line.
    expect(result.points[2]?.total.p50).toBeCloseTo(9_850 / 1.02, 8);
  });

  it("stops the contributions after the goal's targetYear and keeps compounding", () => {
    // No tax, no growth. 100 a month through 2027 adds 1,200 at the end of 2027, then nothing.
    const flat = input({
      goals: [
        goal({
          goal: { id: "g", targetYear: 2027, target: 5_000, contributionGrowth: 0 },
          monthly: 100,
          settings: { ...settings, taxStd: 0 },
        }),
      ],
    });
    const { points } = projectFinancialIndependence(flat, 1, 5);
    // f = 0: the end of 2026 repeats today (same t, year and wealth); the grid index stays the same for every asOf.
    expect(points[1]).toMatchObject({ t: 0, year: 2026 });
    expect(points[1]?.total.deterministic).toBe(points[0]?.total.deterministic);
    expect(points[1]?.total.deterministic).toBeCloseTo(10_000, 8);
    expect(points[2]?.total.deterministic).toBeCloseTo(11_200 / 1.02, 8); // end of 2027
    expect(points[10]?.total.deterministic).toBeCloseTo(11_200 / 1.02 ** 9, 8);
    expect(points[41]?.t).toBe(40);
    expect(points[41]?.total.deterministic).toBeCloseTo(11_200 / 1.02 ** 40, 8);
  });

  it("removes a goal whose countsTowardFi is off (AC-60)", () => {
    const other = goal({
      id: "h",
      countsTowardFi: false,
      positions: [{ productId: "p", value: 50_000, basis: 50_000 }],
    });
    const result = projectFinancialIndependence(input({ goals: [goal(), other] }), 1, 10);
    expect(result.wealthToday.total).toBe(9_480);
    expect(result.points[3]?.total.p50).toBeCloseTo(9_480 / 1.02 ** 2, 8);
    const ticked = projectFinancialIndependence(
      input({ goals: [goal(), { ...other, countsTowardFi: true }] }),
      1,
      10,
    );
    expect(ticked.wealthToday.total).toBe(9_480 + 50_000);
  });
});

describe("projectFinancialIndependence pension", () => {
  const pensionGoal = goal({
    id: "pen",
    goal: { id: "pen", targetYear: 2040, target: 100_000, contributionGrowth: 0 },
    positions: [{ productId: "fund", value: 10_000, basis: 8_000 }],
    products: new Map([["fund", pensionFund]]),
    weights: new Map(),
    firstYear: 2020,
  });
  const plain = goal({ positions: [{ productId: "p", value: 10_000, basis: 10_000 }] });

  it("includes the pension net of its exit tax by default and splits it from the rest (AC-60)", () => {
    // 2026 - 2020 = 6 years: rate 15%. Exit tax 0.15 x 8,000 = 1,200: net 8,800.
    const result = projectFinancialIndependence(
      input({ goals: [plain, pensionGoal], pensionGoalId: "pen" }),
      1,
      10,
    );
    expect(result.wealthToday).toEqual({ total: 18_800, nonPension: 10_000, pension: 8_800 });
  });

  it("leaves the pension out when includePension is off", () => {
    const result = projectFinancialIndependence(
      input({
        goals: [plain, pensionGoal],
        pensionGoalId: "pen",
        fire: { ...FIRE, includePension: false },
      }),
      1,
      10,
    );
    expect(result.wealthToday).toEqual({ total: 10_000, nonPension: 10_000, pension: 0 });
    expect(result.points[5]?.total.p50).toBeCloseTo(10_000 / 1.02 ** 4, 8);
  });

  it("uses the exit-tax rate of the projected year", () => {
    // 2040 - 2020 - 15 = 5 extra years: 15% - 1.5% = 13.5%. The point of 2040 is k = 15 (k = 1 is 2026).
    const result = projectFinancialIndependence(
      input({ goals: [pensionGoal], pensionGoalId: "pen" }),
      1,
      10,
    );
    expect(result.points[15]?.year).toBe(2040);
    expect(result.points[15]?.total.deterministic).toBeCloseTo(
      (10_000 - 0.135 * 8_000) / 1.02 ** 14,
      8,
    );
  });

  it("measures Level 1 progress on the wealth without the pension bucket (AC-60)", () => {
    // Level 1 = 12 x 1,000 = 12,000. Without pension: 10,000 / 12,000. With it, 18,800 / 300,000 is for Lean FIRE (level index 2).
    const result = projectFinancialIndependence(
      input({ goals: [plain, pensionGoal], pensionGoalId: "pen" }),
      1,
      10,
    );
    const today = result.points[0];
    expect(today?.progress[0]).toBeCloseTo(10_000 / 12_000, 12);
    expect(today?.progress[2]).toBeCloseTo(18_800 / 300_000, 12);
    expect(today?.nonPension.p50).toBe(10_000);
    expect(today?.total.p50).toBe(18_800);
  });
});

describe("projectFinancialIndependence reaching a level", () => {
  const climbing = input({
    goals: [
      goal({
        goal: { id: "g", targetYear: 2030, target: 5_000, contributionGrowth: 0 },
        monthly: 1_000,
        settings: { ...settings, taxStd: 0 },
      }),
    ],
    optional: 0,
  });

  it("gives the first year the median and the deterministic line reach each level, null when never", () => {
    // Level 1 = 12,000. 10,000 now and at the end of 2026; 22,000 at the end of 2027 (deflated 21,568).
    const { reached, points } = projectFinancialIndependence(climbing, 1, 10);
    expect(points[0]?.progress[0]).toBeLessThan(1);
    expect(points[1]?.progress[0]).toBeLessThan(1);
    expect(points[2]?.progress[0]).toBeGreaterThan(1);
    expect(reached[0]).toEqual({ median: 2027, deterministic: 2027 });
    // 200,000 is far above 10,000 + 4 x 12,000.
    expect(reached[1]).toEqual({ median: null, deterministic: null });
  });

  it("reports P(reached) as 0 or 1 with no volatility, and divides the median by the target", () => {
    const { points } = projectFinancialIndependence(climbing, 1, 10);
    expect(points[1]?.pReached[0]).toBe(0);
    expect(points[2]?.pReached[0]).toBe(1);
    expect(points[2]?.progress[0]).toBeCloseTo(22_000 / 1.02 / 12_000, 10);
  });

  it("reaches a level at Y0 with progress null when its target is 0", () => {
    const { reached, points } = projectFinancialIndependence(
      input({ essential: 0, optional: 0 }),
      1,
      10,
    );
    expect(reached[1]).toEqual({ median: 2026, deterministic: 2026 });
    expect(points[0]?.progress[1]).toBeNull();
    expect(points[0]?.pReached[1]).toBe(1);
  });
});

describe("projectFinancialIndependence Monte Carlo", () => {
  const risky = input({
    goals: [
      goal({
        goal: { id: "g", targetYear: 2040, target: 5_000, contributionGrowth: 0 },
        monthly: 300,
        products: new Map([["p", { ...etf, mu: 0.06, sigma: 0.15 }]]),
      }),
    ],
    correlations: [
      [1, 0, 0.3, 0.85, 0, 0.1],
      [0, 1, 0.6, 0.4, 0, 0.2],
      [0.3, 0.6, 1, 0.55, 0, 0.1],
      [0.85, 0.4, 0.55, 1, 0, 0.15],
      [0, 0, 0, 0, 1, 0],
      [0.1, 0.2, 0.1, 0.15, 0, 1],
    ],
  });

  it("gives identical outputs for the same seed and different ones for another", () => {
    const a = projectFinancialIndependence(risky, 7, 200);
    expect(projectFinancialIndependence(risky, 7, 200)).toEqual(a);
    expect(projectFinancialIndependence(risky, 8, 200)).not.toEqual(a);
  });

  it("orders P10 <= P50 <= P90 and keeps P(reached) in [0, 1]", () => {
    const { points } = projectFinancialIndependence(risky, 7, 300);
    for (const point of points) {
      expect(point.total.p10).toBeLessThanOrEqual(point.total.p50);
      expect(point.total.p50).toBeLessThanOrEqual(point.total.p90);
      for (const p of point.pReached) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
    expect(points[41]?.total.p90).toBeGreaterThan(points[41]?.total.p10 as number);
  });

  it("reads the same shocks as runMonteCarlo: at the goal date the median is the goal's own", () => {
    const asOf = "2026-10-31";
    const due = goal({
      asOf,
      goal: { id: "g", targetYear: 2030, target: 5_000, contributionGrowth: 0.02 },
      monthly: 200,
      products: new Map([["p", { ...etf, mu: 0.06, sigma: 0.15 }]]),
    });
    const inputs = { ...risky, asOf, goals: [due] };
    const fi = projectFinancialIndependence(inputs, 11, 200);
    const mc = runMonteCarlo({ goals: [due], correlations: risky.correlations }, 11, 200);
    const point = fi.points[5];
    expect(point?.year).toBe(2030);
    expect((point?.total.p50 as number) * 1.02 ** (point?.t as number)).toBeCloseTo(
      mc.goals[0]?.p50.at(-1) as number,
      6,
    );
  });
});
