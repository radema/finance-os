import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchedPrice, PriceProvider } from "../engine/priceFetch.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import {
  acceptReviewItem,
  discardReviewItem,
  fetchPrices,
  priceFetchProblems,
  readReviewList,
} from "./priceFetch.ts";
import { storePrice } from "./prices.ts";
import type { PricePointTable } from "./schema.ts";

const TODAY = "2026-03-15";
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
  priceSource: "provider",
  brokerUnitsScaled: null,
  brokerUnitsDate: null,
} as const;
const PRODUCTS = [
  { ...PRODUCT_ROW, id: "good", name: "Good ETF", ticker: "GOOD.MI" },
  { ...PRODUCT_ROW, id: "usd", name: "Dollar ETF", ticker: "USD.MI" },
  { ...PRODUCT_ROW, id: "jump", name: "Jump ETF", ticker: "JUMP.MI" },
  { ...PRODUCT_ROW, id: "down", name: "Broken ETF", ticker: "DOWN.MI" },
];
const february = (productId: string, over: Partial<PricePointTable> = {}): PricePointTable => ({
  productId,
  month: "2026-02",
  priceScaled: 100_000_000,
  priceDate: "2026-02-27",
  source: "csv",
  fetchedAt: "2026-02-28T10:00:00Z",
  importBatchId: null,
  ...over,
});
const close = (ticker: string, close: number, currency = "EUR", date = "2026-03-13") => ({
  ticker,
  date,
  close,
  currency,
});

/** A provider that answers from a table. An `Error` entry is thrown; a ticker not listed gives no rows. */
const stubProvider = (answers: Record<string, FetchedPrice[] | Error>): PriceProvider => ({
  async fetch(tickers) {
    return tickers.flatMap((ticker) => {
      const answer = answers[ticker];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    });
  },
});
const ANSWERS = {
  "GOOD.MI": [close("GOOD.MI", 103)],
  "USD.MI": [close("USD.MI", 110, "USD")],
  "JUMP.MI": [close("JUMP.MI", 130)],
  "DOWN.MI": new Error("Yahoo answered 500"),
};

