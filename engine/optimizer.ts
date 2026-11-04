import { type GoalDistribution, type MonteCarloGoal, runMonteCarlo } from "./monteCarlo.ts";
import { liquidateGoal, normaliseWeights, projectGoal } from "./projection.ts";
import { requiredContribution } from "./requiredContribution.ts";
import type { Goal, PensionFlow } from "./schemas.ts";
import { PENSION_FLOWS } from "./schemas.ts";
import type { Zainetto } from "./tax.ts";

/** Paths per mix, as in the spec: 300, and 200 for "spend least" (a bisection runs per mix). */
const PATHS = 300;
const PATHS_SPEND_LEAST = 200;
/** Paths per mix for a criterion: the current mix uses the same, so both run on the same shocks. */
export const pathsFor = (criterion: OptimizerCriterion): number =>
  criterion === "O5" ? PATHS_SPEND_LEAST : PATHS;
const MIN_PRODUCTS = 1;
const MAX_PRODUCTS = 6;
/** Up to 4 products the weights move in steps of 10 points, from 5 products in steps of 20. */
const MAX_FINE_PRODUCTS = 4;
const FINE_STEP = 10;
const COARSE_STEP = 20;
const PERCENT = 100;
// A cap such as 0.4 x 100 is not exact in floating point.
const EPSILON = 1e-9;

/** A mix: the weight of each product as a fraction; the weights sum to 1. */
export type Mix = ReadonlyMap<string, number>;

export type OptimizerCriterion = "O1" | "O2" | "O4" | "O5";

/** What the optimizer says about one mix. */
export type MixResult = {
  weights: Mix;
  /** P(success) as a fraction. */
  p: number;
  /** Median (P50) net value at the goal date. */
  median: number;
  /** Bad case: P10 of the net value at the goal date. */
  p10: number;
  /** Good case: P90 of the net value at the goal date. */
  p90: number;
  /** Average shortfall against the target. */
  shortfall: number;
  /** Net value at the goal date on the deterministic path. */
  detValue: number;
  /**
   * "Spend least" only: the monthly amount that reaches the required P with this mix, `null` when
   * it is not reachable. For a pension bucket it is the multiplier of the schedule.
   */
  monthlyNeeded?: number | null;
};

/**
 * Every mix of 1 to 6 products: weights in steps of 10 points (up to 4 products) or 20 points
 * (5 or 6) that sum to 100%, zero allowed, with no weight above `maxPerProduct`. The order is
 * fixed: the first product's weight runs from 0 up, then the second's, and so on. It is the
 * candidate order that settles ties.
 *
 * @param products Product ids.
 * @param maxPerProduct Largest weight of one product, as a fraction. Default: no cap.
 */
export function generateMixes(products: readonly string[], maxPerProduct?: number): Mix[] {
  if (products.length < MIN_PRODUCTS || products.length > MAX_PRODUCTS) {
    throw new Error(`A mix needs ${MIN_PRODUCTS} to ${MAX_PRODUCTS} products`);
  }
  const step = products.length <= MAX_FINE_PRODUCTS ? FINE_STEP : COARSE_STEP;
  const cap = maxPerProduct === undefined ? PERCENT : maxPerProduct * PERCENT + EPSILON;
  const units = PERCENT / step;

  const mixes: Mix[] = [];
  const points: number[] = [];
  const fill = (left: number): void => {
    if (points.length === products.length - 1) {
      points.push(left * step);
      if (points.every((point) => point <= cap)) {
        mixes.push(new Map(products.map((id, i) => [id, (points[i] as number) / PERCENT])));
      }
      points.pop();
      return;
    }
    for (let unit = 0; unit <= left; unit++) {
      points.push(unit * step);
      fill(left - unit);
      points.pop();
    }
  };
  fill(units);
  return mixes;
}

