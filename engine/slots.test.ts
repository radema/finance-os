import { describe, expect, it } from "vitest";
import { goalSlot } from "./slots.ts";

describe("goalSlot", () => {
  const ids = ["holiday", "car", "home", "retirement"].map((id) => ({ id }));

  it("gives goals 1 to 5 the slots 2 to 6 in creation order; slot 1 is kept for the message", () => {
    expect(ids.map((id) => goalSlot(id, ids))).toEqual([2, 3, 4, 5]);
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    expect(five.map((id) => goalSlot(id, five))).toEqual([2, 3, 4, 5, 6]);
  });

  it("gives goal 6 and later the neutral grey slot 7, with no cap", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));
    expect(many.map((id) => goalSlot(id, many))).toEqual([2, 3, 4, 5, 6, 7, 7, 7]);
  });
});
