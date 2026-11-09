import { describe, expect, it } from "vitest";
import type { PerformanceInput, PerformanceTransaction } from "./performance.ts";
import { computePerformance, performanceScopes } from "./performance.ts";

const etf = { id: "etf", regime: "etf" } as const;
const btp = { id: "btp", regime: "govt" } as const;
const fund = { id: "fund", regime: "pension" } as const;

const tx = (
  date: string,
  type: PerformanceTransaction["type"],
  productId: string,
  qty: number,
  price: number,
  extra: Partial<PerformanceTransaction> = {},
  goalId = "g1",
): PerformanceTransaction => ({ date, goalId, productId, type, qty, price, ...extra });

/** Month-end prices of one product, from `first` (YYYY-MM) on. */
const series = (productId: string, first: string, prices: number[]) =>
  prices.map((price, i) => {
    const index = Number(first.slice(5, 7)) - 1 + i;
    const year = Number(first.slice(0, 4)) + Math.floor(index / 12);
    return { productId, month: `${year}-${String((index % 12) + 1).padStart(2, "0")}`, price };
  });

const all = { kind: "all" } as const;

// Golden case, 12 months of 2025, bucket g1. Expected values were worked out outside the engine:
// V(m) = Σ units × price (the bond is quoted per 100); F(m) = Σ cash of the month's transactions.
//   Jan  opening 100 etf @10 (1000) + buy 500 btp @100 (500)      V 1500   F 1500
//   Jun  buy 50 etf @12 + 5 commission                            V 2300   F 605
//   Sep  coupon of 15 on the bond: an outflow                     V 2600   F -15
//   Nov  sell 30 etf @14                                          V 2185   F -420
//   Mar: V = 100 × 12 + 500 × 0.99 = 1695, r = 1695 / 1600 − 1.
// The index chains r(m) from 100: Mar 113, Apr 93, May 100, Jun 113, Dec 143.1566.
const golden: PerformanceInput = {
  transactions: [
    tx("2025-01-10", "opening", "etf", 100, 10),
    tx("2025-01-10", "buy", "btp", 500, 100),
    tx("2025-06-15", "buy", "etf", 50, 12, { commission: 5 }),
    tx("2025-09-30", "coupon", "btp", 0, 0, { amount: 15 }),
    tx("2025-11-20", "sell", "etf", -30, 14),
  ],
  prices: [
    ...series("etf", "2025-01", [10, 11, 12, 9, 10, 12, 13, 13, 14, 15, 14, 16]),
    ...series("btp", "2025-01", [100, 100, 99, 99, 100, 100, 101, 101, 100, 100, 101, 102]),
  ],
  products: [etf, btp],
  scope: all,
  valuationMonth: "2025-12",
};

describe("computePerformance, golden 12-month ledger", () => {
  const result = computePerformance(golden);

  it("values each month from units and month-end prices, bonds per 100", () => {
    expect(result.months.map((m) => m.month)).toHaveLength(12);
    expect(result.months.map((m) => m.value)).toEqual([
      1500, 1600, 1695, 1395, 1500, 2300, 2455, 2455, 2600, 2750, 2185, 2430,
    ]);
  });

  it("counts openings and commissions in F(m) and the coupon as an outflow", () => {
    expect(result.months.map((m) => m.flow)).toEqual([
      1500, 0, 0, 0, 0, 605, 0, 0, -15, 0, -420, 0,
    ]);
  });

  it("chains the monthly returns into the index", () => {
    expect(result.months[0]?.twrMonthly).toBeNull();
    expect(result.months[2]?.twrMonthly).toBeCloseTo(1695 / 1600 - 1, 10);
    expect(result.months.map((m) => m.index).slice(0, 6)).toEqual([
      100,
      expect.closeTo(106.6667, 3),
      expect.closeTo(113, 6),
      expect.closeTo(93, 6),
      expect.closeTo(100, 6),
      expect.closeTo(113, 6),
    ]);
  });

  it("gives TWR and XIRR within 0.01 percentage points of the hand-checked values", () => {
    expect(result.twr.sinceStart).toBeCloseTo(0.43157, 4);
    expect(result.xirr).toBeCloseTo(0.44439, 4);
  });
});

