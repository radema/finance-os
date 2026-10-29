/* Fineco "movimenti" XLSX preset (tickets 08 and 09): parse, check every row, commit one ImportBatch. */
import { holdingsAt } from '../../engine/core.ts';
import type { EngineState } from '../../engine/types.ts';
import type { ImportDecisionIn, ImportRow } from '../../shared/schemas.ts';
import { splitByWeights } from '../../shared/split.ts';
import { readXlsx } from './xlsx.ts';
import type { Cell } from './xlsx.ts';

const norm = (s: Cell): string => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const num = (v: Cell): number => {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[€\s]/g, '');
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
};
function isoDate(v: Cell): string {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);   // Excel serial, in case a writer stores dates as numbers
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

export interface Parsed { sheet: string; headerRow: number; rows: ImportRow[]; errors: string[] }
/** Find the header row by its names, not by a fixed row number; skip blank rows. */
export function parseFineco(buf: Buffer): Parsed {
  const sheet = readXlsx(buf), errors: string[] = [];
  const want = ['operazione', 'isin', 'segno', 'quantita', 'prezzo'];
  const h = sheet.rows.find(r => want.every(w => r.cells.some(c => norm(c) === w)));
  if (!h) return { sheet: sheet.name, headerRow: 0, rows: [], errors: ['This does not look like a Fineco securities export: the header row (Operazione, Isin, Segno, Quantita, Prezzo) was not found.'] };
  const ix = (name: string): number => h.cells.findIndex(c => norm(c) === name);
  const c = { date: ix('operazione'), desc: ix('descrizione'), name: ix('titolo'), isin: ix('isin'), side: ix('segno'), qty: ix('quantita'), cur: ix('divisa'), price: ix('prezzo'), fx: ix('cambio'), cv: ix('controvalore'), fee: ix('commissioniamministrato') };
  const rows: ImportRow[] = [];
  for (const r of sheet.rows) {
    if (r.n <= h.n || r.cells.every(x => x === '')) continue;
    const get = (i: number): Cell => (i >= 0 ? r.cells[i] ?? '' : '');
    const description = String(get(c.desc)).trim(), date = isoDate(get(c.date)), side = String(get(c.side)).trim().toUpperCase();
    if (!date) { errors.push(`Row ${r.n}: unreadable date "${get(c.date)}"`); continue; }
    const kind = /stacco\s*ced/i.test(description) ? 'coupon' : /compravendita/i.test(description) && (side === 'A' || side === 'V') ? 'trade' : 'other';
    rows.push({ n: r.n, date, isin: String(get(c.isin)).trim(), name: String(get(c.name)).trim(), kind, side: side === 'A' || side === 'V' ? side : '', qty: num(get(c.qty)), price: num(get(c.price)),
      currency: String(get(c.cur)).trim() || 'EUR', fx: c.fx >= 0 && get(c.fx) !== '' ? num(get(c.fx)) : 1, amount: get(c.cv) === '' ? null : num(get(c.cv)), commission: num(get(c.fee)), description });
  }
  return { sheet: sheet.name, headerRow: h.n, rows, errors };
}

/* ---------- row check ---------- */
export type RowState = 'ready' | 'needs_goal' | 'duplicate' | 'before_opening' | 'unknown_product' | 'needs_fix';
export interface Candidate { goalId: string; name: string; held: number; weight: number }
export interface RowCheck {
  row: ImportRow; state: RowState; note: string; warn: string;
  productId: string; productName: string;
  /** stored quantities: qty is signed (sell < 0), price per unit (govt per 1, not per 100) */
  qty: number; price: number;
  candidates: Candidate[]; autoGoalId: string;
  /** suggested split by weights (units, largest remainder) or, for a coupon, by units held */
  weightSplit: { goalId: string; units: number }[];
}

const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

