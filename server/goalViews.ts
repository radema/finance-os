import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import { pensionPlanPartialSchema } from "../engine/fixture.ts";
import type {
  GoalDetail,
  GoalListView,
  GoalSummary,
  HoldingRow,
  SeriesPoint,
} from "../engine/goalViews.ts";
import { holdingsAt, unitPrice } from "../engine/holdings.ts";
import { planInForce } from "../engine/plan.ts";
import type { ProductParams } from "../engine/projection.ts";
import { projectGoal, timeGrid } from "../engine/projection.ts";
import { settingsSchema } from "../engine/schemas.ts";
import { goalSlot } from "../engine/slots.ts";
import type { LiquidationPosition } from "../engine/tax.ts";
import { liquidate } from "../engine/tax.ts";
import { fromCents, fromScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { isEmpty } from "./sample.ts";
import { loadLedger } from "./transactions.ts";

const idQuery = z.object({ id: z.string().min(1) });

const NO_PRICE_NOTE = "A held product has no price, so the projection is not shown.";
const NO_FIRST_YEAR_NOTE =
  "The pension plan has no first year of membership, so the exit tax and the net are not shown.";

const monthEnd = (month: string): string => {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return `${month}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
};

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (
    let current = first;
    current <= last;
    current = `${year}-${String(month).padStart(2, "0")}`
  ) {
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Everything the Goals screens read, loaded once per request. */
async function loadWorld(db: Kysely<DB>, today: string) {
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
  const pensionRow = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", "pensionPlan")
    .executeTakeFirst();
  const pension = pensionRow
    ? pensionPlanPartialSchema.safeParse(JSON.parse(pensionRow.value)).data
    : undefined;

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
  const asOf = monthEnd(month);

  /** The unit price at or before a month: the latest one. Undefined when the product has none yet. */
  const priceAt = (productId: string, at: string): number | undefined =>
    pricesOf.get(productId)?.findLast((point) => point.month <= at)?.price;

  return {
    products: new Map(products.map((product) => [product.id, product])),
    goals,
    plans,
    weights,
    ledger,
    settings,
    pension,
    month,
    asOf,
    priceAt,
    held: holdingsAt(ledger, asOf),
  };
}
type World = Awaited<ReturnType<typeof loadWorld>>;

const summaryOf = (world: World, goal: World["goals"][number]): GoalSummary => {
  const positions = world.held.units.get(goal.id) ?? new Map<string, number>();
  let value = 0;
  let missingPrices = false;
  for (const [productId, units] of positions) {
    if (units === 0) continue;
    const price = world.priceAt(productId, world.month);
    if (price === undefined) missingPrices = true;
    else value += units * price;
  }
  return {
    id: goal.id,
    name: goal.name,
    priority: goal.priority,
    slot: goalSlot(goal, world.goals, world.pension?.goalId),
    target: fromCents(goal.targetCents),
    value,
    missingPrices,
  };
};

function detailOf(world: World, goal: World["goals"][number]): GoalDetail {
  const { products, settings, pension, asOf, month } = world;
  const summary = summaryOf(world, goal);
  const goalWeights = world.weights.filter((weight) => weight.goalId === goal.id);

  const liquidation = (positions: LiquidationPosition[], withZainetto: boolean) => {
    const { zainetto } = settings;
    return liquidate(positions, {
      goalDate: asOf,
      goalId: goal.id,
      taxStd: settings.taxStd,
      taxGovt: settings.taxGovt,
      firstYear: pension?.firstYear,
      zainetto:
        withZainetto && zainetto.goalId !== null
          ? {
              amount: fromCents(zainetto.amountCents),
              expiry: String(zainetto.expiry),
              goalId: zainetto.goalId,
            }
          : undefined,
    });
  };
  const hasNoFirstYear = (regimes: Iterable<string>) =>
    pension?.firstYear === undefined && [...regimes].includes("pension");

  const holdings: HoldingRow[] = [];
  for (const [productId, units] of world.held.units.get(goal.id) ?? []) {
    const product = products.get(productId);
    if (units === 0 || !product) continue;
    const price = world.priceAt(productId, month) ?? null;
    const pmc = world.held.pmc.get(productId) ?? 0;
    const value = price === null ? null : units * price;
    const position = {
      regime: product.regime,
      value: value ?? 0,
      basis: units * pmc,
      whiteListShare: product.whiteListShare,
    };
    // A holding's own tax: the zainetto credit is shared by the bucket, so it shows only in the total.
    const taxIfSold =
      value === null || hasNoFirstYear([product.regime])
        ? null
        : liquidation([position], false).tax;
    holdings.push({
      productId,
      name: product.name,
      regime: product.regime,
      units,
      price,
      pmc,
      value,
      gain: value === null ? null : value - units * pmc,
      taxIfSold,
    });
  }
  const priced = holdings.every((row) => row.value !== null);
  const heldRegimes = holdings.map((row) => row.regime);
  const taxIfSoldTotal =
    priced && !hasNoFirstYear(heldRegimes)
      ? liquidation(
          holdings.map((row) => ({
            regime: row.regime,
            value: row.value ?? 0,
            basis: row.units * row.pmc,
            whiteListShare: products.get(row.productId)?.whiteListShare,
          })),
          true,
        ).tax
      : null;

  const inflation = settings.inflation;
  const targetAtGoalDate = summary.target * (1 + inflation) ** timeGrid(asOf, goal.targetYear).tau;

  const weightedRegimes = goalWeights.map(
    (weight) => products.get(weight.productId)?.regime ?? "etf",
  );
  let projectionNote: string | null = null;
  if (!priced) projectionNote = NO_PRICE_NOTE;
  else if (hasNoFirstYear([...heldRegimes, ...weightedRegimes]))
    projectionNote = NO_FIRST_YEAR_NOTE;

  let projection: GoalDetail["projection"] = null;
  if (projectionNote === null) {
    const params = new Map<string, ProductParams>(
      [...products.values()].map((product) => [
        product.id,
        {
          regime: product.regime,
          mu: product.expReturn,
          ter: product.ter,
          couponRate: product.couponRate,
          whiteListShare: product.whiteListShare,
        },
      ]),
    );
    const { zainetto } = settings;
    const { gross, tax, net } = projectGoal({
      asOf,
      goal: {
        id: goal.id,
        targetYear: goal.targetYear,
        target: summary.target,
        contributionGrowth: goal.contributionGrowth,
      },
      monthly: planInForce(
        world.plans
          .filter((version) => version.goalId === goal.id)
          .map((version) => ({
            fromMonth: version.fromMonth,
            monthly: fromCents(version.monthlyCents),
          })),
        month,
      ),
      positions: holdings.map((row) => ({
        productId: row.productId,
        value: row.value ?? 0,
        basis: row.units * row.pmc,
      })),
      products: params,
      weights: new Map(goalWeights.map((weight) => [weight.productId, weight.weight])),
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
      firstYear: pension?.firstYear,
    });
    projection = { gross, tax, net };
  }

  return {
    ...summary,
    targetYear: goal.targetYear,
    targetAtGoalDate,
    asOf,
    projection,
    projectionNote,
    holdings,
    taxIfSoldTotal,
    series: seriesOf(world, goal.id),
  };
}

/** Value and money put in at each month end, from the goal's first transaction to the valuation month. */
function seriesOf(world: World, goalId: string): SeriesPoint[] {
  const entries = world.ledger.filter(
    (entry) => entry.goalId === goalId && entry.date <= world.asOf,
  );
  const first = entries[0]?.date.slice(0, 7);
  if (first === undefined) return [];

  // Cash put in: qty × unit price + commission (a sell is negative); a coupon is the cash received.
  const cash = (entry: (typeof entries)[number]) =>
    entry.type === "coupon"
      ? -fromCents(entry.amountCents)
      : entry.qty * entry.price + (entry.commission ?? 0);

  return monthsBetween(first, world.month).map((month) => {
    const end = monthEnd(month);
    const moneyIn = entries
      .filter((entry) => entry.date <= end)
      .reduce((sum, entry) => sum + cash(entry), 0);
    let value: number | null = 0;
    for (const [productId, units] of holdingsAt(world.ledger, end).units.get(goalId) ?? []) {
      if (units === 0) continue;
      const price = world.priceAt(productId, month);
      value = price === undefined || value === null ? null : value + units * price;
    }
    return { month, value, moneyIn };
  });
}

/** The Goals list and the Goal detail: read models computed from the ledger, the prices and the engine. */
export function registerGoalViewRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/goal-list", z.object({}), async (): Promise<GoalListView> => {
    const world = await loadWorld(db, today());
    return {
      asOf: world.asOf,
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
