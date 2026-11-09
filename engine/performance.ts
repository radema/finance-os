// Performance, derived from the ledger and the month-end prices; nothing is stored. Pure: no I/O.
// Money is euros as floats here; the server converts stored cents before the call.

import { type CashMovement, type CashTrade, replayCash } from "./cashLedger.ts";
import type { LedgerRow, Regime } from "./holdings.ts";
import { holdingsAt, unitPrice } from "./holdings.ts";
import { addMonths, monthEnd } from "./months.ts";

/** A ledger row plus the cash of a coupon, which has no quantity. */
export type PerformanceTransaction = LedgerRow & { amount?: number };

/** A month-end price: the quoted price, bonds per 100. */
export type PerformancePrice = { productId: string; month: string; price: number };

export type PerformanceProduct = { id: string; regime: Regime };

export type PerformanceScope =
  | { kind: "all" }
  | { kind: "allExceptPension" }
  | { kind: "bucket"; goalId: string };

export type PerformanceInput = {
  cashLedger?: { trades: readonly CashTrade[]; movements: readonly CashMovement[] };
  transactions: readonly PerformanceTransaction[];
  prices: readonly PerformancePrice[];
  products: readonly PerformanceProduct[];
  scope: PerformanceScope;
  /** The last month of the series, `YYYY-MM`. Later transactions are ignored. */
  valuationMonth: string;
};

export type PerformanceMonth = {
  month: string;
  /** V(m): units at the month end times the month-end price. */
  value: number;
  /** F(m): cash put in during the month. Sells and coupons are negative. */
  flow: number;
  /** r(m); null when V(m−1) is 0 or the month is the first. */
  twrMonthly: number | null;
  /** Growth of 100, chained from the first month. */
  index: number;
  /** index / running max − 1, at most 0. */
  drawdown: number;
};

export type PerformanceResult = {
  months: PerformanceMonth[];
  /** Chained returns over the months of each window; null when the window has no return. */
  twr: { sinceStart: number | null; ytd: number | null; last12m: number | null };
  /** Annual money-weighted return as a fraction; null when no rate in [−99%, 100%] fits. */
  xirr: number | null;
  maxDrawdown: number;
};

const INDEX_BASE = 100;
const XIRR_RANGE: readonly [number, number] = [-0.99, 1];
const XIRR_ITERATIONS = 200;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;
const MONTHS_IN_YEAR = 12;

/** The scopes to report: all, all except pension, then one per bucket (sorted by goal id). */
export function performanceScopes(
  transactions: readonly Pick<PerformanceTransaction, "goalId">[],
  movements: readonly Pick<CashMovement, "goalId" | "toGoalId">[] = [],
): PerformanceScope[] {
  const goalIds = [
    ...new Set([
      ...transactions.map((t) => t.goalId),
      ...movements.flatMap((m) => (m.toGoalId ? [m.goalId, m.toGoalId] : [m.goalId])),
    ]),
  ].sort();
  return [
    { kind: "all" },
    { kind: "allExceptPension" },
    ...goalIds.map((goalId): PerformanceScope => ({ kind: "bucket", goalId })),
  ];
}

/**
 * Monthly value, TWR, XIRR and drawdown of one scope.
 *
 * The series runs from the scope's first transaction month to `valuationMonth`. Cash of a
 * transaction is `qty × unit price + commission`, a coupon is `−amount`. A held product with no
 * price in a month carries its latest earlier price; with no price at all it is an input error.
 *
 * @throws Error when a transaction names an unknown product or a held product has no price.
 */