describe("coupon", () => {
  it("is cash out of the scope: a flat 100 holding that pays 5 returns 5%", () => {
    const result = computePerformance({
      transactions: [
        tx("2025-01-05", "buy", "etf", 10, 10),
        tx("2025-02-10", "coupon", "etf", 0, 0, { amount: 5 }),
      ],
      prices: series("etf", "2025-01", [10, 10]),
      products: [etf],
      scope: all,
      valuationMonth: "2025-02",
    });
    expect(result.months[1]?.flow).toBe(-5);
    expect(result.months[1]?.twrMonthly).toBeCloseTo(0.05, 10);
  });

  it("is an input error when it has no amount", () => {
    expect(() =>
      computePerformance({
        transactions: [
          tx("2025-01-05", "buy", "etf", 10, 10),
          tx("2025-02-10", "coupon", "etf", 0, 0),
        ],
        prices: series("etf", "2025-01", [10, 10]),
        products: [etf],
        scope: all,
        valuationMonth: "2025-02",
      }),
    ).toThrow(/coupon .* has no amount/);
  });
});

describe("zero previous value", () => {
  it("gives no return and no division by zero", () => {
    // Buy in Jan, sell all in Feb (V = 0), buy again in Mar and Apr.
    const result = computePerformance({
      transactions: [
        tx("2025-01-05", "buy", "etf", 10, 10),
        tx("2025-02-05", "sell", "etf", -10, 11),
        tx("2025-03-05", "buy", "etf", 10, 12),
      ],
      prices: series("etf", "2025-01", [10, 11, 12, 15]),
      products: [etf],
      scope: all,
      valuationMonth: "2025-04",
    });
    expect(result.months.map((m) => m.value)).toEqual([100, 0, 120, 150]);
    // Feb: (0 − (−110)) / 100 − 1 = 10%. Mar: V(Feb) = 0, so no return. Apr: 150 / 120 − 1.
    expect(result.months.map((m) => m.twrMonthly)).toEqual([
      null,
      expect.closeTo(0.1, 10),
      null,
      0.25,
    ]);
    expect(result.months.map((m) => m.index)).toEqual([
      100,
      expect.closeTo(110, 8),
      expect.closeTo(110, 8),
      expect.closeTo(137.5, 8),
    ]);
    for (const m of result.months) expect(Number.isFinite(m.index)).toBe(true);
  });
});

describe("drawdown", () => {
  it("is index / running max − 1 on a series with a peak and a fall", () => {
    // One unit bought at 100, no flows after: the index follows the price.
    const result = computePerformance({
      transactions: [tx("2025-01-05", "buy", "etf", 1, 100)],
      prices: series("etf", "2025-01", [100, 120, 90, 108, 130]),
      products: [etf],
      scope: all,
      valuationMonth: "2025-05",
    });
    expect(result.months.map((m) => m.index)).toEqual(
      [100, 120, 90, 108, 130].map((v) => expect.closeTo(v, 8)),
    );
    // Peak 120, then 90 / 120 − 1 = −25%, then 108 / 120 − 1 = −10%, then a new peak.
    expect(result.months.map((m) => m.drawdown)).toEqual([
      0,
      0,
      expect.closeTo(-0.25, 10),
      expect.closeTo(-0.1, 10),
      0,
    ]);
    expect(result.maxDrawdown).toBeCloseTo(-0.25, 10);
  });
});

describe("windows", () => {
  // One unit at 100 in 2024-01, growing 1% a month for 26 months: every monthly return is 1%.
  const prices = series(
    "etf",
    "2024-01",
    Array.from({ length: 26 }, (_, i) => 100 * 1.01 ** i),
  );
  const at = (valuationMonth: string) =>
    computePerformance({
      transactions: [tx("2024-01-05", "buy", "etf", 1, 100)],
      prices,
      products: [etf],
      scope: all,
      valuationMonth,
    }).twr;

  it("chains the months of since start, the year to date and the last 12 months", () => {
    const twr = at("2025-02");
    expect(twr.sinceStart).toBeCloseTo(1.01 ** 13 - 1, 10);
    expect(twr.ytd).toBeCloseTo(1.01 ** 2 - 1, 10);
    expect(twr.last12m).toBeCloseTo(1.01 ** 12 - 1, 10);
  });

  it("falls back to the months that exist when the history is short", () => {
    const twr = at("2024-04");
    expect(twr.sinceStart).toBeCloseTo(1.01 ** 3 - 1, 10);
    expect(twr.ytd).toBeCloseTo(1.01 ** 3 - 1, 10);
    expect(twr.last12m).toBeCloseTo(1.01 ** 3 - 1, 10);
  });
});

