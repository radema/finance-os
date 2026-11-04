// A test-only generator: the synthetic sample stretched to 5 years of monthly data, for the Overview
// speed check (AC-77). Same products, goals, allocation and pension plan as `fixtures/sample.json`
// (every name is "Sample ...", every ISIN is "ZZ..."), with a month-end price for every product and
// a ledger row per goal and month. Deterministic: no random numbers.
import type { SampleData } from "../engine/fixture.ts";
import { sampleDataSchema } from "../engine/fixture.ts";
import { addMonths, monthEnd } from "../engine/months.ts";
import sampleJson from "../fixtures/sample.json" with { type: "json" };

const sample = sampleDataSchema.parse(sampleJson);
export const FIXTURE_FIRST_MONTH = "2021-11";
export const FIXTURE_MONTHS = 60;

/** The price of month `index` (0 = the first month): a yearly drift and a wave of 3% around it. */
const priceAt = (start: number, yearlyDrift: number, wave: number, index: number): number =>
  Math.round(
    start * (1 + yearlyDrift) ** (index / 12) * (1 + wave * Math.sin(index * 0.9)) * 10_000,
  ) / 10_000;

const PRICE_START: Record<string, { start: number; drift: number; wave: number }> = {
  "p-world-etf": { start: 80, drift: 0.06, wave: 0.03 },
  "p-mixed-etf": { start: 85, drift: 0.04, wave: 0.02 },
  "p-direct": { start: 40, drift: 0.07, wave: 0.04 },
  "p-govt": { start: 97, drift: 0.005, wave: 0.004 },
  "p-deposit": { start: 1, drift: 0, wave: 0 },
  "p-pension-balanced": { start: 12, drift: 0.04, wave: 0.01 },
  "p-pension-equity": { start: 10, drift: 0.06, wave: 0.02 },
};

/** The monthly buy of each goal: product and units (the cash of the plan at the start price). */
const MONTHLY_BUY: Record<string, { productId: string; units: number }> = {
  "g-holiday": { productId: "p-deposit", units: 100 },
  "g-car": { productId: "p-world-etf", units: 5 },
  "g-home": { productId: "p-mixed-etf", units: 7 },
};

/** The synthetic fixture with 60 monthly closes, 2021-11 to 2026-10, and a ledger row per goal and month. */
export function monthlySample(): SampleData {
  const months = Array.from({ length: FIXTURE_MONTHS }, (_, i) =>
    addMonths(FIXTURE_FIRST_MONTH, i),
  );
  const price = (productId: string, index: number) => {
    const { start, drift, wave } = PRICE_START[productId] as (typeof PRICE_START)[string];
    return priceAt(start, drift, wave, index);
  };

  const prices = sample.products.flatMap(({ id }) =>
    months.map((month, index) => ({
      productId: id,
      month,
      price: price(id, index),
      priceDate: monthEnd(month),
    })),
  );

  const openings = sample.ledger
    .filter((row) => row.type === "opening")
    .map((row) => ({
      ...row,
      date: `${FIXTURE_FIRST_MONTH}-02`,
      price: price(row.productId, 0),
    }));
  const monthly = months.slice(1).flatMap((month, offset) => {
    const index = offset + 1;
    const buys = Object.entries(MONTHLY_BUY).map(([goalId, { productId, units }]) => ({
      date: `${month}-05`,
      goalId,
      productId,
      type: "buy" as const,
      qty: units,
      price: price(productId, index),
      commission: productId === "p-deposit" ? 0 : 2.95,
    }));
    const pension = {
      date: `${month}-15`,
      goalId: "g-retirement",
      productId: "p-pension-balanced",
      type: "pensionContribution" as const,
      flow: "Work" as const,
      qty: 25,
      price: price("p-pension-balanced", index),
    };
    const voluntary = month.endsWith("-10")
      ? [
          {
            ...pension,
            date: `${month}-20`,
            productId: "p-pension-equity",
            flow: "Voluntary" as const,
            qty: 50,
            price: price("p-pension-equity", index),
          },
        ]
      : [];
    return [...buys, pension, ...voluntary];
  });

  const data = {
    ...sample,
    settings: { ...sample.settings, trackingStart: FIXTURE_FIRST_MONTH },
    prices,
    goals: sample.goals.map((goal) => ({
      ...goal,
      plan: goal.plan.map((version, index) =>
        index === 0 ? { ...version, fromMonth: FIXTURE_FIRST_MONTH } : version,
      ),
    })),
    ledger: [...openings, ...monthly],
  };
  return sampleDataSchema.parse(data);
}
