import type { ColumnMap, ImportMapping } from "../../engine/importMapping.ts";
import type { ImportRow, PreviewRow } from "../../engine/transactionImport.ts";

/** A file as the API takes it: CSV text, or XLSX bytes as base64. */
export interface FilePayload {
  fileName: string;
  text?: string;
  xlsx?: string;
  sheet?: string;
}

/** `POST /api/import/read`. */
export interface ReadResult {
  kind: "csv" | "xlsx";
  sheets: string[];
  sheet: string | null;
  headers: string[];
  rowCount: number;
  guess: ColumnMap;
  /** The saved mappings that fit the file, best first; the built-in preset leads for a Fineco file. */
  suggestions: ImportMapping[];
  /** The mapping to start with: the best suggestion, else the guess. */
  mapping: ImportMapping;
}

/** `POST /api/import/preview`. */
export interface PreviewResult {
  rows: ImportRow[];
  previews: PreviewRow[];
}

/** `POST /api/import/commit`. `batchId` is null when no row was ready. */
export interface CommitResult {
  batchId: string | null;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
}

/** One row of `GET /api/import/batches`. */
export interface BatchRow {
  id: string;
  kind: "transactions" | "prices" | "products" | "goals";
  sourceName: string;
  fileName: string;
  createdAt: string;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  undoneAt: string | null;
}
