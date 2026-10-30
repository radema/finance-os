/**
 * Rescales non-negative weights to shares that sum to 1. All-zero weights give all-zero shares:
 * no contribution is allocated.
 *
 * @param weights Non-negative weights.
 * @returns One share per weight, in the same order.
 */
export function normaliseWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (total > 0 ? weight / total : 0));
}
