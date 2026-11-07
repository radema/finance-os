import { describe, expect, it } from "vitest";
import type { CashFlow } from "../../engine/schemas.ts";
import { hasUnsavedValues, isUnset, savedDocument, toValues } from "./cashFlowForm.ts";

const stored: CashFlow = {
  income: 3_000_000,
  incomeGrowth: 0.01,
  essential: 150_000,
  optional: 50_000,
  expenseGrowth: 0.005,
  events: [{ year: 2030, label: "Car", amount: -1_000_000 }],
};

describe("Cash flow save model (AC-89)", () => {
  it("saves the typed values with the stored events when Save cash flow is pressed", () => {
    const typed = { ...toValues(stored), income: "40000", incomeGrowth: "2" };
    expect(savedDocument(typed, stored.events)).toEqual({
      ...stored,
      income: 4_000_000,
      incomeGrowth: 0.02,
    });
  });

  it("reads Saved when the typed values match the stored ones, Unsaved changes otherwise", () => {
    expect(hasUnsavedValues(toValues(stored), stored)).toBe(false);
    expect(hasUnsavedValues({ ...toValues(stored), optional: "501" }, stored)).toBe(true);
    expect(hasUnsavedValues({ ...toValues(stored), income: "30000,0" }, stored)).toBe(false);
    expect(hasUnsavedValues({ ...toValues(stored), income: "" }, stored)).toBe(true);
  });
});

describe("Cash flow with nothing saved (AC-89)", () => {
  const empty: CashFlow = {
    income: 0,
    incomeGrowth: 0,
    essential: 0,
    optional: 0,
    expenseGrowth: 0,
    events: [],
  };
  const blank = { income: "", incomeGrowth: "", essential: "", optional: "", expenseGrowth: "" };

  it("shows empty fields, not 0, when no cash flow is saved", () => {
    expect(isUnset(empty)).toBe(true);
    expect(toValues(empty)).toEqual(blank);
  });

  it("reads Saved on the empty fields and Unsaved changes once a 0 is typed", () => {
    expect(hasUnsavedValues(blank, empty)).toBe(false);
    expect(hasUnsavedValues({ ...blank, income: "0" }, empty)).toBe(true);
    expect(hasUnsavedValues({ ...blank, income: "36000" }, empty)).toBe(true);
  });

  it("keeps the zeros once an income, an expense or an event is saved", () => {
    expect(isUnset({ ...empty, optional: 1 })).toBe(false);
    expect(isUnset({ ...empty, incomeGrowth: 0.02 })).toBe(false);
    expect(isUnset({ ...empty, expenseGrowth: 0.01 })).toBe(false);
    expect(isUnset({ ...empty, events: [{ year: 2030, label: "x", amount: 1 }] })).toBe(false);
    expect(toValues({ ...empty, essential: 150_000 })).toMatchObject({
      income: "0",
      incomeGrowth: "0",
      optional: "0",
    });
  });
});

describe("Cash flow saved as zeros (AC-89)", () => {
  const zeros: CashFlow = {
    income: 0,
    incomeGrowth: 0,
    essential: 0,
    optional: 0,
    expenseGrowth: 0,
    events: [],
  };
  const typedZeros = {
    income: "0",
    incomeGrowth: "0",
    essential: "0",
    optional: "0",
    expenseGrowth: "0",
  };

  it("reads Saved after Save cash flow stores five zeros and no events", () => {
    expect(savedDocument(typedZeros, [])).toEqual(zeros);
    expect(hasUnsavedValues(typedZeros, zeros)).toBe(false);
    expect(hasUnsavedValues({ ...typedZeros, optional: "10" }, zeros)).toBe(true);
  });

  it("keeps a saved growth when income, essential and optional are 0", () => {
    const withGrowth = { ...zeros, incomeGrowth: 0.02 };
    expect(toValues(withGrowth)).toMatchObject({ incomeGrowth: "2", income: "0" });
    expect(hasUnsavedValues(toValues(withGrowth), withGrowth)).toBe(false);
  });
});
