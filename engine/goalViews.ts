// What the Goals list and the Goal detail screens read from the API. These are computed read models:
// amounts are euros as floats, and rounding happens only in the view. A value that cannot be
// computed (a missing price, a missing pension first year) is `null`, never a guess.

import type { GoalStatus } from "./goalStatus.ts";
import { goalStatus, requiredProbability } from "./goalStatus.ts";
import type { LedgerRow, Regime } from "./holdings.ts";
import { holdingsAt } from "./holdings.ts";
import type { GoalDistribution, MonteCarloGoal, MonteCarloProduct } from "./monteCarlo.ts";
import { runMonteCarlo } from "./monteCarlo.ts";
import { monthEnd } from "./months.ts";
import { binOutcomes, fitAxis, type OutcomeBins } from "./outcomeChart.ts";
import { planInForce } from "./plan.ts";
import type { Position } from "./projection.ts";
import { projectGoal, targetAtGoalDate } from "./projection.ts";
import { requiredContribution } from "./requiredContribution.ts";
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
  /** Colour slot, 2..7 (7 = grey). */
  slot: number;
  /** Today's euros. */
  target: number;
  /** Units × price of the priced holdings at the valuation date. */
  value: number;
  /** True when a held product has no price at all: `value` leaves it out. */
  missingPrices: boolean;
}

/** The Monte Carlo verdict on a goal: P(success) against the probability it must reach. */
export interface Outlook {
  status: GoalStatus;
  /** Share of simulated paths that reach the target, as a fraction. */
  pSuccess: number;
  /** The required probability, as a fraction. */
  requiredP: number;
}

export interface GoalListRow extends GoalSummary {
  /** Null when the Monte Carlo cannot run: a held product has no price, or no pension first year. */
  outlook: Outlook | null;
}

export interface GoalListView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  /** True on an empty data folder, where the sample data can be loaded. */
  sampleAvailable: boolean;
  goals: GoalListRow[];
}

/** Net value at the end of one year of the goal, over the simulated paths. */
export interface FanPoint {
  year: number;
  /** The bad case (10% of paths end below it). */
  bad: number;
  /** The typical case (the median). */
  typical: number;
  /** The good case (10% of paths end above it). */
  good: number;
}

/** What it would take to reach the target. `null` means not reachable. */
export interface RequiredContributions {
  /** The pension goal's unknown is a multiplier of its schedule (1 = as it is), not euros. */
  unit: "monthly" | "schedule";
  /** Smallest amount with the deterministic net at the target. */
  deterministic: number | null;
  /** Smallest amount with P(success) at the required probability. */
  probability: number | null;
  /** The monthly amount in force, euros. Null for the pension goal. */
  currentMonthly: number | null;
}

/** The Monte Carlo analysis of one goal. */
export interface GoalAnalysis extends Outlook {
  /** Settings: simulated paths and seed. */
  paths: number;
  seed: number;
  /** Real years from the valuation date to the goal date. */
  horizonYears: number;
  targetAtGoalDate: number;
  /** One point per year to the goal year. A goal due now has one point. */
  fan: FanPoint[];
  /** Net value at the goal date. */
  range: { bad: number; typical: number; good: number; target: number };
  /**
   * The net values at the goal date of the simulated paths, counted in equal bins across an axis
   * that holds the range and the target. A path beyond the axis is not counted.
   */
  distribution: OutcomeBins;
  required: RequiredContributions;
}

