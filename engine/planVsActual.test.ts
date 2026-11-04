import { describe, expect, it } from "vitest";
import type { LedgerRow } from "./holdings.ts";
import type { PensionYear } from "./pension.ts";
import { nextContribution, type PlanVsActualGoal, planVsActual } from "./planVsActual.ts";
import { commissionSchema } from "./schemas.ts";

// Money is in cents: a hand value in euros is written as `eur(x)`.
const eur = (euros: number) => euros * 100;

const goal = { id: "g1", targetYear: 2030 };
const base = { trackingStart: "2026-01", valuationMonth: "2026-06" };

/** A buy of `euros` in one go: 1 unit at that price, no commission. */
const buy = (date: string, euros: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  date,
  goalId: "g1",
  productId: "p1",
  type: "buy",
  qty: 1,
  price: euros,
  ...extra,
});

const last = <T>(items: readonly T[] | undefined): T => {
  const item = items?.at(-1);
  if (item === undefined) throw new Error("empty");
  return item;
};

const one = (input: Parameters<typeof planVsActual>[0]) => {
  const [result] = planVsActual(input);
  if (!result) throw new Error("no goal");
  return result;
};

describe("planVsActual: planned", () => {
  it("adds the plan in force of each month, and never uses the contributionGrowth (AC-67)", () => {
    // Plan 500 until month 3, 700 from month 4. The goal's growth is not an input of the function.
    const growing = { ...goal, contributionGrowth: 0.05 };
    const result = one({
      ...base,
      goals: [growing],
      plans: [
        { goalId: "g1", fromMonth: "2026-01", monthly: eur(500) },
        { goalId: "g1", fromMonth: "2026-04", monthly: eur(700) },
      ],
      transactions: [],
    });
    expect(result.months.map((m) => m.planned)).toEqual([500, 500, 500, 700, 700, 700].map(eur));
    expect(last(result.months).cumPlanned).toBe(eur(3_600));
  });

  it("plans 0 for a month before the first plan version", () => {
    const result = one({
      ...base,
      goals: [goal],
      plans: [{ goalId: "g1", fromMonth: "2026-03", monthly: eur(500) }],
      transactions: [],
    });
    expect(result.months.map((m) => m.planned)).toEqual([0, 0, 500, 500, 500, 500].map(eur));
  });

  it("plans 0 after the goal's target year", () => {
    const result = one({
      trackingStart: "2030-11",
      valuationMonth: "2031-02",
      goals: [goal],
      plans: [{ goalId: "g1", fromMonth: "2026-01", monthly: eur(500) }],
      transactions: [],
    });
    expect(result.months.map((m) => m.planned)).toEqual([500, 500, 0, 0].map(eur));
  });

  it("counts the valuation month in full, however far it has got", () => {
    const result = one({
      trackingStart: "2026-05",
      valuationMonth: "2026-05",
      goals: [goal],
      plans: [{ goalId: "g1", fromMonth: "2026-01", monthly: eur(500) }],
      transactions: [buy("2026-05-02", 100)],
    });
    expect(result.months).toHaveLength(1);
    expect(result.months[0]).toMatchObject({ planned: eur(500), actual: eur(100) });
  });

  it("has no month when the valuation month is before the tracking start", () => {
    const result = one({
      trackingStart: "2026-05",
      valuationMonth: "2026-04",
      goals: [goal],
      plans: [{ goalId: "g1", fromMonth: "2026-01", monthly: eur(500) }],
      transactions: [],
    });
    expect(result.months).toEqual([]);
  });

  it("plans the pension goal as the schedule total divided by 12", () => {
    const row = (year: number, total: number): PensionYear => ({
      year,
      ral: 0,
      // total = tfr + worker + employer + voluntary: 1,200 + 600 + 600 + 1,200 = 3,600 a year.
      tfr: eur(total / 2),
      worker: eur(total / 6),
      employer: eur(total / 6),
      voluntary: eur(total / 6),
      voluntaryAhead: 0,
      voluntaryTaxYear: 0,
      deductible: 0,
      nonDeducted: 0,
      refund: 0,
      refundYear: year + 1,
    });
    const result = one({
      trackingStart: "2026-12",
      valuationMonth: "2027-02",
      goals: [{ id: "g1", targetYear: 2027 }],
      plans: [],
      transactions: [],
      pension: { goalId: "g1", schedule: [row(2026, 3_600), row(2027, 6_000)] },
    });
    expect(result.months.map((m) => m.planned)).toEqual([300, 500, 500].map(eur));
  });
});

