import { type CashFlowYear, projectCashFlow } from "../../engine/cashFlow.ts";
import { holdingsAt } from "../../engine/holdings.ts";
import { addMonths } from "../../engine/months.ts";
import { pensionSchedule } from "../../engine/pension.ts";
import { planVsActual } from "../../engine/planVsActual.ts";
import { type ProductParams, projectGoal } from "../../engine/projection.ts";
import { cashFlowSchema, pensionPlanSchema } from "../../engine/schemas.ts";
import { loadMockEngine, type MockCashFlowRow, type MockState } from "./mock.ts";
import type { CashFlowScenario, Scenario } from "./scenario.ts";

const MOCK_CLASS: Record<string, string> = { cash: "Cash", govt: "Govt bonds" };
// The mock only reads the correlation matrix to draw shocks; a deterministic run ignores them.
const IDENTITY = Array.from({ length: 6 }, (_, i) =>
  Array.from({ length: 6 }, (_, j) => +(i === j)),
);

function mockState(scenario: Scenario): MockState {
  const { asOf, settings, zainetto } = scenario;
  const month = asOf.slice(0, 7);
  return {
    asOf,
    settings: {
      ...settings,
      paths: 1,
      seed: 1,
      probNeed: 0.9,
      probWant: 0.75,
      probWish: 0.5,
      zainetto: zainetto && {
        goalId: zainetto.goalId,
        amount: zainetto.amount,
        expiry: String(zainetto.expiryYear),
      },
    },
    pension: { goalId: null, firstYear: scenario.firstYear },
    products: scenario.products.map((p) => ({
      id: p.id,
      cls: MOCK_CLASS[p.regime] ?? "Equity",
      regime: p.regime,
      wl: p.whiteListShare,
      mu: p.mu,
      vol: 0,
      ter: p.ter,
    })),
    goals: scenario.goals.map((g) => ({
      id: g.id,
      year: g.targetYear,
      target: g.target,
      contrib: g.monthly,
      cgrowth: 0,
      priority: "Need",
    })),
    weights: scenario.goals.flatMap((g) =>
      Object.entries(g.weights).map(([productId, weight]) => ({ goalId: g.id, productId, weight })),
    ),
    ledger: scenario.ledger.map((row) => ({
      ...row,
      type: row.type === "opening" ? "open" : row.type,
    })),
    prices: Object.fromEntries(scenario.products.map((p) => [p.id, { [month]: p.price }])),
    corr: IDENTITY,
  };
}

const mock = loadMockEngine();

/** Deterministic net value of each goal, from the copied mock engine. */
export function mockNet(scenario: Scenario): Map<string, number> {
  const { results } = mock.analyse(mockState(scenario), scenario.asOf, { paths: 1 });
  return new Map(results.map((r) => [r.id, r.detNet]));
}

/** Deterministic net value of each goal, from v1's `projectGoal`. */
export function v1Net(scenario: Scenario): Map<string, number> {
  const { asOf, settings, zainetto, products: scenarioProducts } = scenario;
  const { units, pmc } = holdingsAt(scenario.ledger, asOf);
  const params = new Map<string, ProductParams>(scenarioProducts.map((p) => [p.id, p]));
  const prices = new Map(scenarioProducts.map((p) => [p.id, p.price]));

  const nets = new Map<string, number>();
  for (const goal of scenario.goals) {
    const positions = [...(units.get(goal.id) ?? [])].map(([productId, qty]) => ({
      productId,
      value: qty * (prices.get(productId) ?? 0),
      basis: qty * (pmc.get(productId) ?? 0),
    }));
    const { net } = projectGoal({
      asOf,
      goal: {
        id: goal.id,
        targetYear: goal.targetYear,
        target: goal.target,
        contributionGrowth: 0,
      },
      monthly: goal.monthly,
      positions,
      products: params,
      weights: new Map(Object.entries(goal.weights)),
      settings: {
        ...settings,
        zainetto: zainetto && {
          amount: zainetto.amount,
          expiry: String(zainetto.expiryYear),
          goalId: zainetto.goalId,
        },
      },
      firstYear: scenario.firstYear,
    });
    nets.set(goal.id, net);
  }
  return nets;
}

const CENTS = 100;

/** The pension goal of a cash flow scenario: one of the scenario's goals. */
const pensionGoalId = (scenario: Scenario, cf: CashFlowScenario): string =>
  scenario.goals[cf.pension.goal % scenario.goals.length]?.id ?? "";

/** The mock's nominal growth for a growth above inflation: (1 + inflation)(1 + g) - 1. */
const nominalGrowth = (scenario: Scenario, growth: number): number =>
  (1 + scenario.settings.inflation) * (1 + growth) - 1;

/**
 * The copied mock's 10-year cash flow, in euros. The mock keeps paying the pension refund after the
 * pension goal ends; v1 stops with the last one in targetYear + 1 (AC-96). That listed difference is
 * applied here, so the rows still compare line by line.
 */
