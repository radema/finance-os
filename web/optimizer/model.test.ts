import { describe, expect, it } from "vitest";
import type { MixView } from "../../engine/optimizerView.ts";
import {
  defaultUniverse,
  eligibleProducts,
  mixText,
  outcomeRows,
  scatterAxisStart,
  weightRows,
} from "./model.ts";

const products = [
  { id: "etf", name: "World ETF", regime: "etf" },
  { id: "btp", name: "Govt 2029", regime: "govt" },
  { id: "pf", name: "Pension Fund", regime: "pension" },
];
const mix = (weights: [string, number][], p: number): MixView => ({
  weights: weights.map(([productId, weight]) => ({ productId, weight })),
  p,
  median: 1000 * p,
  p10: 500 * p,
  p90: 1500 * p,
  shortfall: 0,
  detValue: 0,
});

describe("eligibleProducts", () => {
  it("offers pension funds to the pension goal only", () => {
    expect(eligibleProducts(products, true).map((p) => p.id)).toEqual(["pf"]);
    expect(eligibleProducts(products, false).map((p) => p.id)).toEqual(["etf", "btp"]);
  });
});

describe("defaultUniverse", () => {
  const rows = [
    { goalId: "g1", productId: "btp" },
    { goalId: "g2", productId: "etf" },
  ];
  it("starts with the products the goal holds in its allocation", () => {
    expect(defaultUniverse("g1", rows, products.slice(0, 2))).toEqual(["btp"]);
  });
  it("falls back to the first eligible products when the goal has no allocation", () => {
    expect(defaultUniverse("g3", rows, products.slice(0, 2))).toEqual(["etf", "btp"]);
  });
  it("never goes over six products", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: "x", regime: "etf" }));
    expect(defaultUniverse("g3", [], many)).toHaveLength(6);
  });
});

describe("outcomeRows", () => {
  it("puts the bad, typical and good case of the current and the suggested mix side by side", () => {
    const rows = outcomeRows(mix([["etf", 1]], 0.5), mix([["etf", 1]], 0.8));
    expect(rows).toEqual([
      { label: "Bad case", current: 250, suggested: 400 },
      { label: "Typical case", current: 500, suggested: 800 },
      { label: "Good case", current: 750, suggested: 1200 },
    ]);
  });
});

describe("weightRows", () => {
  it("lists every product of either mix, the biggest weight first", () => {
    const rows = weightRows(
      mix(
        [
          ["etf", 0.6],
          ["btp", 0.4],
        ],
        0.5,
      ),
      mix(
        [
          ["pf", 0.1],
          ["btp", 0.9],
        ],
        0.5,
      ),
    );
    expect(rows).toEqual([
      { productId: "btp", current: 0.4, suggested: 0.9 },
      { productId: "etf", current: 0.6, suggested: 0 },
      { productId: "pf", current: 0, suggested: 0.1 },
    ]);
  });
});

describe("mixText", () => {
  it("names the products with it-IT percentages", () => {
    const names = new Map(products.map((p) => [p.id, p.name]));
    expect(
      mixText(
        mix(
          [
            ["etf", 0.65],
            ["btp", 0.35],
          ],
          0.5,
        ).weights,
        names,
      ),
    ).toBe("World ETF 65%, Govt 2029 35%");
  });
});

describe("scatterAxisStart", () => {
  it.each([
    [0.75, 0.7],
    [0.99, 0.95],
    [0.02, 0],
    [0.5, 0.45],
  ])("starts the axis for a lowest chance of %s at exactly %s", (lowest, start) => {
    expect(scatterAxisStart(lowest)).toBe(start);
  });
});
