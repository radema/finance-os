// What the Overview reads from the API: the key numbers and the cell data, composed from the other
// read models. Pure: no I/O. Money is euros as floats unless a field says cents.

import type { CashFlowYear } from "./cashFlow.ts";
import type { GoalListRow, OutcomeRange, SeriesPoint } from "./goalViews.ts";
import type { IndependenceView } from "./independenceView.ts";
import { addMonths } from "./months.ts";
import type { PriceAge } from "./priceAge.ts";
import type { SnapshotView } from "./snapshot.ts";
import type { PerformancePoint, PerformanceSummary } from "./trackingViews.ts";

export interface OverviewKeyNumbers {
  /** Value of every bucket at the valuation month, an old price still counted. Null without a value. */
  netWorth: number | null;
  /** V(m) − V(m−1) − F(m): the change of the value that the month's cash flows do not explain. */
  marketChange: number | null;
  /** Time-weighted return since 1 January of the valuation year. */
  ytdTwr: number | null;
  /** Net worth of the buckets that count toward FI, in today's euros. */
  fiWealth: number | null;
}

/** One goal's value at each month of the shared axis. */
export interface OverviewGoalSeries {
  goalId: string;
  name: string;
  /** Colour slot, 1..6. */
  slot: number;
  /** One value per month; 0 before the goal's first transaction and where a price is missing. */
  values: number[];
}

/** Net worth by goal, month by month, with the cash put in across all goals. */
export interface NetWorthByGoal {
  months: string[];
  goals: OverviewGoalSeries[];
  moneyIn: number[];
}

export interface OverviewPrice {
  productId: string;
  name: string;
  lastPrice: { price: number; priceDate: string } | null;
  age: PriceAge;
}

export interface OverviewView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  keyNumbers: OverviewKeyNumbers;
  goals: GoalListRow[];
  netWorth: NetWorthByGoal;
  /** The range of the goal furthest below its required probability. Null when no goal can be analysed. */
  range: { goalId: string; name: string; slot: number; range: OutcomeRange } | null;
  /** The 10-year cash flow. Money in cents. */
  cashFlow: CashFlowYear[];
  fi: IndependenceView;
  snapshots: SnapshotView[];
  prices: OverviewPrice[];
}

/**
 * The key numbers that come from the all-goals performance series and the FI wealth. The market
 * change needs two months: the flow of the last month is the change of the money put in.
 */
export function keyNumbersOf(
  months: readonly PerformancePoint[],
  summary: PerformanceSummary | null,
  fiWealth: number | null,
): OverviewKeyNumbers {
  const last = months.at(-1);
  const previous = months.at(-2);
  return {
    netWorth: summary?.value ?? null,
    marketChange:
      last && previous ? last.value - previous.value - (last.moneyIn - previous.moneyIn) : null,
    ytdTwr: summary?.twr.ytd ?? null,
    fiWealth,
  };
}

/**
 * The goals' series on one month axis, from the first month any goal has a transaction to `lastMonth`.
 * A goal with no series has no line; the money put in is the sum of the goals' cumulative cash.
 */
export function netWorthByGoal(
  goals: readonly { goalId: string; name: string; slot: number }[],
  series: ReadonlyMap<string, readonly SeriesPoint[]>,
  lastMonth: string,
): NetWorthByGoal {
  const first = [...series.values()].flatMap((points) => points.slice(0, 1).map((p) => p.month));
  const start = first.toSorted()[0];
  if (start === undefined) return { months: [], goals: [], moneyIn: [] };

  const months: string[] = [];
  for (let month = start; month <= lastMonth; month = addMonths(month, 1)) months.push(month);

  const drawn = goals.filter(({ goalId }) => (series.get(goalId)?.length ?? 0) > 0);
  const moneyIn = months.map(() => 0);
  const lines = drawn.map(({ goalId, name, slot }): OverviewGoalSeries => {
    const points = new Map((series.get(goalId) ?? []).map((point) => [point.month, point]));
    let cash = 0;
    const values = months.map((month, index) => {
      const point = points.get(month);
      if (point) cash = point.moneyIn;
      moneyIn[index] = (moneyIn[index] as number) + cash;
      return point?.value ?? 0;
    });
    return { goalId, name, slot, values };
  });
  return { months, goals: lines, moneyIn };
}

/** The analysable goal whose P(success) is furthest below the probability it must reach. */
export function weakestGoal(goals: readonly GoalListRow[]): GoalListRow | undefined {
  let weakest: GoalListRow | undefined;
  let gap = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    if (!goal.outlook) continue;
    const margin = goal.outlook.pSuccess - goal.outlook.requiredP;
    if (margin < gap) {
      weakest = goal;
      gap = margin;
    }
  }
  return weakest;
}
