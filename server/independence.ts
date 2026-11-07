import type { Kysely } from "kysely";
import { z } from "zod";
import { type FiGoal, projectFinancialIndependence } from "../engine/financialIndependence.ts";
import { monteCarloGoalOf } from "../engine/goalViews.ts";
import type { IndependenceView } from "../engine/independenceView.ts";
import type { MonteCarloGoal } from "../engine/monteCarlo.ts";
import { monthEnd } from "../engine/months.ts";
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

/** The ids of the goals the user ticked, which the Goals views do not read. */
async function loadCountsTowardFi(db: Kysely<DB>): Promise<ReadonlySet<string>> {
  const goals = await db.selectFrom("goal").select(["id", "countsTowardFi"]).execute();
  return new Set(goals.filter((goal) => goal.countsTowardFi === 1).map((goal) => goal.id));
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
export async function loadIndependence(db: Kysely<DB>, today: string): Promise<IndependenceView> {
  const world = await loadWorld(db, today);
  const ticked = await loadCountsTowardFi(db);
  const fire = await loadDocument(db, "fiSettings", fireSettingsSchema);
  const cashFlow = await loadDocument(db, "cashFlow", cashFlowSchema);
  const { matrix } = await loadDocument(db, "correlations", correlationsSchema);
  const pensionGoalId = world.pension?.goalId;
  const asOf = monthEnd(world.month);
  /** A bucket counts when its goal is ticked and, for the pension goal, the pension is included. */
  const counts = (id: string) => ticked.has(id) && (id !== pensionGoalId || fire.includePension);

  const built = world.goals.map((row) => ({ row, ...monteCarloGoalOf(world, row) }));
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
      slot: goalSlot(row, world.goals),
      target: row.target,
      countsTowardFi: ticked.has(row.id),
      isPension: row.id === pensionGoalId,
      today: 0,
    })),
    result: null,
    note: null,
  };
  const counted = built.filter(({ row }) => counts(row.id));
  if (
    built.length === 0 ||
    (world.pension?.firstYear === undefined &&
      counted.some(({ input }) => usesPensionProduct(input)))
  ) {
    view.note = built.length === 0 ? null : NO_FIRST_YEAR_NOTE;
    return view;
  }
  if (counted.some(({ priced }) => !priced)) view.note = MISSING_PRICE_NOTE;

  // Net value today of each counted bucket: the engine's point 0, kept per goal for the bars.
  for (const { row, input } of counted) {
    const entry = view.goals.find((candidate) => candidate.id === row.id);
    if (entry) entry.today = liquidateGoal(input, input.positions, asOf).net;
  }

  const goals: FiGoal[] = built.map(({ row, input }) => ({
    ...input,
    countsTowardFi: ticked.has(row.id),
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

  // The body holds the fields to change; the rest of the stored document stays as it is. The merged
  // document is checked by the schema, so a bad value is a 400 and nothing is saved.
  router.route("PUT", "/api/independence/settings", z.looseObject({}), async (changes) => {
    const stored = await loadDocument(db, "fiSettings", fireSettingsSchema);
    const merged = fireSettingsSchema.safeParse({ ...stored, ...changes });
    if (!merged.success) {
      const details = merged.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      throw new HttpError(400, `invalid settings. ${details.join(". ")}`);
    }
    const fire = merged.data;
    if (fire.efFromGoal !== null) {
      const goal = await db
        .selectFrom("goal")
        .select("id")
        .where("id", "=", fire.efFromGoal)
        .executeTakeFirst();
      if (!goal) throw new HttpError(400, "the Financial security goal does not exist");
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
