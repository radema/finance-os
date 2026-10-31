import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoalDetail } from "../engine/goalViews.ts";
import type { PensionView } from "../engine/pensionView.ts";
import type { PensionPlan } from "../engine/schemas.ts";
import { startServer } from "./index.ts";

describe("Pension plan and Pension view API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-pension-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const view = async () => (await call<PensionView>("GET", "/api/pension-view")).body;

  it("has no plan, no this-year block and no schedule on an empty folder", async () => {
    expect(await view()).toMatchObject({ plan: null, thisYear: null, schedule: [] });
    expect((await call("GET", "/api/pension-plan")).body).toBeNull();
  });

  // Sample plan: RAL 40,000, worker 1%, employer 1%, voluntary to cap, cap 5,300 + extra 2,650,
  // marginal rate 35%, asOf 2026-10-31 (f = 2/12). Voluntary YTD = 50 units x 13 = 650 on the
  // Equity fund, the only fund with a Voluntary flow (the 60 Balanced units are Work).
  it("gives this year's cap, used, still available, refund and exit tax of the sample plan", async () => {
    await call("POST", "/api/sample-data");
    const { thisYear, schedule } = await view();
    expect(thisYear).toMatchObject({ year: 2026, cap: 5_300, extra: 2_650, voluntaryYtd: 650 });
    // used = 400 + 400 + 650; still available = 7,950 - 1,450
    expect(thisYear?.used).toBeCloseTo(1_450, 6);
    expect(thisYear?.available).toBeCloseTo(6_500, 6);
    // refund = (650 + 7,150 x 2/12) x 35%, paid in 2027
    expect(thisYear?.refund).toBeCloseTo((650 + 7_150 / 6) * 0.35, 6);
    expect(thisYear?.refundYear).toBe(2027);
    expect(schedule).toHaveLength(10);
    expect(schedule[0]).toMatchObject({ year: 2026, tfr: 2_764, worker: 400, employer: 400 });
    expect(schedule[0]?.voluntary).toBeCloseTo(7_150, 6);
    expect(schedule[1]?.ral).toBeCloseTo(40_800, 6);

    // The exit tax is the engine's liquidation of the pension goal: the same as the Goal detail.
    const goal = (await call<GoalDetail>("GET", "/api/goal-detail?id=g-retirement")).body;
    expect(thisYear?.exitTax).toBeCloseTo(goal.projection?.tax ?? Number.NaN, 6);
    expect(thisYear?.exitTax).toBeCloseTo(28_927.4, 1);
    // 2046 - 2020 - 15 = 11 extra years: 15% - 3.3%
    expect(thisYear?.exitRate).toBeCloseTo(0.117, 10);
  });

  it("sums this year's pensionContribution transactions on Voluntary products as the voluntary YTD", async () => {
    await call("POST", "/api/sample-data");
    const contribute = (date: string, productId: string, amountCents: number) =>
      call("POST", "/api/transactions", {
        date,
        goalId: "g-retirement",
        productId,
        type: "pensionContribution",
        amountCents,
        price: 13,
      });
    // Counts: Voluntary product, this year. Does not count: last year, a Work-only product.
    await contribute("2026-03-01", "p-pension-equity", 10_000);
    await contribute("2025-12-31", "p-pension-equity", 20_000);
    await contribute("2026-04-01", "p-pension-balanced", 30_000);
    expect((await view()).thisYear?.voluntaryYtd).toBeCloseTo(750, 6);
  });

  it("saves the plan, validated, and reads it back", async () => {
    await call("POST", "/api/sample-data");
    const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
    expect(plan).toMatchObject({ goalId: "g-retirement", firstYear: 2020, ral: 4_000_000 });
    const saved = await call<PensionPlan>("PUT", "/api/pension-plan", { ...plan, ral: 5_000_000 });
    expect(saved.status).toBe(200);
    expect((await view()).schedule[0]?.ral).toBeCloseTo(50_000, 6);
    expect((await call("PUT", "/api/pension-plan", { ...plan, workerPct: 2 })).status).toBe(400);
    expect((await call("PUT", "/api/pension-plan", { ...plan, goalId: "nope" })).status).toBe(400);
    const badFlow = [{ productId: "nope", flow: "Work", pct: 1 }];
    expect((await call("PUT", "/api/pension-plan", { ...plan, flows: badFlow })).status).toBe(400);
  });

  it("accepts the partial plan and shows no schedule for it", async () => {
    await call("POST", "/api/sample-data");
    const partial = { goalId: "g-retirement", firstYear: 2020 };
    expect((await call("PUT", "/api/pension-plan", partial)).status).toBe(200);
    expect(await view()).toMatchObject({ thisYear: null, schedule: [] });
  });
});
