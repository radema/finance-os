import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { CsvError } from "../engine/csv.ts";
import { addMonths, monthEnd, monthsEnding } from "../engine/months.ts";
import { priceAge } from "../engine/priceAge.ts";
import type { PriceCsvOptions, PriceRow } from "../engine/priceCsv.ts";
import { latestPerMonth, parsePriceCsv } from "../engine/priceCsv.ts";
import {
  canUseProvider,
  isoDate,
  monthSchema,
  PRICE_SOURCES,
  settingsSchema,
} from "../engine/schemas.ts";
import { fromScaled, toScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";
import type { ImportBatchTable, PricePointTable } from "./schema.ts";

/** How many months the month-end grid shows. */
const GRID_MONTHS = 6;

export type StoreResult =
  | { outcome: "stored"; prior: PricePointTable | null }
  | { outcome: "refused" };

/**
 * The one write path for a PricePoint. A `manual` price is not overwritten by a `provider` price
 * for the same month, unless the call says it is an explicit re-fetch. Every other write replaces
 * the stored price of that product and month.
 *
 * @param db Database handle, or a transaction.
 * @param point The price to store.
 * @param options `explicitRefetch`: the user asked to fetch again, so a provider price wins.
 * @returns `stored` with the price it replaced (null when new), or `refused`.
 */
export async function storePrice(
  db: Kysely<DB>,
  point: PricePointTable,
  { explicitRefetch }: { explicitRefetch: boolean },
): Promise<StoreResult> {
  const prior =
    (await db
      .selectFrom("pricePoint")
      .selectAll()
      .where("productId", "=", point.productId)
      .where("month", "=", point.month)
      .executeTakeFirst()) ?? null;
  if (prior?.source === "manual" && point.source === "provider" && !explicitRefetch) {
    return { outcome: "refused" };
  }
  const { productId, month, ...values } = point;
  await db
    .insertInto("pricePoint")
    .values(point)
    .onConflict((conflict) => conflict.columns(["productId", "month"]).doUpdateSet(values))
    .execute();
  return { outcome: "stored", prior };
}

export interface PriceImportResult {
  batch: ImportBatchTable;
  /** Product names, ISINs or tickers of the file that match no product. Their rows are skipped. */
  unknownProducts: string[];
}

/**
 * Stores CSV prices as one `prices` ImportBatch, in one transaction. Products match by ISIN, then
 * ticker, then exact name. A CSV price overwrites any stored price of that product and month; the
 * batch keeps the prior state of each one it overwrote (for the undo of #36).
 *
 * @param db Database handle.
 * @param rows Parsed price rows.
 * @param meta Names for the batch, and the time stamp stored as `fetchedAt`.
 * @throws HttpError 400 when no row matches a product.
 */
export async function importPrices(
  db: Kysely<DB>,
  rows: readonly PriceRow[],
  meta: { fileName: string; sourceName: string; fetchedAt: string },
): Promise<PriceImportResult> {
  return db.transaction().execute(async (trx) => {
    const products = await trx
      .selectFrom("product")
      .select(["id", "name", "isin", "ticker"])
      .execute();
    const upper = (text: string) => text.trim().toUpperCase();
    const index = (key: (p: (typeof products)[number]) => string) =>
      new Map(products.filter((p) => key(p) !== "").map((p) => [key(p), p.id]));
    const byIsin = index((p) => upper(p.isin));
    const byTicker = index((p) => upper(p.ticker));
    const byName = index((p) => p.name);
    const match = (text: string) =>
      byIsin.get(upper(text)) ?? byTicker.get(upper(text)) ?? byName.get(text.trim());

    const unknownProducts = new Set<string>();
    const known: (PriceRow & { productId: string })[] = [];
    for (const row of rows) {
      const productId = match(row.product);
      if (productId) known.push({ ...row, productId });
      else unknownProducts.add(row.product);
    }
    if (known.length === 0) {
      throw new HttpError(
        400,
        `No product in the file is known. Not found: ${[...unknownProducts].join(", ")}.`,
      );
    }

    const kept = latestPerMonth(known, (row) => row.productId);
    const id = randomUUID();
    await trx
      .insertInto("importBatch")
      .values({
        id,
        kind: "prices",
        sourceName: meta.sourceName,
        fileName: meta.fileName,
        createdAt: meta.fetchedAt,
        rowsRead: rows.length,
        rowsImported: kept.length,
        rowsSkipped: rows.length - kept.length,
        undoneAt: null,
        priorPrices: null,
      })
      .execute();
    const priors: PricePointTable[] = [];
    for (const row of kept) {
      const result = await storePrice(
        trx,
        {
          productId: row.productId,
          month: row.date.slice(0, 7),
          priceScaled: toScaled(row.price),
          priceDate: row.date,
          source: "csv",
          fetchedAt: meta.fetchedAt,
          importBatchId: id,
        },
        { explicitRefetch: false },
      );
      if (result.outcome === "stored" && result.prior) priors.push(result.prior);
    }
    await trx
      .updateTable("importBatch")
      .set({ priorPrices: JSON.stringify(priors) })
      .where("id", "=", id)
      .execute();
    const batch = await trx
      .selectFrom("importBatch")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return { batch, unknownProducts: [...unknownProducts] };
  });
}

const settingsFields = {
  delimiter: z.enum([";", ",", "\t", "auto"]).default("auto"),
  decimal: z.enum(["comma", "point", "auto"]).default("auto"),
  dateFormat: z.enum(["iso", "dmy", "ym", "auto"]).default("auto"),
  format: z.enum(["long", "wide", "auto"]).default("auto"),
};
const importBody = z.object({
  text: z.string(),
  fileName: z.string().default("pasted text"),
  ...settingsFields,
});
const manualPriceBody = z.object({
  productId: z.string().min(1),
  month: monthSchema,
  price: z.number().positive(),
});
const sourceBody = z.object({
  productId: z.string().min(1),
  priceSource: z.enum(PRICE_SOURCES),
});
const brokerUnitsBody = z
  .object({
    productId: z.string().min(1),
    units: z.number().min(0).nullable(),
    date: isoDate.nullable(),
  })
  .refine((body) => (body.units === null) === (body.date === null), {
    message: "units and date go together: set both, or clear both",
    path: ["date"],
  });
const gridQuery = z.object({ through: monthSchema.optional() });

/** Prices: month-end grid, manual entry, CSV import, source per product, broker units. */
export function registerPriceRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/prices/grid", gridQuery, async ({ through }) => {
    const currentMonth = today().slice(0, 7);
    const months = monthsEnding(
      through && through > currentMonth ? through : currentMonth,
      GRID_MONTHS,
    );
    const products = await db
      .selectFrom("product")
      .select(["id", "name", "regime", "priceSource"])
      .orderBy("name")
      .execute();
    const points = await db
      .selectFrom("pricePoint")
      .selectAll()
      .where("month", ">=", months[0] as string)
      .where("month", "<=", months.at(-1) as string)
      .execute();
    return {
      currentMonth,
      months,
      rows: products.map(({ id, ...product }) => ({
        productId: id,
        ...product,
        prices: Object.fromEntries(
          points
            .filter((p) => p.productId === id)
            .map((p) => [
              p.month,
              { price: fromScaled(p.priceScaled), source: p.source, priceDate: p.priceDate },
            ]),
        ),
      })),
    };
  });

  router.route("GET", "/api/prices/overview", z.object({}), async () => {
    const products = await db.selectFrom("product").selectAll().orderBy("name").execute();
    const points = await db.selectFrom("pricePoint").selectAll().orderBy("month", "desc").execute();
    const { thresholds } = await loadDocument(db, "settings", settingsSchema);
    return products.map((product) => {
      const own = points.filter((p) => p.productId === product.id);
      const last = own[0];
      return {
        productId: product.id,
        name: product.name,
        regime: product.regime,
        priceSource: product.priceSource,
        lastPrice: last ? { price: fromScaled(last.priceScaled), priceDate: last.priceDate } : null,
        age: priceAge(product, own, today(), thresholds.dailyPriceAgeDays),
        brokerUnits:
          product.brokerUnitsScaled === null ? null : fromScaled(product.brokerUnitsScaled),
        brokerUnitsDate: product.brokerUnitsDate,
      };
    });
  });

  // The price date of a typed price is the clock date for the current month, else the month's last day.
  router.route("PUT", "/api/prices", manualPriceBody, async ({ productId, month, price }) => {
    const now = today();
    const editable = [now.slice(0, 7), addMonths(now.slice(0, 7), 1)];
    if (!editable.includes(month)) {
      throw new HttpError(
        400,
        `Only ${editable.join(" and ")} can be typed. Correct an earlier month with a CSV.`,
      );
    }
    await findOr404(db, "product", productId, "product");
    await storePrice(
      db,
      {
        productId,
        month,
        priceScaled: toScaled(price),
        priceDate: month === now.slice(0, 7) ? now : monthEnd(month),
        source: "manual",
        fetchedAt: new Date().toISOString(),
        importBatchId: null,
      },
      { explicitRefetch: false },
    );
    return { productId, month, price };
  });

  router.route("POST", "/api/prices/import", importBody, async ({ text, fileName, ...options }) => {
    let rows: PriceRow[];
    try {
      rows = parsePriceCsv(text, options satisfies PriceCsvOptions);
    } catch (error) {
      if (error instanceof CsvError) throw new HttpError(400, error.message);
      throw error;
    }
    const { batch, unknownProducts } = await importPrices(db, rows, {
      fileName,
      sourceName: "Prices CSV",
      fetchedAt: new Date().toISOString(),
    });
    return {
      batchId: batch.id,
      rowsRead: batch.rowsRead,
      rowsImported: batch.rowsImported,
      rowsSkipped: batch.rowsSkipped,
      unknownProducts,
    };
  });

  router.route("PUT", "/api/prices/source", sourceBody, async ({ productId, priceSource }) => {
    const { regime } = await findOr404(db, "product", productId, "product");
    if (priceSource === "provider" && !canUseProvider(regime)) {
      throw new HttpError(400, "A BTP or a pension fund has no provider: use manual or CSV.");
    }
    await db.updateTable("product").set({ priceSource }).where("id", "=", productId).execute();
    return { productId, priceSource };
  });

  router.route(
    "PUT",
    "/api/prices/broker-units",
    brokerUnitsBody,
    async ({ productId, units, date }) => {
      await findOr404(db, "product", productId, "product");
      await db
        .updateTable("product")
        .set({ brokerUnitsScaled: units === null ? null : toScaled(units), brokerUnitsDate: date })
        .where("id", "=", productId)
        .execute();
      return { productId, units, date };
    },
  );
}
