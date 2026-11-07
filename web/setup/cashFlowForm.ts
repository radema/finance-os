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

export const toValues = (c: CashFlow): Values => ({
  income: centsToEuros(c.income),
  incomeGrowth: fractionToPercent(c.incomeGrowth),
  essential: centsToEuros(c.essential),
  optional: centsToEuros(c.optional),
  expenseGrowth: fractionToPercent(c.expenseGrowth),
});

/** The document "Save cash flow" sends: the typed values with the stored events. */
export const savedDocument = (v: Values, events: CashFlowEvent[]): CashFlow => ({
  income: eurosToCents(v.income),
  incomeGrowth: percentToFraction(v.incomeGrowth),
  essential: eurosToCents(v.essential),
  optional: eurosToCents(v.optional),
  expenseGrowth: percentToFraction(v.expenseGrowth),
  events,
});

/** True when the typed values differ from the stored ones. An empty or bad field counts as a change. */
export function hasUnsavedValues(v: Values, stored: CashFlow): boolean {
  const typed = savedDocument(v, stored.events);
  return (
    typed.income !== stored.income ||
    typed.incomeGrowth !== stored.incomeGrowth ||
    typed.essential !== stored.essential ||
    typed.optional !== stored.optional ||
    typed.expenseGrowth !== stored.expenseGrowth
  );
}
