import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const DOMAIN_TABLES = [
  "allocation_weight",
  "contribution_plan",
  "dismissal",
  "document",
  "goal",
  "import_batch",
  "import_mapping",
  "meta",
  "price_point",
  "product",
  "snapshot",
  "transaction",
];

describe("database schema on a fresh data folder", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-schema-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** Starts the server once, so migrations run, and stops it. */
  const startAndStop = async () => {
    const server = await startServer({ dataDir, port: 0 });
    await server.close();
  };
  const inspect = <T>(read: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(join(dataDir, DATABASE_FILE));
    try {
      return read(db);
    } finally {
      db.close();
    }
  };
  const tables = () =>
    inspect(
      (db) =>
        db
          .prepare(
            `SELECT name, strict FROM pragma_table_list
             WHERE schema = 'main' AND type = 'table'
               AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'kysely\\_%' ESCAPE '\\'
             ORDER BY name`,
          )
          .all() as { name: string; strict: number }[],
    );
  const columns = (table: string) =>
    inspect(
      (db) =>
        db.prepare(`SELECT name, type, "notnull" FROM pragma_table_info('${table}')`).all() as {
          name: string;
          type: string;
          notnull: number;
        }[],
    );

  it("creates every domain table", async () => {
    await startAndStop();
    expect(tables().map((t) => t.name)).toEqual(DOMAIN_TABLES);
  });

  it("makes every table STRICT", async () => {
    await startAndStop();
    expect(tables().filter((t) => t.strict !== 1)).toEqual([]);
  });

  it("stores money as integer cents and rejects a fractional amount", async () => {
    await startAndStop();
    const money = tables().flatMap((t) =>
      columns(t.name)
        .filter((c) => c.name.endsWith("_cents"))
        .map((c) => ({ table: t.name, ...c })),
    );
    expect(money.map((c) => `${c.table}.${c.name}`)).toEqual([
      "contribution_plan.monthly_cents",
      "goal.target_cents",
      "transaction.commission_cents",
      "transaction.amount_cents",
    ]);
    expect(money.filter((c) => c.type !== "INTEGER")).toEqual([]);

    inspect((db) => {
      db.exec(`INSERT INTO goal VALUES ('g1', 'Home', 'Need', 1000, 2030, 0.02, NULL, 0)`);
      expect(() =>
        db.exec(`INSERT INTO goal VALUES ('g2', 'Car', 'Want', 1000.5, 2030, 0.02, NULL, 0)`),
      ).toThrow(/INTEGER/);
      expect(() => db.exec(`INSERT INTO contribution_plan VALUES ('g1', '2026-01', 99.5)`)).toThrow(
        /INTEGER/,
      );
      db.exec(`INSERT INTO product (id, name, asset_class, regime, exp_return, volatility, ter,
                 price_source) VALUES ('p1', 'ETF', 'Equity', 'etf', 0.05, 0.15, 0.002, 'manual')`);
      expect(() =>
        db.exec(`INSERT INTO "transaction"
          VALUES ('t1', '2026-01-02', 'g1', 'p1', 'buy', 10000000, 100000000, 2.95, 100000, '', NULL)`),
      ).toThrow(/INTEGER/);
      db.exec(`INSERT INTO "transaction"
        VALUES ('t1', '2026-01-02', 'g1', 'p1', 'buy', 10000000, 100000000, 295, 100000, '', NULL)`);
    });
  });

  it("applies no migration when the server starts a second time", async () => {
    await startAndStop();
    const migrations = () =>
      inspect((db) =>
        db.prepare("SELECT name, timestamp FROM kysely_migration ORDER BY name").all(),
      );
    const first = migrations();
    expect(first.map((m) => m.name)).toEqual(["001-baseline", "002-domain"]);

    await startAndStop();
    expect(migrations()).toEqual(first);
  });
});
