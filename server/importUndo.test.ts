import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportRow, RowDecision } from "../engine/transactionImport.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { buildFinecoXlsx, SYNTHETIC_ISIN } from "./finecoFixture.ts";
import { parseFinecoMovimenti } from "./finecoMovimenti.ts";
import { undoBatch } from "./importUndo.ts";
import { importPrices, storePrice } from "./prices.ts";
import { commitTransactionImport } from "./transactionImport.ts";
import { readXlsx } from "./xlsx.ts";

const PRODUCTS = [
  ["p-world", SYNTHETIC_ISIN.worldEtf, "etf"],
  ["p-bond", SYNTHETIC_ISIN.euroBondEtf, "etf"],
  ["p-btp", SYNTHETIC_ISIN.btp, "govt"],
  ["p-gold", SYNTHETIC_ISIN.goldEtc, "etf"],
] as const;

const SPLIT: Record<number, RowDecision> = {
  8: {
    split: {
      confirmed: true,
      units: [
        { goalId: "g1", units: 6 },
        { goalId: "g2", units: 4 },
      ],
    },
  },
  9: { goalId: "g1" },
  13: { goalId: "g1" },
};

describe("undoBatch", () => {
  let dir: string;
  let db: Kysely<DB>;

  /** Every table except ImportBatch, rows sorted by their JSON. */
  const dump = async () => {
    const tables = (await db.introspection.getTables()).map((table) => table.name);
    const entries = await Promise.all(
      tables
        .filter((name) => name !== "import_batch")
        .map(async (name) => {
          const rows = await db
            .selectFrom(name as keyof DB)
            .selectAll()
            .execute();
          return [name, rows.map((row) => JSON.stringify(row)).sort()] as const;
        }),
    );
    return Object.fromEntries(entries);
  };

  const importTransactions = async () => {
    const [sheet] = readXlsx(buildFinecoXlsx());
    const rows: ImportRow[] = parseFinecoMovimenti(sheet?.rows ?? []);
    const batch = await commitTransactionImport(db, rows, SPLIT, {
      sourceName: "Fineco",
      fileName: "movimenti.xlsx",
    });
    if (!batch) throw new Error("nothing imported");
    return batch;
  };

  // Overwrites the manual 2024-01 price of p-world and adds 2024-02.
  const importPriceBatch = async () =>
    (
      await importPrices(
        db,
        [
          { product: "p-world", date: "2024-01-31", price: 120 },
          { product: "p-world", date: "2024-02-29", price: 125 },
        ],
        { fileName: "p.csv", sourceName: "CSV", fetchedAt: "2024-03-01T10:00:00Z" },
      )
    ).batch;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gbi-undo-"));
    db = await openDatabase(dir);
    for (const [id, isin, regime] of PRODUCTS) {
      await db
        .insertInto("product")
        .values({
          id,
          name: id,
          isin,
          assetClass: "Equity",
          regime,
          whiteListShare: 0,
          expReturn: 0.05,
          volatility: 0.15,
          ter: 0,
          maturity: null,
          couponRate: 0,
          zeroCommission: 0,
          priceSource: "manual",
          ticker: "",
          brokerUnitsScaled: null,
          brokerUnitsDate: null,
        })
        .execute();
    }
    for (const id of ["g1", "g2"]) {
      await db
        .insertInto("goal")
        .values({
          id,
          name: id,
          priority: "Need",
          targetCents: 1_000_000,
          targetYear: 2040,
          contributionGrowth: 0,
          minProb: null,
          countsTowardFi: 0,
        })
        .execute();
    }
    for (const goalId of ["g1", "g2"]) {
      await db
        .insertInto("cashMovement")
        .values({
          id: `fund-${goalId}`,
          date: "2023-01-01",
          goalId,
          type: "opening",
          amountCents: 100_000_000,
          toGoalId: null,
          note: "",
          sourceId: null,
          importBatchId: null,
        })
        .execute();
    }
    for (const [id] of PRODUCTS) {
      await db
        .insertInto("allocationWeight")
        .values({ goalId: "g1", productId: id, weight: 1 })
        .execute();
    }
    await db
      .insertInto("allocationWeight")
      .values({ goalId: "g2", productId: "p-world", weight: 1 })
      .execute();
    await storePrice(
      db,
      {
        productId: "p-world",
        month: "2024-01",
        priceScaled: 100_000_000,
        priceDate: "2024-01-30",
        source: "manual",
        fetchedAt: "2024-01-30T09:00:00Z",
        importBatchId: null,
      },
      { explicitRefetch: false },
    );
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("brings back every table except ImportBatch, and marks both batches undone (AC-32)", async () => {
    const before = await dump();
    const transactions = await importTransactions();
    const prices = await importPriceBatch();
    expect(await dump()).not.toEqual(before);

    const undonePrices = await undoBatch(db, prices.id);
    const undoneTransactions = await undoBatch(db, transactions.id);

    expect(await dump()).toEqual(before);
    expect(undonePrices.undoneAt).not.toBeNull();
    expect(undoneTransactions.undoneAt).not.toBeNull();
    const batches = await db.selectFrom("importBatch").select("undoneAt").execute();
    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.undoneAt !== null)).toBe(true);
  });

  it("gives the overwritten price its prior value, source and date back", async () => {
    const batch = await importPriceBatch();
    await undoBatch(db, batch.id);
    const prices = await db
      .selectFrom("pricePoint")
      .select(["month", "priceScaled", "source", "priceDate"])
      .execute();
    expect(prices).toEqual([
      { month: "2024-01", priceScaled: 100_000_000, source: "manual", priceDate: "2024-01-30" },
    ]);
  });

  it("undoes overlapping price batches last in first out", async () => {
    const first = await importPriceBatch();
    const second = (
      await importPrices(db, [{ product: "p-world", date: "2024-01-31", price: 130 }], {
        fileName: "q.csv",
        sourceName: "CSV",
        fetchedAt: "2024-03-02T10:00:00Z",
      })
    ).batch;
    const prices = () =>
      db.selectFrom("pricePoint").select(["month", "priceScaled", "source"]).execute();

    await expect(undoBatch(db, first.id)).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.selectFrom("importBatch").select("undoneAt").execute()).map((b) => b.undoneAt),
    ).toEqual([null, null]);

    await undoBatch(db, second.id);
    await undoBatch(db, first.id);
    expect(await prices()).toEqual([
      { month: "2024-01", priceScaled: 100_000_000, source: "manual" },
    ]);
    const batches = await db.selectFrom("importBatch").select("undoneAt").execute();
    expect(batches.every((batch) => batch.undoneAt !== null)).toBe(true);
  });

  it("keeps a manual price entered after a price batch", async () => {
    const batch = await importPriceBatch();
    await storePrice(
      db,
      {
        productId: "p-world",
        month: "2024-01",
        priceScaled: 777_000_000,
        priceDate: "2024-01-31",
        source: "manual",
        fetchedAt: "2024-03-05T10:00:00Z",
        importBatchId: null,
      },
      { explicitRefetch: false },
    );
    await undoBatch(db, batch.id);
    const prices = await db.selectFrom("pricePoint").select(["month", "priceScaled"]).execute();
    expect(prices).toEqual([{ month: "2024-01", priceScaled: 777_000_000 }]);
  });

  it("refuses a batch that is already undone and changes nothing", async () => {
    const batch = await importTransactions();
    await undoBatch(db, batch.id);
    const after = await db.selectFrom("importBatch").selectAll().execute();
    await expect(undoBatch(db, batch.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.selectFrom("importBatch").selectAll().execute()).toEqual(after);
  });

  it("answers 404 for an unknown batch", async () => {
    await expect(undoBatch(db, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("leaves everything as it was when the undo fails half way", async () => {
    const batch = await importTransactions();
    // A trigger makes the batch update fail after the transactions are deleted.
    await sql`CREATE TRIGGER no_undo BEFORE UPDATE ON import_batch BEGIN SELECT RAISE(ABORT, 'boom'); END`.execute(
      db,
    );
    const before = await dump();
    await expect(undoBatch(db, batch.id)).rejects.toThrow();
    expect(await dump()).toEqual(before);
  });
});
