import { describe, expect, it } from "vitest";
import {
  confirmSplit,
  type SplitPlan,
  splitByUnits,
  splitByWeights,
  splitCommission,
} from "./split.ts";

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe("splitByWeights", () => {
  it("gives whole units by largest remainder: 7 units at 50/30/20 give 4, 2, 1", () => {
    // exact shares 3.5, 2.1, 1.4; floors 3, 2, 1 leave 1 unit; the remainder 0.5 takes it
    const parts = splitByWeights(7, [
      { goalId: "A", weight: 50 },
      { goalId: "B", weight: 30 },
      { goalId: "C", weight: 20 },
    ]);
    expect(parts).toEqual([
      { goalId: "A", units: 4 },
      { goalId: "B", units: 2 },
      { goalId: "C", units: 1 },
    ]);
  });

  it("reads weights as fractions the same way", () => {
    const parts = splitByWeights(7, [
      { goalId: "A", weight: 0.5 },
      { goalId: "B", weight: 0.3 },
      { goalId: "C", weight: 0.2 },
    ]);
    expect(parts.map((p) => p.units)).toEqual([4, 2, 1]);
  });

  it("normalises over the buckets that take part, so weights need not sum to 1", () => {
    const parts = splitByWeights(10, [
      { goalId: "A", weight: 1 },
      { goalId: "B", weight: 1 },
    ]);
    expect(parts.map((p) => p.units)).toEqual([5, 5]);
  });

  it("breaks equal remainders by goal id, whatever the input order", () => {
    // 1 unit over 1:1 -> shares 0.5 and 0.5, a tie; the lower goal id takes the unit
    const forward = splitByWeights(1, [
      { goalId: "A", weight: 1 },
      { goalId: "B", weight: 1 },
    ]);
    const reversed = splitByWeights(1, [
      { goalId: "B", weight: 1 },
      { goalId: "A", weight: 1 },
    ]);
    expect(forward).toEqual([{ goalId: "A", units: 1 }]);
    expect(reversed).toEqual([{ goalId: "A", units: 1 }]);
  });

  it("breaks equal remainders by goal id even when float noise separates them", () => {
    // exact shares 3.3, 1.3, 0.2, 0.2: the remainders of a and b are both 0.3
    const parts = splitByWeights(5, [
      { goalId: "a", weight: 33 },
      { goalId: "b", weight: 13 },
      { goalId: "c", weight: 2 },
      { goalId: "d", weight: 2 },
    ]);
    expect(parts).toEqual([
      { goalId: "a", units: 4 },
      { goalId: "b", units: 1 },
    ]);
  });

  it("drops buckets that get 0 units", () => {
    const parts = splitByWeights(3, [
      { goalId: "A", weight: 90 },
      { goalId: "B", weight: 1 },
    ]);
    expect(parts).toEqual([{ goalId: "A", units: 3 }]);
  });

  it("always sums to the broker quantity", () => {
    for (const total of [1, 2, 3, 9, 10, 17, 101, 999]) {
      const parts = splitByWeights(total, [
        { goalId: "A", weight: 29 },
        { goalId: "B", weight: 41 },
        { goalId: "C", weight: 7 },
        { goalId: "D", weight: 23 },
      ]);
      expect(sum(parts.map((p) => p.units))).toBe(total);
    }
  });

  it("refuses a quantity that is not a whole number", () => {
    expect(() => splitByWeights(2.5, [{ goalId: "A", weight: 1 }])).toThrow(/whole number/);
  });

  it("refuses when no bucket has a weight above 0", () => {
    expect(() => splitByWeights(5, [{ goalId: "A", weight: 0 }])).toThrow(/weight/);
    expect(() => splitByWeights(5, [])).toThrow(/weight/);
  });
});

