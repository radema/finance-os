/* Mix optimizer (O1, O2, O4, O5). Ported from the mock. Per-product cap only (ticket 10). Pension buckets are not optimised. */
import { buildShocks, holdingsAt, liquidate, pct, prepGoal, probOf, prodParams, runPath, solve } from './core.ts';
import type { GoalItem, PreparedGoal } from './core.ts';
import type { EngineState } from './types.ts';

export type Criterion = 'auto' | 'p10' | 'median' | 'prob' | 'cheapest';
export interface OptOpts { universe?: string[]; mode?: 'new' | 'rebalance'; criterion?: Criterion; maxW?: number; paths?: number; step?: number }
export interface Mix { w: number[]; prob: number; median: number; p10: number; p90: number; shortfall: number; det: number; need?: number | null }
export interface OptResult {
  error?: string; goalId?: string; universe?: string[]; step?: number; mode?: string; paths?: number; reqP?: number; targetNom?: number; T?: number;
  grid?: Mix[]; current?: Mix; best?: Mix; rule?: string; crit?: string; switchTax?: number; feasible?: number;
}

export function mixGrid(n: number, step: number): number[][] {
  const units = Math.round(1 / step), out: number[][] = [];
  const rec = (i: number, left: number, acc: number[]): void => {
    if (i === n - 1) { out.push([...acc, left * step]); return; }
    for (let k = 0; k <= left; k++) rec(i + 1, left - k, [...acc, k * step]);
  };
  rec(0, units, []); return out;
}

export function optimizeMix(st: EngineState, goalId: string, opts: OptOpts = {}): OptResult {
  const S = st.settings, g = st.goals.find(x => x.id === goalId)!, date = st.asOf, H0 = holdingsAt(st, date);
  const base = prepGoal(st, g, H0, date);
  if (base.isP) return { error: 'Pension funds cannot be switched here: change the pension flows instead.' };
  const universe = opts.universe && opts.universe.length ? opts.universe : base.items.map(it => it.pid);
  const prods = Object.fromEntries(st.products.map(p => [p.id, p])), n = universe.length;
  if (!n || base.T < 1) return { error: base.T < 1 ? 'The goal is due within a year: there is nothing to optimise.' : 'Choose at least one product.' };
  const step = opts.step || (n <= 4 ? 0.1 : 0.2), P = opts.paths || 300, mode = opts.mode || 'new';
  const SH = buildShocks(st, base.T, P);
  const cur = universe.map(pid => { const it = base.items.find(x => x.pid === pid); return it ? { v0: it.v0, b0: it.b0, w: it.w } : { v0: 0, b0: 0, w: 0 }; });
  const heldOutside = base.items.filter(it => !universe.includes(it.pid));
  let switchTax = 0;
  if (mode === 'rebalance') switchTax = liquidate(base.items.map(it => it.v0), base.items.map(it => it.b0), { items: base.items, credit0: 0, exitR: base.exitR }).tax;
  const total = base.items.reduce((a, it) => a + it.v0, 0) - switchTax;
  const build = (w: number[]): PreparedGoal => {
    const items: GoalItem[] = universe.map((pid, i) => {
      const pp = prodParams(prods[pid], S);
      return mode === 'rebalance' ? { pid, pp, w: w[i], v0: total * w[i], b0: total * w[i] } : { pid, pp, w: w[i], v0: cur[i].v0, b0: cur[i].b0 };
    });
    if (mode !== 'rebalance') heldOutside.forEach(it => items.push({ ...it, w: 0 }));
    return { ...base, items, wsum: 1, amt: (t, i, x) => base.total(t, x) * items[i].w };
  };
  const evalMix = (w: number[]): Mix => {
    const G = build(w), f = new Float64Array(P);
    for (let p = 0; p < P; p++) f[p] = runPath(G, G.x0, SH.Z, p * (SH.H + 1) * SH.NC, SH.NC, null);
    const s = Array.from(f).sort((a, b) => a - b); let k = 0;
    for (const v of s) if (v >= G.targetNom - 0.005) k++;
    let sf = 0, ns = 0; for (const v of s) if (v < G.targetNom) { sf += G.targetNom - v; ns++; }
    return { w, prob: k / P, median: pct(s, .5), p10: pct(s, .1), p90: pct(s, .9), shortfall: ns ? sf / ns : 0, det: runPath(G, G.x0, null, 0, SH.NC, null) };
  };
  const maxW = opts.maxW || 1, grid = mixGrid(n, step).filter(w => w.every(x => x <= maxW + 1e-9)).map(evalMix);
  if (!grid.length) return { error: 'No mix satisfies the maximum weight per product: raise it or add products.' };
  const curW = cur.map(c => c.w), cs = curW.reduce((a, b) => a + b, 0);
  const current = evalMix(cs > 0 ? curW.map(x => x / cs) : universe.map(() => 1 / n));
  const feasible = grid.filter(c => c.prob >= base.reqP);
  const crit = opts.criterion && opts.criterion !== 'auto' ? opts.criterion : (g.priority === 'Need' ? 'p10' : 'median');
  const out = (best: Mix, rule: string, nFeasible = feasible.length): OptResult => ({ goalId, universe, step, mode, paths: P, reqP: base.reqP, targetNom: base.targetNom, T: base.T, grid, current, best, rule, crit, switchTax, feasible: nFeasible });
  if (crit === 'cheapest') {
    const need = (c: Mix): number | null => { const G = build(c.w), x = solve(G, y => probOf(G, y, SH) >= base.reqP); return x == null ? null : x; };
    grid.forEach(c => { c.need = need(c); }); current.need = need(current);
    const ok = grid.filter(c => c.need != null);
    if (ok.length) return out(ok.slice().sort((a, b) => a.need! - b.need! || b.median - a.median)[0], 'O5 Spend least: the mix that reaches the required probability with the lowest monthly contribution.', ok.length);
  }
  const RULES = { p10: 'O1 Best bad case: among mixes reaching the required probability, the one with the highest P10.',
    median: 'O2 Best median: among mixes reaching the required probability, the one with the highest median outcome.', prob: 'O4 Highest probability of success (ties: higher median).',
    cheapest: 'O5 Spend least: no mix can reach the required probability with contributions; showing the highest probability instead.' } as const;
  if (crit === 'prob' || crit === 'cheapest') return out(grid.slice().sort((a, b) => b.prob - a.prob || b.median - a.median)[0], RULES[crit]);
  if (feasible.length) {
    const best = crit === 'p10' ? feasible.slice().sort((a, b) => b.p10 - a.p10 || b.prob - a.prob)[0] : feasible.slice().sort((a, b) => b.median - a.median || b.prob - a.prob)[0];
    return out(best, RULES[crit] + (!opts.criterion || opts.criterion === 'auto' ? ` (default for ${g.priority} goals)` : ''));
  }
  return out(grid.slice().sort((a, b) => b.prob - a.prob || b.median - a.median)[0], 'O3 No mix reaches the required probability: the one with the highest probability. Contributions or target need to change.');
}
