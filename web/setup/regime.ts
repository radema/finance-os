import type { AssetClass } from "../../engine/assetClasses.ts";
import type { REGIMES } from "../../engine/schemas.ts";

type Regime = (typeof REGIMES)[number];

/**
 * The tax regime usually held for an asset class (the table chosen in #71). A pension fund is a
 * wrapper, not a class, so "pension" is never suggested.
 */
const SUGGESTED: Record<AssetClass, Regime> = {
  Equity: "etf",
  "Govt bonds": "govt",
  "Corp bonds": "direct",
  "Multi-asset": "etf",
  Cash: "cash",
  "Gold/Commodities": "direct",
};

export const suggestRegime = (assetClass: string): Regime | undefined =>
  (SUGGESTED as Record<string, Regime>)[assetClass];

/** The regime to suggest, or undefined when it already fits or the product is a pension fund. */
export const regimeHint = (assetClass: string, regime: string): Regime | undefined => {
  const suggested = suggestRegime(assetClass);
  return suggested === regime || regime === "pension" ? undefined : suggested;
};
