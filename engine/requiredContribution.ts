import type { MonteCarloGoal } from "./monteCarlo.ts";
import { runMonteCarlo } from "./monteCarlo.ts";
import { type ProjectionInput, projectGoal } from "./projection.ts";
import { timeGrid } from "./timeGrid.ts";

/** Doublings of the upper bound before the goal is called not reachable. */
const MAX_DOUBLINGS = 12;
/** Smallest first upper bound of the monthly amount, in euros: a tiny plan still gets 12 doublings from here. */
const DEFAULT_START = 100;
/** The bisection stops when the bracket is one cent wide. */
const AMOUNT_TOLERANCE = 0.01;
/** The pension goal's unknown is a multiplier of the schedule, 1 being the schedule as it is. */
const MULTIPLIER_START = 1;
const MULTIPLIER_TOLERANCE = 1e-4;

export type ProbabilityOptions = {
  /** The probability to reach, as a fraction. */
  requiredP: number;
  /** 6×6, in the order of ASSET_CLASSES. */
  correlations: readonly (readonly number[])[];
  seed: number;
  paths: number;
};

/**
 * The contribution that makes a goal reach its target, found by bisection.
 *
 * - `deterministic`: the smallest amount with deterministic net ≥ target at the goal date.
 * - `probability`: the smallest amount with P(success) ≥ `requiredP`. Every trial runs the same
 *   seed, so each path sees the same shocks and P grows smoothly with the amount.
 *
 * The unknown is the monthly amount of a plain goal, in euros. For the pension goal it is the
 * multiplier of the contribution schedule (1 = the schedule as it is). The bracket starts at
 * [0, max(current monthly, 100)] (the multiplier starts at [0, 1]), doubles the upper bound up to
 * 12 times, then halves until it is one cent wide (1e-4 for the multiplier). The upper end is
 * returned, so the answer always reaches the target.
 *
 * @returns 0 when the goal is met with no contribution. `null` when it is not reachable after 12
 *   doublings. When no contribution step is left (r = 0 and targetYear = Y0, or τ = 0): 0 if met, else
 *   `null`. A goal due this year with r > 0 is solved normally.
 */
export function requiredContribution(goal: ProjectionInput, mode: "deterministic"): number | null;
export function requiredContribution(
  goal: MonteCarloGoal,
  mode: "probability",
  options: ProbabilityOptions,
): number | null;
export function requiredContribution(
  goal: ProjectionInput | MonteCarloGoal,
  mode: "deterministic" | "probability",
  options?: ProbabilityOptions,
): number | null {
  const monteCarlo = mode === "probability" ? options : undefined;
  if (mode === "probability" && !monteCarlo) throw new Error("Probability mode needs options");

  const meets = (input: ProjectionInput | MonteCarloGoal): boolean => {
    if (!monteCarlo) {
      const { net, targetAtGoalDate } = projectGoal(input);
      return net >= targetAtGoalDate;
    }
    const { correlations, seed, paths, requiredP } = monteCarlo;
    const result = runMonteCarlo({ goals: [input as MonteCarloGoal], correlations }, seed, paths);
    return (result.goals[0]?.pSuccess ?? 0) >= requiredP;
  };

  const grid = timeGrid(goal.asOf, goal.goal.targetYear);
  if (grid.steps.every((step) => step.months === 0)) return meets(goal) ? 0 : null;

  const { pension } = goal;
  const withAmount = (amount: number) =>
    pension ? { ...goal, pension: { ...pension, scale: amount } } : { ...goal, monthly: amount };
  const start = pension ? MULTIPLIER_START : Math.max(goal.monthly, DEFAULT_START);
  const tolerance = pension ? MULTIPLIER_TOLERANCE : AMOUNT_TOLERANCE;

  if (meets(withAmount(0))) return 0;
  let low = 0;
  let high = start;
  for (let doublings = 0; !meets(withAmount(high)); doublings++) {
    if (doublings === MAX_DOUBLINGS) return null;
    low = high;
    high *= 2;
  }
  while (high - low > tolerance) {
    const mid = (low + high) / 2;
    if (meets(withAmount(mid))) high = mid;
    else low = mid;
  }
  return high;
}
