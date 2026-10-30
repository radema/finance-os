/* Runs the engine and shapes its output for the screens. Results are cached by a hash of the inputs (source spec: "recalculation on every write, cached by an inputs hash"). */
import { createHash } from 'node:crypto';
import { addMonths, analyse, holdingsAt, mkey, monthEnd, monthsBetween, pensionSchedule, priceAt, lastPriceMonth, pensionWeights } from '../engine/core.ts';
import type { Analysis } from '../engine/core.ts';
import { cashflow, nextAction, performance, planVsActual } from '../engine/tracking.ts';
import type { EngineState } from '../engine/types.ts';
import type { AlertView, GoalView, HoldingView, Overview, PerfView, PriceRow } from '../shared/view.ts';
import type { PriceMeta, Snap } from './store.ts';

const days = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const cache = new Map<string, Overview>();

export function snapshotOf(a: Analysis, month: string, source: Snap['source']): Snap {
  return { month, date: a.date, source, goals: a.results.map(r => ({ id: r.id, prob: r.prob, reqP: r.reqP, detNet: r.detNet, target: r.targetNom, median: r.median, p10: r.p10, p90: r.p90, value: r.value, status: r.status })) };
}

/** Month-end snapshots missing since trackingStart. The latest finished month is "saved", older gaps are "recomputed" from month-end prices (ticket 10). */
export function missingSnapshots(st: EngineState, have: Snap[]): Snap[] {
  if (!st.goals.length || !st.ledger.length) return [];
  const first = mkey(st.ledger.find(t => t.type !== 'coupon')?.date ?? st.asOf), start = first > st.settings.trackingStart ? first : st.settings.trackingStart;
  const last = addMonths(mkey(st.asOf), -1), out: Snap[] = [];
  for (let m = start; m <= last; m = addMonths(m, 1)) {
    if (have.some(s => s.month === m)) continue;
    const date = monthEnd(m), a = analyse({ ...st, asOf: date }, date, { paths: 300 });
    out.push(snapshotOf(a, m, m === last ? 'saved' : 'recomputed'));
  }
  return out;
}

