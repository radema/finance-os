// Financial independence: the four levels, the wealth that counts toward them, and its projection
// over 40 years. Pure; amounts are today's euros as floats and are never rounded here.
import { ASSET_CLASSES } from "./assetClasses.ts";
import {
  correlationFactor,
  drawShocks,
  type MonteCarloGoal,
  monteCarloGrowth,
  prepareGoal,
  quantile,
} from "./monteCarlo.ts";
import {
  deterministicGrowth,
  type GrowthRule,
  liquidateGoal,
  type PathPlan,
  type ProductProjection,
  runPath,
  targetAtGoalDate,
} from "./projection.ts";
import { pathRandom } from "./random.ts";
import type { FireSettings } from "./schemas.ts";
import { timeGrid } from "./timeGrid.ts";

/** Years after Y0 the projection runs: its last point is 31 December of Y0 + 40, t = 40 + f. */
const FI_YEARS = 40;
/** Today, the end of the stub (Y0), then the end of each of the next 40 years. */
const POINTS = FI_YEARS + 2;
const CLASS_COUNT = ASSET_CLASSES.length;
/** Index of Level 1 in the level arrays. */
const SAFETY = 0;
const P10 = 0.1;
const P50 = 0.5;
const P90 = 0.9;

/** A goal with the flag the user sets: its bucket counts toward FI wealth. */
export type FiGoal = MonteCarloGoal & { countsTowardFi: boolean };

export type FiInput = {
  /** ISO date, YYYY-MM-DD. Every goal's `asOf` is the same date. */
  asOf: string;
  goals: readonly FiGoal[];
  /** 6×6, in the order of ASSET_CLASSES. */
  correlations: readonly (readonly number[])[];
  fire: FireSettings;
  /** Essential and optional expenses, euros a month today. */
  essential: number;
  optional: number;
  /** Yearly growth of both expenses above inflation: 0 keeps up with prices, so the targets stay flat. */
  expenseGrowth: number;
  inflation: number;
  /** The pension goal's id: its bucket is dropped when `fire.includePension` is off, and from Level 1. */
  pensionGoalId?: string;
};

/** The spread of FI wealth at one point. */
export type FiBand = { p10: number; p50: number; p90: number; deterministic: number };

/** One point of the projection. Level index 0, 1, 2, 3 is Level 1 (Financial security), 2, 3, 4. */
export type FiPoint = {
  /** Calendar year of the point: Y0 for today and for the end of Y0. */
  year: number;
  /** Real years from asOf. */
  t: number;
  /** FI wealth with the pension bucket if it is included. Levels 2 to 4 read this. */
  total: FiBand;
  /** FI wealth without the pension bucket. Level 1 reads this. */
  nonPension: FiBand;
  /** Level target at this point: today's target × (1 + expenseGrowth)^t. */
  targets: number[];
  /** Share of paths whose wealth is at or above the target. */
  pReached: number[];
  /** Median wealth ÷ target. Null when the target is 0. */
  progress: (number | null)[];
};

export type FiResult = {
  /** Level targets today. */
  levels: number[];
  wealthToday: { total: number; nonPension: number; pension: number };
  /** Point 0 is today; point k ≥ 1 is 31 December of year Y0 + k − 1. With f = 0 points 0 and 1 are both t = 0. */
  points: FiPoint[];
  /** First year the median and the deterministic line reach each level; null when never. */
  reached: { median: number | null; deterministic: number | null }[];
  correlationShrunk: boolean;
};

/**
 * The four level targets in today's euros. Level 1 Financial security is the target of the `efFromGoal`
 * goal, else `efMonths` × essential. Level 2 Barista FIRE is `baristaMult` × essential. Level 3 Lean
 * FIRE is `l2Mult` × essential. Level 4 Financial Freedom is Level 3 + `l3Mult` × optional.
 */
export function fiLevels(input: FiInput): [number, number, number, number] {
  const { fire } = input;
  const efGoal =
    fire.efFromGoal === null ? undefined : input.goals.find((g) => g.goal.id === fire.efFromGoal);
  const lean = fire.l2Mult * input.essential;
  return [
    efGoal ? efGoal.goal.target : fire.efMonths * input.essential,
    fire.baristaMult * input.essential,
    lean,
    lean + fire.l3Mult * input.optional,
  ];
}

type Bucket = {
  goal: FiGoal;
  /** The goal's plan on the 40-year grid: contributions stop after its targetYear. */
  plan: PathPlan;
  growth: GrowthRule;
  isPension: boolean;
};

const newSeries = (paths: number) => Array.from({ length: POINTS }, () => new Float64Array(paths));

function addTo(values: Float64Array, index: number, amount: number): void {
  values[index] = (values[index] as number) + amount;
}

const sorted = (values: Float64Array | undefined) => Array.from(values ?? []).sort((a, b) => a - b);

function band(sortedValues: readonly number[], deterministic: number): FiBand {
  return {
    p10: quantile(sortedValues, P10),
    p50: quantile(sortedValues, P50),
    p90: quantile(sortedValues, P90),
    deterministic,
  };
}

/** The wealth a level is measured on: Level 1 without the pension bucket, the others with it. */
const levelBand = (point: FiPoint, level: number): FiBand =>
  level === SAFETY ? point.nonPension : point.total;

