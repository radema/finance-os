import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Goal, GoalInput } from "../engine/schemas.ts";
import {
  goalInputSchema,
  monthSchema,
  planVersionSchema,
  settingsSchema,
} from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import type { GoalTable } from "./schema.ts";
import { toFlag } from "./schema.ts";

const versionKey = z.object({ goalId: z.string().min(1), fromMonth: monthSchema });

export const toColumns = (input: GoalInput) => ({
  ...input,
  countsTowardFi: toFlag(input.countsTowardFi),
});

const toGoal = (row: GoalTable, plan: Goal["plan"]): Goal => ({
  id: row.id,
  name: row.name,
  priority: row.priority,
  targetCents: row.targetCents,
  targetYear: row.targetYear,
  contributionGrowth: row.contributionGrowth,
  minProb: row.minProb,
  countsTowardFi: row.countsTowardFi === 1,
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

  router.route("GET", "/api/goals", z.object({}), async () => {
    const goals = await db.selectFrom("goal").selectAll().orderBy("name").execute();
    const plans = await db
      .selectFrom("contributionPlan")
      .selectAll()
      .orderBy("fromMonth")
      .execute();
    return goals.map((goal) =>
      toGoal(
        goal,
        plans
          .filter((version) => version.goalId === goal.id)
          .map(({ fromMonth, monthlyCents }) => ({ fromMonth, monthlyCents })),
      ),
    );
  });

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
      return { id, ...input, plan: await planOf(id) } satisfies Goal;
    },
  );

  router.route("DELETE", "/api/goals", idQuery, async ({ id }) => {
    const { n } = await db
      .selectFrom("transaction")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("goalId", "=", id)
      .executeTakeFirstOrThrow();
    if (n > 0) {
      throw new HttpError(409, `This goal has ${n} transaction(s). Delete or move them first.`);
    }
    // The goal's weights and plan versions go with it (ON DELETE CASCADE).
    const { numDeletedRows } = await db
      .deleteFrom("goal")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    if (numDeletedRows === 0n) throw new HttpError(404, "goal not found");
    const settings = await loadDocument(db, "settings", settingsSchema);
    if (settings.zainetto.goalId === id) {
      await saveDocument(db, "settings", {
        ...settings,
        zainetto: { ...settings.zainetto, goalId: null },
      });
    }
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
