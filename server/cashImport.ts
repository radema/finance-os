import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { cashCsv, openingCsv } from "../engine/cashCsv.ts";
import { replayCash } from "../engine/cashLedger.ts";
import { loadCashMovements, validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { loadOpeningAsOf, saveOpeningPosition } from "./openingPosition.ts";
import { previewWrite } from "./previewWrite.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { loadLedger } from "./transactions.ts";

const input = z.object({ text: z.string(), cashText: z.string().default("") });
const describe = (error: unknown) => (error instanceof Error ? error.message : "Invalid CSV.");
export async function csvReferences(db: Kysely<DB>) {
  return {
    goals: await db.selectFrom("goal").select(["id", "name"]).where("archived", "=", 0).execute(),
    products: await db.selectFrom("product").select(["id", "name", "isin"]).execute(),
  };
}
export function registerCashImportRoutes(router: Router, db: Kysely<DB>) {
  for (const operation of ["preview", "commit"] as const) {
    router.route("POST", `/api/import/openings/${operation}`, input, async ({ text, cashText }) => {
      try {
        const { goals, products } = await csvReferences(db);
        const opening = openingCsv(text, cashText, goals, products);
        const rows =
          opening.positions.reduce((n, p) => n + p.parts.length, 0) + opening.cashBalances.length;
        const write = (trx: Kysely<DB>) => saveOpeningPosition(trx, opening, true);
        if (operation === "commit") await db.transaction().execute(write);
        else await previewWrite(db, write);
        return { rows, errors: [], ...opening };
      } catch (error) {
        if (operation === "commit") throw new HttpError(400, describe(error));
        return { rows: 0, errors: [describe(error)] };
      }
    });
    router.route("POST", `/api/import/cash/${operation}`, input, async ({ text }) => {
      try {
        const run = async (trx: Kysely<DB>, commit: boolean) => {
          const { goals } = await csvReferences(trx);
          const parsed = cashCsv(text, goals);
          const asOf = await loadOpeningAsOf(trx);
          if (parsed.some((row) => asOf && row.date <= asOf))
            throw new Error("Cash movements must be after the opening date.");
          const stored = await loadCashMovements(trx);
          const known = new Map(stored.filter((m) => m.sourceId).map((m) => [m.sourceId, m]));
          const fresh = parsed
            .filter((row) => {
              const prior = row.sourceId ? known.get(row.sourceId) : undefined;
              if (!prior) return true;
              for (const key of [
                "date",
                "goalId",
                "type",
                "amountCents",
                "toGoalId",
                "note",
              ] as const) {
                if (prior[key] !== row[key])
                  throw new Error(`Source ${row.sourceId} already exists with different content.`);
              }
              return false;
            })
            .map((row) => ({ ...row, id: randomUUID(), importBatchId: null }));
          replayCash(await loadLedger(trx), [...stored, ...fresh]);
          if (commit && fresh.length) {
            const batchId = randomUUID();
            await trx
              .insertInto("importBatch")
              .values({
                id: batchId,
                kind: "transactions",
                sourceName: "Cash CSV",
                fileName: "cash-movements.csv",
                createdAt: new Date().toISOString(),
                rowsRead: parsed.length,
                rowsImported: fresh.length,
                rowsSkipped: parsed.length - fresh.length,
                undoneAt: null,
                priorPrices: null,
                createdIds: null,
              })
              .execute();
            await trx
              .insertInto("cashMovement")
              .values(fresh.map((row) => ({ ...row, importBatchId: batchId })))
              .execute();
            await validateLedgerHistory(trx);
          }
          return { rows: fresh.length, skipped: parsed.length - fresh.length, errors: [] };
        };
        return operation === "commit"
          ? await db.transaction().execute((trx) => run(trx, true))
          : await previewWrite(db, (trx) => run(trx, true));
      } catch (error) {
        if (operation === "commit") throw new HttpError(400, describe(error));
        return { rows: 0, errors: [describe(error)] };
      }
    });
  }
}
