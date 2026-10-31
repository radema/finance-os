import { addMonths } from "./months.ts";
import type { PRICE_SOURCES } from "./schemas.ts";

export interface PriceAge {
  old: boolean;
  /** A short sentence in plain words, for the tooltip of the freshness pill. */
  reason: string;
}

const MS_PER_DAY = 86_400_000;
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

/**
 * Whether the stored prices of a product are old. A `provider` product is old when its latest
 * close is more than `thresholdDays` before `asOf`. A `manual` or `csv` product is old only when
 * the month-end price of the month before `asOf` is missing. A product with no price is old.
 * An old price is a flag only: it is still used in every total.
 *
 * @param product The product's price source.
 * @param prices Stored prices of the product: month `YYYY-MM` and price date `YYYY-MM-DD`.
 * @param asOf The app clock, `YYYY-MM-DD`.
 * @param thresholdDays The "daily price age" setting.
 */
export function priceAge(
  product: { priceSource: (typeof PRICE_SOURCES)[number] },
  prices: readonly { month: string; priceDate: string }[],
  asOf: string,
  thresholdDays: number,
): PriceAge {
  if (prices.length === 0) return { old: true, reason: "No price is stored." };

  if (product.priceSource === "provider") {
    const latest = prices
      .map((p) => p.priceDate)
      .sort()
      .at(-1) as string;
    const days = daysBetween(latest, asOf);
    return {
      old: days > thresholdDays,
      reason: `Latest close is ${days} ${days === 1 ? "day" : "days"} old; the limit is ${thresholdDays}.`,
    };
  }

  const previous = addMonths(asOf.slice(0, 7), -1);
  const present = prices.some((p) => p.month === previous);
  return {
    old: !present,
    reason: `The ${previous} month-end price is ${present ? "stored" : "missing"}.`,
  };
}