/** The calendar year of the first point where the level's wealth reaches its target. */
function firstYear(
  points: readonly FiPoint[],
  level: number,
  reaches: (band: FiBand, target: number) => boolean,
): number | null {
  const point = points.find((candidate) =>
    reaches(levelBand(candidate, level), candidate.targets[level] as number),
  );
  return point?.year ?? null;
}

/**
 * Project FI wealth to 40 years with the seeded Monte Carlo of `runMonteCarlo` (same shocks for the
 * same seed) and along the deterministic line.
 *
 * A bucket counts when its goal has `countsTowardFi` and, for the pension goal, `fire.includePension`.
 * Its value at each point is the net of a liquidation at that date: the pension exit rate is the
 * one of that year, and the zainetto applies only while it has not expired. The net is deflated by
 * (1 + inflation)^t. After a goal's targetYear its contributions stop and the bucket keeps compounding.
 *
 * @param input The goals, the FI settings and the cash flow.
 * @param seed Integer seed (Settings).
 * @param paths Number of paths.
 */
export function projectFinancialIndependence(
  input: FiInput,
  seed: number,
  paths: number,
): FiResult {
  const { factor, shrunk } = correlationFactor(input.correlations);
  const levels = fiLevels(input);
  const y0 = Number(input.asOf.slice(0, 4));
  const grid = timeGrid(input.asOf, y0 + FI_YEARS);
  const years = [y0, ...grid.steps.map((step) => step.year)];
  const times = [0];
  for (const step of grid.steps) times.push((times.at(-1) as number) + step.fraction);
  const deflators = times.map((t) => targetAtGoalDate(1, input.inflation, t));

  const shocks = new Float64Array(grid.steps.length * CLASS_COUNT);
  const buckets = input.goals
    .filter(
      (goal) =>
        goal.countsTowardFi && (goal.goal.id !== input.pensionGoalId || input.fire.includePension),
    )
    .map((goal): Bucket => {
      const prepared = prepareGoal(goal);
      return {
        goal,
        plan: {
          ...prepared.plan,
          grid,
          contributions: grid.steps.map((_, index) => prepared.plan.contributions[index] ?? 0),
        },
        growth: monteCarloGrowth(prepared, shocks),
        isPension: goal.goal.id === input.pensionGoalId,
      };
    });

  /** The net of a bucket at a point, in today's euros. */
  const netAt = (bucket: Bucket, point: number, positions: readonly ProductProjection[]) =>
    liquidateGoal(bucket.goal, positions, `${years[point]}-12-31`).net /
    (deflators[point] as number);

  // Point 0, today: the same on every path and on the deterministic line.
  let totalToday = 0;
  let pensionToday = 0;
  for (const bucket of buckets) {
    const opening = bucket.plan.opening.map(({ productId, value, basis }) => ({
      productId,
      value,
      basis,
    }));
    const net = liquidateGoal(bucket.goal, opening, input.asOf).net;
    totalToday += net;
    if (bucket.isPension) pensionToday += net;
  }
  const nonPensionToday = totalToday - pensionToday;

  // Wealth per point and path; the deterministic line per point.
  const sims = { total: newSeries(paths), nonPension: newSeries(paths) };
  const lines = { total: new Float64Array(POINTS), nonPension: new Float64Array(POINTS) };
  sims.total[0]?.fill(totalToday);
  sims.nonPension[0]?.fill(nonPensionToday);
  lines.total[0] = totalToday;
  lines.nonPension[0] = nonPensionToday;

  for (const bucket of buckets) {
    runPath(bucket.plan, bucket.goal.settings, deterministicGrowth, (step, positions) => {
      const net = netAt(bucket, step + 1, positions);
      addTo(lines.total, step + 1, net);
      if (!bucket.isPension) addTo(lines.nonPension, step + 1, net);
    });
  }
  for (let path = 0; path < paths; path++) {
    drawShocks(factor, pathRandom(seed, path), grid.steps.length, shocks);
    for (const bucket of buckets) {
      runPath(bucket.plan, bucket.goal.settings, bucket.growth, (step, positions) => {
        const net = netAt(bucket, step + 1, positions);
        addTo(sims.total[step + 1] as Float64Array, path, net);
        if (!bucket.isPension) addTo(sims.nonPension[step + 1] as Float64Array, path, net);
      });
    }
  }

  const growthOfTargets = 1 + input.expenseGrowth;
  const points = Array.from({ length: POINTS }, (_, point): FiPoint => {
    const targets = levels.map((target) => target * growthOfTargets ** (times[point] as number));
    const result: FiPoint = {
      year: years[point] as number,
      t: times[point] as number,
      total: band(sorted(sims.total[point]), lines.total[point] as number),
      nonPension: band(sorted(sims.nonPension[point]), lines.nonPension[point] as number),
      targets,
      pReached: [],
      progress: [],
    };
    for (const [level, target] of targets.entries()) {
      const wealth = (level === SAFETY ? sims.nonPension : sims.total)[point] as Float64Array;
      result.pReached.push(wealth.filter((value) => value >= target).length / paths);
      result.progress.push(target > 0 ? levelBand(result, level).p50 / target : null);
    }
    return result;
  });

  const reached = levels.map((_, level) => ({
    median: firstYear(points, level, (band, target) => band.p50 >= target),
    deterministic: firstYear(points, level, (band, target) => band.deterministic >= target),
  }));

  return {
    levels,
    wealthToday: { total: totalToday, nonPension: nonPensionToday, pension: pensionToday },
    points,
    reached,
    correlationShrunk: shrunk,
  };
}
