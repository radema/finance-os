import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { exportAll, importAll } from "./exchange.ts";
import { HttpError } from "./router.ts";

const PRODUCT = {
  id: "p1",
  name: "VWCE",
  isin: "IE00BK5BQT80",
  assetClass: "Equity",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.065,
  volatility: 0.16,
  ter: 0.0019,
  maturity: null,
  couponRate: 0,
  zeroCommission: 0,
  priceSource: "csv",
  ticker: "",
  brokerUnitsScaled: null,
  brokerUnitsDate: null,
} as const;
const GOAL = {
  id: "g1",
  name: "Home",
  priority: "Need",
  targetCents: 5_000_000,
  targetYear: 2032,
  contributionGrowth: 0.02,
  minProb: null,
  countsTowardFi: 1,
} as const;

/** Fills every kind of table: plain rows, foreign keys, large scaled integers and JSON documents. */
async function seed(db: Kysely<DB>): Promise<void> {
  await db.insertInto("product").values(PRODUCT).execute();
  await db.insertInto("goal").values(GOAL).execute();
  await db
    .insertInto("pricePoint")
    .values([
      {
        productId: "p1",
        month: "2026-02",
        priceScaled: 123_456_789,
        priceDate: "2026-02-27",
        source: "csv",
        fetchedAt: "2026-03-01T10:00:00Z",
        importBatchId: null,
      },
      {
        productId: "p1",
        month: "2026-01",
        priceScaled: 120_000_001,
        priceDate: "2026-01-30",
        source: "manual",
        fetchedAt: "2026-02-01T10:00:00Z",
        importBatchId: null,
      },
    ])
    .execute();
  await db
    .insertInto("transaction")
    .values({
      id: "t1",
      date: "2026-01-15",
      goalId: "g1",
      productId: "p1",
      type: "buy",
      qtyScaled: 9_007_199_254_740_991,
      priceScaled: 101_234_567,
      commissionCents: 295,
      amountCents: 123_456_789_012,
      note: 'it\'s "quoted" ✓',
      importBatchId: null,
    })
    .execute();
  await db
    .insertInto("document")
    .values({ kind: "settings", value: '{"inflation":0.02,"seed":42}' })
    .execute();
}

