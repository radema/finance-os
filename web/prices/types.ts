import type { Regime } from "../../engine/holdings.ts";
import type { PriceAge } from "../../engine/priceAge.ts";
import type { PRICE_SOURCES } from "../../engine/schemas.ts";

export type PriceSource = (typeof PRICE_SOURCES)[number];

/** A stored price as `GET /api/prices/grid` returns it: quoted, so a BTP is per 100. */
export interface GridPrice {
  price: number;
  source: PriceSource;
  priceDate: string;
}

export interface Grid {
  /** The month of the app clock; this month and later ones are editable. */
  currentMonth: string;
  months: string[];
  rows: {
    productId: string;
    name: string;
    regime: Regime;
    priceSource: PriceSource;
    prices: Record<string, GridPrice>;
  }[];
}

export interface PriceOverviewRow {
  productId: string;
  name: string;
  regime: Regime;
  priceSource: PriceSource;
  lastPrice: { price: number; priceDate: string } | null;
  age: PriceAge;
  brokerUnits: number | null;
  brokerUnitsDate: string | null;
}

export interface ImportResult {
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  unknownProducts: string[];
}

export type FetchProblemReason = "provider-error" | "non-eur" | "move-above-25";

/** A fetched price held back for the user's decision, as `GET /api/prices/review` returns it. */
export interface ReviewItem {
  id: string;
  productId: string;
  productName: string;
  ticker: string;
  date: string;
  /** In `currency`, as the provider gave it. */
  price: number;
  currency: string;
  reason: Exclude<FetchProblemReason, "provider-error">;
}

export interface ReviewState {
  items: ReviewItem[];
  problems: { productId: string; reason: FetchProblemReason }[];
  errors: { productId: string; productName: string; message: string }[];
}

export interface FetchResult {
  stored: unknown[];
  reviewed: unknown[];
  problems: unknown[];
}
