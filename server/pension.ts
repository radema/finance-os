import type { Kysely } from "kysely";
import { z } from "zod";
import { type PensionYear, pensionSchedule } from "../engine/pension.ts";
import type { PensionThisYear, PensionView, PensionYearView } from "../engine/pensionView.ts";
import { PENSION_FLOWS, pensionPlanSchema } from "../engine/schemas.ts";
import { pensionExitRate } from "../engine/tax.ts";
import { fromCents } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { saveDocument } from "./documents.ts";
import { detailOf, loadWorld } from "./goalViews.ts";
import { loadPensionPlan, voluntaryYtdCents } from "./pensionPlan.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

/** The screen shows this many years of the schedule, Y0 first. */
const SCHEDULE_YEARS = 10;

/** Percentages typed in the form become fractions rounded to 12 digits. */
const FLOW_SUM_TOLERANCE = 1e-9;

const inEuros = (row: PensionYear): PensionYearView => ({
  year: row.year,
  ral: fromCents(row.ral),
  tfr: fromCents(row.tfr),
  worker: fromCents(row.worker),
  employer: fromCents(row.employer),
  voluntary: fromCents(row.voluntary),
  deductible: fromCents(row.deductible),
  refund: fromCents(row.refund),
  refundYear: row.refundYear,
});

/** The pension plan document and the Pension screen's read model. */
export function registerPensionRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/pension-plan", z.object({}), async () => {
    return (await loadPensionPlan(db)) ?? null;
  });

  router.route("PUT", "/api/pension-plan", pensionPlanSchema, async (plan) => {
    const goal = await db
      .selectFrom("goal")
      .select("id")
      .where("id", "=", plan.goalId)
      .executeTakeFirst();
    if (!goal) throw new HttpError(400, "the pension goal does not exist");
    const regimes = new Map(
      (await db.selectFrom("product").select(["id", "regime"]).execute()).map((row) => [
        row.id,
        row.regime,
      ]),
    );
    for (const { productId } of plan.flows) {
      const regime = regimes.get(productId);
      if (regime === undefined) throw new HttpError(400, `the product ${productId} does not exist`);
      if (regime !== "pension")
        throw new HttpError(400, `the product ${productId} is not a pension fund`);
    }
    for (const kind of PENSION_FLOWS) {
      const shares = plan.flows.filter((flow) => flow.flow === kind);
      const sum = shares.reduce((total, flow) => total + flow.pct, 0);
      if (shares.length > 0 && Math.abs(sum - 1) > FLOW_SUM_TOLERANCE)
        throw new HttpError(400, `the ${kind} flow shares must add up to 100%`);
    }
    await saveDocument(db, "pensionPlan", plan);
    return plan;
  });

  router.route("GET", "/api/pension-view", z.object({}), async (): Promise<PensionView> => {
    const world = await loadWorld(db, today());
    const { pension: plan, settings, asOf } = world;
    const base = {
      asOf,
      plan: plan ?? null,
      goals: world.goals.map(({ id, name, priority }) => ({ id, name, priority })),
      pensionProducts: [...world.products.values()]
        .filter((product) => product.regime === "pension")
        .map((product) => ({ id: product.id, name: product.name })),
    };
    if (!plan || plan.ral === undefined) return { ...base, thisYear: null, schedule: [] };

    const voluntaryYtd = voluntaryYtdCents(world.ledger, plan, asOf);
    const schedule = pensionSchedule(plan, settings, asOf, voluntaryYtd, SCHEDULE_YEARS);
    const [first] = schedule;
    if (!first) return { ...base, thisYear: null, schedule: [] };

    const goal = world.goals.find((candidate) => candidate.id === plan.goalId);
    const used = first.worker + first.employer + voluntaryYtd;
    const thisYear: PensionThisYear = {
      year: first.year,
      cap: fromCents(settings.pensionDeductionCapCents),
      extra: fromCents(plan.extra),
      used: fromCents(used),
      available: fromCents(settings.pensionDeductionCapCents + plan.extra - used),
      voluntaryYtd: fromCents(voluntaryYtd),
      refund: fromCents(first.refund),
      refundYear: first.refundYear,
      exitRate: goal ? pensionExitRate(goal.targetYear, plan.firstYear) : null,
      exitTax: goal ? (detailOf(world, goal).projection?.tax ?? null) : null,
      exitTaxYear: goal?.targetYear ?? null,
    };
    return { ...base, thisYear, schedule: schedule.map(inEuros) };
  });
}
