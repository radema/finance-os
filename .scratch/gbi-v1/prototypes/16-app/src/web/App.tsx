/* Shell: sidebar (7 sections, prototype 11), phone menu, theme toggle, hash router. Screens not built are nav placeholders. */
import { useEffect, useState } from 'react';
import { GoalDetail, GoalsList } from './pages/Goals.tsx';
import { Import } from './pages/Import.tsx';
import { Independence } from './pages/Independence.tsx';
import { Optimizer } from './pages/Optimizer.tsx';
import { Overview } from './pages/Overview.tsx';
import { Portfolio } from './pages/Portfolio.tsx';
import { Prices } from './pages/Prices.tsx';
import { Setup } from './pages/Setup.tsx';
import { Start } from './pages/Start.tsx';
import { History, PlanActual } from './pages/Tracking.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { isDark } from './chartkit.tsx';
import { useStore } from './store.tsx';
import { ICON, Loading, Page, Placeholder, Svg } from './ui.tsx';

type Item = [label: string, href: string, key: string, soon?: boolean];
const NAV: { label: string; icon: string; href?: string; key?: string; soon?: boolean; items?: Item[] }[] = [
  { label: 'Overview', icon: 'overview', href: '#/', key: '' },
  { label: 'Goals', icon: 'goals', items: [['List', '#/goals', 'goals'], ['Detail', '#/goal', 'goal'], ['History', '#/history', 'history']] },
  { label: 'Independence', icon: 'indep', href: '#/independence', key: 'independence' },
  { label: 'Analysis', icon: 'analysis', items: [['Optimizer', '#/optimizer', 'optimizer'], ['Performance', '#/soon/performance', 'soon/performance', true], ['Plan vs actual', '#/plan', 'plan']] },
  { label: 'Pension', icon: 'pension', href: '#/soon/pension', key: 'soon/pension', soon: true },
  { label: 'Operations', icon: 'ops', items: [['Transactions', '#/transactions', 'transactions'], ['Import', '#/import', 'import'], ['Prices', '#/prices', 'prices'], ['Current portfolio', '#/portfolio', 'portfolio']] },
  { label: 'Setup', icon: 'setup', items: [['Products', '#/setup/products', 'setup/products'], ['Allocation and goals', '#/setup/goals', 'setup/goals'], ['Cash flow', '#/setup/cashflow', 'setup/cashflow'], ['Assumptions', '#/soon/assumptions', 'soon/assumptions', true], ['Glossary', '#/soon/glossary', 'soon/glossary', true]] }
];
const SOON: Record<string, [string, string]> = {
  performance: ['Performance', 'TWR, XIRR and drawdown per scope. The engine computes them (the Overview and goal pages use them); this screen is not built.'],
  pension: ['Pension', 'Cap, used, still available, refund and exit tax; the 10-year schedule. The engine has the schedule; the screen and the pension inputs form are not built.'],
  assumptions: ['Assumptions', 'Inflation, tax, commission, simulated markets, seed, correlations. The values live in the database and the API (PUT /api/settings); the form is not built.'],
  glossary: ['Glossary', 'Terms already show their plain explanation on hover; the page is not built.']
};
const route = (): { path: string; q: URLSearchParams } => { const [p, q] = location.hash.replace(/^#/, '').split('?'); return { path: (p || '/').replace(/^\//, '').replace(/\/$/, ''), q: new URLSearchParams(q) }; };

export function App() {
  const { ov, error, toast, bumpTheme } = useStore();
  const [r, setR] = useState(route()), [menu, setMenu] = useState(false), [, force] = useState(0);
  useEffect(() => { const f = (): void => { setR(route()); setMenu(false); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const toggleTheme = (): void => { const t = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('gbi-proto-theme', t); } catch { /* ignore */ } bumpTheme(); force(x => x + 1); };
  const old = ov ? ov.priceRows.filter(p => p.old).length : 0;
  const nav = <nav className="nav" aria-label="Main">{NAV.map(sec => sec.items
    ? <div className="sec" key={sec.label}><div className="sh"><Svg n={sec.icon} /><span>{sec.label}</span></div>{sec.items.map(([l, h, k, soon]) => <a className="it" key={l} href={h} aria-current={r.path === k || (k === 'goal' && r.path.startsWith('goal/')) ? 'page' : undefined}><span>{l}</span>{soon && <span className="soon">soon</span>}</a>)}</div>
    : <div className="sec" key={sec.label}><a className="sh" href={sec.href} aria-current={r.path === sec.key ? 'page' : undefined}><Svg n={sec.icon} /><span>{sec.label}</span>{sec.soon && <span className="soon" style={{ marginLeft: 'auto' }}>soon</span>}</a></div>)}</nav>;
  const foot = <div className="foot"><a className={`fresh-chip ${old ? 'old' : ''}`} href="#/prices"><i />{old ? `${old} old prices` : 'Prices up to date'}</a><button type="button" className="iconbtn" onClick={toggleTheme}>{isDark() ? 'Light mode' : 'Dark mode'}</button><a href="#/start">First-run checklist</a></div>;
  return <div className="shell">
    <aside className="side"><a className="brand" href="#/">Goal-based investing<small>Prototype 16 · working app</small></a>{nav}{foot}</aside>
    <div className="content" style={{ minWidth: 0 }}>
      <header className="top"><a className="brand" href="#/" style={{ textDecoration: 'none' }}>Goal-based investing</a>
        <button type="button" className="iconbtn menubtn" aria-expanded={menu} onClick={() => setMenu(!menu)}><span dangerouslySetInnerHTML={{ __html: ICON[menu ? 'close' : 'menu'] }} /><span>{menu ? 'Close' : 'Menu'}</span></button></header>
      {menu && <div className="menu" onClick={e => { if ((e.target as HTMLElement).closest('a')) setMenu(false); }}>{nav}{foot}</div>}
      <main className="main">{error ? <div className="card sect"><h2>The server did not answer</h2><p className="lead">{error}</p><p className="help">Start it with <code>pnpm dev</code>.</p></div> : !ov ? <Loading what="Running the analysis…" /> : screen(r)}</main>
    </div>
    {toast && <div className={`toast ${toast.err ? 'err' : ''}`} role="status">{toast.msg}</div>}
  </div>;
}

function screen(r: { path: string; q: URLSearchParams }) {
  const p = r.path;
  if (p === '') return <Overview />;
  if (p === 'goals') return <GoalsList />;
  if (p === 'goal' || p.startsWith('goal/')) return <GoalDetail id={p.split('/')[1] ?? ''} />;
  if (p === 'independence') return <Independence />;
  if (p === 'transactions') return <Transactions />;
  if (p === 'import') return <Import />;
  if (p === 'prices') return <Prices />;
  if (p === 'portfolio') return <Portfolio />;
  if (p === 'optimizer') return <Optimizer />;
  if (p === 'plan') return <PlanActual />;
  if (p === 'history') return <History />;
  if (p === 'start') return <Start />;
  if (p.startsWith('setup')) return <Setup tab={p.split('/')[1] ?? 'products'} />;
  if (p.startsWith('soon/')) { const k = p.split('/')[1], s = SOON[k] ?? [k, '']; return <Page tag="Soon" title={s[0]}><Placeholder title={s[0]} text={s[1]} /></Page>; }
  return <Page tag="Not found" title="This page does not exist"><a className="btn" href="#/">Back to the Overview</a></Page>;
}
