/* Mix optimizer (O1, O2, O4, O5) on the server engine: 300 paths shared by every mix, per-product cap only (ticket 10). */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Chart } from '../chartkit.tsx';
import { scatterChart } from '../charts.ts';
import { eur, eurK, pct } from '../format.ts';
import type { OptResult } from '../../engine/optimizer.ts';
import { useStore } from '../store.tsx';
import { Chead, Loading, Page, Term } from '../ui.tsx';

const CRIT: [string, string][] = [['auto', 'Default for the priority'], ['p10', 'Protect the bad case (O1)'], ['median', 'Grow the typical outcome (O2)'], ['cheapest', 'Spend least (O5)'], ['prob', 'Maximise the chance (O4)']];

export function Optimizer() {
  const { ov, run } = useStore();
  const goals = ov?.goals.filter(g => !g.isP) ?? [];
  const [goalId, setGoalId] = useState(''), [mode, setMode] = useState('new'), [crit, setCrit] = useState('auto'), [maxW, setMaxW] = useState('100'), [uni, setUni] = useState<string[]>([]), [res, setRes] = useState<(OptResult & { ms: number }) | null>(null), [busy, setBusy] = useState(false);
  const g = goals.find(x => x.id === goalId) ?? goals.find(x => x.T >= 3) ?? goals[0];
  useEffect(() => { if (g) setUni(g.weights.filter(w => w.weight > 0).map(w => w.productId).concat(ov!.holdings[g.id]?.map(h => h.pid) ?? []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6)); setRes(null); }, [g?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!ov) return <Loading />;
  if (!g) return <Page tag="Analysis" title="Mix optimizer"><p className="lead">Add a goal first.</p></Page>;
  const name = (pid: string): string => ov.products.find(p => p.id === pid)?.name.split(' (')[0] ?? pid;
  const go = async (): Promise<void> => { setBusy(true); try { setRes(await api.post('/api/optimizer', { goalId: g.id, mode, criterion: crit, maxW: +maxW / 100, universe: uni })); } catch (e) { setRes({ error: (e as Error).message, ms: 0 }); } setBusy(false); };
  const top = res?.grid ? res.grid.slice().sort((a, b) => b.prob - a.prob || b.median - a.median).slice(0, 10) : [];
  const cheapest = res?.crit === 'cheapest';
  return <Page tag="Analysis" title="Which split of new money best serves each goal?">
    <div className="card sect"><h2>Choose</h2><div className="fields">
      <label className="f">Goal<select value={g.id} onChange={e => setGoalId(e.target.value)}>{goals.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="f">Mode<select value={mode} onChange={e => setMode(e.target.value)}><option value="new">New money only (no tax)</option><option value="rebalance">Rebalance now (sell, pay tax)</option></select></label>
      <label className="f">Criterion<select value={crit} onChange={e => setCrit(e.target.value)}>{CRIT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="f">Maximum per product (%)<input inputMode="decimal" value={maxW} onChange={e => setMaxW(e.target.value)} /></label></div>
      <p className="lead" style={{ marginTop: 12 }}>Products to consider (1 to 6)</p>
      <div className="chips" style={{ paddingInline: 0 }}>{ov.products.filter(p => p.regime !== 'pension').map(p => <button key={p.id} type="button" aria-pressed={uni.includes(p.id)} onClick={() => setUni(uni.includes(p.id) ? uni.filter(x => x !== p.id) : [...uni, p.id].slice(0, 6))}>{p.name.split(' (')[0]}</button>)}</div>
      <div className="row"><button className="btn" type="button" disabled={busy || !uni.length} onClick={() => void go()}>{busy ? 'Running…' : 'Find the best mix'}</button>{res && !res.error && <span className="help" style={{ margin: 0 }}>{res.grid?.length} mixes × {res.paths} paths in {res.ms} ms on the server.</span>}</div>
      <p className="help">An optimizer amplifies errors in expected return and volatility. The per-product cap is the guard. Class-level caps are a v2 candidate.</p></div>
    {res?.error && <p className="callout" style={{ marginTop: 16 }}>{res.error}</p>}
    {res && res.best && res.current && res.universe && <div style={{ marginTop: 24, display: 'grid', gap: 24 }}>
      <section className="card exhibit"><Chead ic="analysis" label="Suggested mix" />
        <h2 className="title">{res.rule}</h2>
        <p className="unit">{res.feasible} of {res.grid?.length} mixes reach the <Term k="required">required {pct(res.reqP ?? 0)}</Term>. Target {eur(res.targetNom ?? 0)} in {g.year}.</p>
        <div className="lt"><div className="head li" aria-hidden="true" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}><span>Product</span><span className="r">Suggested</span><span className="r">Now</span></div>
          {res.universe.map((pid, i) => <div className="li" key={pid} style={{ gridTemplateColumns: '2fr 1fr 1fr' }}><span>{name(pid)}</span><span className="r"><b>{pct(res.best!.w[i])}</b></span><span className="r">{pct(res.current!.w[i])}</span></div>)}</div>
        <div className="lt" style={{ marginTop: 16 }}><div className="head li" aria-hidden="true" style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}><span>Outcome</span><span className="r">Suggested</span><span className="r">Now</span></div>
          {([['Chance of success', (m: NonNullable<OptResult['best']>) => pct(m.prob, 1)], ['Typical case', (m) => eurK(m.median)], ['Bad case (P10)', (m) => eurK(m.p10)], ['Good case (P90)', (m) => eurK(m.p90)], ['Average shortfall', (m) => (m.shortfall ? eurK(m.shortfall) : '–')],
            ...(cheapest ? [['Monthly needed', (m: NonNullable<OptResult['best']>) => (m.need == null ? 'not reachable' : eur(m.need))] as [string, (m: NonNullable<OptResult['best']>) => string]] : [])] as [string, (m: NonNullable<OptResult['best']>) => string][])
            .map(([l, f]) => <div className="li" key={l} style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}><span>{l}</span><span className="r"><b>{f(res.best!)}</b></span><span className="r">{f(res.current!)}</span></div>)}</div>
        {res.mode === 'rebalance' && <p className="callout">Switch tax if you sell and rebuy today: {eur(res.switchTax ?? 0)}.</p>}
        <div className="row" style={{ marginTop: 16 }}><button className="btn" type="button" onClick={() => { if (confirm('Write these weights as the contribution weights for this goal?')) void run(() => api.post('/api/optimizer/apply', { goalId: g.id, weights: res.best!.w, universe: res.universe }), 'Weights applied'); }}>Use as contribution weights</button></div>
      </section>
      <section className="card exhibit"><Chead ic="chart" label="All mixes" /><h2 className="title">Every mix: chance of success against typical outcome</h2><p className="unit">x = chance of success, y = typical case at the goal date, €.</p>
        <Chart build={scatterChart(res.grid!, res.best, res.current, res.reqP ?? 0)} deps={[res]} label="All mixes" /></section>
      <section className="card sect"><h2>Top 10 by chance of success</h2><div className="lt">{top.map((m, i) => <div className="li" key={i} style={{ gridTemplateColumns: '3fr 1fr 1fr' }}><span>{res.universe!.map((pid, k) => (m.w[k] > 0 ? `${name(pid)} ${pct(m.w[k])}` : '')).filter(Boolean).join(', ')}</span><span className="r">{pct(m.prob, 1)}</span><span className="r">{eurK(m.median)}</span></div>)}</div></section>
    </div>}
  </Page>;
}
