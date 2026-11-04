import { describe, expect, it } from "vitest";
import type { GoalListRow } from "./goalViews.ts";
import { keyNumbersOf, netWorthByGoal, weakestGoal } from "./overviewView.ts";
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

describe("weakestGoal", () => {
  const row = (id: string, pSuccess: number | null, requiredP = 0.8): GoalListRow => ({
    id,
    name: id,
    priority: "Need",
    slot: 2,
    target: 1,
    value: 0,
    missingPrices: false,
    outlook: pSuccess === null ? null : { status: "on_track", pSuccess, requiredP },
  });

  it("picks the goal furthest below its required probability", () => {
    expect(weakestGoal([row("a", 0.9), row("b", 0.5), row("c", 0.7)])?.id).toBe("b");
  });

  it("skips goals that cannot be analysed, and returns undefined when none can", () => {
    expect(weakestGoal([row("a", null), row("b", 0.9)])?.id).toBe("b");
    expect(weakestGoal([row("a", null)])).toBeUndefined();
  });
});
