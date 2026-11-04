import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import type { GoalStatus } from "../engine/goalStatus.ts";
import { monthEnd } from "../engine/months.ts";
import { pensionSchedule } from "../engine/pension.ts";
import { planVsActual } from "../engine/planVsActual.ts";
import { priceAge } from "../engine/priceAge.ts";
import type { Alert, RuleInput, RuleTrade } from "../engine/rules.ts";
import { evaluateRules } from "../engine/rules.ts";
import { commissionSchema } from "../engine/schemas.ts";
import type { SnapshotGoal } from "../engine/snapshot.ts";
import { computeSnapshot } from "../engine/snapshot.ts";
import { fromScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import { loadWorld } from "./goalViews.ts";
import { priceFetchProblems } from "./priceFetch.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

export interface StoredDismissal {
  ruleId: string;
  scope: Alert["scope"]["kind"];
  key: string;
}

const sameAlert = (alert: Alert, dismissal: StoredDismissal): boolean =>
  alert.ruleId === dismissal.ruleId &&
  alert.scope.kind === dismissal.scope &&
  alert.key === dismissal.key;

/**
 * Applies the dismissals to the alerts that are true now. An alert with a stored dismissal of the
 * same rule, scope and key is hidden. A dismissal that no alert matches is stale: its condition
 * turned false, or its key changed. It goes to `toDelete`, so the alert shows when it is true again.
 */
export function reconcileDismissals(
  alerts: readonly Alert[],
  dismissals: readonly StoredDismissal[],
): { visible: Alert[]; toDelete: StoredDismissal[] } {
  return {
    visible: alerts.filter((alert) => !dismissals.some((d) => sameAlert(alert, d))),
    toDelete: dismissals.filter((d) => !alerts.some((alert) => sameAlert(alert, d))),
  };
}

/** The facts of the rules, read from the stored data. The valuation date is the month-end of the world's month. */
async function loadRuleInput(db: Kysely<DB>, today: string): Promise<RuleInput> {
  const world = await loadWorld(db, today);
  const asOf = monthEnd(world.month);
  const { settings } = world;

  const plans = await db.selectFrom("contributionPlan").selectAll().execute();
  const history = planVsActual({
    goals: world.goals,
    plans: plans.map(({ goalId, fromMonth, monthlyCents }) => ({
      goalId,
      fromMonth,
      monthly: monthlyCents,
    })),
    transactions: world.ledger,
    trackingStart: settings.trackingStart,
    valuationMonth: world.month,
  });

  // The same computation as a snapshot (seed and paths), so R4 never fires on Monte Carlo noise.
  const statuses = new Map<string, GoalStatus | null>(
    computeSnapshot(world).map((goal) => [goal.goalId, goal.status]),
  );
  const snapshot = await db
    .selectFrom("snapshot")
    .selectAll()
    .orderBy("month", "desc")
    .executeTakeFirst();
  const latestSnapshot = snapshot
    ? {
        month: snapshot.month,
        statuses: new Map(
          (JSON.parse(snapshot.results) as SnapshotGoal[]).map((goal) => [
            goal.goalId,
            goal.status,
          ]),
        ),
      }
    : null;

  const products = await db.selectFrom("product").selectAll().execute();
  const points = await db
    .selectFrom("pricePoint")
    .select(["productId", "month", "priceDate"])
    .execute();
  const unitPrices = new Map<string, number>();
  for (const [productId, prices] of world.prices) {
    const price = prices.findLast((point) => point.month <= world.month)?.price;
    if (price !== undefined) unitPrices.set(productId, price);
  }

  const trades = await db
    .selectFrom("transaction")
    .select(["id", "date", "productId", "type", "amountCents", "commissionCents"])
    .where("type", "in", ["buy", "sell"])
    .orderBy("date")
    .orderBy(sql`rowid`)
    .execute();

  const plan = world.pension;
  const row = plan ? pensionSchedule(plan, settings, asOf, world.voluntaryYtdCents)[0] : undefined;

  return {
    asOf,
    settings,
    commission: await loadDocument(db, "commission", commissionSchema),
    goals: world.goals,
    planVsActual: history,
    pension: plan
      ? {
          goalId: plan.goalId,
          deduction: row
            ? {
                workerCents: row.worker,
                employerCents: row.employer,
                extraCents: plan.extra,
                voluntaryYtdCents: world.voluntaryYtdCents,
              }
            : null,
        }
      : null,
    statuses,
    latestSnapshot,
    ledger: world.ledger,
    products: products.map((product) => ({
      ...product,
      brokerUnits:
        product.brokerUnitsScaled === null ? null : fromScaled(product.brokerUnitsScaled),
    })),
    unitPrices,
    priceAge: new Map(
      products.map((product) => [
        product.id,
        priceAge(
          product,
          points.filter((point) => point.productId === product.id),
          today,
          settings.thresholds.dailyPriceAgeDays,
        ),
      ]),
    ),
    trades: trades as RuleTrade[],
    fetchProblems: await priceFetchProblems(db),
  };
}

const dismissBody = z.object({
  ruleId: z.string().min(1),
  scope: z.enum(["goal", "product", "none"]),
  key: z.string().min(1),
});

/**
 * The alerts that are true now and not dismissed. Reading clears the dismissals whose alert is gone:
 * the only trigger the spec asks for.
 */
export async function visibleAlerts(db: Kysely<DB>, today: string): Promise<Alert[]> {
  const dismissals = await db.selectFrom("dismissal").select(["ruleId", "scope", "key"]).execute();
  const { visible, toDelete } = reconcileDismissals(
    evaluateRules(await loadRuleInput(db, today)),
    dismissals,
  );
  for (const { ruleId, scope, key } of toDelete) {
    await db
      .deleteFrom("dismissal")
      .where("ruleId", "=", ruleId)
      .where("scope", "=", scope)
      .where("key", "=", key)
      .execute();
  }
  return visible;
}

/** Alerts: the visible ones, and dismiss. Alerts are generated on each read and never stored. */
export function registerAlertRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  const current = async () => evaluateRules(await loadRuleInput(db, today()));

  router.route("GET", "/api/alerts", z.object({}), () => visibleAlerts(db, today()));

  router.route("POST", "/api/alerts/dismiss", dismissBody, async (input) => {
    const alert = (await current()).find((candidate) => sameAlert(candidate, input));
    if (!alert) throw new HttpError(404, "alert not found");
    await db
      .insertInto("dismissal")
      .values({ ...input, dismissedAt: new Date().toISOString() })
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    return undefined;
  });
}
