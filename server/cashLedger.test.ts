import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openingPositionInputSchema } from "../engine/schemas.ts";
import { loadCashState, registerCashLedgerRoutes } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { registerGoalRoutes } from "./goals.ts";
import { undoBatch } from "./importUndo.ts";
import { registerOpeningPositionRoutes, saveOpeningPosition } from "./openingPosition.ts";
import { createRouter } from "./router.ts";
import { registerTransactionRoutes } from "./transactions.ts";

let db: Kysely<DB>;
let directory: string;
let router: ReturnType<typeof createRouter>;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "cash-ledger-"));
  db = await openDatabase(directory);
  await db
    .insertInto("goal")
    .values(
      ["g", "h"].map((id) => ({
        id,
        name: id,
        priority: "Need" as const,
        targetCents: 100,
        targetYear: 2030,
        contributionGrowth: 0,
        minProb: null,
        countsTowardFi: 0 as const,
      })),
    )
    .execute();
  await db
    .insertInto("product")
    .values({
      id: "p",
      name: "ETF",
      isin: "",
      assetClass: "Equity",
      regime: "etf",
      whiteListShare: 0,
      expReturn: 0,
      volatility: 0,
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
  router = createRouter();
  registerCashLedgerRoutes(router, db);
  registerTransactionRoutes(router, db, () => "2026-01-01");
  registerOpeningPositionRoutes(router, db);
  registerGoalRoutes(router, db);
});
afterEach(async () => {
  await db.destroy();
  rmSync(directory, { recursive: true, force: true });
});
const call = (method: string, path: string, body?: unknown) =>
  router.handle(
    new Request(`http://localhost${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
const buy = {
  date: "2026-01-02",
  goalId: "g",
  productId: "p",
  type: "buy",
  amountCents: 1000,
  price: 10,
  commissionCents: 10,
};
it("keeps legacy note edits compatible but requires funding for accounting changes", async () => {
  const added = await (
    await call("POST", "/api/transactions", { ...buy, confirmFunding: true })
  ).json();
  await db.deleteFrom("cashMovement").execute();
  await db.insertInto("legacyTransaction").values({ id: added.id }).execute();
  expect(
    (await call("PUT", "/api/transactions", { ...buy, id: added.id, note: "updated note" })).status,
  ).toBe(200);
  const changed = { ...buy, id: added.id, amountCents: 2000 };
  expect((await call("PUT", "/api/transactions", changed)).status).toBe(409);
  expect(await db.selectFrom("legacyTransaction").selectAll().execute()).toHaveLength(1);
  expect(
    (await db.selectFrom("transaction").selectAll().executeTakeFirstOrThrow()).amountCents,
  ).toBe(1000);
  expect(
    (await call("PUT", "/api/transactions", { ...changed, confirmFunding: true })).status,
  ).toBe(200);
  expect(await db.selectFrom("legacyTransaction").selectAll().execute()).toEqual([]);
  expect((await loadCashState(db)).inferredFunding).toEqual([]);
});

it("archives only empty buckets, preserves history and allows reopening", async () => {
  const contribution = await (
    await call("POST", "/api/cash-movements", {
      date: "2026-01-01",
      goalId: "g",
      type: "contribution",
      amountCents: 100,
    })
  ).json();
  expect((await call("POST", "/api/goals/archive", { id: "g", archived: true })).status).toBe(409);
  await call("POST", "/api/cash-movements", {
    date: "2026-01-02",
    goalId: "g",
    type: "withdrawal",
    amountCents: 100,
  });
  expect((await call("POST", "/api/goals/archive", { id: "g", archived: true })).status).toBe(200);
  expect(
    (await (await call("GET", "/api/goals")).json()).map((goal: { id: string }) => goal.id),
  ).toEqual(["h"]);
  expect(
    await db.selectFrom("cashMovement").selectAll().where("id", "=", contribution.id).execute(),
  ).toHaveLength(1);
  expect((await call("POST", "/api/transactions", { ...buy, confirmFunding: true })).status).toBe(
    409,
  );
  expect((await call("POST", "/api/goals/archive", { id: "g", archived: false })).status).toBe(200);
  expect(await (await call("GET", "/api/goals")).json()).toHaveLength(2);
});
it("requires explicit exact-shortfall funding and commits cash and buy atomically", async () => {
  let response = await call("POST", "/api/transactions", buy);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("1010 cents");
  expect(await db.selectFrom("transaction").selectAll().execute()).toEqual([]);
  response = await call("POST", "/api/transactions", { ...buy, confirmFunding: true });
  expect(response.status).toBe(200);
  const cash = await db.selectFrom("cashMovement").selectAll().execute();
  expect(cash).toHaveLength(1);
  expect(cash[0]?.amountCents).toBe(1010);
  expect((await call("DELETE", `/api/cash-movements?id=${cash[0]?.id}`)).status).toBe(409);
});
it("rolls back an opening replacement that breaks subsequent trades", async () => {
  const initial = openingPositionInputSchema.parse({
    asOf: "2026-01-01",
    positions: [],
    cashBalances: [{ goalId: "g", amountCents: 1010 }],
  });
  await db.transaction().execute((trx) => saveOpeningPosition(trx, initial));
  expect((await call("POST", "/api/transactions", buy)).status).toBe(200);
  expect(
    (
      await call("PUT", "/api/opening-position", {
        ...initial,
        cashBalances: [{ goalId: "g", amountCents: 500 }],
      })
    ).status,
  ).toBe(409);
  const opening = await (await call("GET", "/api/opening-position")).json();
  expect(opening.cashBalances).toEqual(initial.cashBalances);
});
it("rejects transfer overdrafts and funding deletion with future dependencies", async () => {
  const contribution = await (
    await call("POST", "/api/cash-movements", {
      date: "2026-01-01",
      goalId: "g",
      type: "contribution",
      amountCents: 1010,
    })
  ).json();
  expect((await call("POST", "/api/transactions", buy)).status).toBe(200);
  expect(
    (
      await call("POST", "/api/cash-movements", {
        date: "2026-01-03",
        goalId: "g",
        toGoalId: "h",
        type: "transfer",
        amountCents: 1,
      })
    ).status,
  ).toBe(409);
  expect((await call("DELETE", `/api/cash-movements?id=${contribution.id}`)).status).toBe(409);
  expect(await db.selectFrom("cashMovement").selectAll().execute()).toHaveLength(1);
});
it("keeps opening rows managed only by Current portfolio", async () => {
  expect((await call("POST", "/api/transactions", { ...buy, type: "opening" })).status).toBe(400);
  await call("POST", "/api/opening-position", {
    asOf: "2026-01-01",
    positions: [{ productId: "p", totalUnits: 1, pmc: 10, parts: [{ goalId: "g", units: 1 }] }],
  });
  const row = await db.selectFrom("transaction").selectAll().executeTakeFirstOrThrow();
  expect((await call("DELETE", `/api/transactions?id=${row.id}`)).status).toBe(409);
  expect((await call("PUT", "/api/transactions", { ...buy, id: row.id })).status).toBe(409);
});

it("marks pre-migration trades as legacy without rewriting their original rows", async () => {
  await db
    .insertInto("transaction")
    .values({
      id: "old",
      date: "2024-01-01",
      goalId: "g",
      productId: "p",
      type: "buy",
      qtyScaled: 1_000_000,
      priceScaled: 10_000_000,
      amountCents: 1000,
      commissionCents: 10,
      note: "preserve me",
      flow: null,
      importBatchId: null,
    })
    .execute();
  const before = await db.selectFrom("transaction").selectAll().execute();
  await db.destroy();
  const raw = new DatabaseSync(join(directory, "gbi.sqlite"));
  raw.exec(
    "DROP TABLE cash_movement; DROP TABLE legacy_transaction; ALTER TABLE goal DROP COLUMN archived; DELETE FROM kysely_migration WHERE name = '005-bucket-cash'",
  );
  raw.close();
  db = await openDatabase(directory);
  expect(await db.selectFrom("transaction").selectAll().execute()).toEqual(before);
  const state = await loadCashState(db);
  expect(state.balances.get("g")).toBe(0);
  expect(state.inferredFunding[0]?.amountCents).toBe(1010);
});

it("rolls back import undo when later cash depends on its sale proceeds", async () => {
  await call("POST", "/api/opening-position", {
    asOf: "2026-01-01",
    positions: [{ productId: "p", totalUnits: 1, pmc: 10, parts: [{ goalId: "g", units: 1 }] }],
  });
  await db
    .insertInto("importBatch")
    .values({
      id: "batch",
      kind: "transactions",
      sourceName: "CSV",
      fileName: "sale.csv",
      createdAt: "2026-01-02",
      rowsRead: 1,
      rowsImported: 1,
      rowsSkipped: 0,
      undoneAt: null,
      priorPrices: null,
      createdIds: null,
    })
    .execute();
  await db
    .insertInto("transaction")
    .values({
      id: "sale",
      date: "2026-01-02",
      goalId: "g",
      productId: "p",
      type: "sell",
      qtyScaled: -1_000_000,
      priceScaled: 10_000_000,
      commissionCents: null,
      amountCents: 1000,
      note: "",
      importBatchId: "batch",
      flow: null,
    })
    .execute();
  expect(
    (
      await call("POST", "/api/cash-movements", {
        date: "2026-01-03",
        goalId: "g",
        type: "withdrawal",
        amountCents: 1000,
      })
    ).status,
  ).toBe(200);
  await expect(undoBatch(db, "batch")).rejects.toThrow(/1000 cents/);
  expect(
    await db.selectFrom("transaction").selectAll().where("id", "=", "sale").executeTakeFirst(),
  ).toBeDefined();
  expect(
    (await db.selectFrom("importBatch").selectAll().where("id", "=", "batch").executeTakeFirst())
      ?.undoneAt,
  ).toBeNull();
});
