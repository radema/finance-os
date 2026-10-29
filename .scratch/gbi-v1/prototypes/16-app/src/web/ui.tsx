/* Shared pieces of the approved UI (prototype 11): icons, goal chips, tags, legends, cards. Class names come from app.css. */
import type { CSSProperties, ReactNode } from 'react';
import { GLOSSARY } from './glossary.ts';
import { useStore } from './store.tsx';
import type { GoalView, Status } from '../shared/view.ts';
import type { Product } from '../engine/types.ts';

const SV = (p: string) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const ICON: Record<string, string> = {
  overview: SV('<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>'),
  goals: SV('<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/>'),
  tx: SV('<path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3"/>'),
  indep: SV('<path d="M3 16h14M5 16V9l5-5 5 5v7"/><path d="M8 16v-4h4v4"/>'),
  on: SV('<circle cx="10" cy="10" r="7"/><path d="M6.8 10.2l2.2 2.2 4.2-4.6"/>'),
  risk: SV('<path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.2M10 14v.1"/>'),
  off: `<svg viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.2M10 14v.1" stroke="var(--surface)" stroke-linecap="round"/></svg>`,
  dash: SV('<circle cx="10" cy="10" r="7"/><path d="M6.5 10h7"/>'),
  plus: SV('<path d="M10 4v12M4 10h12"/>'),
  inn: SV('<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>'),
  out: SV('<path d="M10 14V4M6 8l4-4 4 4M4 16h12"/>'),
  info: SV('<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.2v.1"/>'),
  clock: SV('<circle cx="10" cy="10" r="7"/><path d="M10 6v4.4l2.8 1.6"/>'),
  trend: SV('<path d="M3 15l5-5 3 3 6-7M13 6h4v4"/>'),
  wallet: SV('<rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3 8.5h14M13 12h2"/>'),
  flag: SV('<path d="M5 17V4M5 4h9l-2 3 2 3H5"/>'),
  chart: SV('<path d="M3 16h14M5 13l3-4 3 2 4-6"/>'),
  menu: SV('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>'),
  close: SV('<path d="M5 5l10 10M15 5L5 15"/>'),
  analysis: SV('<path d="M3 16h14M5 13V9M9 13V5M13 13V8M17 13v-5"/>'),
  pension: SV('<path d="M10 3.5c-2.6 0-4.5 1.6-4.5 3.8 0 3.6 4.5 4.4 4.5 7.2M10 3.5c2.6 0 4.5 1.6 4.5 3.8M5 16.5h10"/>'),
  ops: SV('<path d="M4 5h12M4 10h12M4 15h8"/>'),
  setup: SV('<path d="M4 6h8M15 6h1M4 14h1M8 14h8"/><circle cx="13.5" cy="6" r="1.7"/><circle cx="6.5" cy="14" r="1.7"/>')
};
export const Icon = ({ n }: { n: string }) => <span className="glyph" dangerouslySetInnerHTML={{ __html: ICON[n] }} />;
export const Svg = ({ n, cls }: { n: string; cls?: string }) => <span className={cls} dangerouslySetInnerHTML={{ __html: ICON[n] }} />;

export const STATUS: Record<Status, string> = { on: 'On track', risk: 'At risk', off: 'Off track' };
export const StatusChip = ({ s }: { s: Status }) => <span className={`status ${s}`}><Svg n={s} cls={s === 'on' ? 'ic-ok' : 'ic-hl'} />{STATUS[s]}</span>;

export function useSlot(): (id: string) => number { const { slots } = useStore(); return id => slots[id] ?? 6; }
export function slotStyle(slot: number): CSSProperties { return { ['--g' as string]: `var(--slot${slot})`, ['--gt' as string]: `var(--tint${slot})` }; }
export function GoalChip({ goal, label }: { goal: Pick<GoalView, 'id' | 'name'>; label?: string }) {
  const slot = useSlot()(goal.id);
  return <span className="gchip" style={slotStyle(slot)}><i />{label ?? goal.name}</span>;
}
export const PrTag = ({ p }: { p: string }) => <span className={`ptag pr-${p.toLowerCase()}`}><i />{p}</span>;
export function kindOf(p: Pick<Product, 'regime'>): string { return p.regime === 'govt' ? 'BTP' : p.regime === 'pension' ? 'Pension' : p.regime === 'cash' ? 'Cash' : p.regime === 'direct' ? 'ETC' : 'ETF'; }
export const KindTag = ({ p }: { p: Pick<Product, 'regime'> }) => <span className={`ktag k-${kindOf(p).toLowerCase()}`}>{kindOf(p)}</span>;
export const Term = ({ k, children }: { k: string; children?: ReactNode }) => {
  const g = GLOSSARY[k];
  return <span className="term" tabIndex={0} title={g ? `${g[1]}. ${g[2]}` : ''}>{children ?? g?.[0] ?? k}</span>;
};
export const Chead = ({ ic, label, right }: { ic: string; label: string; right?: ReactNode }) => <div className="chead"><span className="cic" dangerouslySetInnerHTML={{ __html: ICON[ic] }} />{label}{right ? <span className="cright">{right}</span> : null}</div>;

export type LegendItem = [kind: string, color: string, label: string];
export const Legend = ({ items }: { items: LegendItem[] }) => <ul className="legend" aria-label="Legend">{items.map(([k, c, l]) => <li className="lg" key={l}><i className={k} style={{ ['--c' as string]: c }} />{l}</li>)}</ul>;
export function GoalLegend({ ids, extra }: { ids: string[]; extra?: LegendItem[] }) {
  const { ov } = useStore(), slot = useSlot();
  return <Legend items={[...ids.map((id): LegendItem => ['sw', `var(--slot${slot(id)})`, shortName(ov!.goals.find(g => g.id === id)!.name)]), ...(extra ?? [])]} />;
}
export const shortName = (n: string): string => (n.length > 14 ? n.split(' ')[0] : n);
export const Loading = ({ what }: { what?: string }) => <div className="loading">{what ?? 'Loading…'}</div>;
export function Page({ tag, title, children }: { tag: string; title: string; children: ReactNode }) {
  return <><div className="tag">{tag}</div><h1 className="title" style={{ marginBottom: 20 }}>{title}</h1>{children}</>;
}
export function Placeholder({ title, text }: { title: string; text: string }) {
  return <div className="card sect"><h2>{title}</h2><p className="lead">{text}</p><p className="help">This screen is a placeholder in prototype 16. See Open in NOTES.md.</p></div>;
}
