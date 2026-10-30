import { sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

// Forward-only: a migration has no `down`. Keys sort in application order.
const migrations: Record<string, Migration> = {
  "001-baseline": {
    async up(db) {
      await sql`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`.execute(db);
    },
  },
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
