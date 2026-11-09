import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import { CashLedgerError, replayCash } from "../engine/cashLedger.ts";
import { cashMovementInputSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import { loadLedger } from "./transactions.ts";

export function loadCashMovements(db: Kysely<DB>) {
  return db.selectFrom("cashMovement").selectAll().orderBy("date").orderBy(sql`rowid`).execute();
}
export async function loadCashState(db: Kysely<DB>, asOf = "9999-12-31") {
  const [trades, movements] = await Promise.all([loadLedger(db), loadCashMovements(db)]);
  return replayCash(trades, movements, asOf);
}
export async function validateCashHistory(db: Kysely<DB>) {
  try {
    return await loadCashState(db);
  } catch (error) {
    if (error instanceof CashLedgerError) throw new HttpError(409, error.message);
    throw error;
  }
}
export async function validateLedgerHistory(db: Kysely<DB>) {
  const priority = (type: string) => (type === "opening" ? 0 : type === "sell" ? 2 : 1);
  const ledger = (await loadLedger(db)).sort(
    (a, b) => a.date.localeCompare(b.date) || priority(a.type) - priority(b.type),
  );
  const quantities = new Map<string, number>();
  for (const trade of ledger) {
    const key = `${trade.goalId}:${trade.productId}`;
    const qty = (quantities.get(key) ?? 0) + trade.qty;
    if (!trade.legacy && qty < -0.000001)
      throw new HttpError(409, `Insufficient holdings in bucket ${trade.goalId} on ${trade.date}.`);
    quantities.set(key, qty);
  }
  return validateCashHistory(db);
}
export async function cashBalances(db: Kysely<DB>) {
  const state = await loadCashState(db);
  const goals = await db.selectFrom("goal").select("id").execute();
  return goals.map(({ id }) => ({ goalId: id, amountCents: state.balances.get(id) ?? 0 }));
}
export function registerCashLedgerRoutes(router: Router, db: Kysely<DB>) {
  router.route("GET", "/api/bucket-cash", z.object({}), () => cashBalances(db));
  router.route(
    "GET",
    "/api/cash-movements",
    z.object({ goalId: z.string().optional() }),
    async ({ goalId }) => {
      const rows = await loadCashMovements(db);
      return goalId ? rows.filter((row) => row.goalId === goalId || row.toGoalId === goalId) : rows;
    },
  );
  router.route("POST", "/api/cash-movements", cashMovementInputSchema, (input) =>
    db.transaction().execute(async (trx) => {
      const asOf = await loadOpeningAsOf(trx);
      if (asOf && input.date <= asOf)
        throw new HttpError(
          409,
          "Cash movements must be after the opening date. Correct opening cash in Current portfolio.",
        );
      for (const goalId of [input.goalId, ...(input.toGoalId ? [input.toGoalId] : [])]) {
        const goal = await findOr404(trx, "goal", goalId, "goal");
        if (goal.archived)
          throw new HttpError(409, "Restore the archived bucket before moving cash.");
      }
      const row = { id: randomUUID(), ...input, sourceId: null, importBatchId: null };
      await trx.insertInto("cashMovement").values(row).execute();
      await validateLedgerHistory(trx);
      return row;
    }),
  );
  router.route("DELETE", "/api/cash-movements", idQuery, ({ id }) =>
    db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("cashMovement")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!row) throw new HttpError(404, "cash movement not found");
      if (row.type === "opening")
        throw new HttpError(409, "Edit opening cash in Current portfolio.");
      await trx.deleteFrom("cashMovement").where("id", "=", id).execute();
      await validateLedgerHistory(trx);
      return { id };
    }),
  );
}
