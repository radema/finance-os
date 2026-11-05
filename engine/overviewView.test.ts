import { describe, expect, it } from "vitest";
import { keyNumbersOf, netWorthByGoal, rangeRows } from "./overviewView.ts";
import type { PerformancePoint } from "./trackingViews.ts";

const point = (month: string, value: number, moneyIn: number): PerformancePoint => ({
  month,
  value,
  moneyIn,
  index: 100,
  drawdown: 0,
  twrMonthly: null,
});

describe("keyNumbersOf", () => {
  const twr = { sinceStart: 0.1, ytd: 0.04, last12m: 0.08 };
  const summary = { value: 1_300, moneyIn: 1_200, gain: 100, twr, xirr: null, maxDrawdown: 0 };

  it("takes the market change as V(m) - V(m-1) - F(m)", () => {
    // 1000 -> 1300 while 200 more was put in: the market moved it by 100.
    const months = [point("2026-09", 1_000, 1_000), point("2026-10", 1_300, 1_200)];
    expect(keyNumbersOf(months, summary, 5_000)).toEqual({
      netWorth: 1_300,
      marketChange: 100,
      ytdTwr: 0.04,
      fiWealth: 5_000,
    });
  });

  it("counts a withdrawal as a negative flow", () => {
    const months = [point("2026-09", 1_000, 1_000), point("2026-10", 800, 900)];
    expect(keyNumbersOf(months, { ...summary, value: 800 }, null).marketChange).toBe(-100);
  });

  it("has no market change with a single month, and nothing without a summary", () => {
    expect(keyNumbersOf([point("2026-10", 1_300, 1_200)], summary, null).marketChange).toBeNull();
    expect(keyNumbersOf([], null, null)).toEqual({
      netWorth: null,
      marketChange: null,
      ytdTwr: null,
      fiWealth: null,
    });
  });
});

describe("netWorthByGoal", () => {
  const goals = [
    { goalId: "a", name: "A", slot: 2 },
    { goalId: "b", name: "B", slot: 3 },
  ];
  const series = new Map([
    [
      "a",
      [
        { month: "2026-01", value: 100, moneyIn: 90 },
        { month: "2026-02", value: 110, moneyIn: 100 },
        { month: "2026-03", value: null, moneyIn: 100 },
      ],
    ],
    ["b", [{ month: "2026-02", value: 50, moneyIn: 40 }]],
  ]);

  it("aligns the goals on one month axis and sums the money put in", () => {
    const view = netWorthByGoal(goals, series, "2026-03");
    expect(view.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(view.goals.map((g) => g.values)).toEqual([
      [100, 110, 0],
      [0, 50, 0],
    ]);
    expect(view.moneyIn).toEqual([90, 140, 140]);
  });

  it("is empty when no goal has a transaction", () => {
    expect(netWorthByGoal(goals, new Map(), "2026-03")).toEqual({
      months: [],
      goals: [],
      moneyIn: [],
    });
  });
});

describe("rangeRows", () => {
  const entry = (goalId: string, bad: number, typical: number, good: number, target: number) => ({
    goalId,
    name: goalId,
    slot: 2,
    range: { bad, typical, good, target },
  });

  it("gives bad, typical and good case as shares of the goal's own target", () => {
    const view = rangeRows([
      entry("home", 51_441, 63_512, 76_215, 44_309),
      entry("hol", 6, 6, 6, 3),
    ]);
    const [home, hol] = view?.rows ?? [];
    expect(home?.bad).toBeCloseTo(51_441 / 44_309, 10);
    expect(home?.typical).toBeCloseTo(63_512 / 44_309, 10);
    expect(home?.good).toBeCloseTo(76_215 / 44_309, 10);
    expect(hol).toMatchObject({ bad: 2, typical: 2, good: 2, flat: true });
    expect(home?.flat).toBe(false);
  });

  it("calls a goal flat from its euro range, to the cent", () => {
    const view = rangeRows([entry("a", 2_004.89, 2_004.89, 2_004.89, 3_000)]);
    expect(view?.rows[0]).toMatchObject({ flat: true });
    expect(view?.rows[0]?.bad).toBeCloseTo(2_004.89 / 3_000, 10);
  });

  it("fits one axis to every goal and the 100% line", () => {
    // Holiday 67%, Retirement up to 175%: the lowest bad case is 67% of the highest good case.
    const view = rangeRows([
      entry("hol", 2_005, 2_005, 2_005, 3_000),
      entry("car", 9_600, 10_500, 11_500, 10_000),
      entry("ret", 98_000, 128_000, 175_000, 100_000),
    ]);
    const axis = view?.axis;
    expect(axis?.min).toBeGreaterThan(0);
    expect(axis?.min).toBeLessThanOrEqual(2_005 / 3_000);
    expect(axis?.max).toBeGreaterThanOrEqual(1.75);
  });

  it("starts at 0 when the lowest bad case is at most 20% of the highest good case", () => {
    const view = rangeRows([entry("a", 100, 400, 900, 500), entry("b", 400, 500, 600, 500)]);
    expect(view?.axis.min).toBe(0);
  });

  it("is null without a range, and skips a goal whose target is not above 0", () => {
    expect(rangeRows([])).toBeNull();
    expect(rangeRows([entry("a", 1, 1, 1, 0)])).toBeNull();
  });
});
