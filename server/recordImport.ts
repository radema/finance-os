import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { RecordKind, RecordPreview } from "../engine/recordImport.ts";
import {
  mapRecordRows,
  missingRecordFields,
  previewGoalImport,
  previewProductImport,
} from "../engine/recordImport.ts";
import type { Goal, GoalInput, Product, ProductInput } from "../engine/schemas.ts";
import { settingsSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import { toColumns as goalColumns } from "./goals.ts";
import type { ImportFile } from "./importFile.ts";
import { readImportFile } from "./importFile.ts";
import { toColumns as productColumns, fromRow as toProduct } from "./products.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import type { ImportBatch } from "./transactionImport.ts";

type Previews = RecordPreview<ProductInput>[] | RecordPreview<GoalInput>[];

async function loadProducts(db: Kysely<DB>): Promise<Product[]> {
  return (await db.selectFrom("product").selectAll().execute()).map(toProduct);
}

// The plan of a goal is not part of an import, so it is left empty here.
async function loadGoals(db: Kysely<DB>): Promise<Goal[]> {
  const rows = await db.selectFrom("goal").selectAll().execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority,
    targetCents: row.targetCents,
    targetYear: row.targetYear,
    contributionGrowth: row.contributionGrowth,
    minProb: row.minProb,
    countsTowardFi: row.countsTowardFi === 1,
    plan: [],
  }));
}

/** The check of the rows of a file against the products or goals as they are now. Nothing is written. */
export async function previewRecordImport(
  db: Kysely<DB>,
  kind: RecordKind,
  rows: ReturnType<typeof mapRecordRows>,
): Promise<Previews> {
  return kind === "products"
    ? previewProductImport(rows, await loadProducts(db))
    : previewGoalImport(rows, await loadGoals(db));
}

/**
 * Writes the new and updated rows of a file as one batch, in one database transaction. The
 * preview is computed again here; nothing the client holds is trusted. The batch keeps the ids of
 * the records it created, for undo.
 *
 * @returns The batch with the counts of created and updated rows, or `null` when no row is new
 * or updated: then nothing is written, not even a batch.
 */
export function commitRecordImport(
  db: Kysely<DB>,
  kind: RecordKind,
  rows: ReturnType<typeof mapRecordRows>,
  source: { sourceName: string; fileName: string },
): Promise<{ batch: ImportBatch; created: number; updated: number } | null> {
  return db.transaction().execute(async (trx) => {
    const previews = await previewRecordImport(trx, kind, rows);
    const toWrite = previews.filter((p) => p.status === "new" || p.status === "updated");
    if (toWrite.length === 0) return null;

    const createdIds: string[] = [];
    const batch: ImportBatch = {
      id: randomUUID(),
      kind,
      ...source,
      createdAt: new Date().toISOString(),
      rowsRead: rows.length,
      rowsImported: toWrite.length,
      rowsSkipped: rows.length - toWrite.length,
      undoneAt: null,
      priorPrices: null,
      createdIds: null,
    };
    for (const preview of toWrite) {
      const id = preview.matchId ?? randomUUID();
      if (preview.matchId === null) createdIds.push(id);
      if (kind === "products") {
        const columns = productColumns(preview.input as ProductInput);
        if (preview.matchId === null) {
          await trx
            .insertInto("product")
            .values({ id, ...columns })
            .execute();
        } else await trx.updateTable("product").set(columns).where("id", "=", id).execute();
      } else {
        const columns = goalColumns(preview.input as GoalInput);
        if (preview.matchId === null) {
          await trx
            .insertInto("goal")
            .values({ id, ...columns })
            .execute();
        } else await trx.updateTable("goal").set(columns).where("id", "=", id).execute();
      }
    }
    batch.createdIds = JSON.stringify(createdIds);
    await trx.insertInto("importBatch").values(batch).execute();
    return { batch, created: createdIds.length, updated: toWrite.length - createdIds.length };
  });
}

type UseTable = "transaction" | "pricePoint" | "allocationWeight" | "contributionPlan";
const PRODUCT_USES: [UseTable, "productId"][] = [
  ["transaction", "productId"],
  ["pricePoint", "productId"],
  ["allocationWeight", "productId"],
];
const GOAL_USES: [UseTable, "goalId"][] = [
  ["transaction", "goalId"],
  ["allocationWeight", "goalId"],
  ["contributionPlan", "goalId"],
];

