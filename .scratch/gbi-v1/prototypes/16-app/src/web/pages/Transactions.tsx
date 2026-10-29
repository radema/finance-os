/* Transactions: list with filters, add form with commission estimate, delete (prototype 11: transactions.html). */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { dt, eur2, num } from '../format.ts';
import { useStore } from '../store.tsx';
import { Chead, GoalChip, Icon, KindTag, Loading, Page, Term, slotStyle, useSlot } from '../ui.tsx';
import type { TxView } from '../../shared/view.ts';

const TYPE: Record<string, [string, string]> = { opening: ['Opening position', 'plus'], buy: ['Buy', 'inn'], sell: ['Sell', 'out'], pensionContribution: ['Pension contribution', 'inn'], coupon: ['Coupon', 'inn'] };

export function Transactions() {
  const { ov, run } = useStore(), slot = useSlot();
  const [rows, setRows] = useState<TxView[] | null>(null), [goal, setGoal] = useState('all'), [form, setForm] = useState(false), [limit, setLimit] = useState(40);
  useEffect(() => { void api.get<TxView[]>('/api/transactions').then(setRows); }, [ov]);
  if (!ov || !rows) return <Loading />;
  const prod = (id: string) => ov.products.find(p => p.id === id)!, goalOf = (id: string) => ov.goals.find(g => g.id === id)!;
  const shown = rows.filter(t => goal === 'all' || t.goalId === goal);
  return <Page tag="Records" title="Every buy, sell, coupon and pension contribution">
    {form && <AddForm done={() => setForm(false)} />}
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <div className="chips" style={{ margin: 0, padding: 0, overflowX: 'auto', flex: 1, minWidth: 0 }}>
        <button type="button" aria-pressed={goal === 'all'} onClick={() => setGoal('all')}>All goals</button>
        {ov.goals.map(g => <button key={g.id} type="button" className="gc" style={slotStyle(slot(g.id))} aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}><i className="gdot" style={{ background: 'var(--g)' }} />{g.name}</button>)}</div>
      <div className="row"><a className="btn ghost small" href="#/import">Import</a><button className="btn small" type="button" onClick={() => setForm(!form)}><Icon n="plus" />Add transaction</button></div></div>
    <div className="card"><Chead ic="tx" label="Transactions" right={`${Math.min(limit, shown.length)} of ${shown.length} shown`} />
      <div className="lt tx"><div className="head li" aria-hidden="true"><span className="date">Date</span><span className="what">Product</span><span className="t">Type</span><span className="gl">Goal</span><span className="amt">Amount</span><span className="fee">Fee</span><span /></div>
        {shown.slice(0, limit).map(t => { const p = prod(t.productId), ty = TYPE[t.type] ?? [t.type, 'dash'], amt = t.type === 'coupon' ? t.amount ?? 0 : t.qty * t.price, fee = t.commission ?? t.estFee;
          return <div className="li" key={t.id}><span className="what">{p.name.split(' (')[0]} <KindTag p={p} /><small className="m"><Icon n={ty[1]} />{ty[0]} · <GoalChip goal={goalOf(t.goalId)} /></small><small>{p.isin ? p.isin + ' · ' : ''}{t.type === 'coupon' ? 'cash received' : `${num(t.qty)} × ${num(t.price)}`}</small></span>
            <span className="t"><Icon n={ty[1]} />{ty[0]}</span><span className="gl"><GoalChip goal={goalOf(t.goalId)} /></span><span className="amt"><b>{eur2(amt)}</b></span><span className="date">{dt(t.date)}</span>
            <span className="fee">{fee == null ? '' : t.commission != null ? eur2(fee) : fee === 0 ? (p.zero ? 'Zero fee' : '') : `≈ ${eur2(fee)}`}</span>
            <span className="x"><button className="xbtn" type="button" title="Delete" onClick={() => { if (confirm('Delete this transaction? Holdings are re-derived.')) void run(() => api.del(`/api/transactions/${t.id}`), 'Deleted'); }}>×</button></span></div>; })}</div>
      {shown.length > limit && <div className="row" style={{ padding: 16 }}><button className="btn ghost small" type="button" onClick={() => setLimit(limit + 100)}>Show more</button></div>}</div>
    <p className="source">Fees marked ≈ are estimates from your commission settings ({(ov.settings.commission.rate * 100).toFixed(2)}%, min {eur2(ov.settings.commission.min)}, max {eur2(ov.settings.commission.max)}) until the real one is entered. Every transaction belongs to one goal; the <Term k="pmc">average cost</Term> is shared across goals.</p>
  </Page>;
}

function AddForm({ done }: { done: () => void }) {
  const { ov, run } = useStore();
  const [f, setF] = useState({ date: ov!.asOf, type: 'buy', goalId: ov!.goals[0]?.id ?? '', productId: ov!.products[0]?.id ?? '', amount: '', price: '', commission: '' });
  const p = ov!.products.find(x => x.id === f.productId);
  const set = (k: string, v: string): void => setF({ ...f, [k]: v });
  const price = +f.price || 0, amount = +f.amount || 0, qty = price > 0 ? amount / price : 0;
  const c = ov!.settings.commission, est = !p || p.zero || (f.type !== 'buy' && f.type !== 'sell') ? 0 : Math.min(c.max, Math.max(c.min, c.rate * amount)), costly = amount > 0 && est / amount > 1.25 * c.rate;
  const holders = ov!.goals;
  const save = (): Promise<unknown> => run(() => api.post('/api/transactions', { date: f.date, goalId: f.goalId, productId: f.productId, type: f.type, qty: f.type === 'sell' ? -qty : qty, price, commission: f.commission === '' ? null : +f.commission, amount: null, note: '' }), 'Transaction saved').then(done);
  return <form className="sect card" onSubmit={e => { e.preventDefault(); void save(); }}><h2>Add a transaction</h2><div className="fields">
    <label className="f">Date<input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></label>
    <label className="f">Type<select value={f.type} onChange={e => set('type', e.target.value)}><option value="buy">Buy</option><option value="sell">Sell</option><option value="pensionContribution">Pension contribution</option><option value="opening">Opening position</option></select></label>
    <label className="f">Goal<select value={f.goalId} onChange={e => set('goalId', e.target.value)}>{holders.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    <label className="f">Product<select value={f.productId} onChange={e => set('productId', e.target.value)}>{ov!.products.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="f">Amount (€)<input inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></label>
    <label className="f">Price per unit<input inputMode="decimal" value={f.price} onChange={e => set('price', e.target.value)} required /><span className="help">Bonds: price ÷ 100. Units = amount ÷ price: {qty ? num(qty) : '–'}.</span></label>
    <label className="f">Commission paid (optional)<input inputMode="decimal" value={f.commission} onChange={e => set('commission', e.target.value)} placeholder={est ? `≈ ${est.toFixed(2)}` : '0'} /></label></div>
    {costly && <p className="help">This ticket is below the <Term k="minticket">minimum efficient ticket</Term>: the fee is {(est / amount * 100).toFixed(2)}% of the amount.</p>}
    <div className="row" style={{ marginTop: 16 }}><button className="btn" type="submit" disabled={!f.goalId || !f.productId || qty <= 0}>Save</button><button className="btn ghost" type="button" onClick={done}>Cancel</button></div></form>;
}
