/** The six fixed asset classes, in the order of the correlation matrix. */
export const ASSET_CLASSES = [
  "Equity",
  "Govt bonds",
  "Corp bonds",
  "Multi-asset",
  "Cash",
  "Gold/Commodities",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];
