/* What the server sends the UI: the engine output reduced to what the screens draw. */
import type { CashRow, NextAction, PvaRow } from '../engine/tracking.ts';
import type { FireOut } from '../engine/core.ts';
import type { Snap } from '../server/store.ts';
import type { Product, Settings } from '../engine/types.ts';

export type Status = 'on' | 'risk' | 'off';
export interface GoalView {
  id: string; name: string; priority: 'Need' | 'Want' | 'Wish'; year: number; target: number; targetNom: number; T: number; isP: boolean; fire: boolean; cgrowth: number; minProb: number | null;
  reqP: number; prob: number; status: Status; value: number; netNow: number; median: number; p10: number; p90: number; detNet: number; shortfall: number;
  needMC: number | null; needDet: number | null; monthlyNow: number; plan: { from: string; amount: number }[];
  fan: { p10: number[]; p50: number[]; p90: number[] }; weights: { productId: string; weight: number }[];
}
export interface HoldingView { pid: string; name: string; isin: string; cls: string; regime: string; q: number; price: number; value: number; pmc: number; gain: number; priceMonth: string; old: boolean; age: number }
export interface PriceRow { pid: string; name: string; regime: string; source: string; priceMonth: string; priceDate: string; age: number; old: boolean; value: number }
export interface PerfView { xirr: number | null; twr: number; ytd: number; r12: number | null; maxDD: number; value: number; invested: number; rows: [string, number, number][] }
export interface AlertView { ruleId: string; name: string; severity: 'High' | 'Medium' | 'Info'; title: string; body: string; why: string; href: string }
export interface Overview {
  asOf: string; valMonth: string; counts: { products: number; goals: number; tx: number; prices: number; opening: boolean };
  settings: Settings; goals: GoalView[]; products: Product[]; holdings: Record<string, HoldingView[]>; priceRows: PriceRow[];
  perf: Record<string, PerfView | null>; pva: PvaRow[]; next: NextAction; capacity: CashRow[]; fire: FireOut | null; snaps: Snap[]; alerts: AlertView[];
  essential: number; optional: number; timing: { analyseMs: number; cached: boolean };
}
export interface TxView { id: string; date: string; goalId: string; productId: string; type: string; qty: number; price: number; commission: number | null; amount: number | null; batchId: string | null; estFee: number | null }
export interface BatchView { id: string; source: string; fileName: string; createdAt: string; rowsRead: number; rowsImported: number; rowsSkipped: number; undoneAt: string | null }
export interface PriceGrid { months: string[]; products: { id: string; name: string; regime: string; source: string; cells: Record<string, { price: number; source: string; fetchedAt: string } | undefined> }[] }
