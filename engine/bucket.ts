import type { Holdings } from "./holdings.ts";
import { toScaled } from "./units.ts";

/** One AllocationWeight row: the weight of a product in a goal's bucket. */
export type BucketWeight = { goalId: string; productId: string; weight: number };

/**
 * One imported row, reduced to what the chain needs.
 *
 * `bucket` is the goal id the row's bucket column resolved to. It is `undefined` when the row has
 * no bucket value, and `null` when the value names no known bucket.
 */
export type BucketRow = { productId: string; bucket?: string | null };

export type BucketAssignment =
  | { goalId: string; via: "column" | "holding" | "weights" }
  | { needsGoal: true; candidates: string[] };

/**
 * The bucket chain for one row: the bucket column; else the only bucket that holds the product
 * (non-zero units) or has it in its weights (weight above 0); else the user picks.
 *
 * An unknown bucket name goes straight to "needs a goal". The candidates are the buckets the
 * user can pick from, sorted by goal id.
 */
export function assignBucket(
  row: BucketRow,
  holdings: Holdings,
  weights: readonly BucketWeight[],
): BucketAssignment {
  if (typeof row.bucket === "string") return { goalId: row.bucket, via: "column" };

  const holding = new Set<string>();
  for (const [goalId, products] of holdings.units) {
    if (toScaled(products.get(row.productId) ?? 0) !== 0) holding.add(goalId);
  }
  const weighted = new Set(
    weights.filter((w) => w.productId === row.productId && w.weight > 0).map((w) => w.goalId),
  );
  const candidates = [...new Set([...holding, ...weighted])].sort();

  const [only] = candidates;
  if (row.bucket === undefined && only !== undefined && candidates.length === 1) {
    return { goalId: only, via: holding.has(only) ? "holding" : "weights" };
  }
  return { needsGoal: true, candidates };
}
