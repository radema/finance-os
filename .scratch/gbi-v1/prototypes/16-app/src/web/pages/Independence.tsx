/* Independence (prototype 11: independence.html) on live data. Ticket 07: net of tax, pension counts by default and shown as its own share,
   Level 1 measured without pension, targets follow expenseGrowth against inflation. Ticking a goal recomputes on the server. */
import { useState } from 'react';
import { api } from '../api.ts';
import { Chart } from '../chartkit.tsx';
import { fiPctChart, levelsChart, projChart } from '../charts.ts';
import { dt, eur, pct } from '../format.ts';
import { useStore } from '../store.tsx';
import { GoalChip, GoalLegend, Legend, Loading, PrTag, Term, useSlot } from '../ui.tsx';

const NAME = ['Safety', 'Barista FIRE', 'FIRE'], TERM = ['', 'barista', 'fire'];

export function Independence() {
  const { ov, run } = useStore(), slot = useSlot();
  const [l2, setL2] = useState(''), [l3, setL3] = useState('');
  if (!ov) return <Loading />;
  const fire = ov.fire;
  if (!fire) return <div className="card sect"><h2>Independence</h2><p className="lead">Add goals and spending first.</p><a className="btn" href="#/start">Set up</a></div>;
  const lv = fire.levels, rows = fire.rows, n = rows.length - 1, counted = new Set(ov.goals.filter(g => g.fire).map(g => g.id)), pen = ov.goals.find(g => g.isP);
  const wTot = ov.goals.filter(g => counted.has(g.id) && (!g.isP || fire.includePension)).reduce((a, g) => a + g.netNow, 0), wPen = pen && counted.has(pen.id) && fire.includePension ? pen.netNow : 0, wAcc = wTot - wPen;
  const measure = (i: number): number => (i === 0 ? wAcc : wTot), share = (i: number): number => Math.min(1, measure(i) / lv[i].target), next = lv.findIndex((_, i) => measure(i) < lv[i].target);
  const title = next < 0 ? 'All three levels are reached' : `${next === 0 ? '' : next === 1 ? 'Level 1 is reached; ' : 'Levels 1 and 2 are reached; '}Level ${next + 1} is ${pct(share(next))} funded${fire.reach[next].median ? `, expected in ${fire.reach[next].median} in the typical case` : `, ${eur(lv[next].target - measure(next))} to go`}`;
  const meaning = [`The emergency fund goal (${eur(lv[0].target)}) or ${ov.settings.fire.efMonths} months of essential spending. Measured without pension money, which is not liquid.`,
    `${ov.settings.fire.l2Mult} × your essential monthly spending of ${eur(ov.essential)}. Work only has to pay for the extras.`, `Level 2 plus ${ov.settings.fire.l3Mult} × your optional monthly spending of ${eur(ov.optional)}. Work becomes a choice.`];
  const p20 = rows[Math.min(20, n)].probs, pEnd = rows[n].probs, SRC = `${ov.settings.paths.toLocaleString('en-GB')} simulated markets, seed ${ov.settings.seed}`;
  const toggle = (id: string, v: boolean): Promise<unknown> => run(() => api.put(`/api/goals/${id}/fire`, { fire: v }));
  const setMult = (): Promise<unknown> => run(() => api.put('/api/settings', { fire: { l2Mult: +(l2 || ov.settings.fire.l2Mult), l3Mult: +(l3 || ov.settings.fire.l3Mult) } }), 'Levels updated');
  return <div className="page has-rail"><div className="col pair">
    <section className="exhibit card"><div className="tag">Financial independence · {dt(ov.asOf)}</div><h1 className="title">{title}</h1>
      <p className="unit">Share of each level’s target covered today, net of tax, in <Term k="real" />. Each colour is a goal, listed under “What counts”. <Term k="fire">What is this?</Term></p>
      <GoalLegend ids={ov.goals.filter(g => counted.has(g.id)).map(g => g.id).sort((a, b) => slot(a) - slot(b))} />
      <Chart build={levelsChart(ov, slot, counted)} deps={[ov]} cls="short" label="Funding of each level, accessible and pension" />
      <p className="callout">{eur(wTot)} counts today: {eur(wAcc)} you can use{wPen ? ` and ${eur(wPen)} in pension (net of exit tax)` : '; pension is not included'}.</p>
      <p className="source">Source: your holdings and prices to {dt(ov.asOf)}, after liquidation tax. Targets from your spending: essential {eur(ov.essential)} and optional {eur(ov.optional)} a month.</p></section>
    <section className="exhibit card"><div className="tag">Progress per year</div>
      <h2 className="title">{fire.reach[1].median && fire.reach[2].median ? `In the typical case Level 2 is reached in ${fire.reach[1].median} and Level 3 in ${fire.reach[2].median}` : 'Levels 2 and 3 are not both reached within 40 years in the typical case'}</h2>
      <p className="unit">Projected independence wealth as a share of each target, % per year, net of tax, in <Term k="real" />. The <Term k="typical" />.</p>
      <Legend items={[['ln', 'var(--hl)', 'Level 2'], ['ln', 'var(--ctx)', 'Level 3'], ['ln dash', 'var(--ink2)', 'Target']]} />
      <Chart build={fiPctChart(fire)} deps={[ov]} label="Percent of target reached per year" />
      <p className="callout">Level 1 is already {pct(rows[0].ratio[0])} funded today and is not drawn. Targets follow your spending growth ({pct(fire.expenseGrowth)}) against inflation ({pct(fire.inflation)}), so with equal rates they stay flat.</p>
      <p className="source">Source: {SRC}; contributions as planned; after tax and fund costs.</p></section>
    <section className="exhibit card full"><div className="tag">Projection</div>
      <h2 className="title">By {rows[Math.min(20, n)].year}, Level 2 is reached in {pct(p20[1])} of simulated markets and Level 3 in {pct(p20[2])}</h2>
      <p className="unit">Wealth that counts toward independence, {n} years, net of tax, in <Term k="real" />, €. Band: <Term k="badcase" /> to <Term k="goodcase" />. Dashed: level targets.</p>
      <Legend items={[['bd', 'var(--hl)', 'Bad to good case'], ['ln', 'var(--hl)', 'Typical case'], ['ln dash', 'var(--ink2)', 'Level targets']]} />
      <Chart build={projChart(fire)} deps={[ov]} cls="tall" label="Projected independence wealth against the level targets" />
      <p className="callout">By {rows[n].year} the chance rises to {pct(pEnd[1])} for Level 2 and {pct(pEnd[2])} for Level 3. {fire.includePension ? 'Pension is included.' : 'Pension is not included.'}</p>
      <p className="source">Source: as above. The fan is the total; the pension share is shown in the first chart.</p></section>
  </div><div className="rail">
    <section className="sect card"><h2>The three levels</h2><ul className="lt">{lv.map((l, i) => <li className="li" key={l.n}><span><b>Level {l.n} · {NAME[i]}</b>{TERM[i] && <> <Term k={TERM[i]}>(what is this?)</Term></>}<small>{meaning[i]}</small></span>
      <span className="r"><b>{eur(l.target)}</b><small>{measure(i) >= l.target ? 'Reached' : `${pct(share(i))} funded`}</small></span></li>)}</ul>
      <details className="more"><summary>Change the multipliers</summary><div className="fields" style={{ marginTop: 12 }}>
        <label className="f">Level 2 × essential monthly<input inputMode="decimal" placeholder={String(ov.settings.fire.l2Mult)} value={l2} onChange={e => setL2(e.target.value)} /></label>
        <label className="f">Level 3 adds × optional monthly<input inputMode="decimal" placeholder={String(ov.settings.fire.l3Mult)} value={l3} onChange={e => setL3(e.target.value)} /></label>
        <div className="row"><button className="btn small" type="button" onClick={() => void setMult()}>Update levels</button></div></div></details></section>
    <section className="sect card"><h2>What counts</h2><p className="lead">Tick the goals whose money counts toward independence. Values are net of tax. Pension counts by default.</p>
      <ul className="lt">{ov.goals.map(g => <li className="li" key={g.id}><label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={g.fire} onChange={e => void toggle(g.id, e.target.checked)} style={{ marginTop: 3, flex: 'none' }} />
        <span><GoalChip goal={g} /><small>{g.isP ? 'Pension: counts for Levels 2 and 3, not for Level 1' : <><PrTag p={g.priority} /> by {g.year}</>}</small></span></label><span className="r">{eur(g.netNow)}</span></li>)}</ul>
      <label style={{ display: 'flex', gap: 10, marginTop: 8, cursor: 'pointer' }}><input type="checkbox" checked={ov.settings.fire.includePension} onChange={e => void run(() => api.put('/api/settings', { fire: { includePension: e.target.checked } }))} />Include the pension bucket</label>
      <p className="help">Counts now: {eur(wTot)}. Ticking recalculates the projections on the server ({ov.timing.analyseMs} ms last run).</p></section>
  </div></div>;
}
