/* Performance, plan vs actual, next contribution, cash flow. Ported from the mock with [10] versioned plan and cumulative comparison,
   [12-M1] contributions stop before the goal year, [12-E9] stub year in the cash flow. */
import { addMonths, flowOf, monthsBetween, mkey, monthlyAt, pensionSchedule, priceAt, stubMonths, txAmount } from './core.ts';
import type { EngineState } from './types.ts';

/* ---------- performance ---------- */
export interface PerfRow { m: string; value: number; flow: number; invested: number; twrIndex: number; ret: number; dd: number }
export interface Perf { rows: PerfRow[]; xirr: number | null; twr: number; ytd: number; r12: number | null; maxDD: number; value: number; invested: number }
export type PerfScope = 'all' | 'all-ex-pension' | string;

export function performance(st: EngineState, scope: PerfScope): Perf | null {
  const inScope = (g: string): boolean => scope === 'all' ? true : scope === 'all-ex-pension' ? g !== st.pension.goalId : g === scope;
  const txs = st.ledger.filter(t => inScope(t.goalId) && t.date <= st.asOf);
  if (!txs.length) return null;
  const months: string[] = [], first = mkey(txs[0].date), last = mkey(st.asOf);
  for (let i = 0; i <= monthsBetween(first, last); i++) months.push(addMonths(first, i));
  const pos: Record<string, number> = {}; let li = 0, idx = 1, peak = 1, cumFlow = 0, prevV = 0;
  const rows: PerfRow[] = [];
  for (const m of months) {
    let flow = 0;
    while (li < txs.length && mkey(txs[li].date) <= m) { const t = txs[li++]; if (t.type !== 'coupon') pos[t.productId] = (pos[t.productId] || 0) + (+t.qty || 0); flow += flowOf(t); }
    let V = 0; for (const pid in pos) V += pos[pid] * (priceAt(st, pid, m) || 0);
    const r = prevV > 0 ? (V - flow) / prevV - 1 : 0; idx *= 1 + r; peak = Math.max(peak, idx); cumFlow += flow;
    rows.push({ m, value: V, flow, invested: cumFlow, twrIndex: idx, ret: r, dd: idx / peak - 1 }); prevV = V;
  }
  const end = rows[rows.length - 1];
  const flows = txs.map(t => ({ d: t.date, a: -flowOf(t) })); flows.push({ d: st.asOf, a: end.value });
  const yStart = rows.findIndex(r => r.m === `${st.asOf.slice(0, 4)}-01`);
  const ytd = yStart > 0 ? end.twrIndex / rows[yStart - 1].twrIndex - 1 : end.twrIndex - 1;
  const y1 = rows[rows.length - 13];
  return { rows, xirr: XIRR(flows), twr: end.twrIndex - 1, ytd, r12: y1 ? end.twrIndex / y1.twrIndex - 1 : null, maxDD: Math.min(...rows.map(r => r.dd)), value: end.value, invested: end.invested };
}
export function XIRR(flows: { d: string; a: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = Date.parse(flows[0].d);
  const f = (r: number): number => flows.reduce((s, c) => s + c.a / Math.pow(1 + r, (Date.parse(c.d) - t0) / 31557600000), 0);
  let lo = -0.99, hi = 1; if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/* ---------- plan vs actual ---------- */
export interface PvaRow {
  id: string; name: string; planned: number; actual: number; gap: number; pct: number | null;
  months: string[]; plannedCum: number[]; actualCum: number[]; actualMonthly: number[]; monthlyNow: number;
}
/** [10] Planned = the plan in force each month, month by month since trackingStart; actual = invested money, opening and coupons excluded. Compared cumulatively. */
export function planVsActual(st: EngineState): PvaRow[] {
  const ts = st.settings.trackingStart, now = mkey(st.asOf), n = Math.max(0, monthsBetween(ts, now) + 1);
  const months = Array.from({ length: n }, (_, i) => addMonths(ts, i));
  return st.goals.map(g => {
    const isP = st.pension.goalId === g.id, plannedCum: number[] = [], actualCum: number[] = [], actualMonthly: number[] = [];
    let pl = 0, ac = 0;
    for (const k of months) {
      const y = +k.slice(0, 4);
      if (y < g.year) pl += isP ? pensionSchedule(st, y, 1)[0].total / 12 : monthlyAt(g, k);   /* [12-M1] */
      const am = st.ledger.filter(t => t.goalId === g.id && mkey(t.date) === k && t.date <= st.asOf && t.type !== 'opening' && t.type !== 'coupon').reduce((a, t) => a + txAmount(t), 0);
      ac += am; plannedCum.push(pl); actualCum.push(ac); actualMonthly.push(am);
    }
    return { id: g.id, name: g.name, planned: pl, actual: ac, gap: ac - pl, pct: pl > 0 ? ac / pl : null, months, plannedCum, actualCum, actualMonthly, monthlyNow: monthlyAt(g, now) };
  });
}
export interface NextAction {
  kind: 'none' | 'wait' | 'invest'; minTicket: number; goal?: PvaRow; amount?: number;
  split?: { productId: string; name: string; amount: number; commission: number }[];
}
export function nextAction(st: EngineState, pva: PvaRow[]): NextAction {
  const c = st.settings.commission, minTicket = c.rate > 0 ? c.min / c.rate : 0;
  const behind = pva.filter(r => r.gap < -1 && st.pension.goalId !== r.id).sort((a, b) => a.gap - b.gap)[0];   /* E6: never the pension goal */
  if (!behind) return { kind: 'none', minTicket };
  const ws = st.weights.filter(w => w.goalId === behind.id && +w.weight > 0), sum = ws.reduce((a, w) => a + +w.weight, 0);
  const amount = -behind.gap, zeroOnly = ws.length > 0 && ws.every(w => st.products.find(p => p.id === w.productId)?.zero);
  const split = ws.map(w => {
    const p = st.products.find(x => x.id === w.productId)!, a = amount * (+w.weight) / sum;
    return { productId: w.productId, name: p.name, amount: a, commission: p.zero ? 0 : Math.min(c.max, Math.max(c.min, c.rate * a)) };
  });
  return { kind: amount < minTicket && !zeroOnly ? 'wait' : 'invest', goal: behind, amount, split, minTicket };
}

/* ---------- cash flow ---------- */
export interface CashRow { t: number; year: number; stub: boolean; income: number; expenses: number; events: number; refund: number; capacity: number; per: Record<string, number>; planned: number; free: number }
export function cashflow(st: EngineState, years: number): CashRow[] {
  const c = st.cashflow, startYear = +st.asOf.slice(0, 4), ps = pensionSchedule(st, startYear, years + 1), key = mkey(st.asOf), r = stubMonths(st.asOf), out: CashRow[] = [];
  for (let t = 1; t <= years; t++) {
    const y = startYear + t - 1, f = t === 1 ? r / 12 : 1;   /* [12-E9] the current year is the months still to come */
    const inc = c.income * Math.pow(1 + c.incomeGrowth, t - 1) * f, exp = 12 * (c.essential + c.optional) * Math.pow(1 + c.expenseGrowth, t - 1) * f;
    const ev = c.events.filter(e => +e.year === y).reduce((a, e) => a + +e.amount, 0), refund = t > 1 ? ps[t - 2].refund : 0;
    const per: Record<string, number> = {}; let planned = 0;
    for (const g of st.goals) {
      let a = 0;
      if (y < g.year) a = st.pension.goalId === g.id ? ps[t - 1].voluntary * f : (t === 1 ? r : 12 * Math.pow(1 + (+g.cgrowth || 0), t - 2)) * monthlyAt(g, key);   /* [12-M1] */
      per[g.id] = a; planned += a;
    }
    out.push({ t, year: y, stub: t === 1, income: inc, expenses: exp, events: ev, refund, capacity: inc - exp + ev + refund, per, planned, free: inc - exp + ev + refund - planned });
  }
  return out;
}
