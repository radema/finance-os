import type { Cell } from "./xlsx.ts";

/** The type of a Fineco movement. `unknown` rows are kept so the import can flag them. */
export type MovementType = "buy" | "sell" | "coupon" | "unknown";

/**
 * One normalised row of the Fineco "Movimenti Dossier Titoli" sheet. Numbers stay exact decimal
 * text (`null` when the cell is empty) so later steps can scale them to integers.
 */
export type ParsedRow = {
  /** Row number in the sheet, starting at 1. */
  rowNumber: number;
  /** Trade date as `YYYY-MM-DD`, or `null` when `Operazione` is not a valid `DD/MM/YYYY`. */
  date: string | null;
  /** The `Operazione` cell as read, kept for the "needs fix" message. */
  dateText: string;
  isin: string;
  /** Display hint only; never used to match a product. */
  title: string;
  type: MovementType;
  qty: string | null;
  /** Price as in the file; a BTP is priced per 100. */
  price: string | null;
  commission: string | null;
  controvalore: string | null;
  currency: string;
  fx: string | null;
  /** The `Descrizione` cell, trimmed. */
  description: string;
};

const COLUMNS = {
  date: "Operazione",
  description: "Descrizione",
  title: "Titolo",
  isin: "Isin",
  side: "Segno",
  qty: "Quantita",
  currency: "Divisa",
  price: "Prezzo",
  fx: "Cambio",
  controvalore: "Controvalore",
  commission: "Commissioni amministrato",
} as const;

// `Data valuta` is part of the header but its value is ignored.
const HEADER_NAMES = [...Object.values(COLUMNS), "Data valuta"];

// Header names compare without case, accents and outer spaces ("Quantità" = "Quantita").
const normalise = (cell: Cell | undefined): string =>
  (cell ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

const DATE_TEXT = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toIsoDate(text: string): string | null {
  const m = DATE_TEXT.exec(text.trim());
  if (m === null) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return valid ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function movementType(description: string, side: string): MovementType {
  const kind = description.toLowerCase();
  if (kind === "stacco cedole") return "coupon";
  if (kind === "compravendita titoli") {
    if (side === "A") return "buy";
    if (side === "V") return "sell";
  }
  return "unknown";
}

/** Finds the header by its column names, wherever it sits, and maps each name to a column. */
function findHeader(rows: Cell[][]): { rowIndex: number; columns: Map<string, number> } {
  for (const [rowIndex, row] of rows.entries()) {
    const names = row.map(normalise);
    const columns = new Map<string, number>();
    for (const name of HEADER_NAMES) {
      const col = names.indexOf(normalise(name));
      if (col >= 0) columns.set(name, col);
    }
    if (columns.size === HEADER_NAMES.length) return { rowIndex, columns };
  }
  throw new Error(`Fineco header row not found: expected the columns ${HEADER_NAMES.join(", ")}`);
}

/**
 * Parses the rows of the Fineco "Movimenti Dossier Titoli" sheet. The header is found by its
 * column names, so metadata rows, blank rows and column order do not matter. No row is dropped
 * for a bad cell.
 *
 * @param rows Sheet rows from `readXlsx`; `rows[i]` is sheet row `i + 1`.
 * @returns One normalised row per data row, in file order.
 * @throws When no row holds all the Fineco column names.
 */
export function parseFinecoMovimenti(rows: Cell[][]): ParsedRow[] {
  const { rowIndex: headerIndex, columns } = findHeader(rows);
  const parsed: ParsedRow[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    if (rowIndex <= headerIndex || row.every((cell) => (cell ?? "").trim() === "")) continue;
    const raw = (name: string): Cell => row[columns.get(name) ?? -1] ?? null;
    const text = (name: string): string => (raw(name) ?? "").trim();
    const number = (name: string): string | null => {
      const value = text(name);
      return value === "" ? null : value;
    };
    const dateText = text(COLUMNS.date);
    const description = text(COLUMNS.description);

    parsed.push({
      rowNumber: rowIndex + 1,
      date: toIsoDate(dateText),
      dateText,
      isin: text(COLUMNS.isin),
      title: text(COLUMNS.title),
      type: movementType(description, text(COLUMNS.side)),
      qty: number(COLUMNS.qty),
      price: number(COLUMNS.price),
      commission: number(COLUMNS.commission),
      controvalore: number(COLUMNS.controvalore),
      currency: text(COLUMNS.currency),
      fx: number(COLUMNS.fx),
      description,
    });
  }
  return parsed;
}
