import { describe, expect, it } from "vitest";
import { holdingsAt, type LedgerRow } from "./holdings.ts";
import {
  normaliseWeights,
  type ProductParams,
  type ProjectionInput,
  projectGoal,
  timeGrid,
} from "./projection.ts";
import { type PensionFlow, pensionPlanSchema } from "./schemas.ts";

const settings = { inflation: 0.02, bollo: 0, taxStd: 0.26, taxGovt: 0.125, pensionTax: 0.2 };
const etf: ProductParams = { regime: "etf", mu: 0, ter: 0 };

function input(
  over: Partial<ProjectionInput> & Pick<ProjectionInput, "products">,
): ProjectionInput {
  return {
    asOf: "2026-10-31",
    goal: { id: "g", targetYear: 2028, target: 10_000, contributionGrowth: 0 },
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
        goal: { id: "g", targetYear: 2028, target: 0, contributionGrowth: 0.1 },
        products: new Map([["p", etf]]),
      }),
    );
    expect(result.gross).toBeCloseTo(200 + 1200 + 1320, 9);
  });

  it("returns the value at asOf when the goal year is past (AC-14)", () => {
    const result = projectGoal(
      input({
        goal: { id: "g", targetYear: 2025, target: 10_000, contributionGrowth: 0 },
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
        goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
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
        goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
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
        goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
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
          goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
          monthly: 0,
          positions: [{ productId: "p", value: 1000, basis: 800 }],
          products: new Map([["p", { regime, mu: 0.1, ter: 0 }]]),
          settings: { ...settings, bollo: 0.002 },
          firstYear: 2020,
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

  it("returns tax and net at the goal date (AC-13)", () => {
    const result = projectGoal(
      input({
        asOf: "2026-12-31",
        goal: { id: "g", targetYear: 2027, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 10_000, basis: 8_000 }],
        products: new Map([["p", { ...etf, whiteListShare: 0 }]]),
      }),
    );
    expect(result.tax).toBeCloseTo(520, 9);
    expect(result.net).toBeCloseTo(9_480, 9);
  });

  it("liquidates on 31 December for a December asOf, so a zainetto expiring before it gives no credit (AC-13)", () => {
    const result = projectGoal(
      input({
        asOf: "2026-12-15",
        goal: { id: "g", targetYear: 2026, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 14_000, basis: 10_000 }],
        products: new Map([["p", { regime: "govt", mu: 0, ter: 0 }]]),
        settings: { ...settings, zainetto: { amount: 1_000, expiry: "2026-12-20", goalId: "g" } },
      }),
    );
    expect(result.tau).toBe(0);
    expect(result.tax).toBeCloseTo(500, 9);
  });

  it("takes the pension exit rate at the goal year when the goal is due now (AC-13, AC-18)", () => {
    // asOf 2024, goal year 2023, member since 1990: 18 extra years, rate 15% - 5.4% = 9.6%.
    const result = projectGoal(
      input({
        asOf: "2024-12-01",
        goal: { id: "g", targetYear: 2023, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 10_000, basis: 10_000 }],
        products: new Map([["p", { regime: "pension", mu: 0, ter: 0 }]]),
        firstYear: 1990,
      }),
    );
    expect(result.tax).toBeCloseTo(960, 9);
  });

  it("applies a zainetto that expires on the 31 December of the goal year of a goal due now (AC-13, AC-18)", () => {
    const result = projectGoal(
      input({
        asOf: "2024-12-01",
        goal: { id: "g", targetYear: 2023, target: 0, contributionGrowth: 0 },
        monthly: 0,
        positions: [{ productId: "p", value: 12_000, basis: 10_000 }],
        products: new Map([["p", { regime: "direct", mu: 0, ter: 0 }]]),
        settings: { ...settings, zainetto: { amount: 1_000, expiry: "2023", goalId: "g" } },
      }),
    );
    // gain 2,000 x 26% = 520 tax, less the 260 credit
    expect(result.tax).toBeCloseTo(260, 9);
  });
});

describe("pension goal (AC-47)", () => {
  // RAL 40,000 flat, TFR 6.91%, worker 1%, employer 2%, voluntary 1,000: TFR 2,764 + worker 400 +
  // employer 800 + voluntary 1,000 = 4,964 a year. Money in the plan is in cents.
  const plan = (flows: PensionFlow[]) =>
    pensionPlanSchema.parse({
      goalId: "g",
      firstYear: 2020,
      ral: 4_000_000,
      tfrPct: 0.0691,
      workerPct: 0.01,
      employerPct: 0.02,
      voluntary: 100_000,
      flows,
    });
  const oneFund: PensionFlow[] = [
    { productId: "p", flow: "Work", pct: 1 },
    { productId: "p", flow: "Voluntary", pct: 1 },
  ];
  const pensionGoal = (targetYear: number, asOf: string, flows = oneFund) =>
    projectGoal(
      input({
        asOf,
        goal: { id: "g", targetYear, target: 0, contributionGrowth: 0.5 },
        monthly: 999,
        weights: new Map([["other", 1]]),
        products: new Map([
          ["p", { regime: "pension", mu: 0, ter: 0 }],
          ["q", { regime: "pension", mu: 0, ter: 0 }],
        ]),
        firstYear: 2020,
        pension: { plan: plan(flows), deductionCapCents: 530_000, voluntaryYtd: 0 },
      }),
    );

  // asOf 31 December: f = 0, so the stub adds nothing and the goal years 2027 ... targetYear add 4,964 each.
  it("gives each goal its own exit rate: 13.5% in 2040, 9% in 2055", () => {
    const early = pensionGoal(2040, "2026-12-31");
    // 14 years x 4,964 = 69,496 of basis; 2040 - 2020 - 15 = 5 extra years: 15% - 1.5% = 13.5%.
    expect(early.gross).toBeCloseTo(69_496, 6);
    expect(early.tax).toBeCloseTo(9_381.96, 6);
    expect(early.net).toBeCloseTo(60_114.04, 6);
    const late = pensionGoal(2055, "2026-12-31");
    // 29 years x 4,964 = 143,956; 20 extra years: 15% - 6% = 9%.
    expect(late.gross).toBeCloseTo(143_956, 6);
    expect(late.tax).toBeCloseTo(12_956.04, 6);
  });

  it("adds the Y0 schedule x f in the stub and ignores the monthly plan and the weights", () => {
    // asOf 31 October: f = 2/12; the 2026 goal year has only the stub.
    expect(pensionGoal(2026, "2026-10-31").gross).toBeCloseTo(4_964 / 6, 6);
  });

  it("splits each year's Work and Voluntary flows by product", () => {
    const result = pensionGoal(2027, "2026-12-31", [
      { productId: "p", flow: "Work", pct: 0.75 },
      { productId: "q", flow: "Work", pct: 0.25 },
      { productId: "q", flow: "Voluntary", pct: 1 },
    ]);
    const value = (id: string) => result.perProduct.find((p) => p.productId === id)?.value;
    expect(value("p")).toBeCloseTo(3_964 * 0.75, 6);
    expect(value("q")).toBeCloseTo(3_964 * 0.25 + 1_000, 6);
  });
});
