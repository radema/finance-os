// What the Goals list and the Goal detail screens read from the API. These are computed read models:
// amounts are euros as floats, and rounding happens only in the view. A value that cannot be
// computed (a missing price, a missing pension first year) is `null`, never a guess.
import type { Regime } from "./holdings.ts";
import type { Goal } from "./schemas.ts";

export interface GoalSummary {
  id: string;
  name: string;
  priority: Goal["priority"];
  /** Colour slot, 1..6. */
  slot: number;
  /** Today's euros. */
  target: number;
  /** Units × price of the priced holdings at the valuation date. */
  value: number;
  /** True when a held product has no price at all: `value` leaves it out. */
  missingPrices: boolean;
}

export interface GoalListView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  /** True on an empty data folder, where the sample data can be loaded. */
  sampleAvailable: boolean;
  goals: GoalSummary[];
}

export interface HoldingRow {
  productId: string;
  name: string;
  regime: Regime;
  units: number;
  /** Price of one unit (a BTP quote is per 100). Null when the product has no price. */
  price: number | null;
  /** Average cost of one unit, commission included. */
  pmc: number;
  value: number | null;
  gain: number | null;
  /** Tax if this holding alone were sold at the valuation date. Null when it cannot be computed. */
  taxIfSold: number | null;
}

export interface SeriesPoint {
  /** `YYYY-MM`. */
  month: string;
  /** Null when a held product has no price at or before the month. */
  value: number | null;
  /** Cumulative cash put in, to the end of the month. */
  moneyIn: number;
}

export interface GoalDetail extends GoalSummary {
  targetYear: number;
  /** Today's `target` grown by inflation to the goal date. */
  targetAtGoalDate: number;
  asOf: string;
  /** Deterministic projection, liquidation tax and net at the goal date. Null when unavailable. */
  projection: { gross: number; tax: number; net: number } | null;
  /** Why `projection` is null. */
  projectionNote: string | null;
  holdings: HoldingRow[];
  /** Tax if the whole bucket were sold, from the full liquidation. Null when it cannot be computed. */
  taxIfSoldTotal: number | null;
  series: SeriesPoint[];
}
