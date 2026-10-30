/* Overview: one message, key numbers, then a grid of exhibits (prototype 11, dashboard.html) on live data. */
import { Chart } from '../chartkit.tsx';
import { capChart, fiPctChart, heroChart, nwChart, rangeChart, trendChart } from '../charts.ts';
import { dt, dtShort, eur, pct, sgn, ageText } from '../format.ts';
import { Chead, GoalChip, GoalLegend, Legend, PrTag, StatusChip, Svg, Term, shortName, useSlot, KindTag } from '../ui.tsx';
import { useStore } from '../store.tsx';
import type { LegendItem } from '../ui.tsx';
import type { AlertView, Overview as OverviewData } from '../../shared/view.ts';
import { Start } from './Start.tsx';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const LEG_TARGET: LegendItem = ['ln dash', 'var(--ink2)', 'Target'];

export function Overview() {
  const { ov } = useStore(), slot = useSlot();
  if (!ov) return null;
  if (!ov.counts.goals || !ov.counts.products) return <Start />;
  const { goals, perf, pva, fire } = ov, all = perf.all, last = all?.rows.at(-1);
  const oldRows = ov.priceRows.filter(r => !!r.old), oldValue = oldRows.reduce((a, r) => a + r.value, 0), totalPriced = ov.priceRows.reduce((a, r) => a + r.value, 0), oldest = ov.priceRows[0];
  const flagged = goals.filter(g => g.status !== 'on').sort((a, b) => (a.prob - a.reqP) - (b.prob - b.reqP)), worst = flagged[0];
  const onN = goals.filter(g => g.status === 'on').length;
  const headline = worst ? `${WORDS[onN]} of ${WORDS[goals.length]?.toLowerCase() ?? goals.length} goals are on track. ${worst.name} is the one to watch.` : `All ${goals.length} goals are on track.`;
  const SRC = `${ov.settings.paths.toLocaleString('en-GB')} simulated markets, seed ${ov.settings.seed}`;
  const lvl2 = fire?.levels[1];
  const trendFocus = worst ?? goals[0];
  const tp = ov.snaps.map(s => (s.goals.find(g => g.id === trendFocus.id)?.prob ?? 0) * 100).concat(trendFocus.prob * 100), tLo = Math.round(Math.min(...tp)), tHi = Math.round(Math.max(...tp));
  const below = goals.filter(g => g.p10 < g.targetNom).sort((a, b) => a.year - b.year);
  const cap = ov.capacity, c0 = cap[1] ?? cap[0], cN = cap.at(-1)!;
  const lineGoals = goals.filter(g => [1, 2, 5].includes(slot(g.id)));
  const attention: AlertView[] = ov.alerts;
  const fresh = ov.priceRows.filter(r => !r.old);

  return <>
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <div className="tag" style={{ margin: 0 }}>Overview · as of {dt(ov.asOf)}</div>
      <a className={`fresh-chip ${oldRows.length ? 'old' : ''}`} href="#prices-list"><i />{oldRows.length ? `${oldRows.length} of ${ov.priceRows.length} prices are old (oldest ${oldest.age} days)` : 'All prices up to date'}</a>
    </div>
    <h1 className="title" style={{ marginBottom: 'var(--s5)' }}>{headline}</h1>
    <div className="dgrid">
      <section className="cell keys-cell c-all"><div className="keys" style={{ margin: 0 }}>
        <div><div className="k"><Svg cls="kic" n="wallet" />Net worth, all goals</div><div className="v">{eur(last?.[1] ?? 0)}</div>
          <div className="n">{oldRows.length ? <a href="#prices-list">{eur(oldValue)} of it ({pct(totalPriced ? oldValue / totalPriced : 0)}) uses prices up to {oldest.age} days old</a> : 'All prices up to date'}</div></div>
        <div><div className="k"><Svg cls="kic" n="trend" />Return this year, <Term k="twr">time-weighted</Term></div><div className="v">{all ? sgn(all.ytd) : '–'}</div>
          <div className="n">{all ? <>Since the first record {sgn(all.twr)}. Your own yearly return is {all.xirr == null ? '–' : pct(all.xirr, 1)}, <Term k="xirr">money-weighted</Term>. Before tax.</> : 'No transactions yet.'}</div></div>
        <div><div className="k"><Svg cls="kic" n="flag" />Counts toward <Term k="fire">independence</Term></div><div className="v">{eur(fire?.now.total ?? 0)}</div>
          <div className="n">Net of tax, {eur(fire?.now.pension ?? 0)} of it pension. {lvl2 ? <>{pct((fire?.now.total ?? 0) / lvl2.target)} of Level 2. <a href="#/independence">See levels</a></> : null}</div></div>
      </div></section>

      <section className="cell card exhibit c-hero">
        <Chead ic="goals" label="Chance of success" />
        <h2 className="title">{worst ? `${worst.name} reaches its target in ${pct(worst.prob)} of simulated markets and needs ${pct(worst.reqP)}` : 'Every goal meets its required probability'}</h2>
        <p className="unit">Chance of reaching each target, in <Term k="simulated" />, %. The tick marks the <Term k="required">required probability</Term>.</p>
        <Legend items={[['tk', 'var(--ink)', 'Required probability']]} />
        <Chart build={heroChart(goals, slot)} deps={[ov]} label="Probability of success against required probability, per goal" />
        {worst && worst.needMC != null && <p className="callout">About {eur(Math.max(0, worst.needMC - worst.monthlyNow))} more a month (now {eur(worst.monthlyNow)}) closes the gap. <a href={`#/goal/${worst.id}`}>See {worst.name}</a></p>}
        <p className="source">Source: your transactions and prices to {dt(ov.asOf)}; {SRC}.</p>
      </section>

      {last && <section className="cell card exhibit c-nw c-w2">
        <Chead ic="wallet" label="Net worth by goal" />
        <h2 className="title">Net worth is {eur(Math.abs(last[1] - last[2]))} {last[1] - last[2] >= 0 ? 'above' : 'below'} the money put in</h2>
        <p className="unit">Value by goal, € by month. Dashed: money put in (net of sales).</p>
        <GoalLegend ids={goals.map(g => g.id).sort((a, b) => slot(a) - slot(b))} extra={[['ln dash', 'var(--ink2)', 'Money put in']]} />
        <Chart build={nwChart(ov, slot)} deps={[ov]} cls="tall" label="Net worth by goal against money put in" />
        {oldRows.length > 0 && <p className="callout">{eur(oldValue)} of the latest value is priced from {dtShort(oldest.priceDate)}, not from this month.</p>}
        <p className="source">Source: your transactions and prices; gains are before tax.</p>
      </section>}

      <section className="cell card sect c-todo"><h2>Needs attention</h2>
        {attention.length === 0 ? <p className="lead">Nothing needs attention.</p> : <ul className="todo">{attention.slice(0, 4).map((a, i) => <li key={i}>
          <span className={a.severity === 'Info' ? 'ic-ok' : 'ic-hl'}><Svg n={a.severity === 'High' ? 'risk' : a.severity === 'Info' ? 'info' : 'clock'} /></span>
          <div><b>{a.title}</b><p>{a.body}</p><a className="act" href={a.href}>Open</a>
            <details><summary>Why am I seeing this?</summary><p>{a.why} Rule {a.ruleId}.</p></details></div></li>)}</ul>}
        {attention.length > 4 && <details className="more" style={{ marginTop: 8 }}><summary>{attention.length - 4} more</summary><ul className="todo">{attention.slice(4).map((a, i) => <li key={i}><span className="ic-ok"><Svg n="info" /></span><div><b>{a.title}</b><p>{a.body}</p></div></li>)}</ul></details>}
      </section>

      {ov.snaps.length > 0 && <section className="cell card exhibit c-trend">
        <Chead ic="trend" label="Chance of success over time" />
        <h2 className="title">{trendFocus.name} has moved between {tLo}% and {tHi}% since {ov.snaps[0].month}</h2>
        <p className="unit">Chance of success per goal at each month end, %. Grey: the other goals.</p>
        <Legend items={[...lineGoals.map((g): LegendItem => ['ln', `var(--slot${slot(g.id)})`, shortName(g.name)]), ['ln', 'var(--ctx)', 'Other goals']]} />
        <Chart build={trendChart(ov, slot, trendFocus.id)} deps={[ov]} label="Chance of success per goal over time" />
        <p className="source">Source: {ov.snaps.filter(s => s.source === 'saved').length} saved and {ov.snaps.filter(s => s.source === 'recomputed').length} recomputed month-end snapshots; {SRC}.</p>
      </section>}

      <section className="cell card exhibit c-range">
        <Chead ic="chart" label="Range of outcomes" />
        <h2 className="title">{below.length ? <>In the <Term k="badcase" /> {below.map(g => g.name).join(' and ')} {below.length === 1 ? 'ends' : 'end'} below the target</> : 'Even in the bad case every goal reaches its target'}</h2>
        <p className="unit">Bad case to good case (band) and typical case (tick), as % of each goal’s target at its date. Dashed: target.</p>
        <Legend items={[['bd', 'var(--ink2)', 'Bad to good case'], ['tk', 'var(--ink2)', 'Typical case'], LEG_TARGET]} />
        <Chart build={rangeChart(goals, slot)} deps={[ov]} label="Range of outcomes against target per goal" />
        <p className="source">Source: {SRC}; amounts in <Term k="nominal" />, after tax and fund costs.</p>
      </section>

      <section className="cell card exhibit c-cap">
        <Chead ic="wallet" label="Savings capacity" />
        <h2 className="title">Planned saving takes {pct(c0.planned / (c0.capacity || 1))} of what you can save in {c0.year}, {pct(cN.planned / (cN.capacity || 1))} by {cN.year}</h2>
        <p className="unit">Planned contributions by goal (bars) and savings capacity (line), € a year. {cap[0].stub ? `${cap[0].year} covers the months still to come.` : ''}</p>
        <GoalLegend ids={goals.map(g => g.id).sort((a, b) => slot(a) - slot(b))} extra={[['ln', 'var(--ink)', 'Savings capacity']]} />
        <Chart build={capChart(ov, slot)} deps={[ov]} label="Planned contributions against savings capacity" />
        <p className="source">Capacity is income minus essential and optional spending, plus one-off events and the pension refund. Source: your cash-flow assumptions.</p>
      </section>

      <section className="cell card sect c-goals c-g2"><h2>Goals</h2>
        <div className="goals-wrap"><div className="goals-head" aria-hidden="true"><span>Goal</span><span>Value, target</span><span>Chance of success</span><span>Against plan</span><span>Status</span></div>
          <div className="goals">{goals.slice().sort((a, b) => Number(a.status === 'on') - Number(b.status === 'on') || a.year - b.year).map(g => {
            const p = pva.find(x => x.id === g.id)!, gap = p.planned === 0 && p.actual === 0 ? 'No plan set' : p.gap < 0 ? `${eur(-p.gap)} behind plan` : `${eur(p.gap)} ahead of plan`;
            return <a key={g.id} className={`goal ${g.status !== 'on' ? 'flag' : ''}`} href={`#/goal/${g.id}`}>
              <span className="name"><GoalChip goal={g} /><small><PrTag p={g.priority} /> by {g.year}</small></span><StatusChip s={g.status} />
              <span className="prob"><b>{pct(g.prob)}</b><span>needs {pct(g.reqP)}</span></span><span className="money">{eur(g.value)} of {eur(g.target)} target</span><span className="gap">{gap}</span></a>;
          })}</div></div>
        <p className="source">Open a goal for its range of outcomes and holdings. Targets are in <Term k="real" />.</p>
      </section>

      {fire && <section className="cell card exhibit c-fi">
        <Chead ic="flag" label="Independence" />
        <h2 className="title">{fire.reach[1].median && fire.reach[2].median ? `Level 2 is expected in ${fire.reach[1].median} and Level 3 in ${fire.reach[2].median}` : 'Levels 2 and 3 are not reached within 40 years in the typical case'}</h2>
        <p className="unit">Projected wealth as a share of each target, % per year, net of tax, typical case, in <Term k="real" />. <Term k="fire">What are the levels?</Term></p>
        <Legend items={[['ln', 'var(--hl)', 'Level 2'], ['ln', 'var(--ctx)', 'Level 3'], LEG_TARGET]} />
        <Chart build={fiPctChart(fire)} deps={[ov]} label="Percent of independence target reached per year" />
        <p className="callout">Level 1 is {fire.rows[0].ratio[0] >= 1 ? 'reached' : `${pct(fire.rows[0].ratio[0])} funded`}. Pension {fire.includePension ? 'counts' : 'does not count'} toward Levels 2 and 3. <a href="#/independence">See the projection</a></p>
        <p className="source">Source: {SRC}.</p>
      </section>}

      <section className="cell card sect c-prices c-w2" id="prices-list"><h2>Price freshness</h2>
        <p className="lead">{oldRows.length ? `${oldRows.length} of ${ov.priceRows.length} prices are old.` : 'All prices are current.'} They are flagged here, and the values that use them are still counted in net worth. See <Term k="stale">old price</Term>.</p>
        <ul className="ptable">{oldRows.map(r => <PriceLi key={r.pid} r={r} />)}</ul>
        {fresh.length > 0 && <details className="more" style={{ marginTop: 12, borderTop: 0 }}><summary>{fresh.length} up to date</summary><ul className="ptable" style={{ borderTop: 0 }}>{fresh.map(r => <PriceLi key={r.pid} r={r} />)}</ul></details>}
        <div className="row" style={{ marginTop: 16 }}><a className="btn ghost small" href="#/prices">Enter prices by hand</a></div>
      </section>
    </div>
  </>;
}

function PriceLi({ r }: { r: OverviewData['priceRows'][number] }) {
  return <li><span>{r.name.split(' (')[0]} <KindTag p={{ regime: r.regime as never }} /></span><span className="right">{eur(r.value)}</span>
    <span style={{ gridColumn: '1/-1' }}><span className={`age ${r.old ? 'old' : ''}`}><i />{r.old ? 'Old price · ' : ''}{r.priceDate ? dtShort(r.priceDate) : 'no price'} ({ageText(r.age)})</span> <small>· {r.source === 'yahoo' ? 'Online provider' : r.source === 'csv' ? 'CSV' : 'Typed by hand'}</small></span></li>;
}
