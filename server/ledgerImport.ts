import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { canonicalRows, cashCsv, csvNumber, resolveCsvReference } from "../engine/cashCsv.ts";
import { replayCash } from "../engine/cashLedger.ts";
import { unitPrice } from "../engine/holdings.ts";
import { isoDate } from "../engine/schemas.ts";
import { toCents, toScaled } from "../engine/units.ts";
import { csvReferences } from "./cashImport.ts";
import { loadCashMovements, validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import { previewWrite } from "./previewWrite.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { loadLedger } from "./transactions.ts";

/** Canonical trades and their cash charges settle as one validated import batch. */
export async function importLedgerCsv(
  db: Kysely<DB>,
  text: string,
  cashText = "",
  preview = false,
) {
  const { goals, products } = await csvReferences(db);
  const regimes = new Map(
    (await db.selectFrom("product").select(["id", "regime"]).execute()).map((p) => [
      p.id,
      p.regime,
    ]),
  );
  const asOf = await loadOpeningAsOf(db);
  const ids = new Set<string>();
  const parsed = canonicalRows(text, [
    "sourceId",
    "date",
    "bucket",
    "product",
    "type",
    "qty",
    "price",
    "commission",
    "note",
  ]).map((row) => {
    if (!row.sourceId || ids.has(row.sourceId))
      throw new Error("Each trade requires a unique sourceId.");
    ids.add(row.sourceId);
    const date = isoDate.parse(row.date);
    if (asOf && date <= asOf) throw new Error("Trades must be after the opening date.");
    if (row.type !== "buy" && row.type !== "sell")
      throw new Error("Canonical trades accept buy and sell; import income as a cash movement.");
    const productId = resolveCsvReference(row.product, products);
    if (regimes.get(productId) === "pension")
      throw new Error("Pension transactions use their dedicated workflow.");
    const qty = csvNumber(row.qty);
    const price = csvNumber(row.price);
    const commission = row.commission ? csvNumber(row.commission) : 0;
    if ((row.type === "buy" ? qty <= 0 : qty >= 0) || price <= 0 || commission < 0)
      throw new Error("Check the signed quantity, positive price and commission.");
    const computedAmount = toCents(
      Math.abs(qty) * unitPrice(regimes.get(productId) ?? "etf", price),
    );
    const amountCents = row.amount ? toCents(csvNumber(row.amount)) : computedAmount;
    const tolerance = Math.max(1, Math.ceil(Math.abs(qty) * 0.0000005 * 100));
    if (amountCents <= 0 || Math.abs(computedAmount - amountCents) > tolerance)
      throw new Error("The gross amount does not match quantity and price.");
    return {
      id: `csv:${row.sourceId}`,
      date,
      goalId: resolveCsvReference(row.bucket, goals),
      productId,
      type: row.type as "buy" | "sell",
      qtyScaled: toScaled(qty),
      priceScaled: toScaled(price),
      commissionCents: toCents(commission),
      amountCents,
      note: row.note ?? "",
      flow: null,
      importBatchId: null as string | null,
    };
  });
  const storedTrades = new Map(
    (await db.selectFrom("transaction").selectAll().execute()).map((t) => [t.id, t]),
  );
  const trades = parsed.filter((row) => {
    const prior = storedTrades.get(row.id);
    if (!prior) return true;
    for (const key of [
      "date",
      "goalId",
      "productId",
      "type",
      "qtyScaled",
      "priceScaled",
      "commissionCents",
      "amountCents",
      "note",
    ] as const) {
      if (prior[key] !== row[key])
        throw new Error(`Trade ${row.id} exists with different content.`);
    }
    return false;
  });
  const storedCash = await loadCashMovements(db);
  const parsedCash = cashText.trim() ? cashCsv(cashText, goals) : [];
  if (parsedCash.some((row) => asOf && row.date <= asOf))
    throw new Error("Cash movements must be after the opening date.");
  const movements = parsedCash
    .filter((row) => {
      const prior = row.sourceId ? storedCash.find((m) => m.sourceId === row.sourceId) : undefined;
      if (!prior) return true;
      for (const key of ["date", "goalId", "type", "amountCents", "toGoalId", "note"] as const) {
        if (prior[key] !== row[key])
          throw new Error(`Cash source ${row.sourceId} exists with different content.`);
      }
      return false;
    })
    .map((row) => ({ ...row, id: randomUUID(), importBatchId: null as string | null }));
  const cashTrades = trades.map((t) => ({
    ...t,
    qty: t.qtyScaled / 1e6,
    price: unitPrice(regimes.get(t.productId) ?? "etf", t.priceScaled / 1e6),
    regime: regimes.get(t.productId),
  }));
  replayCash([...(await loadLedger(db)), ...cashTrades], [...storedCash, ...movements]);
  const count = trades.length + movements.length;
  if (!preview && count) {
    const id = randomUUID();
    await db
      .insertInto("importBatch")
      .values({
        id,
        kind: "transactions",
        sourceName: "Canonical ledger CSV",
        fileName: "transactions.csv + cash-movements.csv",
        createdAt: new Date().toISOString(),
        rowsRead: parsed.length + parsedCash.length,
        rowsImported: count,
        rowsSkipped: parsed.length + parsedCash.length - count,
        undoneAt: null,
        priorPrices: null,
        createdIds: null,
      })
      .execute();
    if (trades.length)
      await db
        .insertInto("transaction")
        .values(trades.map((t) => ({ ...t, importBatchId: id })))
        .execute();
    if (movements.length)
      await db
        .insertInto("cashMovement")
        .values(movements.map((m) => ({ ...m, importBatchId: id })))
        .execute();
    await validateLedgerHistory(db);
  }
  return { rows: count, skipped: parsed.length + parsedCash.length - count, errors: [] };
}
export function registerLedgerImportRoutes(router: Router, db: Kysely<DB>) {
  const schema = z.object({ text: z.string(), cashText: z.string().default("") });
  for (const operation of ["preview", "commit"] as const) {
    router.route("POST", `/api/import/ledger/${operation}`, schema, async ({ text, cashText }) => {
      try {
        const write = (trx: Kysely<DB>) => importLedgerCsv(trx, text, cashText);
        return operation === "commit"
          ? await db.transaction().execute(write)
          : await previewWrite(db, write);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid CSV.";
        if (operation === "commit") throw new HttpError(400, message);
        return { rows: 0, errors: [message] };
      }
    });
  }
}
