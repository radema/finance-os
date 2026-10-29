/* Prices: month-end grid with manual entry for the last two months (source spec "Prices"). The online fetch (Yahoo) is not built in this prototype. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { monthLabel, num } from '../format.ts';
import { useStore } from '../store.tsx';
import { KindTag, Loading, Page, Term } from '../ui.tsx';
import type { PriceGrid } from '../../shared/view.ts';

export function Prices() {
  const { ov, run } = useStore();
  const [g, setG] = useState<PriceGrid | null>(null), [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => { void api.get<PriceGrid>('/api/prices?n=6').then(setG); }, [ov]);
  if (!ov || !g) return <Loading />;
  const cur = g.months.at(-1)!, editable = new Set(g.months.slice(-2)), key = (pid: string, m: string): string => `${pid}|${m}`;
  const save = (): Promise<unknown> => run(() => api.post('/api/prices', { prices: Object.entries(edit).filter(([, v]) => +v > 0).map(([k, v]) => { const [productId, month] = k.split('|'); return { productId, month, price: +v, source: 'manual' }; }) }), 'Prices saved').then(() => setEdit({}));
  return <Page tag="Operations" title="Month-end prices, with their source">
    <div className="card sect"><p className="lead">Type the price of each product for {monthLabel(cur)}. BTPs: price ÷ 100 (a price of 101.30 is typed as 1.013). Pension funds: the unit value from the fund statement. A manual price wins over a fetched one for the same month. A missing price falls back to the last known month and raises the <Term k="stale">old price</Term> flag, and the value is still counted.</p>
      <div className="sc"><table className="pgrid"><thead><tr><th>Product</th>{g.months.map(m => <th key={m}>{monthLabel(m)}</th>)}</tr></thead><tbody>
        {g.products.map(p => <tr key={p.id}><td>{p.name.split(' (')[0]} <KindTag p={{ regime: p.regime as never }} /></td>
          {g.months.map(m => { const c = p.cells[m], k = key(p.id, m);
            return <td key={m} className={c ? '' : 'src'} title={c ? `${c.source}, ${c.fetchedAt}` : 'no price'}>{editable.has(m) ? <input inputMode="decimal" placeholder={c ? String(c.price) : '–'} value={edit[k] ?? ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} aria-label={`${p.name} ${m}`} />
              : c ? num(c.price) : '–'}</td>; })}</tr>)}</tbody></table></div>
      <div className="row" style={{ marginTop: 16 }}><button className="btn" type="button" disabled={!Object.values(edit).some(v => +v > 0)} onClick={() => void save()}>Save prices</button>
        <button className="btn ghost" type="button" disabled title="Yahoo fetch is not built in this prototype">Fetch online prices</button></div>
      <p className="help">The monthly job and the Yahoo adapter (ticket 02) are left out of the prototype. Each saved price records its source and the day it was typed.</p></div>
  </Page>;
}
