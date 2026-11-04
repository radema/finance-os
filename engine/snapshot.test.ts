import { describe, expect, it } from "vitest";
import type { GoalWorld, GoalWorldProduct } from "./goalViews.ts";
import { analysisOf, detailOf } from "./goalViews.ts";
import { DEFAULT_CORRELATIONS, settingsSchema } from "./schemas.ts";
import { computeSnapshot, SNAPSHOT_PATHS } from "./snapshot.ts";

const etf: GoalWorldProduct = {
  id: "etf",
  name: "World ETF",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.05,
  volatility: 0.15,
  assetClass: "Equity",
  ter: 0.002,
  couponRate: 0,
};
const fund: GoalWorldProduct = { ...etf, id: "fund", name: "Pension fund", regime: "pension" };

const buy = (date: string, productId: string, qty: number, price: number) =>
  ({ date, goalId: "g1", productId, type: "buy", qty, price, commission: 0, amount: 0 }) as const;

// Month 2026-03. 10 units on 2026-01-15, 5 more on 2026-02-10, 5 more on 2026-03-05.
// Prices: 10, 11, 12. So at the end of 2026-02 the bucket holds 15 units at 11 euros.
const world = (overrides: Partial<GoalWorld> = {}): GoalWorld => ({
  products: new Map([[etf.id, etf]]),
  goals: [
    {
      id: "g1",
      name: "House",
      priority: "Need",
      target: 10_000,
      targetYear: 2035,
      contributionGrowth: 0,
      minProb: null,
    },
  ],
  plans: [{ goalId: "g1", fromMonth: "2026-01", monthly: 200 }],
  weights: [{ goalId: "g1", productId: "etf", weight: 1 }],
  ledger: [
    buy("2026-01-15", "etf", 10, 10),
    buy("2026-02-10", "etf", 5, 11),
    buy("2026-03-05", "etf", 5, 12),
  ],
  settings: settingsSchema.parse({ mcPaths: 1000, seed: 7 }),
  correlations: DEFAULT_CORRELATIONS,
  pension: undefined,
  voluntaryYtdCents: 0,
  month: "2026-02",
  prices: new Map([
    [
      "etf",
      [
        { month: "2026-01", price: 10 },
        { month: "2026-02", price: 11 },
        { month: "2026-03", price: 12 },
      ],
    ],
  ]),
  ...overrides,
});

describe("computeSnapshot", () => {
  it("freezes the goal's analysis at the month: value from that month's prices and holdings", () => {
    const [goal] = computeSnapshot(world());
    expect(goal?.goalId).toBe("g1");
    // 15 units at 11: the 2026-03 purchase and price are after the month.
    expect(goal?.value).toBeCloseTo(165, 9);
    expect(goal?.reqP).toBe(0.9);
  });

  it("matches the detail analysis run with 300 paths and the Settings seed", () => {
    const w = world();
    const [goal] = computeSnapshot(w);
    const at = world({ settings: { ...w.settings, mcPaths: SNAPSHOT_PATHS } });
    const analysis = analysisOf(at, at.goals[0] as GoalWorld["goals"][number]);
    const detail = detailOf(at, at.goals[0] as GoalWorld["goals"][number]);
    expect(SNAPSHOT_PATHS).toBe(300);
    expect(goal?.prob).toBe(analysis?.pSuccess);
    expect(goal?.status).toBe(analysis?.status);
    expect(goal?.median).toBe(analysis?.range.typical);
    expect(goal?.p10).toBe(analysis?.range.bad);
    expect(goal?.p90).toBe(analysis?.range.good);
    // The target at goal date, so median / target compares like with like.
    expect(goal?.target).toBe(analysis?.range.target);
    expect(goal?.detNet).toBe(detail.projection?.net);
    expect(goal?.p10 ?? 0).toBeLessThanOrEqual(goal?.median ?? 0);
    expect(goal?.median ?? 0).toBeLessThanOrEqual(goal?.p90 ?? 0);
  });

  it("is the same for the same inputs, and the seed changes it", () => {
    const first = computeSnapshot(world());
    expect(computeSnapshot(world())).toEqual(first);
    const other = computeSnapshot(
      world({ settings: settingsSchema.parse({ mcPaths: 1000, seed: 8 }) }),
    );
    expect(other[0]?.median).not.toBe(first[0]?.median);
  });

  it("gives null results, not a guess, when a held product has no price yet", () => {
    const w = world({
      products: new Map([
        [etf.id, etf],
        [fund.id, fund],
      ]),
      ledger: [...world().ledger, buy("2026-02-20", "fund", 2, 50)],
    });
    const [goal] = computeSnapshot(w);
    expect(goal).toMatchObject({
      goalId: "g1",
      prob: null,
      detNet: null,
      median: null,
      p10: null,
      p90: null,
      value: null,
      status: null,
      reqP: 0.9,
    });
    expect(goal?.target).toBeGreaterThan(10_000);
  });

  it("has one entry per goal, in the order of the goals", () => {
    const w = world();
    const second = { ...(w.goals[0] as GoalWorld["goals"][number]), id: "g2", name: "Car" };
    const goals = computeSnapshot({ ...w, goals: [...w.goals, second] });
    expect(goals.map((goal) => goal.goalId)).toEqual(["g1", "g2"]);
  });
});