describe("splitByUnits", () => {
  const typed = (a: number, b: number) => [
    { goalId: "A", units: a },
    { goalId: "B", units: b },
  ];

  it("is ready only when the parts sum exactly to the broker quantity", () => {
    expect(splitByUnits(10, typed(6, 4))).toEqual({
      ready: true,
      parts: typed(6, 4),
      remaining: 0,
    });
  });

  it("is not ready, and shows the units missing, when the parts fall short", () => {
    const result = splitByUnits(10, typed(6, 3));
    expect(result.ready).toBe(false);
    expect(result.remaining).toBe(1);
  });

  it("is not ready, and shows the excess as a negative, when the parts go over", () => {
    const result = splitByUnits(10, typed(6, 5));
    expect(result.ready).toBe(false);
    expect(result.remaining).toBe(-1);
  });

  it("sums fractional units exactly (0.1 + 0.2 against 0.3)", () => {
    expect(splitByUnits(0.3, typed(0.1, 0.2)).ready).toBe(true);
  });

  it("is not ready with a negative or non-finite part, even when the sum matches", () => {
    expect(splitByUnits(10, typed(12, -2)).ready).toBe(false);
    expect(splitByUnits(10, typed(10, Number.NaN)).ready).toBe(false);
  });

  it("drops parts of 0 units", () => {
    expect(splitByUnits(10, typed(10, 0)).parts).toEqual([{ goalId: "A", units: 10 }]);
  });
});

describe("splitCommission", () => {
  it("follows the units and sums exactly to the commission", () => {
    const parts = splitCommission(295, [
      { goalId: "A", units: 7 },
      { goalId: "B", units: 3 },
    ]);
    // exact 206.5 and 88.5; floors 206 and 88 leave 1 cent; equal remainders go to goal A
    expect(parts).toEqual([
      { goalId: "A", units: 7, commissionCents: 207 },
      { goalId: "B", units: 3, commissionCents: 88 },
    ]);
  });

  it("splits three ways with the leftover cents to the largest remainders", () => {
    const parts = splitCommission(100, [
      { goalId: "A", units: 1 },
      { goalId: "B", units: 1 },
      { goalId: "C", units: 1 },
    ]);
    expect(parts.map((p) => p.commissionCents)).toEqual([34, 33, 33]);
  });

  it("gives 0 to every part when there is no commission", () => {
    const parts = splitCommission(0, [{ goalId: "A", units: 5 }]);
    expect(parts).toEqual([{ goalId: "A", units: 5, commissionCents: 0 }]);
  });

  it("refuses a commission that is not an integer number of cents", () => {
    expect(() => splitCommission(2.95, [{ goalId: "A", units: 1 }])).toThrow(/cents/);
  });
});

describe("confirmSplit", () => {
  const plan = (units: SplitPlan["units"]): SplitPlan => ({
    totalUnits: 10,
    commissionCents: 295,
    units,
  });

  it("yields parts with goal, units and the commission part", () => {
    const confirmed = confirmSplit(
      plan([
        { goalId: "A", units: 7 },
        { goalId: "B", units: 3 },
      ]),
    );
    expect(confirmed.parts).toEqual([
      { goalId: "A", units: 7, commissionCents: 207 },
      { goalId: "B", units: 3, commissionCents: 88 },
    ]);
    expect(sum(confirmed.parts.map((p) => p.commissionCents))).toBe(295);
  });

  it("refuses a plan whose units do not sum to the broker quantity", () => {
    expect(() => confirmSplit(plan([{ goalId: "A", units: 9 }]))).toThrow(/1 unit/);
    expect(() => confirmSplit(plan([{ goalId: "A", units: 11 }]))).toThrow(/1 unit/);
    expect(() => confirmSplit(plan([]))).toThrow();
  });

  it("gives no transaction parts for a plan that was not confirmed", () => {
    const proposal = plan([{ goalId: "A", units: 10 }]);
    // A plan has no `parts`, and cannot stand in for a confirmed split.
    expect("parts" in proposal).toBe(false);
    // @ts-expect-error a SplitPlan is not a ConfirmedSplit
    const forged: ReturnType<typeof confirmSplit> = proposal;
    expect(forged.parts).toBeUndefined();
  });
});
