/* Golden cases written by hand (ticket 12 check, ticket 07 and 10 checks). Expected numbers are in the tests, not computed by the engine. */
import { describe, expect, it } from 'vitest';
import { analyse, holdingsAt, liquidate, exitRate, stubMonths } from '../src/engine/core.ts';
import { cashflow, planVsActual } from '../src/engine/tracking.ts';
import { sampleState } from '../src/engine/sample.ts';
import type { EngineState, Product, Tx } from '../src/engine/types.ts';

const prod = (o: Partial<Product>): Product => ({ id: 'x', name: 'X', isin: '', cls: 'Equity', regime: 'etf', wl: 0, mu: 0, vol: 0, ter: 0, zero: true, maturity: '', ticker: '', source: 'manual', couponRate: 0, ...o });
/** One goal, one product, no history: everything the golden cases need. */
function mini(asOf: string, year: number, p: Partial<Product>, monthly: number, extra: Partial<EngineState> = {}): EngineState {
  const base = sampleState();
  return { ...base, asOf, products: [prod(p)], ledger: [], prices: { x: { [asOf.slice(0, 7)]: 1 } },
    goals: [{ id: 'g', name: 'G', priority: 'Want', target: 1000, year, plan: [{ from: '2020-01', amount: monthly }], cgrowth: 0, minProb: null, fire: true }],
    weights: [{ goalId: 'g', productId: 'x', weight: 1 }],
    settings: { ...base.settings, bollo: 0, paths: 50, fire: { ...base.settings.fire, efFromGoal: '', includePension: true } },
    pension: { ...base.pension, goalId: '' }, ...extra };
}
const detNet = (st: EngineState) => analyse(st, st.asOf).results[0].detNet;
const buy = (id: string, date: string, qty: number, price: number, commission: number | null = null): Tx =>
  ({ id, date, goalId: 'g', productId: 'x', type: 'buy', qty, price, commission, amount: null, note: '', batchId: null });

describe('ticket 12 golden cases', () => {
  it('E9 stub year: asOf 31 Oct 2026, goal 2028, 100/month, mu 0 gives 1,400 (the mock gives 2,400)', () => {
    expect(stubMonths('2026-10-31')).toBe(2);
    expect(detNet(mini('2026-10-31', 2028, {}, 100))).toBeCloseTo(1400, 6);
  });
  it('E9 stub year: in December the stub is empty, so one full year to 2028 gives 1,200', () => {
    expect(detNet(mini('2026-12-15', 2028, {}, 100))).toBeCloseTo(1200, 6);
  });
  it('S1 coupon: 10,000 govt, mu 4 %, coupon 4 %, one full year gives value and basis 10,350', () => {
    const st = mini('2026-12-31', 2028, { regime: 'govt', mu: 0.04, couponRate: 0.04 }, 0);
    st.ledger = [{ ...buy('t1', '2026-12-01', 10000, 1), type: 'opening' }];
    /* value 10,350 and basis 10,350: no gain, so no tax and net = 10,350. With a basis of 10,000 the net would be 10,306. */
    const r = analyse(st, st.asOf).results[0];
    expect(r.detNet).toBeCloseTo(10350, 6);
    expect(r.value).toBe(10000);
  });
  it('S2 commission joins the basis: 100 units at 10 plus 2.95 fee gives PMC 10.0295', () => {
    const st = mini('2026-10-31', 2028, {}, 0);
    st.ledger = [buy('t1', '2026-10-05', 100, 10, 2.95)];
    expect(holdingsAt(st, st.asOf).pmc.x).toBeCloseTo(10.0295, 8);
  });
  it('M1 contributions stop at the goal date: cash flow and plan vs actual use years before the goal year', () => {
    const st = mini('2026-10-31', 2028, {}, 100);
    const cf = cashflow(st, 4);
    expect(cf.map(r => r.per.g)).toEqual([200, 1200, 0, 0]);   // 2026 stub (2 months), 2027, then nothing from 2028
    st.settings.trackingStart = '2027-11';
    st.asOf = '2028-02-15';
    const p = planVsActual(st)[0];
    expect(p.planned).toBe(200);   // Nov and Dec 2027 only; Jan and Feb 2028 are in the goal year
  });
});

