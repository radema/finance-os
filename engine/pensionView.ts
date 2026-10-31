// What the Pension screen reads from the API. A computed read model: amounts are euros as floats
// (the stored plan stays in cents), and rounding happens only in the view.
import type { Goal, PensionPlan } from "./schemas.ts";

/** One year of the schedule. The Y0 contribution fields are the full-year schedule. */
export interface PensionYearView {
  year: number;
  ral: number;
  tfr: number;
  worker: number;
  employer: number;
  voluntary: number;
  deductible: number;
  /** Cash inflow in `refundYear`. */
  refund: number;
  refundYear: number;
}

export interface PensionThisYear {
  year: number;
  cap: number;
  /** The extra deduction on top of the cap. */
  extra: number;
  /** Worker + employer of the year plus the voluntary YTD. */
  used: number;
  /** Cap + extra - used, never below 0. */
  available: number;
  /** This year's non-deducted part (AC-95). The screen shows it when `used` is above cap + extra. */
  nonDeducted: number;
  /** Voluntary contributions already made this year: the year's `pensionContribution` transactions on Voluntary products. */
  voluntaryYtd: number;
  refund: number;
  refundYear: number;
  /** The exit-tax rate of the pension goal's own year. Null when the goal does not exist. */
  exitRate: number | null;
  /** Exit tax at the goal date, from the engine's liquidation. Null when the projection is unavailable. */
  exitTax: number | null;
  exitTaxYear: number | null;
}

export interface PensionView {
  asOf: string;
  /** The stored document, in cents. Null until a plan is saved. */
  plan: PensionPlan | null;
  goals: { id: string; name: string; priority: Goal["priority"] }[];
  /** Products with the `pension` regime: the ones a flow can name. */
  pensionProducts: { id: string; name: string }[];
  /** Null without a plan or without a RAL. */
  thisYear: PensionThisYear | null;
  /** The next 10 years, Y0 first. Empty without a RAL. */
  schedule: PensionYearView[];
}
