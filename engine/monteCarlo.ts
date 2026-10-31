import { ASSET_CLASSES, type AssetClass } from "./assetClasses.ts";
import { cholesky, shrinkToPositiveDefinite } from "./correlation.ts";
import {
  type GrowthRule,
  liquidateGoal,
  type PathPlan,
  type ProductParams,
  type ProjectionInput,
  preparePath,
  runPath,
  targetAtGoalDate,
} from "./projection.ts";
import { fillNormals, pathRandom } from "./random.ts";

const CLASS_COUNT = ASSET_CLASSES.length;
const P10 = 0.1;
const P50 = 0.5;
const P90 = 0.9;

/** A product with the two extra parameters the simulation needs. */
export type MonteCarloProduct = ProductParams & {
  /** Yearly volatility σ of the return. */
  sigma: number;
  /** The class whose shock the product follows. */
  assetClass: AssetClass;
};

/** One goal to simulate: the deterministic projection input, with the products carrying σ and class. */
export type MonteCarloGoal = Omit<ProjectionInput, "products"> & {
  products: ReadonlyMap<string, MonteCarloProduct>;
};

export type MonteCarloInput = {
  goals: readonly MonteCarloGoal[];
  /** 6×6, in the order of ASSET_CLASSES. */
  correlations: readonly (readonly number[])[];
};

/** The distribution of one goal. Series have one entry per step of the time grid. */
export type GoalDistribution = {
  goalId: string;
  /** Share of paths with net ≥ target at the goal date. */
  pSuccess: number;
  /** Net value after liquidation at the end of each step. */
  p10: number[];
  p50: number[];
  p90: number[];
  /** Mean over all paths of max(0, target at goal date − net at goal date). */
  avgShortfall: number;
};

export type MonteCarloResult = { goals: GoalDistribution[]; correlationShrunk: boolean };

/**
 * Lognormal parameters of a yearly gross return with mean μ and volatility σ:
 * s = √ln(1 + σ²/(1+μ)²), m = ln(1+μ) − s²/2. So exp(m + s·z) has mean 1 + μ.
 */
export function lognormalParams(mu: number, sigma: number): { m: number; s: number } {
  const s = Math.sqrt(Math.log(1 + sigma ** 2 / (1 + mu) ** 2));
  return { m: Math.log(1 + mu) - (s * s) / 2, s };
}

type Prepared = {
  input: MonteCarloGoal;
  plan: PathPlan;
  /** Per product: lognormal parameters and the index of its class. */
  lognormal: ReadonlyMap<string, { m: number; s: number; classIndex: number }>;
  target: number;
};

function prepareGoal(input: MonteCarloGoal): Prepared {
  const plan = preparePath(input);
  const lognormal = new Map<string, { m: number; s: number; classIndex: number }>();
  for (const { productId, params } of plan.opening) {
    const product = input.products.get(productId) as MonteCarloProduct;
    // The coupon is paid apart, so the price return is μ − c (t12 S1).
    const coupon = product.regime === "govt" ? (product.couponRate ?? 0) : 0;
    lognormal.set(productId, {
      ...lognormalParams(params.mu - coupon, product.sigma),
      classIndex: ASSET_CLASSES.indexOf(product.assetClass),
    });
  }
  return {
    input,
    plan,
    lognormal,
    target: targetAtGoalDate(input.goal.target, input.settings.inflation, plan.grid.tau),
  };
}

/**
 * Simulate every goal on shared, correlated random markets.
 *
 * Path `p` draws its own stream from `seed` and `p`, so its shocks do not depend on the number of
 * paths or on which goals run. Per step the stream gives 6 independent normals, correlated by the
 * Cholesky factor. All goals read the same shocks, step k of every goal being the same calendar year.
 * Growth per step with fraction φ: exp(φ·m + √φ·s·z) × (1 − TER)^φ, so the variance scales with time.
 * Everything else in the step, and the liquidation, is the deterministic rule. A step's net is the
 * goal's liquidation of the positions at that step's end, with the goal's own tax context.
 *
 * @param inputs The goals and the correlation matrix. A matrix that is not positive definite is
 *   shrunk by `shrinkToPositiveDefinite`.
 * @param seed Integer seed.
 * @param paths Number of paths.
 * @returns `nets[goal][step][path]` (a goal due now has one step: the net at asOf), `targets[goal]`
 *   (target at the goal date), and whether the matrix was shrunk.
 */
