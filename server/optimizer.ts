import type { Kysely } from "kysely";
import { z } from "zod";
import { requiredProbability } from "../engine/goalStatus.ts";
import { monteCarloGoalOf } from "../engine/goalViews.ts";
import { monthEnd } from "../engine/months.ts";
import {
  generateMixes,
  mixOfFlows,
  PensionRebalanceError,
  rankMixes,
  runOptimizer,
  simulateCurrent,
} from "../engine/optimizer.ts";
import { mixView, type OptimizerRunView } from "../engine/optimizerView.ts";
import { normaliseWeights, targetAtGoalDate } from "../engine/projection.ts";
import { timeGrid } from "../engine/timeGrid.ts";
import type { DB } from "./db.ts";
import { loadWorld } from "./goalViews.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

const TOP = 10;

const runInput = z.object({
  goalId: z.string().min(1),
  products: z.array(z.string().min(1)).min(1).max(6),
  mode: z.enum(["new", "rebalance"]),
  criterion: z.enum(["O1", "O2", "O4", "O5"]),
  maxPerProduct: z.number().gt(0).max(1).optional(),
});

/** Pension funds go to the pension goal only, and it takes nothing else: a 400 for the optimizer's routes. */
export function assertProductsFit(
  isPension: boolean,
  regimes: readonly (string | undefined)[],
): void {
  if (regimes.some((regime) => (regime === "pension") !== isPension))
    throw new HttpError(
      400,
      "pension funds go to the pension goal only, and it takes nothing else",
    );
}

/** The optimizer's run: the engine over the goal's bucket, with the bucket as it is for comparison. */
export function registerOptimizerRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("POST", "/api/optimizer/run", runInput, async (input): Promise<OptimizerRunView> => {
    const world = await loadWorld(db, today());
    const goal = world.goals.find((candidate) => candidate.id === input.goalId);
    if (!goal) throw new HttpError(404, "goal not found");
    if (goal.archived) throw new HttpError(409, "Reopen the archived bucket before optimizing.");
    if (new Set(input.products).size !== input.products.length)
      throw new HttpError(400, "a product is listed twice");
    for (const id of input.products) {
      if (!world.products.has(id)) throw new HttpError(404, "product not found");
    }
    const isPension = world.pension?.goalId === goal.id;
    const regimes = input.products.map((id) => world.products.get(id)?.regime);
    assertProductsFit(isPension, regimes);
    if (regimes.includes("pension") && world.pension?.firstYear === undefined)
      throw new HttpError(400, "the pension plan has no first year of membership");
    if (generateMixes(input.products, input.maxPerProduct).length === 0)
      throw new HttpError(400, "the per-product maximum leaves no mix");

    const { input: bucket, note } = monteCarloGoalOf(world, goal);
    if (note !== null) throw new HttpError(400, note);

    const requiredP = requiredProbability(goal, world.settings.requiredProb);
    const { seed } = world.settings;
    const { correlations } = world;
    try {
      const result = runOptimizer({ ...input, bucket, requiredP, correlations, seed });
      // The pension goal's weights are the pct of its plan's flows, not the allocation rows.
      const currentWeights = bucket.pension
        ? mixOfFlows(bucket.pension.plan.flows)
        : normaliseWeights(bucket.weights);
      const current = simulateCurrent(
        { ...bucket, weights: currentWeights },
        input.criterion,
        requiredP,
        correlations,
        seed,
      );
      return {
        asOf: monthEnd(world.month),
        mode: input.mode,
        criterion: input.criterion,
        requiredP,
        target: targetAtGoalDate(
          goal.target,
          world.settings.inflation,
          timeGrid(bucket.asOf, goal.targetYear).tau,
        ),
        current: mixView(current),
        chosen: mixView(result.chosen),
        notFeasible: result.notFeasible,
        ruleName: result.ruleName,
        ruleText: result.ruleText,
        switchTax: result.switchTax,
        mixes: result.mixes.map(mixView),
        top: rankMixes(result.mixes, input.criterion, requiredP).slice(0, TOP).map(mixView),
      };
    } catch (error) {
      if (error instanceof PensionRebalanceError) throw new HttpError(400, error.message);
      throw error;
    }
  });
}
