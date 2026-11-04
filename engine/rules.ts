// Rules R1 to R10: the alerts. Pure; money is in cents, units and unit prices are floats. Every
// alert carries its rule, its condition in words with the numbers, and the key that dismissals use.
// Dismissals are not applied here: this returns every alert whose condition is true.

import { minEfficientTicket } from "./commission.ts";
import type { GoalStatus } from "./goalStatus.ts";
import type { LedgerRow } from "./holdings.ts";
import { holdingsAt } from "./holdings.ts";
import { monthsEnding } from "./months.ts";
import type { PlanVsActualGoal } from "./planVsActual.ts";
import type { PriceAge } from "./priceAge.ts";
import type { FetchProblemReason } from "./priceFetch.ts";
import type { Commission, Goal, Product, Settings } from "./schemas.ts";
import { timeGrid } from "./timeGrid.ts";
import { fromCents, toCents, toScaled } from "./units.ts";

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10";
export type Severity = "High" | "Medium" | "Info";

export interface Alert {
  ruleId: RuleId;
  name: string;
  severity: Severity;
  /** The condition in words, with the numbers. It states facts and is not an instruction. */
  condition: string;
  /** What the alert is about. `none` has an empty `id`. The key carries every id it needs. */
  scope: { kind: "goal" | "product" | "none"; id: string };
  /** Dismissal key: a dismissed alert stays hidden while its key is unchanged. */
  key: string;
}

/** One buy or sell, for R7. The amount excludes the commission. `commissionCents` is null when none is recorded. */
export interface RuleTrade {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  productId: string;
  type: "buy" | "sell";
  amountCents: number;
  commissionCents: number | null;
}

/** The pension deduction room inputs of the current year, in cents: the Y0 row of the schedule. */
export interface PensionDeduction {
  workerCents: number;
  employerCents: number;
  /** The extra deduction on top of the Settings cap. */
  extraCents: number;
  voluntaryYtdCents: number;
}

export interface RuleInput {
  /** The valuation date, `YYYY-MM-DD`: its month, year and horizon drive every rule. */
  asOf: string;
  settings: Pick<Settings, "pensionDeductionCapCents" | "thresholds">;
  commission: Commission;
  goals: readonly (Pick<Goal, "name" | "priority" | "targetYear"> & { id: string })[];
  /** Cumulative plan vs actual per goal, in cents, up to the valuation month. */
  planVsActual: readonly PlanVsActualGoal[];
  /** The pension goal, which R1 skips. `deduction` is null when the plan has no schedule: R2 is then silent. */
  pension: { goalId: string; deduction: PensionDeduction | null } | null;
  /** Current status per goal. Null when the analysis could not run. */
  statuses: ReadonlyMap<string, GoalStatus | null>;
  /** The snapshot with the latest month, saved or recomputed. Null when there is none. */
  latestSnapshot: { month: string; statuses: ReadonlyMap<string, GoalStatus | null> } | null;
  ledger: readonly LedgerRow[];
  products: readonly (Pick<Product, "id" | "name" | "assetClass" | "maturity"> & {
    /** Units the broker shows, and the date it showed them. Null when not entered. */
    brokerUnits: number | null;
    brokerUnitsDate: string | null;
  })[];
  /** Latest unit price per product at or before the valuation month, in euros. */
  unitPrices: ReadonlyMap<string, number>;
  /** The per-kind price age of each product. */
  priceAge: ReadonlyMap<string, PriceAge>;
  trades: readonly RuleTrade[];
  /** The fetch problems still open: provider error, non-EUR price, move above 25%. */
  fetchProblems: readonly { productId: string; reason: FetchProblemReason }[];
}

