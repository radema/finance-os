import { describe, expect, it } from "vitest";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import { type SampleData, sampleDataSchema } from "./fixture.ts";
import { holdingsAt, type LedgerRow, unitPrice } from "./holdings.ts";
import { planInForce } from "./plan.ts";
import { type GoalProjection, type ProductParams, projectGoal } from "./projection.ts";

const sample = sampleDataSchema.parse(sampleJson);
const regimeOf = new Map(sample.products.map((product) => [product.id, product.regime]));
const paramsOf = new Map<string, ProductParams>(
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
);

// The engine takes the price of one unit: a govt bond's quote is per 100.
const ledger: LedgerRow[] = sample.ledger.map((row) => ({
  ...row,
  price: unitPrice(regimeOf.get(row.productId) ?? "etf", row.price),
}));

/** The latest price of a product at or before the asOf month, per unit. */
function latestPrice(data: SampleData, productId: string): number {
  const asOfMonth = data.asOf.slice(0, 7);
  const last = data.prices
    .filter((price) => price.productId === productId && price.month <= asOfMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  if (!last) throw new Error(`no price for ${productId}`);
  return unitPrice(regimeOf.get(productId) ?? "etf", last.price);
}

const round = (value: number, places = 2) => Number(value.toFixed(places));

/** This year's pension contributions on products with a Voluntary flow, in cents. */
function voluntaryYtdCents(data: SampleData): number {
  const voluntary = new Set(
    data.pensionPlan.flows.filter((flow) => flow.flow === "Voluntary").map((f) => f.productId),
  );
  return data.ledger
    .filter(
      (row) =>
        row.type === "pensionContribution" &&
        row.date.slice(0, 4) === data.asOf.slice(0, 4) &&
        voluntary.has(row.productId),
    )
    .reduce((sum, row) => sum + Math.round(row.qty * row.price * 100), 0);
}

function project(data: SampleData, goalId: string, overrides: { zainettoExpiry?: number } = {}) {
  const goal = data.goals.find((candidate) => candidate.id === goalId);
  if (!goal) throw new Error(`no goal ${goalId}`);
  const holdings = holdingsAt(ledger, data.asOf);
  const positions = [...(holdings.units.get(goalId) ?? [])]
    .filter(([, units]) => units !== 0)
    .map(([productId, units]) => ({
      productId,
      value: units * latestPrice(data, productId),
      basis: units * (holdings.pmc.get(productId) ?? 0),
    }));
  const { zainetto } = data.settings;
  return projectGoal({
    asOf: data.asOf,
    goal: {
      id: goalId,
      targetYear: goal.targetYear,
      target: goal.targetCents / 100,
      contributionGrowth: goal.contributionGrowth,
    },
    monthly: planInForce(
      goal.plan.map(({ fromMonth, monthlyCents }) => ({ fromMonth, monthly: monthlyCents / 100 })),
      data.asOf.slice(0, 7),
    ),
    positions,
    products: paramsOf,
    weights: new Map(
      data.allocation.filter((w) => w.goalId === goalId).map((w) => [w.productId, w.weight]),
    ),
    settings: {
      ...data.settings,
      zainetto:
        zainetto.goalId === null
          ? undefined
          : {
              amount: zainetto.amountCents / 100,
              expiry: String(overrides.zainettoExpiry ?? zainetto.expiry),
              goalId: zainetto.goalId,
            },
    },
    firstYear: data.pensionPlan.goalId === goalId ? data.pensionPlan.firstYear : undefined,
    pension:
      data.pensionPlan.goalId === goalId
        ? {
            plan: data.pensionPlan,
            deductionCapCents: data.settings.pensionDeductionCapCents,
            voluntaryYtd: voluntaryYtdCents(data),
          }
        : undefined,
  });
}

const summary = (result: GoalProjection) => ({
  tau: round(result.tau, 6),
  targetAtGoalDate: round(result.targetAtGoalDate),
  gross: round(result.gross),
  tax: round(result.tax),
  net: round(result.net),
  perProduct: result.perProduct.map((p) => ({
    productId: p.productId,
    value: round(p.value),
    basis: round(p.basis),
  })),
});

describe("synthetic fixture", () => {
  it("has 7 products, 4 goals and the pinned asOf", () => {
    expect(sample.products).toHaveLength(7);
    expect(sample.goals).toHaveLength(4);
    expect(sample.asOf).toBe("2026-10-31");
    expect(new Set(sample.products.map((p) => p.regime))).toEqual(
      new Set(["etf", "direct", "govt", "cash", "pension"]),
    );
  });

  it("holds a full pension plan with round inputs and one flow per fund", () => {
    expect(sample.pensionPlan).toMatchObject({
      goalId: "g-retirement",
      firstYear: 2020,
      ral: 4_000_000,
      voluntary: null,
    });
    expect(sample.pensionPlan.flows).toEqual([
      { productId: "p-pension-balanced", flow: "Work", pct: 1 },
      { productId: "p-pension-equity", flow: "Voluntary", pct: 1 },
    ]);
    expect(voluntaryYtdCents(sample)).toBe(65_000);
  });

  it("matches the reviewed regression snapshot", () => {
    const holdings = holdingsAt(ledger, sample.asOf);
    expect({
      holdings: {
        units: Object.fromEntries(
          [...holdings.units].map(([goalId, units]) => [goalId, Object.fromEntries(units)]),
        ),
        pmc: Object.fromEntries([...holdings.pmc].map(([id, pmc]) => [id, round(pmc, 6)])),
      },
      goals: Object.fromEntries(
        sample.goals.map((goal) => [goal.id, summary(project(sample, goal.id))]),
      ),
    }).toMatchSnapshot();
  });

  // Hand check of the goal with tau < 1. Deposit 1,500 + 300 = 1,800, monthly 100, r = 2, f = 1/6.
  // g = 1.025^(1/6) = 1.0041239; cash interest is taxed at 26%: g = 1 + 0.0041239 x 0.74 = 1.0030517.
  // 1,800 x 1.0030517 = 1,805.4931; stamp duty 0.2% x 1/6 = 0.0333% takes 0.6018: 1,804.8913.
  // Plus 2 x 100 = 2,004.89. A deposit pays no exit tax. Target 3,000 x 1.02^(1/6) = 3,009.92.
  it("hand check: the Holiday goal (tau < 1)", () => {
    const result = project(sample, "g-holiday");
    expect(result.tau).toBeCloseTo(1 / 6, 10);
    expect(result.net).toBeCloseTo(2004.89, 2);
    expect(result.tax).toBe(0);
    expect(result.targetAtGoalDate).toBeCloseTo(3009.92, 2);
  });

  // Hand check of the zainetto goal: a 400 euro loss credit is 400 x 26% = 104 euros of tax. The
  // goal's direct and govt gains owe more than that, so the credit lowers the tax by exactly 104.
  // It expires in 2029, the goal year, so it applies on 31 December 2029; one year earlier it does not.
  it("hand check: the zainetto credit takes 104 off the New car tax, unless it expired", () => {
    const withCredit = project(sample, "g-car");
    const expired = project(sample, "g-car", { zainettoExpiry: 2028 });
    expect(expired.tax - withCredit.tax).toBeCloseTo(104, 6);
    expect(withCredit.gross).toBeCloseTo(expired.gross, 6);
  });

  // Hand check of the loss: 200 @ 100 + 50 @ 92 (+ 8.74 commission) cost 24,608.74; at 72 the 250
  // units are worth 18,000. The loss stays at the goal date: the goal puts no new money into the ETF.
  it("hand check: the Home deposit goal holds its ETF at a loss", () => {
    const holdings = holdingsAt(ledger, sample.asOf);
    expect(250 * (holdings.pmc.get("p-mixed-etf") ?? 0)).toBeCloseTo(24_608.74, 2);
    expect(250 * latestPrice(sample, "p-mixed-etf")).toBe(18_000);
    const position = project(sample, "g-home").perProduct.find(
      (p) => p.productId === "p-mixed-etf",
    );
    expect(position?.value).toBeLessThan(position?.basis ?? 0);
  });

  // Hand check of the Retirement goal basis. Y0 row: RAL 40,000, TFR 2,764 + worker 400 + employer
  // 400 = 3,564 Work; voluntary to cap = 5,300 + 2,650 - 800 = 7,150. Stub x 2/12; Work grows 2% a
  // year through 2046 (sum 3,564 x 1.02 x (1.02^20 - 1)/0.02 = 88,327.6); the voluntary room is
  // 7,950 - 800 x 1.02^k (sum 159,000 - 19,826.7 = 139,173.3). Work goes to the Balanced fund,
  // Voluntary to the Equity fund. Opening + bought units: Balanced 12,506, Equity 5,450.
  // Exit rate: 2046 - 2020 - 15 = 11 extra years, 15% - 3.3% = 11.7%.
  it("hand check: the Retirement goal contributes by the pension flows (AC-47)", () => {
    const result = project(sample, "g-retirement");
    const basisOf = (id: string) => result.perProduct.find((p) => p.productId === id)?.basis ?? 0;
    expect(basisOf("p-pension-balanced")).toBeCloseTo(12_506 + 3_564 / 6 + 88_327.6, 0);
    expect(basisOf("p-pension-equity")).toBeCloseTo(5_450 + 7_150 / 6 + 139_173.3, 0);
    const basis = basisOf("p-pension-balanced") + basisOf("p-pension-equity");
    expect(result.tax).toBeCloseTo(0.117 * basis, 6);
  });
});
