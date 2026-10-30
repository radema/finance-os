import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "kysely";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { migrationProvider } from "./migrations.ts";

export interface DB {
  meta: { key: string; value: string };
}

export const DATABASE_FILE = "gbi.sqlite";

// node:sqlite takes positional params as arguments; Kysely passes one array and wants a `reader` flag.
function adapt(database: DatabaseSync): SqliteDatabase {
  return {
    close: () => database.close(),
    prepare(text) {
      const statement = database.prepare(text);
      return {
        reader: statement.columns().length > 0,
        all: (params) => statement.all(...(params as never[])),
        run: (params) => statement.run(...(params as never[])),
        iterate: (params) => statement.iterate(...(params as never[])),
      };
    },
  };
}

/**
 * Opens the SQLite file in `dataDir`, creating the folder if needed, turns on WAL and applies
 * every pending migration.
 *
 * @param dataDir Folder that holds the database file.
 * @returns The Kysely handle; call `destroy()` to close the file.
 */
export async function openDatabase(dataDir: string): Promise<Kysely<DB>> {
  mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
  database.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: adapt(database) }) });
  const { error } = await new Migrator({ db, provider: migrationProvider }).migrateToLatest();
  if (error) {
    await db.destroy();
    throw error;
  }
  return db;
}
