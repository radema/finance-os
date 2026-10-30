import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normaliseWeights } from "./weights.ts";

describe("normaliseWeights", () => {
  it("turns 2, 1, 1 into 50%, 25%, 25%", () => {
    expect(normaliseWeights([2, 1, 1])).toEqual([0.5, 0.25, 0.25]);
  });

  it("allocates nothing when every weight is 0", () => {
    expect(normaliseWeights([0, 0])).toEqual([0, 0]);
  });

  it("gives shares that sum to 1 for any weights with a positive total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 12 }),
        (weights) => {
          fc.pre(weights.some((w) => w > 0));
          const total = normaliseWeights(weights).reduce((a, b) => a + b, 0);
          expect(total).toBeCloseTo(1, 9);
        },
      ),
    );
  });
});
