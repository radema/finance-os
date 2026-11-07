import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndependenceView } from "../engine/independenceView.ts";
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

// Essential 1,000 and optional 500 euros a month, with the default multipliers and 12 months of
// essential expenses: Level 1 = 12 x 1,000, Level 2 = 200 x 1,000, Level 3 = 300 x 1,000, Level 4 = 300,000 + 200 x 500 (AC-59).
const EXPENSES = { essentialCents: 100_000, optionalCents: 50_000 };

describe("Independence API (AC-62)", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-independence-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T = IndependenceView>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const read = async () => (await call("GET", "/api/independence")).body;
  const loadSample = () => call("POST", "/api/sample-data");
  const sql = (statement: string) => {
    const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
    database.exec(statement);
    database.close();
  };

  it("returns the default settings and no result on an empty folder", async () => {
    const view = await read();
    expect(view.fire).toEqual({
      efFromGoal: null,
      efMonths: 12,
      baristaMult: 200,
      l2Mult: 300,
      l3Mult: 200,
      includePension: true,
    });
    expect(view.expenses).toMatchObject({ essentialCents: 0, optionalCents: 0 });
    expect(view.goals).toEqual([]);
    expect(view.result).toBeNull();
  });

  it("reads a settings row saved without baristaMult as 200 (AC-59)", async () => {
    sql(
      `INSERT INTO document VALUES ('fiSettings', '${JSON.stringify({ efFromGoal: null, efMonths: 12, l2Mult: 250, l3Mult: 100, includePension: true })}')`,
    );
    expect((await read()).fire).toEqual({
      efFromGoal: null,
      efMonths: 12,
      baristaMult: 200,
      l2Mult: 250,
      l3Mult: 100,
      includePension: true,
    });
  });

  it("lists the goals with their ticks, and the 42-point projection, on the sample data", async () => {
    await loadSample();
    const view = await read();
    expect(view.goals.map((goal) => [goal.name, goal.countsTowardFi, goal.isPension])).toEqual([
      ["Holiday", false, false],
      ["New car", false, false],
      ["Home deposit", false, false],
      ["Retirement", true, true],
    ]);
    expect(view.result?.points).toHaveLength(42);
    // Only the pension goal counts: Level 1 reads the wealth without the pension, so it is 0.
    expect(view.result?.wealthToday.nonPension).toBe(0);
    expect(view.result?.wealthToday.pension).toBeGreaterThan(0);
  });

  it("shows non-zero level targets on the sample data, from its made-up expenses (AC-89)", async () => {
    await loadSample();
    const view = await read();
    expect(view.expenses.essentialCents).toBeGreaterThan(0);
    expect(view.result?.levels.every((level) => level > 0)).toBe(true);
  });

  it("saves the expense split and returns the levels of AC-59, flat when expenseGrowth is 0", async () => {
    await loadSample();
    await call("PUT", "/api/cash-flow", {
      income: 0,
      incomeGrowth: 0,
      expenseGrowth: 0,
      essential: 0,
      optional: 0,
      events: [],
    });
    const saved = await call("PUT", "/api/independence/expenses", EXPENSES);
    expect(saved.status).toBe(200);
    expect(saved.body.result?.levels).toEqual([12_000, 200_000, 300_000, 400_000]);
    const targets = saved.body.result?.points.map((point) => point.targets);
    for (const row of targets ?? []) {
      expect(row[0]).toBeCloseTo(12_000, 6);
      expect(row[1]).toBeCloseTo(200_000, 6);
      expect(row[2]).toBeCloseTo(300_000, 6);
      expect(row[3]).toBeCloseTo(400_000, 6);
    }
    // Round trip: a new read gives the same split, and the Cash flow document holds it.
    expect((await read()).expenses).toMatchObject(EXPENSES);
    const cashFlow = await call<{ cashFlow: { essential: number; optional: number } }>(
      "GET",
      "/api/cash-flow",
    );
    expect(cashFlow.body.cashFlow).toMatchObject({ essential: 100_000, optional: 50_000 });
  });

  it("keeps the other fields of the Cash flow document when it saves the split", async () => {
    await loadSample();
    const document = {
      income: 3_600_000,
      incomeGrowth: 0.02,
      essential: 1,
      optional: 2,
      expenseGrowth: 0.03,
      events: [{ year: 2027, label: "boiler", amount: -60_000 }],
    };
    await call("PUT", "/api/cash-flow", document);
    await call("PUT", "/api/independence/expenses", EXPENSES);
    const { body } = await call<{ cashFlow: unknown }>("GET", "/api/cash-flow");
    expect(body.cashFlow).toEqual({ ...document, ...{ essential: 100_000, optional: 50_000 } });
  });

  it("changes the levels when a multiplier changes, and stores the settings", async () => {
    await loadSample();
    await call("PUT", "/api/independence/expenses", EXPENSES);
    const defaults = await read();
    const changed = await call("PUT", "/api/independence/settings", {
      ...defaults.fire,
      l2Mult: 250,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.result?.levels).toEqual([12_000, 200_000, 250_000, 350_000]);
    expect((await read()).fire.l2Mult).toBe(250);

    const barista = await call("PUT", "/api/independence/settings", { baristaMult: 150 });
    expect(barista.body.result?.levels).toEqual([12_000, 150_000, 250_000, 350_000]);

    const months = await call("PUT", "/api/independence/settings", {
      ...defaults.fire,
      efMonths: 6,
    });
    expect(months.body.result?.levels[0]).toBe(6_000);
  });

  it("takes Level 1 from a goal's target when efFromGoal is set", async () => {
    await loadSample();
    const home = await call("PUT", "/api/independence/settings", {
      efFromGoal: "g-home",
      efMonths: 12,
      baristaMult: 200,
      l2Mult: 300,
      l3Mult: 200,
      includePension: true,
    });
    // The Home deposit target is 40,000 euros; the goal does not have to count toward FI.
    expect(home.body.result?.levels[0]).toBe(40_000);
  });

  it("refuses bad settings with 400", async () => {
    await loadSample();
    const base = (await read()).fire;
    expect((await call("PUT", "/api/independence/settings", { ...base, l2Mult: -1 })).status).toBe(
      400,
    );
    expect(
      (await call("PUT", "/api/independence/settings", { ...base, efMonths: -3 })).status,
    ).toBe(400);
    const missing = await call("PUT", "/api/independence/settings", {
      ...base,
      efFromGoal: "g-nothing",
    });
    expect(missing.status).toBe(400);
    expect((await read()).fire).toEqual(base);
    const expenses = await call("PUT", "/api/independence/expenses", {
      essentialCents: -1,
      optionalCents: 0,
    });
    expect(expenses.status).toBe(400);
  });

  it("removes the pension from the wealth when includePension is off (AC-60)", async () => {
    await loadSample();
    const on = await read();
    const off = await call("PUT", "/api/independence/settings", {
      ...on.fire,
      includePension: false,
    });
    expect(off.body.result?.wealthToday.pension).toBe(0);
    expect(off.body.result?.wealthToday.total).toBe(0);
    expect(on.result?.wealthToday.total).toBeGreaterThan(0);
  });

  it("splits today's wealth by goal and the parts add up to the total (AC-60)", async () => {
    await loadSample();
    await call("PUT", "/api/independence/counts", { id: "g-home", countsTowardFi: true });
    const view = await read();
    const home = view.goals.find((goal) => goal.id === "g-home");
    const pension = view.goals.find((goal) => goal.isPension);
    // Home deposit holds 18,000 euros of ETF and cash with no gain, so no tax: 18,000 net.
    expect(home?.today).toBeCloseTo(18_000, 6);
    expect(pension?.today).toBeCloseTo(view.result?.wealthToday.pension ?? Number.NaN, 6);
    const sum = view.goals.reduce((total, goal) => total + goal.today, 0);
    expect(sum).toBeCloseTo(view.result?.wealthToday.total ?? Number.NaN, 6);
    expect(view.result?.wealthToday.nonPension).toBeCloseTo(18_000, 6);
  });

  it("updates countsTowardFi on the goal and nothing else (AC-60)", async () => {
    await loadSample();
    const before = await call<{ id: string; minProb: number | null; name: string }[]>(
      "GET",
      "/api/goals",
    );
    const off = await call("PUT", "/api/independence/counts", {
      id: "g-retirement",
      countsTowardFi: false,
    });
    expect(off.status).toBe(200);
    expect(off.body.goals.find((goal) => goal.id === "g-retirement")?.countsTowardFi).toBe(false);
    expect(off.body.result?.wealthToday.total).toBe(0);
    const after = await call<{ id: string; minProb: number | null; name: string }[]>(
      "GET",
      "/api/goals",
    );
    expect(after.body.map(({ id, name, minProb }) => ({ id, name, minProb }))).toEqual(
      before.body.map(({ id, name, minProb }) => ({ id, name, minProb })),
    );
    expect(
      (await call("PUT", "/api/independence/counts", { id: "nope", countsTowardFi: true })).status,
    ).toBe(404);
  });

  it("answers 200 with a note when the pension plan has no first year", async () => {
    await loadSample();
    sql(`UPDATE document SET value = '{"goalId":"g-retirement"}' WHERE kind = 'pensionPlan'`);
    const { status, body } = await call("GET", "/api/independence");
    expect(status).toBe(200);
    expect(body.result).toBeNull();
    expect(body.note).toMatch(/first year/);
  });

  it("projects a ticked non-pension goal that is weighted to a pension product (no 500)", async () => {
    await loadSample();
    sql(
      "INSERT INTO allocation_weight (goal_id, product_id, weight) VALUES ('g-home', 'p-pension-equity', 1)",
    );
    await call("PUT", "/api/independence/counts", { id: "g-home", countsTowardFi: true });
    const { status, body } = await call("GET", "/api/independence");
    expect(status).toBe(200);
    expect(body.result?.points).toHaveLength(42);
    // The goal's net today is still the 18,000 of its holdings: the pension weight holds no value.
    expect(body.goals.find((goal) => goal.id === "g-home")?.today).toBeCloseTo(18_000, 6);
  });

  it("does not reset the stored settings when the PUT body is partial", async () => {
    await loadSample();
    const stored = {
      efFromGoal: "g-home",
      efMonths: 6,
      baristaMult: 150,
      l2Mult: 250,
      l3Mult: 100,
      includePension: false,
    };
    await call("PUT", "/api/independence/settings", stored);
    const partial = await call("PUT", "/api/independence/settings", { l2Mult: 200 });
    expect(partial.status).toBe(200);
    expect(partial.body.fire).toEqual({ ...stored, l2Mult: 200 });
    expect((await read()).fire).toEqual({ ...stored, l2Mult: 200 });
    const empty = await call("PUT", "/api/independence/settings", {});
    expect(empty.body.fire).toEqual({ ...stored, l2Mult: 200 });
  });

  it("is the same on two reads: the seed and the path count come from Settings", async () => {
    await loadSample();
    await call("PUT", "/api/independence/expenses", EXPENSES);
    expect((await read()).result).toEqual((await read()).result);
  });
});