describe("planVsActual: actual", () => {
  const plans = [{ goalId: "g1", fromMonth: "2026-01", monthly: eur(500) }];

  it("lets a flexible month catch up: 0 then 1,000 against 500 a month gives a gap of 0 (AC-68)", () => {
    const result = one({
      trackingStart: "2026-01",
      valuationMonth: "2026-02",
      goals: [goal],
      plans,
      transactions: [buy("2026-02-10", 1_000)],
    });
    expect(result.months.map((m) => m.actual)).toEqual([0, eur(1_000)]);
    expect(result.months.map((m) => m.gap)).toEqual([-eur(500), 0]);
    expect(result.months.at(-1)).toMatchObject({ cumPlanned: eur(1_000), cumActual: eur(1_000) });
  });

  it("excludes openings and coupons, and does not subtract sells (AC-70)", () => {
    const result = one({
      ...base,
      goals: [goal],
      plans,
      transactions: [
        buy("2026-02-10", 400),
        buy("2026-02-10", 99_999, { type: "opening" }),
        buy("2026-03-10", 50, { type: "coupon", qty: 0, price: 0 }),
        buy("2026-04-10", 200, { type: "sell", qty: -1 }),
      ],
    });
    expect(last(result.months).cumActual).toBe(eur(400));
  });

  it("counts a buy as quantity times price plus commission, and a pension contribution", () => {
    const result = one({
      ...base,
      goals: [goal],
      plans,
      transactions: [
        buy("2026-01-15", 0, { qty: 10, price: 25, commission: 2.95 }),
        buy("2026-01-20", 100, { type: "pensionContribution" }),
      ],
    });
    expect(result.months[0]?.actual).toBeCloseTo(eur(250 + 2.95 + 100), 6);
  });

  it("leaves out transactions before the tracking start, after the valuation month and of other goals", () => {
    const result = one({
      ...base,
      goals: [goal],
      plans,
      transactions: [
        buy("2025-12-31", 300),
        buy("2026-07-01", 300),
        buy("2026-03-01", 300, { goalId: "other" }),
        buy("2026-01-01", 100),
      ],
    });
    expect(last(result.months).cumActual).toBe(eur(100));
  });

  it("keeps one series per goal, in the order of the goals", () => {
    const result = planVsActual({
      ...base,
      goals: [goal, { id: "g2", targetYear: 2030 }],
      plans: [{ goalId: "g2", fromMonth: "2026-01", monthly: eur(100) }],
      transactions: [],
    });
    expect(result.map((r) => r.goalId)).toEqual(["g1", "g2"]);
    expect(last(result[1]?.months).cumPlanned).toBe(eur(600));
    expect(last(result[0]?.months).cumPlanned).toBe(0);
  });
});