export function buildOverview(st: EngineState, meta: Record<string, Record<string, PriceMeta>>, snaps: Snap[], opening: boolean): Overview {
  const key = createHash('sha1').update(JSON.stringify([st, meta, snaps, opening])).digest('hex');
  const hit = cache.get(key);
  if (hit) return { ...hit, timing: { ...hit.timing, cached: true } };
  const t0 = performance_now();
  const date = st.asOf, valMonth = mkey(date), S = st.settings;
  const a = st.goals.length ? analyse(st, date, { solve: true, fireYears: 40 }) : { results: [], fire: null, holdings: holdingsAt(st, date), date, startYear: +date.slice(0, 4), H: 0 } as Analysis;
  const H = a.holdings;
  const prods = new Map(st.products.map(p => [p.id, p]));

  /* price age: this month's price is as old as its fetch date; an older price is as old as its month-end */
  const priceInfo = (pid: string): { priceMonth: string; priceDate: string; age: number; old: boolean; source: string } => {
    const m = lastPriceMonth(st, pid) ?? '', fm = meta[pid]?.[m], priceDate = !m ? '' : m >= valMonth ? (fm?.fetchedAt ?? date) : monthEnd(m), age = priceDate ? Math.max(0, days(priceDate, date)) : 9999;
    return { priceMonth: m, priceDate, age, old: !m || m < valMonth || age > S.staleDays, source: fm?.source ?? prods.get(pid)?.source ?? 'manual' };
  };
  const holdings: Record<string, HoldingView[]> = {}, valueByProduct: Record<string, number> = {};
  for (const g of st.goals) {
    holdings[g.id] = Object.entries(H.pos[g.id] ?? {}).filter(([, q]) => Math.abs(q) > 1e-9).map(([pid, q]) => {
      const p = prods.get(pid)!, price = priceAt(st, pid, valMonth) ?? 0, value = q * price, pmc = H.pmc[pid] ?? price, pi = priceInfo(pid);
      valueByProduct[pid] = (valueByProduct[pid] ?? 0) + value;
      return { pid, name: p.name, isin: p.isin, cls: p.cls, regime: p.regime, q, price, value, pmc, gain: value - q * pmc, priceMonth: pi.priceMonth, old: pi.old, age: pi.age };
    }).sort((x, y) => y.value - x.value);
  }
  const priceRows: PriceRow[] = Object.keys(valueByProduct).map(pid => {
    const p = prods.get(pid)!, i = priceInfo(pid);
    return { pid, name: p.name, regime: p.regime, source: i.source, priceMonth: i.priceMonth, priceDate: i.priceDate, age: i.age, old: i.old, value: valueByProduct[pid] };
  }).sort((x, y) => y.age - x.age || y.value - x.value);

  const goals: GoalView[] = a.results.map(r => {
    const g = st.goals.find(x => x.id === r.id)!;
    return { id: g.id, name: g.name, priority: g.priority, year: g.year, target: g.target, targetNom: r.targetNom, T: r.T, isP: r.G.isP, fire: g.fire, cgrowth: g.cgrowth, minProb: g.minProb,
      reqP: r.reqP, prob: r.prob, status: r.status, value: r.value, netNow: r.detPath[0], median: r.median, p10: r.p10, p90: r.p90, detNet: r.detNet, shortfall: r.shortfall,
      needMC: r.reqMC, needDet: r.reqDet, monthlyNow: r.nowMonthly, plan: g.plan, fan: r.fan,
      weights: r.G.isP ? Object.entries(pensionWeights(st)).map(([productId, weight]) => ({ productId, weight })) : st.weights.filter(w => w.goalId === g.id).map(w => ({ productId: w.productId, weight: w.weight })) };
  });

  const perf: Record<string, PerfView | null> = {};
  for (const scope of ['all', 'all-ex-pension', ...st.goals.map(g => g.id)]) {
    const p = performance(st, scope);
    perf[scope] = p && { xirr: p.xirr, twr: p.twr, ytd: p.ytd, r12: p.r12, maxDD: p.maxDD, value: p.value, invested: p.invested, rows: p.rows.map(r => [r.m, r.value, r.invested]) };
  }
  const pva = planVsActual(st), next = nextAction(st, pva);
  const out: Overview = {
    asOf: date, valMonth, counts: { products: st.products.length, goals: st.goals.length, tx: st.ledger.length, prices: Object.values(st.prices).reduce((n, p) => n + Object.keys(p).length, 0), opening },
    settings: S, goals, products: st.products, holdings, priceRows, perf, pva, next, capacity: cashflow(st, 10), fire: a.fire, snaps,
    alerts: alerts(st, goals, pva, priceRows, snaps), essential: st.cashflow.essential, optional: st.cashflow.optional, timing: { analyseMs: Math.round(performance_now() - t0), cached: false }
  };
  if (cache.size > 20) cache.clear();
  cache.set(key, out);
  return out;
}
const performance_now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

