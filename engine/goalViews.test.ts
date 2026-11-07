import { describe, expect, it } from "vitest";
import type { GoalWorld, GoalWorldProduct } from "./goalViews.ts";
import { analysisOf, detailOf, listRowsOf, seriesOf, summaryOf } from "./goalViews.ts";
import { DEFAULT_CORRELATIONS, settingsSchema } from "./schemas.ts";

const etf: GoalWorldProduct = {
  id: "etf",
  name: "World ETF",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.05,
  volatility: 0.15,
  assetClass: "Equity",
  ter: 0.002,
  couponRate: 0,
};
const fund: GoalWorldProduct = { ...etf, id: "fund", name: "Pension fund", regime: "pension" };

const buy = (date: string, productId: string, qty: number, price: number, commission = 0) =>
  ({ date, goalId: "g1", productId, type: "buy", qty, price, commission, amount: 0 }) as const;

// Valuation month 2026-03. Ledger: 10 units at 10 + 1 commission (cost 101), 5 units at 11 (cost 55),
// then a coupon of 3 euros. PMC = 156 / 15 = 10.4. Prices: 10, 11, 12.
const world = (overrides: Partial<GoalWorld> = {}): GoalWorld => ({
  products: new Map([[etf.id, etf]]),
  goals: [
    {
      id: "g1",
      name: "House",
      priority: "Need",
      target: 10_000,
      targetYear: 2035,
      contributionGrowth: 0,
      minProb: null,
    },
  ],
  plans: [],
  weights: [{ goalId: "g1", productId: "etf", weight: 1 }],
  ledger: [
    buy("2026-01-15", "etf", 10, 10, 1),
    buy("2026-02-10", "etf", 5, 11),
    { ...buy("2026-03-05", "etf", 0, 0), type: "coupon", amount: 3 },
  ],
  settings: settingsSchema.parse({}),
  correlations: DEFAULT_CORRELATIONS,
  pension: undefined,
  voluntaryYtdCents: 0,
  month: "2026-03",
  prices: new Map([
    [
      "etf",
      [
        { month: "2026-01", price: 10 },
        { month: "2026-02", price: 11 },
        { month: "2026-03", price: 12 },
      ],
    ],
  ]),
  ...overrides,
});

const goalOf = (w: GoalWorld) => {
  const [goal] = w.goals;
  if (!goal) throw new Error("no goal");
  return goal;
};

describe("summaryOf", () => {
  it("values the held units at the latest price and gives the target in euros", () => {
    const w = world();
    expect(summaryOf(w, goalOf(w))).toEqual({
      id: "g1",
      name: "House",
      priority: "Need",
      slot: 2,
      target: 10_000,
      value: 180,
      missingPrices: false,
    });
  });

  it("leaves out a held product that has no price and says so", () => {
    const w = world({
      products: new Map([
        [etf.id, etf],
        [fund.id, fund],
      ]),
      ledger: [...world().ledger, buy("2026-02-20", "fund", 2, 50)],
    });
    expect(summaryOf(w, goalOf(w))).toMatchObject({ value: 180, missingPrices: true });
  });
});

describe("seriesOf", () => {
  it("gives value and money put in at each month end, a coupon taking money out", () => {
    expect(seriesOf(world(), "g1")).toEqual([
      { month: "2026-01", value: 100, moneyIn: 101 },
      { month: "2026-02", value: 165, moneyIn: 156 },
      { month: "2026-03", value: 180, moneyIn: 153 },
    ]);
  });

  it("is empty for a goal with no transaction", () => {
    expect(seriesOf(world(), "other")).toEqual([]);
  });

  it("has a null value from the month a held product has no price yet", () => {
    const w = world({ prices: new Map([["etf", [{ month: "2026-02", price: 11 }]]]) });
    expect(seriesOf(w, "g1").map((point) => point.value)).toEqual([null, 165, 165]);
  });
});

