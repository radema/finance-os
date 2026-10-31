import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImportRow, RowDecision } from "../engine/transactionImport.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { saveDocument } from "./documents.ts";
import { buildFinecoXlsx, buildLargeFinecoXlsx, SYNTHETIC_ISIN } from "./finecoFixture.ts";
import { parseFinecoMovimenti } from "./finecoMovimenti.ts";
import { commitTransactionImport, previewImport } from "./transactionImport.ts";
import { readXlsx } from "./xlsx.ts";

const SOURCE = { sourceName: "Fineco", fileName: "movimenti.xlsx" };

const PRODUCTS = [
  ["p-world", SYNTHETIC_ISIN.worldEtf, "etf"],
  ["p-bond", SYNTHETIC_ISIN.euroBondEtf, "etf"],
  ["p-btp", SYNTHETIC_ISIN.btp, "govt"],
  ["p-gold", SYNTHETIC_ISIN.goldEtc, "etf"],
] as const;

const finecoRows = (file: Buffer): ImportRow[] => {
  const [sheet] = readXlsx(file);
  return parseFinecoMovimenti(sheet?.rows ?? []);
};

describe("transaction import", () => {
  let dir: string;
  let db: Kysely<DB>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gbi-import-"));
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
    // Every product weighs in g1 only, except the world ETF, which weighs in both goals.
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
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  // The first world ETF trade (row 8) is split over both goals; the other world rows go to g1.
  const splitRow8: Record<number, RowDecision> = {
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

  it("imports the synthetic file once and the second import adds 0 rows (AC-31)", async () => {
    const rows = finecoRows(buildFinecoXlsx());
    const first = await commitTransactionImport(db, rows, splitRow8, SOURCE);
    // 5 buys + 1 sell; the coupon row is not ready yet
    expect(first?.rowsRead).toBe(7);
    expect(first?.rowsImported).toBe(6);
    expect(first?.rowsSkipped).toBe(1);
    const stored = await db.selectFrom("transaction").selectAll().execute();
    expect(stored).toHaveLength(7); // the split trade makes two parts
    expect(stored.every((t) => t.importBatchId === first?.id)).toBe(true);

    const second = await commitTransactionImport(db, rows, splitRow8, SOURCE);
    expect(second).toBeNull();
    const batches = await db.selectFrom("importBatch").selectAll().execute();
    expect(batches).toHaveLength(1);
    expect(await db.selectFrom("transaction").selectAll().execute()).toHaveLength(7);
  });

  it("writes buy and sell parts as signed scaled rows with the commission split", async () => {
    const rows = finecoRows(buildFinecoXlsx());
    await commitTransactionImport(db, rows, splitRow8, SOURCE);
    const parts = await db
      .selectFrom("transaction")
      .selectAll()
      .where("date", "=", "2024-01-15")
      .orderBy("goalId")
      .execute();
    expect(
      parts.map((t) => [
        t.goalId,
        t.type,
        t.qtyScaled,
        t.priceScaled,
        t.commissionCents,
        t.amountCents,
      ]),
    ).toEqual([
      ["g1", "buy", 6_000_000, 85_500_000, 177, 51_300],
      ["g2", "buy", 4_000_000, 85_500_000, 118, 34_200],
    ]);
    const [sell] = await db
      .selectFrom("transaction")
      .selectAll()
      .where("type", "=", "sell")
      .execute();
    expect(sell?.qtyScaled).toBe(-8_000_000);
    expect(sell?.amountCents).toBe(72_080);
  });

  it("stores a sell with a negative file qty as a negative-qty sell, like a positive one", async () => {
    const [first] = finecoRows(buildFinecoXlsx());
    if (!first) throw new Error("no row");
    const sell = { ...first, type: "sell" as const, qty: "-8", bucket: "g1" };
    await commitTransactionImport(db, [sell], {}, SOURCE);
    const [stored] = await db.selectFrom("transaction").selectAll().execute();
    expect([stored?.type, stored?.qtyScaled]).toEqual(["sell", -8_000_000]);
  });

  it("commits no split the user did not confirm (AC-31)", async () => {
    const rows = finecoRows(buildFinecoXlsx());
    const unconfirmed: Record<number, RowDecision> = {
      ...splitRow8,
      8: { split: { confirmed: false, units: [{ goalId: "g1", units: 10 }] } },
    };
    const batch = await commitTransactionImport(db, rows, unconfirmed, SOURCE);
    expect(batch?.rowsImported).toBe(5);
    const onDay = await db
      .selectFrom("transaction")
      .selectAll()
      .where("date", "=", "2024-01-15")
      .execute();
    expect(onDay).toEqual([]);
  });

  it("never trusts the client: a row that is not ready is not written", async () => {
    const rows = finecoRows(buildFinecoXlsx());
    // no decision for row 8: the world ETF is in two buckets
    const batch = await commitTransactionImport(
      db,
      rows,
      { 9: { goalId: "g1" }, 13: { goalId: "g1" } },
      SOURCE,
    );
    expect(batch?.rowsImported).toBe(5);
  });

  it("identical rows: needs fix, then after confirming they store and re-import adds 0 rows", async () => {
    const [first] = finecoRows(buildFinecoXlsx());
    if (!first) throw new Error("no row");
    const rows = [first, { ...first, rowNumber: first.rowNumber + 1 }].map((r) => ({
      ...r,
      bucket: "g1" as string | undefined,
    }));
    const unconfirmed = await previewImport(db, rows, {});
    expect(unconfirmed.map((r) => r.status)).toEqual(["needs fix", "needs fix"]);
    expect(await commitTransactionImport(db, rows, {}, SOURCE)).toBeNull();

    const confirm = {
      [rows[0]?.rowNumber ?? 0]: { confirmDuplicate: true },
      [rows[1]?.rowNumber ?? 0]: { confirmDuplicate: true },
    };
    const batch = await commitTransactionImport(db, rows, confirm, SOURCE);
    expect(batch?.rowsImported).toBe(2);
    expect(await commitTransactionImport(db, rows, confirm, SOURCE)).toBeNull();
    expect(await commitTransactionImport(db, rows, {}, SOURCE)).toBeNull();
  });

  it("skips rows on or before the opening asOf, and works when no opening date is saved", async () => {
    const rows = finecoRows(buildFinecoXlsx());
    const none = await previewImport(db, rows, {});
    expect(none.some((r) => r.status === "already in the opening position")).toBe(false);
    await saveDocument(db, "openingDate", { asOf: "2024-02-12" });
    const statuses = (await previewImport(db, rows, {})).map((r) => r.status);
    expect(statuses.slice(0, 2)).toEqual([
      "already in the opening position",
      "already in the opening position",
    ]);
  });

  it("parse + preview of a 200-row Fineco XLSX takes under 2 s (AC-43)", async () => {
    const file = buildLargeFinecoXlsx(200);
    const start = performance.now();
    const rows = finecoRows(file);
    const preview = await previewImport(db, rows, {});
    const elapsed = performance.now() - start;
    expect(preview).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  });
});
