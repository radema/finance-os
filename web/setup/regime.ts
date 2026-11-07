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

/** The product fields that only some regimes use. */
export interface RegimeFields {
  whiteListShare: boolean;
  couponRate: boolean;
  maturity: boolean;
}

/**
 * Which of the regime-specific fields apply. The engine reads the coupon of a government bond only,
 * and the white-list share of an ETF only. R3 alerts on the maturity of any held product, but only
 * bonds have one: government bonds and direct holdings (corporate bonds).
 */
export const regimeFields = (regime: string): RegimeFields => ({
  whiteListShare: regime === "etf",
  couponRate: regime === "govt",
  maturity: regime === "govt" || regime === "direct",
});

/** The form values of the regime-specific fields, as the product schema defaults them. */
const DEFAULTS = { whiteListShare: "0", couponRate: "0", maturity: "" };

/** The form with every field its regime hides back at its default, so no hidden value is saved. */
export const resetHiddenFields = <
  T extends { regime: string; whiteListShare: string; couponRate: string; maturity: string },
>(
  form: T,
): T => {
  const shown = regimeFields(form.regime);
  return {
    ...form,
    ...(shown.whiteListShare ? {} : { whiteListShare: DEFAULTS.whiteListShare }),
    ...(shown.couponRate ? {} : { couponRate: DEFAULTS.couponRate }),
    ...(shown.maturity ? {} : { maturity: DEFAULTS.maturity }),
  };
};
