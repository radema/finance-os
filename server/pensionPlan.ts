import type { Kysely } from "kysely";
import type { PensionPlan } from "../engine/schemas.ts";
import { pensionPlanSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import type { LedgerEntry } from "./transactions.ts";

/** The stored pension plan, or undefined when none is saved or the saved document is not valid. */
export async function loadPensionPlan(db: Kysely<DB>): Promise<PensionPlan | undefined> {
  const row = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", "pensionPlan")
    .executeTakeFirst();
  return row ? pensionPlanSchema.safeParse(JSON.parse(row.value)).data : undefined;
}

/**
 * Voluntary contributions made in the year of `asOf`, in cents: this year's `pensionContribution`
 * transactions with flow `Voluntary`, dated up to `asOf`. A row with no flow counts as Work.
 */
export function voluntaryYtdCents(ledger: readonly LedgerEntry[], asOf: string): number {
  const year = asOf.slice(0, 4);
  return ledger
    .filter(
      (entry) =>
        entry.type === "pensionContribution" &&
        entry.flow === "Voluntary" &&
        entry.date.slice(0, 4) === year &&
        entry.date <= asOf,
    )
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}