describe("detailOf", () => {
  it("lists the holding with PMC, gain and its tax, and projects the goal", () => {
    const w = world();
    const detail = detailOf(w, goalOf(w));
    expect(detail).toMatchObject({
      id: "g1",
      targetYear: 2035,
      asOf: "2026-03-31",
      value: 180,
      projectionNote: null,
    });
    expect(detail.holdings).toHaveLength(1);
    const [row] = detail.holdings;
    expect(row).toMatchObject({ productId: "etf", units: 15, price: 12, value: 180 });
    expect(row?.pmc).toBeCloseTo(10.4, 10);
    expect(row?.gain).toBeCloseTo(24, 10);
    // An ETF gain is taxed at the standard rate, 26%.
    expect(row?.taxIfSold).toBeCloseTo(24 * 0.26, 10);
    expect(detail.taxIfSoldTotal).toBeCloseTo(24 * 0.26, 10);
    expect(detail.series).toEqual(seriesOf(w, "g1"));
  });

  it("grows the target by inflation to the goal date", () => {
    const w = world();
    // tau = 9/12 left in 2026 + 9 full years = 9.75, so 10,000 x 1.02^9.75 = 12,129.7451.
    expect(detailOf(w, goalOf(w)).targetAtGoalDate).toBeCloseTo(12_129.7451, 3);
  });

  it("projects a gross, a tax and a net at the goal date", () => {
    const w = world();
    const projection = detailOf(w, goalOf(w)).projection;
    expect(projection).not.toBeNull();
    expect(projection?.gross).toBeGreaterThan(180);
    expect(projection?.net).toBeCloseTo((projection?.gross ?? 0) - (projection?.tax ?? 0), 10);
  });

  it("shows no projection and no tax when a held product has no price", () => {
    const w = world({
      products: new Map([
        [etf.id, etf],
        [fund.id, fund],
      ]),
      ledger: [...world().ledger, buy("2026-02-20", "fund", 2, 50)],
    });
    expect(detailOf(w, goalOf(w))).toMatchObject({
      projection: null,
      projectionNote: "A held product has no price, so the projection is not shown.",
      taxIfSoldTotal: null,
    });
  });

  it("shows no projection when a pension product has no first year of membership", () => {
    const w = world({
      products: new Map([[fund.id, fund]]),
      ledger: [buy("2026-01-15", "fund", 4, 25)],
      prices: new Map([["fund", [{ month: "2026-03", price: 25 }]]]),
      weights: [{ goalId: "g1", productId: "fund", weight: 1 }],
    });
    expect(detailOf(w, goalOf(w))).toMatchObject({
      projection: null,
      projectionNote:
        "The pension plan has no first year of membership, so the exit tax and the net are not shown.",
      taxIfSoldTotal: null,
    });
    expect(detailOf(w, goalOf(w)).holdings[0]?.taxIfSold).toBeNull();
  });
});

// The same world with no volatility: every path is the deterministic one, so P is 0 or 1.
const calm = (
  overrides: Partial<GoalWorld> = {},
  target = 10_000,
  minProb: number | null = null,
) => {
  const [goal] = world().goals;
  if (!goal) throw new Error("no goal");
  return world({
    products: new Map([[etf.id, { ...etf, volatility: 0 }]]),
    goals: [{ ...goal, target, minProb }],
    ...overrides,
  });
};

const analysis = (w: GoalWorld) => {
  const result = analysisOf(w, goalOf(w));
  if (!result) throw new Error("no analysis");
  return result;
};

