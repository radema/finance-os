// Plan vs actual and the next contribution. Pure; money is in cents and is never rounded here.
import { estimateCommission, minEfficientTicket } from "./commission.ts";
import type { LedgerRow } from "./holdings.ts";
import { addMonths } from "./months.ts";
import type { PensionYear } from "./pension.ts";
import { planInForce } from "./plan.ts";
import type { Commission, Product } from "./schemas.ts";

const MONTHS_PER_YEAR = 12;
const CENTS_PER_EURO = 100;
/** The ledger types that are contributions. Openings and coupons are not; sells are not netted. */
const CONTRIBUTIONS: readonly LedgerRow["type"][] = ["buy", "pensionContribution"];

export type PlanVsActualMonth = {
  /** `YYYY-MM`. */
  month: string;
  planned: number;
  actual: number;
  cumPlanned: number;
  cumActual: number;
  /** cumActual - cumPlanned: negative means behind plan. */
  gap: number;
};

export type PlanVsActualGoal = { goalId: string; months: PlanVsActualMonth[] };

export type PlanVsActualInput = {
  /** In the order the result follows. */
  goals: readonly { id: string; targetYear: number }[];
  /** Plan versions of all goals; `monthly` in cents. */
  plans: readonly { goalId: string; fromMonth: string; monthly: number }[];
  /** The ledger in euros as floats: the engine's `LedgerRow`. */
  transactions: readonly LedgerRow[];
  /** The pension goal's plan comes from its schedule, in cents. */
  pension?: { goalId: string; schedule: readonly PensionYear[] };
  /** `YYYY-MM`: the first month compared. */
  trackingStart: string;
  /** `YYYY-MM`: the last month compared, counted in full however far it has got. */
  valuationMonth: string;
};

const monthIndex = (month: string): number =>
  Number(month.slice(0, 4)) * MONTHS_PER_YEAR + Number(month.slice(5, 7));

/** What the pension goal plans for a month: its schedule year's total / 12. Earlier years use the first row. */
function pensionPlanned(schedule: readonly PensionYear[], month: string): number {
  const year = Number(month.slice(0, 4));
  const first = schedule[0];
  const row =
    schedule.find((candidate) => candidate.year === year) ??
    (first && year < first.year ? first : undefined);
  if (!row) return 0;
  return (row.tfr + row.worker + row.employer + row.voluntary) / MONTHS_PER_YEAR;
}

/**
 * Cumulative plan against cumulative actual since `trackingStart`, per goal and month.
 *
 * Planned = the plan in force that month (the pension goal: its schedule total / 12); 0 after the
 * goal's target year. `contributionGrowth` is never used. Actual = cash amount (qty x price +
 * commission) of the `buy` and `pensionContribution` rows of the month. Transactions before the
 * tracking start or after the valuation month are left out.
 */
export function planVsActual(input: PlanVsActualInput): PlanVsActualGoal[] {
  const { trackingStart, valuationMonth, pension } = input;
  const count = Math.max(0, monthIndex(valuationMonth) - monthIndex(trackingStart) + 1);
  const months = Array.from({ length: count }, (_, i) => addMonths(trackingStart, i));

  return input.goals.map((goal) => {
    const versions = input.plans.filter((plan) => plan.goalId === goal.id);
    const put = new Map<string, number>();
    for (const row of input.transactions) {
      if (row.goalId !== goal.id || !CONTRIBUTIONS.includes(row.type)) continue;
      const cash = (row.qty * row.price + (row.commission ?? 0)) * CENTS_PER_EURO;
      put.set(row.date.slice(0, 7), (put.get(row.date.slice(0, 7)) ?? 0) + cash);
    }

    let cumPlanned = 0;
    let cumActual = 0;
    const rows = months.map((month) => {
      let planned = 0;
      if (Number(month.slice(0, 4)) <= goal.targetYear) {
        planned =
          pension?.goalId === goal.id
            ? pensionPlanned(pension.schedule, month)
            : planInForce(versions, month);
      }
      const actual = put.get(month) ?? 0;
      cumPlanned += planned;
      cumActual += actual;
      return { month, planned, actual, cumPlanned, cumActual, gap: cumActual - cumPlanned };
    });
    return { goalId: goal.id, months: rows };
  });
}

export type NextContribution = {
  goalId: string;
  /** The gap to close, in cents. */
  amount: number;
  split: { productId: string; amount: number; commission: number; costPct: number }[];
  /** True when the amount is below the minimum efficient ticket and a product bears commission. */
  wait: boolean;
};

export type NextContributionInput = {
  planVsActual: readonly PlanVsActualGoal[];
  pensionGoalId?: string;
  allocationWeights: readonly { goalId: string; productId: string; weight: number }[];
  products: ReadonlyMap<string, Pick<Product, "zeroCommission">>;
  commission: Commission;
};

/**
 * Where the next contribution goes: the non-pension goal with the largest negative cumulative gap,
 * the amount split by its allocation weights. Null when no such goal is behind plan.
 */
export function nextContribution(input: NextContributionInput): NextContribution | null {
  let behind: { goalId: string; gap: number } | undefined;
  for (const { goalId, months } of input.planVsActual) {
    const gap = months.at(-1)?.gap ?? 0;
    if (goalId === input.pensionGoalId || gap >= 0) continue;
    if (!behind || gap < behind.gap) behind = { goalId, gap };
  }
  if (!behind) return null;

  const amount = -behind.gap;
  const weights = input.allocationWeights.filter(
    (row) => row.goalId === behind.goalId && row.weight > 0,
  );
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  const split = weights.map(({ productId, weight }) => {
    const part = (amount * weight) / total;
    const product = input.products.get(productId) ?? { zeroCommission: false };
    const commission = estimateCommission(input.commission, product, "buy", part);
    return { productId, amount: part, commission, costPct: commission / part };
  });
  const bearsCommission = weights.some(
    ({ productId }) => !input.products.get(productId)?.zeroCommission,
  );
  return {
    goalId: behind.goalId,
    amount,
    split,
    wait: bearsCommission && amount < minEfficientTicket(input.commission),
  };
}