export function computePerformance(input: PerformanceInput): PerformanceResult {
  const { prices, valuationMonth } = input;
  const regimes = new Map(input.products.map((p) => [p.id, p.regime]));
  const regimeOf = (productId: string): Regime => {
    const regime = regimes.get(productId);
    if (regime === undefined) throw new Error(`unknown product ${productId}`);
    return regime;
  };

  const end = monthEnd(valuationMonth);
  const rows = input.transactions.filter(
    (t) => t.date <= end && inScope(input.scope, t, regimeOf(t.productId)),
  );
  const pensionGoals = new Set(
    input.cashLedger?.trades.filter((t) => t.regime === "pension").map((t) => t.goalId) ?? [],
  );
  const goalInScope = (goalId: string) =>
    input.scope.kind === "bucket"
      ? input.scope.goalId === goalId
      : input.scope.kind === "all" || !pensionGoals.has(goalId);
  const movements = input.cashLedger?.movements.filter((m) => m.date <= end) ?? [];
  const scopedMovements = movements.filter(
    (m) => goalInScope(m.goalId) || (m.toGoalId !== null && goalInScope(m.toGoalId)),
  );
  const first = [...rows, ...scopedMovements].map((t) => t.date.slice(0, 7)).sort()[0];
  if (first === undefined) {
    return {
      months: [],
      twr: { sinceStart: null, ytd: null, last12m: null },
      xirr: null,
      maxDrawdown: 0,
    };
  }

  const priceAt = (productId: string, month: string): number => {
    let best: PerformancePrice | undefined;
    for (const p of prices) {
      if (
        p.productId === productId &&
        p.month <= month &&
        (best === undefined || p.month > best.month)
      )
        best = p;
    }
    if (best === undefined) throw new Error(`no price for ${productId} up to ${month}`);
    return best.price;
  };
  const valueAt = (month: string): number => {
    let value = 0;
    for (const [productId, units] of holdingsAt(rows, monthEnd(month)).accountUnits) {
      if (units !== 0) value += units * unitPrice(regimeOf(productId), priceAt(productId, month));
    }
    if (input.cashLedger) {
      const state = replayCash(input.cashLedger.trades, movements, monthEnd(month));
      for (const [goalId, cents] of state.balances) if (goalInScope(goalId)) value += cents / 100;
    }
    return value;
  };
  const cash = (t: PerformanceTransaction): number => {
    if (input.cashLedger && t.type !== "pensionContribution") {
      return t.type === "opening"
        ? t.qty * unitPrice(regimeOf(t.productId), priceAt(t.productId, t.date.slice(0, 7)))
        : 0;
    }
    if (t.type !== "coupon") {
      return t.qty * unitPrice(regimeOf(t.productId), t.price) + (t.commission ?? 0);
    }
    if (t.amount === undefined)
      throw new Error(`coupon on ${t.date} for ${t.productId} has no amount`);
    return -t.amount;
  };

  const cashFlows: { date: string; amount: number }[] = [];
  if (input.cashLedger) {
    const state = replayCash(input.cashLedger.trades, movements, end);
    for (const flow of state.externalFlows) {
      if (goalInScope(flow.goalId))
        cashFlows.push({ date: flow.date, amount: flow.amountCents / 100 });
    }
    for (const m of scopedMovements) {
      if (m.type === "opening") cashFlows.push({ date: m.date, amount: m.amountCents / 100 });
      if (m.type === "transfer") {
        const sign =
          (m.toGoalId && goalInScope(m.toGoalId) ? 1 : 0) - (goalInScope(m.goalId) ? 1 : 0);
        if (sign) cashFlows.push({ date: m.date, amount: (sign * m.amountCents) / 100 });
      }
    }
  }

  const months: PerformanceMonth[] = [];
  let previousValue = 0;
  let index = INDEX_BASE;
  let peak = INDEX_BASE;
  for (let month = first; month <= valuationMonth; month = addMonths(month, 1)) {
    const value = valueAt(month);
    const flow =
      rows.filter((t) => t.date.slice(0, 7) === month).reduce((sum, t) => sum + cash(t), 0) +
      cashFlows.filter((f) => f.date.slice(0, 7) === month).reduce((sum, f) => sum + f.amount, 0);
    const twrMonthly = previousValue === 0 ? null : (value - flow) / previousValue - 1;
    if (twrMonthly !== null) index *= 1 + twrMonthly;
    peak = Math.max(peak, index);
    months.push({ month, value, flow, twrMonthly, index, drawdown: index / peak - 1 });
    previousValue = value;
  }

  const chain = (from: string): number | null => {
    const returns = months.filter((m) => m.month >= from && m.twrMonthly !== null);
    return returns.length === 0
      ? null
      : returns.reduce((acc, m) => acc * (1 + (m.twrMonthly ?? 0)), 1) - 1;
  };
  const finalValue = months[months.length - 1]?.value ?? 0;

  return {
    months,
    twr: {
      sinceStart: chain(first),
      ytd: chain(`${valuationMonth.slice(0, 4)}-01`),
      last12m: chain(addMonths(valuationMonth, 1 - MONTHS_IN_YEAR)),
    },
    xirr: xirr([
      ...rows.map((t) => ({ date: t.date, amount: -cash(t) })),
      ...cashFlows.map((f) => ({ date: f.date, amount: -f.amount })),
      { date: end, amount: finalValue },
    ]),
    maxDrawdown: Math.min(...months.map((m) => m.drawdown)),
  };
}

function inScope(scope: PerformanceScope, row: PerformanceTransaction, regime: Regime): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "allExceptPension") return regime !== "pension";
  return row.goalId === scope.goalId;
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;

/**
 * Annual rate that zeroes the net present value of dated flows (money in is negative), found by
 * bisection in [−99%, 100%]. Null when the flows do not change sign within that range.
 */
function xirr(flows: readonly { date: string; amount: number }[]): number | null {
  const start = Math.min(...flows.map((f) => dayNumber(f.date)));
  const npv = (rate: number): number =>
    flows.reduce(
      (sum, f) => sum + f.amount / (1 + rate) ** ((dayNumber(f.date) - start) / DAYS_PER_YEAR),
      0,
    );

  let [low, high] = XIRR_RANGE;
  const npvLow = npv(low);
  if (npvLow * npv(high) > 0) return null;
  for (let i = 0; i < XIRR_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    if (npvLow * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}
