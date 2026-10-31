import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecordPreview } from "../engine/recordImport.ts";
import { guessRecordMapping } from "../engine/recordImport.ts";
import type { Goal, Product } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import { undoCreatedRows } from "./recordImport.ts";

type Commit = {
  batchId: string | null;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  created: number;
  updated: number;
};

const PRODUCTS =
  "Name;ISIN;Asset class;Regime;Expected return;Volatility;TER\n" +
  "World ETF;IE00TEST0001;Equity;etf;5;15;0,2\n" +
  "Euro bond;IE00TEST0002;Govt bonds;etf;2,5;5;0,1\n";
const GOALS =
  "Name;Priority;Target;Target year;Contribution growth\n" +
  "House;Need;200.000;2035;2\n" +
  "Car;Want;15.000;2030;0\n";

describe("products and goals import API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-record-import-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-03-15" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T = unknown>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const payload = (kind: "products" | "goals", text: string, over = {}) => {
    const headers = text.split("\n")[0]?.split(";") ?? [];
    return {
      kind,
      fileName: `${kind}.csv`,
      text,
      mapping: {
        columnMap: guessRecordMapping(headers, kind),
        delimiter: ";",
        decimal: "comma",
        dateFormat: "auto",
        ...over,
      },
    };
  };
  const commit = async (kind: "products" | "goals", text: string) =>
    (await call<Commit>("POST", "/api/import/records/commit", payload(kind, text))).body;
  const products = async () => (await call<Product[]>("GET", "/api/products")).body;
  const goals = async () => (await call<Goal[]>("GET", "/api/goals")).body;
  const batches = async () =>
    (await call<{ kind: string; rowsImported: number }[]>("GET", "/api/import/batches")).body;

  it("creates the products of a CSV, and the second run changes nothing and imports 0 rows", async () => {
    expect(await commit("products", PRODUCTS)).toMatchObject({
      rowsRead: 2,
      rowsImported: 2,
      created: 2,
      updated: 0,
    });
    expect((await products()).map((p) => p.name)).toEqual(["Euro bond", "World ETF"]);
    expect((await products()).find((p) => p.isin === "IE00TEST0002")).toMatchObject({
      expReturn: 0.025,
      ter: 0.001,
    });

    const before = await products();
    expect(await commit("products", PRODUCTS)).toMatchObject({
      batchId: null,
      rowsRead: 2,
      rowsImported: 0,
      rowsSkipped: 2,
    });
    expect(await products()).toEqual(before);
    expect(await batches()).toMatchObject([{ kind: "products", rowsImported: 2 }]);
  });

  it("creates the goals of a CSV, and the second run changes nothing and imports 0 rows", async () => {
    expect(await commit("goals", GOALS)).toMatchObject({ rowsImported: 2, created: 2 });
    expect(await goals()).toMatchObject([
      { name: "Car", priority: "Want", targetCents: 1_500_000, targetYear: 2030 },
      { name: "House", targetCents: 20_000_000, contributionGrowth: 0.02 },
    ]);
    const before = await goals();
    expect(await commit("goals", GOALS)).toMatchObject({ batchId: null, rowsImported: 0 });
    expect(await goals()).toEqual(before);
  });

  it("updates a changed value on an existing ISIN or name and creates no second record", async () => {
    await commit("products", PRODUCTS);
    await commit("goals", GOALS);
    const done = await commit(
      "products",
      "ISIN;Name;TER\nIE00TEST0001;World ETF renamed;0,3\n;Euro bond;0,05\n",
    );
    expect(done).toMatchObject({ rowsImported: 2, created: 0, updated: 2 });
    const list = await products();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.isin === "IE00TEST0001")).toMatchObject({
      name: "World ETF renamed",
      ter: 0.003,
      expReturn: 0.05,
    });
    expect(list.find((p) => p.name === "Euro bond")).toMatchObject({ ter: 0.0005 });

    await commit("goals", "Name;Target\nHouse;250.000\n");
    expect(await goals()).toHaveLength(2);
    expect((await goals()).find((g) => g.name === "House")).toMatchObject({
      targetCents: 25_000_000,
      targetYear: 2035,
    });
  });

  it("shows needs fix with a reason for an invalid row and does not write it", async () => {
    const text = `${PRODUCTS}Bad;IE00TEST0003;Stocks;etf;5;15;0,2\n`;
    const preview = (
      await call<{ previews: RecordPreview<unknown>[] }>(
        "POST",
        "/api/import/records/preview",
        payload("products", text),
      )
    ).body.previews;
    expect(preview.map((p) => p.status)).toEqual(["new", "new", "needs fix"]);
    expect(preview[2]?.reason).toMatch(/assetClass/);
    expect(await products()).toEqual([]);

    expect(await commit("products", text)).toMatchObject({
      rowsRead: 3,
      rowsImported: 2,
      rowsSkipped: 1,
    });
    expect(await products()).toHaveLength(2);
  });

  it("refuses a file with no name or ISIN column", async () => {
    const response = await call("POST", "/api/import/records/preview", {
      ...payload("products", "Ticker\nABC\n"),
    });
    expect(response.status).toBe(400);
  });

  describe("undo of a batch over the API (AC-32)", () => {
    type Undone = { undoneAt: string | null; kept: string[] };
    const undo = (id: string | null) => call<Undone>("POST", "/api/import/batches/undo", { id });
    const undoneAts = async () =>
      (await db().selectFrom("importBatch").select("undoneAt").execute()).map((b) => b.undoneAt);
    const db = () => openedDb as Kysely<DB>;
    let openedDb: Kysely<DB> | undefined;
    beforeEach(async () => {
      openedDb = await openDatabase(dataDir);
    });
    afterEach(async () => {
      await openedDb?.destroy();
    });

    it("deletes the created products, keeps one with a transaction and reports it", async () => {
      const batch = await commit("products", PRODUCTS);
      const used = (await products()).find((p) => p.isin === "IE00TEST0001") as Product;
      await call("POST", "/api/goals", {
        name: "G",
        priority: "Need",
        targetCents: 1,
        targetYear: 2040,
        contributionGrowth: 0,
      });
      await db()
        .insertInto("transaction")
        .values({
          id: "t1",
          date: "2026-01-02",
          goalId: ((await goals())[0] as Goal).id,
          productId: used.id,
          type: "buy",
          qtyScaled: 1_000_000,
          priceScaled: 1_000_000,
          commissionCents: null,
          amountCents: 100,
          note: "",
          importBatchId: null,
        })
        .execute();

      const undone = await undo(batch.batchId);

      expect(undone.status).toBe(200);
      expect(undone.body.kept).toEqual([used.id]);
      expect(undone.body.undoneAt).toBeTruthy();
      expect((await products()).map((p) => p.name)).toEqual(["World ETF"]);
      expect(await undoneAts()).toEqual([undone.body.undoneAt]);
    });

    it("leaves a row the batch updated with its new values", async () => {
      await commit("products", PRODUCTS);
      const second = await commit(
        "products",
        PRODUCTS.replace(
          "World ETF;IE00TEST0001;Equity;etf;5;",
          "World ETF;IE00TEST0001;Equity;etf;6;",
        ) + "Gold;IE00TEST0003;Gold/Commodities;etf;3;18;0,4\n",
      );
      expect(second).toMatchObject({ created: 1, updated: 1 });

      const undone = await undo(second.batchId);

      expect(undone.body.kept).toEqual([]);
      expect((await products()).map((p) => p.name)).toEqual(["Euro bond", "World ETF"]);
      expect((await products()).find((p) => p.name === "World ETF")).toMatchObject({
        expReturn: 0.06,
      });
    });

    it("deletes the created goals, keeps the zainetto goal and reports it", async () => {
      const batch = await commit("goals", GOALS);
      const house = (await goals()).find((g) => g.name === "House") as Goal;
      const settings = (await call<Record<string, unknown>>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", {
        ...settings,
        zainetto: { ...(settings.zainetto as object), goalId: house.id },
      });

      const undone = await undo(batch.batchId);

      expect(undone.body.kept).toEqual([house.id]);
      expect((await goals()).map((g) => g.name)).toEqual(["House"]);
      expect(await undoneAts()).toEqual([undone.body.undoneAt]);
    });

    it("refuses a second undo of the same batch", async () => {
      const batch = await commit("goals", GOALS);
      await undo(batch.batchId);
      expect((await undo(batch.batchId)).status).toBe(409);
    });
  });

  describe("undoCreatedRows", () => {
    const run = async (batchId: string | null) => {
      const db = await openDatabase(dataDir);
      try {
        const batch = await db
          .selectFrom("importBatch")
          .select(["kind", "createdIds"])
          .where("id", "=", batchId as string)
          .executeTakeFirstOrThrow();
        return await db.transaction().execute((trx) => undoCreatedRows(trx, batch));
      } finally {
        await db.destroy();
      }
    };

    it("deletes created, unused products and keeps the used ones and the updated ones", async () => {
      const firstBatch = await commit("products", PRODUCTS);
      const [used] = (await products()).filter((p) => p.isin === "IE00TEST0001");
      const updated = await commit(
        "products",
        `${PRODUCTS}Gold;IE00TEST0003;Gold/Commodities;etf;3;18;0,4\n`.replace(
          "World ETF;IE00TEST0001;Equity;etf;5;15;0,2",
          "World ETF;IE00TEST0001;Equity;etf;6;15;0,2",
        ),
      );
      expect(updated).toMatchObject({ created: 1, updated: 1 });

      await call("POST", "/api/goals", {
        name: "G",
        priority: "Need",
        targetCents: 1,
        targetYear: 2040,
        contributionGrowth: 0,
      });
      const goal = (await goals())[0] as Goal;
      const db = await openDatabase(dataDir);
      await db
        .insertInto("transaction")
        .values({
          id: "t1",
          date: "2026-01-02",
          goalId: goal.id,
          productId: (used as Product).id,
          type: "buy",
          qtyScaled: 1_000_000,
          priceScaled: 1_000_000,
          commissionCents: null,
          amountCents: 100,
          note: "",
          importBatchId: null,
        })
        .execute();
      await db.destroy();

      // The first batch created World ETF (now used) and Euro bond (unused).
      expect(await run(firstBatch.batchId)).toMatchObject({
        deleted: [expect.any(String)],
        kept: [(used as Product).id],
      });
      expect((await products()).map((p) => p.name).sort()).toEqual(["Gold", "World ETF"]);

      // The second batch created Gold and only updated World ETF: that row stays.
      const second = await run(updated.batchId);
      expect(second.deleted).toHaveLength(1);
      expect((await products()).map((p) => p.name)).toEqual(["World ETF"]);
      expect((await products())[0]).toMatchObject({ expReturn: 0.06 });
    });

    it("does not count a created row that was already deleted", async () => {
      const batch = await commit("goals", GOALS);
      const car = (await goals()).find((g) => g.name === "Car") as Goal;
      await call("DELETE", `/api/goals?id=${car.id}`);
      const result = await run(batch.batchId);
      expect(result.kept).toEqual([]);
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted).not.toContain(car.id);
    });

    it("keeps a created goal that has a transaction, a plan version or the zainetto link", async () => {
      const batch = await commit(
        "goals",
        `${GOALS}Trip;Wish;3.000;2030;0\nBoat;Wish;9.000;2031;0\n`,
      );
      const byName = async (name: string) => (await goals()).find((g) => g.name === name) as Goal;
      await call("PUT", "/api/goal-plan", {
        goalId: (await byName("Car")).id,
        fromMonth: "2026-04",
        monthlyCents: 5000,
      });
      const settings = (await call<Record<string, unknown>>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", {
        ...settings,
        zainetto: {
          ...(settings.zainetto as object),
          goalId: (await byName("Trip")).id,
        },
      });
      const result = await run(batch.batchId);
      expect(result.kept.sort()).toEqual(
        [(await byName("Car")).id, (await byName("Trip")).id].sort(),
      );
      expect(result.deleted).toHaveLength(2);
      expect((await goals()).map((g) => g.name).sort()).toEqual(["Car", "Trip"]);
    });
  });
});