async function isUsed(
  trx: Kysely<DB>,
  uses: [UseTable, "productId" | "goalId"][],
  id: string,
): Promise<boolean> {
  for (const [table, column] of uses) {
    // Kysely cannot resolve a column over a table union, so the query is typed as "transaction".
    const { n } = await trx
      .selectFrom(table as "transaction")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where(column as "productId", "=", id)
      .executeTakeFirstOrThrow();
    if (n > 0) return true;
  }
  return false;
}

/**
 * Deletes the products or goals a batch created, when nothing uses them. A product is in use when
 * a transaction, a price or an allocation weight names it. A goal is in use when a transaction, an
 * allocation weight or a plan version names it, or when it is the zainetto goal. Rows the batch
 * updated are never touched. Runs inside the caller's transaction; it does not set `undoneAt`.
 *
 * @param trx The caller's transaction.
 * @param batch The batch to undo.
 * @returns The ids deleted and the ids kept because they are in use. An id that no longer
 * exists is in neither list.
 */
export async function undoCreatedRows(
  trx: Kysely<DB>,
  batch: Pick<ImportBatch, "kind" | "createdIds">,
): Promise<{ deleted: string[]; kept: string[] }> {
  const result = { deleted: [] as string[], kept: [] as string[] };
  if ((batch.kind !== "products" && batch.kind !== "goals") || batch.createdIds === null) {
    return result;
  }
  const ids = z.array(z.string()).parse(JSON.parse(batch.createdIds));
  const zainettoGoal = (await loadDocument(trx, "settings", settingsSchema)).zainetto.goalId;
  for (const id of ids) {
    const used =
      batch.kind === "products"
        ? await isUsed(trx, PRODUCT_USES, id)
        : zainettoGoal === id || (await isUsed(trx, GOAL_USES, id));
    if (used) {
      result.kept.push(id);
      continue;
    }
    const { numDeletedRows } = await trx
      .deleteFrom(batch.kind === "products" ? "product" : "goal")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    if (numDeletedRows > 0n) result.deleted.push(id);
  }
  return result;
}

const body = z
  .object({
    kind: z.enum(["products", "goals"]),
    fileName: z.string().default("pasted text"),
    text: z.string().optional(),
    xlsx: z.string().optional(),
    sheet: z.string().optional(),
    mapping: z.object({
      columnMap: z.record(z.string(), z.string().min(1)),
      delimiter: z.enum([";", ",", "\t", "auto"]),
      decimal: z.enum(["comma", "point", "auto"]),
      dateFormat: z.enum(["iso", "dmy", "ym", "auto"]),
    }),
  })
  .refine((b) => b.text !== undefined || b.xlsx !== undefined, {
    message: "send `text` or `xlsx`",
    path: ["text"],
  });

function readRows(input: z.infer<typeof body>) {
  const file: ImportFile = input;
  const read = readImportFile(file, input.mapping.delimiter);
  const columnMap = input.mapping.columnMap;
  const missing = missingRecordFields(input.kind, columnMap);
  if (missing.length > 0)
    throw new HttpError(400, `Map these columns first: ${missing.join(", ")}.`);
  return { read, rows: mapRecordRows(read.table, input.kind, { ...input.mapping, columnMap }) };
}

/** Products and goals import: preview and commit of a file read with the generic mapping. */
export function registerRecordImportRoutes(router: Router, db: Kysely<DB>): void {
  router.route("POST", "/api/import/records/preview", body, async (input) => {
    const { rows } = readRows(input);
    return { previews: await previewRecordImport(db, input.kind, rows) };
  });

  router.route("POST", "/api/import/records/commit", body, async (input) => {
    const { read, rows } = readRows(input);
    const done = await commitRecordImport(db, input.kind, rows, {
      sourceName: read.kind === "xlsx" ? "XLSX file" : "CSV file",
      fileName: input.fileName,
    });
    return {
      batchId: done?.batch.id ?? null,
      rowsRead: rows.length,
      rowsImported: done?.batch.rowsImported ?? 0,
      rowsSkipped: done?.batch.rowsSkipped ?? rows.length,
      created: done?.created ?? 0,
      updated: done?.updated ?? 0,
    };
  });
}
