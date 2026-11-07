// Price CSV: long (date, product, price) or wide (a date column plus one column per product).
import type { CsvSettings } from "./csv.ts";
import { CsvError, parseDate, parseDelimited, parseNumber } from "./csv.ts";
import { monthEnd } from "./months.ts";

/** A price as the file states it. `product` is an ISIN, a ticker or a name, as typed in the file. */
export interface PriceRow {
  product: string;
  /** `YYYY-MM-DD`. A month-only date in the file becomes the last day of that month. */
  date: string;
  price: number;
}

export interface PriceCsvOptions extends CsvSettings {
  /** `auto` reads the file as long when it has 3 columns and the third header names a price. */
  format?: "long" | "wide" | "auto";
}

const PRICE_HEADER = /^(price|prezzo|close|chiusura|valore|value|nav)$/i;

/** The columns of the long layout, in order. The third one must match `PRICE_HEADER`. */
export const PRICE_LONG_COLUMNS = ["date", "product", "price"] as const;

/**
 * Reads a price CSV. The first row is the header; the first column is the date.
 *
 * @param text The file text.
 * @param options Parser settings and the layout.
 * @returns One row per price, in file order. Empty cells of a wide file give no row.
 * @throws CsvError naming the row (the header is row 1) of a date, product or price it cannot read.
 */
export function parsePriceCsv(text: string, options: PriceCsvOptions): PriceRow[] {
  const { rows } = parseDelimited(text, options);
  const [header, ...data] = rows;
  if (!header) throw new CsvError("The file is empty.");
  if (data.length === 0) throw new CsvError("The file has no price rows below the header.");

  const format =
    options.format && options.format !== "auto"
      ? options.format
      : header.length === 3 && PRICE_HEADER.test((header[2] as string).trim())
        ? "long"
        : "wide";

  const result: PriceRow[] = [];
  data.forEach((cells, index) => {
    const at = `Row ${index + 2}`;
    const date = parseDate(cells[0] ?? "", options.dateFormat);
    if (!date) throw new CsvError(`${at}: cannot read the date "${cells[0] ?? ""}".`);
    const full = date.length === 7 ? monthEnd(date) : date;
    const pairs: [product: string, priceText: string][] =
      format === "long"
        ? [[(cells[1] ?? "").trim(), cells[2] ?? ""]]
        : header.slice(1).map((name, column) => [name.trim(), cells[column + 1] ?? ""]);
    for (const [product, priceText] of pairs) {
      if (format === "wide" && priceText.trim() === "") continue;
      if (product === "") throw new CsvError(`${at}: the product is empty.`);
      const price = parseNumber(priceText, options.decimal);
      if (price === undefined || price <= 0) {
        throw new CsvError(`${at}: cannot read the price "${priceText}" of ${product}.`);
      }
      result.push({ product, date: full, price });
    }
  });
  return result;
}

/**
 * Keeps one row per key and month: the one with the latest date. The first of equal dates wins.
 *
 * @param rows Rows with an ISO `date`.
 * @param keyOf The key that names the product for the row.
 * @returns The kept rows, in the order of their first appearance.
 */
export function latestPerMonth<T extends { date: string }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const kept = new Map<string, T>();
  for (const row of rows) {
    const id = `${keyOf(row)}|${row.date.slice(0, 7)}`;
    const held = kept.get(id);
    if (!held || row.date > held.date) kept.set(id, row);
  }
  return [...kept.values()];
}
