// The 10-year household cash flow: capacity against what the goals take from savings. Pure; money
// is in cents and is never rounded here.
import type { PensionYear } from "./pension.ts";
import { stepContribution } from "./projection.ts";
import type { CashFlow } from "./schemas.ts";
import { timeGrid } from "./timeGrid.ts";

const DEFAULT_YEARS = 10;
const MONTHS_PER_YEAR = 12;
/** The first row is the rest of Y0, not a whole year. */
const STUB_LABEL = "rest of year";

export type CashFlowGoal = {
  id: string;
  targetYear: number;
  contributionGrowth: number;
  /** The monthly amount in force at asOf, in cents. Ignored for the pension goal. */
  monthly: number;
};

export type CashFlowInput = {
  /** ISO date, YYYY-MM-DD. */
  asOf: string;
  cashFlow: CashFlow;
  goals: readonly CashFlowGoal[];
  /** The pension goal counts only its voluntary part, from the schedule. */
  pension?: { goalId: string; schedule: readonly PensionYear[] };
};

export type CashFlowYear = {
  year: number;
  /** "rest of year" for the stub row, else the year. */
  label: string;
  income: number;
  expenses: number;
  events: number;
  /** The pension refund of the year before. Y0 has none: there is no schedule row for Y0 - 1. */
  refund: number;
  /** income - expenses + events + refund. */
  capacity: number;
  /** What the goals take from savings. */
  planned: number;
  /** capacity - planned: positive means room to spare. */
  gap: number;
};

/** What the Setup Cash flow screen reads: the stored document and the rows computed from it. */
export type CashFlowView = {
  /** The valuation date the rows start from. */
  asOf: string;
  cashFlow: CashFlow;
  rows: CashFlowYear[];
};

/**
 * The cash flow for 10 years from Y0 = year(asOf).
 *
 * Income and expenses grow by (1 + g)^(year - Y0), as the mock does. Goal contributions follow
 * `projectGoal`: the stub is r x monthly, full year k grows by (1 + contributionGrowth)^(k - 1),
 * and a goal stops after its target year. In Y0 income, expenses and contributions are scaled by
 * f = r / 12; events and the refund are whole. The pension refund ends with the pension goal: the last
 * one is paid in its target year + 1.
 */
export function projectCashFlow(input: CashFlowInput): CashFlowYear[] {
  const { asOf, cashFlow, goals, pension } = input;
  const { y0, f } = timeGrid(asOf, Number(asOf.slice(0, 4)));

  const planned = new Map<number, number>();
  const plan = (year: number, amount: number) =>
    planned.set(year, (planned.get(year) ?? 0) + amount);
  for (const goal of goals) {
    for (const step of timeGrid(asOf, goal.targetYear).steps) {
      if (goal.id === pension?.goalId) {
        const voluntary = pension.schedule.find((row) => row.year === step.year)?.voluntary ?? 0;
        plan(step.year, voluntary * step.fraction);
      } else {
        plan(step.year, stepContribution(step, y0, goal.monthly, goal.contributionGrowth));
      }
    }
  }

  // The schedule ends with the pension goal: its last row is the target year, refunded the year after.
  const pensionEnd = goals.find((goal) => goal.id === pension?.goalId)?.targetYear;
  const pensionRefund = new Map(
    (pension?.schedule ?? [])
      .filter((row) => pensionEnd === undefined || row.year <= pensionEnd)
      .map((row) => [row.refundYear, row.refund]),
  );

  return Array.from({ length: DEFAULT_YEARS }, (_, index) => {
    const year = y0 + index;
    const share = index === 0 ? f : 1;
    const income = cashFlow.income * (1 + cashFlow.incomeGrowth) ** index * share;
    const expenses =
      MONTHS_PER_YEAR *
      (cashFlow.essential + cashFlow.optional) *
      (1 + cashFlow.expenseGrowth) ** index *
      share;
    const events = cashFlow.events
      .filter((event) => event.year === year)
      .reduce((sum, event) => sum + event.amount, 0);
    const refund = pensionRefund.get(year) ?? 0;
    const capacity = income - expenses + events + refund;
    const planOfYear = planned.get(year) ?? 0;
    return {
      year,
      label: index === 0 ? STUB_LABEL : String(year),
      income,
      expenses,
      events,
      refund,
      capacity,
      planned: planOfYear,
      gap: capacity - planOfYear,
    };
  });
}
