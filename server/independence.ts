import type { Kysely } from "kysely";
import { z } from "zod";
import { type FiGoal, projectFinancialIndependence } from "../engine/financialIndependence.ts";
import type { GoalWorld, GoalWorldGoal } from "../engine/goalViews.ts";
import { detailOf } from "../engine/goalViews.ts";
import type { IndependenceView } from "../engine/independenceView.ts";
import type { MonteCarloGoal, MonteCarloProduct } from "../engine/monteCarlo.ts";
import { monthEnd } from "../engine/months.ts";
import { planInForce } from "../engine/plan.ts";
import { liquidateGoal } from "../engine/projection.ts";
import { cashFlowSchema, correlationsSchema, fireSettingsSchema } from "../engine/schemas.ts";
import { goalSlot } from "../engine/slots.ts";
import { fromCents } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import { loadWorld } from "./goalViews.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404, idQuery } from "./rows.ts";
import { toFlag } from "./schema.ts";

const NO_FIRST_YEAR_NOTE =
  "The pension plan has no first year of membership, so the exit tax and the projection are not shown.";
const MISSING_PRICE_NOTE = "A held product has no price: its value counts as 0.";

/** What the simulation needs of a product and the goals' ticks, beyond what the Goals views read. */
type Extras = {
  products: ReadonlyMap<string, MonteCarloProduct>;
  countsTowardFi: ReadonlySet<string>;
};

async function loadExtras(db: Kysely<DB>): Promise<Extras> {
  const rows = await db.selectFrom("product").selectAll().execute();
  const goals = await db.selectFrom("goal").select(["id", "countsTowardFi"]).execute();
  return {
    products: new Map(
      rows.map((row) => [
        row.id,
        {
          regime: row.regime,
          mu: row.expReturn,
          ter: row.ter,
          couponRate: row.couponRate,
          whiteListShare: row.whiteListShare,
          sigma: row.volatility,
          assetClass: row.assetClass,
        },
      ]),
    ),
    countsTowardFi: new Set(goals.filter((goal) => goal.countsTowardFi === 1).map((g) => g.id)),
  };
}

/**
 * One goal as the simulation reads it: its holdings at the valuation date, its plan in force, its
 * weights, and the pension schedule for the pension goal. The same mappings as the goal detail.
 */
export function monteCarloGoalOf(
  world: GoalWorld,
  goal: GoalWorldGoal,
  products: ReadonlyMap<string, MonteCarloProduct>,
): { goal: MonteCarloGoal; missingPrice: boolean } {
  const { settings, pension } = world;
  const { holdings } = detailOf(world, goal);
  const { zainetto } = settings;
  const isPension = pension?.goalId === goal.id;
  return {
    missingPrice: holdings.some((row) => row.value === null),
    goal: {
      asOf: monthEnd(world.month),
      goal: {
        id: goal.id,
        targetYear: goal.targetYear,
        target: goal.target,
        contributionGrowth: goal.contributionGrowth,
      },
      monthly: planInForce(
        world.plans.filter((version) => version.goalId === goal.id),
        world.month,
      ),
      positions: holdings.map((row) => ({
        productId: row.productId,
        value: row.value ?? 0,
        basis: row.units * row.pmc,
      })),
      products,
      weights: new Map(
        world.weights.filter((w) => w.goalId === goal.id).map((w) => [w.productId, w.weight]),
      ),
      settings: {
        ...settings,
        zainetto:
          zainetto.goalId === null
            ? undefined
            : {
                amount: fromCents(zainetto.amountCents),
                expiry: String(zainetto.expiry),
                goalId: zainetto.goalId,
              },
      },
      firstYear: isPension ? pension?.firstYear : undefined,
      pension:
        isPension && pension?.ral !== undefined
          ? {
              plan: pension,
              deductionCapCents: settings.pensionDeductionCapCents,
              voluntaryYtd: world.voluntaryYtdCents,
            }
          : undefined,
    },
  };
}

/** True when the goal's bucket holds or will buy a pension product, which needs the plan's first year. */
function usesPensionProduct(goal: MonteCarloGoal): boolean {
  const ids = [
    ...goal.positions.map((position) => position.productId),
    ...goal.weights.keys(),
    ...(goal.pension?.plan.flows.map((flow) => flow.productId) ?? []),
  ];
  return ids.some((id) => goal.products.get(id)?.regime === "pension");
}

