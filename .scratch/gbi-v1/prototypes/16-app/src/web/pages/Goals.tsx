/* Goals list and Goal detail (prototype 11: goals.html, goal.html) on live data, plus the goal's plan history and holdings. */
import { useState } from 'react';
import { api } from '../api.ts';
import { Chart } from '../chartkit.tsx';
import { fanChart, perfChart, pvaChart } from '../charts.ts';
import { dt, eur, eurK, num, pct, sgn, ageText } from '../format.ts';
import { useStore } from '../store.tsx';
import { Chead, GoalChip, KindTag, Legend, Loading, Page, PrTag, StatusChip, Svg, Term, slotStyle, useSlot } from '../ui.tsx';

export function GoalsList() {
  const { ov } = useStore();
  if (!ov) return <Loading />;
  return <Page tag="Goals" title="One bucket per goal, each with its own date, target and risk">
    <div className="card sect"><div className="goals-wrap"><div className="goals-head" aria-hidden="true"><span>Goal</span><span>Value, target</span><span>Chance of success</span><span>Against plan</span><span>Status</span></div>
      <div className="goals">{ov.goals.map(g => {
        const p = ov.pva.find(x => x.id === g.id)!;
        return <a key={g.id} className={`goal ${g.status !== 'on' ? 'flag' : ''}`} href={`#/goal/${g.id}`}><span className="name"><GoalChip goal={g} /><small><PrTag p={g.priority} /> by {g.year}</small></span><StatusChip s={g.status} />
          <span className="prob"><b>{pct(g.prob)}</b><span>needs {pct(g.reqP)}</span></span><span className="money">{eur(g.value)} of {eur(g.target)} target</span>
          <span className="gap">{p.planned === 0 && p.actual === 0 ? 'No plan set' : p.gap < 0 ? `${eur(-p.gap)} behind plan` : `${eur(p.gap)} ahead of plan`}</span></a>;
      })}</div></div>
      <div className="row" style={{ marginTop: 16 }}><a className="btn ghost small" href="#/setup/goals">Add or edit goals</a></div></div>
  </Page>;
}

