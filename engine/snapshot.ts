// The frozen analysis of every goal at one month: the content of a Snapshot. Pure composition of the
// Goals views and the Monte Carlo; the server stores it and decides saved or recomputed.

import type { GoalStatus } from "./goalStatus.ts";
import { goalStatus, requiredProbability } from "./goalStatus.ts";
import type { GoalWorld } from "./goalViews.ts";
import { monteCarloGoalOf, summaryOf } from "./goalViews.ts";
import type { GoalDistribution } from "./monteCarlo.ts";
import { runMonteCarlo } from "./monteCarlo.ts";
import { projectGoal, targetAtGoalDate } from "./projection.ts";
import { timeGrid } from "./timeGrid.ts";

/** Paths of a snapshot's Monte Carlo (the Settings seed is used as it is). */
export const SNAPSHOT_PATHS = 300;

/**
 * One goal at the snapshot month. The analysis fields are null when it could not run (a held product
 * has no price at or before the month, or the pension plan has no first year): never a guess.
 */
export interface SnapshotGoal {
  goalId: string;
  /** P(success), as a fraction. */
  prob: number | null;
  /** The probability the goal had to reach, as a fraction. */
  reqP: number;
  /** Deterministic net at the goal date. */
  detNet: number | null;
  /** The target grown by inflation to the goal date: median ÷ target compares like with like. */
  target: number;
  /** P50, P10 and P90 of the net value at the goal date. */
  median: number | null;
  p10: number | null;
  p90: number | null;
  /** Units × price of the holdings at the month end. Null when a held product has no price. */
  value: number | null;
  status: GoalStatus | null;
}

/**
 * The analysis of every goal at `world.month`: holdings up to that month end, the latest price at or
 * before it, the world's assumptions and the Settings seed, 300 paths.
 *
 * @param world The goals world with `month` and `voluntaryYtdCents` set to the snapshot month.
 * @returns One entry per goal, in the order of `world.goals`.
 */
export function computeSnapshot(world: GoalWorld): SnapshotGoal[] {
  const { settings, correlations } = world;
  const built = world.goals.map((goal) => ({ goal, ...monteCarloGoalOf(world, goal) }));
  const runnable = built.filter(({ note }) => note === null);
  const { goals: distributions } = runnable.length
    ? runMonteCarlo(
        { goals: runnable.map(({ input }) => input), correlations },
        settings.seed,
        SNAPSHOT_PATHS,
      )
    : { goals: [] };

  let next = 0;
  return built.map(({ goal, input, note }) => {
    const { value, missingPrices } = summaryOf(world, goal);
    const reqP = requiredProbability(goal, settings.requiredProb);
    const target = targetAtGoalDate(
      goal.target,
      settings.inflation,
      timeGrid(input.asOf, goal.targetYear).tau,
    );
    const frozen = { goalId: goal.id, reqP, target, value: missingPrices ? null : value };
    if (note !== null) {
      return {
        ...frozen,
        prob: null,
        detNet: null,
        median: null,
        p10: null,
        p90: null,
        status: null,
      };
    }
    const distribution = distributions[next++] as GoalDistribution;
    return {
      ...frozen,
      prob: distribution.pSuccess,
      detNet: projectGoal(input).net,
      median: distribution.p50.at(-1) as number,
      p10: distribution.p10.at(-1) as number,
      p90: distribution.p90.at(-1) as number,
      status: goalStatus(distribution.pSuccess, reqP, settings.thresholds.statusBandPoints),
    };
  });
}
