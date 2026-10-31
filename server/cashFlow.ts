import type { Kysely } from "kysely";
import { z } from "zod";
import type { CashFlowGoal, CashFlowView } from "../engine/cashFlow.ts";
import { projectCashFlow } from "../engine/cashFlow.ts";
import { monthEnd } from "../engine/months.ts";
import { pensionSchedule } from "../engine/pension.ts";
import { planInForce } from "../engine/plan.ts";
import { cashFlowSchema, pensionPlanSchema, settingsSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import { voluntaryYtdCents } from "./pensionPlan.ts";
import type { Router } from "./router.ts";
import { loadLedger } from "./transactions.ts";

/** The pension plan document, or undefined when none is saved. A saved document that is not valid throws. */
async function loadPensionPlan(db: Kysely<DB>) {
  const row = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", "pensionPlan")
    .executeTakeFirst();
  return row ? pensionPlanSchema.parse(JSON.parse(row.value)) : undefined;
}

/**
 * The CashFlow document and its 10-year table. The table starts from the valuation date of the Goals
 * screens: the end of the last month that has prices, else the clock's month.
 */
export function registerCashFlowRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  const view = async (): Promise<CashFlowView> => {
    const cashFlow = await loadDocument(db, "cashFlow", cashFlowSchema);
    const settings = await loadDocument(db, "settings", settingsSchema);
    const lastPrice = await db
      .selectFrom("pricePoint")
      .select((eb) => eb.fn.max("month").as("month"))
      .executeTakeFirst();
    const month = lastPrice?.month ?? today().slice(0, 7);
    const asOf = monthEnd(month);

    const plans = await db.selectFrom("contributionPlan").selectAll().execute();
    const goals: CashFlowGoal[] = (await db.selectFrom("goal").selectAll().execute()).map(
      (goal) => ({
        id: goal.id,
        targetYear: goal.targetYear,
        contributionGrowth: goal.contributionGrowth,
        monthly: planInForce(
          plans
            .filter((version) => version.goalId === goal.id)
            .map((version) => ({ fromMonth: version.fromMonth, monthly: version.monthlyCents })),
          month,
        ),
      }),
    );

    const plan = await loadPensionPlan(db);
    let pension: Parameters<typeof projectCashFlow>[0]["pension"];
    if (plan) {
      const voluntaryYtd = voluntaryYtdCents(await loadLedger(db), asOf);
      pension = {
        goalId: plan.goalId,
        schedule: pensionSchedule(plan, settings, asOf, voluntaryYtd),
      };
    }

    return { asOf, cashFlow, rows: projectCashFlow({ asOf, cashFlow, goals, pension }) };
  };

  router.route("GET", "/api/cash-flow", z.object({}), view);
  router.route("PUT", "/api/cash-flow", cashFlowSchema, async (input) => {
    await saveDocument(db, "cashFlow", input);
    return view();
  });
}
