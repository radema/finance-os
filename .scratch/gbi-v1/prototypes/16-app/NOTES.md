# Ticket 16: working prototype notes

Throwaway. The code is not the product; implementation starts clean from the spec. Sample data is the mock's own (made-up).

## Run

```bash
cd .scratch/gbi-v1/prototypes/16-app
pnpm install            # pnpm 10.32.1 is pinned by "packageManager"; see Stack findings
pnpm dev                # API 127.0.0.1:8716 + Vite 127.0.0.1:8717  ->  open http://127.0.0.1:8717
pnpm test               # Vitest: 18 golden + import tests
pnpm typecheck && pnpm build
pnpm build && pnpm start   # one process on 127.0.0.1:8716 serving dist/
```

Data: `GBI_DATA_DIR` (default `.data/` here, git-ignored; wipe it freely). Pin the clock with `GBI_AS_OF=2026-10-31`. First screen is the first-run checklist: "Load the sample data" fills everything.
Synthetic Fineco file: `public/fixtures/fineco-movimenti-synthetic.xlsx` (made by `node scripts/make-sample-xlsx.ts`; also offered by "Use the synthetic sample file" on the Import screen).

## What works (clickable, on fixture data)

| Area | State |
|---|---|
| Engine (`src/engine/`) | Port of the mock with ticket 07 and 12 rules: stub year, `couponRate`, commission in basis, yearly pension mix, M1 cut-off, net FI wealth, Level 1 without pension, targets follow expenseGrowth. Seeded MC, bisection, optimizer, cash flow, plan vs actual (versioned plan, cumulative), TWR/XIRR. |
| Overview | All 10 cells of prototype 11 on live data, rules R1-R8 in "Needs attention", price freshness, monthly snapshots trend. |
| Goal detail | Fan, value vs put in, cumulative plan vs actual, what it would take, holdings, change the monthly plan "from month X" (plan history). |
| Independence | Levels, % of target per year, fan, "what counts" ticks recalc on the server, multipliers, include-pension switch. |
| Transactions | List, filters, add form with commission estimate and cost warning, delete. |
| Import | Fineco XLSX preset, 4 steps. Statuses ready / already in records / already in opening position / needs a goal / product not found / needs fix. One goal, split by weights (largest remainder) or split by units (must sum to broker qty). Coupons stored as cash received. Batches with undo. Re-import adds 0 rows. |
| Current portfolio | As-of date, units + fiscal PMC, split across goals, writes `opening` transactions. |
| Prices | Month-end grid, manual entry for the last two months. |
| Setup | Products (presets), Goals with allocation weights, Cash flow + Level 1 source. |
| Optimizer | O1/O2/O4/O5, modes new money / rebalance, per-product cap, scatter, top 10, apply weights after confirm. |
| Goal history, Plan vs actual | Snapshot table with catch-up (previous month `saved`, older gaps `recomputed`); next contribution card. |

## Not built (nav placeholders or missing)

Pension screen and pension inputs form, Performance screen (engine computes it), Assumptions form (API has `PUT /api/settings`), Glossary page (terms show their text on hover only, not the prototype 11 popover), Yahoo fetch and the monthly job button, dismissals of alerts, R9 and R10, JSON import/restore (export exists: `GET /api/export`), generic CSV import with column mapping, edit/delete of products and goals, dark-mode check on the new screens, mobile pass.

## Learnt: what should change in the spec

**Engine and numbers**
1. **The pro-rata stub year changes the sample data.** Emergency fund (goal year 2027, value 14,063 vs target 16,132 in 2027) was On track in the mock (it added a full 2,400 in year 1). With two months left it is Off track, 0% against 90%, and R6 fires. Goal year 2027 means 1 January 2027 here. The spec should say so in the goal form ("goal year = 1 January") and the sample must be rebuilt.
2. **Stub shock scaling needs a rule.** Ticket 12 says "growth factor g^(r/12)". For Monte Carlo I used `exp(f·m + sqrt(f)·s·z)`, so the variance scales with time. `g^f` applied to the shock would shrink the variance by f². Put the sqrt rule in the spec.
3. **Target inflation uses T, not elapsed time.** Target = today's € × (1+infl)^T where T = goalYear − year(asOf). The real distance is T − 1 + r/12 years. The prototype keeps the mock rule (slightly conservative). Decide: keep, or inflate over the real distance.
4. **Cash flow stub.** I scale income, expenses and contributions of the current year by r/12 and keep events and the pension refund whole. The first bar of the capacity chart is small ("rest of year"). Confirm.
5. **FI per-year deflation** still uses (1+infl)^t with t = step index, so step 1 (a stub) is deflated by a full year. Same note as 3.
6. **Mock quirk fixed in the fixture:** the mock stores the sell as a positive quantity. The fixture uses a negative one (spec). The sample transactions carry no commission, so R7 (costly trades) never fires on them.
7. The mock sample has no `couponRate`; I added made-up rates (2.5-3.2%) to the three BTPs to exercise S1.