/* ---------- rules R1-R8 (R9 needs a broker statement, R10 needs the price fetch: both later) ---------- */
function alerts(st: EngineState, goals: GoalView[], pva: ReturnType<typeof planVsActual>, prices: PriceRow[], snaps: Snap[]): AlertView[] {
  const S = st.settings, out: AlertView[] = [], c = S.commission, minTicket = c.rate > 0 ? c.min / c.rate : 0, eur = (v: number): string => '€' + Math.round(v).toLocaleString('en-GB');
  const key = mkey(st.asOf), year = +st.asOf.slice(0, 4), last = snaps[snaps.length - 1];
  const worse = { on: 0, risk: 1, off: 2 } as const, pos = holdingsAt(st, st.asOf).pos;
  for (const g of goals) {
    const p = pva.find(x => x.id === g.id)!;
    if (!g.isP && p.monthlyNow > 0 && -p.gap > Math.max(S.behindMonths * p.monthlyNow, minTicket))
      out.push({ ruleId: 'R1', name: 'Behind plan', severity: 'Medium', title: `${g.name} is ${eur(-p.gap)} behind plan`, body: `Planned ${eur(p.planned)} since ${S.trackingStart}, put in ${eur(p.actual)}.`,
        why: `Shown because the cumulative gap is larger than ${S.behindMonths} months of plan (${eur(S.behindMonths * p.monthlyNow)}) and than the minimum efficient ticket (${eur(minTicket)}).`, href: `#/goal/${g.id}` });
    if (g.priority === 'Need' && g.status === 'off')
      out.push({ ruleId: 'R6', name: 'Need off track', severity: 'High', title: `${g.name} is off track`, body: `${(g.prob * 100).toFixed(0)}% against ${(g.reqP * 100).toFixed(0)}% required.${g.needMC != null ? ` About ${eur(g.needMC)} a month would reach it.` : ' The target is not reachable with contributions alone.'}`,
        why: 'Shown because this is a Need goal and its status is Off track.', href: `#/goal/${g.id}` });
    const prev = last?.goals.find(x => x.id === g.id);
    if (prev && worse[g.status] > worse[prev.status as 'on']) out.push({ ruleId: 'R4', name: 'Status worsened', severity: 'Medium', title: `${g.name} got riskier`, body: `From ${prev.status} to ${g.status} since the ${last.month} snapshot.`, why: 'Shown because the status is worse than in the latest snapshot.', href: `#/goal/${g.id}` });
    const holdsEquity = Object.keys(pos[g.id] ?? {}).some(pid => st.products.find(p2 => p2.id === pid)?.cls === 'Equity');
    if (g.T <= 1 && holdsEquity)
      out.push({ ruleId: 'R8', name: 'Near goal, risky assets', severity: 'Medium', title: `${g.name} is due within a year and holds equity`, body: 'Consider moving to low-risk assets.', why: 'Shown because the horizon is one year or less and the bucket holds equity.', href: `#/goal/${g.id}` });
  }
  const pg = goals.find(g => g.isP);
  if (pg) {
    const s = pensionSchedule(st, year, 1)[0], volFlow = new Set(st.pension.flows.filter(f => f.flow === 'Voluntary').map(f => f.productId));
    const ytd = st.ledger.filter(t => t.type === 'pensionContribution' && t.date.startsWith(String(year)) && volFlow.has(t.productId)).reduce((a, t) => a + t.qty * t.price, 0);
    const room = st.pension.cap + st.pension.extra - s.worker - s.employer - ytd;
    if (room > 1) out.push({ ruleId: 'R2', name: 'Deduction room', severity: 'Info', title: `${eur(room)} of pension deduction still available`, body: `Refund about ${eur(room * st.pension.marginal)} at ${(st.pension.marginal * 100).toFixed(0)}%.`, why: 'Shown because cap + extra − (worker + employer + voluntary this year) is above zero.', href: '#/goal/' + pg.id });
  }
  const held = new Set(prices.map(r => r.pid));
  for (const p of st.products) if (held.has(p.id) && p.maturity && monthsBetween(key, p.maturity) <= 36 && monthsBetween(key, p.maturity) >= 0)
    out.push({ ruleId: 'R3', name: 'Maturity ahead', severity: 'Medium', title: `${p.name.split(' (')[0]} matures in ${monthsBetween(key, p.maturity)} months`, body: 'Plan where the proceeds go.', why: 'Shown because a held product matures within 36 months.', href: '#/prices' });
  const old = prices.filter(r => r.old);
  if (old.length) out.push({ ruleId: 'R5', name: 'Stale prices', severity: 'Medium', title: `${old.length} price${old.length > 1 ? 's are' : ' is'} old`, body: `${old.slice(0, 3).map(r => r.name.split(' (')[0]).join(', ')}${old.length > 3 ? ` and ${old.length - 3} more` : ''}. They are still counted.`,
    why: `Shown because a held product has no price for ${key} or its price is older than ${S.staleDays} days.`, href: '#/prices' });
  const since = addMonths(key, -12) + '-01', costly = st.ledger.filter(t => (t.type === 'buy' || t.type === 'sell') && t.date >= since && t.commission != null && Math.abs(t.qty * t.price) > 0 && t.commission / Math.abs(t.qty * t.price) > 1.25 * c.rate);
  if (costly.length) out.push({ ruleId: 'R7', name: 'Costly trades', severity: 'Info', title: `${costly.length} trade${costly.length > 1 ? 's' : ''} cost more than ${(c.rate * 125).toFixed(2)}%`, body: 'Batch small buys into fewer, larger ones.', why: 'Shown because commission over amount was above 1.25 × the commission rate in the last 12 months.', href: '#/transactions' });
  return out.sort((x, y) => ({ High: 0, Medium: 1, Info: 2 })[x.severity] - ({ High: 0, Medium: 1, Info: 2 })[y.severity]);
}
