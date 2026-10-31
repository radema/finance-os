// CSV text reading shared by the price import (S2 #31) and the transaction import (#32). Pure: no
// I/O. Cells stay text; `parseNumber` and `parseDate` read one cell with the parser settings.

export type Delimiter = ";" | "," | "\t";
export type DecimalFormat = "comma" | "point" | "auto";
/** `iso` is YYYY-MM-DD, `dmy` is DD/MM/YYYY, `ym` is YYYY-MM. */
export type DateFormat = "iso" | "dmy" | "ym" | "auto";

/** The parser settings. One object travels with a file: each reader uses the fields it needs. */
export interface CsvSettings {
  delimiter: Delimiter | "auto";
  decimal: DecimalFormat;
  dateFormat: DateFormat;
}

/** A file the parser cannot read. `message` is fit to show the user. */
export class CsvError extends Error {}

export interface DelimitedTable {
  /** The delimiter used: the one named, or the one detected. */
  delimiter: Delimiter;
  /** Every non-blank line, header included, as untrimmed cell text. */
  rows: string[][];
}

// On a tie the earlier entry wins: ";" first, because a decimal comma file rarely uses it elsewhere.
const CANDIDATES: readonly Delimiter[] = [";", "\t", ","];

function detectDelimiter(firstLine: string): Delimiter {
  const count = (delimiter: Delimiter) => firstLine.split(delimiter).length - 1;
  return CANDIDATES.reduce((best, next) => (count(next) > count(best) ? next : best));
}

/**
 * Splits CSV text into rows of cells. Handles double-quoted fields (with `""` for a quote), CRLF
 * and a leading byte order mark. Blank lines are dropped.
 *
 * @param text The file text.
 * @param settings Only `delimiter` is read here; `"auto"` picks `;`, tab or `,` from the first line.
 * @returns The delimiter used and the rows.
 * @throws CsvError when a quoted field is not closed.
 */
export function parseDelimited(text: string, settings: Partial<CsvSettings> = {}): DelimitedTable {
  const body = text.replace(/^﻿/, "");
  const named =
    settings.delimiter && settings.delimiter !== "auto" ? settings.delimiter : undefined;
  const delimiter = named ?? detectDelimiter(body.split(/\r?\n/).find((l) => l.trim()) ?? "");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (body[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") endRow();
    else if (char !== "\r") cell += char;
  }
  if (quoted) throw new CsvError("A quoted field is not closed.");
  endRow();
  return { delimiter, rows };
}

/**
 * Reads one cell as a number.
 *
 * @param text Cell text, for example `1.234,56`.
 * @param decimal `comma`: `,` is the decimal mark and `.` groups thousands. `point`: the reverse.
 * `auto`: when both marks appear the last one is the decimal mark, a lone `,` is a decimal comma.
 * @returns The number, or undefined when the cell is empty or not a number.
 */
export function parseNumber(text: string, decimal: DecimalFormat): number | undefined {
  const value = text.trim();
  if (value === "") return undefined;
  const lastComma = value.lastIndexOf(",");
  const lastPoint = value.lastIndexOf(".");
  const commaIsDecimal = decimal === "comma" || (decimal === "auto" && lastComma > lastPoint);
  const normal = commaIsDecimal
    ? value.replaceAll(".", "").replace(",", ".")
    : value.replaceAll(",", "");
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(normal) ? Number(normal) : undefined;
}

const isRealDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Reads one cell as a date.
 *
 * @param text Cell text in one of the three formats.
 * @param format The format to accept; `auto` tries all three.
 * @returns `YYYY-MM-DD`, or `YYYY-MM` for a month-only cell; undefined when the cell is not a real date.
 */
export function parseDate(text: string, format: DateFormat): string | undefined {
  const value = text.trim();
  if (format === "iso" || format === "auto") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return value;
  }
  if (format === "dmy" || format === "auto") {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (m && isRealDate(Number(m[3]), Number(m[2]), Number(m[1]))) {
      return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    }
  }
  if (format === "ym" || format === "auto") {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return value;
  }
  return undefined;
}
