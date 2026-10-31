import type { Kysely } from "kysely";
import { z } from "zod";
import type { DB } from "./db.ts";
import { loadOpeningAsOf } from "./openingPosition.ts";
import type { Router } from "./router.ts";
import { isEmpty } from "./sample.ts";

const exists = async (db: Kysely<DB>, table: "product" | "goal"): Promise<boolean> =>
  (await db.selectFrom(table).select("id").limit(1).executeTakeFirst()) !== undefined;

/** True when the Current portfolio form saved an opening position, or a ledger row opens one. */
async function hasOpeningPosition(db: Kysely<DB>): Promise<boolean> {
  if ((await loadOpeningAsOf(db)) !== null) return true;
  const row = await db
    .selectFrom("transaction")
    .select("id")
    .where("type", "=", "opening")
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The first-run checklist state of the Overview: the three steps, and whether the sample data can
 * load. `sampleAvailable` uses the sample loader's own emptiness check, so the button never meets
 * a 409.
 */
export function registerSetupProgressRoutes(router: Router, db: Kysely<DB>): void {
  router.route("GET", "/api/setup-progress", z.object({}), async () => ({
    products: await exists(db, "product"),
    goals: await exists(db, "goal"),
    openingPosition: await hasOpeningPosition(db),
    sampleAvailable: await isEmpty(db),
  }));
}
