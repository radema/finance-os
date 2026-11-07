// A CSV template per import kind: the header row is the importer's own column list, plus one row of
// made-up data. Built at run time, so the headers are defined once. Pure: no I/O.
import type { TransactionField } from "./importMapping.ts";
import { TRANSACTION_FIELDS } from "./importMapping.ts";
import { PRICE_LONG_COLUMNS } from "./priceCsv.ts";
import type { GoalField, ProductField } from "./recordImport.ts";
import { GOAL_FIELDS, PRODUCT_FIELDS } from "./recordImport.ts";

/** The ISIN of the made-up product that the example rows use. */
export const EXAMPLE_ISIN = "IE00EXAMPLE01";

// Rates are percent and money is euros, as the importers read them. A blank cell keeps the default.
const TRANSACTION_EXAMPLE: Record<TransactionField, string> = {
  date: "2025-01-15",
  bucket: "",
  product: EXAMPLE_ISIN,
  type: "buy",
  qty: "10",
  price: "85.5",
  commission: "2.95",
  note: "example row",
};

const PRICE_EXAMPLE: Record<(typeof PRICE_LONG_COLUMNS)[number], string> = {
  date: "2025-01-31",
  product: EXAMPLE_ISIN,
  price: "85.5",
};

const PRODUCT_EXAMPLE: Record<ProductField, string> = {
  name: "Example World ETF",
  isin: EXAMPLE_ISIN,
  assetClass: "Equity",
  regime: "etf",
  whiteListShare: "0",
  expReturn: "5",
  volatility: "15",
  ter: "0.2",
  maturity: "",
  couponRate: "0",
  zeroCommission: "no",
  priceSource: "manual",
  ticker: "EXWRLD",
};

const GOAL_EXAMPLE: Record<GoalField, string> = {
  name: "Example holiday",
  priority: "Want",
  target: "5000",
  targetYear: "2032",
  contributionGrowth: "2",
  minProb: "80",
  countsTowardFi: "no",
};

export type TemplateKind = "transactions" | "prices" | "products" | "goals";

const COLUMNS: Record<
  TemplateKind,
  { columns: readonly string[]; example: Record<string, string> }
> = {
  transactions: { columns: TRANSACTION_FIELDS, example: TRANSACTION_EXAMPLE },
  prices: { columns: PRICE_LONG_COLUMNS, example: PRICE_EXAMPLE },
  products: { columns: PRODUCT_FIELDS, example: PRODUCT_EXAMPLE },
  goals: { columns: GOAL_FIELDS, example: GOAL_EXAMPLE },
};

/**
 * The CSV text of the template of one import kind: a header row and one example row, comma
 * separated, point decimals, ISO dates.
 *
 * @param kind The import kind.
 */
export function importTemplate(kind: TemplateKind): string {
  const { columns, example } = COLUMNS[kind];
  return `${columns.join(",")}\n${columns.map((column) => example[column]).join(",")}\n`;
}