describe("nextContribution", () => {
  const percent = commissionSchema.parse({});
  const bears = { zeroCommission: false };
  const free = { zeroCommission: true };

  /** A goal behind plan by `behind` euros: 1 month planned at `behind`, nothing put in. */
  const behindBy = (id: string, behind: number): PlanVsActualGoal => ({
    goalId: id,
    months: [
      {
        month: "2026-01",
        planned: eur(behind),
        actual: 0,
        cumPlanned: eur(behind),
        cumActual: 0,
        gap: -eur(behind),
      },
    ],
  });
  const weights = (goalId: string) => [
    { goalId, productId: "a", weight: 3 },
    { goalId, productId: "b", weight: 1 },
    { goalId, productId: "c", weight: 0 },
  ];

  it("picks the non-pension bucket with the largest negative gap and splits by weights (AC-71)", () => {
    const next = nextContribution({
      planVsActual: [behindBy("small", 2_000), behindBy("big", 4_000)],
      allocationWeights: [...weights("small"), ...weights("big")],
      products: new Map([
        ["a", bears],
        ["b", bears],
        ["c", bears],
      ]),
      commission: percent,
    });
    expect(next?.goalId).toBe("big");
    expect(next?.amount).toBe(eur(4_000));
    // 3 : 1 gives 3,000 and 1,000; product c has weight 0 and takes nothing. Fee: 0.19% of 3,000 = 5.70.
    expect(next?.split.map((s) => [s.productId, s.amount])).toEqual([
      ["a", eur(3_000)],
      ["b", eur(1_000)],
    ]);
    expect(next?.split[0]?.commission).toBe(570);
    expect(next?.split[0]?.costPct).toBeCloseTo(0.0019, 10);
    expect(next?.wait).toBe(false);
  });

  it("never returns the pension goal, even with the largest gap (AC-71)", () => {
    const next = nextContribution({
      planVsActual: [behindBy("pension", 9_000), behindBy("g1", 100)],
      pensionGoalId: "pension",
      allocationWeights: [...weights("pension"), ...weights("g1")],
      products: new Map([
        ["a", free],
        ["b", free],
      ]),
      commission: percent,
    });
    expect(next?.goalId).toBe("g1");
  });

  it("returns null when no bucket is behind plan, or only the pension goal is", () => {
    const input = {
      allocationWeights: weights("g1"),
      products: new Map([["a", bears]]),
      commission: percent,
    };
    const ahead: PlanVsActualGoal = {
      goalId: "g1",
      months: [{ month: "2026-01", planned: 0, actual: 5, cumPlanned: 0, cumActual: 5, gap: 5 }],
    };
    expect(nextContribution({ ...input, planVsActual: [ahead] })).toBeNull();
    expect(nextContribution({ ...input, planVsActual: [] })).toBeNull();
    expect(
      nextContribution({
        ...input,
        planVsActual: [behindBy("g1", 100)],
        pensionGoalId: "g1",
      }),
    ).toBeNull();
  });

  it("says wait below the minimum efficient ticket when the bucket holds products that bear commission (AC-71)", () => {
    // Min ticket = 2.95 / 0.19% = 1,552.63. A gap of 1,000 is below it.
    const input = {
      planVsActual: [behindBy("g1", 1_000)],
      allocationWeights: weights("g1"),
      commission: percent,
    };
    const bearing = nextContribution({
      ...input,
      products: new Map([
        ["a", bears],
        ["b", free],
      ]),
    });
    expect(bearing?.wait).toBe(true);
    const zero = nextContribution({
      ...input,
      products: new Map([
        ["a", free],
        ["b", free],
      ]),
    });
    expect(zero?.wait).toBe(false);
    expect(zero?.split.map((s) => s.commission)).toEqual([0, 0]);
  });

  it("does not wait at or above the minimum efficient ticket", () => {
    const next = nextContribution({
      planVsActual: [behindBy("g1", 1_600)],
      allocationWeights: weights("g1"),
      products: new Map([
        ["a", bears],
        ["b", bears],
      ]),
      commission: percent,
    });
    expect(next?.wait).toBe(false);
  });

  it("uses the flat model's fee and minimum ticket", () => {
    const flat = commissionSchema.parse({
      feeModel: "flat",
      flatFeeCents: 500,
      minTicketCents: eur(2_000),
    });
    const next = nextContribution({
      planVsActual: [behindBy("g1", 1_000)],
      allocationWeights: [{ goalId: "g1", productId: "a", weight: 1 }],
      products: new Map([["a", bears]]),
      commission: flat,
    });
    expect(next).toMatchObject({ wait: true });
    expect(next?.split).toEqual([
      { productId: "a", amount: eur(1_000), commission: 500, costPct: 0.005 },
    ]);
  });
});
