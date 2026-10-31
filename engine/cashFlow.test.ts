import { describe, expect, it } from "vitest";
import { projectCashFlow } from "./cashFlow.ts";
import { pensionSchedule } from "./pension.ts";
import { cashFlowSchema, pensionPlanSchema } from "./schemas.ts";

// Money is in cents: a hand value in euros is written as `eur * 100`.
const eur = (euros: number) => euros * 100;

// asOf 2026-10-31: r = 2 months left, f = 2/12.
const asOf = "2026-10-31";

// Income 36,000 growing 10%; expenses 12 x (1,000 + 500) growing 5%.
// Events: +900 in 2026 and -600 in 2027.
const cashFlow = cashFlowSchema.parse({
  income: eur(36_000),
  incomeGrowth: 0.1,
  essential: eur(1_000),
  optional: eur(500),
  expenseGrowth: 0.05,
  events: [
    { year: 2026, label: "bonus", amount: eur(900) },
    { year: 2027, label: "boiler", amount: -eur(600) },
  ],
});

// RAL 30,000 flat, worker 1%, employer 1%, voluntary 1,200, marginal 35%, cap 5,300 + extra 2,650.
// Voluntary YTD 300, so the tax year of Y0 holds 300 + 1,200 x 2/12 = 500, all inside the room
// (7,950 - 300 - 300). Refund of 2026 = 500 x 35% = 175; of every later year 1,200 x 35% = 420.
// The goal is due 2027 (AC-96): the schedule's rows after 2027 pay no refund, so 2028 is the last.
const plan = pensionPlanSchema.parse({
  goalId: "g-pension",
  firstYear: 2020,
  ral: eur(30_000),
  workerPct: 0.01,
  employerPct: 0.01,
  voluntary: eur(1_200),
  marginalRate: 0.35,
  extra: eur(2_650),
});
const schedule = pensionSchedule(
  plan,
  { pensionDeductionCapCents: eur(5_300) },
  asOf,
  eur(300),
  10,
);

// g-etf: 100 a month, contribution growth 10%, due 2028. The pension goal is due 2027 and carries
// a plan amount that must be ignored: only its schedule's voluntary part counts.
const goals = [
  { id: "g-etf", targetYear: 2028, contributionGrowth: 0.1, monthly: eur(100) },
  { id: "g-pension", targetYear: 2027, contributionGrowth: 0, monthly: eur(9_999) },
];

