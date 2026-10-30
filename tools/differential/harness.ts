import { holdingsAt, type ProductParams, projectGoal } from "../../engine/index.ts";
import { loadMockEngine, type MockState } from "./mock.ts";
import type { Scenario } from "./scenario.ts";

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
