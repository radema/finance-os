/* First run (prototype 11: start.html): the empty Overview is a checklist. Each task opens the form that does it. */
import { api } from '../api.ts';
import { useStore } from '../store.tsx';
import { Page, Svg } from '../ui.tsx';

export function Start() {
  const { ov, run } = useStore();
  if (!ov) return null;
  const { products, goals, tx, opening } = ov.counts, ready = products > 0 && goals > 0;
  const task = (n: number, title: string, text: string, status: string, done: boolean, href: string, label: string, lock = false) => <div className={`task ${done ? 'done' : ''}`} style={lock ? { opacity: .55 } : undefined}>
    <span className="n">{done ? <Svg n="on" /> : n}</span><div><h3>{title}<span className="st">{status}</span></h3><p>{text}</p><a className={`btn ${done ? 'ghost' : ''} small`} href={href}>{label}</a></div></div>;
  return <div className="start"><Page tag="First run" title={ready ? 'Setup is done: look at the Overview' : 'Three steps and the Overview fills in'}>
    <p className="lead" style={{ marginBottom: 20 }}>Everything stays on this computer. The data folder is set by GBI_DATA_DIR (prototype: <code>.data/</code> inside the app folder, safe to wipe).</p>
    <div className="tasks">
      {task(1, 'Add your products', 'The funds, bonds and ETCs you hold or may buy: ISIN, type, expected return, volatility and cost. You can start from a preset.', `${products} added`, products > 0, '#/setup/products', 'Add products')}
      {task(2, 'Add your goals', 'One goal per thing you save for: a target in today’s euros, a year, a priority and a monthly amount. Then choose which products new money goes to.', `${goals} added`, goals > 0, '#/setup/goals', 'Add goals', products === 0)}
      {task(3, 'Enter your current portfolio', 'Units and the fiscal average cost (PMC) of what you hold today, split across goals. This is optional: history before this date is not imported.', opening ? `${tx} records` : 'optional', opening, '#/portfolio', 'Enter the current portfolio', !ready)}
      {task(4, 'Or import from your broker', 'A Fineco “Movimenti Dossier Titoli” XLSX brings in buys, sells and coupons in one go. Needs products and goals first.', '', false, '#/import', 'Import a file', !ready)}
    </div>
    <div className="row" style={{ marginTop: 28 }}>
      <button className="btn ghost" type="button" onClick={() => void run(() => api.post('/api/sample'), 'Sample data loaded')}>Load the sample data</button>
      <button className="btn ghost" type="button" onClick={() => { if (confirm('Delete everything in the prototype database?')) void run(() => api.post('/api/reset'), 'Database emptied'); }}>Wipe the prototype data</button></div>
    <p className="help">The sample is the mock’s own data (made-up products, amounts and prices). It also gives the import a file to try.</p>
  </Page></div>;
}
