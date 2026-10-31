import type { PensionFlow, PensionPlan } from "../../engine/schemas.ts";
import { centsToEuros, eurosToCents, fractionToPercent, num, percentToFraction } from "../forms.ts";

/** The form's text values. Flow fields are `work:<productId>` and `voluntary:<productId>`, in percent. */
export type PlanValues = Record<string, string>;

const FLOW_KEY = { Work: "work", Voluntary: "voluntary" } as const;
export const flowKey = (flow: PensionFlow["flow"], productId: string): string =>
  `${FLOW_KEY[flow]}:${productId}`;

const NEW_PLAN: PlanValues = {
  tfrPct: "6.91",
  extra: "2650",
  ralGrowth: "0",
  workerPct: "0",
  employerPct: "0",
  marginalRate: "0",
};

/** The text of a stored plan. No plan gives the spec's TFR % and extra deduction, and zeros. */
export function planToValues(plan: PensionPlan | null, goalId: string): PlanValues {
  if (!plan) return { ...NEW_PLAN, goalId, firstYear: "", ral: "", voluntary: "" };
  const values: PlanValues = {
    goalId: plan.goalId,
    firstYear: String(plan.firstYear),
    ral: plan.ral === undefined ? "" : centsToEuros(plan.ral),
    ralGrowth: fractionToPercent(plan.ralGrowth),
    tfrPct: fractionToPercent(plan.tfrPct),
    workerPct: fractionToPercent(plan.workerPct),
    employerPct: fractionToPercent(plan.employerPct),
    voluntary: plan.voluntary === null ? "" : centsToEuros(plan.voluntary),
    marginalRate: fractionToPercent(plan.marginalRate),
    extra: centsToEuros(plan.extra),
  };
  for (const flow of plan.flows)
    values[flowKey(flow.flow, flow.productId)] = fractionToPercent(flow.pct);
  return values;
}

/**
 * The document to save. A blank RAL means no schedule; a blank voluntary means "to cap". A blank
 * flow is no flow. Bad text becomes NaN, which the server refuses with the name of the field.
 */
export function valuesToPlan(values: PlanValues, productIds: readonly string[]): PensionPlan {
  const text = (key: string) => values[key] ?? "";
  const flows: PensionFlow[] = productIds.flatMap((productId) =>
    (["Work", "Voluntary"] as const).flatMap((flow) => {
      const entered = text(flowKey(flow, productId));
      return entered.trim() === "" ? [] : [{ productId, flow, pct: percentToFraction(entered) }];
    }),
  );
  return {
    goalId: text("goalId"),
    firstYear: num(text("firstYear")),
    ral: text("ral").trim() === "" ? undefined : eurosToCents(text("ral")),
    ralGrowth: percentToFraction(text("ralGrowth")),
    tfrPct: percentToFraction(text("tfrPct")),
    workerPct: percentToFraction(text("workerPct")),
    employerPct: percentToFraction(text("employerPct")),
    voluntary: text("voluntary").trim() === "" ? null : eurosToCents(text("voluntary")),
    marginalRate: percentToFraction(text("marginalRate")),
    extra: eurosToCents(text("extra")),
    flows,
  };
}
