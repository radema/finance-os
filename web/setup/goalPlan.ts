import { planInForce } from "../../engine/plan.ts";
import type { PlanVersionRecord } from "../../engine/schemas.ts";

/** The valuation month, `YYYY-MM`, from the valuation date the API returns (`GoalListView.asOf`). */
export const valuationMonth = (asOf: string): string => asOf.slice(0, 7);

/** The monthly amount in force for a month, in cents. */
export const monthlyInForce = (versions: readonly PlanVersionRecord[], month: string): number =>
  planInForce(
    versions.map((v) => ({ fromMonth: v.fromMonth, monthly: v.monthlyCents })),
    month,
  );

/** The start month of the version in force for a month, if any. */
export const fromMonthInForce = (
  versions: readonly PlanVersionRecord[],
  month: string,
): string | undefined =>
  versions
    .map((v) => v.fromMonth)
    .filter((from) => from <= month)
    .sort()
    .at(-1);