**Stack friction (ticket 05 checks)**
8. **Kysely + node:sqlite works with a 12-line adapter** (`src/server/db.ts`): `prepare()` returns `{reader, all, run, iterate}`; node:sqlite takes positional params as arguments (Kysely passes one array, so spread it); `reader = stmt.columns().length > 0`. No other friction: transactions, `onConflict`, migrations (`kysely/migration`, inline provider), `STRICT` tables and `VACUUM INTO` backup all work. Booleans must be stored as 0/1.
9. **Kysely 0.29 moved `Migrator` to `kysely/migration`.** Import from there.
10. **Node 24 runs the TS server directly** (type stripping): `node src/server/index.ts`, no tsx, no build step for the server. Rules: `.ts` extensions in imports, no enums or parameter properties (`erasableSyntaxOnly` in tsconfig catches them), `import type` for types (`verbatimModuleSyntax`). Shared code (`src/engine`, `src/shared`) runs unchanged in Node, Vite and Vitest. `node:sqlite` printed no experimental warning on 24.22.1.
11. **TypeScript 7.0.2 (native compiler)**: `tsc --noEmit` on 40 files takes well under a second. Vitest 5, Vite 8, zod 4, React 19, ECharts 6.1 all resolved with the 7-day rule.
12. **pnpm on this machine:** the default `pnpm` (corepack, v12.6.0) is broken (`MODULE_NOT_FOUND` in the corepack cache). `"packageManager": "pnpm@10.32.1"` makes it work. `pnpm-workspace.yaml` here sets `minimumReleaseAge: 10080` (supported and active, checked with `pnpm config get`) and `onlyBuiltDependencies: []`. `pnpm audit`: no known vulnerabilities. Install ran with scripts blocked and nothing broke (Vite 8 has no esbuild postinstall).
13. **Direct dependencies: 5 runtime** (react, react-dom, echarts, kysely, zod) **and 7 dev** (typescript, vite, @vitejs/plugin-react, vitest, 3 @types). The REST server is `node:http` (about 130 lines with the router); no Express or Hono.
14. **XLSX with no dependency is feasible:** a 60-line reader (zip directory + `inflateRawSync`, shared strings, inline strings) reads the ticket 09 shape. The synthetic file is written with `node:zlib` `crc32` + `deflateRawSync`. It has only been tested on files this prototype wrote, not on a real Fineco export. For the product use a maintained reader (the npm `xlsx` package is 0.18.5 with advisories) and test it on the real file once.
15. **Bundle:** 881 kB JS (286 kB gzip) even with ECharts imported by module (line, bar, scatter, grid, tooltip, markLine, SVG renderer). Fine for a local app. Fonts are bundled by Vite from `src/web/styles/fonts/`.
16. **Dev ports:** Vite binds 127.0.0.1:8717 (explicit host, `localhost` can bind `::1`) and proxies `/api` to 127.0.0.1:8716. `pnpm dev` is one 10-line script, no `concurrently`.

**Performance (this WSL2 machine, 6 goals, sample data)**

| Run | Time |
|---|---|
| Analysis, 1,000 paths, no solve | 72 ms |
| Analysis + required contributions (two bisections per goal) + FI 40 years | 230 ms |
| Snapshot, 300 paths | 12-19 ms (9 months of catch-up on first load: about 150 ms) |
| Optimizer 252 mixes (6 products, 20%), 300 paths | 85-185 ms |
| Optimizer 286 mixes (4 products, 10%) | 200 ms |
| Optimizer 1,001 mixes (5 products, 10%) | 680 ms |
| Optimizer "spend least", 286 mixes | 360 ms; 3 products 1.4 s (bisection per mix) |

The spec budgets (dashboard < 2 s, optimizer < 3 s, spend least < 10 s) hold with 5-10x margin on plain JS and one thread. No Worker, no WASM, no sidecar needed in v1. The server caches the overview by a SHA-1 of the inputs, so a re-render costs one request.

**Data model and rules**
17. **Import dedup must compare totals per (date, product, price), not per row**, because a split trade becomes several transactions with different quantities. Implemented as: existing total qty for that key equals the broker qty. Put this in ticket 08's rule text.
18. **Coupon split key:** by units held on the coupon date. For one goal it is automatic ("ready"); for several it is shown and automatic too. The spec says "split by units": add that it needs no user choice.
19. **Price age is by month** (a price of last month is "old" even if fetched yesterday for a quarterly fund). With 5 manual products always flagged, R5 fires every month. Per-kind thresholds (ticket 11 open question 2) are needed: manual-monthly products should be "old" only when the month before is missing.
20. **Goal colours:** slot rule used here: pension goal = slot 1, emergency-fund goal = slot 6, others in order from slot 2. It reproduces prototype 11. With more than six goals the colours repeat (open question 4 of ticket 11 still open).
21. **Transaction form price prefill** (spec: "price prefilled") is not done: the overview does not carry the latest price of products not held. Add `lastPrice` per product to the view.
22. **Settings stored as JSON in a `meta` table** (settings, correlations, pension, cash flow, opening date) and everything else in typed tables. It was quick; the spec decides whether settings versioning ("one row, versioned") needs a real table.

**UI gaps seen while using it**
23. The Range of outcomes chart is cramped in the 3-column grid at 1280 px (labels collide); it wants the two-column span.
24. Chance-of-success trend: a goal near its date falls to 0% in the last snapshots (the Emergency fund). The line is correct but steep; consider a note.
25. The ticket 08 "Current portfolio" and the split control are separate implementations here (two forms). In the build they should share one component.
26. The glossary popover of prototype 11 was replaced by `title` hints: not touch friendly. Port the popover.

## Open questions for you

1. Stub-year choices 2 to 5 above: sqrt shock scaling, inflation over T or over the real time, what to scale in the cash flow. Defaults used are the safe ones.
2. Should goal year mean "1 January" in the form, or do you want a goal month now (ticket 12 puts it in v2)? The Emergency fund case shows the rule bites when the goal year is next year.
3. Price age rule for monthly-priced products (point 19).
4. Do you want the one-purpose settings JSON (`meta`) in the v1 schema, or typed settings tables?
5. Keep the dependency-free XLSX reader and test it on a real Fineco file, or take a library?
6. Alert dismissals (ticket 10) and R9/R10 were left out; they need no new engine work.
