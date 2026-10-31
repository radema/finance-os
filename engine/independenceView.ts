// What the Independence screen reads from the API. Amounts are today's euros as floats; rounding
// happens only in the view.
import type { FiResult } from "./financialIndependence.ts";
import type { FireSettings } from "./schemas.ts";

/** One goal on the Independence screen. */
export interface IndependenceGoal {
  id: string;
  name: string;
  /** Colour slot, 1..6. */
  slot: number;
  /** The goal's target in today's euros. */
  target: number;
  countsTowardFi: boolean;
  isPension: boolean;
  /**
   * Net value of the goal's bucket today, after liquidation tax. 0 when the bucket does not count:
   * the goal is not ticked, or it is the pension goal and the pension is not included.
   */
  today: number;
}

export interface IndependenceView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  fire: FireSettings;
  /** The expense split lives in the CashFlow document. Money in cents a month. */
  expenses: { essentialCents: number; optionalCents: number; expenseGrowth: number };
  inflation: number;
  goals: IndependenceGoal[];
  /** Null when there are no goals, or when `note` says why the projection cannot run. */
  result: FiResult | null;
  /** A message for the user: why `result` is null, or a caveat about it. */
  note: string | null;
}
