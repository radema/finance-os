import type { Kysely } from "kysely";
import { z } from "zod";
import { flowsForMix } from "../engine/optimizer.ts";
import { normaliseWeights } from "../engine/projection.ts";
import type { PensionFlow } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
import { assertProductsFit } from "./optimizer.ts";
import { loadPensionPlan } from "./pensionPlan.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";

const applyInput = z.object({
  goalId: z.string().min(1),
  weights: z
    .array(z.object({ productId: z.string().min(1), weight: z.number().min(0).max(1e9) }))
    .min(1),
  confirm: z.boolean(),
});

/** What an apply call writes, or would write: the goal's weights and, for the pension goal, its flows. */
type Change = { weights: { productId: string; weight: number }[]; flows?: PensionFlow[] };

/** Applies the optimizer's chosen weights to a goal, only when the request confirms it. */
export function registerOptimizerApplyRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/optimizer/apply", applyInput, async (input) => {
    const goal = await findOr404(db, "goal", input.goalId, "goal");
    if (goal.archived)
      throw new HttpError(409, "Reopen the archived bucket before changing its allocation.");
    const regimes = new Map(
      (await db.selectFrom("product").select(["id", "regime"]).execute()).map((row) => [
        row.id,
        row.regime,
      ]),
    );
    const ids = input.weights.map((row) => row.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, "a product is listed twice");
    for (const id of ids) if (!regimes.has(id)) throw new HttpError(404, "product not found");
    if (input.weights.every((row) => row.weight === 0))
      throw new HttpError(400, "the weights add up to zero");

    // Rescaled to 100%; a zero weight keeps no row.
    const shares = normaliseWeights(
      new Map(input.weights.map((row) => [row.productId, row.weight])),
    );
    const weights = input.weights
      .map(({ productId }) => ({ productId, weight: shares.get(productId) as number }))
      .filter((row) => row.weight > 0);

    const plan = await loadPensionPlan(db);
    const isPension = plan?.goalId === input.goalId;
    assertProductsFit(
      isPension,
      ids.map((id) => regimes.get(id)),
    );
    const change: Change =
      isPension && plan ? { weights, flows: flowsForMix(shares, plan.flows) } : { weights };

    if (!input.confirm) return { preview: change };
    await db.transaction().execute(async (trx) => {
      if (change.flows) {
        await saveDocument(trx, "pensionPlan", { ...plan, flows: change.flows });
        return;
      }
      await trx.deleteFrom("allocationWeight").where("goalId", "=", input.goalId).execute();
      await trx
        .insertInto("allocationWeight")
        .values(weights.map((row) => ({ goalId: input.goalId, ...row })))
        .execute();
    });
    return { applied: change };
  });
}
