import { describe, expect, it } from "vitest";
import { createYahooProvider } from "./yahooProvider.ts";

/** A chart answer in the shape Yahoo's chart endpoint uses. Times are UTC seconds; `gmtoffset` is Milan's. */
const chart = (over: { currency?: string; closes?: (number | null)[]; times?: number[] } = {}) => ({
  chart: {
    error: null,
    result: [
      {
        meta: { currency: over.currency ?? "EUR", gmtoffset: 3600 },
        timestamp: over.times ?? [Date.UTC(2026, 1, 27, 8) / 1000, Date.UTC(2026, 2, 13, 8) / 1000],
        indicators: {
          quote: [{ close: over.closes ?? [101.5, 103.25] }],
          adjclose: [{ adjclose: [1, 2] }],
        },
      },
    ],
  },
});

const harness = (answers: (Response | Error)[]) => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const queue = [...answers];
  const provider = createYahooProvider({
    fetchImpl: async (input) => {
      calls.push(String(input));
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

describe("Yahoo provider", () => {
  it("returns the raw close and the currency per trading day, never the adjusted close", async () => {
    const { provider, calls } = harness([Response.json(chart())]);
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toEqual([
      { ticker: "VWCE.MI", date: "2026-02-27", close: 101.5, currency: "EUR" },
      { ticker: "VWCE.MI", date: "2026-03-13", close: 103.25, currency: "EUR" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/VWCE.MI?");
    expect(calls[0]).toContain("interval=1d");
  });

  it("reports the currency as Yahoo states it, without converting", async () => {
    const { provider } = harness([Response.json(chart({ currency: "GBp", closes: [1, 2] }))]);
    const rows = await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    expect(rows.map((r) => [r.close, r.currency])).toEqual([
      [1, "GBp"],
      [2, "GBp"],
    ]);
  });

  it("dates a close in the exchange's day, not UTC", async () => {
    const lateEvening = Date.UTC(2026, 2, 13, 23, 30) / 1000;
    const { provider } = harness([Response.json(chart({ times: [lateEvening], closes: [5] }))]);
    const [row] = await provider.fetch(["VWCE.MI"], "2026-03-01", "2026-03-15");
    expect(row?.date).toBe("2026-03-14");
  });

  it("skips a day without a close", async () => {
    const { provider } = harness([Response.json(chart({ closes: [null, 103.25] }))]);
    const rows = await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15");
    expect(rows.map((r) => r.close)).toEqual([103.25]);
  });

  it("answers from the cache for the same request, and asks again for another range", async () => {
    const { provider, calls } = harness([Response.json(chart()), Response.json(chart())]);
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
      Response.json(chart()),
    ]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow("down");
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toHaveLength(2);
    expect(calls).toHaveLength(4);
  });

  it("retries with a growing delay on a network error and on a 5xx answer", async () => {
    const { provider, calls, sleeps } = harness([
      new Error("socket hang up"),
      new Response("busy", { status: 503 }),
      Response.json(chart()),
    ]);
    expect(await provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries a 429, then gives up with the last error", async () => {
    const { provider, calls } = harness([
      new Response("", { status: 429 }),
      new Response("", { status: 429 }),
      new Response("", { status: 429 }),
    ]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow(/429/);
    expect(calls).toHaveLength(3);
  });

  it("does not retry an unknown ticker", async () => {
    const { provider, calls } = harness([
      Response.json(
        { chart: { result: null, error: { code: "Not Found", description: "No data found" } } },
        { status: 404 },
      ),
    ]);
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
    const body = chart();
    // biome-ignore lint/style/noNonNullAssertion: the fixture above always has one result
    (body.chart.result[0]!.meta as { currency?: string }).currency = undefined;
    const { provider } = harness([Response.json(body)]);
    await expect(provider.fetch(["VWCE.MI"], "2026-02-01", "2026-03-15")).rejects.toThrow(
      /currency/,
    );
  });
});
