import type { CashFlowEvent, Goal, Product, Transaction } from "../../engine/schemas.ts";

// Duplicate fills the create form with a copy of a row. These are the copy rules of the option
// chosen in #71; the user saves through the existing create path.

/** A product copy: the importer matches by ISIN and ticker, so the copy leaves both blank. */
export const copyOfProduct = (p: Product): Product => ({
  ...p,
  name: `${p.name} (copy)`,
  isin: "",
  ticker: "",
});

/** A goal copy. GoalsTab (`monthlyText`) carries the monthly amount in force, not this function. */
export const copyOfGoal = (g: Goal): Goal => ({ ...g, name: `${g.name} (copy)` });

export const copyOfEvent = (e: CashFlowEvent): CashFlowEvent => ({ ...e, year: e.year + 1 });

export const copyOfTransaction = (t: Transaction, today: string): Transaction => ({
  ...t,
  date: today,
});