type Meta = { name: string; severity: Severity };
const RULES: Record<RuleId, Meta> = {
  R1: { name: "Behind plan", severity: "Medium" },
  R2: { name: "Deduction room", severity: "Info" },
  R3: { name: "Maturity ahead", severity: "Medium" },
  R4: { name: "Status worsened", severity: "Medium" },
  R5: { name: "Stale prices", severity: "Medium" },
  R6: { name: "Need off track", severity: "High" },
  R7: { name: "Costly trades", severity: "Info" },
  R8: { name: "Near goal, risky assets", severity: "Medium" },
  R9: { name: "Units mismatch", severity: "High" },
  R10: { name: "Price fetch failed", severity: "Medium" },
};

const NO_SCOPE = { kind: "none", id: "" } as const;
const COSTLY_WINDOW_MONTHS = 12;
const MONTHS_PER_YEAR = 12;
const EXPECTED_HORIZON_YEARS = 1;
const PERCENT = 100;

const STATUS_RANK: Record<GoalStatus, number> = { off_track: 1, at_risk: 2, on_track: 3 };
const STATUS_LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};
const FETCH_REASON: Record<FetchProblemReason, string> = {
  "provider-error": "provider error",
  "non-eur": "price not in EUR",
  "move-above-25": "move above 25%",
};

const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const money = (cents: number): string => euro.format(fromCents(cents));
const percent = (fraction: number): string => `${(fraction * PERCENT).toFixed(2)}%`;
const unitCount = (units: number): string => String(units);

const monthIndex = (month: string): number =>
  Number(month.slice(0, 4)) * MONTHS_PER_YEAR + Number(month.slice(5, 7));

const alertOf = (ruleId: RuleId, scope: Alert["scope"], key: string, condition: string): Alert => ({
  ruleId,
  ...RULES[ruleId],
  condition,
  scope,
  key,
});

const idList = (ids: Iterable<string>): string => [...new Set(ids)].sort().join(",");

/** R1: a non-pension goal behind by more than N months of plan and more than the minimum ticket. */
function behindPlan(input: RuleInput, month: string): Alert[] {
  const ticket = minEfficientTicket(input.commission);
  const months = input.settings.thresholds.r1Months;
  return input.planVsActual.flatMap(({ goalId, months: history }) => {
    const last = history.at(-1);
    if (!last || goalId === input.pension?.goalId) return [];
    // The plan in force in the valuation month sets the limit, whatever it was before.
    const limit = months * last.planned;
    if (!(last.gap < -limit && last.gap < -ticket)) return [];
    const name = input.goals.find((goal) => goal.id === goalId)?.name ?? goalId;
    return alertOf(
      "R1",
      { kind: "goal", id: goalId },
      `${goalId}|${month}`,
      `${name} is ${money(-last.gap)} behind plan. The limit is ${months} months of plan (${money(limit)}) and the minimum efficient ticket (${money(ticket)}).`,
    );
  });
}

/** R2: deduction room left in the current year. */
function deductionRoom(input: RuleInput): Alert[] {
  const deduction = input.pension?.deduction;
  if (!deduction) return [];
  const used = deduction.workerCents + deduction.employerCents + deduction.voluntaryYtdCents;
  const room = input.settings.pensionDeductionCapCents + deduction.extraCents - used;
  if (room <= 0) return [];
  const year = input.asOf.slice(0, 4);
  return [
    alertOf(
      "R2",
      NO_SCOPE,
      year,
      `${money(room)} of the ${year} pension deduction room is not used yet.`,
    ),
  ];
}

/** The ids of the products with units in any bucket at `asOf`. */
function heldIds(ledger: readonly LedgerRow[], asOf: string): Set<string> {
  const held = new Set<string>();
  for (const units of holdingsAt(ledger, asOf).units.values()) {
    for (const [productId, count] of units) if (toScaled(count) > 0) held.add(productId);
  }
  return held;
}

