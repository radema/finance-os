import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AllocationRow, Goal, Product } from "../../engine/schemas.ts";
import { GoalWeights } from "./AllocationTab.tsx";

const goal = { id: "g", name: "Car", priority: "Medium" } as unknown as Goal;
const products = [
  { id: "a", name: "World" },
  { id: "b", name: "Gold" },
] as unknown as Product[];
const rows: AllocationRow[] = [
  { goalId: "g", productId: "a", weight: 2, share: 2 / 3 },
  { goalId: "g", productId: "b", weight: 1, share: 1 / 3 },
];

const render = (readOnly: boolean) =>
  renderToStaticMarkup(
    createElement(GoalWeights, { goal, products, rows, readOnly, onChange: () => {} }),
  );

describe("Allocation goal card (AC-89)", () => {
  it("has one Save per card, a Share column and no unsaved cue before an edit", () => {
    const html = render(false);
    expect(html.match(/>Save</g)).toHaveLength(1);
    expect(html).toContain(">Share<");
    expect(html).not.toContain("Unsaved changes");
    expect(html).toContain(">Saved<");
    expect(html).toContain("disabled");
  });

  it("keeps the pension goal's weights read-only", () => {
    const html = render(true);
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain(">Remove<");
    expect(html).not.toContain(">Add weight<");
  });
});
