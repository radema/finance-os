import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleDataSchema } from "../engine/fixture.ts";
import type { GoalDetail, GoalListView } from "../engine/goalViews.ts";
import { holdingsAt, unitPrice } from "../engine/holdings.ts";
import { planInForce } from "../engine/plan.ts";
import type { ProductParams } from "../engine/projection.ts";
import { projectGoal } from "../engine/projection.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const sample = sampleDataSchema.parse(sampleJson);

/** The engine run on the fixture, built here without the server: the oracle for the detail. */
function engineNet(goalId: string) {
  const regimeOf = new Map(sample.products.map((product) => [product.id, product.regime]));
  const holdings = holdingsAt(
    sample.ledger.map((row) => ({
      ...row,
      price: unitPrice(regimeOf.get(row.productId) ?? "etf", row.price),
    })),
    sample.asOf,
  );
  const goal = sample.goals.find((candidate) => candidate.id === goalId);
  if (!goal) throw new Error(`no goal ${goalId}`);
  const { zainetto } = sample.settings;
  return projectGoal({
    asOf: sample.asOf,
    goal: {
      id: goalId,
      targetYear: goal.targetYear,
      target: goal.targetCents / 100,
      contributionGrowth: goal.contributionGrowth,
    },
    monthly: planInForce(
      goal.plan.map(({ fromMonth, monthlyCents }) => ({ fromMonth, monthly: monthlyCents / 100 })),
      sample.asOf.slice(0, 7),
    ),
    positions: [...(holdings.units.get(goalId) ?? [])].map(([productId, units]) => {
      const last = sample.prices
        .filter((price) => price.productId === productId)
        .sort((a, b) => a.month.localeCompare(b.month))
        .at(-1);
      return {
        productId,
        value: units * unitPrice(regimeOf.get(productId) ?? "etf", last?.price ?? 0),
        basis: units * (holdings.pmc.get(productId) ?? 0),
      };
    }),
    products: new Map<string, ProductParams>(
      sample.products.map((product) => [
        product.id,
        {
          regime: product.regime,
          mu: product.expReturn,
          ter: product.ter,
          couponRate: product.couponRate,
          whiteListShare: product.whiteListShare,
        },
      ]),
    ),
    weights: new Map(
      sample.allocation.filter((w) => w.goalId === goalId).map((w) => [w.productId, w.weight]),
    ),
    settings: {
      ...sample.settings,
      zainetto: {
        amount: zainetto.amountCents / 100,
        expiry: String(zainetto.expiry),
        goalId: zainetto.goalId ?? "",
      },
    },
    firstYear: sample.pensionPlan.goalId === goalId ? sample.pensionPlan.firstYear : undefined,
  });
}