describe("export and import", () => {
  let dataDir: string;
  let db: Kysely<DB>;
  const dirs: string[] = [];
  const backupFiles = (dir = dataDir) =>
    existsSync(join(dir, "backups")) ? readdirSync(join(dir, "backups")) : [];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-exchange-"));
    dirs.push(dataDir);
    db = await openDatabase(dataDir);
  });
  afterEach(async () => {
    await db.destroy();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("restores into an empty data folder and exports the same document (AC-40)", async () => {
    await seed(db);
    const first = await exportAll(db);

    const otherDir = mkdtempSync(join(tmpdir(), "gbi-exchange-"));
    dirs.push(otherDir);
    const other = await openDatabase(otherDir);
    try {
      await importAll(other, otherDir, "2026-05-01", JSON.parse(JSON.stringify(first)));
      expect(JSON.stringify(await exportAll(other))).toBe(JSON.stringify(first));
    } finally {
      await other.destroy();
    }
  });

  it("gives equal bytes for equal data, whatever the insert order", async () => {
    await seed(db);
    const otherDir = mkdtempSync(join(tmpdir(), "gbi-exchange-"));
    dirs.push(otherDir);
    const other = await openDatabase(otherDir);
    try {
      // Same data, rows inserted in the opposite order.
      await other.insertInto("goal").values(GOAL).execute();
      await other.insertInto("product").values(PRODUCT).execute();
      const rows = await db.selectFrom("pricePoint").selectAll().orderBy("month", "desc").execute();
      await other.insertInto("pricePoint").values(rows).execute();
      const transactions = await db.selectFrom("transaction").selectAll().execute();
      await other.insertInto("transaction").values(transactions).execute();
      const documents = await db.selectFrom("document").selectAll().execute();
      await other.insertInto("document").values(documents).execute();
      expect(JSON.stringify(await exportAll(other))).toBe(JSON.stringify(await exportAll(db)));
    } finally {
      await other.destroy();
    }
  });

  it("keeps large integers, text and JSON documents exact", async () => {
    await seed(db);
    const { tables } = await exportAll(db);
    expect(tables.transaction).toEqual([
      expect.objectContaining({
        qty_scaled: 9_007_199_254_740_991,
        amount_cents: 123_456_789_012,
        note: 'it\'s "quoted" ✓',
      }),
    ]);
    expect(tables.document).toEqual([{ kind: "settings", value: '{"inflation":0.02,"seed":42}' }]);
    expect(tables.price_point?.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
  });

  it("carries the migration version and no timestamp", async () => {
    const document = await exportAll(db);
    expect(Object.keys(document)).toEqual(["schemaVersion", "tables"]);
    expect(document.schemaVersion).toBe("002-domain");
  });

  it("covers every table in the database, a new one included (AC-40)", async () => {
    await sql`CREATE TABLE later_story (id TEXT PRIMARY KEY, n INTEGER NOT NULL) STRICT`.execute(
      db,
    );
    await sql`INSERT INTO later_story VALUES ('a', 1)`.execute(db);
    const { tables } = await exportAll(db);
    expect(tables.later_story).toEqual([{ id: "a", n: 1 }]);
    expect(Object.keys(tables)).toEqual(
      expect.arrayContaining(["product", "goal", "document", "meta"]),
    );
    expect(Object.keys(tables).some((name) => name.startsWith("kysely_"))).toBe(false);
  });

  it("replaces all data on import, after a backup", async () => {
    await seed(db);
    const document = await exportAll(db);
    await db.deleteFrom("transaction").execute();
    await db.deleteFrom("goal").execute();
    await db
      .insertInto("goal")
      .values({ ...GOAL, id: "g2", name: "Other" })
      .execute();
    expect(backupFiles()).toEqual([]);

    await importAll(db, dataDir, "2026-05-01", document);

    expect(JSON.stringify(await exportAll(db))).toBe(JSON.stringify(document));
    expect(backupFiles()).toHaveLength(1);
    expect(backupFiles()[0]).toMatch(/^gbi-2026-05-01-import-\d+\.sqlite$/);
  });

  it("refuses a file from another migration version and changes nothing", async () => {
    await seed(db);
    const before = JSON.stringify(await exportAll(db));
    const document = { ...(await exportAll(db)), schemaVersion: "003-future" };

    await expect(importAll(db, dataDir, "2026-05-01", document)).rejects.toThrow(
      /migration version 003-future.*002-domain/,
    );
    expect(JSON.stringify(await exportAll(db))).toBe(before);
  });

  it("refuses a file with an unknown or missing table", async () => {
    const document = await exportAll(db);
    await expect(
      importAll(db, dataDir, "2026-05-01", {
        ...document,
        tables: { ...document.tables, nope: [] },
      }),
    ).rejects.toThrow(/nope/);
    const { goal: _goal, ...withoutGoal } = document.tables;
    await expect(
      importAll(db, dataDir, "2026-05-01", { ...document, tables: withoutGoal }),
    ).rejects.toThrow(/goal/);
  });

  it("takes a backup, then leaves the data unchanged when a row breaks a rule (AC-40)", async () => {
    await seed(db);
    const before = JSON.stringify(await exportAll(db));
    const good = await exportAll(db);
    // The second goal row breaks a CHECK constraint, after valid rows were written.
    const bad = {
      ...good,
      tables: {
        ...good.tables,
        goal: [...(good.tables.goal ?? []), { ...GOAL_ROW, id: "g9", priority: "Urgent" }],
      },
    };

    const failure = await importAll(db, dataDir, "2026-05-01", bad).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(400);
    expect(backupFiles()).toHaveLength(1);
    expect(JSON.stringify(await exportAll(db))).toBe(before);
  });

  it("leaves the data unchanged when a row points at a missing parent", async () => {
    await seed(db);
    const before = JSON.stringify(await exportAll(db));
    const good = await exportAll(db);
    const bad = {
      ...good,
      tables: {
        ...good.tables,
        price_point: [
          ...(good.tables.price_point ?? []),
          { ...(good.tables.price_point?.[0] ?? {}), product_id: "missing", month: "2030-01" },
        ],
      },
    };

    await expect(importAll(db, dataDir, "2026-05-01", bad)).rejects.toBeInstanceOf(HttpError);
    expect(JSON.stringify(await exportAll(db))).toBe(before);
  });
});

const GOAL_ROW = {
  id: "g1",
  name: "Home",
  priority: "Need",
  target_cents: 5_000_000,
  target_year: 2032,
  contribution_growth: 0.02,
  min_prob: null,
  counts_toward_fi: 1,
};
