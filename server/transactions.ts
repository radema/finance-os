import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import { CashLedgerError } from "../engine/cashLedger.ts";
import type { LedgerRow } from "../engine/holdings.ts";
import { holdingsAt, unitPrice } from "../engine/holdings.ts";
import { flowsTaken } from "../engine/pension.ts";
import type { PensionFlow, Transaction, TransactionInput } from "../engine/schemas.ts";
import { transactionInputSchema } from "../engine/schemas.ts";
import { fromCents, fromScaled, toScaled } from "../engine/units.ts";
import { cashBalances, loadCashState, validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import { loadPensionPlan } from "./pensionPlan.ts";
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
  flow: row.flow ?? undefined,
  note: row.note,
});

/** A ledger row with the stored amount, which a coupon needs: its qty is 0. */
export type LedgerEntry = LedgerRow & {
  id: string;
  legacy: boolean;
  regime: string;
  commissionCents: number | null;
  amountCents: number;
  /** A `pensionContribution`'s flow. Null counts as Work. */
  flow: PensionFlow["flow"] | null;
};

/** The whole ledger in date and entry order. The price is per unit: a BTP is quoted per 100. */
export async function loadLedger(db: Kysely<DB>): Promise<LedgerEntry[]> {
  const rows = await db
    .selectFrom("transaction")
    .innerJoin("product", "product.id", "transaction.productId")
    .select([
      "transaction.id",
      "transaction.date",
      "transaction.goalId",
      "transaction.productId",
      "transaction.type",
      "transaction.qtyScaled",
      "transaction.priceScaled",
      "transaction.commissionCents",
      "transaction.amountCents",
      "transaction.flow",
      "product.regime",
    ])
    .orderBy("transaction.date")
    .orderBy(sql`"transaction".rowid`)
    .execute();
  const legacyIds = new Set(
    (await db.selectFrom("legacyTransaction").select("id").execute()).map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    legacy: legacyIds.has(row.id),
    regime: row.regime,
    commissionCents: row.commissionCents,
    date: row.date,
    goalId: row.goalId,
    productId: row.productId,
    type: row.type,
    qty: fromScaled(row.qtyScaled),
    price: unitPrice(row.regime, fromScaled(row.priceScaled)),
    commission: row.commissionCents === null ? 0 : fromCents(row.commissionCents),
    amountCents: row.amountCents,
    flow: row.flow,
  }));
}

/**
 * Transactions: list, create, edit, delete; holdings derived from them; the last price of a
 * product; the app clock, which the form uses as the default date.
 *
 * @param today The app clock, read on each request.
 */