describe("Goals list and Goal detail API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-goal-views-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T>(method: string, path: string) => {
    const response = await fetch(`${url}${path}`, { method });
    return { status: response.status, body: (await response.json()) as T };
  };
  const list = async () => (await call<GoalListView>("GET", "/api/goal-list")).body;
  const detail = async (id: string) =>
    (await call<GoalDetail>("GET", `/api/goal-detail?id=${id}`)).body;
  const loadSample = () => call("POST", "/api/sample-data");
  const sql = (statement: string) => {
    const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
    database.exec(statement);
    database.close();
  };

  it("offers the sample data on an empty folder, and lists the 4 goals once it is loaded", async () => {
    expect(await list()).toMatchObject({ sampleAvailable: true, goals: [] });
    expect((await loadSample()).status).toBe(200);
    const view = await list();
    expect(view.sampleAvailable).toBe(false);
    expect(view.asOf).toBe("2026-10-31");
    expect(view.goals.map((goal) => goal.name)).toEqual([
      "Holiday",
      "New car",
      "Home deposit",
      "Retirement",
    ]);
    expect(view.goals.map((goal) => goal.slot)).toEqual([2, 3, 4, 1]);
    const home = view.goals[2];
    expect(home).toMatchObject({ priority: "Need", target: 40_000, missingPrices: false });
    expect(home?.value).toBeCloseTo(18_000, 6);
    expect(Object.keys(home ?? {}).sort()).toEqual(
      ["id", "missingPrices", "name", "priority", "slot", "target", "value"].sort(),
    );
  });

  it("refuses the sample data on a folder that already has data", async () => {
    await loadSample();
    expect((await loadSample()).status).toBe(409);
  });

  it("gives the deterministic net of the engine for the New car goal", async () => {
    await loadSample();
    const car = await detail("g-car");
    const expected = engineNet("g-car");
    expect(car.projection?.net).toBeCloseTo(expected.net, 6);
    expect(car.projection?.gross).toBeCloseTo(expected.gross, 6);
    expect(car.projection?.tax).toBeCloseTo(expected.tax, 6);
    expect(car.targetAtGoalDate).toBeCloseTo(expected.targetAtGoalDate, 6);
    expect(car.projection?.net).toBeCloseTo(29_952.69, 2);
  });

  it("gives the deterministic net of the engine for the pension goal, with its first year", async () => {
    await loadSample();
    const retirement = await detail("g-retirement");
    expect(retirement.projection?.net).toBeCloseTo(engineNet("g-retirement").net, 6);
  });

  it("shows the holdings with units, price, PMC, gain and tax if sold", async () => {
    await loadSample();
    const car = await detail("g-car");
    expect(car.holdings.map((row) => row.productId).sort()).toEqual([
      "p-direct",
      "p-govt",
      "p-world-etf",
    ]);
    const bond = car.holdings.find((row) => row.productId === "p-govt");
    expect(bond?.units).toBe(3000);
    // A BTP is quoted per 100: the unit price and the PMC are per unit.
    expect(bond?.price).toBeLessThan(2);
    expect(bond?.pmc).toBeCloseTo((2955 + 5.61) / 3000, 8);
    for (const row of car.holdings) {
      expect(row.gain).toBeCloseTo((row.value ?? 0) - row.units * row.pmc, 6);
      expect(row.taxIfSold).not.toBeNull();
    }
    const rowTaxes = car.holdings.reduce((sum, row) => sum + (row.taxIfSold ?? 0), 0);
    expect(car.taxIfSoldTotal).not.toBeNull();
    // The bucket's zainetto credit lowers the total, and only the total.
    expect(car.taxIfSoldTotal ?? Number.NaN).toBeLessThanOrEqual(rowTaxes);
  });

  it("builds the value and money put in series up to the valuation month", async () => {
    await loadSample();
    const car = await detail("g-car");
    expect(car.series[0]?.month).toBe("2026-01");
    expect(car.series.at(-1)?.month).toBe("2026-10");
    // 4000 + 2083.95 + 2960.61 - 1177.05 + 1502.95: the sell is negative, commissions are added.
    expect(car.series.at(-1)?.moneyIn).toBeCloseTo(9_370.46, 2);
    expect(car.series.at(-1)?.value).toBeCloseTo(car.value, 6);
    expect(car.series[0]?.moneyIn).toBeCloseTo(4_000, 6);
  });

  it("shows the net as unavailable when the pension plan has no first year", async () => {
    await loadSample();
    sql("DELETE FROM document WHERE kind = 'pensionPlan'");
    const retirement = await detail("g-retirement");
    expect(retirement.projection).toBeNull();
    expect(retirement.projectionNote).toContain("first year");
    expect(retirement.taxIfSoldTotal).toBeNull();
    expect(retirement.holdings.every((row) => row.taxIfSold === null)).toBe(true);
    expect(retirement.value).toBeGreaterThan(0);
  });

  it("does not guess a missing price: the holding and the projection are unavailable", async () => {
    await loadSample();
    sql("DELETE FROM price_point WHERE product_id = 'p-direct'");
    const car = await detail("g-car");
    const direct = car.holdings.find((row) => row.productId === "p-direct");
    expect(direct).toMatchObject({ price: null, value: null, gain: null, taxIfSold: null });
    expect(car).toMatchObject({ missingPrices: true, projection: null, taxIfSoldTotal: null });
    expect(car.series.at(-1)?.value).toBeNull();
  });

  it("answers 404 for an unknown goal", async () => {
    expect((await call("GET", "/api/goal-detail?id=nope")).status).toBe(404);
  });
});
