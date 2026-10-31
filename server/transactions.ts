import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import type { LedgerRow } from "../engine/holdings.ts";
import { holdingsAt, unitPrice } from "../engine/holdings.ts";
import type { Transaction, TransactionInput } from "../engine/schemas.ts";
import { transactionInputSchema } from "../engine/schemas.ts";
import { fromCents, fromScaled, toScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import type { TransactionTable } from "./schema.ts";

const listQuery = z.object({
  goalId: z.string().min(1).optional(),
  year: z
    .string()
    .regex(/^\d{4}$/, "use a four-digit year")
    .optional(),
});
const lastPriceQuery = z.object({ productId: z.string().min(1) });

export const fromRow = (row: TransactionTable): Transaction => ({
  id: row.id,
  date: row.date,
  goalId: row.goalId,
  productId: row.productId,
  type: row.type,
  amountCents: row.amountCents,
  qty: fromScaled(row.qtyScaled),
  price: fromScaled(row.priceScaled),
  commissionCents: row.commissionCents,
  note: row.note,
});

/** A ledger row with the stored amount, which a coupon needs: its qty is 0. */
export type LedgerEntry = LedgerRow & { amountCents: number };

/** The whole ledger in date and entry order. The price is per unit: a BTP is quoted per 100. */
export async function loadLedger(db: Kysely<DB>): Promise<LedgerEntry[]> {
  const rows = await db
    .selectFrom("transaction")
    .innerJoin("product", "product.id", "transaction.productId")
    .select([
      "transaction.date",
      "transaction.goalId",
      "transaction.productId",
      "transaction.type",
      "transaction.qtyScaled",
      "transaction.priceScaled",
      "transaction.commissionCents",
      "transaction.amountCents",
      "product.regime",
    ])
    .orderBy("transaction.date")
    .orderBy(sql`"transaction".rowid`)
    .execute();
  return rows.map((row) => ({
    date: row.date,
    goalId: row.goalId,
    productId: row.productId,
    type: row.type,
    qty: fromScaled(row.qtyScaled),
    price: unitPrice(row.regime, fromScaled(row.priceScaled)),
    commission: row.commissionCents === null ? 0 : fromCents(row.commissionCents),
    amountCents: row.amountCents,
  }));
}

/** Transactions: list, create, edit, delete; holdings derived from them; the last price of a product. */
export function registerTransactionRoutes(router: Router, db: Kysely<DB>): void {
  // The stored row. qty = amount / unit price, negative for a sell; a coupon has no quantity.
  const toColumns = async (input: TransactionInput) => {
    const { type, amountCents, price } = input;
    if (type !== "coupon" && price <= 0) throw new HttpError(400, "price: must be above 0");
    await findOr404(db, "goal", input.goalId, "goal");
    const { regime } = await findOr404(db, "product", input.productId, "product");
    const units = type === "coupon" ? 0 : fromCents(amountCents) / unitPrice(regime, price);
    return {
      date: input.date,
      goalId: input.goalId,
      productId: input.productId,
      type,
      qtyScaled: toScaled(type === "sell" ? -units : units),
      priceScaled: toScaled(type === "coupon" ? 0 : price),
      commissionCents: input.commissionCents,
      amountCents,
      note: input.note,
    };
  };

  // The response carries what is stored, so it matches a later GET (a coupon is stored with price 0).
  const stored = (columns: Awaited<ReturnType<typeof toColumns>>) => ({
    qty: fromScaled(columns.qtyScaled),
    price: fromScaled(columns.priceScaled),
  });

  router.route("GET", "/api/transactions", listQuery, async ({ goalId, year }) => {
    let query = db.selectFrom("transaction").selectAll();
    if (goalId) query = query.where("goalId", "=", goalId);
    if (year)
      query = query.where("date", ">=", `${year}-01-01`).where("date", "<=", `${year}-12-31`);
    const rows = await query.orderBy("date", "desc").orderBy(sql`rowid`, "desc").execute();
    return rows.map(fromRow);
  });

  router.route("POST", "/api/transactions", transactionInputSchema, async (input) => {
    const id = randomUUID();
    const columns = await toColumns(input);
    await db
      .insertInto("transaction")
      .values({ id, ...columns })
      .execute();
    return { id, ...input, ...stored(columns) } satisfies Transaction;
  });

  router.route(
    "PUT",
    "/api/transactions",
    transactionInputSchema.extend({ id: z.string().min(1) }),
    async ({ id, ...input }) => {
      await findOr404(db, "transaction", id, "transaction");
      const columns = await toColumns(input);
      await db.updateTable("transaction").set(columns).where("id", "=", id).execute();
      return { id, ...input, ...stored(columns) } satisfies Transaction;
    },
  );

  router.route("DELETE", "/api/transactions", idQuery, async ({ id }) => {
    const { numDeletedRows } = await db
      .deleteFrom("transaction")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    if (numDeletedRows === 0n) throw new HttpError(404, "transaction not found");
    return { id };
  });

  // Holdings are derived from the ledger on every call; nothing about them is stored.
  router.route("GET", "/api/holdings", z.object({}), async () => {
    const ledger = await loadLedger(db);
    const { units, accountUnits, pmc } = holdingsAt(ledger, "9999-12-31");
    return {
      buckets: [...units].flatMap(([goalId, products]) =>
        [...products].map(([productId, count]) => ({ goalId, productId, units: count })),
      ),
      accounts: [...accountUnits].map(([productId, count]) => ({
        productId,
        units: count,
        pmc: pmc.get(productId) ?? null,
      })),
    };
  });

  // The latest PricePoint of a product, quoted as stored. Null when there is none.
  router.route("GET", "/api/last-price", lastPriceQuery, async ({ productId }) => {
    const row = await db
      .selectFrom("pricePoint")
      .select(["priceScaled", "priceDate"])
      .where("productId", "=", productId)
      .orderBy("month", "desc")
      .executeTakeFirst();
    return row ? { price: fromScaled(row.priceScaled), priceDate: row.priceDate } : null;
  });
}