describe("projectCashFlow (AC-48), asOf 2026-10-31", () => {
  const rows = projectCashFlow({
    asOf,
    cashFlow,
    goals,
    pension: { goalId: "g-pension", schedule },
  });

  it("returns 10 rows from Y0, the first labelled rest of year", () => {
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.year)).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035,
    ]);
    expect(rows.map((row) => row.label).slice(0, 3)).toEqual(["rest of year", "2027", "2028"]);
  });

  it("scales income, expenses and contributions by 2/12 in 2026 and keeps events whole", () => {
    // Income 360,000 / 6; expenses 18,000 / 6; events 900 whole; no refund arrives in Y0.
    // Planned: g-etf 2 x 100 + pension voluntary 1,200 x 2/12 = 200 + 200.
    expect(rows[0]).toMatchObject({
      income: eur(6_000),
      expenses: eur(3_000),
      events: eur(900),
      refund: 0,
      capacity: eur(6_000) - eur(3_000) + eur(900),
      planned: eur(400),
    });
    expect(rows[0]?.gap).toBe(eur(6_000) - eur(3_000) + eur(900) - eur(400));
  });

  it("pays the 2026 refund whole in 2027: it is not scaled by f", () => {
    expect(rows[1]?.refund).toBe(eur(175));
    expect(rows[2]?.refund).toBe(eur(420));
  });

  it("pays the last refund in targetYear + 1 and none after the pension goal (AC-96)", () => {
    // The goal is due 2027: its last schedule row is 2027, refunded in 2028. Rows from 2029 show 0.
    expect(rows.slice(3).map((row) => row.refund)).toEqual(new Array(7).fill(0));
  });

  it("grows income and expenses by (1 + g)^(year - Y0), as the mock does", () => {
    // 2027: income 36,000 x 1.1 = 39,600; expenses 18,000 x 1.05 = 18,900.
    // Capacity = 39,600 - 18,900 - 600 + 175. Planned: g-etf 12 x 100 + pension 1,200.
    expect(rows[1]?.income).toBeCloseTo(eur(39_600), 6);
    expect(rows[1]?.events).toBe(-eur(600));
    expect(rows[1]?.capacity).toBeCloseTo(eur(39_600) - eur(18_900) - eur(600) + eur(175), 6);
    expect(rows[1]?.planned).toBe(eur(1_200) + eur(1_200));
    expect(rows[1]?.expenses).toBeCloseTo(eur(18_900), 6);
    // 2029: income 36,000 x 1.1^3 = 47,916; expenses 18,000 x 1.05^3 = 20,837.25.
    expect(rows[3]?.income).toBeCloseTo(eur(47_916), 6);
    expect(rows[3]?.expenses).toBeCloseTo(eur(20_837.25), 6);
  });

  it("counts a goal's contributions through its target year and not after", () => {
    // g-etf, due 2028: 2028 holds 12 x 100 x 1.1 (k = 1 for 2027 has no growth, as in projectGoal).
    expect(rows[2]?.planned).toBeCloseTo(eur(1_320), 6);
    // The pension goal, due 2027, stops after 2027; g-etf stops after 2028.
    expect(rows[3]?.planned).toBe(0);
    expect(rows[9]?.planned).toBe(0);
  });

  it("counts only the voluntary part of the pension goal, not its plan amount", () => {
    const pensionOnly = projectCashFlow({
      asOf,
      cashFlow,
      goals: [goals[1] as (typeof goals)[number]],
      pension: { goalId: "g-pension", schedule },
    });
    expect(pensionOnly[0]?.planned).toBeCloseTo(eur(200), 6);
    expect(pensionOnly[1]?.planned).toBe(eur(1_200));
  });
});

describe("projectCashFlow with voluntary to cap (AC-97)", () => {
  it("plans the Y0 stub as the rest of the room, not scaled by f", () => {
    // Worker + employer 600, limit 7,950, room 7,350, voluntary YTD 300: stub 7,050.
    const toCap = pensionSchedule(
      pensionPlanSchema.parse({ ...plan, voluntary: null }),
      { pensionDeductionCapCents: eur(5_300) },
      asOf,
      eur(300),
      10,
    );
    const rows = projectCashFlow({
      asOf,
      cashFlow,
      goals: [goals[1] as (typeof goals)[number]],
      pension: { goalId: "g-pension", schedule: toCap },
    });
    expect(rows[0]?.planned).toBeCloseTo(eur(7_050), 6);
    expect(rows[1]?.planned).toBeCloseTo(eur(7_350), 6);
  });
});

describe("projectCashFlow edge cases", () => {
  it("gives no pension planned amount and no refund when the plan has no schedule", () => {
    const rows = projectCashFlow({
      asOf,
      cashFlow,
      goals: [goals[1] as (typeof goals)[number]],
      pension: { goalId: "g-pension", schedule: [] },
    });
    expect(rows.every((row) => row.planned === 0 && row.refund === 0)).toBe(true);
  });

  it("makes the first row empty of income and contributions when asOf is in December", () => {
    const [first] = projectCashFlow({ asOf: "2026-12-31", cashFlow, goals });
    expect(first).toMatchObject({ income: 0, expenses: 0, planned: 0, events: eur(900) });
  });

  it("skips a goal that was due before Y0", () => {
    const [first] = projectCashFlow({
      asOf,
      cashFlow,
      goals: [{ id: "old", targetYear: 2025, contributionGrowth: 0, monthly: eur(100) }],
    });
    expect(first?.planned).toBe(0);
  });
});
