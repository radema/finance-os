import type { Kysely } from "kysely";
import { validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { undoCreatedRows } from "./recordImport.ts";
import { HttpError } from "./router.ts";
import type { ImportBatchTable, PricePointTable } from "./schema.ts";

/**
 * Undoes one whole import batch, in one database transaction. A transactions batch loses every
 * transaction that carries its id. A prices batch loses the price points it wrote, and each price
 * it overwrote comes back from the prior state stored on the batch. A products or goals batch
 * loses the rows it created that nothing uses; rows it updated keep their new values. The batch
 * row stays, with `undoneAt` set.
 *
 * @param db Database handle.
 * @param batchId The batch to undo.
 * @returns The batch, now undone, with the ids of created products or goals kept because they are
 *   in use (`kept`, empty for other kinds).
 * @throws HttpError 404 for an unknown batch; 409 for a batch already undone or a prices batch a
 *   later active batch overwrote.
 */
export function undoBatch(
  db: Kysely<DB>,
  batchId: string,
): Promise<ImportBatchTable & { kept: string[] }> {
  return db.transaction().execute(async (trx) => {
    const batch = await trx
      .selectFrom("importBatch")
      .selectAll()
      .where("id", "=", batchId)
      .executeTakeFirst();
    if (!batch) throw new HttpError(404, "This import does not exist.");
    if (batch.undoneAt) throw new HttpError(409, "This import is already undone.");

    let kept: string[] = [];
    if (batch.kind === "transactions") {
      await trx.deleteFrom("transaction").where("importBatchId", "=", batchId).execute();
      await trx.deleteFrom("cashMovement").where("importBatchId", "=", batchId).execute();
      await validateLedgerHistory(trx);
    } else if (batch.kind === "prices") {
      // A later active batch that overwrote one of these prices holds it as its prior state:
      // restoring over it would bring back a price of this undone batch. Undo that batch first.
      const later = await trx
        .selectFrom("importBatch")
        .select("priorPrices")
        .where("kind", "=", "prices")
        .where("undoneAt", "is", null)
        .where("id", "!=", batchId)
        .execute();
      const replaced = later.some((other) =>
        (JSON.parse(other.priorPrices ?? "[]") as PricePointTable[]).some(
          (prior) => prior.importBatchId === batchId,
        ),
      );
      if (replaced) {
        throw new HttpError(409, "A later import changed these prices. Undo that import first.");
      }
      await trx.deleteFrom("pricePoint").where("importBatchId", "=", batchId).execute();
      const priors = JSON.parse(batch.priorPrices ?? "[]") as PricePointTable[];
      // A price a later write replaced stays as it is: `doNothing` skips its prior.
      for (const prior of priors) {
        await trx
          .insertInto("pricePoint")
          .values(prior)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
      }
    } else {
      kept = (await undoCreatedRows(trx, batch)).kept;
    }

    const undoneAt = new Date().toISOString();
    await trx.updateTable("importBatch").set({ undoneAt }).where("id", "=", batchId).execute();
    return { ...batch, undoneAt, kept };
  });
}