export interface GoalDetailView extends GoalDetail {
  /** Null when the Monte Carlo cannot run. */
  analysis: GoalAnalysis | null;
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
  | "id"
  | "name"
  | "regime"
  | "whiteListShare"
  | "expReturn"
  | "volatility"
  | "assetClass"
  | "ter"
  | "couponRate"
>;

/** What the builders read of a goal. `target` is in today's euros. */
export interface GoalWorldGoal {
  id: string;
  name: string;
  priority: Goal["priority"];
  target: number;
  targetYear: number;
  contributionGrowth: number;
  /** The goal's own required probability, as a fraction. Null: the default of its priority. */
  minProb: number | null;
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
  /** The stored 6×6 correlation matrix, in the order of ASSET_CLASSES. The simulation shrinks it if needed. */
  correlations: readonly (readonly number[])[];
  pension?: PensionPlan;
  /** Voluntary pension contributions of the valuation year, in cents. */
  voluntaryYtdCents: number;
  /** The valuation month: the last month that has prices, else the clock's month. */
  month: string;
  /** Unit prices of each product by month, oldest first. */
  prices: ReadonlyMap<string, readonly { month: string; price: number }[]>;
}

/** Bins of the outcome distribution: fine enough to show the skew on a card two columns wide. */
const BINS = 40;
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

const hasNoFirstYear = (world: GoalWorld, regimes: Iterable<string>) =>
  world.pension?.firstYear === undefined && [...regimes].includes("pension");

/** The goal's opening positions at the valuation month, and why the projection cannot run (if so). */
function openingOf(
  world: GoalWorld,
  goal: GoalWorldGoal,
): { positions: Position[]; priced: boolean; note: string | null } {
  const held = holdingsAt(world.ledger, monthEnd(world.month));
  const positions: Position[] = [];
  const regimes: string[] = [];
  let priced = true;
  for (const [productId, units] of held.units.get(goal.id) ?? []) {
    const product = world.products.get(productId);
    if (units === 0 || !product) continue;
    regimes.push(product.regime);
    const price = priceAt(world, productId, world.month);
    if (price === undefined) priced = false;
    else
      positions.push({
        productId,
        value: units * price,
        basis: units * (held.pmc.get(productId) ?? 0),
      });
  }
  const weighted = world.weights
    .filter((weight) => weight.goalId === goal.id)
    .map((weight) => world.products.get(weight.productId)?.regime ?? "etf");
  let note: string | null = null;
  if (!priced) note = NO_PRICE_NOTE;
  else if (hasNoFirstYear(world, [...regimes, ...weighted])) note = NO_FIRST_YEAR_NOTE;
  return { positions, priced, note };
}

/** The projection input of a goal over its opening positions: the one the deterministic and Monte Carlo runs share. */
function inputOf(world: GoalWorld, goal: GoalWorldGoal, positions: Position[]): MonteCarloGoal {
  const { products, settings, pension, month } = world;
  const { zainetto } = settings;
  const params = new Map<string, MonteCarloProduct>(
    [...products.values()].map((product) => [
      product.id,
      {
        regime: product.regime,
        mu: product.expReturn,
        ter: product.ter,
        couponRate: product.couponRate,
        whiteListShare: product.whiteListShare,
        sigma: product.volatility,
        assetClass: product.assetClass,
      },
    ]),
  );
  return {
    asOf: monthEnd(month),
    goal: {
      id: goal.id,
      targetYear: goal.targetYear,
      target: goal.target,
      contributionGrowth: goal.contributionGrowth,
    },
    monthly: planInForce(
      world.plans.filter((version) => version.goalId === goal.id),
      month,
    ),
    positions,
    products: params,
    weights: new Map(
      world.weights
        .filter((weight) => weight.goalId === goal.id)
        .map((weight) => [weight.productId, weight.weight]),
    ),
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
  };
}

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
    slot: goalSlot(goal, world.goals),
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
      value === null || hasNoFirstYear(world, [product.regime])
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
  const opening = openingOf(world, goal);
  const heldRegimes = holdings.map((row) => row.regime);
  const taxIfSoldTotal =
    opening.priced && !hasNoFirstYear(world, heldRegimes)
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

