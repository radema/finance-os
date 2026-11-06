import { describe, expect, it } from "vitest";
import { reloadableCards } from "./reloadableCards.tsx";

const noop = () => {};
const keysFor = (reviewKey: number, gridKey: number) =>
  reloadableCards({ reviewKey, gridKey, onReviewChanged: noop, onGridChanged: noop }).map(
    (card) => card.key,
  );

describe("reloadableCards", () => {
  it("gives the two cards distinct keys when their reload counters are equal", () => {
    // Both counters start at 0 and bump together on a re-fetch: equal keys made the siblings
    // collide, which left a stale "Online prices" card in the page.
    for (const count of [0, 3]) {
      const [review, grid] = keysFor(count, count);
      expect(review).not.toBe(grid);
    }
  });

  it("changes a card key when its counter changes, so the card remounts", () => {
    expect(keysFor(1, 0)[0]).not.toBe(keysFor(0, 0)[0]);
    expect(keysFor(0, 1)[1]).not.toBe(keysFor(0, 0)[1]);
  });
});
