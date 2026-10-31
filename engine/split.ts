import { fromScaled, toScaled } from "./units.ts";

/** Units of one broker row assigned to one bucket. */
export type UnitPart = { goalId: string; units: number };

/** A part that becomes one Transaction: the bucket, its units and its share of the commission. */
export type Part = UnitPart & { commissionCents: number };

/** A split the user has not confirmed. It holds units only: no transaction parts. */
export type SplitPlan = {
  totalUnits: number;
  /** The row's commission in integer cents; 0 when there is none. */
  commissionCents: number;
  units: readonly UnitPart[];
};

/** A part of a coupon: the bucket and its share of the net cash, in integer cents. */
export type CouponPart = { goalId: string; amountCents: number };

declare const confirmedBrand: unique symbol;

/** A split the user confirmed. Only `confirmSplit` makes one. */
export type ConfirmedSplit = { readonly parts: readonly Part[]; readonly [confirmedBrand]: true };

const SHARE_PRECISION = 12;

const plural = (count: number): string => `${count} unit${count === 1 ? "" : "s"}`;

/**
 * Splits an integer by largest remainder: each entry gets the floor of its exact share, and the
 * leftover goes one each to the largest fractional remainders. Equal remainders go to the lower
 * goal id, so the result does not depend on the input order.
 *
 * @returns One integer per entry, in input order, summing to `total`.
 */
function apportion(
  total: number,
  entries: readonly { goalId: string; weight: number }[],
): number[] {
  const sumWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const exact = entries.map((e) =>
    Number(((total * e.weight) / sumWeight).toPrecision(SHARE_PRECISION)),
  );
  const shares = exact.map(Math.floor);
  const leftover = total - shares.reduce((sum, share) => sum + share, 0);

  const byRemainder = entries
    .map((e, index) => ({
      goalId: e.goalId,
      index,
      remainder: Number(((exact[index] ?? 0) - (shares[index] ?? 0)).toPrecision(SHARE_PRECISION)),
    }))
    .sort((a, b) => b.remainder - a.remainder || (a.goalId < b.goalId ? -1 : 1));
  for (const { index } of byRemainder.slice(0, leftover)) shares[index] = (shares[index] ?? 0) + 1;
  return shares;
}

/**
 * Whole units by largest remainder, in proportion to each bucket's weight of the product,
 * normalised over the buckets passed in. Parts of 0 units are dropped.
 *
 * @throws RangeError when the quantity is not a positive whole number (pension funds) or no bucket
 *   has a weight above 0.
 */
export function splitByWeights(
  totalUnits: number,
  weights: readonly { goalId: string; weight: number }[],
): UnitPart[] {
  if (!Number.isInteger(totalUnits) || totalUnits <= 0) {
    throw new RangeError(
      `Split by weights needs a whole number of units, and the quantity is ${totalUnits}. Split by units instead.`,
    );
  }
  const taking = weights.filter((w) => w.weight > 0);
  if (taking.length === 0)
    throw new RangeError("Split by weights needs a bucket with a weight above 0.");

  const shares = apportion(totalUnits, taking);
  return taking
    .map((w, index) => ({ goalId: w.goalId, units: shares[index] ?? 0 }))
    .filter((part) => part.units > 0);
}

/**
 * The user's typed units per bucket. `ready` only when the parts sum exactly to the broker
 * quantity and none is negative or not a number. `remaining` is the units left to assign: positive
 * when short, negative for an excess. Parts of 0 units are dropped.
 */
export function splitByUnits(
  totalUnits: number,
  typedParts: readonly UnitPart[],
): { ready: boolean; parts: UnitPart[]; remaining: number } {
  const valid = typedParts.every((part) => Number.isFinite(part.units) && part.units >= 0);
  const assigned = typedParts.reduce(
    (sum, part) => sum + (Number.isFinite(part.units) ? toScaled(part.units) : 0),
    0,
  );
  const remaining = fromScaled(toScaled(totalUnits) - assigned);
  return {
    ready: valid && remaining === 0,
    parts: typedParts.filter((part) => part.units > 0),
    remaining,
  };
}

/**
 * Splits a commission over the parts in proportion to their units, in integer cents by largest
 * remainder. The cents sum exactly to `commissionCents`.
 *
 * @throws RangeError when the commission is not a non-negative whole number of cents.
 */
export function splitCommission(commissionCents: number, parts: readonly UnitPart[]): Part[] {
  if (!Number.isInteger(commissionCents) || commissionCents < 0) {
    throw new RangeError(
      `The commission must be a whole number of cents, and it is ${commissionCents}.`,
    );
  }
  if (parts.length === 0) return [];
  const cents = apportion(
    commissionCents,
    parts.map((part) => ({ goalId: part.goalId, weight: part.units })),
  );
  return parts.map((part, index) => ({ ...part, commissionCents: cents[index] ?? 0 }));
}

/**
 * Splits a coupon's net cash over the buckets in proportion to the units they hold, in integer
 * cents by largest remainder. The parts sum exactly to `amountCents`. Buckets with no units and
 * parts of 0 cents are dropped.
 *
 * @throws RangeError when the amount is not a whole number of cents above 0, or no bucket holds units.
 */
export function splitCoupon(amountCents: number, unitsByBucket: readonly UnitPart[]): CouponPart[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(
      `The coupon must be a whole number of cents above 0, and it is ${amountCents}.`,
    );
  }
  const holding = unitsByBucket.filter((bucket) => bucket.units > 0);
  if (holding.length === 0) throw new RangeError("A coupon split needs a bucket with units held.");
  const cents = apportion(
    amountCents,
    holding.map((bucket) => ({ goalId: bucket.goalId, weight: bucket.units })),
  );
  return holding
    .map((bucket, index) => ({ goalId: bucket.goalId, amountCents: cents[index] ?? 0 }))
    .filter((part) => part.amountCents > 0);
}

/**
 * The explicit confirm: turns a plan into transaction parts. This is the only way to get parts.
 *
 * @throws RangeError when the units do not sum exactly to the broker quantity.
 */
export function confirmSplit(plan: SplitPlan): ConfirmedSplit {
  const { ready, parts, remaining } = splitByUnits(plan.totalUnits, plan.units);
  if (!ready || parts.length === 0) {
    const problem =
      remaining > 0
        ? `${plural(remaining)} still to assign`
        : remaining < 0
          ? `${plural(-remaining)} too many`
          : "a part is not a valid number of units";
    throw new RangeError(`The split cannot be confirmed: ${problem}.`);
  }
  return { parts: Object.freeze(splitCommission(plan.commissionCents, parts)) } as ConfirmedSplit;
}
