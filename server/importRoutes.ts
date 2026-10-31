import type { Kysely } from "kysely";
import { z } from "zod";
import type { ColumnMap, ImportKind, ImportMapping } from "../engine/importMapping.ts";
import {
  FINECO_PRESET,
  guessMapping,
  mapRows,
  suggestMappings,
  TRANSACTION_FIELDS,
} from "../engine/importMapping.ts";
import type { ImportRow, RowDecision } from "../engine/transactionImport.ts";
import type { DB } from "./db.ts";
import { parseFinecoMovimenti } from "./finecoMovimenti.ts";
import type { ImportFile } from "./importFile.ts";
import { readImportFile } from "./importFile.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { commitTransactionImport, previewImport } from "./transactionImport.ts";

const KINDS = ["transactions", "prices", "products", "goals"] as const;
const delimiter = z.enum([";", ",", "\t", "auto"]);
const decimal = z.enum(["comma", "point", "auto"]);
const dateFormat = z.enum(["iso", "dmy", "ym", "auto"]);

const mappingFields = {
  name: z.string(),
  columnMap: z.partialRecord(z.enum(TRANSACTION_FIELDS), z.string().min(1)),
  delimiter,
  decimal,
  dateFormat,
};
const savedMappingBody = z.object({
  ...mappingFields,
  name: z.string().trim().min(1),
  kind: z.enum(KINDS),
});
const fileFields = {
  fileName: z.string().default("pasted text"),
  text: z.string().optional(),
  xlsx: z.string().optional(),
  sheet: z.string().optional(),
};
const hasContent = (body: { text?: string; xlsx?: string }) =>
  body.text !== undefined || body.xlsx !== undefined;
const noContent = { message: "send `text` or `xlsx`", path: ["text"] };

const readBody = z
  .object({ ...fileFields, delimiter: delimiter.default("auto") })
  .refine(hasContent, noContent);
const decisionSchema = z.object({
  goalId: z.string().optional(),
  split: z
    .object({
      units: z.array(z.object({ goalId: z.string(), units: z.number() })),
      confirmed: z.boolean(),
    })
    .optional(),
  confirmDuplicate: z.boolean().optional(),
});
const runBody = z
  .object({
    ...fileFields,
    mapping: z.object(mappingFields),
    decisions: z.record(z.string(), decisionSchema).default({}),
  })
  .refine(hasContent, noContent);
const kindQuery = z.object({ kind: z.enum(KINDS).default("transactions") });
const deleteQuery = z.object({ kind: z.enum(KINDS), name: z.string().min(1) });

const REQUIRED = ["date", "product", "qty", "price"] as const;

const toMapping = (row: {
  name: string;
  kind: ImportKind;
  columnMap: string;
  delimiter: string;
  decimalFormat: string;
  dateFormat: string;
}): ImportMapping => ({
  name: row.name,
  kind: row.kind,
  columnMap: JSON.parse(row.columnMap) as ColumnMap,
  delimiter: row.delimiter as ImportMapping["delimiter"],
  decimal: row.decimalFormat as ImportMapping["decimal"],
  dateFormat: row.dateFormat as ImportMapping["dateFormat"],
});

const loadSaved = async (db: Kysely<DB>, kind: ImportKind): Promise<ImportMapping[]> =>
  (
    await db
      .selectFrom("importMapping")
      .selectAll()
      .where("kind", "=", kind)
      .orderBy("name")
      .execute()
  ).map(toMapping);

/** The rows of a file under a mapping: the Fineco reader for the preset, the generic mapper otherwise. */
async function importRows(
  db: Kysely<DB>,
  body: { mapping: Omit<ImportMapping, "kind">; sheet?: string } & ImportFile,
): Promise<ImportRow[]> {
  const file = readImportFile(body, body.mapping.delimiter);
  if (body.mapping.name === FINECO_PRESET.name) {
    if (!file.fineco) throw new HttpError(400, "This file has no Fineco movements sheet.");
    return parseFinecoMovimenti(file.cells);
  }
  const missing = REQUIRED.filter((field) => body.mapping.columnMap[field] === undefined);
  if (missing.length > 0) {
    throw new HttpError(400, `Map these columns first: ${missing.join(", ")}.`);
  }
  const goals = await db.selectFrom("goal").select(["id", "name"]).execute();
  return mapRows(file.table, body.mapping, goals);
}

