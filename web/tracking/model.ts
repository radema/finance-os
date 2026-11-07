// The screens' view logic for Performance, Goal history and Plan vs actual: pure, so it is tested
// without a browser.

import type { PerformanceScope } from "../../engine/performance.ts";
import type { SnapshotGoal, SnapshotView } from "../../engine/snapshot.ts";
import type { PerformanceView } from "../../engine/trackingViews.ts";
import { usesSlotLine } from "../goals/outlook.ts";
import { formatEuro, formatPercent } from "../money.ts";

/** What Goal history draws. Funded ratio is not in the spec: it is value / target at the month. */
export type HistoryMetric = "prob" | "funded" | "median";

export const HISTORY_METRICS: readonly { key: HistoryMetric; label: string; unit: string }[] = [
  {
    key: "prob",
    label: "Probability of success",
    unit: "Share of simulated markets that reach the target.",
  },
  {
    key: "funded",
    label: "Funded ratio",
    unit: "Value of the holdings divided by the target at the goal date.",
  },
  {
    key: "median",
    label: "Median ÷ target",
    unit: "Typical-case outcome divided by the target at the goal date.",
  },
];

/** The metric of one goal in one snapshot, as a fraction. Null when a part of it is missing. */
export function metricOf(goal: SnapshotGoal, metric: HistoryMetric): number | null {
  if (metric === "prob") return goal.prob;
  const part = metric === "funded" ? goal.value : goal.median;
  return part === null || goal.target <= 0 ? null : part / goal.target;
}

export interface History {
  /** `YYYY-MM`, oldest first. */
  months: string[];
  /** Per month: true when the snapshot was recomputed, not saved at the time. */
  recomputed: boolean[];
  /** One line per goal, in the order the goals first appear. `null` is a gap. */
  lines: { goalId: string; values: (number | null)[] }[];
}

/** The snapshots as lines over months, for the chart and the table. */
export function historyOf(snapshots: readonly SnapshotView[], metric: HistoryMetric): History {
  const ordered = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  const goalIds = [...new Set(ordered.flatMap((snapshot) => snapshot.goals.map((g) => g.goalId)))];
  return {
    months: ordered.map((snapshot) => snapshot.month),
    recomputed: ordered.map((snapshot) => snapshot.source === "recomputed"),
    lines: goalIds.map((goalId) => ({
      goalId,
      values: ordered.map((snapshot) => {
        const goal = snapshot.goals.find((candidate) => candidate.goalId === goalId);
        return goal ? metricOf(goal, metric) : null;
      }),
    })),
  };
}

/** A goal of the snapshots as a chart draws it: its name and line colour, or its id in grey. */
export interface KnownGoal {
  id: string;
  name: string;
  colour: string;
}

/** The goals of a history, named and coloured from the goal list; a deleted goal shows its id in grey. */
export function knownGoals(
  history: History,
  goals: readonly { id: string; name: string; slot: number }[],
): KnownGoal[] {
  return history.lines.map(({ goalId }) => {
    const goal = goals.find((candidate) => candidate.id === goalId);
    return goal
      ? { id: goalId, name: goal.name, colour: lineColour(goal.slot) }
      : { id: goalId, name: goalId, colour: "--ink2" };
  });
}

/** The chart series of a history: a line per goal with a marker per snapshot, hollow when recomputed. */
export function historySeries(history: History, known: readonly KnownGoal[]) {
  return history.lines.map((line, index) => ({
    name: known[index]?.name ?? line.goalId,
    data: line.values,
    colour: known[index]?.colour ?? "--ink2",
    markers: true,
    hollow: history.recomputed,
    endLabel: true,
  }));
}

/** The value of the scope selector: `all`, `allExceptPension` or `bucket:<goalId>`. */
export const scopeKey = (scope: PerformanceScope): string =>
  scope.kind === "bucket" ? `bucket:${scope.goalId}` : scope.kind;

export function scopeOfKey(key: string): PerformanceScope {
  if (key.startsWith("bucket:")) return { kind: "bucket", goalId: key.slice("bucket:".length) };
  return { kind: key === "allExceptPension" ? "allExceptPension" : "all" };
}

/** The query string of `GET /api/performance` for a scope. */
export const scopeQuery = (scope: PerformanceScope): string =>
  new URLSearchParams(
    scope.kind === "bucket" ? { scope: "bucket", goalId: scope.goalId } : { scope: scope.kind },
  ).toString();

/** Whether a goal is ahead of or behind its plan, from the cumulative gap in cents. */
export const gapText = (gapCents: number): string =>
  gapCents < 0 ? "behind" : gapCents > 0 ? "ahead" : "on plan";

/** The note under the Next contribution amount: one calm line, whether to add it to next month. */
export const nextTicketText = (next: {
  wait: boolean;
  amount: number;
  minTicket: number;
}): string =>
  next.wait
    ? `${formatEuro(next.amount)} is below the minimum efficient ticket (${formatEuro(next.minTicket)}). Add it to next month's contribution.`
    : `No need to wait. The minimum efficient ticket is ${formatEuro(next.minTicket)}.`;

/** Why an XIRR is missing, or undefined when there is one. */
export const xirrNote = (xirr: number | null): string | undefined =>
  xirr === null
    ? "No annual rate fits yet: the history is too short, or the rate is above 100% a year."
    : undefined;

export const MISSING = "–";

/** A fraction as a percentage, or the dash when there is none. */
export const percentText = (fraction: number | null): string =>
  fraction === null ? MISSING : formatPercent(fraction);

/** Below this many months of history an annual rate is an extrapolation, so it is not shown. */
const MIN_XIRR_MONTHS = 12;

/** Months from the first cash flow to the valuation month: the series has one point per month. */
export const historyMonths = (view: Pick<PerformanceView, "months">): number =>
  Math.max(view.months.length - 1, 0);

/** The XIRR tile: the rate and its note, or the dash and "Not enough history yet" when too short. */
export const xirrTile = (
  xirr: number | null,
  months: number,
): { value: string; note: string | undefined } =>
  months < MIN_XIRR_MONTHS
    ? { value: MISSING, note: "Not enough history yet" }
    : { value: percentText(xirr), note: xirrNote(xirr) };

/** The colour of a chart's main mark, as a custom property: the goal's slot, or the highlight. */
export const markColour = (slot: number | null): string =>
  slot === null ? "--hl" : `--slot${slot}`;

/** The line colour: DESIGN.md draws lines in slots 1, 2 and 5 only; other goals get a grey line. */
export const lineColour = (slot: number | null): string =>
  slot === null || usesSlotLine(slot) ? markColour(slot) : "--ink2";
