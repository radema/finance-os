import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { registerCashImportRoutes } from "./cashImport.ts";
import { registerCashLedgerRoutes } from "./cashLedger.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { undoBatch } from "./importUndo.ts";
import { registerLedgerImportRoutes } from "./ledgerImport.ts";
import { registerOpeningPositionRoutes, saveOpeningPosition } from "./openingPosition.ts";
import { createRouter } from "./router.ts";

let db: Kysely<DB>;
let directory: string;
let router: ReturnType<typeof createRouter>;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "cash-import-"));
  db = await openDatabase(directory);
  await db
    .insertInto("goal")
    .values(
      ["g", "h"].map((id) => ({
        id,
        name: id,
        priority: "Need" as const,
        targetCents: 100_000,
        targetYear: 2035,
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
      name: "Synthetic fund",
      isin: "XX123",
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
  registerCashImportRoutes(router, db);
  registerLedgerImportRoutes(router, db);
  registerOpeningPositionRoutes(router, db);
  registerCashLedgerRoutes(router, db);
});
afterEach(async () => {
  await db.destroy();
  rmSync(directory, { recursive: true, force: true });
});

const call = async (path: string, body: unknown) => {
  const response = await router.handle(
    new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { rows?: number; skipped?: number; errors: string[] },
  };
};
const opening = (cashCents: number, units = 0) => ({
  asOf: "2026-01-01",
  positions: units
    ? [{ productId: "p", totalUnits: units, pmc: 10, parts: [{ goalId: "g", units }] }]
    : [],
  cashBalances: [
    { goalId: "g", amountCents: cashCents },
    { goalId: "h", amountCents: 0 },
  ],
});
const tradeText = (amount = "10.01") =>
  `sourceId,date,bucket,product,type,qty,price,commission,note,amount\nt1,2026-01-02,g,p,buy,1,10,0.05,synthetic,${amount}`;

it("imports canonical trades and cash once by sourceId, preserves gross cents and undo removes batch", async () => {
  await db.transaction().execute((trx) => saveOpeningPosition(trx, opening(2000)));
  const body = {
    text: tradeText(),
    cashText: "date,bucket,type,amount,toBucket,note,sourceId\n2026-01-02,g,fee,0.05,,fee,c1",
  };
  const first = await call("/api/import/ledger/commit", body);
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ rows: 2, skipped: 0 });
  const again = await call("/api/import/ledger/commit", body);
  expect(again.body).toMatchObject({ rows: 0, skipped: 2 });
  const trades = await db.selectFrom("transaction").selectAll().execute();
  const movements = await db.selectFrom("cashMovement").selectAll().execute();
  expect(trades).toHaveLength(1);
  expect(trades[0]?.amountCents).toBe(1001);
  const batchId = trades[0]?.importBatchId as string;
  expect(movements.filter((m) => m.importBatchId === batchId)).toHaveLength(1);
  expect(await db.selectFrom("importBatch").selectAll().execute()).toHaveLength(1);
  expect(
    (await call("/api/import/ledger/commit", { ...body, text: tradeText("10.02") })).status,
  ).toBe(400);
  await undoBatch(db, batchId);
  expect(await db.selectFrom("transaction").selectAll().execute()).toEqual([]);
  expect(
    (await db.selectFrom("cashMovement").selectAll().execute()).filter(
      (m) => m.importBatchId === batchId,
    ),
  ).toEqual([]);
  expect(await db.selectFrom("cashMovement").selectAll().execute()).toHaveLength(2);
});

it("rejects an unbacked import atomically and doesn't persist its batch or rows", async () => {
  const response = await call("/api/import/ledger/commit", { text: tradeText(), cashText: "" });
  expect(response.status).toBe(400);
  expect(await db.selectFrom("transaction").selectAll().execute()).toEqual([]);
  expect(await db.selectFrom("cashMovement").selectAll().execute()).toEqual([]);
  expect(await db.selectFrom("importBatch").selectAll().execute()).toEqual([]);
});

it("treats contributions as external cash and fees, taxes and income as non-contributions", async () => {
  const rows = [
    "date,bucket,type,amount,toBucket,note,sourceId",
    "2026-01-02,g,contribution,20,,external,a",
    "2026-01-02,g,fee,1,,broker,b",
    "2026-01-02,g,tax,2,,tax,c",
    "2026-01-02,g,income,3,,dividend,d",
  ].join("\n");
  expect((await call("/api/import/cash/commit", { text: rows })).status).toBe(200);
  const state = await router.handle(new Request("http://localhost/api/bucket-cash"));
  expect(await state.json()).toEqual([
    { goalId: "g", amountCents: 2000 },
    { goalId: "h", amountCents: 0 },
  ]);
});

it("previews and commits opening positions, while preview reports bad history", async () => {
  const ok = await call("/api/import/openings/preview", {
    text: "asOf,product,bucket,qty,pmc\n2026-01-01,p,g,1,10",
    cashText: "asOf,bucket,amount\n2026-01-01,g,20",
  });
  expect(ok.body).toMatchObject({ rows: 2, errors: [] });
  const committed = await call("/api/import/openings/commit", {
    text: "asOf,product,bucket,qty,pmc\n2026-01-01,p,g,1,10",
    cashText: "asOf,bucket,amount\n2026-01-01,g,20",
  });
  expect(committed.status).toBe(200);
});

it("opening preview catches underfunding of existing trade history", async () => {
  await db.transaction().execute((trx) => saveOpeningPosition(trx, opening(2000)));
  expect(
    (await call("/api/import/ledger/commit", { text: tradeText(), cashText: "" })).status,
  ).toBe(200);
  const bad = await call("/api/import/openings/preview", {
    text: "",
    cashText: "asOf,bucket,amount\n2026-01-01,g,0",
  });
  expect(bad.body.errors).toHaveLength(1);
});

it("rejects cash movements on or before the opening date in preview and commit", async () => {
  await db.transaction().execute((trx) => saveOpeningPosition(trx, opening(2000)));
  const text =
    "date,bucket,type,amount,toBucket,note,sourceId\n2026-01-01,g,contribution,10,,,cutoff";
  const preview = await call("/api/import/cash/preview", { text });
  expect(preview.body.errors.length).toBeGreaterThan(0);
  expect((await call("/api/import/cash/commit", { text })).status).toBe(400);
  expect(await db.selectFrom("cashMovement").selectAll().execute()).toHaveLength(2);
});

it("reports an unheld sale in preview without writing any rows", async () => {
  await db.transaction().execute((trx) => saveOpeningPosition(trx, opening(2000)));
  const text =
    "sourceId,date,bucket,product,type,qty,price,commission,note,amount\ns1,2026-01-02,g,p,sell,-1,10,0,sale,10";
  const preview = await call("/api/import/ledger/preview", { text, cashText: "" });
  expect(preview.body.errors.length).toBeGreaterThan(0);
  expect(await db.selectFrom("transaction").selectAll().execute()).toEqual([]);
});
