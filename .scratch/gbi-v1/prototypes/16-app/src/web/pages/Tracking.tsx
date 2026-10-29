/* Plan vs actual (ticket 10: cumulative) and Goal history (monthly snapshots: saved, recomputed). */
import { api } from '../api.ts';
import { eur, eur2, pct } from '../format.ts';
import { useStore } from '../store.tsx';
import { GoalChip, Loading, Page, Term } from '../ui.tsx';

export function PlanActual() {
  const { ov } = useStore();
  if (!ov) return <Loading />;
  const n = ov.next, name = (id: string): string => ov.products.find(p => p.id === id)?.name.split(' (')[0] ?? id;
  return <Page tag="Analysis" title="What the plan said against what you put in">
    <div className="card sect"><h2>Next contribution</h2>{n.kind === 'none' ? <p className="lead">No bucket is behind plan.</p> : <>
      <p className="lead">{n.goal!.name} is {eur(n.amount!)} behind its cumulative plan. {n.kind === 'wait' ? `The amount is below the minimum efficient ticket (${eur(n.minTicket)}): consider waiting and batching.` : 'Put it in as follows (split by the goal’s weights):'}</p>
      <ul className="lt">{n.split!.map(s => <li className="li" key={s.productId}><span>{name(s.productId)}<small>{s.commission ? `commission ≈ ${eur2(s.commission)} (${pct(s.commission / s.amount, 1)})` : 'no commission'}</small></span><span className="r"><b>{eur2(s.amount)}</b></span></li>)}</ul></>}</div>
    <div className="card sect" style={{ marginTop: 24 }}><h2>Since {ov.settings.trackingStart}</h2>
      <p className="lead">Plan = the monthly amount in force each month, added up. Put in = buys and sells, without opening positions and coupons. Only the running total is compared: 0 one month and double the next is on plan.</p>
      <ul className="lt">{ov.pva.map(p => { const g = ov.goals.find(x => x.id === p.id)!; return <li className="li" key={p.id}><span><GoalChip goal={g} /><small>Planned {eur(p.planned)}, put in {eur(p.actual)}</small></span><span className="r"><b>{p.planned === 0 && p.actual === 0 ? 'No plan' : p.gap < 0 ? `${eur(-p.gap)} behind` : `${eur(p.gap)} ahead`}</b></span></li>; })}</ul></div>
  </Page>;
}

export function History() {
  const { ov, run } = useStore();
  if (!ov) return <Loading />;
  return <Page tag="Goals" title="The goal analysis, saved month by month">
    <div className="card sect"><p className="lead">The first start in a new month saves the previous month. Months missed since tracking began are <Term k="recomputed">recomputed</Term> from month-end prices with today’s assumptions and labelled so. A saved snapshot never changes.</p>
      <div className="row" style={{ marginBottom: 16 }}><button className="btn small" type="button" onClick={() => void run(() => api.post('/api/snapshots'), 'Snapshot saved')}>Save a snapshot now</button></div>
      <div className="sc"><table className="pgrid"><thead><tr><th>Month</th><th>Kind</th>{ov.goals.map(g => <th key={g.id}>{g.name.split(' ')[0]}</th>)}</tr></thead><tbody>
        {ov.snaps.slice().reverse().map(s => <tr key={s.month}><td>{s.month}</td><td className="src">{s.source}</td>{ov.goals.map(g => <td key={g.id}>{pct(s.goals.find(x => x.id === g.id)?.prob ?? 0)}</td>)}</tr>)}</tbody></table></div>
      <p className="help">Chance of success per goal. Snapshots use 300 simulated markets.</p></div></Page>;
}
