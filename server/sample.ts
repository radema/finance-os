import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { SampleData } from "../engine/fixture.ts";
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
const bundled = sampleDataSchema.parse(sampleJson);

/** True when the data folder has nothing the sample loader would collide with. */
export async function isEmpty(db: Kysely<DB>): Promise<boolean> {
  for (const table of ["product", "goal", "transaction"] as const) {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    if (row.n > 0) return false;
  }
  // The loader writes these documents, so a saved one would be overwritten.
  const documents = await db
    .selectFrom("document")
    .select("kind")
    .where("kind", "in", ["settings", "pensionPlan", "cashFlow"])
    .execute();
  return documents.length === 0;
}

/**
 * Writes the synthetic fixture (products, prices, goals with plans, weights, ledger, settings,
 * the partial pension plan and the cash flow) in one transaction. It never touches existing data.
 *
 * @param db Database handle.
 * @param sample The data to write. Defaults to the bundled sample; tests pass a larger fixture.
 * @throws HttpError 409 when the data folder already has a product, a goal, a transaction, or a saved settings,
 * pension plan or cash flow document.
 */
export async function loadSampleData(db: Kysely<DB>, sample: SampleData = bundled): Promise<void> {
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
      const id = randomUUID();
      await trx
        .insertInto("transaction")
        .values({
          id,
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
      await trx.insertInto("legacyTransaction").values({ id }).execute();
    }
    await saveDocument(trx, "settings", sample.settings);
    await saveDocument(trx, "pensionPlan", sample.pensionPlan);
    await saveDocument(trx, "cashFlow", sample.cashFlow);
  });
}

/** One call for the "Load the sample data" button (#24, #38). */
export function registerSampleRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/sample-data", z.unknown(), async () => {
    await loadSampleData(db);
    return {
      products: bundled.products.length,
      goals: bundled.goals.length,
      transactions: bundled.ledger.length,
    };
  });
}
