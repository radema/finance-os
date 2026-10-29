/* Fixture: the mock's sample data (sampleState in reference/mock-app.html), with ticket 07/10/12 fields added. Made-up names, amounts and prices. */
import { addMonths, gauss, monthsBetween, mkey, mulberry32, priceAt, safeCholesky } from './core.ts';
import type { EngineState, Product, TxType } from './types.ts';
import { CLASSES } from './types.ts';
import { defaultCorr, defaultSettings } from './defaults.ts';

type P = [string, string, Product['cls'], Product['regime'], number, number, number, number, boolean, string, number, string | undefined, number?];
const PRODUCTS: P[] = [
  ['p1', 'XEON (€STR)', 'Cash', 'etf', 0, 0.02, 0.005, 0.001, true, '', 140, undefined],
  ['p2', 'GOLD (Amundi Physical Gold ETC)', 'Gold/Commodities', 'direct', 0, 0.04, 0.15, 0.0012, false, '', 180, undefined],
  ['p3', '30IA (iBonds Dec 2030 € Corp)', 'Corp bonds', 'etf', 0, 0.03, 0.02, 0.0012, false, '2030-12', 5, undefined],
  ['p4', 'IVOA (iBonds Dec 2028 € Corp)', 'Corp bonds', 'etf', 0, 0.025, 0.01, 0.0012, false, '2028-12', 5, undefined],
  ['p5', 'ALLW (Xtrackers FTSE All-World)', 'Equity', 'etf', 0, 0.065, 0.16, 0.0012, true, '', 10, '2026-05'],
  ['p6', 'VWCE (Vanguard FTSE All-World)', 'Equity', 'etf', 0, 0.065, 0.16, 0.0019, false, '', 105, undefined],
  ['p7', 'XDEV (Xtrackers MSCI World Value)', 'Equity', 'etf', 0, 0.065, 0.17, 0.0025, false, '', 38, undefined],
  ['p8', 'BTP Italia Sì 23/06/2031 (cum)', 'Govt bonds', 'govt', 1, 0.037, 0.015, 0, false, '2031-06', 1, '2026-06', 0.027],
  ['p9', 'BTP Valore Insieme 27/10/2031', 'Govt bonds', 'govt', 1, 0.042, 0.01, 0, false, '2031-10', 1, '2026-10', 0.032],
  ['p10', 'BTP Valore 28/10/2032 (cum)', 'Govt bonds', 'govt', 1, 0.032, 0.015, 0, false, '2032-10', 1, '2025-10', 0.025],
  ['p11', 'Allianz Insieme – Azionario', 'Equity', 'pension', 0, 0.065, 0.16, 0.0088, true, '', 10, undefined],
  ['p12', 'Allianz Insieme – Bilanciato', 'Multi-asset', 'pension', 0, 0.05, 0.11, 0.0075, true, '', 10, undefined],
  ['p13', 'Fon.Te. – Dinamico', 'Multi-asset', 'pension', 0, 0.05, 0.10, 0.003, true, '', 12, undefined]
];
const ISIN: Record<string, string> = { p1: 'LU0290358497', p2: 'FR0013416716', p3: 'IE000Y2BJVK9', p4: 'IE0008UEVOE0', p5: 'IE000L6ZMMC4', p6: 'IE00BK5BQT80', p7: 'IE00BL25JM42', p8: 'IT0005713539', p9: 'IT0005735227', p10: 'IT0005672024' };
const TK: Record<string, string> = { p1: 'XEON.MI', p2: 'GOLD.MI', p3: '30IA.MI', p4: 'IVOA.MI', p5: 'ALLW.MI', p6: 'VWCE.MI', p7: 'XDEV.MI' };