export function registerTransactionRoutes(
  router: Router,
  db: Kysely<DB>,
  today: () => string,
): void {
  // The flow of a pension contribution: the one given, else the flow its product takes in the
  // saved plan. A product with both flows needs the user's choice. No plan flow leaves it empty,
  // which counts as Work.
  const flowOf = async (input: TransactionInput): Promise<PensionFlow["flow"] | null> => {
    if (input.type !== "pensionContribution") {
      if (input.flow) throw new HttpError(400, "flow: only a pension contribution has a flow");
      return null;
    }
    if (input.flow) return input.flow;
    const plan = await loadPensionPlan(db);
    const taken = flowsTaken(plan, input.productId);
    if (taken.length > 1)
      throw new HttpError(400, "flow: choose Work or Voluntary, this fund takes both flows");
    return taken[0] ?? null;
  };

  // The stored row. qty = amount / unit price, negative for a sell; a coupon has no quantity.
  const toColumns = async (input: TransactionInput) => {
    const { type, amountCents, price } = input;
    if (type !== "coupon" && price <= 0) throw new HttpError(400, "price: must be above 0");
    const goal = await findOr404(db, "goal", input.goalId, "goal");
    if (goal.archived) throw new HttpError(409, "Restore the archived bucket before trading.");
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
      flow: await flowOf(input),
      note: input.note,
    };
  };

  // The response carries what is stored, so it matches a later GET (a coupon is stored with price 0).
  const stored = (columns: Awaited<ReturnType<typeof toColumns>>) => ({
    qty: fromScaled(columns.qtyScaled),
    price: fromScaled(columns.priceScaled),
    flow: columns.flow ?? undefined,
  });
  const settle = async (
    trx: Kysely<DB>,
    input: TransactionInput,
    id: string,
    confirmFunding: boolean,
  ) => {
    try {
      await loadCashState(trx);
    } catch (error) {
      if (!(error instanceof CashLedgerError)) throw error;
      if (
        !confirmFunding ||
        input.type !== "buy" ||
        error.goalId !== input.goalId ||
        error.date !== input.date
      )
        throw new HttpError(409, error.message);
      await trx
        .insertInto("cashMovement")
        .values({
          id: randomUUID(),
          date: input.date,
          goalId: input.goalId,
          type: "contribution",
          amountCents: error.shortfallCents,
          toGoalId: null,
          note: "Confirmed trade funding",
          sourceId: `funding:${id}:${randomUUID()}`,
          importBatchId: null,
        })
        .execute();
    }
    await validateLedgerHistory(trx);
  };
  const assertAfterOpening = async (trx: Kysely<DB>, input: TransactionInput) => {
    const asOf = await loadOpeningAsOf(trx);
    if (asOf && input.date <= asOf && input.type !== "pensionContribution")
      throw new HttpError(
        409,
        "Ordinary transactions must be after the opening date. Correct the baseline in Current portfolio.",
      );
  };

  router.route("GET", "/api/transactions", listQuery, async ({ goalId, year }) => {
    let query = db.selectFrom("transaction").selectAll();
    if (goalId) query = query.where("goalId", "=", goalId);
    if (year)
      query = query.where("date", ">=", `${year}-01-01`).where("date", "<=", `${year}-12-31`);
    const rows = await query.orderBy("date", "desc").orderBy(sql`rowid`, "desc").execute();
    return rows.map(fromRow);
  });

  router.route(
    "POST",
    "/api/transactions",
    transactionInputSchema.extend({ confirmFunding: z.boolean().default(false) }),
    async ({ confirmFunding, ...input }) => {
      if (input.type === "opening")
        throw new HttpError(400, "Manage opening positions in Current portfolio.");
      const id = randomUUID();
      const columns = await toColumns(input);
      return db.transaction().execute(async (trx) => {
        await assertAfterOpening(trx, input);
        await trx
          .insertInto("transaction")
          .values({ id, ...columns })
          .execute();
        await settle(trx, input, id, confirmFunding);
        return { id, ...input, ...stored(columns) } satisfies Transaction;
      });
    },
  );
  router.route(
    "PUT",
    "/api/transactions",
    transactionInputSchema.extend({
      id: z.string().min(1),
      confirmFunding: z.boolean().default(false),
    }),
    async ({ id, confirmFunding, ...input }) => {
      const prior = await findOr404(db, "transaction", id, "transaction");
      if (prior.type === "opening" || input.type === "opening")
        throw new HttpError(409, "Manage opening positions in Current portfolio.");
      const columns = await toColumns(input);
      return db.transaction().execute(async (trx) => {
        const changed = (
          [
            "date",
            "goalId",
            "productId",
            "type",
            "qtyScaled",
            "priceScaled",
            "commissionCents",
            "amountCents",
            "flow",
          ] as const
        ).some((key) => prior[key] !== columns[key]);
        if (changed) {
          await assertAfterOpening(trx, input);
          await trx.deleteFrom("legacyTransaction").where("id", "=", id).execute();
        }
        await trx.updateTable("transaction").set(columns).where("id", "=", id).execute();
        await settle(trx, input, id, confirmFunding);
        return { id, ...input, ...stored(columns) } satisfies Transaction;
      });
    },
  );
  router.route("DELETE", "/api/transactions", idQuery, ({ id }) =>
    db.transaction().execute(async (trx) => {
      const row = await findOr404(trx, "transaction", id, "transaction");
      if (row.type === "opening")
        throw new HttpError(409, "Manage opening positions in Current portfolio.");
      await trx.deleteFrom("transaction").where("id", "=", id).execute();
      await validateLedgerHistory(trx);
      return { id };
    }),
  );

  // Holdings are derived from the ledger on every call; nothing about them is stored.
  router.route("GET", "/api/holdings", z.object({}), async () => {
    const ledger = await loadLedger(db);
    const { units, accountUnits, pmc } = holdingsAt(ledger, "9999-12-31");
    return {
      cashBalances: await cashBalances(db),
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

  router.route("GET", "/api/today", z.object({}), () => ({ today: today() }));
}
