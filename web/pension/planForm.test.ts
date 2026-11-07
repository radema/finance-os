import { describe, expect, it } from "vitest";
import type { PensionPlan } from "../../engine/schemas.ts";
import { flowKey, isPlanDirty, planToValues, valuesToPlan } from "./planForm.ts";

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

  describe("dirty state", () => {
    const saved = planToValues(plan, "g");

    it("is clean while nothing changed", () => {
      expect(isPlanDirty({ ...saved }, saved)).toBe(false);
    });

    it("is dirty after an input changes", () => {
      expect(isPlanDirty({ ...saved, ral: "41000" }, saved)).toBe(true);
    });

    it("is dirty after a flow share changes or is added", () => {
      expect(isPlanDirty({ ...saved, [flowKey("Work", "a")]: "50" }, saved)).toBe(true);
      expect(isPlanDirty({ ...saved, [flowKey("Work", "b")]: "10" }, saved)).toBe(true);
    });

    it("treats a blank flow share and a missing one alike", () => {
      expect(isPlanDirty({ ...saved, [flowKey("Work", "b")]: "" }, saved)).toBe(false);
    });

    it("is clean again once the saved values are the edited ones", () => {
      const edited = { ...saved, ral: "41000" };
      expect(isPlanDirty(edited, edited)).toBe(false);
    });

    it("is dirty when no plan is stored yet", () => {
      expect(isPlanDirty(planToValues(null, "g"), null)).toBe(true);
    });
  });
});
