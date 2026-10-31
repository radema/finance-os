import YahooFinance from "yahoo-finance2";
import type { FetchedPrice, PriceProvider } from "../engine/priceFetch.ts";

const DAY_SECONDS = 86_400;

/** The part of a `chart` answer that is read: daily quotes and the currency, in array form. */
export interface YahooChart {
  meta: { currency: string; gmtoffset: number };
  quotes: { date: Date; close: number | null }[];
}

/** Asks for the daily history of one symbol. `signal` aborts a request that hangs. */
export type ChartCall = (
  symbol: string,
  query: { period1: Date; period2: Date; interval: "1d" },
  signal: AbortSignal,
) => Promise<YahooChart>;

export interface YahooOptions {
  chart?: ChartCall;
  /** Waits between retries. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock in ms, for the cache. */
  now?: () => number;
  attempts?: number;
  baseDelayMs?: number;
  cacheMs?: number;
  timeoutMs?: number;
}

// The library client is made on the first fetch, so starting the app costs nothing.
function libraryChart(): ChartCall {
  let client: InstanceType<typeof YahooFinance> | undefined;
  return (symbol, query, signal) => {
    // The library has no `repair`-style rescaling in `chart`; none is requested here.
    client ??= new YahooFinance({ suppressNotices: ["yahooSurvey"], versionCheck: false });
    return client.chart(symbol, { ...query, return: "array" }, { fetchOptions: { signal } });
  };
}

/** An answer that a retry cannot improve. */
class Permanent extends Error {}

/** A client error other than "too many requests" says the request is wrong; a retry repeats it. */
const isPermanent = (error: unknown): boolean => {
  if (error instanceof Permanent) return true;
  const { name, code } = error as { name?: string; code?: unknown };
  if (name === "BadRequestError" || name === "InvalidOptionsError") return true;
  return (
    name === "HTTPError" && typeof code === "number" && code >= 400 && code < 500 && code !== 429
  );
};

/**
 * The v1 price provider: Yahoo through `yahoo-finance2`, for `.MI` tickers only. It asks for daily
 * closes and returns the raw `close` with Yahoo's currency code: no conversion, no adjusted close,
 * no rescaling. Answers are cached for a few minutes; a failed request is retried with a growing
 * delay; every request has a time limit. Only the ticker and the dates leave the machine.
 *
 * @param options Test hooks and limits; the defaults are for the real library.
 */
export function createYahooProvider({
  chart = libraryChart(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  attempts = 3,
  baseDelayMs = 500,
  cacheMs = 15 * 60_000,
  timeoutMs = 10_000,
}: YahooOptions = {}): PriceProvider {
  const cache = new Map<string, { at: number; rows: FetchedPrice[] }>();

  async function request(ticker: string, from: string, to: string): Promise<FetchedPrice[]> {
    const period2 = new Date(Date.parse(`${to}T00:00:00Z`) + DAY_SECONDS * 1000);
    const { meta, quotes } = await chart(
      ticker,
      { period1: new Date(`${from}T00:00:00Z`), period2, interval: "1d" },
      AbortSignal.timeout(timeoutMs),
    );
    if (!meta.currency) throw new Permanent(`Yahoo gave no currency for ${ticker}.`);
    return quotes.flatMap(({ date, close }) => {
      if (close === null) return [];
      // The exchange's calendar day: a Milan close is far from midnight UTC, but be exact.
      const day = new Date(date.getTime() + meta.gmtoffset * 1000).toISOString().slice(0, 10);
      return [{ ticker, date: day, close, currency: meta.currency }];
    });
  }

  async function withRetry(ticker: string, from: string, to: string): Promise<FetchedPrice[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
      try {
        return await request(ticker, from, to);
      } catch (error) {
        if (isPermanent(error)) throw error;
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
