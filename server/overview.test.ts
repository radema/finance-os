import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CashFlowView } from "../engine/cashFlow.ts";
import type { GoalDetailView, GoalListView } from "../engine/goalViews.ts";
import type { IndependenceView } from "../engine/independenceView.ts";
import type { OverviewView } from "../engine/overviewView.ts";
import type { SnapshotView } from "../engine/snapshot.ts";
import type { PerformanceView } from "../engine/trackingViews.ts";
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
    expect(view.netWorth.months).toEqual([]);
    expect(view.range).toBeNull();
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

    const cashFlow = await get<CashFlowView>("/api/cash-flow");
    expect(view.cashFlow).toEqual(cashFlow.rows);
    expect(view.snapshots).toEqual(await get<SnapshotView[]>("/api/snapshots"));
  });

  it("draws the range of the weakest goal like its detail page, and the series like its chart", async () => {
    await fetch(`${url}/api/sample-data`, { method: "POST" });
    const view = await get<OverviewView>("/api/overview");
    const { range } = view;
    expect(range).not.toBeNull();
    const detail = await get<GoalDetailView>(`/api/goal-detail?id=${range?.goalId}`);
    expect(range?.range).toEqual(detail.analysis?.range);

    const line = view.netWorth.goals.find((goal) => goal.goalId === range?.goalId);
    expect(line?.values.at(-1)).toBeCloseTo(detail.series.at(-1)?.value ?? Number.NaN, 6);
    expect(view.netWorth.moneyIn).toHaveLength(view.netWorth.months.length);
    expect(view.prices.map((price) => price.name)).toHaveLength(7);
  });
});
