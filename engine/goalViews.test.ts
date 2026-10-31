import { describe, expect, it } from "vitest";
import type { GoalWorld, GoalWorldProduct } from "./goalViews.ts";
import { detailOf, seriesOf, summaryOf } from "./goalViews.ts";
import { settingsSchema } from "./schemas.ts";
import { timeGrid } from "./timeGrid.ts";

const etf: GoalWorldProduct = {
  id: "etf",
  name: "World ETF",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.05,
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
    const { tau } = timeGrid("2026-03-31", 2035);
    expect(detailOf(w, goalOf(w)).targetAtGoalDate).toBeCloseTo(10_000 * 1.02 ** tau, 6);
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