describe("fetchPrices", () => {
  let dataDir: string;
  let db: Kysely<DB>;
  const stored = () =>
    db
      .selectFrom("pricePoint")
      .select(["productId", "month", "priceScaled", "source"])
      .where("month", "=", "2026-03")
      .orderBy("productId")
      .execute();
  const run = async (
    answers: Record<string, FetchedPrice[] | Error>,
    options: { explicitRefetch?: boolean; only?: string[] } = {},
  ) => {
    const rows = await db.selectFrom("product").select(["id", "ticker"]).execute();
    const products = PRODUCTS.flatMap(({ id }) => rows.filter((row) => row.id === id)).filter(
      (p) => !options.only || options.only.includes(p.id),
    );
    return fetchPrices(db, stubProvider(answers), products, {
      explicitRefetch: options.explicitRefetch ?? false,
      today: TODAY,
    });
  };

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-fetch-"));
    db = await openDatabase(dataDir);
    await db.insertInto("product").values(PRODUCTS).execute();
    for (const { id } of PRODUCTS) await storePrice(db, february(id), { explicitRefetch: false });
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores only the good EUR price, from a stub that also gives a USD price, a +30% move and an error", async () => {
    const result = await run(ANSWERS);
    expect(await stored()).toEqual([
      { productId: "good", month: "2026-03", priceScaled: 103_000_000, source: "provider" },
    ]);
    expect(result.stored).toEqual([{ productId: "good", month: "2026-03", price: 103 }]);
  });

  it("puts the USD price and the +30% price on the review list, with their reason", async () => {
    const result = await run(ANSWERS);
    expect(result.reviewed.map((i) => [i.productId, i.reason])).toEqual([
      ["usd", "non-eur"],
      ["jump", "move-above-25"],
    ]);
    expect(await readReviewList(db)).toEqual([
      {
        id: "usd|2026-03",
        productId: "usd",
        productName: "Dollar ETF",
        ticker: "USD.MI",
        month: "2026-03",
        date: "2026-03-13",
        price: 110,
        currency: "USD",
        reason: "non-eur",
      },
      expect.objectContaining({ productId: "jump", price: 130, reason: "move-above-25" }),
    ]);
  });

  it("makes the fetch problem true for the USD price, the +30% move and the error", async () => {
    await run(ANSWERS);
    expect(await priceFetchProblems(db)).toEqual([
      { productId: "down", reason: "provider-error" },
      { productId: "usd", reason: "non-eur" },
      { productId: "jump", reason: "move-above-25" },
    ]);
  });

  it("does not throw when the provider fails, and records the message", async () => {
    const result = await run(ANSWERS, { only: ["down"] });
    expect(result).toMatchObject({ stored: [], reviewed: [] });
    expect(result.problems).toEqual([{ productId: "down", reason: "provider-error" }]);
    expect(result.errors).toEqual([{ productId: "down", message: "Yahoo answered 500" }]);
  });

  it("treats an empty answer and a product without a ticker as a provider error", async () => {
    await db.updateTable("product").set({ ticker: "" }).where("id", "=", "usd").execute();
    const result = await run({ "GOOD.MI": [] }, { only: ["good", "usd"] });
    expect(result.problems).toEqual([
      { productId: "good", reason: "provider-error" },
      { productId: "usd", reason: "provider-error" },
    ]);
    expect(result.errors.map((e) => e.message)).toEqual([
      "The provider returned no price for GOOD.MI.",
      "The product has no ticker.",
    ]);
  });

  it("skips the move check when there is no previous month price", async () => {
    await db.deleteFrom("pricePoint").where("productId", "=", "jump").execute();
    await run(ANSWERS, { only: ["jump"] });
    expect((await stored()).map((p) => p.productId)).toEqual(["jump"]);
    expect(await priceFetchProblems(db)).toEqual([]);
  });

  it("keeps the last trading day of the month and stores last month's close too", async () => {
    await run(
      {
        "GOOD.MI": [
          close("GOOD.MI", 101, "EUR", "2026-02-26"),
          close("GOOD.MI", 102, "EUR", "2026-02-27"),
          close("GOOD.MI", 103, "EUR", "2026-03-12"),
          close("GOOD.MI", 104, "EUR", "2026-03-13"),
        ],
      },
      { only: ["good"] },
    );
    const rows = await db
      .selectFrom("pricePoint")
      .select(["month", "priceScaled", "priceDate"])
      .where("productId", "=", "good")
      .orderBy("month")
      .execute();
    expect(rows).toEqual([
      { month: "2026-02", priceScaled: 102_000_000, priceDate: "2026-02-27" },
      { month: "2026-03", priceScaled: 104_000_000, priceDate: "2026-03-13" },
    ]);
  });

  it("checks a month against the stored price of the month before", async () => {
    // February moves +10% (stored) and March moves +20% on top of it: each is within 25%.
    await run(
      {
        "GOOD.MI": [
          close("GOOD.MI", 110, "EUR", "2026-02-27"),
          close("GOOD.MI", 132, "EUR", "2026-03-13"),
        ],
      },
      { only: ["good"] },
    );
    expect((await stored()).map((p) => p.priceScaled)).toEqual([132_000_000]);
    expect(await priceFetchProblems(db)).toEqual([]);
  });

  describe("manual price of the same month", () => {
    const manual: PricePointTable = february("good", {
      month: "2026-03",
      priceDate: TODAY,
      priceScaled: 99_000_000,
      source: "manual",
    });
    beforeEach(async () => {
      await storePrice(db, manual, { explicitRefetch: false });
    });

    it("is not overwritten by a plain fetch", async () => {
      const result = await run(ANSWERS, { only: ["good"] });
      expect(await stored()).toEqual([
        { productId: "good", month: "2026-03", priceScaled: 99_000_000, source: "manual" },
      ]);
      expect(result.stored).toEqual([]);
    });

    it("is overwritten by an explicit re-fetch", async () => {
      await run(ANSWERS, { only: ["good"], explicitRefetch: true });
      expect(await stored()).toEqual([
        { productId: "good", month: "2026-03", priceScaled: 103_000_000, source: "provider" },
      ]);
    });
  });

  describe("a later fetch", () => {
    it("clears the problem of a product that now gets a good price", async () => {
      await run(ANSWERS);
      await run({
        ...ANSWERS,
        "DOWN.MI": [close("DOWN.MI", 101)],
        "USD.MI": [close("USD.MI", 101)],
      });
      expect(await priceFetchProblems(db)).toEqual([
        { productId: "jump", reason: "move-above-25" },
      ]);
      expect((await readReviewList(db)).map((i) => i.productId)).toEqual(["jump"]);
    });

    it("keeps one review item per product and month", async () => {
      await run(ANSWERS);
      await run({ "JUMP.MI": [close("JUMP.MI", 135)] }, { only: ["jump"] });
      const jumps = (await readReviewList(db)).filter((i) => i.productId === "jump");
      expect(jumps.map((i) => i.price)).toEqual([135]);
    });
  });

  describe("review list", () => {
    it("accept stores the price with source provider and removes the item", async () => {
      await run(ANSWERS);
      await acceptReviewItem(db, "jump|2026-03");
      expect(await stored()).toContainEqual({
        productId: "jump",
        month: "2026-03",
        priceScaled: 130_000_000,
        source: "provider",
      });
      expect((await readReviewList(db)).map((i) => i.productId)).toEqual(["usd"]);
      expect((await priceFetchProblems(db)).map((p) => p.productId)).toEqual(["down", "usd"]);
    });

    it("discard removes the item and stores nothing", async () => {
      await run(ANSWERS);
      await discardReviewItem(db, "usd|2026-03");
      expect((await readReviewList(db)).map((i) => i.productId)).toEqual(["jump"]);
      expect((await stored()).map((p) => p.productId)).toEqual(["good"]);
    });

    it("answers 404 for an unknown item", async () => {
      await expect(acceptReviewItem(db, "nope|2026-03")).rejects.toMatchObject({ status: 404 });
      await expect(discardReviewItem(db, "nope|2026-03")).rejects.toMatchObject({ status: 404 });
    });

    it("leaves out a product that was deleted or no longer uses the provider", async () => {
      await run(ANSWERS);
      await db.deleteFrom("pricePoint").where("productId", "=", "usd").execute();
      await db.deleteFrom("product").where("id", "=", "usd").execute();
      await db
        .updateTable("product")
        .set({ priceSource: "csv" })
        .where("id", "=", "down")
        .execute();
      expect((await readReviewList(db)).map((i) => i.productId)).toEqual(["jump"]);
      expect((await priceFetchProblems(db)).map((p) => p.productId)).toEqual(["jump"]);
    });
  });
});

