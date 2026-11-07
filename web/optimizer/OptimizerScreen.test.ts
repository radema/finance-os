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

describe("Optimizer scatter (AC-84, AC-89)", () => {
  const exhibits = (mixes: MixView[]) =>
    renderToStaticMarkup(
      createElement(Exhibits, { view: { ...view, mixes }, goal, names, isPension: false }),
    );

  it("draws the chart when there are two or more mixes", () => {
    const html = exhibits([mix(0.5), mix(0.9)]);
    expect(html).toContain('class="chart"');
    expect(html).not.toContain("Only one mix");
  });

  it("shows one sentence instead of the chart, legend and dot count when there is one mix", () => {
    const html = exhibits([mix(0.9)]);
    expect(html).not.toContain('class="chart"');
    expect(html).not.toContain('class="legend"');
    expect(html).not.toContain("Each dot is");
    expect(html).toContain("Only one mix fits your limits: World ETF 100%.");
  });
});

describe("Optimizer tables and headline (AC-84, AC-89)", () => {
  const sample = new Map([
    ["etf", "Sample World Equity ETF"],
    ["btp", "Sample Govt Bond 2029"],
  ]);
  const two = (p: number): MixView => ({
    ...mix(p),
    weights: [
      { productId: "etf", weight: 0.6 },
      { productId: "btp", weight: 0.4 },
    ],
  });
  const result = (candidate: OptimizerRunView) =>
    renderToStaticMarkup(
      createElement(Result, {
        view: candidate,
        goal,
        names: sample,
        isPension: false,
        onApplied: () => {},
      }),
    );
  const exhibits = (candidate: OptimizerRunView) =>
    renderToStaticMarkup(
      createElement(Exhibits, { view: candidate, goal, names: sample, isPension: false }),
    );
  const clear = { ...view, current: mix(0.5), chosen: two(0.9), top: [two(0.9)] };
  const small = { ...clear, current: mix(0.9), chosen: two(0.9) };

  it("adds a Change column with a sign to each row of the outcomes table", () => {
    const html = result(clear);
    expect(html).toContain('<th class="num">Change</th>');
    expect(html).toContain("+400,00");
    expect(html).toContain("+40\u00a0pts");
  });

  it("shows short names in the headline and the Top 10, and the full names in a tooltip", () => {
    const html = result(clear) + exhibits(clear);
    expect(html).toContain("World Equity ETF 60%, Govt Bond 2029 40%");
    expect(html).toContain('title="Sample World Equity ETF 60%, Sample Govt Bond 2029 40%"');
  });

  it("puts the small-gain note above the button only when the gain is small", () => {
    expect(result(small)).toContain("The gain is small");
    expect(result(clear)).not.toContain("The gain is small");
  });
});
