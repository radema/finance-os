import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleDataSchema } from "../engine/fixture.ts";
import type { GoalListView } from "../engine/goalViews.ts";
import { unitPrice } from "../engine/holdings.ts";
import { pensionSchedule } from "../engine/pension.ts";
import type { PerformanceScope } from "../engine/performance.ts";
import { computePerformance } from "../engine/performance.ts";
import { nextContribution, planVsActual } from "../engine/planVsActual.ts";
import type { Settings } from "../engine/schemas.ts";
import { commissionSchema } from "../engine/schemas.ts";
import type {
  PerformanceScopesView,
  PerformanceView,
  PlanVsActualView,
} from "../engine/trackingViews.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import { startServer } from "./index.ts";

const sample = sampleDataSchema.parse(sampleJson);
const VALUATION_MONTH = "2026-10";
/** The Equity fund is the only one with a Voluntary flow: 50 units x 13 euros this year, in cents. */
const VOLUNTARY_YTD_CENTS = 65_000;

/** The performance engine run on the fixture: the oracle. Prices and ledger prices stay as quoted. */
function enginePerformance(scope: PerformanceScope) {
  return computePerformance({
    cashLedger: {
      movements: [],
      trades: sample.ledger.map((row, index) => {
        const regime = sample.products.find((p) => p.id === row.productId)?.regime ?? "etf";
        return {
          ...row,
          id: String(index),
          price: unitPrice(regime, row.price),
          regime,
          legacy: true,
          amountCents: Math.round(Math.abs(row.qty) * unitPrice(regime, row.price) * 100),
          commissionCents: row.commission === undefined ? null : Math.round(row.commission * 100),
        };
      }),
    },
    transactions: sample.ledger.map((row) => ({
      ...row,
      amount: undefined,
    })),
    prices: sample.prices.map(({ productId, month, price }) => ({ productId, month, price })),
    products: sample.products.map(({ id, regime }) => ({ id, regime })),
    scope,
    valuationMonth: VALUATION_MONTH,
  });
}

/** The plan-vs-actual engine run on the fixture: the oracle. */
function enginePlanVsActual(trackingStart: string) {
  const regimeOf = new Map(sample.products.map((product) => [product.id, product.regime]));
  return planVsActual({
    goals: sample.goals.map(({ id, targetYear }) => ({ id, targetYear })),
    plans: sample.goals.flatMap((goal) =>
      goal.plan.map(({ fromMonth, monthlyCents }) => ({
        goalId: goal.id,
        fromMonth,
        monthly: monthlyCents,
      })),
    ),
    transactions: sample.ledger.map((row) => ({
      ...row,
      price: unitPrice(regimeOf.get(row.productId) ?? "etf", row.price),
    })),
    pension: {
      goalId: sample.pensionPlan.goalId,
      schedule: pensionSchedule(
        sample.pensionPlan,
        sample.settings,
        "2026-10-31",
        VOLUNTARY_YTD_CENTS,
      ),
    },
    trackingStart,
    valuationMonth: VALUATION_MONTH,
  });
}

