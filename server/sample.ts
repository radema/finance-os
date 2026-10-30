import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { sampleDataSchema } from "../engine/fixture.ts";
import { unitPrice } from "../engine/holdings.ts";
import { toCents, toScaled } from "../engine/units.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
import { toColumns as goalColumns } from "./goals.ts";
import { toColumns as productColumns } from "./products.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

// Bundled into the server build: the installed app has no repo files at run time.
const sample = sampleDataSchema.parse(sampleJson);

/** True when the data folder has nothing the sample loader would collide with. */
export async function isEmpty(db: Kysely<DB>): Promise<boolean> {
  for (const table of ["product", "goal", "transaction"] as const) {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    if (row.n > 0) return false;
  }
  // The loader writes these two documents, so a saved one would be overwritten.
  const documents = await db
    .selectFrom("document")
    .select("kind")
    .where("kind", "in", ["settings", "pensionPlan"])
    .execute();
  return documents.length === 0;
}

/**
 * Writes the synthetic fixture (products, prices, goals with plans, weights, ledger, settings and
 * the partial pension plan) in one transaction. It never touches existing data.
 *
 * @throws HttpError 409 when the data folder already has a product, a goal, a transaction, or a saved settings or
 * pension plan document.
 */
export async function loadSampleData(db: Kysely<DB>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    if (!(await isEmpty(trx))) {
      throw new HttpError(
        409,
        "The data folder is not empty. The sample data loads only into an empty one.",
      );
    }
    const regimes = new Map(sample.products.map((product) => [product.id, product.regime]));
    const fetchedAt = `${sample.asOf}T12:00:00Z`;

    for (const { id, ...input } of sample.products) {
      await trx
        .insertInto("product")
        .values({ id, ...productColumns(input) })
        .execute();
    }
    for (const { productId, month, price, priceDate } of sample.prices) {
      await trx
        .insertInto("pricePoint")
        .values({
          productId,
          month,
          priceScaled: toScaled(price),
          priceDate,
          source: "manual",
          fetchedAt,
          importBatchId: null,
        })
        .execute();
    }
    for (const { id, plan, ...input } of sample.goals) {
      await trx
        .insertInto("goal")
        .values({ id, ...goalColumns(input) })
        .execute();
      for (const { fromMonth, monthlyCents } of plan) {
        await trx
          .insertInto("contributionPlan")
          .values({ goalId: id, fromMonth, monthlyCents })
          .execute();
      }
    }
    for (const weight of sample.allocation) {
      await trx.insertInto("allocationWeight").values(weight).execute();
    }
    for (const { commission, qty, price, productId, ...row } of sample.ledger) {
      const regime = regimes.get(productId);
      if (!regime) throw new Error(`The fixture ledger names an unknown product ${productId}`);
      await trx
        .insertInto("transaction")
        .values({
          id: randomUUID(),
          ...row,
          productId,
          qtyScaled: toScaled(qty),
          priceScaled: toScaled(price),
          commissionCents: commission === undefined ? null : toCents(commission),
          amountCents: toCents(Math.abs(qty) * unitPrice(regime, price)),
          note: "",
          importBatchId: null,
        })
        .execute();
    }
    await saveDocument(trx, "settings", sample.settings);
    await saveDocument(trx, "pensionPlan", sample.pensionPlan);
  });
}

/** One call for the "Load the sample data" button (#24, #38). */
export function registerSampleRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/sample-data", z.unknown(), async () => {
    await loadSampleData(db);
    return {
      products: sample.products.length,
      goals: sample.goals.length,
      transactions: sample.ledger.length,
    };
  });
}
