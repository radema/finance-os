import fc from "fast-check";
import type { LedgerRow, Regime } from "../../engine/index.ts";

export type ScenarioProduct = {
  id: string;
  regime: Regime;
  mu: number;
  ter: number;
  whiteListShare: number;
  /** Price per unit at asOf. Ledger rows carry their own prices. */
  price: number;
};

export type ScenarioGoal = {
  id: string;
  targetYear: number;
  /** In today's euros. */
  target: number;
  /** The plain monthly contribution. */
  monthly: number;
  /** Contribution weights by product id, in any scale. */
  weights: Record<string, number>;
};

/** One random input for both engines, in the shared domain of the differential test. */
export type Scenario = {
  /** A day of December, so r = 0. */
  asOf: string;
  settings: {
    inflation: number;
    bollo: number;
    taxStd: number;
    taxGovt: number;
    pensionTax: number;
  };
  /** Loss carried forward; the expiry is the 31 December of `expiryYear`. */
  zainetto?: { amount: number; expiryYear: number; goalId: string };
  /** Year the pension membership started. */
  firstYear: number;
  products: ScenarioProduct[];
  goals: ScenarioGoal[];
  /** Opening, buy and sell rows in date order; a sell never exceeds the units held in its goal. */
  ledger: LedgerRow[];
};

const REGIMES: readonly Regime[] = ["etf", "direct", "govt", "cash", "pension"];
const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 2024;
const MAX_YEAR = 2030;
const MAX_HORIZON = 12;
const MAX_LEDGER_DAYS = 1_200;

const rate = (min: number, max: number) => fc.double({ min, max, noNaN: true });

const productArb = fc.record({
  regime: fc.constantFrom(...REGIMES),
  mu: rate(-0.05, 0.1),
  ter: rate(0, 0.03),
  whiteListShare: rate(0, 1),
  price: rate(0.5, 500),
});

const goalArb = fc.record({
  yearOffset: fc.integer({ min: -2, max: MAX_HORIZON }),
  target: rate(0, 100_000),
  monthly: rate(0, 2_000),
  weights: fc.array(rate(0, 10), { minLength: 5, maxLength: 5 }),
});

const eventArb = fc.record({
  goal: fc.nat(),
  product: fc.nat(),
  kind: fc.constantFrom("opening", "buy", "buy", "sell"),
  units: rate(0.01, 500),
  sellShare: rate(0.05, 1),
  daysBefore: fc.integer({ min: 0, max: MAX_LEDGER_DAYS }),
  price: rate(0.5, 500),
});

const isoDate = (day: number, year: number, daysBefore: number): string =>
  new Date(Date.UTC(year, 11, day) - daysBefore * MS_PER_DAY).toISOString().slice(0, 10);

/** A goal due now (targetYear before the asOf year) that holds a pension product. */
export function holdsPensionDueNow(scenario: Scenario): boolean {
  const y0 = Number(scenario.asOf.slice(0, 4));
  const pension = new Set(scenario.products.filter((p) => p.regime === "pension").map((p) => p.id));
  const dueNow = new Set(scenario.goals.filter((g) => g.targetYear < y0).map((g) => g.id));
  return scenario.ledger.some((row) => pension.has(row.productId) && dueNow.has(row.goalId));
}

/** A zainetto of a goal due now that expired in the goal year or later, but before the asOf year. */
export function zainettoExpiredBeforeAsOf(scenario: Scenario): boolean {
  const { zainetto } = scenario;
  const y0 = Number(scenario.asOf.slice(0, 4));
  const goal = scenario.goals.find((g) => g.id === zainetto?.goalId);
  return (
    zainetto !== undefined &&
    goal !== undefined &&
    goal.targetYear < y0 &&
    goal.targetYear <= zainetto.expiryYear &&
    zainetto.expiryYear < y0
  );
}

/**
 * Random scenarios in the domain where v1 and the mock must agree.
 *
 * Two cases of a goal due now are left out, because the engines read the date differently there
 * (the known gaps in differential.test.ts): a pension position, and a zainetto that expired
 * before the asOf year.
 */
export const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    year: fc.integer({ min: MIN_YEAR, max: MAX_YEAR }),
    day: fc.integer({ min: 1, max: 31 }),
    inflation: rate(0, 0.05),
    bollo: rate(0, 0.005),
    taxStd: rate(0.2, 0.3),
    taxGovt: rate(0.1, 0.15),
    pensionTax: rate(0.1, 0.25),
    products: fc.array(productArb, { minLength: 1, maxLength: 5 }),
    goals: fc.array(goalArb, { minLength: 1, maxLength: 3 }),
    zainetto: fc.option(
      fc.record({
        amount: rate(0, 20_000),
        expiryYears: fc.integer({ min: -3, max: MAX_HORIZON }),
        goal: fc.nat(),
      }),
      { nil: undefined },
    ),
    firstYear: fc.integer({ min: 1990, max: 2024 }),
    events: fc.array(eventArb, { maxLength: 25 }),
  })
  .map((raw): Scenario => {
    const products = raw.products.map((p, i) => ({ id: `p${i}`, ...p }));
    const goals = raw.goals.map((g, i) => ({
      id: `g${i}`,
      targetYear: raw.year + g.yearOffset,
      target: g.target,
      monthly: g.monthly,
      weights: Object.fromEntries(products.map((p, j) => [p.id, g.weights[j] ?? 0])),
    }));

    const dated = raw.events
      .map((e) => ({ ...e, date: isoDate(raw.day, raw.year, e.daysBefore) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const held = new Map<string, number>();
    const ledger: LedgerRow[] = [];
    for (const e of dated) {
      const goalId = `g${e.goal % goals.length}`;
      const productId = `p${e.product % products.length}`;
      const key = `${goalId}/${productId}`;
      const units = held.get(key) ?? 0;
      const sells = e.kind === "sell" && units > 0;
      const qty = sells ? -(units * e.sellShare) : e.units;
      held.set(key, units + qty);
      ledger.push({
        date: e.date,
        goalId,
        productId,
        type: sells ? "sell" : e.kind === "sell" ? "buy" : e.kind,
        qty,
        price: e.price,
      });
    }

    return {
      asOf: isoDate(raw.day, raw.year, 0),
      settings: {
        inflation: raw.inflation,
        bollo: raw.bollo,
        taxStd: raw.taxStd,
        taxGovt: raw.taxGovt,
        pensionTax: raw.pensionTax,
      },
      zainetto: raw.zainetto && {
        amount: raw.zainetto.amount,
        expiryYear: raw.year + raw.zainetto.expiryYears,
        goalId: `g${raw.zainetto.goal % goals.length}`,
      },
      firstYear: raw.firstYear,
      products,
      goals,
      ledger,
    };
  })
  .filter((scenario) => !holdsPensionDueNow(scenario) && !zainettoExpiredBeforeAsOf(scenario));
