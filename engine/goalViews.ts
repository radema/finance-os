// What the Goals list and the Goal detail screens read from the API. These are computed read models:
// amounts are euros as floats, and rounding happens only in the view. A value that cannot be
// computed (a missing price, a missing pension first year) is `null`, never a guess.
import type { LedgerRow, Regime } from "./holdings.ts";
import { holdingsAt } from "./holdings.ts";
import { monthEnd } from "./months.ts";
import { planInForce } from "./plan.ts";
import type { ProductParams } from "./projection.ts";
import { projectGoal, targetAtGoalDate } from "./projection.ts";
import type { Goal, PensionPlan, Product, Settings } from "./schemas.ts";
import { goalSlot } from "./slots.ts";
import type { LiquidationPosition } from "./tax.ts";
import { liquidate } from "./tax.ts";
import { timeGrid } from "./timeGrid.ts";
import { fromCents } from "./units.ts";

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

/** What the builders read of a product. */
export type GoalWorldProduct = Pick<
  Product,
  "id" | "name" | "regime" | "whiteListShare" | "expReturn" | "ter" | "couponRate"
>;

/** What the builders read of a goal. `target` is in today's euros. */
export interface GoalWorldGoal {
  id: string;
  name: string;
  priority: Goal["priority"];
  target: number;
  targetYear: number;
  contributionGrowth: number;
}

/** A ledger row with the cash of a coupon, which has no quantity. */
export type GoalWorldLedgerRow = LedgerRow & { amount: number };

/**
 * Everything the Goals views read, in engine values: euros as floats, no stored rows. `settings` and
 * `pension` are the engine's own documents, so their money stays in cents.
 */
export interface GoalWorld {
  products: ReadonlyMap<string, GoalWorldProduct>;
  /** In creation order. */
  goals: readonly GoalWorldGoal[];
  plans: readonly { goalId: string; fromMonth: string; monthly: number }[];
  weights: readonly { goalId: string; productId: string; weight: number }[];
  ledger: readonly GoalWorldLedgerRow[];
  settings: Settings;
  pension?: PensionPlan;
  /** Voluntary pension contributions of the valuation year, in cents. */
  voluntaryYtdCents: number;
  /** The valuation month: the last month that has prices, else the clock's month. */
  month: string;
  /** Unit prices of each product by month, oldest first. */
  prices: ReadonlyMap<string, readonly { month: string; price: number }[]>;
}

