import type { Kysely } from "kysely";
import { sql } from "kysely";
import { z } from "zod";
import { backupBeforeImport } from "./backup.ts";
import type { DB } from "./db.ts";
import { HttpError } from "./router.ts";

/** The export file: every table as rows keyed by column name, and the migration it was made at. */
export const exportSchema = z.object({
  schemaVersion: z.string(),
  tables: z.record(
    z.string(),
    z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  ),
});
export type ExportDocument = z.infer<typeof exportSchema>;

// Kysely's own bookkeeping: not user data, and the file records the migration version instead.
const isUserTable = (name: string): boolean =>
  !name.startsWith("sqlite_") && !name.startsWith("kysely_");

// Column names are the database's, not camelCase: the file is a copy of the tables.
const rawSql = (db: Kysely<DB>): Kysely<DB> => db.withoutPlugins();

async function listTables(db: Kysely<DB>): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`.execute(rawSql(db));
  return rows.map((row) => row.name).filter(isUserTable);
}

async function schemaVersion(db: Kysely<DB>): Promise<string> {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(rawSql(db));
  return rows[0]?.name ?? "";
}

/** Primary-key columns in key order, or every column when the table has no key: a total order. */
async function orderColumns(db: Kysely<DB>, table: string): Promise<string[]> {
  const { rows } = await sql<{ name: string; pk: number }>`
    SELECT name, pk FROM pragma_table_info(${table}) ORDER BY cid`.execute(rawSql(db));
  const keys = rows.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  return (keys.length > 0 ? keys : rows).map((column) => column.name);
}

/**
 * Reads every table of the database into one document. The table list comes from the database, so
 * tables added by later migrations are covered. Tables and rows come in a fixed order and nothing
 * volatile is added, so equal data gives equal output.
 */
export async function exportAll(db: Kysely<DB>): Promise<ExportDocument> {
  const tables: ExportDocument["tables"] = {};
  for (const table of await listTables(db)) {
    const order = (await orderColumns(db, table)).map((column) => sql.id(column));
    const { rows } = await sql<ExportDocument["tables"][string][number]>`
      SELECT * FROM ${sql.id(table)} ORDER BY ${sql.join(order)}`.execute(rawSql(db));
    tables[table] = rows;
  }
  return { schemaVersion: await schemaVersion(db), tables };
}

async function checkCompatible(db: Kysely<DB>, document: ExportDocument): Promise<string[]> {
  const current = await schemaVersion(db);
  if (document.schemaVersion !== current) {
    throw new HttpError(
      400,
      `This file was made at migration version ${document.schemaVersion}; this app is at ${current}. Import it into the app version that made it.`,
    );
  }
  const names = await listTables(db);
  const unknown = Object.keys(document.tables).filter((name) => !names.includes(name));
  if (unknown.length > 0)
    throw new HttpError(400, `The file has unknown tables: ${unknown.join(", ")}`);
  const missing = names.filter((name) => !(name in document.tables));
  if (missing.length > 0)
    throw new HttpError(400, `The file lacks these tables: ${missing.join(", ")}`);
  return names;
}

/**
 * Replaces all data with the content of an export file. A file from another migration version is
 * refused. The database is backed up first, then every table is emptied and refilled in one
 * transaction, so a bad file leaves the data as it was.
 *
 * @param db Database handle.
 * @param dataDir Data folder, for the pre-import backup.
 * @param today The app clock, `YYYY-MM-DD`, for the backup name.
 * @param document The parsed export file.
 * @throws HttpError 400 when the file does not fit this database.
 */
export async function importAll(
  db: Kysely<DB>,
  dataDir: string,
  today: string,
  document: ExportDocument,
): Promise<void> {
  const names = await checkCompatible(db, document);
  await backupBeforeImport(db, dataDir, today);
  try {
    await rawSql(db)
      .transaction()
      .execute(async (trx) => {
        // Parent rows may come after their children in the file; the keys are checked at commit.
        await sql`PRAGMA defer_foreign_keys = ON`.execute(trx);
        for (const table of names) await sql`DELETE FROM ${sql.id(table)}`.execute(trx);
        for (const table of names) {
          for (const row of document.tables[table] ?? []) {
            const columns = Object.keys(row).map((column) => sql.id(column));
            const values = Object.values(row);
            await sql`INSERT INTO ${sql.id(table)} (${sql.join(columns)}) VALUES (${sql.join(values)})`.execute(
              trx,
            );
          }
        }
      });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `The file could not be imported, so nothing was changed: ${reason}`);
  }
}