describe("analysisOf", () => {
  it("has the median equal to the deterministic net when volatility is 0 (AC-53)", () => {
    const w = calm();
    const net = detailOf(w, goalOf(w)).projection?.net ?? Number.NaN;
    const { range, fan } = analysis(w);
    expect(range.typical).toBeCloseTo(net, 6);
    expect(range.bad).toBeCloseTo(net, 6);
    expect(range.good).toBeCloseTo(net, 6);
    expect(fan.at(-1)?.typical).toBeCloseTo(net, 6);
  });

  it("bins the simulated outcomes across an axis that holds the range and the target", () => {
    const { distribution, range, paths } = analysis(world());
    expect(distribution.min).toBeLessThanOrEqual(Math.min(range.bad, range.target));
    expect(distribution.max).toBeGreaterThanOrEqual(Math.max(range.good, range.target));
    const counted = distribution.counts.reduce((sum, n) => sum + n, 0);
    expect(counted).toBeGreaterThan(paths * 0.8);
    expect(counted).toBeLessThanOrEqual(paths);
    expect(analysis(world()).distribution).toEqual(distribution);
  });

  it("gives one fan point per year from the valuation year to the goal year", () => {
    const { fan } = analysis(world());
    expect(fan.map((point) => point.year)).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035,
    ]);
    for (const point of fan) {
      expect(point.bad).toBeLessThanOrEqual(point.typical);
      expect(point.typical).toBeLessThanOrEqual(point.good);
    }
  });

  it("is on track when P reaches the required probability, off track far below it (AC-58)", () => {
    // The net is a few hundred euros. A target of 100 is met on every path, 10,000 on none.
    expect(analysis(calm({}, 100))).toMatchObject({
      pSuccess: 1,
      requiredP: 0.9,
      status: "on_track",
    });
    expect(analysis(calm())).toMatchObject({ pSuccess: 0, requiredP: 0.9, status: "off_track" });
  });

  it("lets the goal's minProb override the priority default, and is at risk within 15 points (AC-58)", () => {
    expect(analysis(calm({}, 10_000, 0.1))).toMatchObject({
      pSuccess: 0,
      requiredP: 0.1,
      status: "at_risk",
    });
  });

  it("finds the monthly amount that reaches the target, and not one cent less (AC-57)", () => {
    const w = calm();
    const { required } = analysis(w);
    expect(required.unit).toBe("monthly");
    const amount = required.deterministic ?? Number.NaN;
    const netWith = (monthly: number) => {
      const planned = calm({ plans: [{ goalId: "g1", fromMonth: "2026-01", monthly }] });
      const projection = detailOf(planned, goalOf(planned));
      return projection.projection?.net ?? Number.NaN;
    };
    const target = detailOf(w, goalOf(w)).targetAtGoalDate;
    expect(netWith(amount)).toBeGreaterThanOrEqual(target);
    expect(netWith(amount - 0.02)).toBeLessThan(target);
    // With no volatility the required probability is met exactly when the target is met.
    expect(required.probability).toBeCloseTo(amount, 2);
  });

  it("gives null when the target cannot be reached, for both amounts (AC-57)", () => {
    const { required } = analysis(calm({}, 1e15));
    expect(required).toMatchObject({ deterministic: null, probability: null });
  });

  it("gives 0 when the goal is met with no contribution", () => {
    expect(analysis(calm({}, 100)).required).toMatchObject({ deterministic: 0, probability: 0 });
  });

  it("gives the horizon in years and the monthly plan in force", () => {
    const w = calm({ plans: [{ goalId: "g1", fromMonth: "2026-01", monthly: 150 }] });
    const result = analysis(w);
    // 9 months left in 2026 plus 9 full years.
    expect(result.horizonYears).toBeCloseTo(9.75, 10);
    expect(result.required.currentMonthly).toBe(150);
  });

  it("is the same for the list and the detail: one seed, shared shocks", () => {
    const w = world();
    expect(listRowsOf(w)[0]?.outlook?.pSuccess).toBe(analysis(w).pSuccess);
  });

  it("is null when a held product has no price (list and detail)", () => {
    const w = world({
      products: new Map([
        [etf.id, etf],
        [fund.id, fund],
      ]),
      ledger: [...world().ledger, buy("2026-02-20", "fund", 2, 50)],
    });
    expect(analysisOf(w, goalOf(w))).toBeNull();
    expect(listRowsOf(w)[0]?.outlook).toBeNull();
  });

  it("uses the seed of the settings: the same seed gives the same P, another seed may not", () => {
    const seeded = (seed: number) =>
      analysis(world({ settings: settingsSchema.parse({ seed }) })).range;
    expect(seeded(7)).toEqual(seeded(7));
    expect(seeded(7)).not.toEqual(seeded(8));
  });
});
