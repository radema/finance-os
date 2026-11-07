import { canUseProvider, PRICE_SOURCES } from "../../engine/schemas.ts";
import { num } from "../forms.ts";
import { formatPrice } from "../money.ts";
import type { PriceOverviewRow } from "./types.ts";

/** The text of an editable month cell: the format of the read-only cells, so both read alike. */
export const priceText = (stored: { price: number } | undefined): string =>
  stored ? formatPrice(stored.price) : "";

/** The price to store for the text of a cell, or nothing when it is unchanged, empty or not a number. */
export function priceToSave(text: string, initial: string): number | undefined {
  const price = num(text);
  return text !== initial && Number.isFinite(price) ? price : undefined;
}

/** A product with the Provider source and a ticker can be fetched on its own. */
export const canRefetch = (row: Pick<PriceOverviewRow, "priceSource" | "ticker">): boolean =>
  row.priceSource === "provider" && row.ticker.trim() !== "";

/** The sources a product offers. Provider needs a ticker and a regime that allows it. */
export const sourceOptions = (row: Pick<PriceOverviewRow, "regime" | "ticker" | "priceSource">) =>
  PRICE_SOURCES.filter(
    (source) =>
      source !== "provider" ||
      row.priceSource === "provider" ||
      (canUseProvider(row.regime) && row.ticker.trim() !== ""),
  );

/** What the user typed in the Positions table, by product. A field that was not touched is absent. */
export type BrokerEdits = Record<string, { units?: string; date?: string }>;
type BrokerRow = Pick<PriceOverviewRow, "productId" | "brokerUnits" | "brokerUnitsDate">;

/** The two fields of a product row: the edit if there is one, else the saved value. */
export const brokerFields = (row: BrokerRow, edits: BrokerEdits) => ({
  units: edits[row.productId]?.units ?? (row.brokerUnits === null ? "" : String(row.brokerUnits)),
  date: edits[row.productId]?.date ?? row.brokerUnitsDate ?? "",
});

/** The products whose fields differ from what is saved. Units are compared as numbers: `12,5` is 12.5. */
export function changedBrokerRows(rows: readonly BrokerRow[], edits: BrokerEdits): string[] {
  return rows
    .filter((row) => {
      const { units, date } = brokerFields(row, edits);
      const sameUnits =
        units.trim() === "" ? row.brokerUnits === null : num(units) === row.brokerUnits;
      return !sameUnits || date !== (row.brokerUnitsDate ?? "");
    })
    .map((row) => row.productId);
}

/** The save call of one product. Both fields empty clears the entry. */
export function brokerBody(productId: string, fields: { units: string; date: string }) {
  const empty = fields.units.trim() === "" && fields.date === "";
  return {
    productId,
    units: empty ? null : num(fields.units),
    date: empty ? null : fields.date || null,
  };
}
