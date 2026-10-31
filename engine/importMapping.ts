// The generic import path: guess a column map from headers, offer saved maps, and turn a table of
// cells into the normalised rows the transaction preview reads. Pure: no I/O.
import type { CsvSettings, DateFormat, DecimalFormat, Delimiter } from "./csv.ts";
import { parseDate, parseNumber } from "./csv.ts";
import { monthEnd } from "./months.ts";
import type { ImportRow } from "./transactionImport.ts";

export type ImportKind = "transactions" | "prices" | "products" | "goals";

/** The target fields of a transaction file. */
export const TRANSACTION_FIELDS = [
  "date",
  "bucket",
  "product",
  "type",
  "qty",
  "price",
  "commission",
  "note",
] as const;
export type TransactionField = (typeof TRANSACTION_FIELDS)[number];

/** Target field to the header name of the file. A field with no entry is not mapped. */
export type ColumnMap = Partial<Record<TransactionField, string>>;

/** A saved or built-in way to read a file: the column map and the parser settings. */
export interface ImportMapping {
  name: string;
  kind: ImportKind;
  columnMap: ColumnMap;
  delimiter: Delimiter | "auto";
  decimal: DecimalFormat;
  dateFormat: DateFormat;
}

/** The built-in preset. A file with the Fineco sheet and header is read by its own reader. */
export const FINECO_PRESET: ImportMapping = {
  name: "Fineco movimenti (XLSX)",
  kind: "transactions",
  columnMap: {
    date: "Operazione",
    product: "Isin",
    type: "Segno",
    qty: "Quantita",
    price: "Prezzo",
    commission: "Commissioni amministrato",
  },
  delimiter: "auto",
  decimal: "point",
  dateFormat: "dmy",
};

/** A table of text cells: the header names and the data rows with their row numbers in the file. */
export interface ImportTable {
  headers: string[];
  rows: { rowNumber: number; cells: string[] }[];
}

/** Header names compare without case, accents and outer spaces ("Quantità" = "quantita"). */
export const normaliseHeader = (name: string): string =>
  name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

// Aliases per field, best first. Fineco's own column names are included.
const ALIASES: Record<TransactionField, readonly string[]> = {
  date: ["date", "data", "operazione", "trade date", "data operazione"],
  bucket: ["bucket", "goal", "obiettivo"],
  product: [
    "isin",
    "ticker",
    "symbol",
    "product",
    "prodotto",
    "name",
    "nome",
    "titolo",
    "security",
  ],
  type: ["type", "side", "segno", "tipo", "buy/sell", "operation"],
  qty: ["qty", "quantity", "quantita", "units", "quote", "shares"],
  price: ["price", "prezzo", "unit price", "prezzo unitario"],
  commission: [
    "commission",
    "commissions",
    "commissione",
    "commissioni",
    "fee",
    "fees",
    "commissioni amministrato",
  ],
  note: ["note", "notes", "nota", "memo"],
};

/**
 * Guesses the column map from the headers: for each target field, the first alias that names a
 * header that no other field took.
 *
 * @param headers The header names of the file.
 * @param kind The import kind. Only `transactions` has target fields so far; others give `{}`.
 */
export function guessMapping(headers: readonly string[], kind: ImportKind): ColumnMap {
  if (kind !== "transactions") return {};
  const names = headers.map(normaliseHeader);
  const taken = new Set<number>();
  const map: ColumnMap = {};
  for (const field of TRANSACTION_FIELDS) {
    for (const alias of ALIASES[field]) {
      const index = names.findIndex((name, i) => name === alias && !taken.has(i));
      if (index >= 0) {
        map[field] = headers[index] as string;
        taken.add(index);
        break;
      }
    }
  }
  return map;
}

/**
 * The saved mappings of one kind whose columns all exist in the file, best first: the built-in
 * preset, then the mapping with more columns, then by name.
 *
 * @param headers The header names of the file.
 * @param candidates Saved mappings, plus the preset when it applies.
 * @param kind The import kind.
 */
