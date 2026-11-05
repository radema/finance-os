import { describe, expect, it } from "vitest";
import { binOutcomes, fitAxis, isZeroWidth } from "./outcomeChart.ts";

describe("fitAxis", () => {
  it("fits a narrow range and starts above 0 (Home deposit: bad is 67% of good)", () => {
    const axis = fitAxis(51_441, 76_215, [44_309]);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis).toMatchObject({ min: 20_000, max: 100_000 });
    expect(axis.min).toBeLessThanOrEqual(44_309);
    expect(axis.max).toBeGreaterThanOrEqual(76_215);
  });

  it("separates close values: 15,517 / 15,929 / 16,343 with a target of 15,000", () => {
    const axis = fitAxis(15_517, 16_343, [15_000]);
    expect(axis).toMatchObject({ min: 14_000, max: 17_500 });
    expect(axis.max - axis.min).toBeLessThan(5_000);
  });

  it("starts at 0 on a wide range, where bad is under 20% of good", () => {
    const axis = fitAxis(9_100, 88_700, [40_000]);
    expect(axis.min).toBe(0);
    expect(axis.max).toBeGreaterThanOrEqual(88_700);
  });

  it("starts at 0 when bad is exactly 20% of good, and not just above it", () => {
    expect(fitAxis(20_000, 100_000).min).toBe(0);
    expect(fitAxis(20_001, 100_000).min).toBeGreaterThan(0);
  });

  it("keeps min <= bad and max >= good, and every mark inside", () => {
    for (const [bad, good, target] of [
      [51_441, 76_215, 44_309],
      [15_517, 16_343, 15_000],
      [0.67, 1.75, 1],
      [30, 50, 200],
      [1_000, 1_001, 1_000.5],
    ] as const) {
      const axis = fitAxis(bad, good, [target]);
      expect(axis.min).toBeLessThanOrEqual(Math.min(bad, target));
      expect(axis.max).toBeGreaterThanOrEqual(Math.max(good, target));
    }
  });

  it("never starts at 0 above the 20% rule, even when the padding would reach 0", () => {
    const axis = fitAxis(25, 100);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThanOrEqual(25);
  });

  it("answers a zero-width range without a division by zero", () => {
    const axis = fitAxis(2_004.89, 2_004.89, [3_000]);
    expect(Number.isFinite(axis.min) && Number.isFinite(axis.max)).toBe(true);
    expect(axis.max).toBeGreaterThan(axis.min);
    const flat = fitAxis(0, 0);
    expect(flat.max).toBeGreaterThan(flat.min);
  });

  it("returns the tick step the ends are multiples of", () => {
    const axis = fitAxis(51_441, 76_215, [44_309]);
    expect(axis.step).toBe(10_000);
    expect(axis.min % axis.step).toBe(0);
    expect(axis.max % axis.step).toBe(0);
  });
});

describe("isZeroWidth", () => {
  it("is true when bad and good are the same to the cent", () => {
    expect(isZeroWidth({ bad: 2_004.89, good: 2_004.89 })).toBe(true);
    expect(isZeroWidth({ bad: 2_004.891, good: 2_004.889 })).toBe(true);
  });
  it("is false from one cent apart", () => {
    expect(isZeroWidth({ bad: 2_004.89, good: 2_004.9 })).toBe(false);
  });
});

describe("binOutcomes", () => {
  const axis = { min: 0, max: 10, step: 2 };

  it("counts sorted values in equal bins across the axis", () => {
    const bins = binOutcomes([0, 1, 1.5, 2, 5, 9.9, 10], axis, 5);
    expect(bins).toEqual({ min: 0, max: 10, counts: [3, 1, 1, 0, 2] });
  });

  it("does not count a path outside the axis, and does not pile it into an edge bin", () => {
    const bins = binOutcomes([-5, 1, 5, 99], axis, 5);
    expect(bins.counts).toEqual([1, 0, 1, 0, 0]);
  });

  it("counts every path when the axis covers them all", () => {
    const values = Array.from({ length: 1_000 }, (_, i) => i / 100);
    const total = binOutcomes(values, axis, 40).counts.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(1_000);
  });
});