describe('ticket 10 plan history', () => {
  it('plan 500/month with 0 then 1,000 put in: cumulative gap is 0 after month 2', () => {
    const st = mini('2026-02-20', 2030, {}, 500);
    st.settings.trackingStart = '2026-01';
    st.ledger = [buy('t1', '2026-02-10', 1000, 1)];
    const p = planVsActual(st)[0];
    expect(p.actualMonthly).toEqual([0, 1000]);
    expect(p.gap).toBe(0);
  });
  it('plan versions: the amount in force each month counts', () => {
    const st = mini('2026-04-20', 2030, {}, 0);
    st.goals[0].plan = [{ from: '2026-01', amount: 100 }, { from: '2026-03', amount: 300 }];
    st.settings.trackingStart = '2026-01';
    expect(planVsActual(st)[0].planned).toBe(100 + 100 + 300 + 300);
  });
});

describe('ticket 07 FI levels', () => {
  const fi = (growth: number) => {
    const st = mini('2026-12-31', 2060, {}, 0);
    st.cashflow = { ...st.cashflow, essential: 1000, optional: 500, expenseGrowth: growth };
    st.settings.inflation = 0.02;
    return analyse(st, st.asOf, { paths: 20, fireYears: 10 }).fire!;
  };
  it('expenseGrowth = inflation: L2 = 300,000 and L3 = 400,000 flat', () => {
    const f = fi(0.02);
    expect(f.levels[1].target).toBe(300000); expect(f.levels[2].target).toBe(400000);
    expect(f.rows.every(r => Math.abs(r.targets[1] - 300000) < 1e-6)).toBe(true);
  });
  it('expenseGrowth 3 % against inflation 2 %: L2 at year 10 is about 331,000', () => {
    expect(Math.round(fi(0.03).rows[10].targets[1] / 1000) * 1000).toBe(331000);
  });
});

describe('taxes and Monte Carlo', () => {
  const G = (items: { regime: Product['regime']; t: number }[], exitR = 0.15) => ({ credit0: 0, exitR, items: items.map(i => ({ pid: 'x', w: 0, v0: 0, b0: 0, pp: { mu: 0, ter: 0, m: 0, s: 0, t: i.t, regime: i.regime, cls: 0, coupon: 0 } })) });
  it('ETF gain 1,000 at 26 % is taxed 260', () => {
    expect(liquidate([2000], [1000], G([{ regime: 'etf', t: 0.26 }])).tax).toBeCloseTo(260, 8);
  });
  it('govt gain 1,000 at 12.5 % is offset by a 500 ETF loss credit at 26 %: tax = 125 - min(130, 125) = 0', () => {
    expect(liquidate([2000, 500], [1000, 1000], G([{ regime: 'govt', t: 0.125 }, { regime: 'direct', t: 0.26 }])).tax).toBeCloseTo(0, 8);
  });
  it('pension exit tax at 10, 15, 20 and 35 years of membership: 15 %, 15 %, 13.5 %, 9 %', () => {
    const st = { pension: { firstYear: 2000 } } as EngineState;
    expect([2010, 2015, 2020, 2035].map(y => +exitRate(st, y).toFixed(4))).toEqual([0.15, 0.15, 0.135, 0.09]);
  });
  it('same seed gives the same result; volatility 0 gives median = deterministic', () => {
    const st = mini('2026-10-31', 2036, { mu: 0.05, vol: 0 }, 100);
    const a = analyse(st, st.asOf).results[0], b = analyse(st, st.asOf).results[0];
    expect(a.median).toBe(b.median);
    expect(a.median).toBeCloseTo(a.detNet, 6);
  });
});