/** The Independence read model: settings, expense split, goals with their ticks, and the FI projection. */
async function loadIndependence(db: Kysely<DB>, today: string): Promise<IndependenceView> {
  const world = await loadWorld(db, today);
  const extras = await loadExtras(db);
  const fire = await loadDocument(db, "fiSettings", fireSettingsSchema);
  const cashFlow = await loadDocument(db, "cashFlow", cashFlowSchema);
  const { matrix } = await loadDocument(db, "correlations", correlationsSchema);
  const pensionGoalId = world.pension?.goalId;
  const asOf = monthEnd(world.month);
  /** A bucket counts when its goal is ticked and, for the pension goal, the pension is included. */
  const counts = (id: string) =>
    extras.countsTowardFi.has(id) && (id !== pensionGoalId || fire.includePension);

  const built = world.goals.map((row) => ({
    row,
    ...monteCarloGoalOf(world, row, extras.products),
  }));
  const view: IndependenceView = {
    asOf,
    fire,
    expenses: {
      essentialCents: cashFlow.essential,
      optionalCents: cashFlow.optional,
      expenseGrowth: cashFlow.expenseGrowth,
    },
    inflation: world.settings.inflation,
    goals: built.map(({ row }) => ({
      id: row.id,
      name: row.name,
      slot: goalSlot(row, world.goals, pensionGoalId),
      target: row.target,
      countsTowardFi: extras.countsTowardFi.has(row.id),
      isPension: row.id === pensionGoalId,
      today: 0,
    })),
    result: null,
    note: null,
  };
  const counted = built.filter(({ row }) => counts(row.id));
  if (
    built.length === 0 ||
    (world.pension?.firstYear === undefined && counted.some(({ goal }) => usesPensionProduct(goal)))
  ) {
    view.note = built.length === 0 ? null : NO_FIRST_YEAR_NOTE;
    return view;
  }
  if (counted.some(({ missingPrice }) => missingPrice)) view.note = MISSING_PRICE_NOTE;

  // Net value today of each counted bucket: the engine's point 0, kept per goal for the bars.
  for (const { row, goal } of counted) {
    const entry = view.goals.find((candidate) => candidate.id === row.id);
    if (entry) entry.today = liquidateGoal(goal, goal.positions, asOf).net;
  }

  const goals: FiGoal[] = built.map(({ row, goal }) => ({
    ...goal,
    countsTowardFi: extras.countsTowardFi.has(row.id),
  }));
  view.result = projectFinancialIndependence(
    {
      asOf,
      goals,
      correlations: matrix,
      fire,
      essential: fromCents(cashFlow.essential),
      optional: fromCents(cashFlow.optional),
      expenseGrowth: cashFlow.expenseGrowth,
      inflation: world.settings.inflation,
      pensionGoalId,
    },
    world.settings.seed,
    world.settings.mcPaths,
  );
  return view;
}

const expensesSchema = z.object({
  essentialCents: z.number().int().min(0),
  optionalCents: z.number().int().min(0),
});

/** Independence: the FI settings, the expense split, and the goals' "counts toward FI" ticks. */
export function registerIndependenceRoutes(
  router: Router,
  db: Kysely<DB>,
  today: () => string,
): void {
  const view = () => loadIndependence(db, today());

  router.route("GET", "/api/independence", z.object({}), view);

  router.route("PUT", "/api/independence/settings", fireSettingsSchema, async (fire) => {
    if (fire.efFromGoal !== null) {
      const goal = await db
        .selectFrom("goal")
        .select("id")
        .where("id", "=", fire.efFromGoal)
        .executeTakeFirst();
      if (!goal) throw new HttpError(400, "the Level 1 goal does not exist");
    }
    await saveDocument(db, "fiSettings", fire);
    return view();
  });

  // Only essential and optional change: the rest of the Cash flow document stays as it is.
  router.route("PUT", "/api/independence/expenses", expensesSchema, async (input) => {
    const cashFlow = await loadDocument(db, "cashFlow", cashFlowSchema);
    await saveDocument(db, "cashFlow", {
      ...cashFlow,
      essential: input.essentialCents,
      optional: input.optionalCents,
    });
    return view();
  });

  router.route(
    "PUT",
    "/api/independence/counts",
    idQuery.extend({ countsTowardFi: z.boolean() }),
    async ({ id, countsTowardFi }) => {
      await findOr404(db, "goal", id, "goal");
      await db
        .updateTable("goal")
        .set({ countsTowardFi: toFlag(countsTowardFi) })
        .where("id", "=", id)
        .execute();
      return view();
    },
  );
}
