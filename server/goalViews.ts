import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import type { GoalDetail, GoalListView, GoalWorld } from "../engine/goalViews.ts";
import { detailOf, summaryOf } from "../engine/goalViews.ts";
import { unitPrice } from "../engine/holdings.ts";
import { monthEnd } from "../engine/months.ts";
import { settingsSchema } from "../engine/schemas.ts";
import { fromCents, fromScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import { loadPensionPlan, voluntaryYtdCents } from "./pensionPlan.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { idQuery } from "./rows.ts";
import { isEmpty } from "./sample.ts";
import { loadLedger } from "./transactions.ts";

/** Everything the Goals screens read, loaded once per request. */
export async function loadWorld(db: Kysely<DB>, today: string): Promise<GoalWorld> {
  const products = await db.selectFrom("product").selectAll().execute();
  const priceRows = await db
    .selectFrom("pricePoint")
    .select(["productId", "month", "priceScaled"])
    .orderBy("month")
    .execute();
  const goals = await db.selectFrom("goal").selectAll().orderBy(sql`rowid`).execute();
  const plans = await db.selectFrom("contributionPlan").selectAll().execute();
  const weights = await db.selectFrom("allocationWeight").selectAll().execute();
  const ledger = await loadLedger(db);
  const settings = await loadDocument(db, "settings", settingsSchema);
  const pension = await loadPensionPlan(db);

  const regimeOf = new Map(products.map((product) => [product.id, product.regime]));
  const pricesOf = new Map<string, { month: string; price: number }[]>();
  for (const { productId, month, priceScaled } of priceRows) {
    const list = pricesOf.get(productId) ?? [];
    list.push({
      month,
      price: unitPrice(regimeOf.get(productId) ?? "etf", fromScaled(priceScaled)),
    });
    pricesOf.set(productId, list);
  }

  // The valuation date drives every screen: the last month that has prices, else the clock's month.
  const month = priceRows.at(-1)?.month ?? today.slice(0, 7);

  return {
    products: new Map(products.map((product) => [product.id, product])),
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      priority: goal.priority,
      target: fromCents(goal.targetCents),
      targetYear: goal.targetYear,
      contributionGrowth: goal.contributionGrowth,
    })),
    plans: plans.map((version) => ({
      goalId: version.goalId,
      fromMonth: version.fromMonth,
      monthly: fromCents(version.monthlyCents),
    })),
    weights,
    ledger: ledger.map((entry) => ({ ...entry, amount: fromCents(entry.amountCents) })),
    settings,
    pension,
    voluntaryYtdCents: voluntaryYtdCents(ledger, monthEnd(month)),
    month,
    prices: pricesOf,
  };
}

/** The Goals list and the Goal detail: read models computed from the ledger, the prices and the engine. */
export function registerGoalViewRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/goal-list", z.object({}), async (): Promise<GoalListView> => {
    const world = await loadWorld(db, today());
    return {
      asOf: monthEnd(world.month),
      sampleAvailable: await isEmpty(db),
      goals: world.goals.map((goal) => summaryOf(world, goal)),
    };
  });

  router.route("GET", "/api/goal-detail", idQuery, async ({ id }): Promise<GoalDetail> => {
    const world = await loadWorld(db, today());
    const goal = world.goals.find((candidate) => candidate.id === id);
    if (!goal) throw new HttpError(404, "goal not found");
    return detailOf(world, goal);
  });
}
