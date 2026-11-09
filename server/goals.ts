import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import { holdingsAt } from "../engine/holdings.ts";
import type { Goal, GoalInput } from "../engine/schemas.ts";
import {
  goalInputSchema,
  monthSchema,
  planVersionSchema,
  settingsSchema,
} from "../engine/schemas.ts";
import { loadCashState } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import type { GoalTable } from "./schema.ts";
import { toFlag } from "./schema.ts";
import { loadLedger } from "./transactions.ts";

const versionKey = z.object({ goalId: z.string().min(1), fromMonth: monthSchema });

export const toColumns = (input: GoalInput) => ({
  ...input,
  countsTowardFi: toFlag(input.countsTowardFi),
});

const toGoal = (row: Selectable<GoalTable>, plan: Goal["plan"]): Goal => ({
  id: row.id,
  name: row.name,
  priority: row.priority,
  targetCents: row.targetCents,
  targetYear: row.targetYear,
  contributionGrowth: row.contributionGrowth,
  minProb: row.minProb,
  countsTowardFi: row.countsTowardFi === 1,
  archived: row.archived === 1,
  plan,
});

/** Goals with their plan history: list, create, edit, delete, and plan versions. */
export function registerGoalRoutes(router: Router, db: Kysely<DB>): void {
  const planOf = (goalId: string) =>
    db
      .selectFrom("contributionPlan")
      .select(["fromMonth", "monthlyCents"])
      .where("goalId", "=", goalId)
      .orderBy("fromMonth")
      .execute();

  router.route(
    "GET",
    "/api/goals",
    z.object({ includeArchived: z.enum(["true", "false"]).default("false") }),
    async ({ includeArchived }) => {
      const goals = await db.selectFrom("goal").selectAll().orderBy("name").execute();
      const plans = await db
        .selectFrom("contributionPlan")
        .selectAll()
        .orderBy("fromMonth")
        .execute();
      return goals
        .filter((goal) => includeArchived === "true" || goal.archived !== 1)
        .map((goal) =>
          toGoal(
            goal,
            plans
              .filter((version) => version.goalId === goal.id)
              .map(({ fromMonth, monthlyCents }) => ({ fromMonth, monthlyCents })),
          ),
        );
    },
  );

  router.route(
    "POST",
    "/api/goals/archive",
    z.object({ id: z.string().min(1), archived: z.boolean() }),
    ({ id, archived }) =>
      db.transaction().execute(async (trx) => {
        await findOr404(trx, "goal", id, "goal");
        if (archived) {
          const held = holdingsAt(await loadLedger(trx), "9999-12-31").units.get(id);
          const cash = await loadCashState(trx);
          if (
            [...(held?.values() ?? [])].some((units) => Math.abs(units) > 0.0000005) ||
            (cash.balances.get(id) ?? 0) !== 0
          ) {
            throw new HttpError(
              409,
              "Sell the holdings and withdraw or transfer all Bucket Cash before archiving.",
            );
          }
        }
        await trx
          .updateTable("goal")
          .set({ archived: toFlag(archived) })
          .where("id", "=", id)
          .execute();
        return { id, archived };
      }),
  );

  router.route("POST", "/api/goals", goalInputSchema, async (input) => {
    const id = randomUUID();
    await db
      .insertInto("goal")
      .values({ id, ...toColumns(input) })
      .execute();
    return { id, ...input, plan: [] } satisfies Goal;
  });

  router.route(
    "PUT",
    "/api/goals",
    goalInputSchema.extend({ id: z.string().min(1) }),
    async ({ id, ...input }) => {
      await findOr404(db, "goal", id, "goal");
      await db.updateTable("goal").set(toColumns(input)).where("id", "=", id).execute();
      const row = await findOr404(db, "goal", id, "goal");
      return { id, ...input, archived: row.archived === 1, plan: await planOf(id) } satisfies Goal;
    },
  );

  router.route("DELETE", "/api/goals", idQuery, async ({ id }) => {
    const cashHistory = await db
      .selectFrom("cashMovement")
      .select("id")
      .where((eb) => eb.or([eb("goalId", "=", id), eb("toGoalId", "=", id)]))
      .limit(1)
      .executeTakeFirst();
    if (cashHistory)
      throw new HttpError(409, "This bucket has cash history. Archive it after emptying it.");
    const { n } = await db
      .selectFrom("transaction")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("goalId", "=", id)
      .executeTakeFirstOrThrow();
    if (n > 0) {
      throw new HttpError(409, `This goal has ${n} transaction(s). Delete or move them first.`);
    }
    // One transaction: the goal and the zainetto link go together or not at all.
    await db.transaction().execute(async (trx) => {
      // The goal's weights and plan versions go with it (ON DELETE CASCADE).
      const { numDeletedRows } = await trx
        .deleteFrom("goal")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      if (numDeletedRows === 0n) throw new HttpError(404, "goal not found");
      const settings = await loadDocument(trx, "settings", settingsSchema);
      if (settings.zainetto.goalId === id) {
        await saveDocument(trx, "settings", {
          ...settings,
          zainetto: { ...settings.zainetto, goalId: null },
        });
      }
    });
    return { id };
  });

  // Plan history. Saving a version for a month that already has one replaces it.
  router.route(
    "PUT",
    "/api/goal-plan",
    planVersionSchema.extend({ goalId: z.string().min(1) }),
    async ({ goalId, fromMonth, monthlyCents }) => {
      await findOr404(db, "goal", goalId, "goal");
      await db
        .insertInto("contributionPlan")
        .values({ goalId, fromMonth, monthlyCents })
        .onConflict((conflict) =>
          conflict.columns(["goalId", "fromMonth"]).doUpdateSet({ monthlyCents }),
        )
        .execute();
      return planOf(goalId);
    },
  );

  router.route("DELETE", "/api/goal-plan", versionKey, async ({ goalId, fromMonth }) => {
    const { numDeletedRows } = await db
      .deleteFrom("contributionPlan")
      .where("goalId", "=", goalId)
      .where("fromMonth", "=", fromMonth)
      .executeTakeFirstOrThrow();
    if (numDeletedRows === 0n) throw new HttpError(404, "plan version not found");
    return planOf(goalId);
  });
}
