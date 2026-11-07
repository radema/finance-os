import { describe, expect, it } from "vitest";
import { previewWeights } from "./allocationWeights.ts";

const rows = [
  { productId: "a", weight: 2 },
  { productId: "b", weight: 1 },
  { productId: "c", weight: 1 },
];

describe("previewWeights (AC-89)", () => {
  it("returns no change and the stored shares when nothing was typed", () => {
    const { changed, shares } = previewWeights(rows, {});
    expect(changed).toEqual([]);
    expect(shares.get("a")).toBe(0.5);
    expect(shares.get("b")).toBe(0.25);
  });

  it("returns only the weights whose text differs from the stored number", () => {
    const { changed } = previewWeights(rows, { a: "2", b: "3", c: "1,0" });
    expect(changed).toEqual([{ productId: "b", weight: 3 }]);
  });

  it("returns three changed weights when three are typed", () => {
    const { changed } = previewWeights(rows, { a: "5", b: "6", c: "7" });
    expect(changed.map((c) => c.productId)).toEqual(["a", "b", "c"]);
  });

  it("rescales the typed weights so the shares sum to 100%", () => {
    const { shares } = previewWeights(rows, { a: "1", b: "1", c: "2" });
    expect(shares.get("a")).toBe(0.25);
    expect(shares.get("c")).toBe(0.5);
    expect([...shares.values()].reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  });

  it("flags text that is not a number as changed, and keeps the stored weight in the shares", () => {
    const { changed, shares } = previewWeights(rows, { b: "abc" });
    expect(changed).toHaveLength(1);
    expect(changed[0]?.productId).toBe("b");
    expect(Number.isNaN(changed[0]?.weight)).toBe(true);
    expect(shares.get("b")).toBe(0.25);
  });

  it("ignores an edit for a product that has no row any more", () => {
    expect(previewWeights(rows, { gone: "9" }).changed).toEqual([]);
  });
});
