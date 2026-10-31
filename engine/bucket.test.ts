import { describe, expect, it } from "vitest";
import { assignBucket, type BucketWeight } from "./bucket.ts";
import type { Holdings } from "./holdings.ts";

const holdings = (units: Record<string, Record<string, number>>): Holdings => ({
  units: new Map(Object.entries(units).map(([goal, p]) => [goal, new Map(Object.entries(p))])),
  accountUnits: new Map(),
  pmc: new Map(),
});
const w = (goalId: string, productId: string, weight = 1): BucketWeight => ({
  goalId,
  productId,
  weight,
});

describe("assignBucket", () => {
  it("takes the bucket column first, even when other buckets hold the product", () => {
    const h = holdings({ A: { etf: 5 }, B: { etf: 5 } });
    expect(assignBucket({ productId: "etf", bucket: "B" }, h, [w("A", "etf")])).toEqual({
      goalId: "B",
      via: "column",
    });
  });

  it("assigns the only bucket that holds the product", () => {
    const h = holdings({ A: { etf: 5 }, B: { bond: 3 } });
    expect(assignBucket({ productId: "etf" }, h, [])).toEqual({ goalId: "A", via: "holding" });
  });

  it("assigns the only bucket that has the product in its weights", () => {
    const h = holdings({});
    const weights = [w("A", "bond"), w("B", "etf")];
    expect(assignBucket({ productId: "etf" }, h, weights)).toEqual({
      goalId: "B",
      via: "weights",
    });
  });

  it("counts one bucket once when it both holds the product and weights it", () => {
    const h = holdings({ A: { etf: 5 } });
    expect(assignBucket({ productId: "etf" }, h, [w("A", "etf")])).toEqual({
      goalId: "A",
      via: "holding",
    });
  });

  it("combines a holding bucket and a different weighted bucket into two candidates", () => {
    const h = holdings({ A: { etf: 5 } });
    expect(assignBucket({ productId: "etf" }, h, [w("B", "etf")])).toEqual({
      needsGoal: true,
      candidates: ["A", "B"],
    });
  });

  it("needs a goal when no bucket holds or weights the product", () => {
    const h = holdings({ A: { bond: 5 } });
    expect(assignBucket({ productId: "etf" }, h, [w("A", "bond")])).toEqual({
      needsGoal: true,
      candidates: [],
    });
  });

  it("needs a goal when several buckets hold the product", () => {
    const h = holdings({ A: { etf: 5 }, B: { etf: 2 } });
    expect(assignBucket({ productId: "etf" }, h, [])).toEqual({
      needsGoal: true,
      candidates: ["A", "B"],
    });
  });

  it("ignores a bucket whose units for the product are 0 and a weight of 0", () => {
    const h = holdings({ A: { etf: 5 }, B: { etf: 0 } });
    expect(assignBucket({ productId: "etf" }, h, [w("C", "etf", 0)])).toEqual({
      goalId: "A",
      via: "holding",
    });
  });

  it("needs a goal when the bucket column names an unknown bucket", () => {
    const h = holdings({ A: { etf: 5 } });
    expect(assignBucket({ productId: "etf", bucket: null }, h, [])).toEqual({
      needsGoal: true,
      candidates: ["A"],
    });
  });
});
