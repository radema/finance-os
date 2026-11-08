import type { Kysely } from "kysely";
import { z } from "zod";
import { listWithRangesOf } from "../engine/goalViews.ts";
import { monthEnd } from "../engine/months.ts";
import type { OverviewView } from "../engine/overviewView.ts";
import { keyNumbersOf } from "../engine/overviewView.ts";
import type { DB } from "./db.ts";
import { loadWorld } from "./goalViews.ts";
import { loadIndependence } from "./independence.ts";
import { loadPriceOverview } from "./prices.ts";
import type { Router } from "./router.ts";
import { loadPerformanceInput, loadPlanVsActual, performanceFor } from "./tracking.ts";

/** The Overview's read model: the key numbers and the data of every grid cell, in one read. */
async function loadOverview(db: Kysely<DB>, today: string): Promise<OverviewView> {
  const world = await loadWorld(db, today);
  const { rows } = listWithRangesOf(world);
  const fi = await loadIndependence(db, today);
  const { months, summary } = performanceFor(await loadPerformanceInput(db, world), {
    kind: "all",
  });

  const plan = await loadPlanVsActual(db, today);
  const next = plan.next;

  return {
    asOf: monthEnd(world.month),
    keyNumbers: keyNumbersOf(months, summary, fi.result?.wealthToday.total ?? null),
    goals: rows,
    fi,
    plan: {
      trackingStart: plan.trackingStart,
      latest: plan.total.at(-1) ?? null,
      next: next && {
        goalId: next.goalId,
        goalName: next.goalName,
        slot: next.slot,
        amount: next.amount,
        wait: next.wait,
        minTicket: next.minTicket,
      },
    },
    stalePrices: (await loadPriceOverview(db, today))
      .filter(({ age }) => age.old)
      .map(({ productId, name, age }) => ({ productId, name, age })),
  };
}

/** `GET /api/overview`: one read for the Overview screen. The alerts have their own read. */
export function registerOverviewRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  router.route("GET", "/api/overview", z.object({}), () => loadOverview(db, today()));
}
