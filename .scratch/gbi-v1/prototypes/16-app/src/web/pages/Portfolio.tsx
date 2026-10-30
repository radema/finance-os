/* "Current portfolio" form (ticket 08): one as-of date; per product total units and the fiscal PMC, then the units split across goals
   (one goal, by weights, or by units). Each part becomes an `opening` transaction with price = PMC. Opening never counts as a contribution. */
import { useState } from 'react';
import { api } from '../api.ts';
import { num } from '../format.ts';
import { splitByWeights } from '../../shared/split.ts';
import { useStore } from '../store.tsx';
import { Loading, Page, Term } from '../ui.tsx';

interface Row { productId: string; units: string; pmc: string; mode: 'one' | 'weights' | 'units'; goalId: string; parts: Record<string, string> }

export function Portfolio() {
  const { ov, run } = useStore();
  const [asOf, setAsOf] = useState(() => `${ov?.settings.trackingStart ?? new Date().toISOString().slice(0, 7)}-01`), [rows, setRows] = useState<Row[]>([]);
  if (!ov) return <Loading />;
  const blank = (): Row => ({ productId: ov.products[0]?.id ?? '', units: '', pmc: '', mode: 'one', goalId: ov.goals.find(g => !g.isP)?.id ?? ov.goals[0]?.id ?? '', parts: {} });
  const upd = (i: number, r: Partial<Row>): void => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const weightsFor = (productId: string) => ov.goals.map(g => ({ goalId: g.id, w: g.weights.find(x => x.productId === productId)?.weight ?? 0 })).filter(x => x.w > 0);
  const partsOf = (r: Row): { goalId: string; units: number }[] => r.mode === 'one' ? (r.goalId && +r.units > 0 ? [{ goalId: r.goalId, units: +r.units }] : []) : r.mode === 'weights' ? splitByWeights(+r.units, weightsFor(r.productId)) : Object.entries(r.parts).filter(([, v]) => +v > 0).map(([goalId, v]) => ({ goalId, units: +v }));
  const valid = (r: Row): boolean => { const ps = partsOf(r); return +r.pmc > 0 && ps.length > 0 && (r.mode === 'units' || Math.abs(ps.reduce((a, p) => a + p.units, 0) - +r.units) < 1e-6); };
  const save = (): Promise<unknown> => run(() => api.post('/api/portfolio', { asOf, items: rows.map(r => ({ productId: r.productId, pmc: +r.pmc, parts: partsOf(r) })) }), 'Current portfolio saved').then(() => { setRows([]); location.hash = '#/'; });
  return <Page tag="Operations" title="Your portfolio as it stands today">
    <div className="card sect"><p className="lead">Enter what you hold on one date. For a portfolio transferred from another broker, the average cost (<Term k="pmc">PMC</Term>) is the <b>fiscal cost basis (carico fiscale)</b> your broker shows after the transfer, because taxes are computed on it. Pension funds use units and the average unit value. These rows are <Term k="opening">opening positions</Term>: they count for units and cost, never as contributions. Imports dated on or before this day are skipped as “already in the opening position”.</p>
      <label className="f" style={{ maxWidth: 220 }}>As of<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
      {rows.map((r, i) => <div key={i} className="sect" style={{ borderTop: '1px solid var(--grid)', paddingTop: 16, marginTop: 16 }}><div className="fields">
        <label className="f">Product<select value={r.productId} onChange={e => upd(i, { productId: e.target.value })}>{ov.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {r.mode !== 'units' && <label className="f">Total units<input inputMode="decimal" value={r.units} onChange={e => upd(i, { units: e.target.value })} /></label>}
        <label className="f">Average cost per unit (fiscal)<input inputMode="decimal" value={r.pmc} onChange={e => upd(i, { pmc: e.target.value })} /></label>
        <label className="f">Split across goals<select value={r.mode} onChange={e => upd(i, { mode: e.target.value as Row['mode'] })}><option value="one">All to one goal</option><option value="weights">By weights</option><option value="units">By units I type</option></select></label>
        {r.mode === 'one' && <label className="f">Goal<select value={r.goalId} onChange={e => upd(i, { goalId: e.target.value })}>{ov.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
        {r.mode === 'units' && ov.goals.map(g => <label className="f" key={g.id}>{g.name} (units)<input inputMode="decimal" value={r.parts[g.id] ?? ''} onChange={e => upd(i, { parts: { ...r.parts, [g.id]: e.target.value } })} /></label>)}</div>
        <p className="help">{r.mode === 'weights' && !weightsFor(r.productId).length ? 'No goal has this product in its weights yet: choose another split.' : `Parts: ${partsOf(r).map(p => `${ov.goals.find(g => g.id === p.goalId)?.name} ${num(p.units)}`).join(', ') || '–'}`}
          <button className="xbtn" type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></p></div>)}
      <div className="row" style={{ marginTop: 16 }}><button className="btn ghost" type="button" onClick={() => setRows([...rows, blank()])}>Add a product</button>
        <button className="btn" type="button" disabled={!rows.length || !rows.every(valid)} onClick={() => void save()}>Save current portfolio</button></div>
      <p className="help">Saving adds opening transactions to the existing ones. Wipe the data first if you want to start over.</p></div></Page>;
}
