/* Reads and writes the database. The only place with SQL (through Kysely). Maps rows to the engine's input types. */
import { randomUUID } from 'node:crypto';
import { defaultCashflow, defaultCorr, defaultPension, defaultSettings } from '../engine/defaults.ts';
import { mkey } from '../engine/core.ts';
import { sampleState } from '../engine/sample.ts';
import type { CashFlowIn, EngineState, Pension, PriceTable, Settings, Tx } from '../engine/types.ts';
import type { GoalIn, OpeningIn, ProductIn, TxIn } from '../shared/schemas.ts';
import type { Db } from './db.ts';

export const newId = (p: string): string => `${p}${randomUUID().slice(0, 8)}`;
const cents = (v: number | null): number | null => (v == null ? null : Math.round(v * 100));
const eur = (c: number | null): number | null => (c == null ? null : c / 100);

/* ---------- meta (settings, correlations, pension, cash flow) ---------- */
async function getMeta<T>(db: Db, key: string, fallback: T): Promise<T> {
  const r = await db.selectFrom('meta').select('value').where('key', '=', key).executeTakeFirst();
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export async function setMeta(db: Db, key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);
  await db.insertInto('meta').values({ key, value: v }).onConflict(oc => oc.column('key').doUpdateSet({ value: v })).execute();
}

export interface PriceMeta { source: string; fetchedAt: string }
export async function loadPrices(db: Db): Promise<{ table: PriceTable; meta: Record<string, Record<string, PriceMeta>> }> {
  const table: PriceTable = {}, meta: Record<string, Record<string, PriceMeta>> = {};
  for (const r of await db.selectFrom('price').selectAll().execute()) {
    (table[r.product_id] ||= {})[r.month] = r.price;
    (meta[r.product_id] ||= {})[r.month] = { source: r.source, fetchedAt: r.fetched_at };
  }
  return { table, meta };
}

export async function loadState(db: Db, asOf: string): Promise<EngineState> {
  const [prods, goals, plans, weights, txs, prices, settings, corr, pension, cashflow] = await Promise.all([
    db.selectFrom('product').selectAll().orderBy('id').execute(),
    db.selectFrom('goal').selectAll().orderBy('ord').execute(),
    db.selectFrom('goal_plan').selectAll().orderBy('from_month').execute(),
    db.selectFrom('weight').selectAll().execute(),
    db.selectFrom('tx').selectAll().orderBy('date').orderBy('id').execute(),
    loadPrices(db),
    getMeta<Settings>(db, 'settings', defaultSettings()),
    getMeta<number[][]>(db, 'corr', defaultCorr()),
    getMeta<Pension>(db, 'pension', defaultPension()),
    getMeta<CashFlowIn>(db, 'cashflow', defaultCashflow())
  ]);
  const pensionGoal = goals.find(g => g.is_pension);
  return {
    asOf, settings: { ...defaultSettings(), ...settings }, corr, pension: { ...pension, goalId: pensionGoal?.id ?? '' }, cashflow, prices: prices.table,
    products: prods.map(p => ({ id: p.id, name: p.name, isin: p.isin, cls: p.cls as never, regime: p.regime as never, wl: p.wl, mu: p.mu, vol: p.vol, ter: p.ter, zero: !!p.zero,
      maturity: p.maturity, ticker: p.ticker, source: p.source as never, couponRate: p.coupon_rate })),
    goals: goals.map(g => ({ id: g.id, name: g.name, priority: g.priority as never, target: g.target, year: g.year, cgrowth: g.cgrowth, minProb: g.min_prob, fire: !!g.counts_fi,
      plan: plans.filter(p => p.goal_id === g.id).map(p => ({ from: p.from_month, amount: p.amount })) })),
    weights: weights.map(w => ({ goalId: w.goal_id, productId: w.product_id, weight: w.weight })),
    ledger: txs.map((t): Tx => ({ id: t.id, date: t.date, goalId: t.goal_id, productId: t.product_id, type: t.type as never, qty: t.qty, price: t.price, commission: eur(t.commission_cents),
      amount: eur(t.amount_cents), note: t.note, batchId: t.batch_id }))
  };
}

/* ---------- products and goals ---------- */
export async function upsertProduct(db: Db, p: ProductIn): Promise<string> {
  const id = p.id || newId('p');
  const row = { id, name: p.name, isin: p.isin, cls: p.cls, regime: p.regime, wl: p.wl, mu: p.mu, vol: p.vol, ter: p.ter, zero: p.zero ? 1 : 0, maturity: p.maturity, ticker: p.ticker, source: p.source, coupon_rate: p.couponRate };
  await db.insertInto('product').values(row).onConflict(oc => oc.column('id').doUpdateSet(row)).execute();
  return id;
}
export async function upsertGoal(db: Db, g: GoalIn, today: string): Promise<string> {
  const id = g.id || newId('g');
  if (g.isPension) await db.updateTable('goal').set({ is_pension: 0 }).where('id', '!=', id).execute();   // exactly one pension goal
  const ord = (await db.selectFrom('goal').select(db.fn.max('ord').as('m')).executeTakeFirst())?.m ?? 0;
  const row = { id, name: g.name, priority: g.priority, target: g.target, year: g.year, cgrowth: g.cgrowth, min_prob: g.minProb, counts_fi: g.fire ? 1 : 0, is_pension: g.isPension ? 1 : 0 };
  await db.insertInto('goal').values({ ...row, ord: ord + 1 }).onConflict(oc => oc.column('id').doUpdateSet(row)).execute();
  if (g.monthly != null) {
    const from = g.monthlyFrom || mkey(today), amount = g.monthly;
    await db.insertInto('goal_plan').values({ goal_id: id, from_month: from, amount }).onConflict(oc => oc.columns(['goal_id', 'from_month']).doUpdateSet({ amount })).execute();
  }
  return id;
}
export async function setWeights(db: Db, goalId: string, weights: { productId: string; weight: number }[]): Promise<void> {
  await db.deleteFrom('weight').where('goal_id', '=', goalId).execute();
  if (weights.length) await db.insertInto('weight').values(weights.map(w => ({ goal_id: goalId, product_id: w.productId, weight: w.weight }))).execute();
}

