import type { Kysely } from "kysely";
import { z } from "zod";
import { normaliseWeights } from "../engine/projection.ts";
import type { PensionFlow } from "../engine/schemas.ts";
import { PENSION_FLOWS } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
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

/**
 * The pension goal's flows for one weight vector: every flow the plan has (both, when it has none)
 * gets the optimizer weights as its `pct` values.
 */
function flowsFor(weights: Change["weights"], current: readonly PensionFlow[]): PensionFlow[] {
  const kinds = PENSION_FLOWS.filter(
    (kind) => current.length === 0 || current.some((flow) => flow.flow === kind),
  );
  return kinds.flatMap((flow) =>
    weights.map(({ productId, weight }) => ({ productId, flow, pct: weight })),
  );
}

/** Applies the optimizer's chosen weights to a goal, only when the request confirms it. */
export function registerOptimizerApplyRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/optimizer/apply", applyInput, async (input) => {
    await findOr404(db, "goal", input.goalId, "goal");
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
    if (isPension && ids.some((id) => regimes.get(id) !== "pension"))
      throw new HttpError(400, "the pension goal takes pension funds only");
    const change: Change =
      isPension && plan ? { weights, flows: flowsFor(weights, plan.flows) } : { weights };

    if (!input.confirm) return { preview: change };
    await db.transaction().execute(async (trx) => {
      if (isPension && plan && change.flows) {
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
