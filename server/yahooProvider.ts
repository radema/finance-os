import { z } from "zod";
import type { FetchedPrice, PriceProvider } from "../engine/priceFetch.ts";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const DAY_SECONDS = 86_400;

// The endpoint's answer, reduced to what is read. Unadjusted `close` only, never `adjclose`.
const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ currency: z.string().optional(), gmtoffset: z.number().default(0) }),
          timestamp: z.array(z.number()).default([]),
          indicators: z.object({
            quote: z.array(z.object({ close: z.array(z.number().nullable()) })),
          }),
        }),
      )
      .nullable(),
    error: z.object({ description: z.string().optional() }).nullable().optional(),
  }),
});

export interface YahooOptions {
  fetchImpl?: typeof fetch;
  /** Waits between retries. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock in ms, for the cache. */
  now?: () => number;
  attempts?: number;
  baseDelayMs?: number;
  cacheMs?: number;
  timeoutMs?: number;
}

const unix = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 1000;

/** Thrown for an answer that a retry cannot improve. */
class Permanent extends Error {}

/**
 * The v1 price provider: Yahoo's chart endpoint, for `.MI` tickers only, over plain `fetch`. It
 * asks for daily closes and returns them as Yahoo states them: no currency conversion, no
 * `repair`-style rescaling. Answers are cached for a few minutes; a failed request is retried with
 * a growing delay; every request has a time limit. Only the ticker and the dates leave the machine.
 *
 * @param options Test hooks and limits; the defaults are for the real endpoint.
 */
export function createYahooProvider({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  attempts = 3,
  baseDelayMs = 500,
  cacheMs = 15 * 60_000,
  timeoutMs = 10_000,
}: YahooOptions = {}): PriceProvider {
  const cache = new Map<string, { at: number; rows: FetchedPrice[] }>();

  async function request(ticker: string, from: string, to: string): Promise<FetchedPrice[]> {
    const url = `${CHART_URL}${encodeURIComponent(ticker)}?period1=${unix(from)}&period2=${unix(to) + DAY_SECONDS}&interval=1d`;
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 gbi" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = chartSchema.safeParse(body).data?.chart.error?.description;
      const message = `Yahoo answered ${response.status}${detail ? `: ${detail}` : ""}.`;
      // A client error other than "too many requests" says the request is wrong; a retry repeats it.
      throw response.status >= 400 && response.status < 500 && response.status !== 429
        ? new Permanent(message)
        : new Error(message);
    }
    const [result] = chartSchema.parse(await response.json()).chart.result ?? [];
    if (!result) throw new Permanent(`Yahoo returned no data for ${ticker}.`);
    const { currency, gmtoffset } = result.meta;
    if (!currency) throw new Permanent(`Yahoo gave no currency for ${ticker}.`);
    const closes = result.indicators.quote[0]?.close ?? [];
    return result.timestamp.flatMap((time, i) => {
      const close = closes[i];
      if (close === null || close === undefined) return [];
      // The exchange's calendar day: Milan closes at 17:30 local, far from midnight UTC.
      const date = new Date((time + gmtoffset) * 1000).toISOString().slice(0, 10);
      return [{ ticker, date, close, currency }];
    });
  }

  async function withRetry(ticker: string, from: string, to: string): Promise<FetchedPrice[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
      try {
        return await request(ticker, from, to);
      } catch (error) {
        if (error instanceof Permanent) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    async fetch(tickers, from, to) {
      const rows: FetchedPrice[] = [];
      for (const ticker of tickers) {
        if (!/\.MI$/i.test(ticker)) {
          throw new Error(`${ticker}: the Yahoo provider handles .MI tickers only.`);
        }
        const key = `${ticker}|${from}|${to}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < cacheMs) {
          rows.push(...hit.rows);
          continue;
        }
        const fresh = await withRetry(ticker, from, to);
        cache.set(key, { at: now(), rows: fresh });
        rows.push(...fresh);
      }
      return rows;
    },
  };
}
