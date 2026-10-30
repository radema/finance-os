/* SQLite through the built-in node:sqlite, queried with Kysely. The adapter below is the only glue (ticket 05 check: how Kysely binds to node:sqlite). */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';
import type { SqliteDatabase, SqliteStatement } from 'kysely';

export interface Tables {
  meta: { key: string; value: string };
  product: { id: string; name: string; isin: string; cls: string; regime: string; wl: number; mu: number; vol: number; ter: number; zero: number; maturity: string; ticker: string; source: string; coupon_rate: number };
  goal: { id: string; name: string; priority: string; target: number; year: number; cgrowth: number; min_prob: number | null; counts_fi: number; is_pension: number; ord: number };
  goal_plan: { goal_id: string; from_month: string; amount: number };
  weight: { goal_id: string; product_id: string; weight: number };
  tx: { id: string; date: string; goal_id: string; product_id: string; type: string; qty: number; price: number; commission_cents: number | null; amount_cents: number | null; note: string; batch_id: string | null };
  price: { product_id: string; month: string; price: number; source: string; fetched_at: string };
  import_batch: { id: string; kind: string; source: string; file_name: string; created_at: string; rows_read: number; rows_imported: number; rows_skipped: number; undone_at: string | null };
  snapshot: { month: string; date: string; source: string; goals: string };
}
export type Db = Kysely<Tables>;

/** node:sqlite statements take positional params as arguments; Kysely passes one array and wants a `reader` flag. `columns()` is non-empty for statements that return rows. */
function adapt(raw: DatabaseSync): SqliteDatabase {
  return {
    close: () => raw.close(),
    prepare(text: string): SqliteStatement {
      const stmt = raw.prepare(text);
      return {
        reader: stmt.columns().length > 0,
        all: p => stmt.all(...(p as never[])),
        run: p => stmt.run(...(p as never[])),
        iterate: p => stmt.iterate(...(p as never[]))
      };
    }
  };
}

const M: Record<string, Migration> = {
  '001-init': {
    async up(db) {
      const ddl = [
        `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
        `CREATE TABLE product (id TEXT PRIMARY KEY, name TEXT NOT NULL, isin TEXT NOT NULL, cls TEXT NOT NULL, regime TEXT NOT NULL, wl REAL NOT NULL, mu REAL NOT NULL, vol REAL NOT NULL, ter REAL NOT NULL,
          zero INTEGER NOT NULL, maturity TEXT NOT NULL, ticker TEXT NOT NULL, source TEXT NOT NULL, coupon_rate REAL NOT NULL) STRICT`,
        `CREATE TABLE goal (id TEXT PRIMARY KEY, name TEXT NOT NULL, priority TEXT NOT NULL, target REAL NOT NULL, year INTEGER NOT NULL, cgrowth REAL NOT NULL, min_prob REAL,
          counts_fi INTEGER NOT NULL, is_pension INTEGER NOT NULL, ord INTEGER NOT NULL) STRICT`,
        `CREATE TABLE goal_plan (goal_id TEXT NOT NULL, from_month TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (goal_id, from_month)) STRICT`,
        `CREATE TABLE weight (goal_id TEXT NOT NULL, product_id TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY (goal_id, product_id)) STRICT`,
        /* money in integer cents; units and unit prices keep their decimals */
        `CREATE TABLE tx (id TEXT PRIMARY KEY, date TEXT NOT NULL, goal_id TEXT NOT NULL, product_id TEXT NOT NULL, type TEXT NOT NULL, qty REAL NOT NULL, price REAL NOT NULL,
          commission_cents INTEGER, amount_cents INTEGER, note TEXT NOT NULL, batch_id TEXT) STRICT`,
        `CREATE INDEX tx_date ON tx (date)`,
        `CREATE TABLE price (product_id TEXT NOT NULL, month TEXT NOT NULL, price REAL NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (product_id, month)) STRICT`,
        `CREATE TABLE import_batch (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, file_name TEXT NOT NULL, created_at TEXT NOT NULL, rows_read INTEGER NOT NULL,
          rows_imported INTEGER NOT NULL, rows_skipped INTEGER NOT NULL, undone_at TEXT) STRICT`,
        `CREATE TABLE snapshot (month TEXT PRIMARY KEY, date TEXT NOT NULL, source TEXT NOT NULL, goals TEXT NOT NULL) STRICT`
      ];
      for (const d of ddl) await sql.raw(d).execute(db);
    }
  }
};
const provider: MigrationProvider = { getMigrations: async () => M };

export interface Opened { db: Db; raw: DatabaseSync; dir: string }
export async function openDb(dir: string): Promise<Opened> {
  mkdirSync(join(dir, 'backups'), { recursive: true });
  const raw = new DatabaseSync(join(dir, 'gbi.sqlite'));
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = new Kysely<Tables>({ dialect: new SqliteDialect({ database: adapt(raw) }) });
  const { error } = await new Migrator({ db, provider }).migrateToLatest();
  if (error) throw error;
  return { db, raw, dir };
}

/** Ticket 05: automatic backup with VACUUM INTO, keep 30. One per start and day. */
export function backup(o: Opened, today: string): void {
  const file = join(o.dir, 'backups', `gbi-${today}.sqlite`);
  try { o.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); } catch { /* already backed up today */ }
  const all = readdirSync(join(o.dir, 'backups')).filter(f => f.endsWith('.sqlite')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 30))) rmSync(join(o.dir, 'backups', f));
}
