import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FiPoint, FiResult } from "../../engine/financialIndependence.ts";
import type { IndependenceView } from "../../engine/independenceView.ts";
import { Screen } from "./IndependenceScreen.tsx";

const band = { p10: 0, p50: 0, p90: 0, deterministic: 0 };
const levels = [12_000, 200_000, 300_000, 400_000];
const point = (year: number, t: number): FiPoint => ({
  year,
  t,
  total: band,
  nonPension: band,
  targets: levels,
  pReached: [1, 0.4, 0.2, 0.1],
  progress: [1, 0.1, 0.1, 0.1],
});
const result: FiResult = {
  levels,
  wealthToday: { total: 24_000, nonPension: 18_000, pension: 6_000 },
  points: [point(2026, 0), point(2046, 20.17)],
  reached: levels.map(() => ({ median: 2040, deterministic: 2041 })),
  correlationShrunk: false,
};
const view: IndependenceView = {
  asOf: "2026-10-31",
  fire: {
    efFromGoal: null,
    efMonths: 12,
    baristaMult: 200,
    l2Mult: 300,
    l3Mult: 200,
    includePension: true,
  },
  expenses: { essentialCents: 100_000, optionalCents: 50_000, expenseGrowth: 0 },
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
  ],
  result,
  note: null,
};

describe("Independence screen (AC-62)", () => {
  const html = renderToStaticMarkup(createElement(Screen, { view, onView: () => {} }));

  it("shows one tile per level, named Financial security, Barista FIRE, Lean FIRE and Financial Freedom", () => {
    const tiles = [...html.matchAll(/<section class="kpi level-tile" aria-label="([^"]+)"/g)];
    expect(tiles.map((tile) => tile[1])).toEqual([
      "Financial security",
      "Barista FIRE",
      "Lean FIRE",
      "Financial Freedom",
    ]);
  });

  it("has a Barista FIRE multiplier field under Level rules, holding the stored value", () => {
    expect(html).toContain("Barista FIRE multiplier (months of essential)");
    expect(html).toMatch(/Lean FIRE multiplier \(months of essential\)/);
    expect(html).toMatch(/Financial Freedom multiplier \(months of optional, added to Lean FIRE\)/);
    expect(html).toMatch(/value="200"/);
  });

  it("does not call the levels by number", () => {
    expect(html).not.toMatch(/Level [1-4]/);
  });
});
