/* Import: Fineco movimenti XLSX preset in four steps (tickets 08, 09). Row check and bucket decisions come from the server; nothing is written until step 3 is confirmed. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { dt, eur2, num } from '../format.ts';
import { useStore } from '../store.tsx';
import { Chead, GoalChip, Loading, Page, Svg, Term } from '../ui.tsx';
import type { RowCheck } from '../../server/import/fineco.ts';
import type { ImportDecisionIn, ImportRow } from '../../shared/schemas.ts';
import type { BatchView } from '../../shared/view.ts';

interface Parsed { sheet: string; headerRow: number; rows: ImportRow[]; errors: string[]; checks: RowCheck[] }
const STEPS = ['Choose the file', 'Match columns', 'Check rows', 'Import'];
const LBL: Record<string, [string, string, string]> = { ready: ['on', 'Ready', 'ic-ok'], duplicate: ['dash', 'Already in your records', 'ic-ok'], before_opening: ['dash', 'Already in the opening position', 'ic-ok'],
  needs_goal: ['risk', 'Needs a goal', 'ic-hl'], unknown_product: ['risk', 'Product not found', 'ic-hl'], needs_fix: ['risk', 'Needs a fix', 'ic-hl'] };
const MAP: [string, string, boolean][] = [['Operazione', 'Trade date (text DD/MM/YYYY)', true], ['Data valuta', 'Ignored', false], ['Descrizione', 'Trade or coupon (“Stacco Cedole”)', false], ['Titolo', 'Display name only', false], ['Isin', 'Product (matched by ISIN)', true],
  ['Segno', 'A = buy, V = sell (blank on coupons)', true], ['Quantita', 'Units', true], ['Divisa', 'Currency: only EUR in v1', false], ['Prezzo', 'Price per unit (bonds per 100)', true], ['Cambio', 'FX rate: only 1 in v1', false],
  ['Controvalore', 'Cross-check; for a coupon, the cash received', false], ['Commissioni amministrato', 'Commission paid', false]];

export function Import() {
  const { ov, run } = useStore();
  const [step, setStep] = useState(1), [file, setFile] = useState(''), [p, setP] = useState<Parsed | null>(null), [dec, setDec] = useState<Record<number, ImportDecisionIn>>({}), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ batchId: string; imported: number; skipped: number; transactions: number; errors: string[] } | null>(null), [batches, setBatches] = useState<BatchView[]>([]), [filter, setFilter] = useState('all');
  useEffect(() => { void api.get<BatchView[]>('/api/imports').then(setBatches); }, [done, ov]);
  if (!ov) return <Loading />;
  const goalName = (id: string): string => ov.goals.find(g => g.id === id)?.name ?? id;

  const load = async (f: File): Promise<void> => {
    setBusy(true); setMsg('');
    try { const r = await api.upload<Parsed>('/api/import/parse', f); setP(r); setFile(f.name); setDec({}); setStep(r.errors.length && !r.rows.length ? 1 : 2); setMsg(r.errors[0] ?? ''); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const sample = async (): Promise<void> => { const res = await fetch('/fixtures/fineco-movimenti-synthetic.xlsx'); await load(new File([await res.blob()], 'fineco-movimenti-synthetic.xlsx')); };
  const recheck = async (): Promise<void> => { if (p) setP({ ...p, checks: await api.post<RowCheck[]>('/api/import/check', { rows: p.rows }) }); };

  /** A row is importable when it is ready, or when the user's decision for a needs_goal row is complete and its parts add up. */
  const state = (c: RowCheck): string => {
    if (c.state !== 'needs_goal') return c.state;
    const d = dec[c.row.n];
    if (!d || d.mode === 'skip') return 'needs_goal';
    if (d.mode === 'one') return d.goalId ? 'ready' : 'needs_goal';
    if (d.mode === 'weights') return c.weightSplit.length ? 'ready' : 'needs_goal';
    const sum = (d.parts ?? []).reduce((a, x) => a + x.units, 0);
    return c.row.kind === 'coupon' ? (d.goalId ? 'ready' : 'needs_goal') : Math.abs(sum - Math.abs(c.row.qty)) < 1e-6 ? 'ready' : 'needs_goal';
  };
  const checks = p?.checks ?? [], st = checks.map(state), n = (k: string): number => st.filter(x => x === k).length, ready = n('ready'), need = n('needs_goal') + n('unknown_product') + n('needs_fix');
  const shown = checks.filter((c, i) => filter === 'all' || (filter === 'ready' && st[i] === 'ready') || (filter === 'you' && ['needs_goal', 'unknown_product', 'needs_fix'].includes(st[i])) || (filter === 'skip' && ['duplicate', 'before_opening'].includes(st[i])));
  const commit = async (): Promise<void> => {
    if (!p) return;
    const r = await run(() => api.post<NonNullable<typeof done>>('/api/import/commit', { fileName: file, rows: p.rows, decisions: Object.values(dec) }), 'Import saved');
    if (r) { setDone(r); setStep(4); }
  };
  const setD = (nn: number, d: ImportDecisionIn): void => setDec({ ...dec, [nn]: d });

  return <Page tag="Records" title="Bring in transactions from your broker">
    <div className="tabs" role="tablist"><a href="#/transactions" role="tab" aria-selected="false" style={{ textDecoration: 'none', color: 'inherit' }}>Transactions</a><button role="tab" aria-selected="true">Import</button></div>
    <div className="card"><Chead ic="inn" label="Fineco movimenti (XLSX)" right={`Step ${step} of 4`} />
      <ol className="steps" aria-label="Import steps">{STEPS.map((s, i) => <li key={s} className={i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''}><b>Step {i + 1}</b>{s}</li>)}</ol>
      {step === 1 && <>
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>Upload the Fineco “Movimenti Dossier Titoli” export</h2>
        <p className="unit">Files stay on this computer; nothing is sent anywhere. Rows are matched to products by <Term k="isin">ISIN</Term>. The file is read by the local server.</p>
        <div className="drop" style={{ marginTop: 16 }}><label className="btn ghost" style={{ cursor: 'pointer' }}>Choose a file (.xlsx)<input type="file" accept=".xlsx" className="sr" onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); }} /></label><div className="help">{busy ? 'Reading…' : file || 'or use the synthetic sample below'}</div></div>
        {msg && <p className="help" style={{ color: 'var(--hl)' }}>{msg}</p>}
        <div className="row" style={{ marginTop: 16 }}><button className="btn ghost" type="button" onClick={() => void sample()}>Use the synthetic sample file</button></div>
        <p className="help">The sample is made up (made-up products, quantities and prices) in the layout of ticket 09: 5 metadata rows, header on row 6, dates as text, one coupon row.</p></>}
      {step === 2 && p && <>
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>The file looks like a Fineco securities export</h2>
        <p className="unit">Sheet “{p.sheet}”. The header was found on row {p.headerRow}; {p.rows.length} data rows follow. This preset has a fixed mapping; a generic CSV mapping is v1 scope but not in this prototype.</p>
        <div className="lt" style={{ marginTop: 16 }}><div className="head li" aria-hidden="true"><span>Column in the file</span><span>Used as</span></div>
          {MAP.map(([h, use, req]) => <div className="li" key={h} style={{ gridTemplateColumns: '1fr 1.6fr' }}><span><b>{h}</b> {req && <span className="pill">Required</span>}</span><span className="muted">{use}</span></div>)}</div>
        <div className="row" style={{ marginTop: 16 }}><button className="btn ghost" type="button" onClick={() => setStep(1)}>Back</button><button className="btn" type="button" onClick={() => setStep(3)}>Check rows</button></div></>}
      {step === 3 && p && <>
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>{ready} of {checks.length} rows are ready; {n('duplicate') + n('before_opening')} are already in your records and {need} need a decision</h2>
        <p className="unit">Nothing is imported until you press the button. Rows you leave out stay out. Every import can be undone.</p>
        <div className="chips" style={{ margin: '16px 0 8px', paddingInline: 0 }}>{[['all', `All ${checks.length}`], ['ready', `Ready ${ready}`], ['you', `Needs you ${need}`], ['skip', `Already imported ${n('duplicate') + n('before_opening')}`]].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div className="lt rowchk">{shown.map(c => { const s = state(c), L = LBL[s], r = c.row, d = dec[r.n];
          return <div key={r.n} className={`li ${['duplicate', 'before_opening'].includes(s) ? 'skip' : ''} ${s === 'needs_goal' ? 'need' : ''}`}>
            <div className="l1"><span><b>{c.productName.split(' (')[0]}</b><small>{r.isin} · {dt(r.date)} · file row {r.n}</small></span><span className={`status ${L[2] === 'ic-ok' ? '' : 'risk'}`}><Svg n={L[0]} cls={L[2]} />{L[1]}</span></div>
            <div>{r.kind === 'coupon' ? <>Coupon on {num(r.qty)} nominal: <b>{eur2(r.amount ?? 0)}</b></> : <>{r.side === 'A' ? 'Buy' : 'Sell'} {num(r.qty)} × {r.price} = <b>{eur2(Math.abs(r.amount ?? r.qty * r.price))}</b>{r.commission ? `, fee ${eur2(r.commission)}` : ''}</>}</div>
            {(c.note || (s === 'ready' && c.weightSplit.length > 1 && r.kind === 'coupon')) && <div className="help" style={{ margin: 0 }}>{c.note}{r.kind === 'coupon' && c.weightSplit.length > 1 ? ' ' + c.weightSplit.map(x => `${goalName(x.goalId)} ${num(x.units, 0)}`).join(', ') : ''}</div>}
            {c.state === 'ready' && c.autoGoalId && <div className="help" style={{ margin: 0 }}>Goal: <GoalChip goal={{ id: c.autoGoalId, name: goalName(c.autoGoalId) }} /></div>}
            {c.state === 'needs_goal' && r.kind === 'trade' && <div className="fields" style={{ gridTemplateColumns: '1fr' }}>
              <label className="f">What to do<select value={d?.mode ?? ''} onChange={e => setD(r.n, { n: r.n, mode: (e.target.value || 'skip') as ImportDecisionIn['mode'], goalId: d?.goalId, parts: d?.parts })}><option value="">Choose…</option><option value="one">All to one goal</option><option value="weights">Split by weights</option><option value="units">Split by units I type</option><option value="skip">Leave this row out</option></select></label>
              {d?.mode === 'one' && <label className="f">Goal<select value={d.goalId ?? ''} onChange={e => setD(r.n, { ...d, goalId: e.target.value })}><option value="">Choose a goal</option>{(c.candidates.length ? c.candidates : ov.goals.map(g => ({ goalId: g.id, name: g.name }))).map(x => <option key={x.goalId} value={x.goalId}>{x.name}</option>)}</select></label>}
              {d?.mode === 'weights' && <p className="help" style={{ margin: 0 }}>Units by largest remainder: {c.weightSplit.map(x => `${goalName(x.goalId)} ${num(x.units)}`).join(', ') || 'no weights to split by'}.</p>}
              {d?.mode === 'units' && <div className="row">{c.candidates.map(x => <label className="f" key={x.goalId}>{x.name} (holds {num(x.held, 0)})<input inputMode="decimal" style={{ width: 110 }} value={d.parts?.find(q => q.goalId === x.goalId)?.units ?? ''}
                onChange={e => setD(r.n, { ...d, parts: [...(d.parts ?? []).filter(q => q.goalId !== x.goalId), ...(+e.target.value > 0 ? [{ goalId: x.goalId, units: +e.target.value }] : [])] })} /></label>)}
                <span className="help" style={{ margin: 0 }}>{(d.parts ?? []).reduce((a, q) => a + q.units, 0)} of {Math.abs(r.qty)} units</span></div>}</div>}
            {c.state === 'needs_goal' && r.kind === 'coupon' && <label className="f">Goal<select value={d?.goalId ?? ''} onChange={e => setD(r.n, { n: r.n, mode: 'one', goalId: e.target.value })}><option value="">Choose a goal</option>{ov.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
            {c.state === 'unknown_product' && <div className="row"><a className="btn ghost small" href={`#/setup/products?isin=${r.isin}&name=${encodeURIComponent(r.name)}`}>Add this product</a><button className="btn ghost small" type="button" onClick={() => void recheck()}>Check again</button></div>}
            {c.warn && <div className="warn"><Svg n="info" /><span>{c.warn}</span></div>}</div>; })}</div>
        <div className="row" style={{ marginTop: 20 }}><button className="btn ghost" type="button" onClick={() => setStep(2)}>Back</button><button className="btn" type="button" disabled={!ready} onClick={() => void commit()}>Import {ready} row{ready === 1 ? '' : 's'}</button>
          {need > 0 && <span className="help" style={{ margin: 0 }}>{need} row{need === 1 ? '' : 's'} will be left out.</span>}</div></>}
      {step === 4 && done && <>
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>{done.transactions} transactions imported from {done.imported} rows</h2>
        <p className="unit">{done.skipped} rows were left out. The import is saved as one batch, so you can undo it as a whole.</p>
        {done.errors.map(e => <p className="help" key={e}>{e}</p>)}
        <div className="row" style={{ marginTop: 20 }}><a className="btn" href="#/transactions">See transactions</a><button className="btn ghost" type="button" onClick={() => void run(() => api.post(`/api/imports/${done.batchId}/undo`), 'Import undone').then(() => { setStep(1); setP(null); setDone(null); })}>Undo this import</button></div></>}
    </div>
    <div className="card sect" style={{ marginTop: 24 }}><h2>Past imports</h2>{batches.length === 0 ? <p className="lead">No imports yet.</p> : <ul className="lt">{batches.map(b => <li className="li" key={b.id}><span>{b.fileName}<small>{b.createdAt.slice(0, 16).replace('T', ' ')} · {b.rowsImported} rows imported, {b.rowsSkipped} skipped{b.undoneAt ? ' · undone' : ''}</small></span>
      <span className="r">{!b.undoneAt && <button className="btn ghost small" type="button" onClick={() => void run(() => api.post(`/api/imports/${b.id}/undo`), 'Import undone')}>Undo</button>}</span></li>)}</ul>}</div>
  </Page>;
}
