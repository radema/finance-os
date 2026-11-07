import type { CashFlow, CashFlowEvent } from "../../engine/schemas.ts";
import { centsToEuros, eurosToCents, fractionToPercent, percentToFraction } from "../forms.ts";

/** The five inputs of the Cash flow form, as typed. */
export type Values = {
  income: string;
  incomeGrowth: string;
  essential: string;
  optional: string;
  expenseGrowth: string;
};

/** True when no cash flow is saved: the stored zeros are defaults, not values the user typed. */
export const isUnset = (c: CashFlow): boolean =>
  c.income === 0 &&
  c.incomeGrowth === 0 &&
  c.essential === 0 &&
  c.optional === 0 &&
  c.expenseGrowth === 0 &&
  c.events.length === 0;

/** The typed values of a stored document. With nothing saved the fields are empty, not "0". */
export const toValues = (c: CashFlow): Values =>
  isUnset(c)
    ? { income: "", incomeGrowth: "", essential: "", optional: "", expenseGrowth: "" }
    : {
        income: centsToEuros(c.income),
        incomeGrowth: fractionToPercent(c.incomeGrowth),
        essential: centsToEuros(c.essential),
        optional: centsToEuros(c.optional),
        expenseGrowth: fractionToPercent(c.expenseGrowth),
      };

/** The document "Save cash flow" sends: the typed values with the stored events. */
export const savedDocument = (v: Values, events: CashFlowEvent[]): CashFlow => ({
  income: eurosToCents(v.income),
  incomeGrowth: percentToFraction(v.incomeGrowth),
  essential: eurosToCents(v.essential),
  optional: eurosToCents(v.optional),
  expenseGrowth: percentToFraction(v.expenseGrowth),
  events,
});

/**
 * True when the typed values differ from the stored ones. A bad field counts as a change; an empty
 * one only when the stored value is a number. With nothing saved, the empty form reads Saved, and so
 * do five typed zeros: Save cash flow would store the same document.
 */
export function hasUnsavedValues(v: Values, stored: CashFlow): boolean {
  const typed = savedDocument(v, stored.events);
  const fields = ["income", "incomeGrowth", "essential", "optional", "expenseGrowth"] as const;
  if (isUnset(stored)) {
    const numbers = fields.map((key) => typed[key]);
    return !(numbers.every(Number.isNaN) || numbers.every((n) => n === 0));
  }
  const shown = savedDocument(toValues(stored), stored.events);
  return fields.some((key) => !Object.is(typed[key], shown[key]));
}
