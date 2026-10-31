// Fetched prices: the provider interface, the month-end close, and the check before a price is stored.
import { latestPerMonth } from "./priceCsv.ts";

/** One close as a provider reports it. `date` is `YYYY-MM-DD`; `currency` is the provider's code. */
export interface FetchedPrice {
  ticker: string;
  date: string;
  close: number;
  currency: string;
}

export interface PriceProvider {
  /** Closes of the tickers between two dates (`YYYY-MM-DD`), one row per ticker and trading day. */
  fetch(tickers: readonly string[], from: string, to: string): Promise<FetchedPrice[]>;
}

/** Why a fetched price is held back, or why a product has a fetch problem. */
export type FetchProblemReason = "provider-error" | "non-eur" | "move-above-25";

/** The largest move versus the previous month, in percent, that is stored without a review. */
const MAX_MOVE_PERCENT = 25;

/**
 * Decides whether a fetched price is stored or goes to the review list.
 *
 * @param price The price in scaled units, its currency, and the previous month's stored price
 *   (null when there is none, which skips the move check).
 * @returns `non-eur`, `move-above-25`, or null when the price may be stored.
 */
export function classifyFetchedPrice({
  currency,
  priceScaled,
  previousScaled,
}: {
  currency: string;
  priceScaled: number;
  previousScaled: number | null;
}): "non-eur" | "move-above-25" | null {
  if (currency !== "EUR") return "non-eur";
  if (previousScaled === null) return null;
  // Integers only, so a move of exactly 25% is never pushed over the line by float error.
  const move = Math.abs(priceScaled - previousScaled) * 100;
  return move > previousScaled * MAX_MOVE_PERCENT ? "move-above-25" : null;
}

/** The last trading day of each month, per ticker, oldest first. The current month holds the latest close. */
export function monthEndCloses(rows: readonly FetchedPrice[]): FetchedPrice[] {
  return latestPerMonth(rows, (row) => row.ticker).sort((a, b) => a.date.localeCompare(b.date));
}
