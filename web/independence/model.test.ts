import { describe, expect, it } from "vitest";
import type { FiPoint, FiResult } from "../../engine/financialIndependence.ts";
import type { IndependenceView } from "../../engine/independenceView.ts";
import {
  changedSettings,
  ladderRows,
  levelLinesNote,
  levelTiles,
  noLevelSet,
  parseDraft,
  reachedWithin,
  reachTitle,
} from "./model.ts";

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

describe("levelTiles (AC-62)", () => {
  it("reads the typical and deterministic year and the chance in 20 years of each level", () => {
    expect(levelTiles(view)).toEqual([
      {
        level: 0,
        name: "Level 1 Safety",
        target: 12_000,
        set: true,
        typical: 2026,
        deterministic: 2026,
        chance: 1,
      },
      {
        level: 1,
        name: "Level 2",
        target: 300_000,
        set: true,
        typical: null,
        deterministic: 2060,
        chance: 0.2,
      },
      {
        level: 2,
        name: "Level 3",
        target: 400_000,
        set: true,
        typical: null,
        deterministic: null,
        chance: 0.1,
      },
    ]);
  });

  it("marks a level with target 0 as not set and gives it no year or chance", () => {
    const unset = { ...view, result: { ...result, levels: [0, 300_000, 400_000] } };
    expect(levelTiles(unset)?.[0]).toMatchObject({
      set: false,
      typical: null,
      deterministic: null,
      chance: null,
    });
  });

  it("is null without a result", () => {
    expect(levelTiles({ ...view, result: null })).toBeNull();
  });
});

describe("reachTitle", () => {
  const tile = (level: number, typical: number | null, set = true) => ({
    level,
    name: `Level ${level + 1}`,
    target: 1,
    set,
    typical,
    deterministic: null,
    chance: null,
  });

  it("names the levels the typical case reaches and says when one is missing", () => {
    expect(reachTitle([tile(0, 2028), tile(1, 2066), tile(2, null)])).toBe(
      "The typical case reaches Level 1 in 2028 and Level 2 in 2066; not every level within 40 years",
    );
  });

  it("lists three levels with commas", () => {
    expect(reachTitle([tile(0, 2028), tile(1, 2040), tile(2, 2050)])).toBe(
      "The typical case reaches Level 1 in 2028, Level 2 in 2040 and Level 3 in 2050",
    );
  });

  it("says so when no level is reached, and skips a level that is not set", () => {
    expect(reachTitle([tile(0, null), tile(1, null)])).toBe(
      "The typical case reaches no level within 40 years",
    );
    expect(reachTitle([tile(0, null, false), tile(1, 2040)])).toBe(
      "The typical case reaches Level 2 in 2040",
    );
  });
});

describe("levelLinesNote (AC-59)", () => {
  it("says the lines are flat when expenses keep up with prices", () => {
    expect(levelLinesNote(0)).toBe(
      "The level lines are flat because your expenses keep up with prices.",
    );
  });

  it("reads expense growth as growth above inflation", () => {
    expect(levelLinesNote(0.02)).toBe(
      "The level lines rise 2% a year because your expenses grow 2% a year above inflation.",
    );
    expect(levelLinesNote(-0.01)).toBe(
      "The level lines fall 1% a year because your expenses grow 1% a year below inflation.",
    );
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

describe("changedSettings", () => {
  const parsed = { l2Mult: 250, l3Mult: 200, efMonths: 12, essentialCents: 0, optionalCents: 0 };
  const fire = view.fire;

  it("holds only the multipliers that changed, never efFromGoal or includePension", () => {
    expect(changedSettings(parsed, fire)).toEqual({ l2Mult: 250 });
  });

  it("is null when nothing changed", () => {
    expect(changedSettings({ ...parsed, l2Mult: 300 }, fire)).toBeNull();
  });
});

describe("noLevelSet", () => {
  it("is true only when every target is 0, so no expenses are set", () => {
    expect(noLevelSet([0, 0, 0])).toBe(true);
    expect(noLevelSet([0, 300_000, 0])).toBe(false);
    expect(noLevelSet(view.result?.levels ?? [])).toBe(false);
  });
});