/**
 * The pension goal's flows for one mix: every flow kind the plan has (both, when it has none) gets
 * the mix rescaled to 100% as its `pct` values. A zero weight keeps no row.
 *
 * @param mix Weights by product id, in any scale.
 * @param current The plan's flows now; only the kinds they hold are read.
 */
export function flowsForMix(mix: Mix, current: readonly PensionFlow[]): PensionFlow[] {
  const kinds = PENSION_FLOWS.filter(
    (kind) => current.length === 0 || current.some((flow) => flow.flow === kind),
  );
  const shares = [...normaliseWeights(mix)].filter(([, pct]) => pct > 0);
  return kinds.flatMap((flow) => shares.map(([productId, pct]) => ({ productId, flow, pct })));
}

/** The mix a plan's flows stand for: the inverse of `flowsForMix`, rescaled to 100%. */
export function mixOfFlows(flows: readonly PensionFlow[]): Mix {
  const sums = new Map<string, number>();
  for (const { productId, pct } of flows) sums.set(productId, (sums.get(productId) ?? 0) + pct);
  return normaliseWeights(sums);
}

/** The criterion a goal's priority starts with: Need protects the bad case, the others grow the median. */
export function defaultCriterion(priority: Goal["priority"]): "O1" | "O2" {
  return priority === "Need" ? "O1" : "O2";
}

/** The name and the plain-words text of the rule of each criterion. */
export const CRITERION_RULES: Record<OptimizerCriterion, { name: string; text: string }> = {
  O1: {
    name: "O1 Protect the bad case",
    text: "Highest bad case (the result 1 simulated market in 10 falls below) among the mixes that reach the required probability; a tie goes to the higher chance of success.",
  },
  O2: {
    name: "O2 Grow the typical outcome",
    text: "Highest median among the mixes that reach the required probability; a tie goes to the higher chance of success.",
  },
  O5: {
    name: "O5 Spend least",
    text: "Lowest monthly amount needed among the mixes that reach the required probability; a tie goes to the higher median.",
  },
  O4: {
    name: "O4 Maximise the chance",
    text: "Highest chance of success, whatever the required probability; a tie goes to the higher median.",
  },
};
const NOT_FEASIBLE_TEXT =
  "No mix reaches the required probability, so this is the mix with the highest chance of success.";

/** Negative when `a` is the larger. */
const larger = (a: number, b: number) => (a > b ? -1 : a < b ? 1 : 0);

/** Negative when `a` is the better mix for the criterion. 0 means a tie. */
const COMPARE: Record<OptimizerCriterion, (a: MixResult, b: MixResult) => number> = {
  O1: (a, b) => larger(a.p10, b.p10) || larger(a.p, b.p),
  O2: (a, b) => larger(a.median, b.median) || larger(a.p, b.p),
  O5: (a, b) =>
    larger(
      b.monthlyNeeded ?? Number.POSITIVE_INFINITY,
      a.monthlyNeeded ?? Number.POSITIVE_INFINITY,
    ) || larger(a.median, b.median),
  O4: (a, b) => larger(a.p, b.p) || larger(a.median, b.median),
};

/**
 * The mixes in the order of the rule: the feasible ones by the criterion, then the rest by P. O4 has
 * no feasibility filter. The first one is the chosen mix. The sort is stable: a tie keeps the candidate order.
 *
 * @param mixes The mixes in candidate order.
 */
export function rankMixes(
  mixes: readonly MixResult[],
  criterion: OptimizerCriterion,
  requiredP: number,
): MixResult[] {
  if (criterion === "O4") return [...mixes].sort(COMPARE.O4);
  const feasible = mixes.filter((mix) => mix.p >= requiredP).sort(COMPARE[criterion]);
  const rest = mixes.filter((mix) => mix.p < requiredP).sort((a, b) => larger(a.p, b.p));
  return [...feasible, ...rest];
}

