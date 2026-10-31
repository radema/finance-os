import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/** The part of a mock state that the copied engine reads. Money is in euros, prices per unit. */
export type MockState = {
  asOf: string;
  settings: Record<string, unknown>;
  pension: { goalId: string | null; firstYear: number };
  products: {
    id: string;
    cls: string;
    regime: string;
    wl: number;
    mu: number;
    vol: number;
    ter: number;
  }[];
  goals: {
    id: string;
    year: number;
    target: number;
    contrib: number;
    cgrowth: number;
    priority: string;
  }[];
  weights: { goalId: string; productId: string; weight: number }[];
  ledger: {
    date: string;
    goalId: string;
    productId: string;
    type: string;
    qty: number;
    price: number;
  }[];
  prices: Record<string, Record<string, number>>;
  corr: number[][];
};

export type MockAnalysis = { results: { id: string; detNet: number }[] };

/** The part of a mock state that the copied `cashflow` reads. Money is in euros. */
export type MockCashFlowState = {
  asOf: string;
  cashflow: {
    income: number;
    incomeGrowth: number;
    essential: number;
    optional: number;
    expenseGrowth: number;
    events: { year: number; label: string; amount: number }[];
  };
  pension: {
    goalId: string;
    ral: number;
    ralGrowth: number;
    tfrPct: number;
    workerPct: number;
    employerPct: number;
    cap: number;
    extra: number;
    /** An empty string means "to cap". */
    voluntary: number | "";
    marginal: number;
  };
  goals: { id: string; year: number; contrib: number; cgrowth: number }[];
};

export type MockCashFlowRow = {
  year: number;
  income: number;
  expenses: number;
  events: number;
  refund: number;
  capacity: number;
  planned: number;
  free: number;
};

type MockEngine = {
  analyse(state: MockState, date: string, options: { paths: number }): MockAnalysis;
  cashflow(state: MockCashFlowState, years: number): MockCashFlowRow[];
};

// The copy is browser code. Its globals live here, not in the copy.
const CLASSES = ["Equity", "Govt bonds", "Corp bonds", "Multi-asset", "Cash", "Gold/Commodities"];
const mkey = (d: string): string => d.slice(0, 7);

/** The mock engine, evaluated once in its own context. */
export function loadMockEngine(): MockEngine {
  const source = readFileSync(join(import.meta.dirname, "mock-engine.js"), "utf8");
  return runInNewContext(`${source}\n({ analyse, cashflow });`, { CLASSES, mkey }) as MockEngine;
}
