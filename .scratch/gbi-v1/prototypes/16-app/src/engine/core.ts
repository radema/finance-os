/* Pure engine: ported from reference/mock-app.html with the ticket 07 and 12 rules.
   Changes against the mock are tagged [12-E9] stub year, [12-S1] coupon, [12-S2] commission in basis, [12-S5] yearly pension mix,
   [12-M1] contributions stop at the goal date, [07] FI levels. No I/O. */
import { CLASSES } from './types.ts';
import type { EngineState, Goal, Product, Settings } from './types.ts';

/* ---------- maths ---------- */
export function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function gauss(rnd: () => number): number { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
function cholesky(A: number[][]): number[][] | null {
  const n = A.length, L = A.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 1e-10) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return L;
}
export function safeCholesky(A: number[][]): { L: number[][]; shrink: number } {
  let f = 1;
  for (let k = 0; k < 40; k++) {
    const B = A.map((r, i) => r.map((v, j) => (i === j ? 1 : (+v || 0) * f))), L = cholesky(B);
    if (L) return { L, shrink: f };
    f *= 0.9;
  }
  return { L: A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))), shrink: 0 };
}
export function pct(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return 0;
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}

/* ---------- dates ---------- */
export const mkey = (d: string): string => d.slice(0, 7);
export function addMonths(key: string, n: number): string {
  let [y, m] = key.split('-').map(Number); m += n;
  while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function monthsBetween(a: string, b: string): number {
  const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
export function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
/** [12-E9] Months of the current calendar year still to come: the asOf month counts as done. */
export const stubMonths = (asOf: string): number => 12 - Number(asOf.slice(5, 7));

/* ---------- prices, holdings ---------- */
export function priceAt(st: Pick<EngineState, 'prices'>, pid: string, key: string): number | null {
  const ps = st.prices[pid] || {};
  if (ps[key] != null) return ps[key];
  let best: number | null = null, bk = '';
  for (const k in ps) if (k <= key && k > bk) { bk = k; best = ps[k]; }
  return best;
}
export const lastPriceMonth = (st: Pick<EngineState, 'prices'>, pid: string): string | null => Object.keys(st.prices[pid] || {}).sort().pop() || null;

export interface Holdings { pos: Record<string, Record<string, number>>; pmc: Record<string, number>; accQty: Record<string, number> }
/** Units per (goal, product) and account-level PMC up to `date`. [12-S2] the actual commission of a buy joins the basis. Coupons change nothing. */
export function holdingsAt(st: Pick<EngineState, 'ledger'>, date: string): Holdings {
  const pos: Holdings['pos'] = {}, pmc: Holdings['pmc'] = {}, accQty: Holdings['accQty'] = {};
  for (const t of st.ledger) {
    if (t.date > date) break;
    if (t.type === 'coupon') continue;
    const q = +t.qty || 0, pr = +t.price || 0;
    (pos[t.goalId] = pos[t.goalId] || {})[t.productId] = (pos[t.goalId][t.productId] || 0) + q;
    const aq = accQty[t.productId] || 0;
    if (q > 0) pmc[t.productId] = (aq * (pmc[t.productId] || 0) + q * pr + (t.type === 'buy' ? +(t.commission || 0) : 0)) / (aq + q);
    accQty[t.productId] = aq + q;
  }
  return { pos, pmc, accQty };
}
/** Cash that moved in the portfolio: positive = money put in. A coupon is cash leaving it (ticket 08). */
export function flowOf(t: { type: string; qty: number; price: number; amount: number | null }): number {
  return t.type === 'coupon' ? -(+t.amount! || 0) : (+t.qty || 0) * (+t.price || 0);
}
export const txAmount = (t: { qty: number; price: number }): number => (+t.qty || 0) * (+t.price || 0);
export function estCommission(s: Settings, p: Product | undefined, type: string, amount: number): number {
  if (type !== 'buy' && type !== 'sell') return 0;
  if (p && p.zero) return 0;
  const c = s.commission;
  return Math.min(c.max, Math.max(c.min, c.rate * Math.abs(amount)));
}

/* ---------- plan ---------- */
/** Monthly contribution in force in month `ym` (ticket 10: versioned plan). */
export function monthlyAt(g: Pick<Goal, 'plan'>, ym: string): number {
  let amt = 0, from = '';
  for (const v of g.plan) if (v.from <= ym && v.from >= from) { from = v.from; amt = v.amount; }
  return amt;
}

/* ---------- pension ---------- */
export interface PensionRow { t: number; year: number; ral: number; tfr: number; worker: number; employer: number; voluntary: number; work: number; total: number; deductible: number; refund: number }
export function pensionSchedule(st: Pick<EngineState, 'pension'>, startYear: number, years: number): PensionRow[] {
  const p = st.pension, out: PensionRow[] = [];
  for (let t = 1; t <= years; t++) {
    const ral = p.ral * Math.pow(1 + p.ralGrowth, t - 1), tfr = ral * p.tfrPct, w = ral * p.workerPct, e = ral * p.employerPct;
    const room = Math.max(0, p.cap + (+p.extra || 0) - w - e);
    const vol = p.voluntary == null ? room : +p.voluntary;
    out.push({ t, year: startYear + t - 1, ral, tfr, worker: w, employer: e, voluntary: vol, work: tfr + w + e, total: tfr + w + e + vol,
      deductible: Math.min(p.cap + (+p.extra || 0), w + e + vol), refund: Math.min(vol, room) * p.marginal });
  }
  return out;
}
export const exitRate = (st: Pick<EngineState, 'pension'>, year: number): number => Math.max(0.09, 0.15 - 0.003 * Math.max(0, year - st.pension.firstYear - 15));
/** Share of each flow that goes to each pension product. */
function flowShares(st: Pick<EngineState, 'pension'>, pid: string): { work: number; vol: number } {
  let work = 0, vol = 0;
  for (const f of st.pension.flows) if (f.productId === pid) { if (f.flow === 'Work') work += +f.pct || 0; else vol += +f.pct || 0; }
  return { work, vol };
}
/** First-year product weights, for display (Allocation screen). */
export function pensionWeights(st: Pick<EngineState, 'pension'>): Record<string, number> {
  const s = pensionSchedule(st, 2000, 1)[0], w: Record<string, number> = {};
  for (const f of st.pension.flows) { const base = f.flow === 'Work' ? s.work : s.voluntary; w[f.productId] = (w[f.productId] || 0) + (s.total > 0 ? (+f.pct || 0) * base / s.total : 0); }
  return w;
}

/* ---------- goal model ---------- */
export interface ProdParams { mu: number; ter: number; m: number; s: number; t: number; regime: Product['regime']; cls: number; coupon: number }
export function prodParams(p: Product, S: Settings): ProdParams {
  const coupon = p.regime === 'govt' ? Math.max(0, +p.couponRate || 0) : 0;
  const mu = (+p.mu || 0) - coupon;      /* [12-S1] price return = total return - coupon */
  const sig = Math.max(0, +p.vol || 0), ter = +p.ter || 0;
  const s = Math.sqrt(Math.log(1 + sig * sig / ((1 + mu) * (1 + mu)))), m = Math.log(1 + mu) - s * s / 2;
  let t = 0;
  if (p.regime === 'etf') t = S.taxStd - (S.taxStd - S.taxGovt) * Math.min(1, Math.max(0, +p.wl || 0));
  else if (p.regime === 'govt') t = S.taxGovt; else if (p.regime === 'direct') t = S.taxStd;
  return { mu, ter, m, s, t, regime: p.regime, cls: Math.max(0, CLASSES.indexOf(p.cls)), coupon };
}
export function requiredProb(g: Goal, S: Settings): number {
  if (g.minProb != null && !isNaN(+g.minProb)) return +g.minProb;
  return g.priority === 'Need' ? S.probNeed : g.priority === 'Want' ? S.probWant : S.probWish;
}

export interface GoalItem { pid: string; pp: ProdParams; w: number; v0: number; b0: number }
export interface PreparedGoal {
  g: Goal; T: number; stub: number; items: GoalItem[]; wsum: number; isP: boolean; x0: number;
  /** Cash added to item i at step t (1 = stub year) for contribution level x. Non-pension: x is €/month; pension: x multiplies the schedule. */
  amt: (t: number, i: number, x: number) => number;
  /** Total contribution at step t for level x. */
  total: (t: number, x: number) => number;
  /** Monthly € that x = 1 stands for (pension) */
  unitMonthly: number;
  S: Settings; startYear: number; targetNom: number; reqP: number; exitR: number; credit0: number;
}
export function prepGoal(st: EngineState, g: Goal, H: Holdings, date: string): PreparedGoal {
  const S = st.settings, startYear = +date.slice(0, 4), key = mkey(date), T = Math.max(0, g.year - startYear), stub = stubMonths(date);
  const isP = st.pension.goalId === g.id;
  const prods: Record<string, Product> = {}; st.products.forEach(p => prods[p.id] = p);
  const ids = new Set(st.weights.filter(w => w.goalId === g.id).map(w => w.productId));
  Object.keys(H.pos[g.id] || {}).forEach(pid => ids.add(pid));
  const pw = isP ? pensionWeights(st) : null;
  const raw = [...ids].filter(pid => prods[pid]).map(pid => ({ pid, w: isP ? (pw![pid] || 0) : Math.max(0, st.weights.find(x => x.goalId === g.id && x.productId === pid)?.weight || 0) }));
  const wsum = raw.reduce((a, r) => a + r.w, 0);
  const items = raw.map(r => {
    const q = (H.pos[g.id] || {})[r.pid] || 0, pr = priceAt(st, r.pid, key) || 0;
    return { pid: r.pid, pp: prodParams(prods[r.pid], S), w: wsum > 0 ? r.w / wsum : 0, v0: q * pr, b0: q * (H.pmc[r.pid] || pr) };
  });
  const monthly = monthlyAt(g, key), cg = +g.cgrowth || 0;
  const sched = isP ? pensionSchedule(st, startYear, Math.max(1, T)) : null;
  const shares = items.map(it => flowShares(st, it.pid));
  /* [12-E9] step 1 is the stub (r months); step t >= 2 is full year k = t - 1 */
  const k = (t: number) => (t === 1 ? stub / 12 : 1);
  const total = (t: number, x: number): number => isP ? sched![t - 1].total * x * k(t) : (t === 1 ? stub * x : 12 * x * Math.pow(1 + cg, t - 2));
  const amt = (t: number, i: number, x: number): number => {
    if (!isP) return total(t, x) * items[i].w;
    const s = sched![t - 1];   /* [12-S5] every flow split with its own %, every year */
    return (s.work * shares[i].work + s.voluntary * shares[i].vol) * x * k(t);
  };
  const z = st.settings.zainetto;
  return { g, T, stub, items, wsum, isP, x0: isP ? 1 : monthly, amt, total, unitMonthly: isP ? sched![0].total / 12 : 1, S, startYear,
    targetNom: g.target * Math.pow(1 + S.inflation, T), reqP: requiredProb(g, S), exitR: exitRate(st, g.year),
    credit0: (z.goalId === g.id && +z.amount > 0 && g.year <= +z.expiry) ? +z.amount * S.taxStd : 0 };
}

export function liquidate(V: ArrayLike<number>, B: ArrayLike<number>, G: Pick<PreparedGoal, 'items' | 'credit0' | 'exitR'>): { gross: number; net: number; tax: number } {
  let tax = 0, div = 0, cred = G.credit0, gross = 0;
  for (let i = 0; i < G.items.length; i++) {
    const pp = G.items[i].pp, gain = V[i] - B[i]; gross += V[i];
    if (pp.regime === 'cash') continue;
    if (pp.regime === 'pension') { tax += G.exitR * Math.max(0, B[i]); continue; }
    if (pp.regime === 'etf') { if (gain > 0) tax += gain * pp.t; else cred += -gain * pp.t; }
    else { if (gain > 0) div += gain * pp.t; else cred += -gain * pp.t; }
  }
  const off = Math.min(cred, div); tax += div - off;
  return { gross, net: gross - tax, tax };
}

/** One path. Z = correlated shocks (null = deterministic). rec[t] gets the net value after step t. extend = steps to run past the goal date (contributions stop). */
export function runPath(G: Pick<PreparedGoal, 'items' | 'S' | 'T' | 'stub' | 'amt' | 'credit0' | 'exitR'>, x: number, Z: Float64Array | null, base: number, NC: number, rec: Float64Array | number[] | null, extend = 0): number {
  const n = G.items.length, S = G.S, V = new Float64Array(n), B = new Float64Array(n), T = G.T, TT = extend ? Math.max(T, extend) : T;
  for (let i = 0; i < n; i++) { V[i] = G.items[i].v0; B[i] = G.items[i].b0; }
  if (rec) rec[0] = liquidate(V, B, G).net;
  let lastNet = 0;
  for (let t = 1; t <= TT; t++) {
    const f = t === 1 ? G.stub / 12 : 1;
    for (let i = 0; i < n; i++) {
      const pp = G.items[i].pp;
      let g = (Z ? Math.exp(f * pp.m + Math.sqrt(f) * pp.s * Z[base + t * NC + pp.cls]) : Math.pow(1 + pp.mu, f)) * Math.pow(1 - pp.ter, f);
      if (pp.regime === 'cash' && g > 1) g = 1 + (g - 1) * (1 - S.taxStd);
      if (pp.regime === 'pension') g = 1 + (g - 1) * (1 - S.pensionTax);
      const cpn = pp.coupon > 0 ? pp.coupon * f * V[i] : 0;   /* [12-S1] on the value at the start of the step */
      V[i] *= g;
      if (pp.regime !== 'pension') { const b = S.bollo * f * V[i]; V[i] -= b; B[i] = Math.max(0, B[i] - b); }
      if (pp.regime === 'cash') B[i] = V[i];
      if (cpn > 0) { const net = cpn * (1 - pp.t); V[i] += net; B[i] += net; }
      if (t <= T) { const a = G.amt(t, i, x); V[i] += a; B[i] += a; }
    }
    if (rec) rec[t] = liquidate(V, B, G).net;
    if (t === T) lastNet = liquidate(V, B, G).net;
  }
  return T === 0 ? liquidate(V, B, G).net : (extend ? lastNet : liquidate(V, B, G).net);
}

export interface Shocks { Z: Float64Array; P: number; H: number; NC: number }
export function buildShocks(st: Pick<EngineState, 'corr' | 'settings'>, H: number, P: number): Shocks {
  const NC = CLASSES.length, { L } = safeCholesky(st.corr), rnd = mulberry32(Math.round(+st.settings.seed || 1));
  const Z = new Float64Array(P * (H + 1) * NC), e = new Float64Array(NC);
  for (let p = 0; p < P; p++) for (let t = 0; t <= H; t++) {
    for (let k = 0; k < NC; k++) e[k] = gauss(rnd);
    const off = (p * (H + 1) + t) * NC;
    for (let i = 0; i < NC; i++) { let s = 0; for (let k = 0; k <= i; k++) s += L[i][k] * e[k]; Z[off + i] = s; }
  }
  return { Z, P, H, NC };
}
export function probOf(G: PreparedGoal, x: number, SH: Shocks): number {
  let k = 0;
  for (let p = 0; p < SH.P; p++) if (runPath(G, x, SH.Z, p * (SH.H + 1) * SH.NC, SH.NC, null) >= G.targetNom - 0.005) k++;
  return k / SH.P;
}
/** Bisection on the contribution level until `test` passes. null = not reachable after 12 doublings. */
export function solve(G: PreparedGoal, test: (x: number) => boolean): number | null {
  if (G.T < 1 || G.wsum <= 0) return test(0) ? 0 : null;
  if (test(0)) return 0;
  let lo = 0, hi = G.isP ? 2 : Math.max(50, G.targetNom / (12 * G.T)) * 1.2, k = 0;
  while (!test(hi) && k < 12) { lo = hi; hi *= 2; k++; }
  if (!test(hi)) return null;
  for (let i = 0; i < 20 && (hi - lo) > (G.isP ? 0.002 : 0.5); i++) { const mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
  return hi;
}

/* ---------- full analysis ---------- */
export interface Level { n: number; name: string; desc: string; target: number }
export interface GoalResult {
  id: string; G: PreparedGoal; T: number; targetNom: number; reqP: number; value: number; detNet: number; detPath: number[];
  prob: number; fan: { p10: number[]; p50: number[]; p90: number[] }; finals: number[]; median: number; p10: number; p90: number; shortfall: number;
  status: 'on' | 'risk' | 'off'; reqDet: number | null; reqMC: number | null; nowMonthly: number;
}
export interface FireRow { t: number; year: number; p10: number; p50: number; p90: number; np50: number; probs: number[]; ratio: number[]; targets: number[] }
export interface FireOut {
  levels: Level[]; rows: FireRow[]; det: number[]; now: { total: number; nonPension: number; pension: number };
  reach: { median: number | null; det: number | null }[];
  expenseGrowth: number; inflation: number; includePension: boolean;
}
export interface Analysis { date: string; startYear: number; results: GoalResult[]; fire: FireOut | null; H: number; holdings: Holdings }

export function fireLevels(st: EngineState): Level[] {
  const f = st.settings.fire, c = st.cashflow, ef = st.goals.find(g => g.id === f.efFromGoal);
  const l1 = ef ? ef.target : f.efMonths * c.essential, l2 = f.l2Mult * c.essential, l3 = l2 + f.l3Mult * c.optional;
  return [{ n: 1, name: 'Safety', desc: ef ? `Emergency fund goal (${ef.name})` : `${f.efMonths} months of essential expenses`, target: l1 },
    { n: 2, name: 'Barista FIRE', desc: `${f.l2Mult} × essential monthly expenses`, target: l2 },
    { n: 3, name: 'FIRE', desc: `Level 2 + ${f.l3Mult} × optional monthly expenses`, target: l3 }];
}
/** [07] Level target in today's euros at step t: it grows with expenseGrowth against inflation. */
export const levelTarget = (st: EngineState, target0: number, t: number): number =>
  target0 * Math.pow((1 + st.cashflow.expenseGrowth) / (1 + st.settings.inflation), t);

export interface AnalyseOpts { paths?: number; solve?: boolean; fireYears?: number }
export function analyse(st: EngineState, date: string, opts: AnalyseOpts = {}): Analysis {
  const P = opts.paths || st.settings.paths, H0 = holdingsAt(st, date), S = st.settings, startYear = +date.slice(0, 4);
  const Gs = st.goals.map(g => prepGoal(st, g, H0, date));
  const FY = opts.fireYears || 0;
  const Hmax = Math.max(1, FY, ...Gs.map(G => G.T));
  const SH = buildShocks(st, Hmax, P);
  /* [07] FI buckets: flagged goals; the pension bucket only when includePension. Level 1 never counts pension. */
  const inFI = Gs.map(G => !!G.g.fire && (!G.isP || S.fire.includePension));
  const fireNet = FY ? Array.from({ length: FY + 1 }, () => new Float64Array(P)) : null;
  const fireNP = FY ? Array.from({ length: FY + 1 }, () => new Float64Array(P)) : null;
  const detTot = new Float64Array(FY + 1), detNP = new Float64Array(FY + 1);
  const results: GoalResult[] = Gs.map((G, gi) => {
    const len = Math.max(G.T, FY) + 1, det = new Float64Array(len);
    const detEnd = runPath(G, G.x0, null, 0, SH.NC, det, inFI[gi] ? FY : 0);
    const yearly: Float64Array[] = []; for (let t = 0; t <= G.T; t++) yearly.push(new Float64Array(P));
    const finals = new Float64Array(P), tmp = new Float64Array(len);
    for (let p = 0; p < P; p++) {
      finals[p] = runPath(G, G.x0, SH.Z, p * (Hmax + 1) * SH.NC, SH.NC, tmp, inFI[gi] ? FY : 0);
      for (let t = 0; t <= G.T; t++) yearly[t][p] = tmp[t];
      if (inFI[gi] && fireNet && fireNP) for (let t = 0; t <= FY; t++) { const v = tmp[Math.min(t, tmp.length - 1)]; fireNet[t][p] += v; if (!G.isP) fireNP[t][p] += v; }
    }
    if (inFI[gi]) for (let t = 0; t <= FY; t++) { const v = det[Math.min(t, det.length - 1)]; detTot[t] += v; if (!G.isP) detNP[t] += v; }
    const fan = { p10: [] as number[], p50: [] as number[], p90: [] as number[] };
    for (let t = 0; t <= G.T; t++) { const s = Array.from(yearly[t]).sort((a, b) => a - b); fan.p10.push(pct(s, .1)); fan.p50.push(pct(s, .5)); fan.p90.push(pct(s, .9)); }
    const sorted = Array.from(finals).sort((a, b) => a - b);
    let k = 0, sf = 0, ns = 0;
    for (const f of finals) { if (f >= G.targetNom - 0.005) k++; if (f < G.targetNom) { sf += G.targetNom - f; ns++; } }
    const prob = k / P;
    const r: GoalResult = { id: G.g.id, G, T: G.T, targetNom: G.targetNom, reqP: G.reqP, value: G.items.reduce((a, it) => a + it.v0, 0),
      detNet: detEnd, detPath: Array.from(det).slice(0, G.T + 1), prob, fan, finals: sorted, median: pct(sorted, .5), p10: pct(sorted, .1), p90: pct(sorted, .9),
      shortfall: ns ? sf / ns : 0, status: prob >= G.reqP ? 'on' : prob >= G.reqP - 0.15 ? 'risk' : 'off', reqDet: null, reqMC: null, nowMonthly: G.isP ? G.unitMonthly : G.x0 };
    if (opts.solve) {
      r.reqDet = solve(G, x => runPath(G, x, null, 0, SH.NC, null) >= G.targetNom - 0.005);
      r.reqMC = solve(G, x => probOf(G, x, SH) >= G.reqP);
      if (G.isP) { r.reqDet = r.reqDet == null ? null : r.reqDet * G.unitMonthly; r.reqMC = r.reqMC == null ? null : r.reqMC * G.unitMonthly; }
    }
    return r;
  });
  let fire: FireOut | null = null;
  if (FY && fireNet && fireNP) {
    const lv = fireLevels(st), real = (t: number) => Math.pow(1 + S.inflation, t), rows: FireRow[] = [];
    for (let t = 0; t <= FY; t++) {
      const tot = Array.from(fireNet[t]).map(v => v / real(t)).sort((a, b) => a - b), np = Array.from(fireNP[t]).map(v => v / real(t)).sort((a, b) => a - b);
      const targets = lv.map(l => levelTarget(st, l.target, t)), series = (i: number) => (i === 0 ? np : tot);
      rows.push({ t, year: startYear + t, p10: pct(tot, .1), p50: pct(tot, .5), p90: pct(tot, .9), np50: pct(np, .5), targets,
        probs: lv.map((_, i) => series(i).filter(v => v >= targets[i]).length / P), ratio: lv.map((_, i) => pct(series(i), .5) / targets[i]) });
    }
    const detRows = Array.from(detTot).map((v, t) => v / real(t)), detNPRows = Array.from(detNP).map((v, t) => v / real(t));
    const reach = lv.map((_, i) => {
      const a = rows.find(r => r.ratio[i] >= 1), d = (i === 0 ? detNPRows : detRows).findIndex((v, t) => v >= rows[t].targets[i]);
      return { median: a ? a.year : null, det: d >= 0 ? startYear + d : null };
    });
    const penNow = results.reduce((a, r, i) => a + (inFI[i] && r.G.isP ? r.detPath[0] : 0), 0);
    fire = { levels: lv, rows, det: detRows, reach, expenseGrowth: st.cashflow.expenseGrowth, inflation: S.inflation, includePension: S.fire.includePension,
      now: { total: detTot[0], nonPension: detNP[0], pension: penNow } };
  }
  return { date, startYear, results, fire, H: Hmax, holdings: H0 };
}
