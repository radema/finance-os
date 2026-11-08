import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoalListView } from "../engine/goalViews.ts";
import type { IndependenceView } from "../engine/independenceView.ts";
import type { OverviewView } from "../engine/overviewView.ts";
import type { PerformanceView, PlanVsActualView } from "../engine/trackingViews.ts";
import { startServer } from "./index.ts";

describe("GET /api/overview", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-overview-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const get = async <T>(path: string): Promise<T> =>
    (await (await fetch(`${url}${path}`)).json()) as T;

  it("answers an empty data folder without an error", async () => {
    const view = await get<OverviewView>("/api/overview");
    expect(view.goals).toEqual([]);
    expect(view.keyNumbers).toEqual({
      netWorth: null,
      marketChange: null,
      ytdTwr: null,
      fiWealth: null,
    });
    expect(view.plan.latest).toBeNull();
    expect(view.stalePrices).toEqual([]);
  });

  it("shows the number of the screen each one links to", async () => {
    await fetch(`${url}/api/sample-data`, { method: "POST" });
    const view = await get<OverviewView>("/api/overview");

    const performance = await get<PerformanceView>("/api/performance?scope=all");
    expect(view.keyNumbers.netWorth).toBe(performance.summary?.value);
    expect(view.keyNumbers.ytdTwr).toBe(performance.summary?.twr.ytd);
    const [previous, last] = performance.months.slice(-2);
    expect(view.keyNumbers.marketChange).toBeCloseTo(
      (last?.value ?? 0) -
        (previous?.value ?? 0) -
        ((last?.moneyIn ?? 0) - (previous?.moneyIn ?? 0)),
      6,
    );

    const list = await get<GoalListView>("/api/goal-list");
    expect(view.goals).toEqual(list.goals);
    expect(view.asOf).toBe(list.asOf);

    const independence = await get<IndependenceView>("/api/independence");
    expect(view.fi).toEqual(independence);
    expect(view.keyNumbers.fiWealth).toBe(independence.result?.wealthToday.total);

    const plan = await get<PlanVsActualView>("/api/plan-vs-actual");
    expect(view.plan.trackingStart).toBe(plan.trackingStart);
    expect(view.plan.latest).toEqual(plan.total.at(-1) ?? null);
    expect(view.plan.next).toEqual(
      plan.next &&
        (({ goalId, goalName, slot, amount, wait, minTicket }) => ({
          goalId,
          goalName,
          slot,
          amount,
          wait,
          minTicket,
        }))(plan.next),
    );
    expect(view.stalePrices.every((price) => price.age.old)).toBe(true);
    for (const field of ["netWorth", "ranges", "cashFlow", "snapshots", "prices"])
      expect(view).not.toHaveProperty(field);
  });
});
