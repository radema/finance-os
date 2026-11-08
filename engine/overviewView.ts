// Overview read model. Money in the plan summary is cents.
import type { GoalListRow } from "./goalViews.ts";
import type { IndependenceView } from "./independenceView.ts";
import type { PlanVsActualMonth } from "./planVsActual.ts";
import type { PriceAge } from "./priceAge.ts";
import type {
  NextContributionView,
  PerformancePoint,
  PerformanceSummary,
} from "./trackingViews.ts";

export interface OverviewKeyNumbers {
  netWorth: number | null;
  marketChange: number | null;
  ytdTwr: number | null;
  fiWealth: number | null;
}
export interface OverviewView {
  asOf: string;
  keyNumbers: OverviewKeyNumbers;
  goals: GoalListRow[];
  fi: IndependenceView;
  plan: {
    trackingStart: string;
    latest: PlanVsActualMonth | null;
    next: Pick<
      NextContributionView,
      "goalId" | "goalName" | "slot" | "amount" | "wait" | "minTicket"
    > | null;
  };
  stalePrices: { productId: string; name: string; age: PriceAge }[];
}

/**
 * The key numbers that come from the all-goals performance series and the FI wealth. The market
 * change needs two months: the flow of the last month is the change of the money put in.
 */
export function keyNumbersOf(
  months: readonly PerformancePoint[],
  summary: PerformanceSummary | null,
  fiWealth: number | null,
): OverviewKeyNumbers {
  const last = months.at(-1);
  const previous = months.at(-2);
  return {
    netWorth: summary?.value ?? null,
    marketChange:
      last && previous ? last.value - previous.value - (last.moneyIn - previous.moneyIn) : null,
    ytdTwr: summary?.twr.ytd ?? null,
    fiWealth,
  };
}
