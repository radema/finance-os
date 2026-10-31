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
 * Voluntary contributions made in the year of `asOf`, in cents: the `pensionContribution`
 * transactions on products that have a Voluntary flow, dated up to `asOf`.
 */
export function voluntaryYtdCents(
  ledger: readonly LedgerEntry[],
  plan: PensionPlan,
  asOf: string,
): number {
  const voluntary = new Set(
    plan.flows.filter((flow) => flow.flow === "Voluntary").map((flow) => flow.productId),
  );
  const year = asOf.slice(0, 4);
  return ledger
    .filter(
      (entry) =>
        entry.type === "pensionContribution" &&
        voluntary.has(entry.productId) &&
        entry.date.slice(0, 4) === year &&
        entry.date <= asOf,
    )
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}
