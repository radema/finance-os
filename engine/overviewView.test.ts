import { describe, expect, it } from "vitest";
import { keyNumbersOf } from "./overviewView.ts";
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