/** R3: a held product with a maturity within the limit. */
function maturityAhead(input: RuleInput, held: ReadonlySet<string>): Alert[] {
  const now = input.asOf.slice(0, 7);
  const limit = input.settings.thresholds.r3Months;
  return input.products.flatMap((product) => {
    if (!held.has(product.id) || product.maturity === null) return [];
    const months = monthIndex(product.maturity) - monthIndex(now);
    if (months > limit) return [];
    const when =
      months >= 0
        ? `${months} months after ${now}`
        : `${-months} months before ${now}: it has matured`;
    return alertOf(
      "R3",
      { kind: "product", id: product.id },
      `${product.id}|${product.maturity}`,
      `${product.name} is held and matures in ${product.maturity}, ${when}. The limit is ${limit} months.`,
    );
  });
}

/** R4: a goal whose status is worse than in the latest snapshot. */
function statusWorsened(input: RuleInput): Alert[] {
  const snapshot = input.latestSnapshot;
  if (!snapshot) return [];
  return input.goals.flatMap((goal) => {
    const now = input.statuses.get(goal.id);
    const before = snapshot.statuses.get(goal.id);
    if (!now || !before || STATUS_RANK[now] >= STATUS_RANK[before]) return [];
    return alertOf(
      "R4",
      { kind: "goal", id: goal.id },
      `${goal.id}|${now}`,
      `${goal.name} is ${STATUS_LABEL[now]}. In the ${snapshot.month} snapshot it was ${STATUS_LABEL[before]}.`,
    );
  });
}

/** R5: held products whose price is old by the per-kind rule. */
function stalePrices(input: RuleInput, held: ReadonlySet<string>): Alert[] {
  const old = input.products.filter((p) => held.has(p.id) && input.priceAge.get(p.id)?.old);
  if (old.length === 0) return [];
  const detail = old.map((p) => `${p.name} (${input.priceAge.get(p.id)?.reason})`).join("; ");
  return [alertOf("R5", NO_SCOPE, idList(old.map((p) => p.id)), `Old prices: ${detail}`)];
}

/** R6: a Need that is off track. */
function needOffTrack(input: RuleInput, month: string): Alert[] {
  return input.goals
    .filter((goal) => goal.priority === "Need" && input.statuses.get(goal.id) === "off_track")
    .map((goal) =>
      alertOf(
        "R6",
        { kind: "goal", id: goal.id },
        `${goal.id}|${month}`,
        `${goal.name} is a Need and its status is ${STATUS_LABEL.off_track}.`,
      ),
    );
}

/**
 * R7: costly trades in the last 12 months. The commission is actual and the rate is the plan's:
 * `rate` for a percent plan, flatFee / minTicket for a flat one. Cross-multiplied, so a flat plan
 * without a ticket never divides by zero and the boundary is exact.
 */
function costlyTrades(input: RuleInput): Alert[] {
  const { commission } = input;
  const multiple = input.settings.thresholds.r7Multiple;
  const flat = commission.feeModel === "flat";
  const hasRate = flat
    ? commission.flatFeeCents > 0 && commission.minTicketCents > 0
    : commission.rate > 0;
  if (!hasRate) return [];
  const rate = flat ? commission.flatFeeCents / commission.minTicketCents : commission.rate;
  const window = monthsEnding(input.asOf.slice(0, 7), COSTLY_WINDOW_MONTHS);

  const costly = input.trades
    .filter(
      (trade) =>
        trade.commissionCents !== null &&
        trade.commissionCents > 0 &&
        trade.amountCents > 0 &&
        trade.date <= input.asOf &&
        window.includes(trade.date.slice(0, 7)),
    )
    .filter((trade) => (trade.commissionCents as number) > multiple * rate * trade.amountCents);
  // The latest by date; on a tie the later one in the input.
  const latest = costly.reduce<RuleTrade | undefined>(
    (best, trade) => (best === undefined || trade.date >= best.date ? trade : best),
    undefined,
  );
  if (!latest) return [];
  const fee = latest.commissionCents as number;
  return [
    alertOf(
      "R7",
      NO_SCOPE,
      latest.id,
      `${costly.length} trades in the last ${COSTLY_WINDOW_MONTHS} months paid a commission above ${multiple} times the plan rate of ${percent(rate)}. The latest, on ${latest.date}: ${money(fee)} on ${money(latest.amountCents)} (${percent(fee / latest.amountCents)}).`,
    ),
  ];
}

