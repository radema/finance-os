import { describe, expect, it } from "vitest";
import { fitAxis } from "./valueAxis.ts";

describe("fitAxis", () => {
  it("fits the axis to the data when the low is above 20% of the high", () => {
    const axis = fitAxis(15_517, 16_343);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThanOrEqual(15_517);
    expect(axis.max).toBeGreaterThanOrEqual(16_343);
  });

  it("starts at 0 when the low is 20% of the high or less", () => {
    expect(fitAxis(2_000, 10_000).min).toBe(0);
    expect(fitAxis(0, 10_000).min).toBe(0);
  });

  it("does not start at 0 just above the 20% line", () => {
    expect(fitAxis(2_001, 10_000).min).toBeGreaterThan(0);
  });

  it("keeps min and max on whole ticks of the interval, the max above the high", () => {
    const { min, max, interval } = fitAxis(1_500, 1_800);
    expect(interval).toBeGreaterThan(0);
    expect(min % interval).toBeCloseTo(0);
    expect(max % interval).toBeCloseTo(0);
    expect(max).toBeGreaterThanOrEqual(1_800);
  });

  it("widens the axis to a mark such as the target without moving the 0 rule", () => {
    const axis = fitAxis(15_517, 16_343, 14_000, 18_500);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThanOrEqual(14_000);
    expect(axis.max).toBeGreaterThanOrEqual(18_500);
  });

  it("starts at 0 when a mark far below the data pulls the fit under 0", () => {
    for (const mark of [1_000, 500]) {
      const axis = fitAxis(15_000, 16_000, mark);
      expect(axis.min).toBe(0);
      expect(axis.max).toBeGreaterThanOrEqual(16_000);
      expect(axis.interval).toBeGreaterThan(0);
    }
  });

  it("goes below 0 when the low is negative", () => {
    expect(fitAxis(-500, 10_000).min).toBeLessThanOrEqual(-500);
  });

  it("copes with a flat series at or below 0", () => {
    for (const flat of [0, -100]) {
      const { min, max, interval } = fitAxis(flat, flat);
      expect(interval).toBeGreaterThan(0);
      expect(min).toBeLessThanOrEqual(flat);
      expect(max).toBeGreaterThanOrEqual(flat);
    }
  });

  it("copes with a flat series", () => {
    const { min, max } = fitAxis(1_800, 1_800);
    expect(min).toBeLessThan(1_800);
    expect(max).toBeGreaterThan(1_800);
  });
});