export function sampleState(): EngineState {
  const from: Record<string, string | undefined> = {}, p0: Record<string, number> = {};
  const products: Product[] = PRODUCTS.map(([id, name, cls, regime, wl, mu, vol, ter, zero, maturity, start, fromM, couponRate]) => {
    from[id] = fromM; p0[id] = start;
    return { id, name, isin: ISIN[id] || '', cls, regime, wl, mu, vol, ter, zero, maturity, ticker: TK[id] || '', source: TK[id] ? 'yahoo' : 'manual', couponRate: couponRate || 0 };
  });
  const plan = (amount: number) => [{ from: '2026-01', amount }];
  const st: EngineState = {
    asOf: '2026-10-31',
    settings: { ...defaultSettings(), trackingStart: '2026-01', fire: { efFromGoal: 'g1', efMonths: 12, l2Mult: 300, l3Mult: 200, includePension: true } },
    corr: defaultCorr(),
    products,
    goals: [
      { id: 'g1', name: 'Emergency fund', priority: 'Need', target: 15816, year: 2027, plan: plan(200), cgrowth: 0.02, minProb: null, fire: true },
      { id: 'g2', name: 'Support for parents', priority: 'Want', target: 60000, year: 2032, plan: plan(500), cgrowth: 0.02, minProb: 0.9, fire: false },
      { id: 'g3', name: 'Children bucket', priority: 'Want', target: 40000, year: 2046, plan: plan(200), cgrowth: 0.02, minProb: 0.75, fire: false },
      { id: 'g4', name: 'MIP OpenEconomics', priority: 'Need', target: 15000, year: 2029, plan: plan(0), cgrowth: 0.02, minProb: null, fire: false },
      { id: 'g5', name: 'Long-term investment', priority: 'Wish', target: 100000, year: 2056, plan: plan(250), cgrowth: 0.02, minProb: 0.75, fire: true },
      { id: 'g6', name: 'Retirement', priority: 'Need', target: 250000, year: 2061, plan: plan(0), cgrowth: 0.02, minProb: null, fire: true }
    ],
    weights: ([['g1', 'p1', 1], ['g2', 'p3', .7], ['g2', 'p7', .2], ['g2', 'p2', .1], ['g2', 'p8', 0], ['g2', 'p9', 0], ['g2', 'p10', 0], ['g2', 'p4', 0],
      ['g3', 'p5', .5], ['g3', 'p6', .5], ['g3', 'p7', 0], ['g4', 'p4', 0], ['g4', 'p3', 0], ['g5', 'p5', 1], ['g5', 'p6', 0], ['g5', 'p7', 0],
      ['g6', 'p11', 0], ['g6', 'p12', 0], ['g6', 'p13', 0]] as [string, string, number][]).map(([goalId, productId, weight]) => ({ goalId, productId, weight })),
    pension: { ral: 45000, ralGrowth: 0.02, tfrPct: 0.0691, workerPct: 0.01, employerPct: 0.014, voluntary: null, marginal: 0.33, firstYear: 2020, cap: 5300, extra: 0, goalId: 'g6',
      flows: [{ productId: 'p11', flow: 'Work', pct: 0.8 }, { productId: 'p12', flow: 'Work', pct: 0.2 }, { productId: 'p13', flow: 'Voluntary', pct: 1 }] },
    cashflow: { income: 35518, incomeGrowth: 0.02, essential: 975, optional: 300, expenseGrowth: 0.02,
      events: [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034].map(year => ({ year, label: 'Renovation tax refund', amount: 1000 })) },
    prices: {}, ledger: []
  };
  /* prices: correlated monthly GBM, Dec 2023 to asOf */
  const rnd = mulberry32(77), { L } = safeCholesky(st.corr), first = '2023-12', last = mkey(st.asOf), n = monthsBetween(first, last);
  products.forEach(p => { st.prices[p.id] = {}; });
  const lvl: Record<string, number> = {}; products.forEach(p => { lvl[p.id] = p0[p.id]; });
  for (let i = 0; i <= n; i++) {
    const key = addMonths(first, i), e = CLASSES.map(() => gauss(rnd)), z = CLASSES.map((_, a) => L[a].reduce((s, l, b) => s + l * e[b], 0));
    products.forEach(p => {
      if (i > 0) {
        const s = p.vol / Math.sqrt(12), m = Math.log(1 + p.mu) / 12 - s * s / 2;
        let g = Math.exp(m + s * z[CLASSES.indexOf(p.cls)]) * Math.pow(1 - p.ter, 1 / 12);
        if (p.regime === 'pension') g = 1 + (g - 1) * (1 - 0.2);
        lvl[p.id] *= g;
      }
      if (!from[p.id] || key >= from[p.id]!) st.prices[p.id][key] = +lvl[p.id].toFixed(4);
    });
  }
  /* ledger */
  let id = 1;
  const tx = (date: string, goalId: string, productId: string, type: TxType, eur: number): void => {
    const pr = priceAt(st, productId, mkey(date)); if (!pr) return;
    st.ledger.push({ id: 't' + (id++), date, goalId, productId, type, qty: +(eur / pr).toFixed(4), price: pr, commission: null, amount: null, note: '', batchId: null });
  };
  tx('2024-01-02', 'g1', 'p1', 'opening', 8000); tx('2024-01-02', 'g4', 'p4', 'opening', 10000); tx('2024-01-02', 'g4', 'p3', 'opening', 9500);
  tx('2024-01-02', 'g5', 'p6', 'opening', 9000); tx('2024-01-02', 'g3', 'p6', 'opening', 4000); tx('2024-01-02', 'g2', 'p3', 'opening', 12000); tx('2024-01-02', 'g2', 'p4', 'opening', 6000);
  tx('2024-01-02', 'g6', 'p11', 'opening', 9000); tx('2024-01-02', 'g6', 'p12', 'opening', 3000); tx('2024-01-02', 'g6', 'p13', 'opening', 4000);
  for (let i = 1; i <= n; i++) {
    const k = addMonths('2023-12', i), d = k + '-15', mo = +k.slice(5);
    if (mo % 3 === 0) {
      if (k <= '2025-06') tx(d, 'g1', 'p1', 'buy', 900);
      tx(d, 'g2', 'p3', 'buy', i < 30 ? 1050 : 900); tx(d, 'g2', 'p7', 'buy', 300); if (mo === 12 || mo === 6) tx(d, 'g2', 'p2', 'buy', 300);
      tx(d, 'g5', k >= '2026-05' ? 'p5' : 'p6', 'buy', k === '2026-09' ? 450 : 750);
    }
    if (mo === 4 || mo === 10) tx(d, 'g3', k >= '2026-05' ? 'p5' : 'p6', 'buy', 1200);
    tx(d, 'g6', 'p11', 'pensionContribution', 280); tx(d, 'g6', 'p12', 'pensionContribution', 70);
    if (mo === 12) tx(k + '-20', 'g6', 'p13', 'pensionContribution', 4200);
  }
  tx('2025-10-30', 'g2', 'p10', 'buy', 10000); tx('2026-06-20', 'g2', 'p8', 'buy', 10000); tx('2026-10-27', 'g2', 'p9', 'buy', 10000);
  tx('2026-10-27', 'g2', 'p4', 'sell', -3000);
  st.ledger.sort((a, b) => a.date.localeCompare(b.date));
  return st;
}
