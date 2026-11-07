import { normaliseWeights } from "../../engine/projection.ts";
import { num } from "../forms.ts";

/** What the user typed in a goal's weight inputs, by product. A weight that was not touched is absent. */
export type WeightEdits = Record<string, string>;
type WeightRow = { productId: string; weight: number };

/** The text of a weight input: the edit if there is one, else the stored weight. */
export const weightText = (row: WeightRow, edits: WeightEdits): string =>
  edits[row.productId] ?? String(row.weight);

/**
 * The weights to save and the shares to show, for one goal.
 *
 * `changed` holds the rows whose text differs from the stored number (`2,0` is 2); text that is not a
 * number counts as changed and carries NaN, so Save can say so. `shares` rescales the typed weights
 * to 1; a weight that is not a number keeps its stored value in the shares.
 */
export function previewWeights(
  rows: readonly WeightRow[],
  edits: WeightEdits,
): { changed: WeightRow[]; shares: Map<string, number> } {
  const typed = rows.map((row) => ({
    productId: row.productId,
    weight: num(weightText(row, edits)),
  }));
  const changed = typed.filter((row, i) => row.weight !== (rows[i] as WeightRow).weight);
  const used = typed.map(
    (row, i) =>
      [
        row.productId,
        Number.isFinite(row.weight) ? row.weight : (rows[i] as WeightRow).weight,
      ] as const,
  );
  return { changed, shares: normaliseWeights(new Map(used)) };
}
