import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleDataSchema } from "../engine/fixture.ts";
import type { GoalDetailView, GoalListView } from "../engine/goalViews.ts";
import { holdingsAt, unitPrice } from "../engine/holdings.ts";
import { planInForce } from "../engine/plan.ts";
import type { ProductParams } from "../engine/projection.ts";
import { projectGoal } from "../engine/projection.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const sample = sampleDataSchema.parse(sampleJson);

/** The engine run on the fixture, built here without the server: the oracle for the detail. */
function engineNet(goalId: string, monthlyOverride?: number) {
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
    monthly:
      monthlyOverride ??
      planInForce(
        goal.plan.map(({ fromMonth, monthlyCents }) => ({
          fromMonth,
          monthly: monthlyCents / 100,
        })),
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
    // The Equity fund is the only one with a Voluntary flow: 50 units x 13 euros this year.
    pension:
      sample.pensionPlan.goalId === goalId
        ? {
            plan: sample.pensionPlan,
            deductionCapCents: sample.settings.pensionDeductionCapCents,
            voluntaryYtd: 65_000,
          }
        : undefined,
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
    (await call<GoalDetailView>("GET", `/api/goal-detail?id=${id}`)).body;
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
    expect(view.goals.map((goal) => goal.slot)).toEqual([2, 3, 4, 5]);
    const home = view.goals[2];
    expect(home).toMatchObject({ priority: "Need", target: 40_000, missingPrices: false });
    expect(home?.value).toBeCloseTo(18_000, 6);
    expect(Object.keys(home ?? {}).sort()).toEqual(
      ["id", "missingPrices", "name", "outlook", "priority", "slot", "target", "value"].sort(),
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

  describe("Monte Carlo analysis", () => {
    // The spec's required probabilities: Need 90%, Want 75%, Wish 50%. Status band: 15 points (AC-58).
    const requiredByGoal = { "g-holiday": 0.75, "g-car": 0.75, "g-home": 0.9, "g-retirement": 0.9 };
    const statusOf = (p: number, required: number) => {
      if (p >= required) return "on_track";
      return required - p <= 0.15 + 1e-9 ? "at_risk" : "off_track";
    };

    it("shows status and P against the required probability for each goal of the list", async () => {
      await loadSample();
      const { goals } = await list();
      expect(goals).toHaveLength(4);
      for (const goal of goals) {
        const outlook = goal.outlook;
        expect(outlook).not.toBeNull();
        expect(outlook?.requiredP).toBe(requiredByGoal[goal.id as keyof typeof requiredByGoal]);
        expect(outlook?.pSuccess).toBeGreaterThanOrEqual(0);
        expect(outlook?.pSuccess).toBeLessThanOrEqual(1);
        expect(outlook?.status).toBe(statusOf(outlook?.pSuccess ?? 0, outlook?.requiredP ?? 0));
      }
    });

    it("has the same P in the list and in the detail, and the same twice (seeded)", async () => {
      await loadSample();
      const { goals } = await list();
      for (const goal of goals) {
        const analysis = (await detail(goal.id)).analysis;
        expect(analysis?.pSuccess).toBe(goal.outlook?.pSuccess);
      }
      expect(await list()).toEqual(await list());
    });

    it("gives the fan, the range and the horizon in the detail", async () => {
      await loadSample();
      const car = (await detail("g-car")).analysis;
      // Valuation 2026-10-31 (2 months left in 2026), goal date 31 December 2029: 2/12 + 3 years.
      expect(car?.horizonYears).toBeCloseTo(2 / 12 + 3, 10);
      expect(car?.fan.map((point) => point.year)).toEqual([2026, 2027, 2028, 2029]);
      expect(car?.paths).toBe(1000);
      expect(car?.seed).toBe(42);
      // 20,000 today's euros grown by 2% for 3 and 2/12 years.
      expect(car?.targetAtGoalDate).toBeCloseTo(20_000 * 1.02 ** (38 / 12), 6);
      expect(car?.range.target).toBe(car?.targetAtGoalDate);
      expect(car?.range.bad).toBeLessThanOrEqual(car?.range.typical ?? 0);
      expect(car?.range.typical).toBeLessThanOrEqual(car?.range.good ?? 0);
      expect(car?.range).toMatchObject({
        bad: car?.fan.at(-1)?.bad,
        typical: car?.fan.at(-1)?.typical,
        good: car?.fan.at(-1)?.good,
      });
    });

    it("gives a goal due this year a single point", async () => {
      await loadSample();
      const holiday = (await detail("g-holiday")).analysis;
      expect(holiday?.fan.map((point) => point.year)).toEqual([2026]);
    });

    it("finds the monthly amount that reaches the target, and not one cent less (AC-57)", async () => {
      await loadSample();
      const car = (await detail("g-car")).analysis;
      expect(car?.required.unit).toBe("monthly");
      expect(car?.required.currentMonthly).toBe(450);
      const amount = car?.required.deterministic ?? Number.NaN;
      const target = engineNet("g-car").targetAtGoalDate;
      expect(engineNet("g-car", amount).net).toBeGreaterThanOrEqual(target);
      expect(engineNet("g-car", amount - 0.02).net).toBeLessThan(target);
      // 75% sits above the median, so the probability amount is not below the deterministic one.
      expect(car?.required.probability ?? Number.NaN).toBeGreaterThanOrEqual(amount);
    });

    it("keeps the plan in force at the valuation month when a newer version starts later (#86)", async () => {
      await loadSample();
      sql(
        "INSERT INTO contribution_plan (goal_id, from_month, monthly_cents) VALUES ('g-car', '2026-12', 99900)",
      );
      expect((await list()).asOf).toBe("2026-10-31");
      expect((await detail("g-car")).analysis?.required.currentMonthly).toBe(450);
    });

    it("gives the pension goal's required contribution as a multiplier of its schedule", async () => {
      await loadSample();
      const retirement = (await detail("g-retirement")).analysis;
      expect(retirement?.required.unit).toBe("schedule");
      expect(retirement?.required.currentMonthly).toBeNull();
    });

    it("gives null for a target that cannot be reached", async () => {
      await loadSample();
      sql("UPDATE goal SET target_cents = 100000000000000 WHERE id = 'g-car'");
      const car = (await detail("g-car")).analysis;
      expect(car?.required).toMatchObject({ deterministic: null, probability: null });
      expect(car?.status).toBe("off_track");
    });

    it("has no analysis when a price is missing, in the list and in the detail", async () => {
      await loadSample();
      sql("DELETE FROM price_point WHERE product_id = 'p-direct'");
      expect((await detail("g-car")).analysis).toBeNull();
      expect((await list()).goals.find((goal) => goal.id === "g-car")?.outlook).toBeNull();
    });
  });
});
