/* Verbatim copy of the GBI mock engine, from .scratch/gbi-v1/reference/mock-app.html:
 * lines 281-285, 287-289 (helpers), 373-547 (goal model, analyse) and 612-622 (cash flow). Do not edit.
 * It needs the globals CLASSES and mkey; tools/differential/mock.ts provides them. */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
function cholesky(A) { const n = A.length, L = A.map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; if (i === j) { if (s <= 1e-10) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j]; } return L; }
function safeCholesky(A) { let f = 1; for (let k = 0; k < 40; k++) { const B = A.map((r, i) => r.map((v, j) => (i === j ? 1 : (+v || 0) * f))); const L = cholesky(B); if (L) return { L, shrink: f }; f *= 0.9; } return { L: A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))), shrink: 0 }; }
function pct(sorted, q) { if (!sorted.length) return 0; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); }
function addMonths(key, n) { let [y, m] = key.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }
function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
function monthEnd(key) { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m, 0)); return d.toISOString().slice(0, 10); }
function priceAt(st, pid, key) {
  const ps = st.prices[pid] || {}; if (ps[key] != null) return ps[key];
  let best = null, bk = ''; for (const k in ps) if (k <= key && k > bk) { bk = k; best = ps[k]; }
  return best;
}
function lastPriceMonth(st, pid) { return Object.keys(st.prices[pid] || {}).sort().pop() || null; }
/* positions per goal/product and account-level PMC, up to date (inclusive) */
function holdingsAt(st, date) {
  const pos = {}, pmc = {}, accQty = {};
  for (const t of st.ledger) {
    if (t.date > date) break;
    const q = +t.qty || 0, pr = +t.price || 0;
    (pos[t.goalId] = pos[t.goalId] || {})[t.productId] = ((pos[t.goalId] || {})[t.productId] || 0) + q;
    const aq = accQty[t.productId] || 0;
    if (q > 0) pmc[t.productId] = (aq * (pmc[t.productId] || 0) + q * pr) / (aq + q);
    accQty[t.productId] = aq + q;
  }
  return { pos, pmc, accQty };
}
function txAmount(t) { return (+t.qty || 0) * (+t.price || 0); }
function estCommission(st, t) {
  if (t.type !== 'buy' && t.type !== 'sell') return 0;
  const p = st.products.find(x => x.id === t.productId); if (p && p.zero) return 0;
  const c = st.settings.commission, a = Math.abs(txAmount(t));
  return Math.min(c.max, Math.max(c.min, c.rate * a));
}

/* ---------- pension ---------- */
function pensionSchedule(st, startYear, years) {
  const p = st.pension, out = [];
  for (let t = 1; t <= years; t++) {
    const ral = p.ral * Math.pow(1 + p.ralGrowth, t - 1), tfr = ral * p.tfrPct, w = ral * p.workerPct, e = ral * p.employerPct;
    const room = Math.max(0, p.cap + (+p.extra || 0) - w - e);
    const vol = p.voluntary === '' || p.voluntary == null ? room : +p.voluntary;
    out.push({ t, year: startYear + t - 1, ral, tfr, worker: w, employer: e, voluntary: vol, work: tfr + w + e, total: tfr + w + e + vol,
      deductible: Math.min(p.cap + (+p.extra || 0), w + e + vol), refund: Math.min(vol, room) * p.marginal });
  }
  return out;
}
function exitRate(st, year) { return Math.max(0.09, 0.15 - 0.003 * Math.max(0, year - st.pension.firstYear - 15)); }
function pensionWeights(st) {
  const s = pensionSchedule(st, 2000, 1)[0], w = {};
  st.pension.flows.forEach(f => { const base = f.flow === 'Work' ? s.work : s.voluntary; w[f.productId] = (w[f.productId] || 0) + (s.total > 0 ? (+f.pct || 0) * base / s.total : 0); });
  return w;
}

