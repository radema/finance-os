import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal, Product, Transaction } from "../engine/schemas.ts";
import { startServer } from "./index.ts";

const PRODUCT = {
  name: "VWCE",
  assetClass: "Equity",
  regime: "etf",
  expReturn: 0.065,
  volatility: 0.16,
  ter: 0.0019,
};
const PENSION = { ...PRODUCT, name: "Pension fund", assetClass: "Equity", regime: "pension" };
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

describe("Current portfolio API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-opening-"));
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
  const make = async () => {
    const productId = (await call<Product>("POST", "/api/products", PRODUCT)).body.id;
    const pensionId = (await call<Product>("POST", "/api/products", PENSION)).body.id;
    const home = (await call<Goal>("POST", "/api/goals", GOAL)).body.id;
    const retire = (await call<Goal>("POST", "/api/goals", { ...GOAL, name: "Retire" })).body.id;
    return { productId, pensionId, home, retire };
  };
  const save = (body: unknown) => call<Transaction[]>("POST", "/api/opening-position", body);

  it("writes one opening transaction per part: 100 units at PMC 50 split 60/40", async () => {
    const { productId, home, retire } = await make();
    const { status, body } = await save({
      asOf: "2026-01-01",
      positions: [
        {
          productId,
          totalUnits: 100,
          pmc: 50,
          parts: [
            { goalId: home, units: 60 },
            { goalId: retire, units: 40 },
          ],
        },
      ],
    });
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body).toContainEqual(
      expect.objectContaining({
        type: "opening",
        date: "2026-01-01",
        goalId: home,
        qty: 60,
        price: 50,
        amountCents: 300_000,
        commissionCents: null,
      }),
    );
    expect(body).toContainEqual(
      expect.objectContaining({ goalId: retire, qty: 40, price: 50, amountCents: 200_000 }),
    );
    const listed = (await call<Transaction[]>("GET", "/api/transactions")).body;
    expect(listed.map((t) => t.id).sort()).toEqual(body.map((t) => t.id).sort());
  });

  it("shows units per bucket and the account PMC in holdings", async () => {
    const { productId, home, retire } = await make();
    await save({
      asOf: "2026-01-01",
      positions: [
        {
          productId,
          totalUnits: 100,
          pmc: 50,
          parts: [
            { goalId: home, units: 60 },
            { goalId: retire, units: 40 },
          ],
        },
      ],
    });
    const { buckets, accounts } = (await call<Holdings>("GET", "/api/holdings")).body;
    expect(buckets).toContainEqual({ goalId: home, productId, units: 60 });
    expect(buckets).toContainEqual({ goalId: retire, productId, units: 40 });
    expect(accounts[0]?.units).toBe(100);
    expect(accounts[0]?.pmc).toBeCloseTo(50, 6);
  });

  it("takes a pension fund with fractional units in the same form", async () => {
    const { pensionId, retire } = await make();
    const { status, body } = await save({
      asOf: "2026-01-01",
      positions: [
        {
          productId: pensionId,
          totalUnits: 812.345678,
          pmc: 21.5,
          parts: [{ goalId: retire, units: 812.345678 }],
        },
      ],
    });
    expect(status).toBe(200);
    expect(body[0]).toMatchObject({ qty: 812.345678, price: 21.5, amountCents: 1_746_543 });
  });

  it("refuses parts that do not sum to the total, and saves nothing", async () => {
    const { productId, home, retire } = await make();
    const position = {
      productId,
      totalUnits: 100,
      pmc: 50,
      parts: [
        { goalId: home, units: 60 },
        { goalId: retire, units: 30 },
      ],
    };
    expect((await save({ asOf: "2026-01-01", positions: [position] })).status).toBe(400);
    expect((await call<Transaction[]>("GET", "/api/transactions")).body).toEqual([]);
  });

  it("refuses non-positive units or PMC, a repeated product and an empty form", async () => {
    const { productId, home } = await make();
    const ok = { productId, totalUnits: 10, pmc: 5, parts: [{ goalId: home, units: 10 }] };
    const asOf = "2026-01-01";
    for (const positions of [
      [{ ...ok, totalUnits: 0, parts: [{ goalId: home, units: 0 }] }],
      [{ ...ok, pmc: 0 }],
      [ok, ok],
      [],
    ]) {
      expect((await save({ asOf, positions })).status).toBe(400);
    }
    expect((await call<Transaction[]>("GET", "/api/transactions")).body).toEqual([]);
  });

  it("refuses an unknown product or goal with 404", async () => {
    const { productId, home } = await make();
    const asOf = "2026-01-01";
    const unknownProduct = {
      productId: "nope",
      totalUnits: 1,
      pmc: 1,
      parts: [{ goalId: home, units: 1 }],
    };
    const unknownGoal = { productId, totalUnits: 1, pmc: 1, parts: [{ goalId: "nope", units: 1 }] };
    expect((await save({ asOf, positions: [unknownProduct] })).status).toBe(404);
    expect((await save({ asOf, positions: [unknownGoal] })).status).toBe(404);
  });

  it("refuses a second save with a clear message and keeps the first", async () => {
    const { productId, home } = await make();
    const body = {
      asOf: "2026-01-01",
      positions: [{ productId, totalUnits: 10, pmc: 5, parts: [{ goalId: home, units: 10 }] }],
    };
    expect((await save(body)).status).toBe(200);
    const second = await call<{ error: string }>("POST", "/api/opening-position", body);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already/i);
    expect((await call<Transaction[]>("GET", "/api/transactions")).body).toHaveLength(1);
  });

  it("reports the saved asOf, or null before any save", async () => {
    const { productId, home } = await make();
    expect((await call("GET", "/api/opening-position")).body).toEqual({ asOf: null });
    await save({
      asOf: "2026-02-01",
      positions: [{ productId, totalUnits: 10, pmc: 5, parts: [{ goalId: home, units: 10 }] }],
    });
    expect((await call("GET", "/api/opening-position")).body).toEqual({ asOf: "2026-02-01" });
  });
});
