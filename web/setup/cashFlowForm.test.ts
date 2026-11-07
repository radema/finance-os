import { describe, expect, it } from "vitest";
import type { CashFlow, CashFlowEvent } from "../../engine/schemas.ts";
import { eventsDocument, hasUnsavedValues, savedDocument, toValues } from "./cashFlowForm.ts";

const stored: CashFlow = {
  income: 3_000_000,
  incomeGrowth: 0.01,
  essential: 150_000,
  optional: 50_000,
  expenseGrowth: 0.005,
  events: [{ year: 2030, label: "Car", amount: -1_000_000 }],
};
const added: CashFlowEvent = { year: 2031, label: "Gift", amount: 200_000 };

describe("Cash flow save model (AC-89)", () => {
  it("saves events with the stored income and expenses, never the typed ones", () => {
    expect(eventsDocument(stored, [...stored.events, added])).toEqual({
      ...stored,
      events: [...stored.events, added],
    });
  });

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