/** R8: a goal due within a year that holds equity. Equity value = units x price of `Equity` products in its bucket. */
function nearGoalRisk(input: RuleInput): Alert[] {
  const held = holdingsAt(input.ledger, input.asOf).units;
  const equity = new Set(input.products.filter((p) => p.assetClass === "Equity").map((p) => p.id));
  return input.goals.flatMap((goal) => {
    const { tau } = timeGrid(input.asOf, goal.targetYear);
    if (tau > EXPECTED_HORIZON_YEARS) return [];
    let value = 0;
    for (const [productId, units] of held.get(goal.id) ?? []) {
      if (equity.has(productId) && units > 0)
        value += units * (input.unitPrices.get(productId) ?? 0);
    }
    if (value <= 0) return [];
    return alertOf(
      "R8",
      { kind: "goal", id: goal.id },
      goal.id,
      `${goal.name} is due in ${goal.targetYear}, ${tau.toFixed(2)} years from ${input.asOf}, and holds ${money(toCents(value))} in equity.`,
    );
  });
}

/** R9: a product whose units across buckets differ from the broker's, both taken on the broker date. */
function unitsMismatch(input: RuleInput): Alert[] {
  return input.products.flatMap((product) => {
    if (product.brokerUnits === null || product.brokerUnitsDate === null) return [];
    const ours =
      holdingsAt(input.ledger, product.brokerUnitsDate).accountUnits.get(product.id) ?? 0;
    const bucket = toScaled(ours);
    const broker = toScaled(product.brokerUnits);
    if (bucket === broker) return [];
    return alertOf(
      "R9",
      { kind: "product", id: product.id },
      `${product.id}|${bucket}|${broker}`,
      `${product.name}: the buckets hold ${unitCount(ours)} units and the broker shows ${unitCount(product.brokerUnits)} on ${product.brokerUnitsDate}.`,
    );
  });
}

/** R10: products with a price fetch problem. */
function fetchFailed(input: RuleInput): Alert[] {
  if (input.fetchProblems.length === 0) return [];
  const names = new Map(input.products.map((p) => [p.id, p.name]));
  const reasons = new Map<string, Set<string>>();
  for (const { productId, reason } of input.fetchProblems) {
    reasons.set(productId, (reasons.get(productId) ?? new Set()).add(FETCH_REASON[reason]));
  }
  const detail = [...reasons]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, why]) => `${names.get(id) ?? id} (${[...why].join(", ")})`)
    .join("; ");
  return [alertOf("R10", NO_SCOPE, idList(reasons.keys()), `Price fetch problems: ${detail}`)];
}

/**
 * Every alert whose condition is true, in rule order. Thresholds come from `settings`. Dismissals
 * are not applied.
 *
 * R1 reads the plan in force in the valuation month. R4 compares with the latest snapshot, saved
 * or recomputed. R8 counts held units x latest price of `Equity` products. R9 compares the ledger
 * and the broker on the broker's date. The key month of R1 and R6 is the month of `asOf`.
 */
export function evaluateRules(input: RuleInput): Alert[] {
  const month = input.asOf.slice(0, 7);
  const held = heldIds(input.ledger, input.asOf);
  return [
    ...behindPlan(input, month),
    ...deductionRoom(input),
    ...maturityAhead(input, held),
    ...statusWorsened(input),
    ...stalePrices(input, held),
    ...needOffTrack(input, month),
    ...costlyTrades(input),
    ...nearGoalRisk(input),
    ...unitsMismatch(input),
    ...fetchFailed(input),
  ];
}
