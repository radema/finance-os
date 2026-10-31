import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal, Product } from "../engine/schemas.ts";
import { startServer } from "./index.ts";

const PRODUCT = {
  name: "VWCE",
  assetClass: "Equity",
  regime: "etf",
  expReturn: 0.065,
  volatility: 0.16,
  ter: 0.0019,
};
const GOAL = {
  name: "Home",
  priority: "Need",
  targetCents: 5_000_000,
  targetYear: 2032,
  contributionGrowth: 0.02,
};

interface Progress {
  products: boolean;
  goals: boolean;
  openingPosition: boolean;
  sampleAvailable: boolean;
}

describe("Setup progress API (AC-42)", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-progress-"));
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
  const progress = async () => (await call<Progress>("GET", "/api/setup-progress")).body;

  it("is all open, with the sample offered, on an empty data folder", async () => {
    expect(await progress()).toEqual({
      products: false,
      goals: false,
      openingPosition: false,
      sampleAvailable: true,
    });
  });

  it("marks products and goals done as they are added, and stops offering the sample", async () => {
    const product = (await call<Product>("POST", "/api/products", PRODUCT)).body;
    expect(await progress()).toMatchObject({
      products: true,
      goals: false,
      sampleAvailable: false,
    });
    const goal = (await call<Goal>("POST", "/api/goals", GOAL)).body;
    expect(await progress()).toMatchObject({
      products: true,
      goals: true,
      openingPosition: false,
    });
    const saved = await call("POST", "/api/opening-position", {
      asOf: "2026-02-01",
      positions: [
        { productId: product.id, totalUnits: 10, pmc: 50, parts: [{ goalId: goal.id, units: 10 }] },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await progress()).toMatchObject({ openingPosition: true });
  });

  it("is all done after the sample data loads: its ledger holds opening rows", async () => {
    expect((await call("POST", "/api/sample-data")).status).toBe(200);
    expect(await progress()).toEqual({
      products: true,
      goals: true,
      openingPosition: true,
      sampleAvailable: false,
    });
  });
});
