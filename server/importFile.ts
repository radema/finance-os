import { CsvError, type Delimiter, parseDelimited } from "../engine/csv.ts";
import type { ImportTable } from "../engine/importMapping.ts";
import { FINECO_SHEET, finecoHeaderIndex } from "./finecoMovimenti.ts";
import { HttpError } from "./router.ts";
import type { Cell } from "./xlsx.ts";
import { readXlsx } from "./xlsx.ts";

/** A file as the client sends it: CSV text, or XLSX bytes as base64. */
export interface ImportFile {
  fileName: string;
  text?: string;
  xlsx?: string;
  /** The sheet to read from an XLSX file. */
  sheet?: string;
}

export interface ReadFile {
  kind: "csv" | "xlsx";
  /** Sheet names of an XLSX file; empty for a CSV. */
  sheets: string[];
  /** The sheet read; null for a CSV. */
  sheet: string | null;
  /** The delimiter used by a CSV; `auto` for an XLSX. */
  delimiter: Delimiter | "auto";
  table: ImportTable;
  /** The sheet rows as read, for the Fineco reader; empty for a CSV. */
  cells: Cell[][];
  /** True when the sheet has the Fineco movements header. */
  fineco: boolean;
}

const isBlank = (row: readonly Cell[]): boolean => row.every((cell) => (cell ?? "").trim() === "");

/**
 * Reads a file into a table of text cells. The header of a CSV is its first line. An XLSX takes
 * the sheet named, else the Fineco sheet, else the first one; its header is the Fineco header row
 * when there is one, else the first row that is not blank.
 *
 * @param file The file.
 * @param delimiter The CSV delimiter; `auto` detects it.
 * @throws HttpError 400 with a readable message when the file cannot be read.
 */
export function readImportFile(file: ImportFile, delimiter: Delimiter | "auto"): ReadFile {
  try {
    if (file.xlsx !== undefined) return readSheet(file);
    return readText(file.text ?? "", delimiter);
  } catch (error) {
    if (error instanceof HttpError || error instanceof CsvError) {
      throw error instanceof HttpError ? error : new HttpError(400, error.message);
    }
    throw new HttpError(
      400,
      `The file cannot be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function readText(text: string, delimiter: Delimiter | "auto"): ReadFile {
  const parsed = parseDelimited(text, { delimiter });
  const [headers, ...rest] = parsed.rows;
  if (!headers) throw new HttpError(400, "The file is empty.");
  return {
    kind: "csv",
    sheets: [],
    sheet: null,
    delimiter: parsed.delimiter,
    // Blank lines are dropped by the parser, so a row number counts the non-blank lines.
    table: { headers, rows: rest.map((cells, i) => ({ rowNumber: i + 2, cells })) },
    cells: [],
    fineco: false,
  };
}

function readSheet(file: ImportFile): ReadFile {
  const sheets = readXlsx(Buffer.from(file.xlsx ?? "", "base64"));
  const chosen =
    sheets.find((s) => s.name === file.sheet) ??
    sheets.find((s) => s.name === FINECO_SHEET) ??
    sheets[0];
  if (!chosen) throw new HttpError(400, "The workbook has no sheet.");
  const fineco = finecoHeaderIndex(chosen.rows);
  const headerIndex = fineco ?? chosen.rows.findIndex((row) => !isBlank(row));
  if (headerIndex < 0) throw new HttpError(400, `The sheet "${chosen.name}" is empty.`);
  const text = (row: Cell[]) => row.map((cell) => (cell ?? "").trim());
  return {
    kind: "xlsx",
    sheets: sheets.map((s) => s.name),
    sheet: chosen.name,
    delimiter: "auto",
    table: {
      headers: text(chosen.rows[headerIndex] as Cell[]),
      rows: chosen.rows.flatMap((row, i) =>
        i > headerIndex && !isBlank(row) ? [{ rowNumber: i + 1, cells: text(row) }] : [],
      ),
    },
    cells: chosen.rows,
    fineco: fineco !== undefined,
  };
}
