import { describe, expect, it } from "vitest";
import type { YahooChart } from "./yahooProvider.ts";
import { createYahooProvider } from "./yahooProvider.ts";

const at = (y: number, m: number, d: number, hour = 8) => new Date(Date.UTC(y, m - 1, d, hour));

/** A chart answer in the library's array form. `gmtoffset` is Milan's, in seconds. */
const chart = (
  over: { currency?: string; quotes?: { date: Date; close: number | null }[] } = {},
): YahooChart => ({
  meta: { currency: over.currency ?? "EUR", gmtoffset: 3600 },
  quotes: over.quotes ?? [
    { date: at(2026, 2, 27), close: 101.5 },
    { date: at(2026, 3, 13), close: 103.25 },
  ],
});

/** A library stand-in that answers from a queue; an `Error` entry is thrown. */
const harness = (answers: (YahooChart | Error)[]) => {
  const calls: { symbol: string; period1: Date; period2: Date; interval: string }[] = [];
  const sleeps: number[] = [];
  const queue = [...answers];
  const provider = createYahooProvider({
    chart: async (symbol, query, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      calls.push({ symbol, ...query });
      const next = queue.shift() ?? new Error("no answer left");
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 1_000_000,
  });
  return { provider, calls, sleeps };
};
const httpError = (code: number, message = "failed") =>
  Object.assign(new Error(message), { name: "HTTPError", code });

describe("Yahoo provider", () => {
  it("returns the raw close and the currency per trading day", async () => {
    const { provider, calls } = harness([chart()]);
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toEqual([
      { ticker: "VWCE.MI", date: "2026-02-27", close: 101.5, currency: "EUR" },
      { ticker: "VWCE.MI", date: "2026-03-13", close: 103.25, currency: "EUR" },
    ]);
    expect(calls).toEqual([
      {
        symbol: "VWCE.MI",
        period1: at(2026, 2, 1, 0),
        period2: at(2026, 3, 16, 0),
        interval: "1d",
      },
    ]);
  });

  it("reports the currency as Yahoo states it, without converting", async () => {
    const { provider } = harness([
      chart({
        currency: "GBp",
        quotes: [
          { date: at(2026, 3, 12), close: 1 },
          { date: at(2026, 3, 13), close: 2 },
        ],
      }),
    ]);
    const rows = await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    expect(rows.map((r) => [r.close, r.currency])).toEqual([
      [1, "GBp"],
      [2, "GBp"],
    ]);
  });

  it("dates a close in the exchange's day, not UTC", async () => {
    const { provider } = harness([chart({ quotes: [{ date: at(2026, 3, 13, 23), close: 5 }] })]);
    const [row] = await provider.fetch(["VWCE.MI"], "2026-03-01", "2026-03-15");
    expect(row?.date).toBe("2026-03-14");
  });

  it("skips a day without a close", async () => {
    const { provider } = harness([
      chart({
        quotes: [
          { date: at(2026, 2, 27), close: null },
          { date: at(2026, 3, 13), close: 103.25 },
        ],
      }),
    ]);
    const rows = await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    expect(rows.map((r) => r.close)).toEqual([103.25]);
  });

  it("answers from the cache for the same request, and asks again for another range", async () => {
    const { provider, calls } = harness([chart(), chart()]);
    await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    expect(calls).toHaveLength(1);
    await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-16");
    expect(calls).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    const { provider, calls } = harness([
      new Error("down"),
      new Error("down"),
      new Error("down"),
      chart(),
    ]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow("down");
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toHaveLength(2);
    expect(calls).toHaveLength(4);
  });

  it("retries with a growing delay on a network error and on a 5xx answer", async () => {
    const { provider, calls, sleeps } = harness([
      new Error("socket hang up"),
      httpError(503, "busy"),
      chart(),
    ]);
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries a 429, then gives up with the last error", async () => {
    const { provider, calls } = harness([httpError(429), httpError(429), httpError(429)]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow("failed");
    expect(calls).toHaveLength(3);
  });

  it("does not retry a client error", async () => {
    const { provider, calls } = harness([httpError(404, "No data found")]);
    await expect(provider.fetch(["XXXX.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow(
      /No data found/,
    );
    expect(calls).toHaveLength(1);
  });

  it("refuses a ticker that is not a .MI ETF, without a request", async () => {
    const { provider, calls } = harness([]);
    await expect(provider.fetch(["AAPL"], "2026-02-01", "2026-03-15")).rejects.toThrow(/\.MI/);
    expect(calls).toEqual([]);
  });

  it("fails on an answer without a currency, because EUR cannot be checked", async () => {
    const { provider } = harness([chart({ currency: "" })]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow(
      /currency/,
    );
  });
});