export function mockCashFlow(scenario: Scenario, cf: CashFlowScenario): MockCashFlowRow[] {
  const { pension } = cf;
  const y0 = Number(scenario.asOf.slice(0, 4));
  const goalId = pensionGoalId(scenario, cf);
  const lastRefundYear = (scenario.goals.find((g) => g.id === goalId)?.targetYear ?? 0) + 1;
  const rows = mock.cashflow(
    {
      asOf: scenario.asOf,
      // The mock grows both fields in nominal euros; v1 grows them above inflation (#156).
      cashflow: {
        ...cf.cashFlow,
        incomeGrowth: nominalGrowth(scenario, cf.cashFlow.incomeGrowth),
        expenseGrowth: nominalGrowth(scenario, cf.cashFlow.expenseGrowth),
        events: cf.cashFlow.events.map((e) => ({
          year: y0 + e.yearOffset,
          label: "",
          amount: e.amount,
        })),
      },
      pension: {
        goalId: pensionGoalId(scenario, cf),
        ral: pension.ral,
        ralGrowth: 0,
        tfrPct: 0.0691,
        workerPct: pension.workerPct,
        employerPct: pension.employerPct,
        cap: pension.capCents / CENTS,
        extra: pension.extra,
        voluntary: pension.voluntary ?? "",
        marginal: pension.marginalRate,
      },
      goals: scenario.goals.map((g) => ({
        id: g.id,
        year: g.targetYear,
        contrib: g.monthly,
        cgrowth: 0,
      })),
    },
    10,
  );
  return rows.map((row) =>
    row.year > lastRefundYear
      ? { ...row, refund: 0, capacity: row.capacity - row.refund, free: row.free - row.refund }
      : row,
  );
}

/** v1's 10-year cash flow in euros, from `projectCashFlow` (the engine works in cents). */
export function v1CashFlow(scenario: Scenario, cf: CashFlowScenario): CashFlowYear[] {
  const { pension } = cf;
  const y0 = Number(scenario.asOf.slice(0, 4));
  const plan = pensionPlanSchema.parse({
    goalId: pensionGoalId(scenario, cf),
    firstYear: scenario.firstYear,
    ral: pension.ral * CENTS,
    tfrPct: 0.0691,
    workerPct: pension.workerPct,
    employerPct: pension.employerPct,
    voluntary: pension.voluntary === null ? null : pension.voluntary * CENTS,
    marginalRate: pension.marginalRate,
    extra: pension.extra * CENTS,
  });
  const schedule = pensionSchedule(
    plan,
    { pensionDeductionCapCents: pension.capCents },
    scenario.asOf,
    0,
    10,
  );
  return projectCashFlow({
    asOf: scenario.asOf,
    inflation: scenario.settings.inflation,
    cashFlow: cashFlowSchema.parse({
      income: cf.cashFlow.income * CENTS,
      incomeGrowth: cf.cashFlow.incomeGrowth,
      essential: cf.cashFlow.essential * CENTS,
      optional: cf.cashFlow.optional * CENTS,
      expenseGrowth: cf.cashFlow.expenseGrowth,
      events: cf.cashFlow.events.map((e) => ({
        year: y0 + e.yearOffset,
        label: "",
        amount: e.amount * CENTS,
      })),
    }),
    goals: scenario.goals.map((g) => ({
      id: g.id,
      targetYear: g.targetYear,
      contributionGrowth: 0,
      monthly: g.monthly * CENTS,
    })),
    pension: { goalId: plan.goalId, schedule },
  });
}

/** Cumulative planned, actual and gap of one goal, in euros. */
export type Totals = { planned: number; actual: number; gap: number };

/** The tracking start of a scenario: `monthsBack` months before the asOf month. */
export const trackingStartOf = (scenario: Scenario, monthsBack: number): string =>
  addMonths(scenario.asOf.slice(0, 7), -monthsBack);

/** Cumulative totals to the asOf month per goal, from the copied mock's `planVsActual`. */
export function mockPlanVsActual(scenario: Scenario, trackingStart: string): Map<string, Totals> {
  const state = mockState(scenario);
  const rows = mock.planVsActual({ ...state, settings: { ...state.settings, trackingStart } });
  return new Map(rows.map(({ id, planned, actual, gap }) => [id, { planned, actual, gap }]));
}

/** The same totals, from v1's `planVsActual` (cents in, euros out). */
export function v1PlanVsActual(scenario: Scenario, trackingStart: string): Map<string, Totals> {
  const result = planVsActual({
    goals: scenario.goals.map((g) => ({ id: g.id, targetYear: g.targetYear })),
    plans: scenario.goals.map((g) => ({
      goalId: g.id,
      fromMonth: trackingStart,
      monthly: g.monthly * CENTS,
    })),
    transactions: scenario.ledger,
    trackingStart,
    valuationMonth: scenario.asOf.slice(0, 7),
  });
  return new Map(
    result.map(({ goalId, months }) => {
      const end = months.at(-1);
      return [
        goalId,
        {
          planned: (end?.cumPlanned ?? 0) / CENTS,
          actual: (end?.cumActual ?? 0) / CENTS,
          gap: (end?.gap ?? 0) / CENTS,
        },
      ];
    }),
  );
}
