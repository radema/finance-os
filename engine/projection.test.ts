import { describe, expect, it } from "vitest";
import { holdingsAt, type LedgerRow } from "./holdings.ts";
import {
  normaliseWeights,
  type ProductParams,
  type ProjectionInput,
  projectGoal,
  timeGrid,
} from "./projection.ts";

const settings = { inflation: 0.02, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 };
const etf: ProductParams = { regime: "etf", mu: 0, ter: 0 };

function input(
  over: Partial<ProjectionInput> & Pick<ProjectionInput, "products">,
): ProjectionInput {
  return {
    asOf: "2026-10-31",
    goal: { targetYear: 2028, target: 10_000, contributionGrowth: 0 },
    monthly: 100,
    positions: [],
    weights: new Map([["p", 1]]),
    settings,
    ...over,
  };
}

describe("timeGrid", () => {
  it("builds a stub of 2 months and tau = 2 + 2/12 (AC-14)", () => {
    const grid = timeGrid("2026-10-31", 2028);
    expect(grid.r).toBe(2);
    expect(grid.f).toBeCloseTo(2 / 12, 12);
    expect(grid.tau).toBeCloseTo(2 + 2 / 12, 12);
    expect(grid.steps.map((s) => s.year)).toEqual([2026, 2027, 2028]);
  });

  it("gives tau 0 and no steps when the goal year is past (AC-14)", () => {
    expect(timeGrid("2026-10-31", 2025)).toMatchObject({ tau: 0, steps: [] });
  });
});

describe("normaliseWeights", () => {
  it("rescales to shares that sum to 1", () => {
    const shares = normaliseWeights(
      new Map([
        ["a", 30],
        ["b", 10],
      ]),
    );
    expect(shares.get("a")).toBeCloseTo(0.75, 12);
    expect(shares.get("b")).toBeCloseTo(0.25, 12);
  });

  it("gives shares of 0 when all weights are 0", () => {
    expect(normaliseWeights(new Map([["a", 0]])).get("a")).toBe(0);
  });
});

describe("projectGoal", () => {
  it("adds stub 200 + 1,200 + 1,200 with mu 0 (AC-14)", () => {
    const result = projectGoal(input({ products: new Map([["p", etf]]) }));
    expect(result.gross).toBeCloseTo(2600, 9);
    expect(result.tau).toBeCloseTo(2 + 2 / 12, 12);
  });

  it("grows the yearly contribution by contributionGrowth from the second full year", () => {
    const result = projectGoal(
      input({
        goal: { targetYear: 2028, target: 0, contributionGrowth: 0.1 },
        products: new Map([["p", etf]]),
      }),
    );
    expect(result.gross).toBeCloseTo(200 + 1200 + 1320, 9);
  });

  it("returns the value at asOf when the goal year is past (AC-14)", () => {
    const result = projectGoal(
      input({
        goal: { targetYear: 2025, target: 10_000, contributionGrowth: 0 },
        positions: [{ productId: "p", value: 500, basis: 400 }],
        products: new Map([["p", { ...etf, mu: 0.05 }]]),
      }),
    );
    expect(result.tau).toBe(0);
    expect(result.perProduct).toEqual([{ productId: "p", value: 500, basis: 400 }]);
    expect(result.targetAtGoalDate).toBe(10_000);
  });

  it("pays a taxed coupon into value and basis for a govt bond (AC-15)", () => {
    const result = projectGoal(
      input({
        asOf: "2026-12-31",
        goal: { targetYear: 2027, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 10_000, basis: 10_000 }],
        products: new Map([["p", { regime: "govt", mu: 0.04, ter: 0, couponRate: 0.04 }]]),
      }),
    );
    expect(result.perProduct[0]?.value).toBeCloseTo(10_350, 9);
    expect(result.perProduct[0]?.basis).toBeCloseTo(10_350, 9);
  });

  it("starts a position from a buy of 1,000 with commission 2.95 at basis 1,002.95 (AC-16)", () => {
    const ledger: LedgerRow[] = [
      {
        date: "2026-01-10",
        goalId: "A",
        productId: "p",
        type: "buy",
        qty: 10,
        price: 100,
        commission: 2.95,
      },
    ];
    const h = holdingsAt(ledger, "2026-10-31");
    const units = h.units.get("A")?.get("p") ?? 0;
    const basis = units * (h.pmc.get("p") ?? 0);
    expect(basis).toBeCloseTo(1002.95, 9);

    const result = projectGoal(
      input({
        monthly: 0,
        positions: [{ productId: "p", value: 1000, basis }],
        products: new Map([["p", etf]]),
        weights: new Map(),
      }),
    );
    expect(result.perProduct[0]?.basis).toBeCloseTo(1002.95, 9);
  });

  it.each([
    { basis: 10_000, expectedBasis: 9_980 },
    { basis: 5_000, expectedBasis: 4_980 },
  ])("stamp duty lowers value and basis, basis $basis (AC-16)", ({ basis, expectedBasis }) => {
    const result = projectGoal(
      input({
        asOf: "2026-12-31",
        goal: { targetYear: 2027, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 10_000, basis }],
        products: new Map([["p", etf]]),
        settings: { ...settings, bollo: 0.002 },
      }),
    );
    const [p] = result.perProduct;
    expect(p?.value).toBeCloseTo(9_980, 9);
    expect(p?.basis).toBeCloseTo(expectedBasis, 9);
    expect((p?.value ?? 0) - (p?.basis ?? 0)).toBeLessThanOrEqual(10_000 - basis + 1e-9);
  });

  it("floors the basis at 0 when stamp duty exceeds it", () => {
    const result = projectGoal(
      input({
        asOf: "2026-12-31",
        goal: { targetYear: 2027, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 10_000, basis: 5 }],
        products: new Map([["p", etf]]),
        settings: { ...settings, bollo: 0.002 },
      }),
    );
    expect(result.perProduct[0]?.basis).toBe(0);
  });

  it("taxes cash and pension growth and skips stamp duty for pension", () => {
    const run = (regime: "cash" | "pension") =>
      projectGoal(
        input({
          asOf: "2026-12-31",
          goal: { targetYear: 2027, target: 0, contributionGrowth: 0 },
          monthly: 0,
          positions: [{ productId: "p", value: 1000, basis: 800 }],
          products: new Map([["p", { regime, mu: 0.1, ter: 0 }]]),
          settings: { ...settings, bollo: 0.002 },
        }),
      ).perProduct[0];
    expect(run("cash")?.value).toBeCloseTo(1000 * (1 + 0.1 * 0.74) * (1 - 0.002), 9);
    expect(run("cash")?.basis).toBeCloseTo(run("cash")?.value ?? 0, 9);
    expect(run("pension")?.value).toBeCloseTo(1000 * (1 + 0.1 * 0.8), 9);
    expect(run("pension")?.basis).toBeCloseTo(800, 9);
  });

  it("keeps a position with no weight row and allocates nothing when all weights are 0", () => {
    const result = projectGoal(
      input({
        positions: [{ productId: "p", value: 100, basis: 100 }],
        products: new Map([["p", etf]]),
        weights: new Map([["p", 0]]),
      }),
    );
    expect(result.gross).toBeCloseTo(100, 9);
  });

  it("gives the target at the goal date as target x (1 + inflation)^tau (AC-17)", () => {
    const result = projectGoal(input({ products: new Map([["p", etf]]) }));
    expect(result.targetAtGoalDate).toBeCloseTo(10_438.39, 2);
  });
});
