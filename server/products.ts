import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Product, ProductInput } from "../engine/schemas.ts";
import { productInputSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import type { ProductTable } from "./schema.ts";
import { toFlag } from "./schema.ts";

export const fromRow = (row: ProductTable): Product => ({
  id: row.id,
  name: row.name,
  isin: row.isin,
  assetClass: row.assetClass,
  regime: row.regime,
  whiteListShare: row.whiteListShare,
  expReturn: row.expReturn,
  volatility: row.volatility,
  ter: row.ter,
  maturity: row.maturity,
  couponRate: row.couponRate,
  zeroCommission: row.zeroCommission === 1,
  priceSource: row.priceSource,
  ticker: row.ticker,
});

// Broker units are entered on the Prices screen, so they are not part of a product edit.
export const toColumns = (input: ProductInput) => ({
  ...input,
  zeroCommission: toFlag(input.zeroCommission),
});

/** Products: list, create, edit, delete. A product that a transaction or a weight uses stays. */
export function registerProductRoutes(router: Router, db: Kysely<DB>): void {
  router.route("GET", "/api/products", z.object({}), async () => {
    const rows = await db.selectFrom("product").selectAll().orderBy("name").execute();
    return rows.map(fromRow);
  });

  router.route("POST", "/api/products", productInputSchema, async (input) => {
    const id = randomUUID();
    await db
      .insertInto("product")
      .values({ id, ...toColumns(input) })
      .execute();
    return { id, ...input } satisfies Product;
  });

  router.route(
    "PUT",
    "/api/products",
    productInputSchema.extend({ id: z.string().min(1) }),
    async ({ id, ...input }) => {
      await findOr404(db, "product", id, "product");
      await db.updateTable("product").set(toColumns(input)).where("id", "=", id).execute();
      return { id, ...input } satisfies Product;
    },
  );

  router.route("DELETE", "/api/products", idQuery, async ({ id }) => {
    const count = async (table: "transaction" | "allocationWeight") => {
      const row = await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("productId", "=", id)
        .executeTakeFirstOrThrow();
      return row.n;
    };
    const [transactions, weights] = [await count("transaction"), await count("allocationWeight")];
    if (transactions > 0 || weights > 0) {
      throw new HttpError(
        409,
        `This product is used by ${transactions} transaction(s) and ${weights} allocation weight(s). Remove them first.`,
      );
    }
    const { numDeletedRows } = await db
      .deleteFrom("product")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    if (numDeletedRows === 0n) throw new HttpError(404, "product not found");
    return { id };
  });
}
