import { describe, expect, it } from "vitest";
import type { MixView } from "../../engine/optimizerView.ts";
import {
  defaultUniverse,
  eligibleProducts,
  mixText,
  onlyMixSentence,
  outcomeRows,
  scatterAxisStart,
  spreadMixes,
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

describe("spreadMixes", () => {
  const at = (p: number, median: number): MixView => ({ ...mix([["etf", 1]], p), median });

  it("keeps the true chance and typical case: y is the median, the mix is the input object", () => {
    const stack = [at(0.99, 3000), at(0.995, 3010), at(0.99, 3020), at(1, 3005), at(0.8, 1000)];
    const points = spreadMixes(stack, 0.7, 1, 0);
    expect(points).toHaveLength(stack.length);
    points.forEach((point, index) => {
      expect(point.mix).toBe(stack[index]);
      expect(point.y).toBe(stack[index].median);
      expect(point.mix.p).toBe(stack[index].p);
    });
  });

  it("moves a stack of dots side by side, nearest to their chance, and keeps the first one in place", () => {
    const stack = [at(0.99, 3000), at(0.99, 3001), at(0.99, 3002), at(0.99, 3003)];
    const xs = spreadMixes([...stack, at(0.8, 1000)], 0.7, 1, 0).map((point) => point.x);
    expect(new Set(xs.slice(0, 4)).size).toBe(4);
    expect(xs[0]).toBe(0.99);
    expect(Math.max(...xs.slice(0, 4).map((x) => Math.abs(x - 0.99)))).toBeLessThan(0.02);
  });

  it("keeps a stack that fits in the lanes one dot width apart", () => {
    const stack = Array.from({ length: 7 }, (_, index) => at(0.9, 3000 + index));
    const xs = spreadMixes([...stack, at(0.8, 1000)], 0.7, 1, 0).map((point) => point.x);
    const sorted = xs.slice(0, 7).sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((x, index) => x - sorted[index]);
    expect(Math.min(...gaps)).toBeGreaterThan(0.004);
  });

  it("leaves a dot with no neighbour where it is", () => {
    const points = spreadMixes([at(0.8, 1000), at(0.95, 5000)], 0.7, 1, 0);
    expect(points.map((point) => point.x)).toEqual([0.8, 0.95]);
  });

  it("keeps a stack at the right edge inside the axis", () => {
    const stack = Array.from({ length: 4 }, (_, index) => at(1, 3000 + index));
    const xs = spreadMixes([...stack, at(0.8, 1000)], 0.7, 1, 0).map((point) => point.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    expect(new Set(xs.slice(0, 4)).size).toBe(4);
  });

  it("draws a 286-mix stack near 100% at most three dots from its chance, and lets the rest overlap", () => {
    const stack = Array.from({ length: 286 }, (_, index) => at(0.999, 3000 + index / 100));
    const points = spreadMixes([...stack, at(0.8, 1000)], 0.7, 1, 0.9);
    const lane = (1 - 0.7) * 0.015;
    const shifts = points.map((point) => Math.abs(point.x - point.mix.p));
    expect(Math.max(...shifts)).toBeLessThanOrEqual(3 * lane + 1e-9);
  });

  it("never draws a dot across the required chance, from the side of its true chance", () => {
    const stack = [
      ...Array.from({ length: 30 }, (_, index) => at(0.9, 3000 + index)),
      ...Array.from({ length: 30 }, (_, index) => at(0.8999, 3000 + index)),
    ];
    const points = spreadMixes(stack, 0.7, 1, 0.9);
    for (const point of points) {
      if (point.mix.p >= 0.9) expect(point.x).toBeGreaterThanOrEqual(0.9);
      else expect(point.x).toBeLessThan(0.9);
    }
  });

  it("keeps a failing stack just under the required chance on the failing side", () => {
    const stack = Array.from({ length: 6 }, () => at(0.8999, 3000));
    for (const point of spreadMixes(stack, 0.7, 1, 0.9)) expect(point.x).toBeLessThan(0.9);
  });

  it("returns nothing for no mixes and does not divide by zero for one", () => {
    expect(spreadMixes([], 0.7, 1, 0)).toEqual([]);
    expect(spreadMixes([at(0.9, 100)], 0.7, 1, 0)[0].x).toBe(0.9);
  });
});

describe("onlyMixSentence", () => {
  it("names the one mix and says there is nothing to compare", () => {
    const names = new Map(products.map((p) => [p.id, p.name]));
    const sentence = onlyMixSentence(mix([["etf", 1]], 0.9).weights, names);
    expect(sentence).toBe(
      "Only one mix fits your limits: World ETF 100%. There is nothing to compare, so there is no chart.",
    );
  });
});
