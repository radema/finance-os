import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Regime } from "../engine/holdings.ts";
import { unitPrice } from "../engine/holdings.ts";
import type {
  ImportRow,
  ImportState,
  PreviewRow,
  RowDecision,
} from "../engine/transactionImport.ts";
import { parseDecimal, previewTransactionImport } from "../engine/transactionImport.ts";
import { toCents, toScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import type { ImportBatchTable } from "./schema.ts";
import { loadLedger } from "./transactions.ts";

export type ImportBatch = Selectable<ImportBatchTable>;

/** Where a file came from, as stored on its batch. */
export type ImportSource = { sourceName: string; fileName: string };

/** Reads the data the preview checks rows against. */
export async function loadImportState(db: Kysely<DB>): Promise<ImportState> {
  const [products, goals, weights, ledger, storedTrades, openingAsOf] = await Promise.all([
    db.selectFrom("product").select(["id", "isin", "ticker", "name", "regime"]).execute(),
    db.selectFrom("goal").select("id").execute(),
    db.selectFrom("allocationWeight").selectAll().execute(),
    loadLedger(db),
    db
      .selectFrom("transaction")
      .select(["date", "productId", "priceScaled", "qtyScaled"])
      .where("type", "in", ["buy", "sell"])
      .execute(),
    loadOpeningAsOf(db),
  ]);
  return {
    products,
    goalIds: goals.map((goal) => goal.id),
    weights,
    ledger,
    storedTrades,
    openingAsOf,
  };
}

/** The preview of a file against the data as it is now. Nothing is written. */
export async function previewImport(
  db: Kysely<DB>,
  rows: readonly ImportRow[],
  decisions: Readonly<Record<number, RowDecision>>,
): Promise<PreviewRow[]> {
  return previewTransactionImport(rows, await loadImportState(db), decisions);
}

/**
 * Commits the ready rows of a file as one batch, in one database transaction. The statuses are
 * computed again here; nothing the client holds is trusted. Each part of a confirmed split is its
 * own transaction. A row counts once in the batch, whatever its number of parts.
 *
 * @returns The batch, or `null` when no row is ready: then nothing is written, not even a batch.
 */
export function commitTransactionImport(
  db: Kysely<DB>,
  rows: readonly ImportRow[],
  decisions: Readonly<Record<number, RowDecision>>,
  source: ImportSource,
): Promise<ImportBatch | null> {
  return db.transaction().execute(async (trx) => {
    const state = await loadImportState(trx);
    const previews = previewTransactionImport(rows, state, decisions);
    const ready = previews.flatMap((preview, index) => {
      const row = rows[index];
      return preview.status === "ready" && preview.split && row
        ? [{ row, preview, split: preview.split }]
        : [];
    });
    if (ready.length === 0) return null;

    const batch: ImportBatch = {
      id: randomUUID(),
      kind: "transactions",
      ...source,
      createdAt: new Date().toISOString(),
      rowsRead: rows.length,
      rowsImported: ready.length,
      rowsSkipped: rows.length - ready.length,
      undoneAt: null,
      priorPrices: null,
    };
    await trx.insertInto("importBatch").values(batch).execute();

    const regimes = new Map(state.products.map((product) => [product.id, product.regime]));
    for (const { row, preview, split } of ready) {
      const productId = preview.productId as string;
      const regime = regimes.get(productId) as Regime;
      const price = parseDecimal(row.price) as number;
      for (const part of split.parts) {
        await trx
          .insertInto("transaction")
          .values({
            id: randomUUID(),
            date: row.date as string,
            goalId: part.goalId,
            productId,
            type: row.type === "sell" ? "sell" : "buy",
            qtyScaled: toScaled(row.type === "sell" ? -part.units : part.units),
            priceScaled: toScaled(price),
            commissionCents: row.commission === null ? null : part.commissionCents,
            amountCents: toCents(part.units * unitPrice(regime, price)),
            note: "",
            importBatchId: batch.id,
          })
          .execute();
      }
    }
    return batch;
  });
}
