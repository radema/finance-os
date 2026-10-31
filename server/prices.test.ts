import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import { importPrices, storePrice } from "./prices.ts";
import type { PricePointTable } from "./schema.ts";

const point = (over: Partial<PricePointTable> = {}): PricePointTable => ({
  productId: "p1",
  month: "2026-03",
  priceScaled: 100_000_000,
  priceDate: "2026-03-31",
  source: "manual",
  fetchedAt: "2026-03-31T10:00:00Z",
  importBatchId: null,
  ...over,
});

const PRODUCT_ROW = {
  isin: "",
  assetClass: "Equity",
  regime: "etf",
  whiteListShare: 0,
  expReturn: 0.06,
  volatility: 0.16,
  ter: 0.002,
  maturity: null,
  couponRate: 0,
  zeroCommission: 0,
  priceSource: "manual",
  ticker: "",
  brokerUnitsScaled: null,
  brokerUnitsDate: null,
} as const;

describe("storePrice and importPrices", () => {
  let dataDir: string;
  let db: Kysely<DB>;
  const stored = () =>
    db.selectFrom("pricePoint").selectAll().orderBy("productId").orderBy("month").execute();

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-prices-"));
    db = await openDatabase(dataDir);
    await db
      .insertInto("product")
      .values([
        { ...PRODUCT_ROW, id: "p1", name: "VWCE", isin: "IE00BK5BQT80", ticker: "VWCE.MI" },
        { ...PRODUCT_ROW, id: "p2", name: "BTP 2030", isin: "IT0005001547" },
      ])
      .execute();
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("storePrice", () => {
    it("stores a price with its source", async () => {
      const result = await storePrice(db, point({ source: "csv" }), { explicitRefetch: false });
      expect(result).toEqual({ outcome: "stored", prior: null });
      expect((await stored())[0]?.source).toBe("csv");
    });

    it("refuses a provider price over a manual one for the same month", async () => {
      await storePrice(db, point(), { explicitRefetch: false });
      const result = await storePrice(db, point({ source: "provider", priceScaled: 90_000_000 }), {
        explicitRefetch: false,
      });
      expect(result).toEqual({ outcome: "refused" });
      expect(await stored()).toEqual([point()]);
    });

    it("overwrites a manual price when the provider call is an explicit re-fetch", async () => {
      await storePrice(db, point(), { explicitRefetch: false });
      const result = await storePrice(db, point({ source: "provider", priceScaled: 90_000_000 }), {
        explicitRefetch: true,
      });
      expect(result).toEqual({ outcome: "stored", prior: point() });
      expect(await stored()).toEqual([point({ source: "provider", priceScaled: 90_000_000 })]);
    });

    it("lets a provider price replace a provider price, and another month stand alone", async () => {
      await storePrice(db, point({ source: "provider" }), { explicitRefetch: false });
      await storePrice(db, point({ source: "provider", priceScaled: 1 }), {
        explicitRefetch: false,
      });
      await storePrice(db, point({ month: "2026-04", source: "provider" }), {
        explicitRefetch: false,
      });
      expect((await stored()).map((row) => [row.month, row.priceScaled])).toEqual([
        ["2026-03", 1],
        ["2026-04", 100_000_000],
      ]);
    });

    it("lets a manual price overwrite a provider price", async () => {
      await storePrice(db, point({ source: "provider" }), { explicitRefetch: false });
      const result = await storePrice(db, point({ priceScaled: 5 }), { explicitRefetch: false });
      expect(result.outcome).toBe("stored");
      expect((await stored())[0]).toMatchObject({ source: "manual", priceScaled: 5 });
    });
  });

  describe("importPrices", () => {
    const meta = {
      fileName: "prices.csv",
      sourceName: "Prices CSV",
      fetchedAt: "2026-04-01T08:00:00Z",
    };

    it("stores csv prices under one batch, matching ISIN, then ticker, then name", async () => {
      const { batch, unknownProducts } = await importPrices(
        db,
        [
          { product: "IE00BK5BQT80", date: "2026-03-31", price: 101.25 },
          { product: "VWCE.MI", date: "2026-02-28", price: 99 },
          { product: "BTP 2030", date: "2026-03-31", price: 99.5 },
          { product: "Nobody", date: "2026-03-31", price: 1 },
        ],
        meta,
      );
      expect(unknownProducts).toEqual(["Nobody"]);
      expect(batch).toMatchObject({
        kind: "prices",
        fileName: "prices.csv",
        rowsRead: 4,
        rowsImported: 3,
        rowsSkipped: 1,
        undoneAt: null,
      });
      expect(await stored()).toEqual([
        point({
          month: "2026-02",
          priceScaled: 99_000_000,
          priceDate: "2026-02-28",
          source: "csv",
          fetchedAt: meta.fetchedAt,
          importBatchId: batch.id,
        }),
        point({
          month: "2026-03",
          priceScaled: 101_250_000,
          source: "csv",
          fetchedAt: meta.fetchedAt,
          importBatchId: batch.id,
        }),
        point({
          productId: "p2",
          month: "2026-03",
          priceScaled: 99_500_000,
          source: "csv",
          fetchedAt: meta.fetchedAt,
          importBatchId: batch.id,
        }),
      ]);
    });

    it("keeps the latest date when several dates fall in one month, across spellings of a product", async () => {
      await importPrices(
        db,
        [
          { product: "VWCE.MI", date: "2026-03-10", price: 1 },
          { product: "IE00BK5BQT80", date: "2026-03-20", price: 2 },
          { product: "VWCE.MI", date: "2026-03-15", price: 3 },
        ],
        meta,
      );
      expect((await stored()).map((row) => [row.priceDate, row.priceScaled])).toEqual([
        ["2026-03-20", 2_000_000],
      ]);
    });

    it("overwrites a manual price and records the prior state of every overwritten price", async () => {
      const manual = point();
      const provider = point({ productId: "p2", source: "provider", priceDate: "2026-03-30" });
      await storePrice(db, manual, { explicitRefetch: false });
      await storePrice(db, provider, { explicitRefetch: false });
      const { batch } = await importPrices(
        db,
        [
          { product: "VWCE", date: "2026-03-31", price: 7 },
          { product: "BTP 2030", date: "2026-03-31", price: 8 },
          { product: "VWCE", date: "2026-04-30", price: 9 },
        ],
        meta,
      );
      const prior = await db
        .selectFrom("importBatch")
        .select("priorPrices")
        .where("id", "=", batch.id)
        .executeTakeFirstOrThrow();
      expect(JSON.parse(prior.priorPrices ?? "null")).toEqual([manual, provider]);
      expect((await stored()).map((row) => [row.productId, row.month, row.source])).toEqual([
        ["p1", "2026-03", "csv"],
        ["p1", "2026-04", "csv"],
        ["p2", "2026-03", "csv"],
      ]);
    });

    it("writes nothing and no batch when no product is known", async () => {
      await expect(
        importPrices(db, [{ product: "Nobody", date: "2026-03-31", price: 1 }], meta),
      ).rejects.toThrow(/Nobody/);
      expect(await db.selectFrom("importBatch").selectAll().execute()).toEqual([]);
    });
  });
});

