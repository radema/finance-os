// What the Optimizer screen reads from the API. Amounts are today's euros as floats; rounding
// happens only in the view.
import type { MixResult, OptimizerCriterion } from "./optimizer.ts";

/** One mix: the weight of each product as a fraction (they sum to 1), and what it comes to. */
export interface MixView extends Omit<MixResult, "weights"> {
  weights: { productId: string; weight: number }[];
}

/** The answer of `POST /api/optimizer/run`. */
export interface OptimizerRunView {
  /** The valuation date: the month-end of the last month that has prices. */
  asOf: string;
  mode: "new" | "rebalance";
  criterion: OptimizerCriterion;
  /** The probability the goal must reach, as a fraction. */
  requiredP: number;
  /** The goal's target at the goal date, in euros of that date. */
  target: number;
  /** The bucket as it is: its own weights and holdings, on the same simulated markets. */
  current: MixView;
  /** The mix the rule chose. */
  chosen: MixView;
  /** No mix reaches the required probability: `chosen` is the one with the highest P. */
  notFeasible: boolean;
  ruleName: string;
  /** The rule that chose the mix, in plain words. */
  ruleText: string;
  /** Tax on selling the holdings: 0 in "new" mode. */
  switchTax: number;
  /** Every candidate, in candidate order. */
  mixes: MixView[];
  /** The best mixes by the rule, the first one is `chosen`. */
  top: MixView[];
}

/** A mix as the API sends it: the weights as a list, without the products that get 0. */
export const mixView = (mix: MixResult): MixView => ({
  ...mix,
  weights: [...mix.weights]
    .filter(([, weight]) => weight > 0)
    .map(([productId, weight]) => ({ productId, weight })),
});
