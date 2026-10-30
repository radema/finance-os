/* PROTOTYPE REST server (ticket 16): node:http, bound to 127.0.0.1, zod at the edge. Run with `node src/server/index.ts` (Node 24 strips the types). */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { z } from 'zod';
import { analyse, estCommission, mkey } from '../engine/core.ts';
import { optimizeMix } from '../engine/optimizer.ts';
import type { EngineState } from '../engine/types.ts';
import { ApplyWeights, CashflowPatch, GoalInput, ImportCommit, OpeningInput, OptimizerInput, PricesInput, ProductInput, SettingsPatch, TxInput, ImportRowSchema } from '../shared/schemas.ts';
import type { BatchView, PriceGrid, TxView } from '../shared/view.ts';
import { buildOverview, missingSnapshots, snapshotOf } from './analysis.ts';
import { backup, openDb } from './db.ts';
import { checkRows, parseFineco, planCommit } from './import/fineco.ts';
import * as store from './store.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const dataDir = process.env.GBI_DATA_DIR || join(ROOT, '.data');   // PROTOTYPE data folder, safe to wipe
const PORT = Number(process.env.GBI_PORT || 8716), HOST = '127.0.0.1';
const today = (): string => process.env.GBI_AS_OF || new Date().toISOString().slice(0, 10);

const o = await openDb(dataDir), db = o.db;
backup(o, today());
const state = (): Promise<EngineState> => store.loadState(db, today());

/* ---------- tiny router ---------- */
type Ctx = { body: unknown; raw: Buffer; params: string[]; url: URL };
type Handler = (c: Ctx) => Promise<unknown> | unknown;
const routes: { m: string; re: RegExp; h: Handler }[] = [];
const route = (m: string, path: string, h: Handler): void => { routes.push({ m, re: new RegExp('^' + path.replace(/:[a-z]+/g, '([^/]+)') + '$'), h }); };
class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

/* ---------- overview, with snapshot catch-up ---------- */
async function overview() {
  const st = await state();
  let snaps = await store.loadSnapshots(db);
  const fresh = missingSnapshots(st, snaps);
  for (const s of fresh) await store.saveSnapshot(db, s);
  if (fresh.length) snaps = await store.loadSnapshots(db);
  const { meta } = await store.loadPrices(db);
  return buildOverview(st, meta, snaps, !!(await store.getOpeningAsOf(db)));
}
route('GET', '/api/overview', overview);
route('POST', '/api/sample', async () => { await store.seedSample(db, today()); return overview(); });
route('POST', '/api/reset', async () => { await store.wipe(db); return overview(); });

/* ---------- setup ---------- */
route('POST', '/api/products', async c => ({ id: await store.upsertProduct(db, ProductInput.parse(c.body)) }));
route('POST', '/api/goals', async c => ({ id: await store.upsertGoal(db, GoalInput.parse(c.body), today()) }));
route('PUT', '/api/goals/:id/weights', async c => { const w = z.object({ weights: z.array(z.object({ productId: z.string(), weight: z.number().min(0) })) }).parse(c.body); await store.setWeights(db, c.params[0], w.weights); return { ok: true }; });
route('PUT', '/api/goals/:id/fire', async c => { await db.updateTable('goal').set({ counts_fi: z.object({ fire: z.boolean() }).parse(c.body).fire ? 1 : 0 }).where('id', '=', c.params[0]).execute(); return { ok: true }; });
route('PUT', '/api/settings', async c => {
  const patch = SettingsPatch.parse(c.body), cur = (await state()).settings;
  await store.setMeta(db, 'settings', { ...cur, ...patch, fire: { ...cur.fire, ...patch.fire }, commission: { ...cur.commission, ...patch.commission } }); return { ok: true };
});
route('PUT', '/api/cashflow', async c => { const cur = (await state()).cashflow; await store.setMeta(db, 'cashflow', { ...cur, ...CashflowPatch.parse(c.body) }); return { ok: true }; });
route('PUT', '/api/pension', async c => { const cur = (await state()).pension; await store.setMeta(db, 'pension', { ...cur, ...(c.body as object) }); return { ok: true }; });

/* ---------- transactions ---------- */
route('GET', '/api/transactions', async (): Promise<TxView[]> => {
  const st = await state(), prods = new Map(st.products.map(p => [p.id, p]));
  return st.ledger.slice().reverse().map(t => ({ id: t.id, date: t.date, goalId: t.goalId, productId: t.productId, type: t.type, qty: t.qty, price: t.price, commission: t.commission, amount: t.amount, batchId: t.batchId,
    estFee: t.type === 'buy' || t.type === 'sell' ? estCommission(st.settings, prods.get(t.productId), t.type, t.qty * t.price) : null }));
});
route('POST', '/api/transactions', async c => ({ id: await store.addTx(db, TxInput.parse(c.body)) }));
route('DELETE', '/api/transactions/:id', async c => { await db.deleteFrom('tx').where('id', '=', c.params[0]).execute(); return { ok: true }; });
route('POST', '/api/portfolio', async c => ({ created: await store.setOpening(db, OpeningInput.parse(c.body)) }));

