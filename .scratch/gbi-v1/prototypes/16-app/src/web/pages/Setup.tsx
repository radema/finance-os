/* Setup: Products, Goals (with allocation weights) and Cash flow. Minimal forms: enough to run the first-run flow end to end. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { eur, pct } from '../format.ts';
import { useStore } from '../store.tsx';
import { GoalChip, KindTag, Loading, Page, PrTag } from '../ui.tsx';
import type { Overview } from '../../shared/view.ts';

const CLASSES = ['Equity', 'Govt bonds', 'Corp bonds', 'Multi-asset', 'Cash', 'Gold/Commodities'];
const REGIMES: Record<string, string> = { etf: 'ETF / fund', direct: 'Direct 26% (ETC, stocks)', govt: 'Govt bond 12.5%', cash: 'Cash / deposit', pension: 'Pension fund' };
const PRODUCT_PRESETS: Record<string, Record<string, string | boolean>> = {
  'World equity ETF': { cls: 'Equity', regime: 'etf', mu: '6.5', vol: '16', ter: '0.2', zero: false },
  'Corporate bond ETF': { cls: 'Corp bonds', regime: 'etf', mu: '3', vol: '2', ter: '0.12', zero: false },
  'BTP': { cls: 'Govt bonds', regime: 'govt', mu: '3.5', vol: '1.5', ter: '0', zero: false, coupon: '3', wl: '1' },
  'Pension fund': { cls: 'Multi-asset', regime: 'pension', mu: '5', vol: '11', ter: '0.75', zero: true }
};
const GOAL_PRESETS: Record<string, [string, string, string, string, string]> = { 'Emergency fund': ['Emergency fund', 'Need', '15000', '2028', '200'], Retirement: ['Retirement', 'Need', '250000', '2061', '0'], Children: ['Children bucket', 'Want', '40000', '2046', '200'], 'Something else': ['', 'Wish', '', '', ''] };

export function Setup({ tab }: { tab: string }) {
  const { ov } = useStore();
  if (!ov) return <Loading />;
  const tabs: [string, string][] = [['products', 'Products'], ['goals', 'Goals and allocation'], ['cashflow', 'Cash flow']];
  return <Page tag="Setup" title={tab === 'goals' ? 'Goals and where new money goes' : tab === 'cashflow' ? 'Income, spending and independence levels' : 'The products you hold or may buy'}>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <a key={k} role="tab" href={`#/setup/${k}`} aria-selected={tab === k} style={{ textDecoration: 'none', color: 'inherit', ...(tab === k ? { fontWeight: 600 } : {}) }}>{l}</a>)}</div>
    {tab === 'goals' ? <Goals ov={ov} /> : tab === 'cashflow' ? <CashFlow ov={ov} /> : <Products ov={ov} />}
  </Page>;
}

function Products({ ov }: { ov: Overview }) {
  const { run } = useStore();
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const blank = { name: q.get('name') ?? '', isin: q.get('isin') ?? '', cls: 'Equity', regime: 'etf', mu: '6.5', vol: '16', ter: '0.2', wl: '0', zero: false, ticker: '', maturity: '', coupon: '0' };
  const [f, setF] = useState<Record<string, string | boolean>>(blank);
  const set = (k: string, v: string | boolean): void => setF({ ...f, [k]: v });
  const save = (): Promise<unknown> => run(() => api.post('/api/products', { name: f.name, isin: String(f.isin).trim(), cls: f.cls, regime: f.regime, mu: +f.mu / 100, vol: +f.vol / 100, ter: +f.ter / 100, wl: +f.wl, zero: !!f.zero, ticker: f.ticker, source: f.ticker ? 'yahoo' : 'manual', maturity: f.maturity, couponRate: +f.coupon / 100 }), 'Product saved').then(() => setF({ ...blank, name: '', isin: '' }));
  return <>
    <form className="sect card" onSubmit={e => { e.preventDefault(); void save(); }}><h2>Add a product</h2>
      <div className="presets">{Object.entries(PRODUCT_PRESETS).map(([k, v]) => <button type="button" key={k} onClick={() => setF({ ...f, ...v })}>{k}</button>)}</div>
      <div className="fields">
        <label className="f">Name<input value={String(f.name)} onChange={e => set('name', e.target.value)} required /></label>
        <label className="f">ISIN<input value={String(f.isin)} onChange={e => set('isin', e.target.value)} placeholder="IE00…" /></label>
        <label className="f">Asset class<select value={String(f.cls)} onChange={e => set('cls', e.target.value)}>{CLASSES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Tax regime<select value={String(f.regime)} onChange={e => set('regime', e.target.value)}>{Object.entries(REGIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Expected return (% a year)<input inputMode="decimal" value={String(f.mu)} onChange={e => set('mu', e.target.value)} /></label>
        <label className="f">Volatility (% a year)<input inputMode="decimal" value={String(f.vol)} onChange={e => set('vol', e.target.value)} /></label>
        <label className="f">Running cost, TER (%)<input inputMode="decimal" value={String(f.ter)} onChange={e => set('ter', e.target.value)} /></label>
        {f.regime === 'etf' && <label className="f">White-list share (0 to 1)<input inputMode="decimal" value={String(f.wl)} onChange={e => set('wl', e.target.value)} /></label>}
        {f.regime === 'govt' && <label className="f">Coupon rate (% a year)<input inputMode="decimal" value={String(f.coupon)} onChange={e => set('coupon', e.target.value)} /></label>}
        <label className="f">Maturity (YYYY-MM, optional)<input value={String(f.maturity)} onChange={e => set('maturity', e.target.value)} /></label>
        <label className="f">Yahoo ticker (optional)<input value={String(f.ticker)} onChange={e => set('ticker', e.target.value)} placeholder="VWCE.MI" /></label></div>
      <label style={{ display: 'flex', gap: 8, marginTop: 12 }}><input type="checkbox" checked={!!f.zero} onChange={e => set('zero', e.target.checked)} />Zero commission at the broker</label>
      <div className="row" style={{ marginTop: 16 }}><button className="btn" type="submit">Save product</button></div></form>
    <div className="card sect" style={{ marginTop: 24 }}><h2>{ov.products.length} products</h2><ul className="lt">{ov.products.map(p => <li className="li" key={p.id}><span>{p.name} <KindTag p={p} /><small>{p.isin || 'no ISIN'} · {p.cls} · return {pct(p.mu, 1)}, volatility {pct(p.vol, 1)}, cost {pct(p.ter, 2)}{p.couponRate ? `, coupon ${pct(p.couponRate, 1)}` : ''}</small></span></li>)}</ul></div></>;
}

function Goals({ ov }: { ov: Overview }) {
  const { run } = useStore();
  const [f, setF] = useState({ name: '', priority: 'Need', target: '', year: String(new Date().getFullYear() + 5), monthly: '0', fire: false, isPension: false });
  const [w, setW] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => { setW(Object.fromEntries(ov.goals.map(g => [g.id, Object.fromEntries(g.weights.map(x => [x.productId, String(Math.round(x.weight * 100))]))]))); }, [ov]);
  const save = (): Promise<unknown> => run(() => api.post('/api/goals', { name: f.name, priority: f.priority, target: +f.target, year: +f.year, monthly: +f.monthly, monthlyFrom: ov.valMonth, fire: f.fire, isPension: f.isPension }), 'Goal saved').then(() => setF({ ...f, name: '', target: '' }));
  const saveW = (id: string): Promise<unknown> => run(() => api.put(`/api/goals/${id}/weights`, { weights: Object.entries(w[id] ?? {}).filter(([, v]) => +v >= 0 && v !== '').map(([productId, v]) => ({ productId, weight: +v / 100 })) }), 'Allocation saved');
  const req = f.priority === 'Need' ? ov.settings.probNeed : f.priority === 'Want' ? ov.settings.probWant : ov.settings.probWish;
  return <>
    <form className="sect card" onSubmit={e => { e.preventDefault(); void save(); }}><h2>Add a goal</h2>
      <div className="presets">{Object.entries(GOAL_PRESETS).map(([k, v]) => <button type="button" key={k} onClick={() => setF({ ...f, name: v[0], priority: v[1], target: v[2], year: v[3] || f.year, monthly: v[4] })}>{k}</button>)}</div>
      <div className="fields"><label className="f">Name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></label>
        <label className="f">Priority<select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}><option>Need</option><option>Want</option><option>Wish</option></select><span className="help">Required chance of success: {pct(req)}</span></label>
        <label className="f">Target in today’s euros<input inputMode="decimal" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} required /></label>
        <label className="f">Goal year (1 January)<input inputMode="numeric" value={f.year} onChange={e => setF({ ...f, year: e.target.value })} required /></label>
        <label className="f">Monthly contribution (€)<input inputMode="decimal" value={f.monthly} onChange={e => setF({ ...f, monthly: e.target.value })} /></label></div>
      <div className="row" style={{ marginTop: 12 }}><label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={f.fire} onChange={e => setF({ ...f, fire: e.target.checked })} />Counts toward independence</label>
        <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={f.isPension} onChange={e => setF({ ...f, isPension: e.target.checked })} />This is the pension goal</label></div>
      <div className="row" style={{ marginTop: 16 }}><button className="btn" type="submit">Save goal</button></div></form>
    {ov.goals.map(g => <div className="card sect" key={g.id} style={{ marginTop: 24 }}><h2><GoalChip goal={g} /> <PrTag p={g.priority} /> <span className="mini">{eur(g.target)} by {g.year}, {eur(g.monthlyNow)} a month</span></h2>
      {g.isP ? <p className="lead">Pension weights follow the pension flows (Pension screen, not built here).</p> : <>
        <p className="lead">Where new money goes, in % (rescaled to 100%). Positions already held stay in the bucket.</p>
        <div className="fields">{ov.products.filter(p => p.regime !== 'pension').map(p => <label className="f" key={p.id}>{p.name.split(' (')[0]}<input inputMode="decimal" value={w[g.id]?.[p.id] ?? ''} placeholder="0" onChange={e => setW({ ...w, [g.id]: { ...w[g.id], [p.id]: e.target.value } })} /></label>)}</div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn ghost small" type="button" onClick={() => void saveW(g.id)}>Save allocation</button><a className="btn ghost small" href="#/optimizer">Ask the optimizer</a></div></>}</div>)}</>;
}

function CashFlow({ ov }: { ov: Overview }) {
  const { run } = useStore();
  const [c, setC] = useState({ essential: String(ov.essential), optional: String(ov.optional), income: '', expenseGrowth: '', efMonths: String(ov.settings.fire.efMonths), efFromGoal: ov.settings.fire.efFromGoal });
  const set = (k: string, v: string): void => setC({ ...c, [k]: v });
  const save = (): Promise<unknown> => run(async () => {
    await api.put('/api/cashflow', { essential: +c.essential, optional: +c.optional, ...(c.income !== '' ? { income: +c.income } : {}), ...(c.expenseGrowth !== '' ? { expenseGrowth: +c.expenseGrowth / 100 } : {}) });
    await api.put('/api/settings', { fire: { efMonths: +c.efMonths, efFromGoal: c.efFromGoal } });
  }, 'Saved');
  return <form className="sect card" onSubmit={e => { e.preventDefault(); void save(); }}><h2>Spending drives the independence levels</h2>
    <div className="fields"><label className="f">Essential spending (€ a month)<input inputMode="decimal" value={c.essential} onChange={e => set('essential', e.target.value)} /></label>
      <label className="f">Optional spending (€ a month)<input inputMode="decimal" value={c.optional} onChange={e => set('optional', e.target.value)} /></label>
      <label className="f">Yearly income, net (€)<input inputMode="decimal" placeholder="unchanged" value={c.income} onChange={e => set('income', e.target.value)} /></label>
      <label className="f">Spending growth (% a year)<input inputMode="decimal" placeholder="unchanged" value={c.expenseGrowth} onChange={e => set('expenseGrowth', e.target.value)} /></label>
      <label className="f">Level 1 safety = emergency-fund goal<select value={c.efFromGoal} onChange={e => set('efFromGoal', e.target.value)}><option value="">None: use months of essential spending</option>{ov.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label className="f">…or months of essential spending<input inputMode="decimal" value={c.efMonths} onChange={e => set('efMonths', e.target.value)} /></label></div>
    <div className="row" style={{ marginTop: 16 }}><button className="btn" type="submit">Save</button></div></form>;
}
