import { describe, expect, it } from "vitest";
import type { PerformanceResult } from "./performance.ts";
import type { PlanVsActualGoal } from "./planVsActual.ts";
import { performanceOf, totalOf } from "./trackingViews.ts";

describe("performanceOf", () => {
  const result: PerformanceResult = {
    months: [
      { month: "2026-01", value: 100, flow: 100, twrMonthly: null, index: 100, drawdown: 0 },
      { month: "2026-02", value: 160, flow: 50, twrMonthly: 0.1, index: 110, drawdown: 0 },
      { month: "2026-03", value: 130, flow: -20, twrMonthly: -0.1, index: 99, drawdown: -0.1 },
    ],
    twr: { sinceStart: -0.01, ytd: -0.01, last12m: -0.01 },
    xirr: null,
    maxDrawdown: -0.1,
  };

  it("accumulates the flows into money put in and takes the gain from the last month", () => {
    const { months, summary } = performanceOf(result);
    expect(months.map((m) => m.moneyIn)).toEqual([100, 150, 130]);
    expect(summary).toEqual({
      value: 130,
      moneyIn: 130,
      gain: 0,
      twr: result.twr,
      xirr: null,
      maxDrawdown: -0.1,
    });
  });

  it("has no summary for an empty scope", () => {
    const empty: PerformanceResult = {
      months: [],
      twr: { sinceStart: null, ytd: null, last12m: null },
      xirr: null,
      maxDrawdown: 0,
    };
    expect(performanceOf(empty)).toEqual({ months: [], summary: null });
  });
});

describe("totalOf", () => {
  const month = (
    m: string,
    planned: number,
    actual: number,
    cumPlanned: number,
    cumActual: number,
  ) => ({
    month: m,
    planned,
    actual,
    cumPlanned,
    cumActual,
    gap: cumActual - cumPlanned,
  });
  const goals: PlanVsActualGoal[] = [
    {
      goalId: "a",
      months: [month("2026-01", 100, 0, 100, 0), month("2026-02", 100, 300, 200, 300)],
    },
    { goalId: "b", months: [month("2026-01", 50, 50, 50, 50), month("2026-02", 50, 0, 100, 50)] },
  ];

  it("adds the goals month by month", () => {
    expect(totalOf(goals)).toEqual([
      month("2026-01", 150, 50, 150, 50),
      month("2026-02", 150, 300, 300, 350),
    ]);
  });

  it("is empty without goals", () => {
    expect(totalOf([])).toEqual([]);
  });
});
