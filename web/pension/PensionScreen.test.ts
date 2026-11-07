import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PensionThisYear } from "../../engine/pensionView.ts";
import { ThisYear } from "./PensionScreen.tsx";

const year: PensionThisYear = {
  year: 2026,
  cap: 5_164.57,
  extra: 0,
  used: 1_000,
  available: 4_164.57,
  nonDeducted: 0,
  voluntaryYtd: 500,
  refund: 300,
  refundYear: 2027,
  exitRate: null,
  exitTax: null,
  exitTaxYear: null,
};
const render = (hasGoal: boolean) =>
  renderToStaticMarkup(createElement(ThisYear, { year, hasGoal }));

describe("Pension KPIs (DESIGN.md: a KPI with no goal has no dot)", () => {
  it("carry the goal dot when a pension goal exists", () => {
    expect(render(true)).toContain('<div class="kpis">');
    expect(render(true)).not.toContain("kpis-no-goal");
  });

  it("have no dot without a pension goal", () => {
    expect(render(false)).toContain('<div class="kpis kpis-no-goal">');
  });
});