/* ---------- prices ---------- */
route('GET', '/api/prices', async (c): Promise<PriceGrid> => {
  const st = await state(), { meta } = await store.loadPrices(db), n = Number(c.url.searchParams.get('n') || 6), cur = mkey(today());
  const months = Array.from({ length: n }, (_, i) => { let [y, m] = cur.split('-').map(Number); m -= n - 1 - i; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; });
  return { months, products: st.products.map(p => ({ id: p.id, name: p.name, regime: p.regime, source: p.source,
    cells: Object.fromEntries(months.map(m => [m, st.prices[p.id]?.[m] != null ? { price: st.prices[p.id][m], source: meta[p.id][m].source, fetchedAt: meta[p.id][m].fetchedAt } : undefined])) })) };
});
route('POST', '/api/prices', async c => { await store.setPrices(db, PricesInput.parse(c.body).prices, today()); return { ok: true }; });

/* ---------- import (Fineco XLSX preset) ---------- */
route('POST', '/api/import/parse', async c => {
  const parsed = parseFineco(c.raw), st = await state();
  return { ...parsed, checks: checkRows(st, parsed.rows, await store.getOpeningAsOf(db)) };
});
route('POST', '/api/import/check', async c => checkRows(await state(), z.object({ rows: z.array(ImportRowSchema) }).parse(c.body).rows, await store.getOpeningAsOf(db)));
route('POST', '/api/import/commit', async c => {
  const b = ImportCommit.parse(c.body), st = await state(), plan = planCommit(checkRows(st, b.rows, await store.getOpeningAsOf(db)), b.decisions);
  const id = store.newId('b');
  await db.transaction().execute(async trx => {
    await trx.insertInto('import_batch').values({ id, kind: 'transactions', source: 'Fineco movimenti (XLSX)', file_name: b.fileName, created_at: new Date().toISOString(), rows_read: b.rows.length, rows_imported: plan.imported, rows_skipped: plan.skipped, undone_at: null }).execute();
    for (const t of plan.tx) await trx.insertInto('tx').values(store.txRow({ ...t, batchId: id })).execute();
  });
  return { batchId: id, imported: plan.imported, skipped: plan.skipped, transactions: plan.tx.length, errors: plan.errors };
});
route('GET', '/api/imports', async (): Promise<BatchView[]> => (await db.selectFrom('import_batch').selectAll().orderBy('created_at', 'desc').execute())
  .map(b => ({ id: b.id, source: b.source, fileName: b.file_name, createdAt: b.created_at, rowsRead: b.rows_read, rowsImported: b.rows_imported, rowsSkipped: b.rows_skipped, undoneAt: b.undone_at })));
route('POST', '/api/imports/:id/undo', async c => {
  await db.transaction().execute(async trx => { await trx.deleteFrom('tx').where('batch_id', '=', c.params[0]).execute(); await trx.updateTable('import_batch').set({ undone_at: new Date().toISOString() }).where('id', '=', c.params[0]).execute(); });
  return { ok: true };
});

/* ---------- snapshots, optimizer ---------- */
route('POST', '/api/snapshots', async () => {   // manual "Save snapshot" for the current month: the frozen copy replaces any recomputed one
  const st = await state(), a = analyse(st, st.asOf, { paths: 300 });
  await store.saveSnapshot(db, snapshotOf(a, mkey(st.asOf), 'saved')); return { ok: true };
});
route('POST', '/api/optimizer', async c => {
  const b = OptimizerInput.parse(c.body), st = await state(), t0 = Date.now();
  const r = optimizeMix(st, b.goalId, { mode: b.mode, criterion: b.criterion, maxW: b.maxW, universe: b.universe });
  return { ...r, ms: Date.now() - t0 };
});
route('POST', '/api/optimizer/apply', async c => {
  const b = ApplyWeights.parse(c.body), st = await state();
  const keep = st.weights.filter(w => w.goalId === b.goalId && !b.universe.includes(w.productId)).map(w => ({ productId: w.productId, weight: 0 }));
  await store.setWeights(db, b.goalId, [...b.universe.map((productId, i) => ({ productId, weight: b.weights[i] })), ...keep]); return { ok: true };
});

/* ---------- export (full JSON) ---------- */
route('GET', '/api/export', async () => ({ exportedAt: new Date().toISOString(), state: await state(), prices: (await store.loadPrices(db)).meta, snapshots: await store.loadSnapshots(db) }));

/* ---------- http glue ---------- */
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };
function serveStatic(url: URL, res: ServerResponse): void {
  const dist = join(ROOT, 'dist'), rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''), file = join(dist, rel === '/' ? 'index.html' : rel);
  const f = file.startsWith(dist) && existsSync(file) && !file.endsWith('/') ? file : join(dist, 'index.html');
  if (!existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Run `pnpm build` first, or use `pnpm dev`.'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
}
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const ch of req) { n += (ch as Buffer).length; if (n > 20e6) throw new HttpError(413, 'File too large'); chunks.push(ch as Buffer); }
  return Buffer.concat(chunks);
}
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
  try {
    const raw = await readBody(req), found = routes.map(r => ({ r, m: r.re.exec(url.pathname) })).find(x => x.m && x.r.m === req.method);
    if (!found || !found.m) throw new HttpError(404, 'Not found');
    const isJson = (req.headers['content-type'] || '').includes('json');
    const body = isJson && raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
    const out = await found.r.h({ body, raw, params: found.m.slice(1).map(decodeURIComponent), url });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? { ok: true }, (_k, v) => (v instanceof Float64Array ? Array.from(v) : v)));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500, msg = e instanceof z.ZodError ? e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : (e as Error).message;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: msg }));
  }
});
server.listen(PORT, HOST, () => console.log(`GBI prototype API on http://${HOST}:${PORT}  data: ${dataDir}`));
const stop = (): void => { server.close(); void db.destroy().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
