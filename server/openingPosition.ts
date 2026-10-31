import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { unitPrice } from "../engine/holdings.ts";
import type { Transaction } from "../engine/schemas.ts";
import { openingDateSchema, openingPositionInputSchema } from "../engine/schemas.ts";
import { toCents, toScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";
import { fromRow } from "./transactions.ts";

/** The asOf date of the saved opening position, or null when none was saved. Read by the import. */
export async function loadOpeningAsOf(db: Kysely<DB>): Promise<string | null> {
  const row = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", "openingDate")
    .executeTakeFirst();
  return row ? openingDateSchema.parse(JSON.parse(row.value)).asOf : null;
}

/**
 * The Current portfolio: one save writes the asOf date and one `opening` transaction per part.
 * A second save is refused (409): the saved rows are edited in Transactions.
 */
export function registerOpeningPositionRoutes(router: Router, db: Kysely<DB>): void {
  router.route("GET", "/api/opening-position", z.object({}), async () => ({
    asOf: await loadOpeningAsOf(db),
  }));

  router.route("POST", "/api/opening-position", openingPositionInputSchema, ({ asOf, positions }) =>
    db.transaction().execute(async (trx) => {
      if ((await loadOpeningAsOf(trx)) !== null) {
        throw new HttpError(
          409,
          "An opening position is already saved. Edit or delete its rows in Transactions.",
        );
      }
      const saved: Transaction[] = [];
      for (const { productId, pmc, parts } of positions) {
        const { regime } = await findOr404(trx, "product", productId, "product");
        for (const { goalId, units } of parts) {
          await findOr404(trx, "goal", goalId, "goal");
          const row = {
            id: randomUUID(),
            date: asOf,
            goalId,
            productId,
            type: "opening" as const,
            qtyScaled: toScaled(units),
            priceScaled: toScaled(pmc),
            commissionCents: null,
            amountCents: toCents(units * unitPrice(regime, pmc)),
            note: "",
            importBatchId: null,
          };
          await trx.insertInto("transaction").values(row).execute();
          saved.push(fromRow(row));
        }
      }
      await saveDocument(trx, "openingDate", { asOf });
      return saved;
    }),
  );
}