const NO_PRICE_NOTE = "A held product has no price, so the projection is not shown.";
const NO_FIRST_YEAR_NOTE =
  "The pension plan has no first year of membership, so the exit tax and the net are not shown.";

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (
    let current = first;
    current <= last;
    current = `${year}-${String(month).padStart(2, "0")}`
  ) {
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** The unit price at or before a month: the latest one. Undefined when the product has none yet. */
const priceAt = (world: GoalWorld, productId: string, at: string): number | undefined =>
  world.prices.get(productId)?.findLast((point) => point.month <= at)?.price;

export function summaryOf(world: GoalWorld, goal: GoalWorldGoal): GoalSummary {
  const positions =
    holdingsAt(world.ledger, monthEnd(world.month)).units.get(goal.id) ?? new Map<string, number>();
  let value = 0;
  let missingPrices = false;
  for (const [productId, units] of positions) {
    if (units === 0) continue;
    const price = priceAt(world, productId, world.month);
    if (price === undefined) missingPrices = true;
    else value += units * price;
  }
  return {
    id: goal.id,
    name: goal.name,
    priority: goal.priority,
    slot: goalSlot(goal, world.goals, world.pension?.goalId),
    target: goal.target,
    value,
    missingPrices,
  };
}

export function detailOf(world: GoalWorld, goal: GoalWorldGoal): GoalDetail {
  const { products, settings, pension, month } = world;
  const asOf = monthEnd(month);
  const held = holdingsAt(world.ledger, asOf);
  const summary = summaryOf(world, goal);
  const goalWeights = world.weights.filter((weight) => weight.goalId === goal.id);

  const liquidation = (positions: LiquidationPosition[], withZainetto: boolean) => {
    const { zainetto } = settings;
    return liquidate(positions, {
      goalDate: asOf,
      goalId: goal.id,
      taxStd: settings.taxStd,
      taxGovt: settings.taxGovt,
      firstYear: pension?.firstYear,
      zainetto:
        withZainetto && zainetto.goalId !== null
          ? {
              amount: fromCents(zainetto.amountCents),
              expiry: String(zainetto.expiry),
              goalId: zainetto.goalId,
            }
          : undefined,
    });
  };
  const hasNoFirstYear = (regimes: Iterable<string>) =>
    pension?.firstYear === undefined && [...regimes].includes("pension");

  const holdings: HoldingRow[] = [];
  for (const [productId, units] of held.units.get(goal.id) ?? []) {
    const product = products.get(productId);
    if (units === 0 || !product) continue;
    const price = priceAt(world, productId, month) ?? null;
    const pmc = held.pmc.get(productId) ?? 0;
    const value = price === null ? null : units * price;
    const position = {
      regime: product.regime,
      value: value ?? 0,
      basis: units * pmc,
      whiteListShare: product.whiteListShare,
    };
    // A holding's own tax: the zainetto credit is shared by the bucket, so it shows only in the total.
    const taxIfSold =
      value === null || hasNoFirstYear([product.regime])
        ? null
        : liquidation([position], false).tax;
    holdings.push({
      productId,
      name: product.name,
      regime: product.regime,
      units,
      price,
      pmc,
      value,
      gain: value === null ? null : value - units * pmc,
      taxIfSold,
    });
  }
  const priced = holdings.every((row) => row.value !== null);
  const heldRegimes = holdings.map((row) => row.regime);
  const taxIfSoldTotal =
    priced && !hasNoFirstYear(heldRegimes)
      ? liquidation(
          holdings.map((row) => ({
            regime: row.regime,
            value: row.value ?? 0,
            basis: row.units * row.pmc,
            whiteListShare: products.get(row.productId)?.whiteListShare,
          })),
          true,
        ).tax
      : null;

  const inflatedTarget = targetAtGoalDate(
    summary.target,
    settings.inflation,
    timeGrid(asOf, goal.targetYear).tau,
  );

  const weightedRegimes = goalWeights.map(
    (weight) => products.get(weight.productId)?.regime ?? "etf",
  );
  let projectionNote: string | null = null;
  if (!priced) projectionNote = NO_PRICE_NOTE;
  else if (hasNoFirstYear([...heldRegimes, ...weightedRegimes]))
    projectionNote = NO_FIRST_YEAR_NOTE;

  let projection: GoalDetail["projection"] = null;
  if (projectionNote === null) {
    const params = new Map<string, ProductParams>(
      [...products.values()].map((product) => [
        product.id,
        {
          regime: product.regime,
          mu: product.expReturn,
          ter: product.ter,
          couponRate: product.couponRate,
          whiteListShare: product.whiteListShare,
        },
      ]),
    );
    const { zainetto } = settings;
    const { gross, tax, net } = projectGoal({
      asOf,
      goal: {
        id: goal.id,
        targetYear: goal.targetYear,
        target: summary.target,
        contributionGrowth: goal.contributionGrowth,
      },
      monthly: planInForce(
        world.plans.filter((version) => version.goalId === goal.id),
        month,
      ),
      positions: holdings.map((row) => ({
        productId: row.productId,
        value: row.value ?? 0,
        basis: row.units * row.pmc,
      })),
      products: params,
      weights: new Map(goalWeights.map((weight) => [weight.productId, weight.weight])),
      settings: {
        ...settings,
        zainetto:
          zainetto.goalId === null
            ? undefined
            : {
                amount: fromCents(zainetto.amountCents),
                expiry: String(zainetto.expiry),
                goalId: zainetto.goalId,
              },
      },
      firstYear: pension?.firstYear,
      pension:
        pension?.goalId === goal.id && pension.ral !== undefined
          ? {
              plan: pension,
              deductionCapCents: settings.pensionDeductionCapCents,
              voluntaryYtd: world.voluntaryYtdCents,
            }
          : undefined,
    });
    projection = { gross, tax, net };
  }

  return {
    ...summary,
    targetYear: goal.targetYear,
    targetAtGoalDate: inflatedTarget,
    asOf,
    projection,
    projectionNote,
    holdings,
    taxIfSoldTotal,
    series: seriesOf(world, goal.id),
  };
}

/** Value and money put in at each month end, from the goal's first transaction to the valuation month. */
export function seriesOf(world: GoalWorld, goalId: string): SeriesPoint[] {
  const asOf = monthEnd(world.month);
  const entries = world.ledger.filter((entry) => entry.goalId === goalId && entry.date <= asOf);
  const first = entries[0]?.date.slice(0, 7);
  if (first === undefined) return [];

  // Cash put in: qty × unit price + commission (a sell is negative); a coupon is the cash received.
  const cash = (entry: (typeof entries)[number]) =>
    entry.type === "coupon" ? -entry.amount : entry.qty * entry.price + (entry.commission ?? 0);

  return monthsBetween(first, world.month).map((month) => {
    const end = monthEnd(month);
    const moneyIn = entries
      .filter((entry) => entry.date <= end)
      .reduce((sum, entry) => sum + cash(entry), 0);
    let value: number | null = 0;
    for (const [productId, units] of holdingsAt(world.ledger, end).units.get(goalId) ?? []) {
      if (units === 0) continue;
      const price = priceAt(world, productId, month);
      value = price === undefined || value === null ? null : value + units * price;
    }
    return { month, value, moneyIn };
  });
}