describe("Prices fetch API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;
  const start = async (answers: Record<string, FetchedPrice[] | Error>) => {
    const server = await startServer({
      dataDir,
      port: 0,
      today: TODAY,
      priceProvider: stubProvider(answers),
    });
    stop = server.close;
    url = server.url;
  };
  const call = async <T = unknown>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const addProduct = async (name: string, ticker: string, priceSource = "provider") => {
    const { body } = await call<{ id: string }>("POST", "/api/products", {
      name,
      ticker,
      assetClass: "Equity",
      regime: "etf",
      expReturn: 0.065,
      volatility: 0.16,
      ter: 0.0019,
    });
    await call("PUT", "/api/prices/source", { productId: body.id, priceSource });
    return body.id;
  };
  interface Review {
    items: { id: string; productName: string; reason: string }[];
    problems: { productId: string; reason: string }[];
    errors: { productId: string; message: string }[];
  }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-fetch-api-"));
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("fetches every provider product, and the Prices screen still loads after a provider error", async () => {
    await start({ ...ANSWERS });
    await addProduct("Good ETF", "GOOD.MI");
    await addProduct("Dollar ETF", "USD.MI");
    await addProduct("Broken ETF", "DOWN.MI");
    await addProduct("Typed", "TYPED.MI", "manual");
    const fetched = await call<{ stored: unknown[]; reviewed: unknown[]; problems: unknown[] }>(
      "POST",
      "/api/prices/fetch",
      {},
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.stored).toHaveLength(1);
    expect(fetched.body.reviewed).toHaveLength(1);
    expect((await call("GET", "/api/prices/overview")).status).toBe(200);
    expect((await call("GET", "/api/prices/grid")).status).toBe(200);
    const review = (await call<Review>("GET", "/api/prices/review")).body;
    expect(review.items.map((i) => [i.productName, i.reason])).toEqual([["Dollar ETF", "non-eur"]]);
    expect(review.problems.map((p) => p.reason).sort()).toEqual(["non-eur", "provider-error"]);
    expect(review.errors.map((e) => e.message)).toEqual(["Yahoo answered 500"]);
  });

  it("re-fetches one product explicitly over a manual price, and refuses a non-provider product", async () => {
    await start({ "GOOD.MI": [close("GOOD.MI", 103)] });
    const id = await addProduct("Good ETF", "GOOD.MI");
    const typed = await addProduct("Typed", "TYPED.MI", "manual");
    await call("PUT", "/api/prices", { productId: id, month: "2026-03", price: 99 });
    const price = async () =>
      (
        await call<{ rows: { productId: string; prices: Record<string, { price: number }> }[] }>(
          "GET",
          "/api/prices/grid",
        )
      ).body.rows.find((r) => r.productId === id)?.prices["2026-03"]?.price;

    await call("POST", "/api/prices/fetch", {});
    expect(await price()).toBe(99);
    await call("POST", "/api/prices/fetch", { productId: id });
    expect(await price()).toBe(103);
    expect((await call("POST", "/api/prices/fetch", { productId: typed })).status).toBe(400);
    expect((await call("POST", "/api/prices/fetch", { productId: "nope" })).status).toBe(404);
  });

  it("accepts and discards review items over the API, and keeps them after a restart", async () => {
    await start({
      "USD.MI": [close("USD.MI", 110, "USD")],
      "GOOD.MI": [close("GOOD.MI", 50, "GBP")],
    });
    await addProduct("Dollar ETF", "USD.MI");
    await addProduct("Pound ETF", "GOOD.MI");
    await call("POST", "/api/prices/fetch", {});
    await stop?.();
    await start({});
    const items = (await call<Review>("GET", "/api/prices/review")).body.items;
    expect(items.map((i) => i.productName)).toEqual(["Dollar ETF", "Pound ETF"]);

    expect((await call("POST", "/api/prices/review/accept", { id: items[0]?.id })).status).toBe(
      200,
    );
    expect((await call("POST", "/api/prices/review/discard", { id: items[1]?.id })).status).toBe(
      200,
    );
    expect((await call<Review>("GET", "/api/prices/review")).body.items).toEqual([]);
    expect((await call("POST", "/api/prices/review/accept", { id: items[0]?.id })).status).toBe(
      404,
    );
    const grid = await call<{ rows: { prices: Record<string, { source: string }> }[] }>(
      "GET",
      "/api/prices/grid",
    );
    expect(grid.body.rows.map((r) => r.prices["2026-03"]?.source)).toEqual(["provider", undefined]);
  });
});
