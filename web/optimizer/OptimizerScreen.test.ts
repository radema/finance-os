import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GoalListRow } from "../../engine/goalViews.ts";
import type { MixView, OptimizerRunView } from "../../engine/optimizerView.ts";
import { Exhibits, Result } from "./OptimizerScreen.tsx";

const mix = (p: number): MixView => ({
  weights: [{ productId: "etf", weight: 1 }],
  p,
  median: 1000 * p,
  p10: 500 * p,
  p90: 1500 * p,
  shortfall: 0,
  detValue: 0,
});
const view: OptimizerRunView = {
  asOf: "2026-01-31",
  mode: "new",
  criterion: "O1",
  requiredP: 0.8,
  target: 1000,
  current: mix(0.5),
  chosen: mix(0.9),
  notFeasible: false,
  ruleName: "Highest chance",
  ruleText: "It picks the mix with the highest chance.",
  switchTax: 0,
  mixes: [mix(0.5), mix(0.9)],
  top: [mix(0.9), mix(0.5)],
};
const goal = { id: "g1", name: "House", slot: 1 } as GoalListRow;
const names = new Map([["etf", "World ETF"]]);

const levels = (html: string) => [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));

describe("Optimizer heading order (AC-89)", () => {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement("h1", null, "Optimizer"),
      createElement(Result, { view, goal, names, isPension: false, onApplied: () => {} }),
      createElement(Exhibits, { view, goal, names, isPension: false }),
    ),
  );

  it("never skips a level from the h1 down", () => {
    const outline = levels(html);
    expect(outline[0]).toBe(1);
    outline.slice(1).forEach((level, index) => {
      expect(level).toBeLessThanOrEqual(outline[index] + 1);
    });
  });

  it("puts each card and the exhibit at h2 and the result blocks at h3", () => {
    expect(levels(html)).toEqual([1, 2, 3, 3, 3, 2, 2]);
  });
});
