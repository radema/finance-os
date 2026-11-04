// What the Performance and Plan vs actual screens read from the API. Computed read models over the
// #53 performance and #54 plan-vs-actual outputs: money in performance is euros as floats, money in
// plan vs actual is cents, and rounding happens only in the view. Pure: no I/O.

import type { PerformanceResult, PerformanceScope } from "./performance.ts";
import type { NextContribution, PlanVsActualGoal, PlanVsActualMonth } from "./planVsActual.ts";

/** One month of a scope's series, with the cash put in up to the end of the month. */
export interface PerformancePoint {
  month: string;
  value: number;
  /** Cumulative cash put in (sells and coupons are negative). */
  moneyIn: number;
  /** Growth of 100. */
  index: number;
  /** At most 0. */
  drawdown: number;
  /** Null when the previous month had no value. */
  twrMonthly: number | null;
}

/** The KPIs of a scope at the valuation month. */
export interface PerformanceSummary {
  value: number;
  moneyIn: number;
  /** value − moneyIn. */
  gain: number;
  twr: PerformanceResult["twr"];
  /** Null when no rate in [−99%, 100%] fits: a short history or flows of one sign. */
  xirr: number | null;
  maxDrawdown: number;
}

export interface PerformanceView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  scope: PerformanceScope;
  label: string;
  /** Colour slot of a bucket's goal, 1..6. Null for the scopes that are not one goal. */
  slot: number | null;
  months: PerformancePoint[];
  /** Null when the scope has no transactions, or a held product has no price (see `note`). */
  summary: PerformanceSummary | null;
  /** Why `summary` is null. */
  note: string | null;
}

export interface PerformanceScopeRow {
  scope: PerformanceScope;
  label: string;
  summary: PerformanceSummary | null;
  note: string | null;
}

export interface PerformanceScopesView {
  asOf: string;
  rows: PerformanceScopeRow[];
}

/** The series and the KPIs of one engine result. `summary` is null when the scope has no months. */
export function performanceOf(result: PerformanceResult): {
  months: PerformancePoint[];
  summary: PerformanceSummary | null;
} {
  let moneyIn = 0;
  const months = result.months.map((month) => {
    moneyIn += month.flow;
    return {
      month: month.month,
      value: month.value,
      moneyIn,
      index: month.index,
      drawdown: month.drawdown,
      twrMonthly: month.twrMonthly,
    };
  });
  const last = months.at(-1);
  return {
    months,
    summary: last
      ? {
          value: last.value,
          moneyIn: last.moneyIn,
          gain: last.value - last.moneyIn,
          twr: result.twr,
          xirr: result.xirr,
          maxDrawdown: result.maxDrawdown,
        }
      : null,
  };
}

/** The next contribution with the names the card shows. Money in cents. */
export interface NextContributionView extends NextContribution {
  goalName: string;
  /** Colour slot of the goal, 1..6. */
  slot: number;
  /** The minimum efficient ticket, cents. */
  minTicket: number;
  split: (NextContribution["split"][number] & { productName: string })[];
}

export interface PlanVsActualGoalView extends PlanVsActualGoal {
  name: string;
  /** Colour slot, 1..6. */
  slot: number;
}

export interface PlanVsActualView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  /** `YYYY-MM`. */
  trackingStart: string;
  /** The pension plan's goal, which is never the next contribution. Null when there is no plan. */
  pensionGoalId: string | null;
  /** True when the pension goal's plan comes from its contribution schedule, not from plan versions. */
  pensionPlanFromSchedule: boolean;
  goals: PlanVsActualGoalView[];
  /** All goals together, month by month. Money in cents. */
  total: PlanVsActualMonth[];
  /** Null when no goal other than the pension goal is behind plan. */
  next: NextContributionView | null;
}

/** The goals added up, month by month: the series of the "planned vs put in" chart. */
export function totalOf(goals: readonly PlanVsActualGoal[]): PlanVsActualMonth[] {
  const first = goals[0];
  if (!first) return [];
  return first.months.map((month, index) => {
    const sum = (key: "planned" | "actual" | "cumPlanned" | "cumActual") =>
      goals.reduce((total, goal) => total + (goal.months[index]?.[key] ?? 0), 0);
    const cumPlanned = sum("cumPlanned");
    const cumActual = sum("cumActual");
    return {
      month: month.month,
      planned: sum("planned"),
      actual: sum("actual"),
      cumPlanned,
      cumActual,
      gap: cumActual - cumPlanned,
    };
  });
}
