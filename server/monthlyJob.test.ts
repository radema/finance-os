import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PriceProvider } from "../engine/priceFetch.ts";
import type { Settings } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import type { MonthlyJobStatus } from "./monthlyJob.ts";

// The sample data has prices to 2026-10 and four goals. The app first runs on 2026-10-31.
const NEW_MONTH = "2026-11-03";
const STUB_PRODUCT = {
  id: "stub",
  name: "Stub ETF",
  ticker: "STUB.MI",
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

describe("Monthly job", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;
  let db: Kysely<DB>;
  let calls: { savedBefore: string[] }[];
  let failing: boolean;

  /** Answers a month-end close for October, and records which months were saved at call time. */
  const provider: PriceProvider = {
    async fetch(tickers) {
      const saved = await db
        .selectFrom("snapshot")
        .select("month")
        .where("source", "=", "saved")
        .execute();
      calls.push({ savedBefore: saved.map((row) => row.month) });
      if (failing) throw new Error("provider is down");
      return tickers.map((ticker) => ({
        ticker,
        date: "2026-10-30",
        close: 100,
        currency: "EUR",
      }));
    },
  };

  const shutdown = async () => {
    const close = stop;
    stop = undefined;
    await close?.();
  };
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const start = async (today: string) => {
    const server = await startServer({ dataDir, port: 0, today, priceProvider: provider });
    stop = server.close;
    url = server.url;
  };
  const status = async () => (await call<MonthlyJobStatus>("GET", "/api/jobs/monthly")).body;
  /** The start-up job runs after the listener is up, so wait until it has recorded a run. */
  const startupRun = async (date: string) => {
    for (let i = 0; i < 200; i++) {
      const current = await status();
      if (current.lastRunDate === date) return current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the start-up job did not finish");
  };
  const savedMonths = async () =>
    (await db.selectFrom("snapshot").select("month").where("source", "=", "saved").execute()).map(
      (row) => row.month,
    );

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-monthly-"));
    calls = [];
    failing = false;
    // First run: sample data and a provider product. This start is not in a new month, so it has
    // nothing to run: the sample data does not exist yet when it starts.
    await start("2026-10-31");
    await call("POST", "/api/sample-data");
    const settings = (await call<Settings>("GET", "/api/settings")).body;
    await call("PUT", "/api/settings", { ...settings, trackingStart: "2026-09" });
    await shutdown();
    db = await openDatabase(dataDir);
    await db.insertInto("product").values(STUB_PRODUCT).execute();
  });
  afterEach(async () => {
    await shutdown();
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("fetches prices before it saves the previous month, on the first start of a new month", async () => {
    await start(NEW_MONTH);
    const run = await startupRun(NEW_MONTH);
    expect(run).toMatchObject({ lastRunDate: NEW_MONTH, lastRunFailed: false });
    expect(calls).toHaveLength(1);
    // At the time of the provider call, October was not saved yet; after the job it is.
    expect(calls[0]?.savedBefore).not.toContain("2026-10");
    expect(await savedMonths()).toContain("2026-10");
    const price = await db
      .selectFrom("pricePoint")
      .select("source")
      .where("productId", "=", "stub")
      .where("month", "=", "2026-10")
      .executeTakeFirst();
    expect(price?.source).toBe("provider");
  });

  it("does not run again on a later start in the same month", async () => {
    await start(NEW_MONTH);
    await startupRun(NEW_MONTH);
    await shutdown();
    await start("2026-11-20");
    // Closing the server waits for a start-up job, so a job that was going to run has run by now.
    await shutdown();
    expect(calls).toHaveLength(1);
  });

  it("runs a manual trigger once a day, and again after a failed run", async () => {
    failing = true;
    await start(NEW_MONTH);
    expect(await startupRun(NEW_MONTH)).toMatchObject({ lastRunFailed: true });
    expect(calls).toHaveLength(1);

    // The last run failed, so the trigger runs.
    const failed = await call("POST", "/api/jobs/monthly/run");
    expect(failed.body).toMatchObject({ ran: true, failed: true });
    expect(calls).toHaveLength(2);

    failing = false;
    const retried = await call("POST", "/api/jobs/monthly/run");
    expect(retried.body).toMatchObject({ ran: true, failed: false });
    expect(calls).toHaveLength(3);
    expect(await status()).toMatchObject({ lastRunDate: NEW_MONTH, lastRunFailed: false });

    // The last run worked and ran today, so the trigger does nothing.
    const blocked = await call("POST", "/api/jobs/monthly/run");
    expect(blocked.body).toEqual({ ran: false, reason: "already ran today" });
    expect(calls).toHaveLength(3);
  });

  it("keeps the app responding and reports failed when the provider fails", async () => {
    failing = true;
    await start(NEW_MONTH);
    const run = await startupRun(NEW_MONTH);
    expect(run).toMatchObject({ lastRunDate: NEW_MONTH, lastRunFailed: true });
    expect((await call("GET", "/api/health")).status).toBe(200);
    expect((await call("GET", "/api/snapshots")).status).toBe(200);
    // No month-end price came in, so nothing was saved: the previous month waits for a retry.
    expect(await savedMonths()).not.toContain("2026-10");
    // The start-up job tries again on the next start of the same month.
    await shutdown();
    failing = false;
    await start("2026-11-04");
    expect(await startupRun("2026-11-04")).toMatchObject({
      lastRunDate: "2026-11-04",
      lastRunFailed: false,
    });
    expect(await savedMonths()).toContain("2026-10");
  });
});
