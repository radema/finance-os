// The Overview's view logic: pure, so it is tested without a browser.

import type { GoalListRow } from "../../engine/goalViews.ts";
import type { IndependenceView } from "../../engine/independenceView.ts";
import type { Alert, RuleId } from "../../engine/rules.ts";
import { ladderRows } from "../independence/model.ts";
import { formatAmount } from "../money.ts";
import {
  GOALS_DETAIL_ROUTE,
  GOALS_HISTORY_ROUTE,
  GOALS_LIST_ROUTE,
  INDEPENDENCE_ROUTE,
  PENSION_ROUTE,
  PERFORMANCE_ROUTE,
  PLAN_VS_ACTUAL_ROUTE,
  PRICES_ROUTE,
  TRANSACTIONS_ROUTE,
} from "../nav.ts";
import { MISSING } from "../tracking/model.ts";

/** The screen that explains each number or cell of the Overview, as a route key. */
export const OVERVIEW_ROUTES = {
  netWorth: PERFORMANCE_ROUTE,
  marketChange: PERFORMANCE_ROUTE,
  ytdTwr: PERFORMANCE_ROUTE,
  fiWealth: INDEPENDENCE_ROUTE,
  goalsOnTrack: GOALS_LIST_ROUTE,
  pVsRequired: GOALS_LIST_ROUTE,
  netWorthByGoal: PERFORMANCE_ROUTE,
  trend: GOALS_HISTORY_ROUTE,
  cashFlow: "setup/cash-flow",
  goals: GOALS_LIST_ROUTE,
  fiProgress: INDEPENDENCE_ROUTE,
  prices: PRICES_ROUTE,
  fiLevels: INDEPENDENCE_ROUTE,
} as const;

/** The hash link to a route key. */
export const hrefOf = (route: string): string => `#/${route}`;

/** The screen of an alert's rule. `goal` means the detail of the goal the alert is about. */
const ALERT_SCREEN: Record<RuleId, string> = {
  R1: PLAN_VS_ACTUAL_ROUTE,
  R2: PENSION_ROUTE,
  R3: "goal",
  R4: "goal",
  R5: PRICES_ROUTE,
  R6: "goal",
  R7: TRANSACTIONS_ROUTE,
  R8: "goal",
  R9: PRICES_ROUTE,
  R10: PRICES_ROUTE,
};

/** The route key of the screen that explains an alert: its rule's screen, or its goal's detail. */
export function alertRoute({ ruleId, scope }: Alert): string {
  const screen = ALERT_SCREEN[ruleId];
  if (screen !== "goal") return screen;
  return scope.kind === "goal"
    ? `${GOALS_DETAIL_ROUTE}/${encodeURIComponent(scope.id)}`
    : GOALS_LIST_ROUTE;
}

/** Goals on track out of the goals that have a status. */
export function goalsOnTrack(goals: readonly GoalListRow[]): { onTrack: number; total: number } {
  const withStatus = goals.filter((goal) => goal.outlook !== null);
  return {
    onTrack: withStatus.filter((goal) => goal.outlook?.status === "on_track").length,
    total: withStatus.length,
  };
}

/**
 * The action title: a fact from the data with a number, never an instruction.
 * "3 of 4 goals are on track, and net worth is …".
 */
export function actionTitle(
  { onTrack, total }: { onTrack: number; total: number },
  netWorth: number | null,
): string {
  const worth = netWorth === null ? "" : formatAmount(netWorth);
  if (total > 0) {
    const counted = `${onTrack} of ${total} ${total === 1 ? "goal is" : "goals are"} on track`;
    return netWorth === null ? counted : `${counted}, and net worth is ${worth}`;
  }
  return netWorth === null ? "No numbers to show yet" : `Net worth is ${worth}`;
}

/** An amount with its sign, for a change: "+100,00 €" or "-1.240,88 €". */
export const signedAmount = (euros: number | null): string =>
  euros === null ? MISSING : `${euros > 0 ? "+" : ""}${formatAmount(euros)}`;

export interface LevelRow {
  name: string;
  /** Today's wealth ÷ target. Null when the target is 0. */
  progress: number | null;
  /** The calendar year the median and the deterministic line reach the level. Null when never. */
  median: number | null;
  deterministic: number | null;
}

/** Per FI level: the share reached today and the year it is reached. Empty without a projection. */
export function levelRows(view: IndependenceView): LevelRow[] {
  const rows = ladderRows(view);
  const reached = view.result?.reached;
  if (!rows || !reached) return [];
  return rows.map((row, level) => ({
    name: row.name,
    progress: row.progress,
    median: reached[level]?.median ?? null,
    deterministic: reached[level]?.deterministic ?? null,
  }));
}