/* ---------- goal model ---------- */
function prodParams(p, S) {
  const mu = +p.mu || 0, sig = Math.max(0, +p.vol || 0), ter = +p.ter || 0;
  const s = Math.sqrt(Math.log(1 + sig * sig / ((1 + mu) * (1 + mu)))), m = Math.log(1 + mu) - s * s / 2;
  let t = 0;
  if (p.regime === 'etf') t = S.taxStd - (S.taxStd - S.taxGovt) * Math.min(1, Math.max(0, +p.wl || 0));
  else if (p.regime === 'govt') t = S.taxGovt; else if (p.regime === 'direct') t = S.taxStd;
  return { mu, ter, m, s, t, regime: p.regime, cls: Math.max(0, CLASSES.indexOf(p.cls)) };
}
function requiredProb(g, S) { if (g.minProb !== '' && g.minProb != null && !isNaN(+g.minProb)) return +g.minProb; return g.priority === 'Need' ? S.probNeed : g.priority === 'Want' ? S.probWant : S.probWish; }
function prepGoal(st, g, H, date) {
  const S = st.settings, startYear = +date.slice(0, 4), key = mkey(date), T = Math.max(0, g.year - startYear);
  const isP = st.pension.goalId === g.id, pw = isP ? pensionWeights(st) : null;
  const prods = {}; st.products.forEach(p => prods[p.id] = p);
  const ids = new Set(st.weights.filter(w => w.goalId === g.id).map(w => w.productId));
  Object.keys(H.pos[g.id] || {}).forEach(pid => ids.add(pid));
  const raw = [...ids].filter(pid => prods[pid]).map(pid => ({ pid, w: isP ? (pw[pid] || 0) : Math.max(0, +((st.weights.find(x => x.goalId === g.id && x.productId === pid) || {}).weight) || 0) }));
  const wsum = raw.reduce((a, r) => a + r.w, 0);
  const items = raw.map(r => {
    const q = (H.pos[g.id] || {})[r.pid] || 0, pr = priceAt(st, r.pid, key) || 0;
    return { pid: r.pid, pp: prodParams(prods[r.pid], S), w: wsum > 0 ? r.w / wsum : 0, v0: q * pr, b0: q * (H.pmc[r.pid] || pr) };
  });
  const sched = isP ? pensionSchedule(st, startYear, Math.max(1, T)).map(r => r.total) : null;
  const contrib = (t, x) => isP ? sched[t - 1] * x : 12 * x * Math.pow(1 + (+g.cgrowth || 0), t - 1);
  const z = S.zainetto || {};
  return { g, T, items, wsum, isP, x0: isP ? 1 : (+g.contrib || 0), contrib, S, startYear,
    targetNom: g.target * Math.pow(1 + S.inflation, T), reqP: requiredProb(g, S), exitR: exitRate(st, g.year),
    credit0: (z.goalId === g.id && +z.amount > 0 && g.year <= +z.expiry) ? +z.amount * S.taxStd : 0 };
}
function liquidate(V, B, G) {
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
function runPath(G, x, Z, base, NC, rec, extend) {
  const n = G.items.length, S = G.S, V = new Float64Array(n), B = new Float64Array(n), T = G.T, TT = extend ? Math.max(T, extend) : T;
  for (let i = 0; i < n; i++) { V[i] = G.items[i].v0; B[i] = G.items[i].b0; }
  if (rec) rec[0] = liquidate(V, B, G).net;
  let lastNet = 0;
  for (let t = 1; t <= TT; t++) {
    const C = t <= T ? G.contrib(t, x) : 0;
    for (let i = 0; i < n; i++) {
      const it = G.items[i], pp = it.pp;
      let g = (Z ? Math.exp(pp.m + pp.s * Z[base + t * NC + pp.cls]) : 1 + pp.mu) * (1 - pp.ter);
      if (pp.regime === 'cash' && g > 1) g = 1 + (g - 1) * (1 - S.taxStd);
      if (pp.regime === 'pension') g = 1 + (g - 1) * (1 - S.pensionTax);
      V[i] *= g;
      if (pp.regime !== 'pension') { const b = S.bollo * V[i]; V[i] -= b; B[i] = Math.max(0, B[i] - b); }
      if (pp.regime === 'cash') B[i] = V[i];
      const a = C * it.w; V[i] += a; B[i] += a;
    }
    if (rec && t <= T) rec[t] = liquidate(V, B, G).net;
    if (t === T) lastNet = liquidate(V, B, G).net;
    if (rec && t > T) rec[t] = liquidate(V, B, G).net;
  }
  return T === 0 ? liquidate(V, B, G).net : (extend ? lastNet : liquidate(V, B, G).net);
}
function buildShocks(st, H, P) {
  const NC = CLASSES.length, { L } = safeCholesky(st.corr), rnd = mulberry32(Math.round(+st.settings.seed || 1));
  const Z = new Float64Array(P * (H + 1) * NC), e = new Float64Array(NC);
  for (let p = 0; p < P; p++) for (let t = 0; t <= H; t++) {
    for (let k = 0; k < NC; k++) e[k] = gauss(rnd);
    const off = (p * (H + 1) + t) * NC;
    for (let i = 0; i < NC; i++) { let s = 0; for (let k = 0; k <= i; k++) s += L[i][k] * e[k]; Z[off + i] = s; }
  }
  return { Z, P, H, NC };
}
function probOf(G, x, SH) { let k = 0; for (let p = 0; p < SH.P; p++) if (runPath(G, x, SH.Z, p * (SH.H + 1) * SH.NC, SH.NC, null) >= G.targetNom - 0.005) k++; return k / SH.P; }
function solve(G, test) {
  if (G.T < 1 || G.wsum <= 0) return test(0) ? 0 : null;
  if (test(0)) return 0;
  let lo = 0, hi = G.isP ? 2 : Math.max(50, G.targetNom / (12 * G.T)) * 1.2, k = 0;
  while (!test(hi) && k < 12) { lo = hi; hi *= 2; k++; }
  if (!test(hi)) return null;
  for (let i = 0; i < 20 && (hi - lo) > (G.isP ? 0.002 : 0.5); i++) { const mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
  return hi;
}

/* Full goal analysis at a date. opts: {paths, solve:boolean, fireYears} */
function analyse(st, date, opts = {}) {
  const P = opts.paths || st.settings.paths, H0 = holdingsAt(st, date), S = st.settings, startYear = +date.slice(0, 4);
  const Gs = st.goals.map(g => prepGoal(st, g, H0, date));
  const FY = opts.fireYears || 0;
  const Hmax = Math.max(1, FY, ...Gs.map(G => G.T));
  const SH = buildShocks(st, Hmax, P);
  const fireIdx = Gs.map((G, i) => (G.g.fire && (!G.isP || S.fire.includePension)) ? i : -1).filter(i => i >= 0);
  const fireNet = FY ? Array.from({ length: FY + 1 }, () => new Float64Array(P)) : null;
  const results = Gs.map((G, gi) => {
    const det = new Float64Array(Math.max(G.T, FY) + 1); const detEnd = runPath(G, G.x0, null, 0, SH.NC, det, FY && fireIdx.includes(gi) ? FY : 0);
    const yearly = []; for (let t = 0; t <= G.T; t++) yearly.push(new Float64Array(P));
    const finals = new Float64Array(P), tmp = new Float64Array(Math.max(G.T, FY) + 1), inFire = FY && fireIdx.includes(gi);
    for (let p = 0; p < P; p++) {
      finals[p] = runPath(G, G.x0, SH.Z, p * (Hmax + 1) * SH.NC, SH.NC, tmp, inFire ? FY : 0);
      for (let t = 0; t <= G.T; t++) yearly[t][p] = tmp[t];
      if (inFire) for (let t = 0; t <= FY; t++) fireNet[t][p] += tmp[Math.min(t, tmp.length - 1)];
    }
    const fan = { p10: [], p50: [], p90: [] };
    for (let t = 0; t <= G.T; t++) { const s = Array.from(yearly[t]).sort((a, b) => a - b); fan.p10.push(pct(s, .1)); fan.p50.push(pct(s, .5)); fan.p90.push(pct(s, .9)); }
    const sorted = Array.from(finals).sort((a, b) => a - b);
    let k = 0; for (const f of finals) if (f >= G.targetNom - 0.005) k++;
    const prob = k / P;
    const r = { id: G.g.id, G, T: G.T, targetNom: G.targetNom, reqP: G.reqP, value: G.items.reduce((a, it) => a + it.v0, 0),
      detNet: detEnd, detPath: Array.from(det).slice(0, G.T + 1), prob, fan, finals: sorted, median: pct(sorted, .5), p10: pct(sorted, .1), p90: pct(sorted, .9),
      status: prob >= G.reqP ? 'on' : prob >= G.reqP - 0.15 ? 'risk' : 'off', reqDet: null, reqMC: null };
    if (opts.solve) {
      r.reqDet = solve(G, x => runPath(G, x, null, 0, SH.NC, null) >= G.targetNom - 0.005);
      r.reqMC = solve(G, x => probOf(G, x, SH) >= G.reqP);
      if (G.isP) { const y1 = G.contrib(1, 1) / 12; r.reqDet = r.reqDet == null ? null : r.reqDet * y1; r.reqMC = r.reqMC == null ? null : r.reqMC * y1; r.nowMonthly = y1; }
      else r.nowMonthly = +G.g.contrib || 0;
    }
    return r;
  });
  let fire = null;
  if (FY) {
    const lv = fireLevels(st), real = t => Math.pow(1 + S.inflation, t), rows = [];
    for (let t = 0; t <= FY; t++) { const s = Array.from(fireNet[t]).map(v => v / real(t)).sort((a, b) => a - b); rows.push({ t, year: startYear + t, p10: pct(s, .1), p50: pct(s, .5), p90: pct(s, .9), probs: lv.map(l => s.filter(v => v >= l.target).length / P) }); }
    const detArr = fireIdx.map(i => { const G = results[i].G, arr = new Float64Array(Math.max(G.T, FY) + 1); runPath(G, G.x0, null, 0, SH.NC, arr, FY); return arr; });
    const detRows = []; for (let t = 0; t <= FY; t++) detRows.push(detArr.reduce((a, arr) => a + arr[t], 0) / real(t));
    fire = { levels: lv, rows, det: detRows, now: rows[0].p50, reach: lv.map((l, i) => { const a = rows.find(r => r.p50 >= l.target), d = detRows.findIndex(v => v >= l.target); return { median: a ? a.year : null, det: d >= 0 ? startYear + d : null }; }) };
  }
  return { date, startYear, results, fire, H: Hmax, holdings: H0 };
}

function cashflow(st, years) {
  const c = st.cashflow, startYear = +st.asOf.slice(0, 4), ps = pensionSchedule(st, startYear, years), out = [];
  for (let t = 1; t <= years; t++) {
    const y = startYear + t - 1, inc = c.income * Math.pow(1 + c.incomeGrowth, t - 1), exp = 12 * (c.essential + c.optional) * Math.pow(1 + c.expenseGrowth, t - 1);
    const ev = c.events.filter(e => +e.year === y).reduce((a, e) => a + +e.amount, 0), refund = t > 1 ? ps[t - 2].refund : 0;
    const per = {}; let planned = 0;
    st.goals.forEach(g => { let a = 0; if (y <= g.year) a = st.pension.goalId === g.id ? ps[t - 1].voluntary : 12 * (+g.contrib || 0) * Math.pow(1 + (+g.cgrowth || 0), t - 1); per[g.id] = a; planned += a; });
    out.push({ t, year: y, income: inc, expenses: exp, events: ev, refund, capacity: inc - exp + ev + refund, per, planned, free: inc - exp + ev + refund - planned });
  }
  return out;
}