describe("Prices API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-prices-api-"));
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
  const PRODUCT = {
    name: "VWCE",
    isin: "IE00BK5BQT80",
    ticker: "VWCE.MI",
    assetClass: "Equity",
    regime: "etf",
    expReturn: 0.065,
    volatility: 0.16,
    ter: 0.0019,
  };
  const addProduct = async (over: object = {}) =>
    (await call<Product>("POST", "/api/products", { ...PRODUCT, ...over })).body.id;

  interface Grid {
    currentMonth: string;
    months: string[];
    rows: {
      productId: string;
      prices: Record<string, { price: number; source: string; priceDate: string }>;
    }[];
  }
  const grid = async (through = "") =>
    (await call<Grid>("GET", `/api/prices/grid${through ? `?through=${through}` : ""}`)).body;

  it("shows 6 months ending at the clock month, and add next month slides the window", async () => {
    await addProduct();
    expect((await grid()).months).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    const next = await grid("2026-04");
    expect(next.currentMonth).toBe("2026-03");
    expect(next.months.at(-1)).toBe("2026-04");
    expect(next.months).toHaveLength(6);
  });

  it("stores a manual price with the clock date for the current month, and the last day for others", async () => {
    const productId = await addProduct();
    const current = await call("PUT", "/api/prices", { productId, month: "2026-03", price: 101.5 });
    const later = await call("PUT", "/api/prices", { productId, month: "2026-04", price: 102 });
    expect([current.status, later.status]).toEqual([200, 200]);
    const { rows } = await grid("2026-04");
    expect(rows[0]?.prices["2026-03"]).toEqual({
      price: 101.5,
      source: "manual",
      priceDate: "2026-03-15",
    });
    expect(rows[0]?.prices["2026-04"]).toMatchObject({ source: "manual", priceDate: "2026-04-30" });
  });

  it("refuses to type a price for an earlier month", async () => {
    const productId = await addProduct();
    const { status, body } = await call<{ error: string }>("PUT", "/api/prices", {
      productId,
      month: "2026-02",
      price: 100,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/CSV/);
    expect((await grid()).rows[0]?.prices).toEqual({});
  });

  it("refuses to type a price two months ahead", async () => {
    const productId = await addProduct();
    const { status } = await call("PUT", "/api/prices", {
      productId,
      month: "2026-05",
      price: 100,
    });
    expect(status).toBe(400);
    expect((await grid("2026-05")).rows[0]?.prices).toEqual({});
  });

  it("refuses the provider source for a BTP and a pension fund, and allows it for an ETF", async () => {
    const etf = await addProduct();
    const btp = await addProduct({ name: "BTP", regime: "govt", assetClass: "Govt bonds" });
    const pension = await addProduct({ name: "Fund", regime: "pension" });
    const set = async (productId: string) =>
      (await call("PUT", "/api/prices/source", { productId, priceSource: "provider" })).status;
    expect([await set(btp), await set(pension), await set(etf)]).toEqual([400, 400, 200]);
    const csv = await call("PUT", "/api/prices/source", { productId: btp, priceSource: "csv" });
    expect(csv.status).toBe(200);
  });

  it("answers 404 for a manual price of an unknown product", async () => {
    const { status } = await call("PUT", "/api/prices", {
      productId: "nope",
      month: "2026-03",
      price: 1,
    });
    expect(status).toBe(404);
  });

  it("imports a long and a wide CSV into the same prices", async () => {
    const productId = await addProduct();
    const long = "date;product;price\n2026-01-31;VWCE.MI;101,25\n2026-02-28;VWCE.MI;103\n";
    const wide = "date;VWCE.MI\n2026-01-31;101,25\n2026-02-28;103\n";
    const rows = async (text: string) => {
      const { status, body } = await call<{ rowsImported: number }>("POST", "/api/prices/import", {
        text,
      });
      expect([status, body.rowsImported]).toEqual([200, 2]);
      return (await grid()).rows.find((r) => r.productId === productId)?.prices;
    };
    const fromLong = await rows(long);
    const fromWide = await rows(wide);
    expect(fromLong).toEqual({
      "2026-01": { price: 101.25, source: "csv", priceDate: "2026-01-31" },
      "2026-02": { price: 103, source: "csv", priceDate: "2026-02-28" },
    });
    expect(fromWide).toEqual(fromLong);
  });

  it("lists unknown products and answers 400 with the row for a bad file", async () => {
    await addProduct();
    const partial = await call<{ unknownProducts: string[]; rowsSkipped: number }>(
      "POST",
      "/api/prices/import",
      { text: "date;product;price\n2026-02-28;VWCE;1\n2026-02-28;Ghost;2\n" },
    );
    expect(partial.body).toMatchObject({ unknownProducts: ["Ghost"], rowsSkipped: 1 });
    const bad = await call<{ error: string }>("POST", "/api/prices/import", {
      text: "date;product;price\nsoon;VWCE;1\n",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Row 2/);
  });

  it("keeps a typed price in the grid, then a csv overwrites it", async () => {
    const productId = await addProduct();
    await call("PUT", "/api/prices", { productId, month: "2026-03", price: 101 });
    await call("POST", "/api/prices/import", { text: "date;product;price\n2026-03-12;VWCE;105\n" });
    expect((await grid()).rows[0]?.prices["2026-03"]).toMatchObject({
      price: 105,
      source: "csv",
      priceDate: "2026-03-12",
    });
  });

  it("reads and sets the source per product, and the last price", async () => {
    const productId = await addProduct();
    interface Overview {
      productId: string;
      priceSource: string;
      lastPrice: { price: number; priceDate: string } | null;
    }
    const overview = async () => (await call<Overview[]>("GET", "/api/prices/overview")).body;
    expect((await overview())[0]).toMatchObject({ priceSource: "manual", lastPrice: null });
    await call("PUT", "/api/prices", { productId, month: "2026-03", price: 101.5 });
    const set = await call("PUT", "/api/prices/source", { productId, priceSource: "csv" });
    expect(set.status).toBe(200);
    expect((await overview())[0]).toMatchObject({
      priceSource: "csv",
      lastPrice: { price: 101.5, priceDate: "2026-03-15" },
    });
    expect(
      (await call("PUT", "/api/prices/source", { productId: "nope", priceSource: "csv" })).status,
    ).toBe(404);
  });

  it("stores broker units with their date, and clears them", async () => {
    const productId = await addProduct();
    interface Overview {
      brokerUnits: number | null;
      brokerUnitsDate: string | null;
    }
    const read = async () => (await call<Overview[]>("GET", "/api/prices/overview")).body[0];
    await call("PUT", "/api/prices/broker-units", { productId, units: 12.5, date: "2026-03-14" });
    expect(await read()).toMatchObject({ brokerUnits: 12.5, brokerUnitsDate: "2026-03-14" });
    await call("PUT", "/api/prices/broker-units", { productId, units: null, date: null });
    expect(await read()).toMatchObject({ brokerUnits: null, brokerUnitsDate: null });
    const half = await call("PUT", "/api/prices/broker-units", { productId, units: 3, date: null });
    expect(half.status).toBe(400);
  });
});
