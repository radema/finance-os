// Typed Kysely schema. Property names are camelCase; the CamelCasePlugin maps them to the
// snake_case columns of the migrations. `*Cents` columns are integer cents, `*Scaled` columns are
// integers scaled by 10^6 (see engine/units.ts). Booleans are 0 | 1.
import type { Regime, TransactionType } from "../engine/holdings.ts";
import type { PensionFlow } from "../engine/schemas.ts";

type Flag = 0 | 1;

export const toFlag = (value: boolean): Flag => (value ? 1 : 0);
type PriceSource = "provider" | "csv" | "manual";
type ImportKind = "transactions" | "prices" | "products" | "goals";

export interface ProductTable {
  id: string;
  name: string;
  isin: string;
  assetClass: "Equity" | "Govt bonds" | "Corp bonds" | "Multi-asset" | "Cash" | "Gold/Commodities";
  regime: Regime;
  whiteListShare: number;
  expReturn: number;
  volatility: number;
  ter: number;
  /** `YYYY-MM`. */
  maturity: string | null;
  couponRate: number;
  zeroCommission: Flag;
  priceSource: PriceSource;
  ticker: string;
  brokerUnitsScaled: number | null;
  brokerUnitsDate: string | null;
}

export interface PricePointTable {
  productId: string;
  /** `YYYY-MM`. */
  month: string;
  priceScaled: number;
  /** `YYYY-MM-DD`: the date of the close. */
  priceDate: string;
  source: PriceSource;
  fetchedAt: string;
  importBatchId: string | null;
}

export interface GoalTable {
  id: string;
  name: string;
  priority: "Need" | "Want" | "Wish";
  /** Today's euros. */
  targetCents: number;
  targetYear: number;
  contributionGrowth: number;
  minProb: number | null;
  countsTowardFi: Flag;
}

export interface ContributionPlanTable {
  goalId: string;
  /** `YYYY-MM`. */
  fromMonth: string;
  monthlyCents: number;
}

export interface AllocationWeightTable {
  goalId: string;
  productId: string;
  weight: number;
}

export interface TransactionTable {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  goalId: string;
  productId: string;
  type: TransactionType;
  /** Signed: a sell is negative; 0 for a coupon. */
  qtyScaled: number;
  priceScaled: number;
  commissionCents: number | null;
  amountCents: number;
  note: string;
  importBatchId: string | null;
  /** `pensionContribution` only. */
  flow: PensionFlow["flow"] | null;
}

export interface ImportBatchTable {
  id: string;
  kind: ImportKind;
  sourceName: string;
  fileName: string;
  createdAt: string;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  undoneAt: string | null;
  /** JSON: the prior state of the prices this batch overwrote. */
  priorPrices: string | null;
  /** JSON: the ids of the products or goals this batch created, for undo. */
  createdIds: string | null;
}

export interface ImportMappingTable {
  name: string;
  kind: ImportKind;
  /** JSON. */
  columnMap: string;
  delimiter: string;
  decimalFormat: string;
  dateFormat: string;
}

export interface SnapshotTable {
  /** `YYYY-MM`. */
  month: string;
  source: "saved" | "recomputed";
  assumptionsHash: string;
  /** JSON: per goal {prob, reqP, detNet, target, median, p10, p90, value, status}. */
  results: string;
}

export interface DismissalTable {
  ruleId: string;
  scope: "goal" | "product" | "none";
  key: string;
  dismissedAt: string;
}

export type DocumentKind =
  | "settings"
  | "commission"
  | "fiSettings"
  | "correlations"
  | "pensionPlan"
  | "cashFlow"
  | "openingDate";

/** Settings-like documents: one row per kind, JSON validated by a zod schema before it is stored. */
export interface DocumentTable {
  kind: DocumentKind;
  value: string;
}

export interface DB {
  meta: { key: string; value: string };
  product: ProductTable;
  pricePoint: PricePointTable;
  goal: GoalTable;
  contributionPlan: ContributionPlanTable;
  allocationWeight: AllocationWeightTable;
  transaction: TransactionTable;
  importBatch: ImportBatchTable;
  importMapping: ImportMappingTable;
  snapshot: SnapshotTable;
  dismissal: DismissalTable;
  document: DocumentTable;
}