  const projectionNote = opening.note;
  let projection: GoalDetail["projection"] = null;
  if (projectionNote === null) {
    const { gross, tax, net } = projectGoal(inputOf(world, goal, opening.positions));
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

/**
 * The goal's projection input over its holdings at the valuation month. A held product with no price
 * is left out, so it counts as 0; `note` says why the projection cannot run (a missing price or pension
 * first year), and `priced` is false when a price is missing.
 */
export function monteCarloGoalOf(
  world: GoalWorld,
  goal: GoalWorldGoal,
): { input: MonteCarloGoal; priced: boolean; note: string | null } {
  const { positions, priced, note } = openingOf(world, goal);
  return { input: inputOf(world, goal, positions), priced, note };
}

/** The goal's Monte Carlo input, or null when it cannot run (a missing price or pension first year). */
function monteCarloInputOf(world: GoalWorld, goal: GoalWorldGoal): MonteCarloGoal | null {
  const { input, note } = monteCarloGoalOf(world, goal);
  return note === null ? input : null;
}

const outlookOf = (world: GoalWorld, goal: GoalWorldGoal, pSuccess: number): Outlook => {
  const requiredP = requiredProbability(goal, world.settings.requiredProb);
  return {
    status: goalStatus(pSuccess, requiredP, world.settings.thresholds.statusBandPoints),
    pSuccess,
    requiredP,
  };
};

/** The range of net outcomes at a goal's date, against the target grown to that date. */
export type OutcomeRange = GoalAnalysis["range"];

/**
 * The goals of the list with their status and P(success) against the required probability, and the
 * range of outcomes at each goal date. One simulation runs every goal on the shared shocks, with the
 * seed and the paths of the Settings.
 */
export function listWithRangesOf(world: GoalWorld): {
  rows: GoalListRow[];
  ranges: ReadonlyMap<string, OutcomeRange>;
} {
  const inputs = world.goals.map((goal) => monteCarloInputOf(world, goal));
  const runnable = inputs.filter((input) => input !== null);
  const { goals: distributions } = runnable.length
    ? runMonteCarlo(
        { goals: runnable, correlations: world.correlations },
        world.settings.seed,
        world.settings.mcPaths,
      )
    : { goals: [] };
  const ranges = new Map<string, OutcomeRange>();
  let next = 0;
  const rows = world.goals.map((goal, index) => {
    const input = inputs[index];
    const distribution = input ? distributions[next++] : undefined;
    if (input && distribution) {
      ranges.set(goal.id, {
        bad: distribution.p10.at(-1) as number,
        typical: distribution.p50.at(-1) as number,
        good: distribution.p90.at(-1) as number,
        target: targetAtGoalDate(
          goal.target,
          world.settings.inflation,
          timeGrid(input.asOf, goal.targetYear).tau,
        ),
      });
    }
    return {
      ...summaryOf(world, goal),
      outlook: distribution ? outlookOf(world, goal, distribution.pSuccess) : null,
    };
  });
  return { rows, ranges };
}

/** The goals of the list with their status and P(success) against the required probability. */
export const listRowsOf = (world: GoalWorld): GoalListRow[] => listWithRangesOf(world).rows;

/**
 * The Monte Carlo analysis of one goal: status, fan, range at the goal date, and what it would take.
 * Null when the simulation cannot run. The required amounts take one bisection each, so this is
 * for the detail only. The goal runs alone, and its paths are the same as in the list.
 */
export function analysisOf(world: GoalWorld, goal: GoalWorldGoal): GoalAnalysis | null {
  const input = monteCarloInputOf(world, goal);
  if (input === null) return null;
  const { seed, mcPaths: paths, inflation } = world.settings;
  const { correlations } = world;
  // One input gives one distribution.
  const distribution = runMonteCarlo({ goals: [input], correlations }, seed, paths)
    .goals[0] as GoalDistribution;

  const outlook = outlookOf(world, goal, distribution.pSuccess);
  const grid = timeGrid(input.asOf, goal.targetYear);
  const years = grid.steps.length > 0 ? grid.steps.map((step) => step.year) : [grid.y0];
  const fan = years.map((year, index) => ({
    year,
    bad: distribution.p10[index] as number,
    typical: distribution.p50[index] as number,
    good: distribution.p90[index] as number,
  }));
  const target = targetAtGoalDate(goal.target, inflation, grid.tau);
  const last = fan.at(-1) as FanPoint;
  const range = { bad: last.bad, typical: last.typical, good: last.good, target };
  return {
    ...outlook,
    paths,
    seed,
    horizonYears: grid.tau,
    targetAtGoalDate: target,
    fan,
    range,
    distribution: binOutcomes(
      distribution.outcomes,
      fitAxis(range.bad, range.good, [target]),
      BINS,
    ),
    required: {
      unit: input.pension ? "schedule" : "monthly",
      deterministic: requiredContribution(input, "deterministic"),
      probability: requiredContribution(input, "probability", {
        requiredP: outlook.requiredP,
        correlations,
        seed,
        paths,
      }),
      currentMonthly: input.pension ? null : input.monthly,
    },
  };
}
