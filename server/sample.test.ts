import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pensionPlanPartialSchema } from "../engine/fixture.ts";
import { type DB, openDatabase } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import { HttpError } from "./router.ts";
import { loadSampleData } from "./sample.ts";

const count = async (db: Kysely<DB>, table: "product" | "goal" | "transaction" | "pricePoint") =>
  (
    await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow()
  ).n;

describe("loadSampleData", () => {
  let dataDir: string;
  let db: Kysely<DB>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-sample-"));
    db = await openDatabase(dataDir);
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("loads 7 products and 4 goals into an empty database", async () => {
    await loadSampleData(db);
    expect(await count(db, "product")).toBe(7);
    expect(await count(db, "goal")).toBe(4);
    expect(await count(db, "transaction")).toBe(13);
    expect(await count(db, "pricePoint")).toBe(77);
  });

  it("stores money as integer cents and the sell as a negative quantity", async () => {
    await loadSampleData(db);
    const goal = await db
      .selectFrom("goal")
      .select(["targetCents"])
      .where("id", "=", "g-car")
      .executeTakeFirstOrThrow();
    expect(goal.targetCents).toBe(2_000_000);
    const sell = await db
      .selectFrom("transaction")
      .selectAll()
      .where("type", "=", "sell")
      .executeTakeFirstOrThrow();
    expect(sell).toMatchObject({
      qtyScaled: -10_000_000,
      commissionCents: 295,
      amountCents: -118_000,
    });
    const bond = await db
      .selectFrom("transaction")
      .select("amountCents")
      .where("productId", "=", "p-govt")
      .executeTakeFirstOrThrow();
    // 3,000 nominal at a quote of 98.50 per 100.
    expect(bond.amountCents).toBe(295_500);
  });

  it("saves the settings with the zainetto and the partial pension plan", async () => {
    await loadSampleData(db);
    const settings = await db
      .selectFrom("document")
      .select("value")
      .where("kind", "=", "settings")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(settings.value).zainetto).toEqual({
      amountCents: 40_000,
      expiry: 2029,
      goalId: "g-car",
    });
    const plan = await loadDocument(db, "pensionPlan", pensionPlanPartialSchema);
    expect(plan).toEqual({ goalId: "g-retirement", firstYear: 2020 });
  });

  it("refuses a second load and changes nothing", async () => {
    await loadSampleData(db);
    await expect(loadSampleData(db)).rejects.toMatchObject({ status: 409 });
    expect(await count(db, "product")).toBe(7);
    expect(await count(db, "goal")).toBe(4);
    expect(await count(db, "transaction")).toBe(13);
  });

  it("refuses when the database already holds a goal, and writes nothing", async () => {
    await db
      .insertInto("goal")
      .values({
        id: "mine",
        name: "Mine",
        priority: "Need",
        targetCents: 100,
        targetYear: 2030,
        contributionGrowth: 0,
        minProb: null,
        countsTowardFi: 0,
      })
      .execute();
    await expect(loadSampleData(db)).rejects.toBeInstanceOf(HttpError);
    expect(await count(db, "goal")).toBe(1);
    expect(await count(db, "product")).toBe(0);
  });

  it("refuses over a saved settings document and writes nothing", async () => {
    await saveDocument(db, "settings", { inflation: 0.03 });
    await expect(loadSampleData(db)).rejects.toMatchObject({ status: 409 });
    expect(await count(db, "product")).toBe(0);
    const settings = await db
      .selectFrom("document")
      .select("value")
      .where("kind", "=", "settings")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(settings.value)).toEqual({ inflation: 0.03 });
  });

  it("is reachable as POST /api/sample-data", async () => {
    const { startServer } = await import("./index.ts");
    const otherDir = mkdtempSync(join(tmpdir(), "gbi-sample-api-"));
    const server = await startServer({ dataDir: otherDir, port: 0 });
    try {
      const first = await fetch(`${server.url}/api/sample-data`, { method: "POST" });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ products: 7, goals: 4, transactions: 13 });
      const second = await fetch(`${server.url}/api/sample-data`, { method: "POST" });
      expect(second.status).toBe(409);
      const goals = (await (await fetch(`${server.url}/api/goals`)).json()) as unknown[];
      expect(goals).toHaveLength(4);
    } finally {
      await server.close();
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
