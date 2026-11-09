import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { unitPrice } from "../engine/holdings.ts";
import type { OpeningPositionInput, Transaction } from "../engine/schemas.ts";
import { openingDateSchema, openingPositionInputSchema } from "../engine/schemas.ts";
import { fromScaled, toCents, toScaled } from "../engine/units.ts";
import { validateLedgerHistory } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";
import { fromRow } from "./transactions.ts";

/** The asOf date of the saved opening position, or null when none was saved. Read by the import. */
export async function loadOpeningAsOf(db: Kysely<DB>): Promise<string | null> {
  const row = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", "openingDate")
    .executeTakeFirst();
  return row ? openingDateSchema.parse(JSON.parse(row.value)).asOf : null;
}

/** Current portfolio is the sole editor of the account baseline and its opening cash. */
export function registerOpeningPositionRoutes(router: Router, db: Kysely<DB>): void {
  router.route("GET", "/api/opening-position", z.object({}), async () => {
    const rows = await db
      .selectFrom("transaction")
      .selectAll()
      .where("type", "=", "opening")
      .execute();
    const products = new Map<string, OpeningPositionInput["positions"][number]>();
    for (const row of rows) {
      const units = fromScaled(row.qtyScaled);
      const prior = products.get(row.productId);
      if (prior) {
        prior.pmc =
          (prior.pmc * prior.totalUnits + fromScaled(row.priceScaled) * units) /
          (prior.totalUnits + units);
        prior.totalUnits += units;
        const part = prior.parts.find((part) => part.goalId === row.goalId);
        if (part) part.units += units;
        else prior.parts.push({ goalId: row.goalId, units });
      } else
        products.set(row.productId, {
          productId: row.productId,
          totalUnits: units,
          pmc: fromScaled(row.priceScaled),
          parts: [{ goalId: row.goalId, units }],
        });
    }
    const cashBalances = await db
      .selectFrom("cashMovement")
      .select(["goalId", "amountCents"])
      .where("type", "=", "opening")
      .execute();
    return { asOf: await loadOpeningAsOf(db), positions: [...products.values()], cashBalances };
  });
  router.route("POST", "/api/opening-position", openingPositionInputSchema, (input) =>
    db.transaction().execute((trx) => saveOpeningPosition(trx, input, false)),
  );
  router.route("PUT", "/api/opening-position", openingPositionInputSchema, (input) =>
    db.transaction().execute((trx) => saveOpeningPosition(trx, input, true)),
  );
}

export async function saveOpeningPosition(
  trx: Kysely<DB>,
  { asOf, positions, cashBalances }: OpeningPositionInput,
  replace = false,
) {
  if (!replace && (await loadOpeningAsOf(trx)) !== null)
    throw new HttpError(
      409,
      "An opening position is already saved. Replace it in Current portfolio.",
    );
  const previousDate = await loadOpeningAsOf(trx);
  const previousRows = await trx
    .selectFrom("transaction")
    .selectAll()
    .where("type", "=", "opening")
    .execute();
  const previousCash = await trx
    .selectFrom("cashMovement")
    .selectAll()
    .where("type", "=", "opening")
    .execute();
  const legacyIds = new Set(
    (await trx.selectFrom("legacyTransaction").select("id").execute()).map((row) => row.id),
  );
  const ordinary = await trx
    .selectFrom("transaction")
    .selectAll()
    .where("type", "not in", ["opening", "pensionContribution"])
    .execute();
  const cashHistory = await trx
    .selectFrom("cashMovement")
    .selectAll()
    .where("type", "!=", "opening")
    .execute();
  if (
    ordinary.some((row) => !legacyIds.has(row.id) && row.date <= asOf) ||
    cashHistory.some((row) => row.date <= asOf)
  ) {
    throw new HttpError(
      409,
      "The opening date must precede the saved transactions and cash movements.",
    );
  }
  if (replace) {
    await trx.deleteFrom("transaction").where("type", "=", "opening").execute();
    await trx.deleteFrom("cashMovement").where("type", "=", "opening").execute();
  }
  const saved: Transaction[] = [];
  const checkGoal = async (goalId: string) => {
    const goal = await findOr404(trx, "goal", goalId, "goal");
    if (goal.archived) {
      const key = (productId: string, units: number, pmc: number) =>
        `${productId}:${toScaled(units)}:${toScaled(pmc)}`;
      const before = previousRows
        .filter((row) => row.goalId === goalId)
        .map((row) => key(row.productId, fromScaled(row.qtyScaled), fromScaled(row.priceScaled)))
        .sort();
      const after = positions
        .flatMap((p) =>
          p.parts
            .filter((part) => part.goalId === goalId)
            .map((part) => key(p.productId, part.units, p.pmc)),
        )
        .sort();
      const beforeCash = previousCash
        .filter((row) => row.goalId === goalId)
        .reduce((sum, row) => sum + row.amountCents, 0);
      const afterCash = cashBalances
        .filter((row) => row.goalId === goalId)
        .reduce((sum, row) => sum + row.amountCents, 0);
      if (
        !replace ||
        asOf !== previousDate ||
        JSON.stringify(before) !== JSON.stringify(after) ||
        beforeCash !== afterCash
      )
        throw new HttpError(
          409,
          "Restore the archived bucket before changing its historical opening.",
        );
    }
  };
  for (const goalId of new Set([...previousRows, ...previousCash].map((row) => row.goalId)))
    await checkGoal(goalId);
  for (const { productId, pmc, parts } of positions) {
    const { regime } = await findOr404(trx, "product", productId, "product");
    for (const { goalId, units } of parts) {
      await checkGoal(goalId);
      const row = {
        id: randomUUID(),
        date: asOf,
        goalId,
        productId,
        type: "opening" as const,
        qtyScaled: toScaled(units),
        priceScaled: toScaled(pmc),
        commissionCents: null,
        amountCents: toCents(units * unitPrice(regime, pmc)),
        note: "",
        importBatchId: null,
        flow: null,
      };
      await trx.insertInto("transaction").values(row).execute();
      saved.push(fromRow(row));
    }
  }
  for (const { goalId, amountCents } of cashBalances) {
    await checkGoal(goalId);
    await trx
      .insertInto("cashMovement")
      .values({
        id: randomUUID(),
        date: asOf,
        goalId,
        amountCents,
        type: "opening",
        toGoalId: null,
        note: "",
        sourceId: null,
        importBatchId: null,
      })
      .execute();
  }
  await saveDocument(trx, "openingDate", { asOf });
  await validateLedgerHistory(trx);
  return saved;
}
