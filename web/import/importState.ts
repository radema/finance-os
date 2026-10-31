import type { ColumnMap } from "../../engine/importMapping.ts";
import type { ConfirmedSplit } from "../../engine/split.ts";
import type { ImportRow, PreviewRow, RowDecision } from "../../engine/transactionImport.ts";

/** The columns a transaction file needs, whatever the mapping. */
export const REQUIRED_FIELDS = ["date", "product", "qty", "price"] as const;

/** The required fields that the column map leaves out. */
export const missingFields = (columnMap: ColumnMap): string[] =>
  REQUIRED_FIELDS.filter((field) => columnMap[field] === undefined);

/** The decision that sends a confirmed split to the server: units per bucket, confirmed. */
export const splitDecision = (split: ConfirmedSplit): RowDecision => ({
  split: {
    confirmed: true,
    units: split.parts.map(({ goalId, units }) => ({ goalId, units })),
  },
});

/**
 * True for a `needs fix` row that repeats another row of the file, the one case the user can
 * confirm as a real order. It reads the preview's reason, so a test runs the real preview on it.
 */
export const isDuplicateFix = (preview: PreviewRow | undefined): boolean =>
  preview?.status === "needs fix" &&
  preview.reasons.some((reason) => reason.startsWith("same date"));

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** The link that opens the Products form with the name and the identifier of an unknown product. */
export function productPrefillHref(row: ImportRow): string {
  const params = new URLSearchParams();
  const name = row.title.trim() || (row.name ?? "").trim();
  if (name !== "") params.set("name", name);
  const isin = row.isin.trim();
  if (ISIN.test(isin.toUpperCase())) params.set("isin", isin.toUpperCase());
  else if (isin !== "" && !/\s/.test(isin)) params.set("ticker", isin);
  return `#/setup/products?${params}`;
}