export function suggestMappings(
  headers: readonly string[],
  candidates: readonly ImportMapping[],
  kind: ImportKind,
): ImportMapping[] {
  const names = new Set(headers.map(normaliseHeader));
  const size = (m: ImportMapping) => Object.keys(m.columnMap).length;
  return candidates
    .filter(
      (m) =>
        m.kind === kind &&
        size(m) > 0 &&
        Object.values(m.columnMap).every((column) => names.has(normaliseHeader(column))),
    )
    .sort(
      (a, b) =>
        Number(b.name === FINECO_PRESET.name) - Number(a.name === FINECO_PRESET.name) ||
        size(b) - size(a) ||
        a.name.localeCompare(b.name),
    );
}

const BUY_WORDS = new Set(["buy", "a", "acquisto"]);
const SELL_WORDS = new Set(["sell", "v", "vendita"]);

const decimalText = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "");

/** A number cell as exact decimal text; the raw text when it is not a number; null when empty. */
function numberText(cell: string, decimal: DecimalFormat): string | null {
  if (cell.trim() === "") return null;
  const value = parseNumber(cell, decimal);
  return value === undefined ? cell.trim() : decimalText(value);
}

/**
 * Turns a table into normalised rows with the column map and the parser settings. A cell that
 * cannot be read stays as text (or `date: null`), so the preview flags the row instead of losing it.
 *
 * Type: a type cell of `buy`, `sell`, `A` or `V` (any case); an empty cell, or no type column,
 * takes the sign of qty. Any other word is `unknown`. A month-only date is the last day of the month.
 *
 * @param table The header and data rows.
 * @param mapping The column map and the `decimal` and `dateFormat` settings.
 * @param goals The goals a bucket cell can name, by id or name.
 */
export function mapRows(
  table: ImportTable,
  mapping: { columnMap: ColumnMap } & Pick<CsvSettings, "decimal" | "dateFormat">,
  goals: readonly { id: string; name: string }[],
): ImportRow[] {
  const names = table.headers.map(normaliseHeader);
  const column = (field: TransactionField): number => {
    const header = mapping.columnMap[field];
    return header === undefined ? -1 : names.indexOf(normaliseHeader(header));
  };
  const index = Object.fromEntries(TRANSACTION_FIELDS.map((f) => [f, column(f)])) as Record<
    TransactionField,
    number
  >;
  const goalFor = (text: string): string | null => {
    const wanted = text.trim().toLowerCase();
    return (
      goals.find((g) => g.id.toLowerCase() === wanted || g.name.trim().toLowerCase() === wanted)
        ?.id ?? null
    );
  };

  return table.rows.map(({ rowNumber, cells }) => {
    const cell = (field: TransactionField): string => cells[index[field]] ?? "";
    const dateText = cell("date").trim();
    const parsed = parseDate(dateText, mapping.dateFormat);
    const date = parsed === undefined ? null : parsed.length === 7 ? monthEnd(parsed) : parsed;
    const product = cell("product").trim();
    const qty = numberText(cell("qty"), mapping.decimal);
    const word = cell("type").trim().toLowerCase();
    const type: ImportRow["type"] = BUY_WORDS.has(word)
      ? "buy"
      : SELL_WORDS.has(word)
        ? "sell"
        : word === ""
          ? qty?.startsWith("-")
            ? "sell"
            : "buy"
          : "unknown";
    const bucketText = cell("bucket").trim();
    return {
      rowNumber,
      date,
      dateText,
      isin: product,
      ticker: product,
      name: product,
      title: product,
      type,
      qty,
      price: numberText(cell("price"), mapping.decimal),
      commission: numberText(cell("commission"), mapping.decimal),
      controvalore: null,
      currency: "EUR",
      fx: null,
      description: "",
      ...(index.bucket >= 0 && bucketText !== "" ? { bucket: goalFor(bucketText) } : {}),
      note: cell("note").trim(),
    };
  });
}
