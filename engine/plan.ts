/** One version of a goal's monthly plan. `fromMonth` is `YYYY-MM`. */
export interface PlanVersion {
  fromMonth: string;
  monthly: number;
}

/**
 * The monthly amount in force for a month: the version with the greatest `fromMonth` not after
 * `month`. No such version means 0.
 *
 * @param versions The goal's plan history, in any order.
 * @param month `YYYY-MM`.
 */
export function planInForce(versions: readonly PlanVersion[], month: string): number {
  let inForce: PlanVersion | undefined;
  for (const version of versions) {
    // `YYYY-MM` strings sort in calendar order.
    if (version.fromMonth <= month && (!inForce || version.fromMonth > inForce.fromMonth)) {
      inForce = version;
    }
  }
  return inForce?.monthly ?? 0;
}