describe("Performance and Plan vs actual API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-tracking-"));
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
  const performance = async (query = "") =>
    (await call<PerformanceView>("GET", `/api/performance${query}`)).body;
  const planView = async () => (await call<PlanVsActualView>("GET", "/api/plan-vs-actual")).body;
  const loadSample = () => call("POST", "/api/sample-data");

  describe("GET /api/performance", () => {
    it("answers an empty data folder without an error", async () => {
      expect(await performance()).toMatchObject({ months: [], summary: null });
      expect((await planView()).goals).toEqual([]);
    });

    it("matches the engine for each scope, bonds per 100 included", async () => {
      await loadSample();
      const scopes: [string, PerformanceScope][] = [
        ["", { kind: "all" }],
        ["?scope=allExceptPension", { kind: "allExceptPension" }],
        ["?scope=bucket&goalId=g-car", { kind: "bucket", goalId: "g-car" }],
      ];
      for (const [query, scope] of scopes) {
        const view = await performance(query);
        const expected = enginePerformance(scope);
        expect(view.months.map((m) => m.month)).toEqual(expected.months.map((m) => m.month));
        expect(view.summary?.value).toBeCloseTo(expected.months.at(-1)?.value ?? Number.NaN, 6);
        expect(view.summary?.twr.sinceStart).toBeCloseTo(expected.twr.sinceStart ?? Number.NaN, 8);
        expect(view.summary?.xirr).toBe(expected.xirr);
        expect(view.summary?.maxDrawdown).toBeCloseTo(expected.maxDrawdown, 8);
      }
    });

    it("values the scopes like the Goals list, and counts the money put in like Goal detail", async () => {
      await loadSample();
      const { goals } = (await call<GoalListView>("GET", "/api/goal-list")).body;
      const all = await performance();
      expect(all.asOf).toBe("2026-10-31");
      expect(all.summary?.value).toBeCloseTo(
        goals.reduce((sum, goal) => sum + goal.value, 0),
        6,
      );
      const car = await performance("?scope=bucket&goalId=g-car");
      expect(car.label).toBe("New car");
      expect(car.slot).toBe(3);
      expect(all.slot).toBeNull();
      expect((await performance("?scope=bucket&goalId=g-retirement")).slot).toBe(5);
      expect(car.summary?.value).toBeCloseTo(goals.find((g) => g.id === "g-car")?.value ?? 0, 6);
      // 4000 + 2083.95 + 2960.61 - 1177.05 + 1502.95, as on the Goal detail.
      expect(car.summary?.moneyIn).toBeCloseTo(9_370.46, 2);
      expect(car.summary?.gain).toBeCloseTo((car.summary?.value ?? 0) - 9_370.46, 2);
      const noPension = await performance("?scope=allExceptPension");
      const retirement = goals.find((g) => g.id === "g-retirement")?.value ?? 0;
      expect(noPension.summary?.value).toBeCloseTo((all.summary?.value ?? 0) - retirement, 6);
    });

    it("refuses a bucket without a goal, and an unknown goal", async () => {
      await loadSample();
      expect((await call("GET", "/api/performance?scope=bucket")).status).toBe(400);
      expect((await call("GET", "/api/performance?scope=all&goalId=g-car")).status).toBe(400);
      expect((await call("GET", "/api/performance?scope=bucket&goalId=nope")).status).toBe(404);
    });
  });

  describe("GET /api/performance/scopes", () => {
    it("lists all, all except pension, then each bucket with its summary", async () => {
      await loadSample();
      const { rows, asOf } = (await call<PerformanceScopesView>("GET", "/api/performance/scopes"))
        .body;
      expect(asOf).toBe("2026-10-31");
      expect(rows.map((row) => row.label)).toEqual([
        "All goals",
        "All except pension",
        "New car",
        "Holiday",
        "Home deposit",
        "Retirement",
      ]);
      const car = rows.find((row) => row.label === "New car");
      expect(car?.scope).toEqual({ kind: "bucket", goalId: "g-car" });
      expect(car?.summary?.value).toBeCloseTo(
        enginePerformance({ kind: "bucket", goalId: "g-car" }).months.at(-1)?.value ?? Number.NaN,
        6,
      );
    });
  });

  describe("GET /api/plan-vs-actual", () => {
    it("gives the #54 output for every goal, in cents", async () => {
      await loadSample();
      const view = await planView();
      const expected = enginePlanVsActual("2026-01");
      expect(view.trackingStart).toBe("2026-01");
      expect(view.pensionGoalId).toBe("g-retirement");
      expect(view.pensionPlanFromSchedule).toBe(true);
      expect(view.goals.map((goal) => goal.goalId)).toEqual(expected.map((goal) => goal.goalId));
      for (const goal of view.goals) {
        const oracle = expected.find((candidate) => candidate.goalId === goal.goalId);
        expect(goal.months.length).toBe(10);
        for (const [index, month] of goal.months.entries()) {
          expect(month.month).toBe(oracle?.months[index]?.month);
          expect(month.planned).toBeCloseTo(oracle?.months[index]?.planned ?? Number.NaN, 4);
          expect(month.gap).toBeCloseTo(oracle?.months[index]?.gap ?? Number.NaN, 4);
        }
      }
      const car = view.goals.find((goal) => goal.goalId === "g-car");
      // 400 a month to June, 450 from July: 6 x 400 + 4 x 450 = 4200 euros.
      expect(car?.months.at(-1)?.cumPlanned).toBe(420_000);
      expect(car?.name).toBe("New car");
      expect(view.total.at(-1)?.cumPlanned).toBeCloseTo(
        view.goals.reduce((sum, goal) => sum + (goal.months.at(-1)?.cumPlanned ?? 0), 0),
        4,
      );
    });

    it("picks the next contribution like the engine, with product names", async () => {
      await loadSample();
      const view = await planView();
      const behind = view.goals
        .filter((goal) => goal.goalId !== view.pensionGoalId)
        .map((goal) => ({ id: goal.goalId, gap: goal.months.at(-1)?.gap ?? 0 }))
        .filter(({ gap }) => gap < 0)
        .sort((a, b) => a.gap - b.gap)[0];
      const next = view.next;
      expect(next).not.toBeNull();
      expect(next?.goalId).toBe(behind?.id);
      expect(next?.amount).toBeCloseTo(-(behind?.gap ?? 0), 4);
      expect(next?.split.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(
        next?.amount ?? Number.NaN,
        4,
      );
      for (const row of next?.split ?? []) expect(row.productName.length).toBeGreaterThan(0);
      expect(next?.minTicket).toBe(295 / 0.0019);
      const oracle = nextContribution({
        planVsActual: enginePlanVsActual("2026-01"),
        pensionGoalId: "g-retirement",
        allocationWeights: sample.allocation,
        products: new Map(sample.products.map((p) => [p.id, p])),
        commission: commissionSchema.parse({}),
      });
      expect(next?.goalId).toBe(oracle?.goalId);
      expect(next?.wait).toBe(oracle?.wait);
    });

    it("starts at the tracking start of the settings", async () => {
      await loadSample();
      const settings = (await call<Settings>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", { ...settings, trackingStart: "2026-07" });
      const view = await planView();
      expect(view.trackingStart).toBe("2026-07");
      expect(view.goals[0]?.months.map((m) => m.month)).toEqual([
        "2026-07",
        "2026-08",
        "2026-09",
        "2026-10",
      ]);
    });

    it("applies a new plan version from its month only", async () => {
      await loadSample();
      const before = await planView();
      const put = await call("PUT", "/api/goal-plan", {
        goalId: "g-holiday",
        fromMonth: "2026-08",
        monthlyCents: 25_000,
      });
      expect(put.status).toBe(200);
      const after = await planView();
      const planned = (view: PlanVsActualView) =>
        view.goals.find((goal) => goal.goalId === "g-holiday")?.months.map((m) => m.planned);
      expect(planned(before)).toEqual(Array.from({ length: 10 }, () => 10_000));
      expect(planned(after)).toEqual([
        ...Array.from({ length: 7 }, () => 10_000),
        25_000,
        25_000,
        25_000,
      ]);
    });
  });
});
