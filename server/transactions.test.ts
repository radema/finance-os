import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, Product, Transaction } from "../engine/schemas.ts";
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const PRODUCT = {
  name: "VWCE",
  assetClass: "Equity",
  regime: "etf",
  expReturn: 0.065,
  volatility: 0.16,
  ter: 0.0019,
};
const BTP = { ...PRODUCT, name: "BTP 2030", assetClass: "Govt bonds", regime: "govt" };
const GOAL = {
  name: "Home",
  priority: "Need",
  targetCents: 5_000_000,
  targetYear: 2032,
  contributionGrowth: 0.02,
};

interface Holdings {
  buckets: { goalId: string; productId: string; units: number }[];
  accounts: { productId: string; units: number; pmc: number | null }[];
}

describe("Transactions API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-transactions-"));
    const server = await startServer({ dataDir, port: 0 });
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
  const setup = async (product = PRODUCT) => {
    const productId = (await call<Product>("POST", "/api/products", product)).body.id;
    const goalId = (await call<Goal>("POST", "/api/goals", GOAL)).body.id;
    await call("POST", "/api/cash-movements", {
      date: "2025-01-01",
      goalId,
      type: "contribution",
      amountCents: 1_000_000,
    });
    return { productId, goalId };
  };
  const holdings = async () => (await call<Holdings>("GET", "/api/holdings")).body;

  it("derives qty = amount / price for an ETF", async () => {
    const { productId, goalId } = await setup();
    const { status, body } = await call<Transaction>("POST", "/api/transactions", {
      date: "2026-03-10",
      goalId,
      productId,
      type: "buy",
      amountCents: 100_000,
      price: 80,
      commissionCents: 295,
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      qty: 12.5,
      amountCents: 100_000,
      price: 80,
      commissionCents: 295,
    });
    const listed = (await call<Transaction[]>("GET", "/api/transactions")).body;
    expect(listed).toEqual([body]);
  });

  it("derives qty = amount / (price / 100) for a BTP and keeps the PMC per unit", async () => {
    const { productId, goalId } = await setup(BTP);
    const { body } = await call<Transaction>("POST", "/api/transactions", {
      date: "2026-03-10",
      goalId,
      productId,
      type: "buy",
      amountCents: 100_000,
      price: 98,
    });
    expect(body.qty).toBeCloseTo(1020.408163, 6);
    const { accounts } = await holdings();
    expect(accounts[0]?.units).toBeCloseTo(1020.408163, 6);
    expect(accounts[0]?.pmc).toBeCloseTo(0.98, 6);
  });

  it("stores a sell with negative qty and a positive amount", async () => {
    const { productId, goalId } = await setup();
    const funding = (await call<{ id: string }[]>("GET", "/api/cash-movements")).body;
    for (const row of funding) await call("DELETE", `/api/cash-movements?id=${row.id}`);
    await call("POST", "/api/opening-position", {
      asOf: "2025-12-31",
      positions: [{ productId, totalUnits: 5, pmc: 100, parts: [{ goalId, units: 5 }] }],
    });
    const sell = await call<Transaction>("POST", "/api/transactions", {
      date: "2026-04-10",
      goalId,
      productId,
      type: "sell",
      amountCents: 50_000,
      price: 100,
    });
    expect(sell.body).toMatchObject({ qty: -5, amountCents: 50_000 });
  });

  it("stores no commission when it is empty, and a coupon with qty 0", async () => {
    const { productId, goalId } = await setup();
    const buy = await call<Transaction>("POST", "/api/transactions", {
      date: "2026-03-10",
      goalId,
      productId,
      type: "buy",
      amountCents: 10_000,
      price: 100,
    });
    expect(buy.body.commissionCents).toBeNull();
    const coupon = await call<Transaction>("POST", "/api/transactions", {
      date: "2026-09-10",
      goalId,
      productId,
      type: "coupon",
      amountCents: 1_500,
      price: 55,
    });
    expect(coupon.body).toMatchObject({ qty: 0, price: 0, amountCents: 1_500 });
    const listed = (await call<Transaction[]>("GET", "/api/transactions")).body;
    expect(listed).toContainEqual(coupon.body);
  });

  it("refuses a zero price, an unknown goal and a bad date", async () => {
    const { productId, goalId } = await setup();
    const base = { date: "2026-03-10", goalId, productId, type: "buy", amountCents: 100 };
    expect((await call("POST", "/api/transactions", { ...base, price: 0 })).status).toBe(400);
    expect(
      (await call("POST", "/api/transactions", { ...base, price: 1, date: "10/03" })).status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/transactions", { ...base, price: 1, goalId: "nope" })).status,
    ).toBe(404);
  });

  it("re-derives holdings after an edit and after a delete", async () => {
    const { productId, goalId } = await setup();
    const input = { date: "2026-03-10", goalId, productId, type: "buy", price: 100 };
    const first = await call<Transaction>("POST", "/api/transactions", {
      ...input,
      amountCents: 100_000,
    });
    await call("POST", "/api/transactions", { ...input, date: "2026-04-10", amountCents: 50_000 });
    expect((await holdings()).accounts[0]?.units).toBe(15);
    expect((await holdings()).buckets).toEqual([{ goalId, productId, units: 15 }]);

    const edited = await call<Transaction>("PUT", "/api/transactions", {
      ...input,
      id: first.body.id,
      amountCents: 200_000,
    });
    expect(edited.body.qty).toBe(20);
    expect((await holdings()).accounts[0]?.units).toBe(25);

    expect((await call("DELETE", `/api/transactions?id=${first.body.id}`)).status).toBe(200);
    expect((await holdings()).accounts[0]?.units).toBe(5);
    expect((await call("DELETE", `/api/transactions?id=${first.body.id}`)).status).toBe(404);
  });

  it("lists by goal and by year, newest first", async () => {
    const { productId, goalId } = await setup();
    const other = (await call<Goal>("POST", "/api/goals", { ...GOAL, name: "Car" })).body.id;
    await call("POST", "/api/cash-movements", {
      date: "2025-01-01",
      goalId: other,
      type: "contribution",
      amountCents: 100_000,
    });
    const input = { productId, type: "buy", amountCents: 10_000, price: 100 };
    await call("POST", "/api/transactions", { ...input, goalId, date: "2025-12-31" });
    await call("POST", "/api/transactions", { ...input, goalId, date: "2026-01-01" });
    await call("POST", "/api/transactions", { ...input, goalId: other, date: "2026-06-01" });
    const dates = async (query: string) =>
      (await call<Transaction[]>("GET", `/api/transactions${query}`)).body.map((t) => t.date);
    expect(await dates("")).toEqual(["2026-06-01", "2026-01-01", "2025-12-31"]);
    expect(await dates(`?goalId=${goalId}`)).toEqual(["2026-01-01", "2025-12-31"]);
    expect(await dates("?year=2026")).toEqual(["2026-06-01", "2026-01-01"]);
    expect(await dates(`?goalId=${goalId}&year=2025`)).toEqual(["2025-12-31"]);
  });

  it("reads the latest price of a product, or null", async () => {
    const { productId } = await setup();
    expect((await call("GET", `/api/last-price?productId=${productId}`)).body).toBeNull();
    const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
    const insert = database.prepare(
      "INSERT INTO price_point (product_id, month, price_scaled, price_date, source, fetched_at) VALUES (?, ?, ?, ?, 'manual', '2026-10-01')",
    );
    insert.run(productId, "2026-09", 100_000_000, "2026-09-30");
    insert.run(productId, "2026-10", 123_450_000, "2026-10-15");
    database.close();
    expect((await call("GET", `/api/last-price?productId=${productId}`)).body).toEqual({
      price: 123.45,
      priceDate: "2026-10-15",
    });
  });
});

describe("App clock API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-clock-"));
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const today = async (): Promise<unknown> => {
    const server = await startServer({ dataDir, port: 0 });
    stop = server.close;
    return (await (await fetch(`${server.url}/api/today`)).json()) as unknown;
  };

  it("sends GBI_AS_OF as the date", async () => {
    vi.stubEnv("GBI_AS_OF", "2026-03-15");
    expect(await today()).toEqual({ today: "2026-03-15" });
  });

  it("sends today's date when GBI_AS_OF is not set", async () => {
    vi.stubEnv("GBI_AS_OF", "");
    expect(await today()).toEqual({ today: new Date().toLocaleDateString("sv") });
  });
});
