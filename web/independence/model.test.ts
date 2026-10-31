import { describe, expect, it } from "vitest";
import type { FiPoint, FiResult } from "../../engine/financialIndependence.ts";
import type { IndependenceView } from "../../engine/independenceView.ts";
import { ladderRows, parseDraft, reachedWithin } from "./model.ts";

const band = { p10: 0, p50: 0, p90: 0, deterministic: 0 };
const point = (year: number, t: number, pReached: number[]): FiPoint => ({
  year,
  t,
  total: band,
  nonPension: band,
  targets: [12_000, 300_000, 400_000],
  pReached,
  progress: [1.5, 0.08, 0.06],
});

// Today 2026, 21 points are enough: the 20-year point is the one of year 2046.
const points: FiPoint[] = [
  point(2026, 0, [1, 0, 0]),
  ...Array.from({ length: 21 }, (_, k) => point(2026 + k, k + 0.17, [1, k / 100, k / 200])),
];

const result: FiResult = {
  levels: [12_000, 300_000, 400_000],
  wealthToday: { total: 24_000, nonPension: 18_000, pension: 6_000 },
  points,
  reached: [
    { median: 2026, deterministic: 2026 },
    { median: null, deterministic: 2060 },
    { median: null, deterministic: null },
  ],
  correlationShrunk: false,
};

const view: IndependenceView = {
  asOf: "2026-10-31",
  fire: { efFromGoal: null, efMonths: 12, l2Mult: 300, l3Mult: 200, includePension: true },
  expenses: { essentialCents: 100_000, optionalCents: 50_000, expenseGrowth: 0.02 },
  inflation: 0.02,
  goals: [
    {
      id: "g-home",
      name: "Home",
      slot: 4,
      target: 40_000,
      countsTowardFi: true,
      isPension: false,
      today: 18_000,
    },
    {
      id: "g-ret",
      name: "Retirement",
      slot: 1,
      target: 150_000,
      countsTowardFi: true,
      isPension: true,
      today: 6_000,
    },
    {
      id: "g-car",
      name: "Car",
      slot: 3,
      target: 20_000,
      countsTowardFi: false,
      isPension: false,
      today: 0,
    },
  ],
  result,
  note: null,
};

describe("ladderRows (AC-62)", () => {
  it("splits each level by goal and leaves the pension out of Level 1", () => {
    const [l1, l2, l3] = ladderRows(view) ?? [];
    expect(l1?.segments.map((s) => [s.goalId, s.value])).toEqual([["g-home", 18_000]]);
    expect(l1?.wealth).toBe(18_000);
    expect(l1?.progress).toBeCloseTo(1.5, 12);
    expect(l1?.pensionShare).toBe(0);
    expect(l2?.segments.map((s) => [s.goalId, s.value])).toEqual([
      ["g-home", 18_000],
      ["g-ret", 6_000],
    ]);
    // 24,000 of 300,000 is 8%; the pension is 6,000 of the 24,000.
    expect(l2?.progress).toBeCloseTo(0.08, 12);
    expect(l2?.pensionShare).toBeCloseTo(0.25, 12);
    expect(l3?.progress).toBeCloseTo(0.06, 12);
  });

  it("has no progress when the target is 0", () => {
    const empty = { ...view, result: { ...result, levels: [0, 0, 0] } };
    expect(ladderRows(empty)?.map((row) => row.progress)).toEqual([null, null, null]);
  });

  it("is null without a result", () => {
    expect(ladderRows({ ...view, result: null })).toBeNull();
  });
});

describe("reachedWithin", () => {
  it("reads the point of the calendar year Y0 + 20", () => {
    expect(reachedWithin(view, 1)).toEqual({ year: 2046, p: 0.2 });
    expect(reachedWithin(view, 2)).toEqual({ year: 2046, p: 0.1 });
  });
});

describe("parseDraft", () => {
  const draft = {
    l2Mult: "250",
    l3Mult: "200",
    efMonths: "12",
    essential: "1000",
    optional: "500",
  };

  it("turns the text into numbers and cents", () => {
    expect(parseDraft(draft)).toEqual({
      l2Mult: 250,
      l3Mult: 200,
      efMonths: 12,
      essentialCents: 100_000,
      optionalCents: 50_000,
    });
  });

  it("refuses empty, negative and non-numeric text", () => {
    expect(parseDraft({ ...draft, l2Mult: "" })).toBeNull();
    expect(parseDraft({ ...draft, efMonths: "-1" })).toBeNull();
    expect(parseDraft({ ...draft, essential: "abc" })).toBeNull();
  });
});