describe("XIRR", () => {
  it("is 10% for 100 put in and 110 a year later", () => {
    const result = computePerformance({
      transactions: [tx("2024-12-31", "buy", "etf", 1, 100)],
      prices: series("etf", "2024-12", [100, ...Array.from({ length: 11 }, () => 100), 110]),
      products: [etf],
      scope: all,
      valuationMonth: "2025-12",
    });
    expect(result.xirr).toBeCloseTo(0.1, 4);
  });

  it("is null when no rate fits: money only goes in and the value ends at 0", () => {
    const result = computePerformance({
      transactions: [tx("2025-01-05", "buy", "etf", 1, 100)],
      prices: series("etf", "2025-01", [100, 0]),
      products: [etf],
      scope: all,
      valuationMonth: "2025-02",
    });
    expect(result.xirr).toBeNull();
  });
});

describe("missing price", () => {
  const base = {
    transactions: [tx("2025-01-05", "buy", "etf", 10, 10)],
    products: [etf],
    scope: all,
    valuationMonth: "2025-03",
  } as const;

  it("carries the previous price of a held product", () => {
    const result = computePerformance({ ...base, prices: series("etf", "2025-01", [10, 12]) });
    expect(result.months.map((m) => m.value)).toEqual([100, 120, 120]);
  });

  it("is an input error when the product has no price yet", () => {
    expect(() => computePerformance({ ...base, prices: [] })).toThrow(/no price for etf/);
  });
});

describe("scopes", () => {
  const input: PerformanceInput = {
    transactions: [
      tx("2025-01-05", "buy", "etf", 10, 10, {}, "g1"),
      tx("2025-01-05", "buy", "etf", 5, 10, {}, "g2"),
      tx("2025-01-20", "pensionContribution", "fund", 4, 20, {}, "gp"),
      tx("2025-02-10", "buy", "etf", 5, 11, {}, "g1"),
    ],
    prices: [...series("etf", "2025-01", [10, 11, 12]), ...series("fund", "2025-01", [20, 21, 22])],
    products: [etf, fund],
    scope: all,
    valuationMonth: "2025-03",
  };
  const valuesOf = (scope: PerformanceInput["scope"]) =>
    computePerformance({ ...input, scope }).months.map((m) => m.value);

  it("lists all, all except pension and each bucket", () => {
    expect(performanceScopes(input.transactions)).toEqual([
      { kind: "all" },
      { kind: "allExceptPension" },
      { kind: "bucket", goalId: "g1" },
      { kind: "bucket", goalId: "g2" },
      { kind: "bucket", goalId: "gp" },
    ]);
  });

  it("includes cash-only source and destination buckets in scopes", () => {
    expect(performanceScopes([], [{ goalId: "cash-source", toGoalId: "cash-target" }])).toEqual([
      { kind: "all" },
      { kind: "allExceptPension" },
      { kind: "bucket", goalId: "cash-source" },
      { kind: "bucket", goalId: "cash-target" },
    ]);
  });

  it("returns a series for each kind of scope", () => {
    expect(valuesOf(all)).toEqual([230, 304, 328]);
    expect(valuesOf({ kind: "allExceptPension" })).toEqual([150, 220, 240]);
    expect(valuesOf({ kind: "bucket", goalId: "g1" })).toEqual([100, 165, 180]);
  });

  it("sums the bucket values to the all value", () => {
    const sums = ["g1", "g2", "gp"].map((goalId) => valuesOf({ kind: "bucket", goalId }));
    const total = valuesOf(all);
    // The pension bucket starts in Jan too, so every series has the same months.
    expect(total.map((_, i) => sums.reduce((s, v) => s + (v[i] ?? 0), 0))).toEqual(total);
  });
});