export function checkRows(st: EngineState, rows: ImportRow[], openingAsOf: string): RowCheck[] {
  const seen = new Set<string>();
  return rows.map((row): RowCheck => {
    const p = st.products.find(x => x.isin && x.isin === row.isin);
    const bond = p?.regime === 'govt', price = bond ? row.price / 100 : row.price;
    const signed = row.kind === 'coupon' ? 0 : row.side === 'V' ? -Math.abs(row.qty) : Math.abs(row.qty);
    const base: RowCheck = { row, state: 'ready', note: '', warn: '', productId: p?.id ?? '', productName: p?.name ?? row.name, qty: signed, price, candidates: [], autoGoalId: '', weightSplit: [] };
    const fix = (note: string): RowCheck => ({ ...base, state: 'needs_fix', note });
    if (row.kind === 'other') return fix(`Unknown operation "${row.description}": only trades and coupons are imported in v1.`);
    if (row.currency !== 'EUR' || row.fx !== 1) return fix('Not in euros (v1 is EUR only).');
    if (!p) return { ...base, state: 'unknown_product', note: 'No product with this ISIN. Add it, then check the file again.' };
    if (row.kind === 'trade' && (!row.qty || row.price <= 0)) return fix('Missing quantity or price.');
    if (openingAsOf && row.date <= openingAsOf) return { ...base, state: 'before_opening', note: 'Already in the opening position.' };
    const key = `${row.date}|${row.isin}|${row.side}|${row.qty}|${row.price}|${row.amount}`;
    if (seen.has(key)) return fix('The same row appears twice in the file: check whether both are real orders.');
    seen.add(key);
    /* already in the records: same date and product, same total quantity (or coupon amount), whichever goals it was split over */
    const ex = st.ledger.filter(t => t.date === row.date && t.productId === p.id);
    if (row.kind === 'trade' && near(ex.filter(t => (t.type === 'buy' || t.type === 'sell') && near(t.price, price, 1e-5)).reduce((a, t) => a + t.qty, 0), signed, 1e-3) && signed !== 0)
      return { ...base, state: 'duplicate', note: 'Already in your records.' };
    if (row.kind === 'coupon' && near(ex.filter(t => t.type === 'coupon').reduce((a, t) => a + (t.amount ?? 0), 0), row.amount ?? NaN, 0.005))
      return { ...base, state: 'duplicate', note: 'Already in your records.' };
    /* cross-check only: Controvalore against quantity x price, commission allowed either way */
    let warn = '';
    if (row.kind === 'trade' && row.amount != null) {
      const calc = Math.abs(row.qty) * price, cv = Math.abs(row.amount);
      if (Math.abs(cv - calc) > row.commission + 0.02) warn = `Amount ${cv.toFixed(2)} does not match quantity × price ${calc.toFixed(2)}.`;
    }
    /* bucket: the only goal that holds the product or has it in its weights; else the user picks */
    const held = holdingsAt(st, row.date).pos;
    const candidates: Candidate[] = st.goals.map(g => ({ goalId: g.id, name: g.name, held: held[g.id]?.[p.id] ?? 0, weight: st.weights.find(w => w.goalId === g.id && w.productId === p.id)?.weight ?? 0 }))
      .filter(c => (row.kind === 'coupon' || row.side === 'V' ? c.held > 0 : c.held > 0 || c.weight > 0));
    const out: RowCheck = { ...base, warn, candidates };
    if (row.kind === 'coupon') {
      const hold = candidates.filter(c => c.held > 0);
      if (!hold.length) return { ...out, state: 'needs_goal', note: 'No goal held this bond on that date: choose one.' };
      return { ...out, state: 'ready', note: hold.length > 1 ? 'Split by units held.' : '', weightSplit: hold.map(c => ({ goalId: c.goalId, units: c.held })), autoGoalId: hold.length === 1 ? hold[0].goalId : '' };
    }
    if (candidates.length === 1) return { ...out, state: 'ready', autoGoalId: candidates[0].goalId };
    const useUnits = candidates.every(c => c.weight === 0);
    return { ...out, state: 'needs_goal', note: candidates.length ? 'Several goals hold or plan this product.' : 'No goal holds or plans this product.',
      weightSplit: splitByWeights(Math.abs(row.qty), candidates.map(c => ({ goalId: c.goalId, w: useUnits ? c.held : c.weight }))) };
  });
}

/* ---------- commit ---------- */
export interface NewTx { date: string; goalId: string; productId: string; type: 'buy' | 'sell' | 'coupon'; qty: number; price: number; commission: number | null; amount: number | null; note: string }
export interface Plan { tx: NewTx[]; imported: number; skipped: number; errors: string[] }

/** Turn the checked rows and the user's decisions into transactions. Splits must add up to the broker quantity exactly (ticket 08). */
export function planCommit(checks: RowCheck[], decisions: ImportDecisionIn[]): Plan {
  const out: NewTx[] = [], errors: string[] = []; let imported = 0, skipped = 0;
  for (const c of checks) {
    const d = decisions.find(x => x.n === c.row.n) ?? { n: c.row.n, mode: 'auto' as const };
    if (d.mode === 'skip' || ['duplicate', 'before_opening', 'unknown_product', 'needs_fix'].includes(c.state)) { skipped++; continue; }
    const total = Math.abs(c.row.qty);
    let parts: { goalId: string; units: number }[] = [];
    if (c.state === 'ready') parts = c.row.kind === 'coupon' ? c.weightSplit : [{ goalId: c.autoGoalId, units: total }];
    else if (d.mode === 'one' && d.goalId) parts = [{ goalId: d.goalId, units: total }];
    else if (d.mode === 'weights') parts = c.weightSplit;
    else if (d.mode === 'units') parts = d.parts ?? [];
    if (c.row.kind === 'coupon' && c.state === 'needs_goal' && d.goalId) parts = [{ goalId: d.goalId, units: 1 }];
    const sum = parts.reduce((a, p) => a + p.units, 0);
    if (!parts.length || (c.row.kind === 'trade' && !near(sum, total, 1e-6))) { skipped++; errors.push(`Row ${c.row.n}: the parts (${sum}) do not add up to the broker quantity (${total}).`); continue; }
    const share = (i: number, whole: number): number => {   // proportional to units, rounded to cents, the last part takes the remainder
      if (i === parts.length - 1) return Math.round((whole - parts.slice(0, i).reduce((a, p) => a + Math.round(whole * p.units / sum * 100) / 100, 0)) * 100) / 100;
      return Math.round(whole * parts[i].units / sum * 100) / 100;
    };
    parts.forEach((p, i) => {
      if (c.row.kind === 'coupon') out.push({ date: c.row.date, goalId: p.goalId, productId: c.productId, type: 'coupon', qty: 0, price: 0, commission: null, amount: share(i, c.row.amount ?? 0), note: 'Coupon' });
      else out.push({ date: c.row.date, goalId: p.goalId, productId: c.productId, type: c.row.side === 'V' ? 'sell' : 'buy', qty: c.row.side === 'V' ? -p.units : p.units, price: c.price, commission: share(i, c.row.commission), amount: null, note: '' });
    });
    imported++;
  }
  return { tx: out, imported, skipped, errors };
}
