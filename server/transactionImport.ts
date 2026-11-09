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
import { validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import { previewWrite } from "./previewWrite.ts";
import { HttpError } from "./router.ts";
import type { ImportBatchTable } from "./schema.ts";
import { loadLedger } from "./transactions.ts";

export type ImportBatch = Selectable<ImportBatchTable>;

/** Where a file came from, as stored on its batch. */
export type ImportSource = { sourceName: string; fileName: string };

/** Reads the data the preview checks rows against. */
export async function loadImportState(db: Kysely<DB>): Promise<ImportState> {
  const [products, goals, weights, ledger, storedTrades, storedCoupons, openingAsOf] =
    await Promise.all([
      db.selectFrom("product").select(["id", "isin", "ticker", "name", "regime"]).execute(),
      db.selectFrom("goal").select("id").execute(),
      db.selectFrom("allocationWeight").selectAll().execute(),
      loadLedger(db),
      db
        .selectFrom("transaction")
        .select(["date", "productId", "priceScaled", "qtyScaled"])
        .where("type", "in", ["buy", "sell"])
        .execute(),
      db
        .selectFrom("transaction")
        .select(["date", "productId", "amountCents"])
        .where("type", "=", "coupon")
        .execute(),
      loadOpeningAsOf(db),
    ]);
  return {
    products,
    goalIds: goals.map((goal) => goal.id),
    weights,
    ledger,
    storedTrades,
    storedCoupons,
    openingAsOf,
  };
}

/** The preview of a file against the data as it is now. Nothing is written. */
export async function previewImport(
  db: Kysely<DB>,
  rows: readonly ImportRow[],
  decisions: Readonly<Record<number, RowDecision>>,
): Promise<PreviewRow[]> {
  const previews = previewTransactionImport(rows, await loadImportState(db), decisions);
  try {
    await previewWrite(db, (trx) =>
      writeTransactionImport(trx, rows, decisions, { sourceName: "Preview", fileName: "Preview" }),
    );
    return previews;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid transaction history.";
    return previews.map((row) =>
      row.status === "ready"
        ? {
            ...row,
            status: "needs fix",
            reasons: [...row.reasons, reason],
            split: null,
            couponParts: [],
          }
        : row,
    );
  }
}

/**
 * Commits the ready rows of a file as one batch, in one database transaction. The statuses are
 * computed again here; nothing the client holds is trusted. Each part of a confirmed split, and
 * each part of a coupon, is its own transaction. A row counts once in the batch, whatever its number of parts.
 *
 * @returns The batch, or `null` when no row is ready: then nothing is written, not even a batch.
 */
export function commitTransactionImport(
  db: Kysely<DB>,
  rows: readonly ImportRow[],
  decisions: Readonly<Record<number, RowDecision>>,
  source: ImportSource,
): Promise<ImportBatch | null> {
  return db.transaction().execute((trx) => writeTransactionImport(trx, rows, decisions, source));
}

async function writeTransactionImport(
  trx: Kysely<DB>,
  rows: readonly ImportRow[],
  decisions: Readonly<Record<number, RowDecision>>,
  source: ImportSource,
): Promise<ImportBatch | null> {
  const state = await loadImportState(trx);
  const previews = previewTransactionImport(rows, state, decisions);
  const ready = previews.flatMap((preview, index) => {
    const row = rows[index];
    return preview.status === "ready" && row ? [{ row, preview }] : [];
  });
  if (ready.length === 0) return null;
  const archived = new Set(
    (await trx.selectFrom("goal").select("id").where("archived", "=", 1).execute()).map(
      (goal) => goal.id,
    ),
  );
  if (
    ready.some(({ preview }) =>
      [...preview.couponParts, ...(preview.split?.parts ?? [])].some((part) =>
        archived.has(part.goalId),
      ),
    )
  )
    throw new HttpError(409, "Restore archived buckets before importing trades.");

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
    createdIds: null,
  };
  await trx.insertInto("importBatch").values(batch).execute();

  const regimes = new Map(state.products.map((product) => [product.id, product.regime]));
  for (const { row, preview } of ready) {
    const productId = preview.productId as string;
    // A coupon: qty 0, price 0 (it never enters the PMC), the net cash as the amount.
    for (const part of preview.couponParts) {
      await trx
        .insertInto("transaction")
        .values({
          id: randomUUID(),
          date: row.date as string,
          goalId: part.goalId,
          productId,
          type: "coupon",
          qtyScaled: 0,
          priceScaled: 0,
          commissionCents: null,
          amountCents: part.amountCents,
          note: "",
          flow: null,
          importBatchId: batch.id,
        })
        .execute();
    }
    const regime = regimes.get(productId) as Regime;
    const price = parseDecimal(row.price) as number;
    for (const part of preview.split?.parts ?? []) {
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
          note: row.note ?? "",
          flow: null,
          importBatchId: batch.id,
        })
        .execute();
    }
  }
  await validateLedgerHistory(trx);
  return batch;
}
