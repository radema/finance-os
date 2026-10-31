import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CashFlowView, projectCashFlow } from "../engine/cashFlow.ts";
import { pensionSchedule } from "../engine/pension.ts";
import { cashFlowSchema, pensionPlanSchema } from "../engine/schemas.ts";
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const document = {
  income: 3_600_000,
  incomeGrowth: 0.02,
  essential: 97_500,
  optional: 30_000,
  expenseGrowth: 0.02,
  events: [{ year: 2027, label: "boiler", amount: -60_000 }],
};

// A plan with the goal and the first year only: no RAL, so no schedule.
const partialPlan = { goalId: "g-retirement", firstYear: 2020 };

// This one has a schedule, and flows that make p-pension-equity the voluntary product.
const fullPlan = {
  goalId: "g-retirement",
  firstYear: 2020,
  ral: 3_000_000,
  workerPct: 0.01,
  employerPct: 0.01,
  voluntary: 120_000,
  marginalRate: 0.35,
  flows: [
    { productId: "p-pension-balanced", flow: "Work", pct: 1 },
    { productId: "p-pension-equity", flow: "Voluntary", pct: 1 },
  ],
};

describe("Cash flow API (AC-50)", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-cash-flow-"));
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
  const read = async () => (await call<CashFlowView>("GET", "/api/cash-flow")).body;
  const sql = (statement: string) => {
    const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
    database.exec(statement);
    database.close();
  };

  it("returns an empty document and 10 empty rows when nothing is saved", async () => {
    const view = await read();
    expect(view.asOf).toBe("2026-10-31");
    expect(view.cashFlow).toEqual(cashFlowSchema.parse({}));
    expect(view.rows).toHaveLength(10);
    expect(view.rows[0]).toMatchObject({ year: 2026, label: "rest of year", capacity: 0 });
    expect(view.rows.every((row) => row.planned === 0)).toBe(true);
  });

  it("saves the document and returns it with the engine's rows", async () => {
    await call("POST", "/api/sample-data");
    sql(`UPDATE document SET value = '${JSON.stringify(partialPlan)}' WHERE kind = 'pensionPlan'`);
    const saved = await call<CashFlowView>("PUT", "/api/cash-flow", document);
    expect(saved.status).toBe(200);
    expect(saved.body.cashFlow).toEqual(document);
    expect((await read()).cashFlow).toEqual(document);

    // Oracle: the engine on the fixture's goals at asOf 2026-10-31. Plans in force in October:
    // holiday 100, car 450, home 600, retirement 350 (a pension goal: schedule only, and this
    // plan has no RAL, so no schedule).
    const expected = projectCashFlow({
      asOf: "2026-10-31",
      cashFlow: document,
      goals: [
        { id: "g-holiday", targetYear: 2026, contributionGrowth: 0, monthly: 10_000 },
        { id: "g-car", targetYear: 2029, contributionGrowth: 0.02, monthly: 45_000 },
        { id: "g-home", targetYear: 2031, contributionGrowth: 0.02, monthly: 60_000 },
        { id: "g-retirement", targetYear: 2046, contributionGrowth: 0.02, monthly: 35_000 },
      ],
      pension: { goalId: "g-retirement", schedule: [] },
    });
    const rows = (await read()).rows;
    expect(rows).toEqual(expected);
    // 2026: holiday 2 x 100 + car 2 x 450 + home 2 x 600; retirement's plan amount is not counted.
    expect(rows[0]?.planned).toBeCloseTo(230_000, 6);
  });

  it("uses the voluntary YTD of Voluntary products for the refund, and the schedule for planned", async () => {
    await call("POST", "/api/sample-data");
    sql(`UPDATE document SET value = '${JSON.stringify(fullPlan)}' WHERE kind = 'pensionPlan'`);
    await call("PUT", "/api/cash-flow", document);
    // The fixture has 60 x 15.10 = 906 on the balanced fund (Work) and 50 x 13 = 650 on the equity
    // fund (Voluntary), both in 2026: only the 650 is voluntary YTD.
    const schedule = pensionSchedule(
      pensionPlanSchema.parse(fullPlan),
      { pensionDeductionCapCents: 530_000 },
      "2026-10-31",
      65_000,
      10,
    );
    const { rows } = await read();
    expect(rows[1]?.refund).toBe(schedule[0]?.refund);
    // Tax year of 2026: 650 + 1,200 x 2/12 = 850; refund 850 x 35% = 297.50.
    expect(rows[1]?.refund).toBeCloseTo(29_750, 6);
    expect(rows[0]?.planned).toBeGreaterThan(0);
  });

  it("refuses a bad document", async () => {
    expect((await call("PUT", "/api/cash-flow", { ...document, essential: -1 })).status).toBe(400);
    expect((await call("PUT", "/api/cash-flow", { ...document, incomeGrowth: -1 })).status).toBe(
      400,
    );
    expect(
      (await call("PUT", "/api/cash-flow", { ...document, events: [{ year: 2027 }] })).status,
    ).toBe(400);
  });
});