export function simulatePaths(
  inputs: MonteCarloInput,
  seed: number,
  paths: number,
): { nets: number[][][]; targets: number[]; correlationShrunk: boolean } {
  if (
    inputs.correlations.length !== CLASS_COUNT ||
    inputs.correlations.some((row) => row.length !== CLASS_COUNT)
  ) {
    throw new Error(`The correlation matrix must be ${CLASS_COUNT} x ${CLASS_COUNT}`);
  }
  const { matrix, shrunk } = shrinkToPositiveDefinite(inputs.correlations);
  const factor = cholesky(matrix);
  if (!factor) throw new Error("The correlation matrix does not factorise after shrinking");

  const goals = inputs.goals.map(prepareGoal);
  const stepCount = (goal: Prepared) => Math.max(1, goal.plan.grid.steps.length);
  const maxSteps = Math.max(0, ...goals.map((goal) => goal.plan.grid.steps.length));
  const nets = goals.map((goal) =>
    Array.from({ length: stepCount(goal) }, () => new Array<number>(paths).fill(0)),
  );

  const normals = new Float64Array(CLASS_COUNT);
  const shocks = new Float64Array(maxSteps * CLASS_COUNT);
  for (let path = 0; path < paths; path++) {
    const random = pathRandom(seed, path);
    for (let step = 0; step < maxSteps; step++) {
      fillNormals(random, normals);
      for (let i = 0; i < CLASS_COUNT; i++) {
        let z = 0;
        for (let j = 0; j <= i; j++) z += (factor[i]?.[j] as number) * (normals[j] as number);
        shocks[step * CLASS_COUNT + i] = z;
      }
    }

    for (const [index, goal] of goals.entries()) {
      const growth: GrowthRule = (productId, params, stepIndex, phi) => {
        const { m, s, classIndex } = goal.lognormal.get(productId) as {
          m: number;
          s: number;
          classIndex: number;
        };
        const z = shocks[stepIndex * CLASS_COUNT + classIndex] as number;
        return Math.exp(phi * m + Math.sqrt(phi) * s * z) * (1 - params.ter) ** phi;
      };
      const last = stepCount(goal) - 1;
      const series = nets[index] as number[][];
      const final = runPath(goal.plan, goal.input.settings, growth, (stepIndex, positions) => {
        if (stepIndex < last)
          (series[stepIndex] as number[])[path] = liquidateGoal(goal.input, positions).net;
      });
      (series[last] as number[])[path] = liquidateGoal(goal.input, final).net;
    }
  }

  return { nets, targets: goals.map((goal) => goal.target), correlationShrunk: shrunk };
}

/** Quantile of a sorted sample, linear between ranks. */
function quantile(sorted: readonly number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const low = sorted[lower] as number;
  const high = sorted[Math.min(lower + 1, sorted.length - 1)] as number;
  return low + (high - low) * (position - lower);
}

/**
 * Seeded Monte Carlo over the goal projections: P(success), the bad (P10), typical (P50) and good
 * (P90) net value per step, and the average shortfall. Same inputs, seed and path count give the
 * same numbers. See `simulatePaths` for the model.
 *
 * @param inputs The goals and the 6×6 correlation matrix.
 * @param seed Integer seed (Settings).
 * @param paths Number of paths (Settings, default 1,000; 300 for snapshots and the optimizer).
 */
export function runMonteCarlo(
  inputs: MonteCarloInput,
  seed: number,
  paths: number,
): MonteCarloResult {
  const { nets, targets, correlationShrunk } = simulatePaths(inputs, seed, paths);
  const goals = inputs.goals.map((goal, index): GoalDistribution => {
    const series = (nets[index] as number[][]).map((step) => step.toSorted((a, b) => a - b));
    const final = (nets[index] as number[][]).at(-1) as number[];
    const target = targets[index] as number;
    let successes = 0;
    let shortfall = 0;
    for (const net of final) {
      if (net >= target) successes++;
      else shortfall += target - net;
    }
    return {
      goalId: goal.goal.id,
      pSuccess: successes / paths,
      p10: series.map((step) => quantile(step, P10)),
      p50: series.map((step) => quantile(step, P50)),
      p90: series.map((step) => quantile(step, P90)),
      avgShortfall: shortfall / paths,
    };
  });
  return { goals, correlationShrunk };
}
