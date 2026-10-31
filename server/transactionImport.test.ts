import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoalDetail } from "../engine/goalViews.ts";
import { holdingsAt } from "../engine/holdings.ts";
import type { ImportRow, RowDecision } from "../engine/transactionImport.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { saveDocument } from "./documents.ts";
import { buildFinecoXlsx, buildLargeFinecoXlsx, SYNTHETIC_ISIN } from "./finecoFixture.ts";
import { parseFinecoMovimenti } from "./finecoMovimenti.ts";
import { registerGoalViewRoutes } from "./goalViews.ts";
import { createRouter } from "./router.ts";
import { commitTransactionImport, previewImport } from "./transactionImport.ts";
import { loadLedger } from "./transactions.ts";
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
    // 5 buys + 1 sell + 1 coupon
    expect(first?.rowsRead).toBe(7);
    expect(first?.rowsImported).toBe(7);
    expect(first?.rowsSkipped).toBe(0);
    const stored = await db.selectFrom("transaction").selectAll().execute();
    expect(stored).toHaveLength(8); // the split trade makes two parts
    expect(stored.every((t) => t.importBatchId === first?.id)).toBe(true);
    // the BTP bought earlier in the same file is held in g1: the coupon goes there whole
    const coupons = stored.filter((t) => t.type === "coupon");
    expect(coupons.map((t) => [t.goalId, t.amountCents])).toEqual([["g1", 4050]]);

    const second = await commitTransactionImport(db, rows, splitRow8, SOURCE);
    expect(second).toBeNull();
    const batches = await db.selectFrom("importBatch").selectAll().execute();
    expect(batches).toHaveLength(1);
    expect(await db.selectFrom("transaction").selectAll().execute()).toHaveLength(8);
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
    expect(batch?.rowsImported).toBe(6);
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
    expect(batch?.rowsImported).toBe(6);
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

  describe("coupons (AC-33)", () => {
    // The BTP is bought in one file and held in two buckets by a hand-made ledger.
    const buyBtp = (goalId: string, units: number) =>
      db
        .insertInto("transaction")
        .values({
          id: `btp-${goalId}`,
          date: "2024-04-15",
          goalId,
          productId: "p-btp",
          type: "buy",
          qtyScaled: units * 1_000_000,
          priceScaled: 98_500_000,
          commissionCents: null,
          amountCents: units * 985,
          note: "",
          importBatchId: null,
        })
        .execute();
    const couponOnly = () => finecoRows(buildFinecoXlsx()).filter((r) => r.type === "coupon");
    const bondState = async () => {
      const ledger = await loadLedger(db);
      return holdingsAt(ledger, "9999-12-31");
    };

    it("writes one coupon per bucket held, 60/40, qty 0, units and PMC unchanged", async () => {
      await buyBtp("g1", 1800);
      await buyBtp("g2", 1200);
      const before = await bondState();
      const batch = await commitTransactionImport(db, couponOnly(), {}, SOURCE);
      expect(batch?.rowsImported).toBe(1);
      const stored = await db
        .selectFrom("transaction")
        .selectAll()
        .where("type", "=", "coupon")
        .orderBy("goalId")
        .execute();
      expect(
        stored.map((t) => [
          t.goalId,
          t.date,
          t.qtyScaled,
          t.priceScaled,
          t.commissionCents,
          t.amountCents,
          t.importBatchId,
        ]),
      ).toEqual([
        ["g1", "2024-07-01", 0, 0, null, 2430, batch?.id],
        ["g2", "2024-07-01", 0, 0, null, 1620, batch?.id],
      ]);
      expect(stored.reduce((sum, t) => sum + t.amountCents, 0)).toBe(4050);
      const after = await bondState();
      expect(after.accountUnits).toEqual(before.accountUnits);
      expect(after.units).toEqual(before.units);
      expect(after.pmc).toEqual(before.pmc);
      expect(await db.selectFrom("transaction").select("id").execute()).toHaveLength(4);
    });

    it("does not raise a goal's money put in (not a contribution)", async () => {
      await buyBtp("g1", 1800);
      await buyBtp("g2", 1200);
      const router = createRouter();
      registerGoalViewRoutes(router, db, () => "2024-12-31");
      const moneyIn = async (goalId: string) => {
        const response = await router.handle(
          new Request(`http://gbi.test/api/goal-detail?id=${goalId}`),
        );
        const detail = (await response.json()) as GoalDetail;
        return detail.series.at(-1)?.moneyIn ?? Number.NaN;
      };
      const before = [await moneyIn("g1"), await moneyIn("g2")];
      expect(before[0]).toBeGreaterThan(0);
      await commitTransactionImport(db, couponOnly(), {}, SOURCE);
      expect(await moneyIn("g1")).toBeLessThanOrEqual(before[0] ?? Number.NaN);
      expect(await moneyIn("g2")).toBeLessThanOrEqual(before[1] ?? Number.NaN);
    });

    it("needs a goal when no bucket holds the bond, then writes one coupon for the picked bucket", async () => {
      const [previewRow] = await previewImport(db, couponOnly(), {});
      expect(previewRow?.status).toBe("needs a goal");
      expect(await commitTransactionImport(db, couponOnly(), {}, SOURCE)).toBeNull();

      const rowNumber = couponOnly()[0]?.rowNumber ?? 0;
      await commitTransactionImport(db, couponOnly(), { [rowNumber]: { goalId: "g2" } }, SOURCE);
      const stored = await db.selectFrom("transaction").selectAll().execute();
      expect(stored.map((t) => [t.goalId, t.type, t.amountCents])).toEqual([
        ["g2", "coupon", 4050],
      ]);
    });

    it("a re-import adds 0 coupon rows, whichever bucket held the bond", async () => {
      await buyBtp("g1", 1800);
      await buyBtp("g2", 1200);
      await commitTransactionImport(db, couponOnly(), {}, SOURCE);
      expect(await commitTransactionImport(db, couponOnly(), {}, SOURCE)).toBeNull();
      const coupons = await db
        .selectFrom("transaction")
        .select("id")
        .where("type", "=", "coupon")
        .execute();
      expect(coupons).toHaveLength(2);
    });
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