/* ---------- transactions, prices ---------- */
export const txRow = (t: Omit<Tx, 'id'> & { id?: string }) => ({
  id: t.id || newId('t'), date: t.date, goal_id: t.goalId, product_id: t.productId, type: t.type, qty: t.qty, price: t.price,
  commission_cents: cents(t.commission), amount_cents: cents(t.amount), note: t.note, batch_id: t.batchId
});
export async function addTx(db: Db, t: TxIn): Promise<string> {
  const r = txRow({ ...t, batchId: null });
  await db.insertInto('tx').values(r).execute();
  return r.id;
}
export async function setOpening(db: Db, o: OpeningIn): Promise<number> {
  /* each part is an `opening` transaction with price = the fiscal PMC; it never counts as a contribution (ticket 08) */
  let n = 0;
  for (const it of o.items) for (const part of it.parts) {
    await db.insertInto('tx').values(txRow({ date: o.asOf, goalId: part.goalId, productId: it.productId, type: 'opening', qty: part.units, price: it.pmc, commission: null, amount: null, note: 'Current portfolio', batchId: null })).execute(); n++;
  }
  await setMeta(db, 'openingAsOf', o.asOf);
  return n;
}
export const getOpeningAsOf = (db: Db): Promise<string> => getMeta<string>(db, 'openingAsOf', '');

export async function setPrices(db: Db, rows: { productId: string; month: string; price: number; source: string }[], fetchedAt: string): Promise<void> {
  for (const r of rows) {
    const v = { product_id: r.productId, month: r.month, price: r.price, source: r.source, fetched_at: fetchedAt };
    await db.insertInto('price').values(v).onConflict(oc => oc.columns(['product_id', 'month']).doUpdateSet(v)).execute();
  }
}

/* ---------- snapshots ---------- */
export interface SnapGoal { id: string; prob: number; reqP: number; detNet: number; target: number; median: number; p10: number; p90: number; value: number; status: string }
export interface Snap { month: string; date: string; source: 'saved' | 'recomputed'; goals: SnapGoal[] }
export async function loadSnapshots(db: Db): Promise<Snap[]> {
  return (await db.selectFrom('snapshot').selectAll().orderBy('month').execute()).map(r => ({ month: r.month, date: r.date, source: r.source as Snap['source'], goals: JSON.parse(r.goals) as SnapGoal[] }));
}
export async function saveSnapshot(db: Db, s: Snap): Promise<void> {
  const v = { month: s.month, date: s.date, source: s.source, goals: JSON.stringify(s.goals) };
  await db.insertInto('snapshot').values(v).onConflict(oc => oc.column('month').doUpdateSet(v)).execute();
}

/* ---------- wipe and sample ---------- */
export async function wipe(db: Db): Promise<void> {
  for (const t of ['tx', 'price', 'weight', 'goal_plan', 'goal', 'product', 'import_batch', 'snapshot', 'meta'] as const) await db.deleteFrom(t).execute();
}
/** Fixture load: the mock's sample data. Prices for the pension funds and two BTPs stop in September so the old-price flag has something to show. */
export async function seedSample(db: Db, today: string): Promise<void> {
  await wipe(db);
  const st = sampleState(), valMonth = mkey(today);
  for (const p of st.products) await upsertProduct(db, p);
  let ord = 0;
  for (const g of st.goals) {
    await db.insertInto('goal').values({ id: g.id, name: g.name, priority: g.priority, target: g.target, year: g.year, cgrowth: g.cgrowth, min_prob: g.minProb, counts_fi: g.fire ? 1 : 0, is_pension: g.id === st.pension.goalId ? 1 : 0, ord: ++ord }).execute();
    for (const v of g.plan) await db.insertInto('goal_plan').values({ goal_id: g.id, from_month: v.from, amount: v.amount }).execute();
  }
  await db.insertInto('weight').values(st.weights.map(w => ({ goal_id: w.goalId, product_id: w.productId, weight: w.weight }))).execute();
  const STALE = new Set(['p8', 'p10', 'p11', 'p12', 'p13']);
  const rows: { productId: string; month: string; price: number; source: string }[] = [];
  for (const [pid, ps] of Object.entries(st.prices)) for (const [month, price] of Object.entries(ps)) {
    if (STALE.has(pid) && month >= valMonth) continue;
    rows.push({ productId: pid, month, price, source: st.products.find(p => p.id === pid)!.source });
  }
  await setPrices(db, rows, today);
  for (let i = 0; i < st.ledger.length; i += 50) await db.insertInto('tx').values(st.ledger.slice(i, i + 50).map(txRow)).execute();
  await setMeta(db, 'settings', st.settings); await setMeta(db, 'corr', st.corr); await setMeta(db, 'pension', st.pension); await setMeta(db, 'cashflow', st.cashflow);
  await setMeta(db, 'openingAsOf', '2024-01-02');
}
