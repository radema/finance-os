import type { Kysely } from "kysely";
import { z } from "zod";
import type { AllocationRow } from "../engine/schemas.ts";
import { allocationWeightSchema } from "../engine/schemas.ts";
import { normaliseWeights } from "../engine/weights.ts";
import type { DB } from "./db.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

const weightKey = z.object({ goalId: z.string().min(1), productId: z.string().min(1) });

/** Adds each weight's share of its goal's total. */
function withShares(
  rows: { goalId: string; productId: string; weight: number }[],
): AllocationRow[] {
  const result: AllocationRow[] = [];
  for (const goalId of new Set(rows.map((row) => row.goalId))) {
    const goalRows = rows.filter((row) => row.goalId === goalId);
    const shares = normaliseWeights(goalRows.map((row) => row.weight));
    for (const [i, row] of goalRows.entries()) result.push({ ...row, share: shares[i] as number });
  }
  return result;
}

/** Allocation weights per goal and product, each with its rescaled share. Not versioned. */
export function registerAllocationRoutes(router: Router, db: Kysely<DB>): void {
  const weights = async (goalId?: string) => {
    let query = db
      .selectFrom("allocationWeight")
      .innerJoin("product", "product.id", "allocationWeight.productId")
      .select(["allocationWeight.goalId", "allocationWeight.productId", "allocationWeight.weight"])
      .orderBy("allocationWeight.goalId")
      .orderBy("product.name");
    if (goalId) query = query.where("allocationWeight.goalId", "=", goalId);
    return withShares(await query.execute());
  };

  router.route("GET", "/api/allocation", z.object({}), () => weights());

  // Sets one weight: creates the row, or edits it. The response is the goal's weights, rescaled.
  router.route("PUT", "/api/allocation", allocationWeightSchema, async (input) => {
    const goal = await db
      .selectFrom("goal")
      .select("id")
      .where("id", "=", input.goalId)
      .executeTakeFirst();
    if (!goal) throw new HttpError(404, "goal not found");
    const product = await db
      .selectFrom("product")
      .select("id")
      .where("id", "=", input.productId)
      .executeTakeFirst();
    if (!product) throw new HttpError(404, "product not found");
    await db
      .insertInto("allocationWeight")
      .values(input)
      .onConflict((conflict) =>
        conflict.columns(["goalId", "productId"]).doUpdateSet({ weight: input.weight }),
      )
      .execute();
    return weights(input.goalId);
  });

  router.route("DELETE", "/api/allocation", weightKey, async ({ goalId, productId }) => {
    const { numDeletedRows } = await db
      .deleteFrom("allocationWeight")
      .where("goalId", "=", goalId)
      .where("productId", "=", productId)
      .executeTakeFirstOrThrow();
    if (numDeletedRows === 0n) throw new HttpError(404, "weight not found");
    return weights(goalId);
  });
}
