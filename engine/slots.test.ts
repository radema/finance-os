import { describe, expect, it } from "vitest";
import { goalSlot } from "./slots.ts";

describe("goalSlot", () => {
  const ids = ["holiday", "car", "home", "retirement"].map((id) => ({ id }));

  it("gives the pension goal slot 1 and the others slots 2, 3, ... in creation order", () => {
    expect(ids.map((id) => goalSlot(id, ids, "retirement"))).toEqual([2, 3, 4, 1]);
  });

  it("starts at slot 2 when no goal is the pension goal", () => {
    expect(ids.map((id) => goalSlot(id, ids))).toEqual([2, 3, 4, 5]);
  });

  it("repeats the colours past slot 6", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
    expect(many.map((id) => goalSlot(id, many))).toEqual([2, 3, 4, 5, 6, 2, 3]);
  });
});
