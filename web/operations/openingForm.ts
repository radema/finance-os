import type { OpeningPositionInput } from "../../engine/schemas.ts";
import type { ConfirmedSplit } from "../../engine/split.ts";
import { num } from "../forms.ts";

/** What the user typed for one product, and the split once confirmed. */
export type OpeningRow = { units: string; pmc: string; split?: ConfirmedSplit };

/** The default as-of date: the first day of the tracking-start month. */
export const defaultAsOf = (trackingStart: string): string => `${trackingStart}-01`;

/**
 * Turns the form into the API input. A product with no units and no PMC is left out.
 *
 * @returns The input, or the first problem in a sentence fit to show the user.
 */
export function buildOpeningInput(
  asOf: string,
  products: readonly { id: string; name: string }[],
  rows: Readonly<Record<string, OpeningRow | undefined>>,
  allowEmpty = false,
): { input: Omit<OpeningPositionInput, "cashBalances"> } | { error: string } {
  if (asOf === "") return { error: "Choose the as-of date." };
  const positions: OpeningPositionInput["positions"] = [];
  for (const { id, name } of products) {
    const row = rows[id];
    if (!row || (row.units.trim() === "" && row.pmc.trim() === "")) continue;
    const totalUnits = num(row.units);
    const pmc = num(row.pmc);
    if (!(totalUnits > 0)) return { error: `${name}: the units must be above 0.` };
    if (!(pmc > 0)) return { error: `${name}: the PMC must be above 0.` };
    if (!row.split) return { error: `${name}: confirm the split over the buckets.` };
    positions.push({
      productId: id,
      totalUnits,
      pmc,
      parts: row.split.parts.map(({ goalId, units }) => ({ goalId, units })),
    });
  }
  if (positions.length === 0 && !allowEmpty) return { error: "Fill in at least one product." };
  return { input: { asOf, positions } };
}