export function GoalDetail({ id }: { id: string }) {
  const { ov, run } = useStore(), slot = useSlot();
  const [edit, setEdit] = useState(false), [monthly, setMonthly] = useState(''), [from, setFrom] = useState('');
  if (!ov) return <Loading />;
  const order = ov.goals.slice().sort((a, b) => Number(a.status === 'on') - Number(b.status === 'on') || a.year - b.year);
  const g = ov.goals.find(x => x.id === id) ?? order[0];
  if (!g) return <Page tag="Goals" title="No goals yet"><a className="btn" href="#/start">Set up your goals</a></Page>;
  const gsl = slot(g.id), startYear = +ov.asOf.slice(0, 4), p = ov.perf[g.id], last = p?.rows.at(-1), pv = ov.pva.find(x => x.id === g.id)!, items = ov.holdings[g.id] ?? [], ok = g.status === 'on';
  const title = ok ? `${g.name} reaches its target in ${pct(g.prob)} of simulated markets; ${pct(g.reqP)} is required` : `${g.name} reaches its target in ${pct(g.prob)} of simulated markets, below the ${pct(g.reqP)} required`;
  const diff = g.needMC == null ? null : g.needMC - g.monthlyNow;
  const saveMonthly = (): Promise<unknown> => run(() => api.post('/api/goals', { id: g.id, name: g.name, priority: g.priority, target: g.target, year: g.year, cgrowth: g.cgrowth, minProb: g.minProb, fire: g.fire, isPension: g.isP, monthly: +monthly, monthlyFrom: from || ov.valMonth }), 'Plan saved');
  return <>
    <nav className="chips" aria-label="Goals">{order.map(o => <a key={o.id} className="gc" style={slotStyle(slot(o.id))} href={`#/goal/${o.id}`} aria-current={o.id === g.id ? 'true' : undefined}><span className={o.status === 'on' ? 'ic-ok' : 'ic-hl'}><Svg n={o.status} /></span><i className="gdot" style={{ background: `var(--slot${slot(o.id)})` }} />{o.name}</a>)}</nav>
    <div className="page has-rail"><div className="col">
      <section className="exhibit card" style={{ ['--acc' as string]: `var(--slot${gsl})` }}>
        <div className="tag"><GoalChip goal={g} /><PrTag p={g.priority} /> by {g.year}</div>
        <h1 className="title">{title}</h1>
        <p className="unit">Net value if sold that year, in <Term k="nominal" />, €. The band runs from the <Term k="badcase" /> to the <Term k="goodcase" />.</p>
        <Legend items={[['bd', `var(--slot${gsl})`, 'Bad to good case'], ['ln', `var(--slot${gsl})`, 'Typical case'], ['ln dash', 'var(--ink2)', 'Target']]} />
        {g.T >= 1 ? <Chart build={fanChart(g, slot, startYear)} deps={[ov, id]} cls="tall" label={`Range of outcomes for ${g.name}`} /> : <p className="callout">The goal date has passed or is today, so there is no projection to draw.</p>}
        <p className="callout">The target is {eur(g.target)} in today’s money, {eur(g.targetNom)} in {g.year}. {ok ? <>The <Term k="typical" /> ends {eurK(g.median)}.</> : <>The <Term k="typical" /> ends {eurK(g.median)}, but the <Term k="badcase" /> stays at {eurK(g.p10)}.</>}</p>
        <p className="source">Source: your holdings and prices to {dt(ov.asOf)}; {ov.settings.paths.toLocaleString('en-GB')} simulated markets, seed {ov.settings.seed}; after tax and fund costs. The first year covers the {12 - +ov.asOf.slice(5, 7)} months still to come.</p>
      </section>
      <div className="keys" style={{ ['--acc' as string]: `var(--slot${gsl})`, ['--kt' as string]: `var(--tint${gsl})` }}>
        <div><div className="k"><Svg cls="kic" n="wallet" />Value now</div><div className="v">{eur(g.value)}</div><div className="n">{last ? `${eur(Math.abs(last[1] - last[2]))} ${last[1] - last[2] >= 0 ? 'above' : 'below'} the money put in (${eur(last[2])})` : 'No transactions yet'}</div></div>
        <div><div className="k"><Svg cls="kic" n="flag" />Target in {g.year}</div><div className="v">{eur(g.targetNom)}</div><div className="n">{eur(g.target)} in <Term k="real">today’s euros</Term></div></div>
        <div><div className="k"><Svg cls="kic" n="inn" />You contribute</div><div className="v">{g.monthlyNow ? eur(g.monthlyNow) + ' a month' : 'Nothing'}</div><div className="n">{g.isP ? 'Payroll, pension fund and tax refund combined' : g.monthlyNow ? '' : 'No monthly plan for this goal'}</div></div>
      </div>
      {p && last && <section className="exhibit card" style={{ ['--acc' as string]: `var(--slot${gsl})` }}><Chead ic="trend" label="Value and money put in" />
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>{g.name} is worth {eur(last[1])}, {eur(Math.abs(last[1] - last[2]))} {last[1] - last[2] >= 0 ? 'above' : 'below'} the money put in</h2>
        <p className="unit">Value and money put in (net of sales), € by month</p><Legend items={[['ln', `var(--slot${gsl})`, 'Value'], ['ln', 'var(--ctx)', 'Money put in']]} />
        <Chart build={perfChart(p.rows, gsl)} deps={[ov, id]} cls="short" label="Value against money put in" />
        <p className="source">Return since start {sgn(p.twr)} (<Term k="twr">time-weighted</Term>); your own {p.xirr == null ? '–' : pct(p.xirr, 1)} a year (<Term k="xirr">money-weighted</Term>). Before tax. Coupons count as cash received.</p></section>}
      {pv.months.length > 1 && <section className="exhibit card" style={{ ['--acc' as string]: `var(--slot${gsl})` }}><Chead ic="dash" label="Plan against what you put in" />
        <h2 className="title" style={{ fontSize: 20, lineHeight: '26px' }}>{pv.planned === 0 ? 'No plan since tracking started' : pv.gap < 0 ? `${eur(-pv.gap)} behind the cumulative plan` : `${eur(pv.gap)} ahead of the cumulative plan`}</h2>
        <p className="unit">Cumulative € since {ov.settings.trackingStart}. Putting in 0 one month and double the next is on plan: only the running total counts (ticket 10).</p>
        <Legend items={[['ln dash', 'var(--ink2)', 'Plan'], ['ln', `var(--slot${gsl})`, 'Put in']]} />
        <Chart build={pvaChart(pv.months, pv.plannedCum, pv.actualCum, gsl)} deps={[ov, id]} cls="short" label="Cumulative plan against put in" />
        <p className="source">Opening positions and coupons are not contributions. Plan: {g.isP ? 'the pension schedule (TFR, employee, employer and voluntary) divided by 12' : g.plan.map(v => `${eur(v.amount)} from ${v.from}`).join(', ') || 'none'}.</p></section>}
    </div><div className="rail">
      <section className="sect card" style={{ ['--acc' as string]: `var(--slot${gsl})` }}><h2>What it would take</h2><ul className="lt">
        <li className="li"><span>Contribution needed for {pct(g.reqP)}<small>The lowest monthly amount that meets the <Term k="required">required probability</Term></small></span>
          <span className="r"><b>{g.needMC == null ? 'Not reachable' : eur(g.needMC) + ' a month'}</b><small>{diff == null ? '' : diff > 0 ? `${eur(diff)} more than now` : diff < 0 ? `${eur(-diff)} less than now` : 'Same as now'}</small></span></li>
        <li className="li"><span>Planned since {ov.settings.trackingStart}<small>What your plan said you would put in</small></span><span className="r">{eur(pv.planned)}</span></li>
        <li className="li"><span>Put in since then<small>Opening positions are not counted</small></span><span className="r"><b>{eur(pv.actual)}</b><small>{pv.planned ? (pv.gap < 0 ? `${eur(-pv.gap)} behind plan` : `${eur(pv.gap)} ahead of plan`) : ''}</small></span></li></ul>
        {!g.isP && <div style={{ marginTop: 12 }}>{edit ? <div className="fields"><label className="f">New monthly amount (€)<input inputMode="decimal" value={monthly} onChange={e => setMonthly(e.target.value)} /></label>
          <label className="f">From month<input type="month" value={from || ov.valMonth} onChange={e => setFrom(e.target.value)} /></label>
          <div className="row"><button className="btn small" type="button" disabled={monthly === ''} onClick={() => void saveMonthly().then(() => setEdit(false))}>Save plan</button><button className="btn ghost small" type="button" onClick={() => setEdit(false)}>Cancel</button></div></div>
          : <button className="btn ghost small" type="button" onClick={() => { setMonthly(String(g.monthlyNow)); setEdit(true); }}>Change the monthly plan</button>}
          <p className="help">A change counts from the month you pick; earlier months keep the plan that was in force.</p></div>}
      </section>
      <section className="sect card" style={{ ['--acc' as string]: `var(--slot${gsl})` }}><h2>Holdings in this goal</h2><ul className="lt">{items.length === 0 && <li className="li"><span>No holdings yet<small>Use the current-portfolio form or add a transaction.</small></span></li>}
        {items.map(i => { const prod = ov.products.find(x => x.id === i.pid)!;
          return <li className="li" key={i.pid}><span>{i.name} <KindTag p={prod} /><small>{i.isin ? i.isin + ' · ' : ''}{num(i.q)} units × {num(i.price)}</small></span>
            <span className="r"><b>{eur(i.value)}</b><small>{pct(g.value ? i.value / g.value : 0)} of the goal</small></span>
            <span style={{ gridColumn: '1/-1' }}><span className={`age ${i.old ? 'old' : ''}`}><i />{i.old ? `Old price · ${i.priceMonth} (${ageText(i.age)})` : `Price ${i.priceMonth}`}</span> <small><Term k="pmc">Average cost</Term> {num(i.pmc)} · {i.gain >= 0 ? 'gain' : 'loss'} {eur(Math.abs(i.gain))} before tax</small></span></li>; })}</ul></section>
      <details className="more"><summary>How this is calculated</summary>
        <p>The plan is run through {ov.settings.paths.toLocaleString('en-GB')} <Term k="simulated">simulated markets</Term>. Each run grows your holdings and your monthly contributions to {g.year} (the first step is the rest of this year, pro rata), takes off tax and fund costs, then compares the result with the target after {pct(ov.settings.inflation)} yearly inflation.</p>
        <p>The share of runs that reach the target is the <Term k="prob" />. The same seed gives the same answer, so changes you see come from your data and not from luck.</p></details>
    </div></div>
  </>;
}