const toDecisions = (
  decisions: Record<string, z.infer<typeof decisionSchema>>,
): Record<number, RowDecision> =>
  Object.fromEntries(Object.entries(decisions).map(([row, decision]) => [Number(row), decision]));

/** Import: read a file, preview and commit transactions, saved mappings, the list of batches. */
export function registerImportRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/import/read", readBody, async ({ delimiter: asked, ...file }) => {
    const read = readImportFile(file, asked);
    const { headers } = read.table;
    const guess = guessMapping(headers, "transactions");
    const saved = await loadSaved(db, "transactions");
    const suggestions = suggestMappings(
      headers,
      read.fineco ? [FINECO_PRESET, ...saved] : saved,
      "transactions",
    );
    const mapping: ImportMapping = suggestions[0] ?? {
      name: "Auto-guess",
      kind: "transactions",
      columnMap: guess,
      delimiter: read.delimiter,
      decimal: "auto",
      dateFormat: "auto",
    };
    return {
      kind: read.kind,
      sheets: read.sheets,
      sheet: read.sheet,
      headers,
      rowCount: read.fineco ? parseFinecoMovimenti(read.cells).length : read.table.rows.length,
      guess,
      suggestions,
      mapping,
    };
  });

  router.route("POST", "/api/import/preview", runBody, async ({ decisions, ...body }) => {
    const rows = await importRows(db, body);
    return { rows, previews: await previewImport(db, rows, toDecisions(decisions)) };
  });

  router.route("POST", "/api/import/commit", runBody, async ({ decisions, ...body }) => {
    const rows = await importRows(db, body);
    const batch = await commitTransactionImport(db, rows, toDecisions(decisions), {
      sourceName: body.mapping.name.trim() || "Custom mapping",
      fileName: body.fileName,
    });
    return {
      batchId: batch?.id ?? null,
      rowsRead: rows.length,
      rowsImported: batch?.rowsImported ?? 0,
      rowsSkipped: batch?.rowsSkipped ?? rows.length,
    };
  });

  router.route("GET", "/api/import/batches", z.object({}), async () => {
    const batches = await db
      .selectFrom("importBatch")
      .select([
        "id",
        "kind",
        "sourceName",
        "fileName",
        "createdAt",
        "rowsRead",
        "rowsImported",
        "rowsSkipped",
        "undoneAt",
      ])
      .orderBy("createdAt", "desc")
      .execute();
    return batches;
  });

  router.route("GET", "/api/import/mappings", kindQuery, ({ kind }) => loadSaved(db, kind));

  router.route("PUT", "/api/import/mappings", savedMappingBody, async (body) => {
    if (body.name === FINECO_PRESET.name) {
      throw new HttpError(400, `"${body.name}" is the built-in preset. Choose another name.`);
    }
    const { columnMap, decimal: decimalFormat, ...rest } = body;
    const values = { ...rest, columnMap: JSON.stringify(columnMap), decimalFormat };
    await db
      .insertInto("importMapping")
      .values(values)
      .onConflict((conflict) =>
        conflict.columns(["kind", "name"]).doUpdateSet({
          columnMap: values.columnMap,
          delimiter: values.delimiter,
          decimalFormat,
          dateFormat: values.dateFormat,
        }),
      )
      .execute();
    return body satisfies ImportMapping;
  });

  router.route("DELETE", "/api/import/mappings", deleteQuery, async ({ kind, name }) => {
    await db
      .deleteFrom("importMapping")
      .where("kind", "=", kind)
      .where("name", "=", name)
      .execute();
    return { kind, name };
  });
}
