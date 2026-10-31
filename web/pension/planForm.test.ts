import { describe, expect, it } from "vitest";
import type { PensionPlan } from "../../engine/schemas.ts";
import { planToValues, valuesToPlan } from "./planForm.ts";

const plan: PensionPlan = {
  goalId: "g",
  firstYear: 2020,
  ral: 4_000_000,
  ralGrowth: 0.02,
  tfrPct: 0.0691,
  workerPct: 0.01,
  employerPct: 0.01,
  voluntary: null,
  marginalRate: 0.35,
  extra: 265_000,
  flows: [
    { productId: "a", flow: "Work", pct: 1 },
    { productId: "b", flow: "Voluntary", pct: 0.4 },
  ],
};

describe("pension plan form", () => {
  it("turns a plan into text and back, a blank voluntary staying 'to cap'", () => {
    const values = planToValues(plan, "g");
    expect(values).toMatchObject({ ral: "40000", ralGrowth: "2", voluntary: "", "work:a": "100" });
    expect(valuesToPlan(values, ["a", "b"])).toEqual(plan);
  });

  it("starts a new plan with the spec's TFR % and extra deduction, and no RAL", () => {
    const values = planToValues(null, "g");
    expect(values).toMatchObject({ goalId: "g", tfrPct: "6.91", extra: "2650", ral: "" });
    expect(valuesToPlan({ ...values, firstYear: "2020" }, ["a"])).toMatchObject({
      goalId: "g",
      firstYear: 2020,
      ral: undefined,
      voluntary: null,
      tfrPct: 0.0691,
      extra: 265_000,
      flows: [],
    });
  });

  it("makes a bad number NaN so the server names the field", () => {
    expect(valuesToPlan({ ...planToValues(plan, "g"), firstYear: "" }, []).firstYear).toBeNaN();
  });
});
