import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitControl } from "./SplitControl.tsx";

const render = (props: Partial<Parameters<typeof SplitControl>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SplitControl, {
      product: { name: "World ETF", regime: "etf" },
      totalUnits: 7,
      buckets: [
        { goalId: "A", name: "Home", slot: 1, weight: 50 },
        { goalId: "B", name: "Retire", slot: 2, weight: 50 },
      ],
      onConfirm: () => {},
      ...props,
    }),
  );

describe("SplitControl first render", () => {
  it("shows nothing chosen, the units to assign, three modes and a blocked confirm", () => {
    const html = render();
    expect(html).toContain("Choose how to split the units.");
    expect(html).toContain("7 units to assign");
    for (const label of ["One bucket", "By weights", "By units"]) expect(html).toContain(label);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm split/);
  });

  it("disables 'By weights' when no bucket has a weight", () => {
    const html = render({ buckets: [{ goalId: "A", name: "Home", slot: 1 }] });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>By weights/);
  });
});
