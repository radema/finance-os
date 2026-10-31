import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoalDetail } from "../engine/goalViews.ts";
import type { PensionView } from "../engine/pensionView.ts";
import type { Goal, PensionPlan, Transaction } from "../engine/schemas.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
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

  // AC-94: the equity fund takes both flows (Work 40% of the Work flow, all of Voluntary).
  describe("contribution flow (AC-94)", () => {
    const bothFlows = (plan: PensionPlan): PensionPlan => ({
      ...plan,
      flows: [
        { productId: "p-pension-balanced", flow: "Work", pct: 0.6 },
        { productId: "p-pension-equity", flow: "Work", pct: 0.4 },
        { productId: "p-pension-equity", flow: "Voluntary", pct: 1 },
      ],
    });
    const contribute = (date: string, productId: string, amountCents: number, flow?: string) =>
      call<Transaction & { error?: string }>("POST", "/api/transactions", {
        date,
        goalId: "g-retirement",
        productId,
        type: "pensionContribution",
        amountCents,
        price: 13,
        flow,
      });
    const savePlan = async (change: (plan: PensionPlan) => PensionPlan) => {
      const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
      expect((await call("PUT", "/api/pension-plan", change(plan))).status).toBe(200);
    };

    it("counts only the Voluntary contribution of a fund that takes both flows", async () => {
      await call("POST", "/api/sample-data");
      await savePlan(bothFlows);
      expect((await contribute("2026-03-01", "p-pension-equity", 10_000, "Work")).status).toBe(200);
      expect((await contribute("2026-04-01", "p-pension-equity", 20_000, "Voluntary")).status).toBe(
        200,
      );
      // 650 from the sample's Voluntary row + 200; the 100 of Work is not voluntary.
      expect((await view()).thisYear?.voluntaryYtd).toBeCloseTo(850, 6);
    });

    it("gives a contribution the flow of a product that takes one flow", async () => {
      await call("POST", "/api/sample-data");
      const equity = await contribute("2026-03-01", "p-pension-equity", 10_000);
      expect(equity.body.flow).toBe("Voluntary");
      const balanced = await contribute("2026-03-02", "p-pension-balanced", 10_000);
      expect(balanced.body.flow).toBe("Work");
      const list = (await call<Transaction[]>("GET", "/api/transactions?year=2026")).body;
      expect(list.filter((row) => row.date === "2026-03-01").map((row) => row.flow)).toEqual([
        "Voluntary",
      ]);
    });

    it("refuses a contribution without a flow on a fund that takes both", async () => {
      await call("POST", "/api/sample-data");
      await savePlan(bothFlows);
      const refused = await contribute("2026-03-01", "p-pension-equity", 10_000);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toContain("flow");
      // The same rule holds on an edit.
      const ok = await contribute("2026-03-01", "p-pension-equity", 10_000, "Work");
      const { id, flow: _flow, ...rest } = ok.body;
      expect((await call("PUT", "/api/transactions", { id, ...rest })).status).toBe(400);
    });

    it("refuses a flow on a row that is not a pension contribution", async () => {
      await call("POST", "/api/sample-data");
      const refused = await call<{ error: string }>("POST", "/api/transactions", {
        date: "2026-03-01",
        goalId: "g-car",
        productId: "p-world-etf",
        type: "buy",
        amountCents: 10_000,
        price: 100,
        flow: "Work",
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toContain("flow");
    });

    it("keeps no flow for a product that the plan does not name, which counts as Work", async () => {
      await call("POST", "/api/sample-data");
      await savePlan((plan) => ({ ...plan, flows: [] }));
      const row = await contribute("2026-03-01", "p-pension-equity", 10_000);
      expect(row.status).toBe(200);
      expect(row.body.flow).toBeUndefined();
      expect((await view()).thisYear?.voluntaryYtd).toBeCloseTo(650, 6);
    });
  });

  // AC-95. Sample: worker + employer 800, cap 5,300 + extra 2,650 = 7,950, Voluntary YTD 650.
  it("shows still available 0 and the non-deducted part when this year's payments pass the limit", async () => {
    await call("POST", "/api/sample-data");
    const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
    // No scheduled voluntary for the rest of the year, so the tax year is the YTD alone.
    await call("PUT", "/api/pension-plan", { ...plan, voluntary: 0 });
    await call("POST", "/api/transactions", {
      date: "2026-10-20",
      goalId: "g-retirement",
      productId: "p-pension-equity",
      type: "pensionContribution",
      amountCents: 700_000,
      price: 13,
    });
    // Used = 800 + 650 + 7,000 = 7,950 + 500.
    const { thisYear } = await view();
    expect(thisYear?.used).toBeCloseTo(8_450, 6);
    expect(thisYear?.available).toBe(0);
    expect(thisYear?.nonDeducted).toBeCloseTo(500, 6);
  });

  it("ends the schedule at the pension goal's target year (AC-96)", async () => {
    await call("POST", "/api/sample-data");
    const goal = (await call<Goal[]>("GET", "/api/goals")).body.find(
      (g) => g.id === "g-retirement",
    );
    await call("PUT", "/api/goals", { ...goal, targetYear: 2028 });
    expect((await view()).schedule.map((row) => row.year)).toEqual([2026, 2027, 2028]);
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

  it("refuses a flow on a product that is not a pension fund, or that does not exist", async () => {
    await call("POST", "/api/sample-data");
    const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
    const flows = (productId: string) => [{ productId, flow: "Work", pct: 1 }];
    const etf = await call<{ error: string }>("PUT", "/api/pension-plan", {
      ...plan,
      flows: flows("p-world-etf"),
    });
    expect(etf.status).toBe(400);
    expect(etf.body.error).toContain("not a pension fund");
    const gone = await call("PUT", "/api/pension-plan", { ...plan, flows: flows("nope") });
    expect(gone.status).toBe(400);
  });

  it("refuses flows that do not add up to 100% for a flow with entries", async () => {
    await call("POST", "/api/sample-data");
    const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
    const split = (work: number, voluntary: number) => [
      { productId: "p-pension-balanced", flow: "Work", pct: work },
      { productId: "p-pension-equity", flow: "Work", pct: 0.4 },
      { productId: "p-pension-equity", flow: "Voluntary", pct: voluntary },
    ];
    const save = (flows: unknown) => call("PUT", "/api/pension-plan", { ...plan, flows });
    expect((await save(split(0.6, 1))).status).toBe(200);
    const workShort = await save(split(0.5, 1));
    expect(workShort.status).toBe(400);
    expect((workShort.body as { error: string }).error).toContain("Work");
    expect((await save(split(0.6, 0.5))).status).toBe(400);
    // A flow with no entry is allowed: the plan then has no Voluntary flow.
    expect((await save(split(0.6, 1).slice(0, 2))).status).toBe(200);
  });

  it("refuses to delete a product named in the pension flows", async () => {
    await call("POST", "/api/sample-data");
    const { id: _id, ...fund } = sampleJson.products.find((p) => p.id === "p-pension-balanced") ?? {
      id: "",
    };
    const created = await call<{ id: string }>("POST", "/api/products", fund);
    const plan = (await call<PensionPlan>("GET", "/api/pension-plan")).body;
    const flows = [{ productId: created.body.id, flow: "Work", pct: 1 }];
    expect((await call("PUT", "/api/pension-plan", { ...plan, flows })).status).toBe(200);
    const refused = await call<{ error: string }>("DELETE", `/api/products?id=${created.body.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("pension plan");
    // The regime cannot leave `pension` while the flows name the product.
    const asEtf = await call<{ error: string }>("PUT", "/api/products", {
      ...fund,
      id: created.body.id,
      regime: "etf",
    });
    expect(asEtf.status).toBe(409);
    expect(asEtf.body.error).toContain("pension plan");
    // Out of the flows, the same product can be deleted, and the view still loads.
    await call("PUT", "/api/pension-plan", { ...plan, flows: [] });
    expect((await call("DELETE", `/api/products?id=${created.body.id}`)).status).toBe(200);
    expect((await call("GET", "/api/pension-view")).status).toBe(200);
  });

  it("accepts the partial plan and shows no schedule for it", async () => {
    await call("POST", "/api/sample-data");
    const partial = { goalId: "g-retirement", firstYear: 2020 };
    expect((await call("PUT", "/api/pension-plan", partial)).status).toBe(200);
    expect(await view()).toMatchObject({ thisYear: null, schedule: [] });
  });
});