/**
 * Pick the mix by the criterion's rule (spec, Mix optimizer): the first of `rankMixes`.
 *
 * Feasible = P ≥ `requiredP`. O1, O2 and O5 choose among the feasible mixes; O4 looks at all of them.
 * With no feasible mix, the mix with the highest P is returned and `notFeasible` is set. For O4 the
 * flag is set when the best P is below `requiredP`: the spec does not say, this keeps it the same
 * for every criterion. A tie left after the tie-break keeps the candidate order.
 *
 * @param mixes The mixes in candidate order, not empty.
 */
export function chooseMix(
  mixes: readonly MixResult[],
  criterion: OptimizerCriterion,
  requiredP: number,
): { chosen: MixResult; notFeasible: boolean; ruleName: string; ruleText: string } {
  const rule = CRITERION_RULES[criterion];
  const chosen = rankMixes(mixes, criterion, requiredP)[0] as MixResult;
  const notFeasible = chosen.p < requiredP;
  const belowText =
    criterion === "O4"
      ? "Highest chance of success, but it stays below the required probability."
      : NOT_FEASIBLE_TEXT;
  return {
    chosen,
    notFeasible,
    ruleName: rule.name,
    ruleText: notFeasible ? belowText : rule.text,
  };
}

export type OptimizerInput = {
  /**
   * The goal's bucket as a Monte Carlo goal: its holdings, monthly amount, product parameters and
   * settings. Its `weights` are ignored: each mix sets the weights of the new contributions, or,
   * for a pension plan, the `pct` of its flows (see `flowsForMix`).
   */
  bucket: MonteCarloGoal;
  /** The 1 to 6 products to mix, ids in `bucket.products`. */
  products: readonly string[];
  criterion: OptimizerCriterion;
  /** Largest weight of one product, as a fraction. Default: no cap. */
  maxPerProduct?: number;
  /** The probability to reach, as a fraction. */
  requiredP: number;
  /** 6×6, in the order of ASSET_CLASSES. */
  correlations: readonly (readonly number[])[];
  seed: number;
  /**
   * "New": the holdings stay as they are, the mix sets the weights of new contributions, no tax.
   * "Rebalance": the holdings are sold at `bucket.asOf` first, the tax is deducted and the net
   * proceeds are reinvested by the mix on a basis equal to their value. Not for a pension bucket.
   */
  mode: "new" | "rebalance";
};

/** What a simulated goal says about its mix. */
const outcomeOf = (goal: MonteCarloGoal, distribution: GoalDistribution): MixResult => ({
  weights: goal.weights,
  p: distribution.pSuccess,
  median: distribution.p50.at(-1) as number,
  p10: distribution.p10.at(-1) as number,
  p90: distribution.p90.at(-1) as number,
  shortfall: distribution.avgShortfall,
  detValue: projectGoal(goal).net,
});

/** A pension bucket cannot be sold and reinvested: its money moves only through the pension flows. */
export class PensionRebalanceError extends Error {
  constructor() {
    super("A pension bucket cannot be rebalanced");
    this.name = "PensionRebalanceError";
  }
}

export type OptimizerResult = {
  chosen: MixResult;
  /** No mix reaches the required probability. */
  notFeasible: boolean;
  ruleName: string;
  /** One line: the rule that chose the mix. */
  ruleText: string;
  /** Every candidate, in candidate order. */
  mixes: MixResult[];
  /** Tax on selling the holdings at asOf: 0 in "new" mode. */
  switchTax: number;
};

/** A pension bucket: a pension plan, or a pension product held or chosen for the mix. */
const isPensionBucket = (bucket: MonteCarloGoal, products: readonly string[]): boolean =>
  bucket.pension !== undefined ||
  [...bucket.positions.map(({ productId }) => productId), ...products].some(
    (id) => bucket.products.get(id)?.regime === "pension",
  );

