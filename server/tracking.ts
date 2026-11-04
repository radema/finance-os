import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import { minEfficientTicket } from "../engine/commission.ts";
import type { GoalWorld } from "../engine/goalViews.ts";
import { monthEnd } from "../engine/months.ts";
import { pensionSchedule } from "../engine/pension.ts";
import type {
  PerformanceInput,
  PerformanceScope,
  PerformanceTransaction,
} from "../engine/performance.ts";
import { computePerformance, performanceScopes } from "../engine/performance.ts";
import { nextContribution, planVsActual } from "../engine/planVsActual.ts";
import { commissionSchema } from "../engine/schemas.ts";
import { goalSlot } from "../engine/slots.ts";
import type {
  NextContributionView,
  PerformanceScopeRow,
  PerformanceScopesView,
  PerformanceSummary,
  PerformanceView,
  PlanVsActualView,
} from "../engine/trackingViews.ts";
import { performanceOf, totalOf } from "../engine/trackingViews.ts";
import { fromCents, fromScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import { loadWorld } from "./goalViews.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

const NO_PRICE_NOTE = "A held product has no price, so the performance cannot be computed.";
const NO_TRANSACTIONS_NOTE = "There are no transactions in this scope yet.";

/** `scope=all` (the default), `scope=allExceptPension`, or `scope=bucket&goalId=<id>`. */
const scopeQuery = z
  .object({
    scope: z.enum(["all", "allExceptPension", "bucket"]).default("all"),
    goalId: z.string().min(1).optional(),
  })
  .refine((query) => (query.scope === "bucket") === (query.goalId !== undefined), {
    message: "goalId goes with scope=bucket, and only with it",
    path: ["goalId"],
  });

/**
 * What the performance engine reads, with prices as quoted: it applies the bond's per-100 rule itself,
 * so the loaders of the Goals views, which already did, are not used here.
 */
export async function loadPerformanceInput(
  db: Kysely<DB>,
  world: GoalWorld,
): Promise<Omit<PerformanceInput, "scope">> {
  const rows = await db
    .selectFrom("transaction")
    .select([
      "date",
      "goalId",
      "productId",
      "type",
      "qtyScaled",
      "priceScaled",
      "commissionCents",
      "amountCents",
    ])
    .orderBy("date")
    .orderBy(sql`rowid`)
    .execute();
  const prices = await db
    .selectFrom("pricePoint")
    .select(["productId", "month", "priceScaled"])
    .execute();
  const transactions: PerformanceTransaction[] = rows.map((row) => ({
    date: row.date,
    goalId: row.goalId,
    productId: row.productId,
    type: row.type,
    qty: fromScaled(row.qtyScaled),
    price: fromScaled(row.priceScaled),
    commission: row.commissionCents === null ? 0 : fromCents(row.commissionCents),
    amount: fromCents(row.amountCents),
  }));
  return {
    transactions,
    prices: prices.map(({ productId, month, priceScaled }) => ({
      productId,
      month,
      price: fromScaled(priceScaled),
    })),
    products: [...world.products.values()].map(({ id, regime }) => ({ id, regime })),
    valuationMonth: world.month,
  };
}

const labelOf = (world: GoalWorld, scope: PerformanceScope): string => {
  if (scope.kind === "all") return "All goals";
  if (scope.kind === "allExceptPension") return "All except pension";
  return world.goals.find((goal) => goal.id === scope.goalId)?.name ?? scope.goalId;
};

/** The series and KPIs of a scope; a data problem becomes a note, never an error. */
export function performanceFor(
  input: Omit<PerformanceInput, "scope">,
  scope: PerformanceScope,
): { months: PerformanceView["months"]; summary: PerformanceSummary | null; note: string | null } {
  try {
    const { months, summary } = performanceOf(computePerformance({ ...input, scope }));
    return { months, summary, note: summary ? null : NO_TRANSACTIONS_NOTE };
  } catch {
    return { months: [], summary: null, note: NO_PRICE_NOTE };
  }
}

/** Plan vs actual since the tracking start, with the next contribution. Money in cents. */
async function loadPlanVsActual(db: Kysely<DB>, today: string): Promise<PlanVsActualView> {
  const world = await loadWorld(db, today);
  const { settings, pension } = world;
  const plans = await db
    .selectFrom("contributionPlan")
    .select(["goalId", "fromMonth", "monthlyCents"])
    .execute();
  const asPension =
    pension && pension.ral !== undefined
      ? {
          goalId: pension.goalId,
          schedule: pensionSchedule(
            pension,
            settings,
            monthEnd(world.month),
            world.voluntaryYtdCents,
          ),
        }
      : undefined;
  const goals = planVsActual({
    goals: world.goals,
    plans: plans.map(({ goalId, fromMonth, monthlyCents }) => ({
      goalId,
      fromMonth,
      monthly: monthlyCents,
    })),
    transactions: world.ledger,
    pension: asPension,
    trackingStart: settings.trackingStart,
    valuationMonth: world.month,
  });

  const commission = await loadDocument(db, "commission", commissionSchema);
  const zeroCommission = new Map(
    (await db.selectFrom("product").select(["id", "zeroCommission"]).execute()).map((row) => [
      row.id,
      { zeroCommission: row.zeroCommission === 1 },
    ]),
  );
  const pick = nextContribution({
    planVsActual: goals,
    pensionGoalId: pension?.goalId,
    allocationWeights: world.weights,
    products: zeroCommission,
    commission,
  });
  const nameOf = (goalId: string) => world.goals.find((goal) => goal.id === goalId)?.name ?? goalId;
  const slotOf = (goalId: string) => goalSlot({ id: goalId }, world.goals, pension?.goalId);
  const next: NextContributionView | null = pick && {
    ...pick,
    goalName: nameOf(pick.goalId),
    slot: slotOf(pick.goalId),
    minTicket: minEfficientTicket(commission),
    split: pick.split.map((row) => ({
      ...row,
      productName: world.products.get(row.productId)?.name ?? row.productId,
    })),
  };

  return {
    asOf: monthEnd(world.month),
    trackingStart: settings.trackingStart,
    pensionGoalId: pension?.goalId ?? null,
    pensionPlanFromSchedule: asPension !== undefined,
    goals: goals.map((goal) => ({
      ...goal,
      name: nameOf(goal.goalId),
      slot: slotOf(goal.goalId),
    })),
    total: totalOf(goals),
    next,
  };
}

/** The Performance and Plan vs actual screens' read models. */
export function registerTrackingRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/performance", scopeQuery, async (query): Promise<PerformanceView> => {
    const world = await loadWorld(db, today());
    const scope: PerformanceScope =
      query.scope === "bucket"
        ? { kind: "bucket", goalId: query.goalId as string }
        : { kind: query.scope };
    if (scope.kind === "bucket" && !world.goals.some((goal) => goal.id === scope.goalId)) {
      throw new HttpError(404, "goal not found");
    }
    const input = await loadPerformanceInput(db, world);
    return {
      asOf: monthEnd(world.month),
      scope,
      label: labelOf(world, scope),
      slot:
        scope.kind === "bucket"
          ? goalSlot({ id: scope.goalId }, world.goals, world.pension?.goalId)
          : null,
      ...performanceFor(input, scope),
    };
  });

  router.route(
    "GET",
    "/api/performance/scopes",
    z.object({}),
    async (): Promise<PerformanceScopesView> => {
      const world = await loadWorld(db, today());
      const input = await loadPerformanceInput(db, world);
      const rows: PerformanceScopeRow[] = performanceScopes(input.transactions).map((scope) => {
        const { summary, note } = performanceFor(input, scope);
        return { scope, label: labelOf(world, scope), summary, note };
      });
      return { asOf: monthEnd(world.month), rows };
    },
  );

  router.route(
    "GET",
    "/api/plan-vs-actual",
    z.object({}),
    (): Promise<PlanVsActualView> => loadPlanVsActual(db, today()),
  );
}
