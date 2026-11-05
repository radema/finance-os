import type { Kysely } from "kysely";
import { z } from "zod";
import { listWithRangesOf, seriesOf } from "../engine/goalViews.ts";
import { monthEnd } from "../engine/months.ts";
import type { OverviewView } from "../engine/overviewView.ts";
import { keyNumbersOf, netWorthByGoal } from "../engine/overviewView.ts";
import { goalSlot } from "../engine/slots.ts";
import { loadCashFlowView } from "./cashFlow.ts";
import type { DB } from "./db.ts";
import { loadWorld } from "./goalViews.ts";
import { loadIndependence } from "./independence.ts";
import { loadPriceOverview } from "./prices.ts";
import type { Router } from "./router.ts";
import { loadSnapshots } from "./snapshots.ts";
import { loadPerformanceInput, performanceFor } from "./tracking.ts";

/** The Overview's read model: the key numbers and the data of every grid cell, in one read. */
async function loadOverview(db: Kysely<DB>, today: string): Promise<OverviewView> {
  const world = await loadWorld(db, today);
  const { rows, ranges } = listWithRangesOf(world);
  const fi = await loadIndependence(db, today);
  const { months, summary } = performanceFor(await loadPerformanceInput(db, world), {
    kind: "all",
  });

  const slotOf = (goal: { id: string }) => goalSlot(goal, world.goals);
  const series = new Map(world.goals.map((goal) => [goal.id, seriesOf(world, goal.id)]));

  return {
    asOf: monthEnd(world.month),
    keyNumbers: keyNumbersOf(months, summary, fi.result?.wealthToday.total ?? null),
    goals: rows,
    netWorth: netWorthByGoal(
      world.goals.map((goal) => ({ goalId: goal.id, name: goal.name, slot: slotOf(goal) })),
      series,
      world.month,
    ),
    ranges: rows.flatMap(({ id, name, slot }) => {
      const range = ranges.get(id);
      return range ? [{ goalId: id, name, slot, range }] : [];
    }),
    cashFlow: (await loadCashFlowView(db, today)).rows,
    fi,
    snapshots: await loadSnapshots(db),
    prices: (await loadPriceOverview(db, today)).map(({ productId, name, lastPrice, age }) => ({
      productId,
      name,
      lastPrice,
      age,
    })),
  };
}

/** `GET /api/overview`: one read for the Overview screen. The alerts have their own read. */
export function registerOverviewRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/overview", z.object({}), () => loadOverview(db, today()));
}
