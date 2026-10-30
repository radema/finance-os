/* Engine input types. Field names follow the mock (reference/mock-app.html) so the port stays checkable against it. */
export const CLASSES = ['Equity', 'Govt bonds', 'Corp bonds', 'Multi-asset', 'Cash', 'Gold/Commodities'] as const;
export type AssetClass = (typeof CLASSES)[number];
export type Regime = 'etf' | 'direct' | 'govt' | 'cash' | 'pension';
export type Priority = 'Need' | 'Want' | 'Wish';
export type TxType = 'opening' | 'buy' | 'sell' | 'pensionContribution' | 'coupon';

export interface Product {
  id: string; name: string; isin: string; cls: AssetClass; regime: Regime;
  wl: number;          // white-list share, 0..1 (etf tax rate)
  mu: number;          // expected total return
  vol: number; ter: number; zero: boolean;
  maturity: string;    // YYYY-MM or ''
  ticker: string; source: 'yahoo' | 'manual' | 'csv';
  couponRate: number;  // ticket 12 S1: annual coupon, govt only; 0 = none
}
export interface PlanVersion { from: string; amount: number }   // YYYY-MM, €/month (ticket 10)
export interface Goal {
  id: string; name: string; priority: Priority; target: number; year: number;
  plan: PlanVersion[]; cgrowth: number; minProb: number | null; fire: boolean;
}
export interface Weight { goalId: string; productId: string; weight: number }
export interface Tx {
  id: string; date: string; goalId: string; productId: string; type: TxType;
  qty: number; price: number; commission: number | null;
  amount: number | null;   // coupon: net cash received
  note: string; batchId: string | null;
}
export interface PensionFlow { productId: string; flow: 'Work' | 'Voluntary'; pct: number }
export interface Pension {
  ral: number; ralGrowth: number; tfrPct: number; workerPct: number; employerPct: number;
  voluntary: number | null; marginal: number; firstYear: number; cap: number; extra: number;
  goalId: string; flows: PensionFlow[];
}
export interface CashFlowIn {
  income: number; incomeGrowth: number; essential: number; optional: number; expenseGrowth: number;
  events: { year: number; label: string; amount: number }[];
}
export interface FireSettings { efFromGoal: string; efMonths: number; l2Mult: number; l3Mult: number; includePension: boolean }
export interface Settings {
  inflation: number; taxStd: number; taxGovt: number; bollo: number; pensionTax: number;
  paths: number; seed: number; probNeed: number; probWant: number; probWish: number;
  zainetto: { amount: number; expiry: number; goalId: string };
  commission: { rate: number; min: number; max: number };
  trackingStart: string; behindMonths: number; staleDays: number; fire: FireSettings;
}
export type PriceTable = Record<string, Record<string, number>>;   // productId -> YYYY-MM -> price
export interface EngineState {
  asOf: string;            // YYYY-MM-DD, an input (ticket 12 E7)
  settings: Settings; corr: number[][];
  products: Product[]; goals: Goal[]; weights: Weight[];
  pension: Pension; cashflow: CashFlowIn; prices: PriceTable; ledger: Tx[];
}