/**
 * The holdings sold at asOf: the tax of #18 on the whole bucket, the net proceeds as one value to
 * reinvest, and the zainetto left after the sale. The sale uses the zainetto once: what it took
 * (the tax it saved, over the standard rate) is no longer there at the goal date. Sale
 * commissions are not charged (spec is silent).
 */
function sellHoldings(bucket: MonteCarloGoal): {
  tax: number;
  proceeds: number;
  zainetto: Zainetto | undefined;
} {
  const { settings } = bucket;
  const { gross, tax } = liquidateGoal(bucket, bucket.positions, bucket.asOf);
  const { zainetto } = settings;
  if (!zainetto || settings.taxStd <= 0) return { tax, proceeds: gross - tax, zainetto };
  const withoutZainetto = liquidateGoal(
    { ...bucket, settings: { ...settings, zainetto: undefined } },
    bucket.positions,
    bucket.asOf,
  ).tax;
  const used = (withoutZainetto - tax) / settings.taxStd;
  return {
    tax,
    proceeds: gross - tax,
    zainetto: { ...zainetto, amount: Math.max(0, zainetto.amount - used) },
  };
}

/**
 * Compare the mixes of a bucket's products on the same simulated markets and choose one by the
 * criterion. All mixes run on the same seed, so each path sees the same shocks. 300 paths; 200 for
 * O5, which also solves the monthly amount per mix by bisection (as in `requiredContribution`).
 *
 * @throws When the number of products is not 1 to 6, or the cap leaves no mix. A
 *   `PensionRebalanceError` for a pension bucket in "rebalance" mode.
 */
export function runOptimizer(input: OptimizerInput): OptimizerResult {
  const { bucket, criterion, requiredP, correlations, seed } = input;
  const rebalance = input.mode === "rebalance";
  if (rebalance && isPensionBucket(bucket, input.products)) throw new PensionRebalanceError();
  const candidates = generateMixes(input.products, input.maxPerProduct);
  if (candidates.length === 0) throw new Error("The per-product maximum leaves no mix");

  const paths = pathsFor(criterion);
  const sale = rebalance ? sellHoldings(bucket) : { tax: 0, proceeds: 0, zainetto: undefined };
  const goals = candidates.map((weights) => ({
    ...bucket,
    weights,
    // The pension goal ignores weights: its mix is the pct of the plan's flows.
    ...(bucket.pension && {
      pension: {
        ...bucket.pension,
        plan: { ...bucket.pension.plan, flows: flowsForMix(weights, bucket.pension.plan.flows) },
      },
    }),
    // The basis of the reinvested money is its value; the zainetto is what the sale left.
    ...(rebalance && {
      settings: { ...bucket.settings, zainetto: sale.zainetto },
      positions: [...weights].map(([productId, weight]) => ({
        productId,
        value: sale.proceeds * weight,
        basis: sale.proceeds * weight,
      })),
    }),
  }));
  const { goals: distributions } = runMonteCarlo({ goals, correlations }, seed, paths);

  const mixes = goals.map((goal, index): MixResult => {
    const mix = outcomeOf(goal, distributions[index] as GoalDistribution);
    if (criterion === "O5") {
      mix.monthlyNeeded = requiredContribution(goal, "probability", {
        requiredP,
        correlations,
        seed,
        paths,
      });
    }
    return mix;
  });

  return { ...chooseMix(mixes, criterion, requiredP), mixes, switchTax: sale.tax };
}

/**
 * The bucket as it is, with its own weights and holdings, on the same shocks and paths as
 * `runOptimizer` uses for the criterion: the "current" the suggested mix is compared with.
 */
export function simulateCurrent(
  bucket: MonteCarloGoal,
  criterion: OptimizerCriterion,
  correlations: OptimizerInput["correlations"],
  seed: number,
): MixResult {
  const { goals } = runMonteCarlo({ goals: [bucket], correlations }, seed, pathsFor(criterion));
  return outcomeOf(bucket, goals[0] as GoalDistribution);
}
