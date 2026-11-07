# GBI planner v1 — spec

Status: draft for review (ticket 14). Source: `reference/source-spec.md` (the base) plus the resolved
tickets of `map.md`. Where a ticket differs from the source spec, the ticket wins; each such rule is
tagged with its ticket, e.g. "(t12)". Ticket 16 is newer than ticket 12 and wins over it.

## Problem Statement

One Italian household investor tracks goal-based investing in an Excel/Google Sheets workbook
(`gbi-planner-v2.xlsx`). The workbook has formula errors (t04), no history of how goals evolve, no
performance tracking, slow manual price and transaction entry, and no alerts. The user needs a
private, local app that answers "will each goal be reached, and what should I do next month?" from
the real ledger, without sending personal data anywhere.

## Solution

A standalone, local-first web app (`gbi` command on the user's MacBook, server on `127.0.0.1`,
browser UI) that replaces the workbook. It keeps every feature of Excel v2 and adds performance
tracking, goal-analysis snapshots, a richer dashboard, four financial-independence levels, a
per-bucket mix optimizer and rule-based alerts. The app suggests; it never acts on the account.

User: one person, regime amministrato, one Fineco account, Italian pension funds, EUR only, tax
rules as of 2026. The repo `radema/finance-os` is emptied and restarted for this app; the old
Finance OS lives only in git history (t06).

## User Stories

1. As the investor, I want to describe each goal (target in today's €, year, priority Need/Want/Wish, monthly plan), so that the app knows what I am saving for.
2. As the investor, I want to assign products to goals with weights, so that new money is split the way I intend.
3. As the investor, I want holdings, cost basis and values derived from transactions and prices, so that I never type a derived number.
4. As the investor, I want to enter my transferred portfolio once (units and fiscal PMC per product, split across goals), so that I do not import years of history.
5. As the investor, I want to import my Fineco XLSX export in a few clicks, with duplicates and already-covered rows skipped, so that monthly upkeep is fast.
6. As the investor, I want to split one broker trade across goals by weights or by units, always confirmed by me, so that each bucket stays right.
7. As the investor, I want to undo a whole import, so that a wrong file costs nothing.
8. As the investor, I want ETF prices fetched online and BTP/pension prices typed or pasted, each with its source and age shown, so that I trust every valuation.
9. As the investor, I want a net-of-tax projection per goal (deterministic and Monte Carlo) with P(success) against the required probability, so that I know which goals are at risk.
10. As the investor, I want the monthly contribution needed to reach each goal, so that I can act.
11. As the investor, I want the pension fund modelled (TFR, contributions, deduction, refund, exit tax), so that retirement is planned with the real tax rules.
12. As the investor, I want my household cash flow for 10 years against the plan, so that I see whether the plan is affordable.
13. As the investor, I want four financial-independence levels with progress and the year each is reached, so that I see the long-term picture.
14. As the investor, I want TWR, XIRR and drawdown per scope, so that I know how my money performed.
15. As the investor, I want a monthly snapshot of every goal's analysis, so that I see whether goals get safer or riskier over time.
16. As the investor, I want plan vs actual as cumulative totals, with my plan changes versioned, so that flexible months are not flagged as failures.
17. As the investor, I want alerts that always show the rule that produced them, and that I can dismiss until the condition changes, so that I trust and control them.
18. As the investor, I want an optimizer that compares mixes of a bucket's products on the same simulated markets and tells me which rule chose the result, so that I can choose new weights knowingly.
19. As the investor, I want a glossary with the Italian terms and plain explanations next to every jargon word, so that the numbers are understandable.
20. As the investor, I want my data only on my machine, with automatic backups and a full JSON export, so that nothing is lost and nothing leaks.

## Implementation Decisions

### Stack and repo (t05, t06, t16)

- TypeScript end to end. One package with folders `engine/`, `server/`, `web/` (+ shared zod schemas).
- `engine/`: pure TS, no I/O, ported function by function from the mock engine in
  `reference/mock-app.html`, with the rule changes below. Float64; one engine only. Escalation path if
  numerics ever need it: `@stdlib` → Python sidecar → WASM. Not needed in v1 (t16 measured 5–10×
  margin on every budget).
- `server/`: Node 24 LTS, runs the TS sources directly (type stripping: `.ts` import extensions, no
  enums or parameter properties, `import type`; tsconfig `erasableSyntaxOnly`, `verbatimModuleSyntax`).
  REST JSON over `node:http` with a small router; zod validates every request. Binds `127.0.0.1` only.
- Storage: SQLite through built-in `node:sqlite` + Kysely, joined by a small adapter (`prepare()` →
  `{reader, all, run, iterate}`, positional params spread, `reader = columns().length > 0`). Kysely 0.29
  imports `Migrator` from `kysely/migration`. Forward-only TS migrations applied at start. WAL, `STRICT`
  tables, booleans as 0/1. Money as integer cents; units and prices as integers scaled by 10^6;
  conversion to float only when handing data to the engine; rounding only in the view.
- Settings-like documents (settings, commission, FI settings, correlations, pension plan, cash flow,
  opening date) are stored as zod-validated JSON, one row per kind. No settings history table:
  snapshots carry their own frozen results and an `assumptionsHash` (t16 finding 22).
- `web/`: React + Vite, Apache ECharts imported by module (SVG renderer). No Plotly. Vite dev server
  on `127.0.0.1`, proxying `/api`.
- pnpm 10, `"packageManager": "pnpm@10.32.1"` (t16: the default corepack pnpm is broken on the
  user's machines); `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` and
  `onlyBuiltDependencies: []`; exact versions; committed lockfile; few deps (prototype: 5 runtime,
  7 dev). The installed app is one built bundle with no runtime `node_modules`.
- Quality: TypeScript `strict`; Biome lint + format; Vitest + fast-check.
- XLSX: own dependency-free reader (zip directory + `inflateRawSync`, shared and inline strings) (t16).
  No `xlsx` npm package.
- Data folder: `GBI_DATA_DIR`, default `~/Library/Application Support/gbi/`; a warning when it sits in
  a cloud-synced folder (iCloud Drive, Dropbox, OneDrive, Google Drive paths). `GBI_AS_OF` pins the
  clock for tests and UI checks (t12 E7: `asOf` is an engine input).
- Backups: at start, at most once a day, `VACUUM INTO <data>/backups/`, keep the 30 newest. Full JSON
  export on demand; JSON import restores all data (after a backup).
- Network: only downloads of public prices. User data never leaves the machine. No CDN: fonts and
  libraries are bundled.
- Install: build the bundle and install it globally from the repo, giving the `gbi` command, which
  starts the server and opens the browser.

### Repo restart (t06, t13)

Before the wipe the user creates and pushes the annotated tag `finance-os-legacy` on `fb215e5`
(ticket-loop never pushes tags). Old local branches are not touched.

| Item | Verdict |
|---|---|
| `src/`, `tests/`, `pyproject.toml`, `uv.lock` | delete |
| `docs/seed/`, `docs/wiki/`, `docs/plans/`, `docs/archive/`, `docs/handoff/`, `docs/features-candidates/`, `docs/design/` | delete |
| `PRODUCT.md`, `README.md` | delete; new `README.md` written from scratch |
| `DESIGN.md`, `.impeccable/` | delete; new `DESIGN.md` built from `prototypes/11-ui/` (tokens, type, components, chart rules) |
| Fonts in `src/financeos/web/static/fonts/` | delete; Geist + Geist Mono are bundled instead |
| `demo/`, `real/` | delete; data lives in `GBI_DATA_DIR`; sample data is the synthetic fixture below |
| `.gitignore` | rewrite for Node (`node_modules/`, `dist/`, coverage, tool caches); keep `.claude/worktrees/`, OS/editor files, `*:Zone.Identifier`; add `*.sqlite`, `*.db`, `*.xlsx`, `*.csv` outside the fixtures folder `fixtures/` |
| `CLAUDE.md` | replace (below) |
| `.scratch/gbi-v1/` | keep as is: source of truth during the build |

During the build, `.scratch/gbi-v1/spec.md` is the source of truth; ADRs go to
`.scratch/gbi-v1/adr/NNNN-slug.md`, the domain glossary to `.scratch/gbi-v1/glossary.md`. They move
to `docs/` only when the build is done. No RFCs, no numbered invariants.

New `CLAUDE.md` (60–80 lines), text as in `research/06-claude-md-draft.md` with these sections:
What this is; Source of truth; Commands (`pnpm install`, `pnpm dev`, `pnpm test`, `pnpm gate`,
`pnpm build && gbi`); Gate; Architecture (six rules: pure engine; web only via REST; SQL only in
server via Kysely, forward-only migrations; money in integer cents; network only for public prices,
no CDN; few exact-pinned deps — rules 1–3 enforced by a test or Biome rule); Clean code; Data; Design
(points to `DESIGN.md`); Language; Git (`main` trunk, `feat/...` branches, PR to `main`, the user
merges, conventional commits citing the sub-issue or `AC-` id, Sonnet implements / Opus reviews).
Deltas to the draft: the Commands section names the pnpm pin (`pnpm@10.32.1`), and the Architecture
section adds the Node type-stripping rules above.

### Domain model

Transactions and prices are the only sources of truth for holdings. Values, cost bases and
performance are always derived.

| Entity | Key fields | Notes |
|---|---|---|
| Settings | inflation, taxStd 26%, taxGovt 12.5%, bollo 0.2%, pensionTax 20%, required probabilities (Need 90 / Want 75 / Wish 50), MC paths (1,000), seed, trackingStart (YYYY-MM), zainetto {amount, expiry, goalId}, pension deduction cap (€5,300, one value for all years, t12), rule thresholds (R1 N months = 3 (t10), R3 36 months, R7 1.25×, status band 15 points, daily price age 7 days (t16)) | One document |
| Commission | plan (text, default "Fineco Trading"), feeModel (`percent` \| `flat`), rate 0.19%, min €2.95, max €19, flatFee, minTicket | t03: fees depend on the plan. `percent`: fee = clamp(rate × amount, min, max), min efficient ticket = min / rate. `flat`: fee = flatFee, min efficient ticket = `minTicket` set by the user |
| FireSettings | efFromGoal (goalId) or efMonths (12), baristaMult 200, l2Mult 300, l3Mult 200, includePension **true** (t07; baristaMult #9 follow-up, a missing value reads as 200) | |
| AssetClass | 6 fixed: Equity, Govt bonds, Corp bonds, Multi-asset, Cash, Gold/Commodities | 6×6 correlation matrix |
| Product | id, name, ISIN, assetClass, regime (`etf`, `direct`, `govt`, `cash`, `pension`), whiteListShare, expReturn μ, volatility σ, TER/ISC, maturity (YYYY-MM), couponRate (govt only, default 0, t12 S1), zeroCommission (per-product flag the user maintains, t03), priceSource (`provider`, `csv`, `manual`), ticker, brokerUnits? + brokerUnitsDate? (for R9) | μ, σ are user assumptions |
| PricePoint | productId, month (YYYY-MM), price per unit, priceDate (date of the close), source (`provider`, `csv`, `manual`), fetchedAt, importBatchId? | One per product and month; the current month holds the latest close until the month ends. Bonds: price per 100. Pension: unit value |
| Goal | id, name, priority, target (today's €), targetYear, contributionGrowth, minProb?, countsTowardFI | Due on **31 December of targetYear** (t16). Exactly one goal may be the pension goal |
| ContributionPlan | goalId, fromMonth (YYYY-MM), monthly € | Versioned plan (t10). Editing asks "from which month" (default current month) |
| AllocationWeight | goalId, productId, weight | Rescaled to 100% per goal; not versioned |
| Transaction | id, date, goalId, productId, type (`opening`, `buy`, `sell`, `pensionContribution`, `coupon`), qty (signed; 0 for coupon), price, commission? (actual), amount (coupon: net cash received), flow? (`Work`, `Voluntary`; `pensionContribution` only), note, importBatchId? | Sell = negative qty (t08 adds `coupon`). A pension contribution's flow defaults from the plan's flows when the product takes one flow only; a product with both flows needs the user to choose (S3 fix, AC-94) |
| OpeningPosition | asOf date (default trackingStart) | One per account (t08) |
| ImportBatch | id, kind (`transactions`, `prices`, `products`, `goals`), source name, file name, createdAt, rows read / imported / skipped, undoneAt?, prior state of overwritten prices | Unit of undo |
| ImportMapping | name, kind, column map, delimiter, decimal and date format | Preset "Fineco movimenti (XLSX)" (t08) + saved user mappings |
| PensionPlan | ral, ralGrowth, tfrPct, workerPct, employerPct, voluntary (blank = to cap), marginalRate, firstYear, extra (€2,650), goalId, flows[{productId, flow Work/Voluntary, pct}] | |
| CashFlow | income, incomeGrowth, essential €/month, optional €/month, expenseGrowth, events[{year, label, amount}] | Also feeds FI levels. `incomeGrowth` and `expenseGrowth` are growth above inflation: 0% keeps up with prices (#156) |
| Snapshot | month, source (`saved`, `recomputed`), assumptionsHash, per goal {prob, reqP, detNet, target, median, p10, p90, value, status} | Frozen at save time |
| Dismissal | ruleId, scope (goal or product or none), key, dismissedAt | t10. Alerts themselves are generated, never stored |

Derived, not stored: units per (goal, product) = Σ qty. Account PMC per product: on a buy or opening,
PMC = (PMC × units + price × qty + commission) / (units + qty) (t12 S2: commission in basis, as
Fineco's fiscal PMC); sells leave it unchanged. Bucket basis = units × PMC. Value = units × price
(bonds: price / 100).

Cash amount of a transaction (used by performance and plan vs actual): `qty × unitPrice + commission`
for opening, buy, sell and pensionContribution (a sell is negative); for a coupon, `−amount`.

### Calculation engine

One pure deterministic module. Same inputs and seed give the same outputs. `asOf` is an input.

**Per-product parameters.** Lognormal: s = √ln(1 + σ²/(1+μ)²), m = ln(1+μ) − s²/2. Tax on gains by
regime: `etf` 26% − 13.5% × whiteListShare (redditi di capitale, not offsettable); `direct` 26%,
`govt` 12.5%, both offsettable by losses and the zainetto; `cash` interest taxed yearly at 26%, no
exit tax; `pension` return taxed yearly at pensionTax (20%), symmetric, no stamp duty, exit tax on
the taxable basis (contributions minus the non-deducted part, see Pension schedule).

**Time grid (t12 E9, t16).** Y0 = year(asOf). r = 12 − month(asOf) (the asOf month counts as done);
f = r / 12. Step 1 is the stub of Y0 with fraction f; steps 2… are the full years Y0+1 … targetYear.
The goal is due on 31 December of targetYear, so the goal year is a full year with its contribution.
Real time from asOf to the goal date: τ = f + (targetYear − Y0). Horizon < 1 year when τ < 1.
A goal with targetYear < Y0 is due now: τ = 0, no contributions, liquidated at asOf (as the mock's
T = max(0, …)).
This supersedes ticket 12's "goal date = 1 January" and its full years "… goal year − 1".

**Goal projection, one path, step with fraction φ (φ = f for step 1, else 1).** For each product:

- Growth: deterministic g = ((1 + μ)(1 − TER))^φ; Monte Carlo g = exp(φ·m + √φ·s·z) × (1 − TER)^φ,
  z = the product's correlated class shock (t16: variance scales with time).
- `govt` with couponRate c (t12 S1): coupon = c × φ × value at step start, taxed 12.5% when paid, net
  coupon added to value and basis; price return uses μ − c. Coupons are never offset by credits or the
  zainetto. c = 0 gives the plain rule.
- `cash`: g = 1 + (g − 1)(1 − 26%) when g > 1. `pension`: g = 1 + (g − 1)(1 − 20%).
- Value × g. Stamp duty (not pension): b = bollo × φ × value; value −= b; basis = max(0, basis − b),
  so stamp duty never reduces the taxable gain.
- Contribution at step end, × weight, added to value and basis. Stub: r × monthly in force (pension:
  schedule of Y0 × f). Full year k (k = 1 for Y0+1): 12 × monthly × (1 + contributionGrowth)^(k−1);
  pension goal: that year's TFR + worker + employer + voluntary. Contributions run through targetYear
  and stop after it, in every function (projection, cash flow, plan vs actual, FI) (t12 M1, re-read
  for the 31 December date).
- Positions with no weight row stay in the projection (mock behaviour, t12).

**Liquidation at the goal date.** Per product gain = value − basis, counted in tax euros (gives the
48.08% rule for govt bonds). ETF gains taxed, ETF losses become credits. Direct/govt gains are summed
and reduced by credits from losses in the same bucket plus the assigned zainetto (amount × 26%) if
it expires on or after the goal date. Pension exit tax = rate × basis, basis = Σ contributions − Σ
non-deducted (AC-95), rate = max(9%, 15% − 0.3% ×
max(0, targetYear − firstYear − 15)), per goal from that goal's year (t12 E8). Net = gross − taxes.
Monte Carlo liquidation applies credits and the zainetto too (t12 E4/E5).

**Target.** Target at goal date = target × (1 + inflation)^τ (t16: real elapsed time). Success =
net ≥ target at goal date.

**Monte Carlo (t12 E4/E5).** P paths (1,000; 300 for snapshots and optimizer). One correlated
6-class normal vector per path and step (Cholesky; if not positive definite, shrink off-diagonals by
10% until it is, and flag it). One shock array shared by all buckets. Outputs per goal: P(success),
P10/P50/P90 of net value per step, average shortfall.

**Required contribution (t12 E3).** Bisection on the monthly amount (pension: a multiplier of the
schedule), common random numbers, until deterministic net ≥ target, or MC P ≥ required. `null` (not
reachable) after 12 doublings. When no contribution step remains (r = 0 and targetYear = Y0, or
τ = 0): 0 if already met, else `null`. A goal due this year with r > 0 is solved normally.

**Status.** On track if P ≥ required; At risk if within 15 points; else Off track. Required = goal
minProb or the priority default.

**Pension schedule (year t, t = 1 is Y0).** RAL(t) = RAL × (1 + g)^(t−1); TFR = RAL × 6.91%; worker
and employer = RAL × %; voluntary = given, or max(0, cap + extra − worker − employer) (TFR outside the
cap, t12 E6). Deductible = min(cap + extra, worker + employer + voluntary). Refund (cash inflow in
t + 1) = min(voluntary, room) × marginalRate, where room = max(0, cap + extra − worker − employer). For Y0 the voluntary amount is the actual voluntary
YTD (this year's `pensionContribution` transactions with flow `Voluntary`, AC-94) plus the stub schedule; its refund is paid in Y0+1.
When voluntary is blank ("to cap"), the Y0 stub voluntary is the rest of the room, max(0, room − voluntary YTD),
not room × f; a given voluntary keeps the stub voluntary × f (AC-97).
Non-deducted(t) = max(0, worker + employer + voluntary − (cap + extra)) (Y0: with the YTD + stub voluntary); it is
not deductible and is left out of the exit-tax basis in full, Y0 included (AC-95, AC-97). The schedule ends at the pension goal's
targetYear: the last refund is paid in targetYear + 1, none after (AC-96). Each year's TFR, worker, employer and voluntary flows are
split separately by each product's % of that flow (t12 S5, no frozen year-1 weights). The engine
values the whole pot net of exit tax; the Pension and Goal screens and the glossary state that usually
at most 50% can be taken as capital, the rest as an annuity, and that a phased payout exists from
31 Oct 2026 (t12 S4). Kept simplifications, written in the method notes: extra deduction every year and refund at the marginal rate only (S6), pension
return taxed 20% flat (S7), cash stamp duty 0.2% (deposit account).

**Cash flow (year t).** Capacity = income − 12 × (essential + optional) (each growing) + events +
pension refund of t − 1. The table is in nominal euros: income grows by
((1 + inflation) × (1 + incomeGrowth))^t and expenses by ((1 + inflation) × (1 + expenseGrowth))^t,
t = year − Y0, so both growth fields are growth above inflation (#156). Planned from savings = Σ goal contributions; the pension goal counts only
its voluntary part. In the stub year income, expenses and contributions are × f; events and the
refund are whole (t16). The first bar is labelled "rest of year".

**Financial independence (t07, today's €).** Level 1 Financial security = target of the `efFromGoal` goal, else
efMonths × essential. Level 2 Barista FIRE = baristaMult × essential monthly. Level 3 Lean FIRE = l2Mult × essential monthly. Level 4 Financial Freedom = Level 3 + l3Mult × optional
monthly. The setting names l2Mult and l3Mult stay as stored; they now drive Levels 3 and 4. Targets over time: target(t) = target(0) × (1 + expenseGrowth)^t, expenseGrowth being growth above inflation (0 = flat), t in
real years from asOf. FI wealth = Σ **net** value (liquidation rule; pension: value − exit-tax rate of
that year × basis) of buckets with countsTowardFI, pension only if includePension, deflated by
(1 + inflation)^t — today and projected (fixes mock bug M2). Level 1 uses FI wealth **without** the
pension bucket. Projection t = 0…40 on the time grid; after a goal's date its contributions stop and
the bucket keeps compounding. Outputs: median, P10/P90, deterministic line, first year the median
and the deterministic line reach each level, P(level reached) per year, target(t) per level and
median ÷ target(t) per level.

**Performance (monthly).** V(m) = Σ units × price(m); F(m) = Σ cash amounts of transactions in m
(opening included; coupons are outflows). TWR: r(m) = (V(m) − F(m)) / V(m−1) − 1, chained; a month
with V(m−1) = 0 contributes no return. Drawdown = index / running max − 1. XIRR on dated flows plus
final value, bisection in [−99%, 100%]. Scopes: all, all except pension, each bucket.
Market change in month m = V(m) − V(m−1) − F'(m), where F'(m) is the money put in during m; it is empty
with fewer than two months.

**Plan vs actual (t10).** Planned since trackingStart = Σ over months of the plan in force that month
(pension: schedule total / 12); contributionGrowth is never used here. Actual = Σ cash amounts of
non-opening `buy` and `pensionContribution` transactions dated from trackingStart on, per month
(earlier history counts for units and PMC only, t08). Compared cumulatively; the
monthly actual series is shown too. Next contribution: the non-pension bucket with the largest
negative gap (t12 E6); amount = gap, split by weights; recommend waiting if the amount is below the
min efficient ticket and the bucket holds commission-bearing products.

**Mix optimizer.** As the source spec: candidates = every mix of the chosen 1–6 products in 10% steps
(≤ 4 products) or 20% steps (5–6), dropping mixes over the per-product max (default none). Each mix
runs on the same shock array (300 paths; 200 for "spend least"). Per mix: P(success), median, P10,
P90, shortfall, deterministic value, and for "spend least" the monthly needed (bisection per mix).
Keep feasible mixes (P ≥ required), apply the criterion; if none is feasible, return the highest P
and say so.

| Criterion | Objective among feasible | Tie-break | Default for |
|---|---|---|---|
| O1 Protect the bad case | max P10 | higher P | Need |
| O2 Grow the typical outcome | max median | higher P | Want, Wish |
| O5 Spend least | min monthly needed | higher median | – |
| O4 Maximise the chance | max P, no feasibility filter | higher median | – |

The UI shows the rule names only ("Protect the bad case"); O1–O5 are internal ids in code, stored values and this spec (#155).

For O4 the "not feasible" flag is set when the best P is below the required probability. For O5,
feasibility is P ≥ required at the goal's current monthly amount; there is no maximum monthly amount
(ceiling). With no feasible mix O5 returns the highest-P mix with the "not feasible" flag, like the
other criteria. A tie left after the tie-break keeps the candidate order (the first product's weight
rising from 0).

Modes: new money only (default, no tax); rebalance now (holdings sold first, tax deducted, basis
reset; pension buckets excluded). "Use as contribution weights" writes AllocationWeights after
confirmation; pension weights change only through the pension flows. Per-product caps only; class
caps are v2 (t10). The UI states that the optimizer amplifies errors in μ and σ.

### Prices (t02, t05, t16)

- Per product one source: provider (Yahoo through `yahoo-finance2`, `.MI` ETFs only), CSV, or manual.
  BTP and pension funds are manual or CSV. One `PriceProvider` interface:
  `fetch(tickers, from, to) → [(ticker, date, close, currency)]`; one adapter in v1.
- Month-end close = last trading day of the month. A fetched price in a currency other than EUR, or
  a move above 25% versus the previous month, goes to a review list instead of being stored (R10).
- Best effort: cache, retry with backoff, never block a screen, never use `repair`-style rescaling.
- A manual price wins over a fetched one for the same month unless the user re-fetches explicitly.
- Fetching: on demand (button) and in the monthly job. The manual "run now" trigger runs at most once
  a day unless the last run failed. No launchd (t05).
- Price age per kind (t16): `provider` products are old when the latest close is more than 7 days
  before today; `manual`/`csv` products are old only when the previous month-end price is missing.
  Old prices are flagged and still counted in net worth (t11).
- CSV prices: long (date, ISIN or ticker or name, price) or wide (date + one column per ticker).
- The global valuation date (default: last month with prices) drives every screen.

### Import (t08, t09, t16)

One pipeline for transactions, prices, products and goals: parse (CSV or XLSX; delimiter, decimal
comma, dates YYYY-MM-DD, DD/MM/YYYY, YYYY-MM), map columns (auto-guess from headers, editable, saved
mappings reused), match products (ISIN, then ticker, then exact name; unknown products listed and
creatable from the row), assign buckets, validate, preview with row status, commit ready rows as one
ImportBatch, undo a batch as a whole. Products and goals import upsert by ISIN or name.

Preset "Fineco movimenti (XLSX)", sheet "Movimenti Dossier Titoli":

- Header row found by its column names (`Operazione` … `Commissioni amministrato`), not by row
  number; metadata and blank rows skipped.
- `Operazione` → date (text DD/MM/YYYY; `Data valuta` ignored). `Isin` → product (`Titolo` is a
  display hint only). `Segno` trimmed: `A` buy, `V` sell. `Quantita` → qty. `Prezzo` → price (BTP per
  100). `Commissioni amministrato` → commission.
- `Divisa` ≠ EUR or `Cambio` ≠ 1 → needs fix. `Controvalore` is a cross-check: mismatch with qty ×
  price (BTP /100) ± commission gives a warning, not a block.
- `Descrizione` = `Stacco Cedole` → coupon row; any other value than `Compravendita titoli` → needs fix.

Row statuses: ready; already in your records; already in the opening position; needs a goal; product
not found; needs fix.

- Bucket chain: bucket column; else the only bucket that holds the product or has it in its weights
  (ready); else "needs a goal", where the user picks one bucket, split by weights (integer units by
  largest remainder) or split by units (typed; ready only when the parts sum exactly to the broker
  qty). A split is never applied without confirmation. Each part is its own Transaction in the same
  batch; commission split in proportion to units. One shared split component serves import and the
  Current portfolio form (t16 finding 25).
- Duplicates: compare totals per (date, product, price): the rows of a key are "already in your
  records" when the file's total qty for that key equals the stored total qty for it, so split trades
  and confirmed identical rows re-import as 0 rows. This refines t08's per-row key (date, product,
  qty, price), which a split trade breaks; it comes from t16 finding 17, an engineering fix, not a
  user decision. Two identical rows in one file, not yet stored → needs fix.
- Rows with `Operazione` ≤ the opening asOf date → "already in the opening position", skipped.
- Coupons: recorded by default (t08, t11): qty 0, amount = net cash received (`Controvalore`), split
  across the buckets holding the bond on that date by units held, automatically, no user choice (t16
  finding 18). If no bucket holds the bond on that date, the row is "needs a goal". Not a contribution; no change to units or PMC; an outflow in TWR/XIRR.

Current portfolio form (t08): one asOf date (default trackingStart); per product total units and
account PMC (for a transferred portfolio, the fiscal cost basis Fineco shows), then units split
across buckets with the shared split component. Each part is an `opening` Transaction with price =
PMC. Pension funds use the same form.

### Rules: alerts and recommendations

Rules are data with parameters (thresholds in Settings), evaluated after each recalculation. Every
alert and suggestion shows its rule (id, name, condition). No recommendation exists without a rule.

| Rule | Severity | Condition | Dismissal key (t10) |
|---|---|---|---|
| R1 Behind plan | Medium | Non-pension bucket: cumulative gap < −(N months of plan) **and** < −min efficient ticket (t10) | goal + month |
| R2 Deduction room | Info | cap + extra − (worker + employer + voluntary YTD) > 0, current year | year |
| R3 Maturity ahead | Medium | Held product with maturity ≤ 36 months | product + maturity |
| R4 Status worsened | Medium | Goal status worse than in the latest snapshot | goal + new status |
| R5 Stale prices | Medium | Held product whose price is old by the per-kind rule (t16) | set of products |
| R6 Need off track | High | Priority Need and status Off track | goal + month |
| R7 Costly trades | Info | Last 12 months: commission / amount > 1.25 × rate; with `feeModel = flat`, rate = flatFee / minTicket (fires below minTicket / 1.25) | id of the latest costly trade |
| R8 Near goal, risky assets | Medium | Horizon ≤ 1 year and equity value > 0 | goal |
| R9 Units mismatch | High | Units per product across buckets ≠ brokerUnits (when entered) | product + (bucket units, broker units) |
| R10 Price fetch failed | Medium | Provider error, non-EUR currency or move > 25% | set of products |

A dismissed alert stays hidden while its key is unchanged. When the condition becomes false the
dismissal is cleared, so the alert returns the next time it is true.

### Snapshots and the monthly job (t10, t05)

On the first app start in a new month: fetch month-end prices, then save the snapshot of the previous
month (`saved`). Missing older months are caught up from month-end prices with the current
assumptions and labelled `recomputed`. If any price fetch fails, no snapshot is saved and the run counts
as failed. "Save snapshot" saves one by hand. Saved snapshots never
change; recomputed ones are labelled wherever they show (trend chart, Goal history).

### UI (t11, t13, t16)

- Approved direction: `prototypes/11-ui/` and its `NOTES.md`; briefs may cite `prototypes/16-app/`
  as a UI reference. No prototype code is carried into the build.
- English UI, Italian glossary; EUR and numbers in it-IT format. Light and dark themes. Desktop-first
  fluid layout, usable from ~1024 to 1920 px (mobile from 360 px is v2).
- Sidebar: Overview; Goals (List, History; a goal's page opens from a goal chip, with no sidebar item of its own); Independence; Analysis (Optimizer, Performance,
  Plan vs actual); Pension; Operations (Transactions, Import, Prices); Setup (Products, Allocation,
  Cash flow, Assumptions, Glossary). Unbuilt items show a "soon" placeholder.
- Colour: palette D (`reference/palette-substack-d.md`) with the OE Data Viz exhibit rules
  (`reference/oe-dataviz-README.md`, type scale one step up: body 16, tables 15, labels 13, axis 12).
  One fixed slot colour per goal in every chart (pension goal slot 1, emergency-fund goal slot 6,
  others from slot 2 in order; colours repeat past six goals — to revisit in S7); soft tints (light
  12%, dark 18%) for chips, tags, KPI accents and card header strips; text stays in the text greys;
  blue for general/information; the highlight family for attention. No red/green status.
- Components: goal chips, Need/Want/Wish tags (shape + tint), status chips (icon + word), product
  tags, price-freshness pills, KPI cards with a 1 px outline (a goal-colour dot before the label where the KPI belongs to a goal), section cards with a blue header strip and no outline. Sticky
  header on every table. A compact legend on every multi-series chart; direct labels where they help;
  exhibit anatomy (tag, action title with a number, unit line, chart, callout, source).
- Page titles: the `h1` of every screen is the name of the screen (on a goal's page, the goal's name).
  A finding with a number is never the `h1`: it is the action title (`h2`) of the first exhibit, or
  of the key numbers where a screen opens with them.
- Fonts: Source Serif 4 for titles and KPI values (`--font-display`), Geist for text, Geist Mono for the small mono labels, all bundled (OFL). The kicker above a title is Geist 13 px, sentence case. Charts are drawn after fonts load and resize with their box.
- Jargon terms are popover buttons that open on click, tap, Enter or Space, never on focus (plain
  sentence first, Italian term above it); touch friendly, no `title=`
  hints (t16 finding 26). Raw "P10–P90" is never shown: bad / typical / good case.
- First run: the empty Overview is a checklist (products, goals, current portfolio) plus "Load the
  sample data".

Screens (content; acceptance in the Definition of done):

| Screen | Content |
|---|---|
| Overview | Key numbers, under an action title from the data (the `h2` of the key numbers; the `h1` is "Overview") (net worth, market change this month, YTD TWR, FI wealth, goals on track); grid: P(success) per goal vs required, net worth by goal over time with money put in, needs attention (alerts), P(success) trend from snapshots, range of outcomes vs target, 10-year savings capacity vs plan, goals, % of FI target per year, price freshness; per FI level today's % reached and year reached (median, det.) (t07). Every number links to the screen that explains it |
| Goals list | One row per goal; its goal chip opens the goal's page: name + priority, status, P vs required, value vs target, plan gap (t11 replaces the 9-column table) |
| Goal detail | A back link to the Goals list and a goal switch at the top (no sidebar item; `#/goals/detail` with no goal opens the Goals list). Value, P vs required, XIRR, fan, P history, range chart, "what it would take" (needed det./prob., horizon), holdings (units, price + age, PMC, gain, tax if sold), value vs money put in, cumulative plan vs actual, change the monthly plan from month X, 50% capital note on the pension goal |
| Goal history | Metric switch (P, funded ratio, median/target); a line per goal over snapshots; snapshot table; Save snapshot; delete saved snapshots |
| Independence | One tile per level (1 Financial security, 2 Barista FIRE, 3 Lean FIRE, 4 Financial Freedom): the year the typical case reaches it, the deterministic year, P(reached in 20 y) and the target; one chart: projected wealth (typical case, bad to good band) against each level's target line over time; "what counts" per goal; editable expense split; multipliers, efMonths, Level 1 source and the include-pension switch under "Level rules". No % reached, no progress ladder, no deterministic line in the chart (#128) |
| Optimizer | Bucket, mode, criterion (4 named options), max per product, product universe; "How the optimizer chooses" panel; suggested vs current weights; outcomes compared (with a signed Change column); short mix labels (full names in a tooltip); a small-gain note next to "Use as contribution weights"; switch tax; scatter of all mixes (x = P, y = median; one mix: a sentence instead); top 10; rule text; "Use as contribution weights"; known-limit note |
| Performance | Scope selector; value, gain, TWR since start/YTD/12m, XIRR, max drawdown; charts: value vs money put in, growth of €100, drawdown, monthly returns; table for all scopes |
| Plan vs actual | Planned vs put in since trackingStart; monthly actual series; next contribution card with product split, commission and cost %; cumulative planned vs actual per goal |
| Pension | This year: cap, used, still available (never below 0; when used > cap + extra, a line "€X of this year's payments are not tax-deductible"), refund, exit tax; inputs; flows table; 10-year schedule and chart; capital/annuity note |
| Transactions | Add form (date, bucket, product, type, amount, price prefilled from the product's last price, commission optional) with commission estimate and cost warning; list with filters by bucket and year; the list's amount shows the cash movement (Buy and pension contribution `-`, Sell and Coupon `+`, Opening no sign; the stored amount and the cash amount sign above do not change); edit (the add form prefilled); delete |
| Import | Tabs: transactions, prices, products, goals; paste or upload CSV/XLSX; mapping with saved mappings; row check with status and the bucket/split control; import ready rows; past imports with undo; Current portfolio form |
| Prices | Source per product with last price, date, age pill; Fetch latest prices; review list; month-end grid (6 months, current month editable; add next month); positions by product with account PMC, buckets and broker units entry |
| Setup | Products, Allocation (pension weights read-only), Goal definitions (add and edit goals, with plan history; the analysis lives under Goals), Cash flow (+ 10-year table), Assumptions (tax, probabilities, MC, trackingStart, commission, thresholds, correlations, reset), Glossary (the Glossary & method page, also reached from the sidebar) |
| Glossary & method | Italian term, English term, plain explanation; method notes |

Glossary terms (wording written by the user later; initial text from `prototypes/11-ui/content.js`):
probability of success, required probability, simulated markets, bad/typical/good case, future vs
today's euros, time-weighted and money-weighted return, drawdown, average cost (PMC), tax-loss
carry-forward (zainetto), FIRE, Barista FIRE and Lean FIRE, opening position, Need/Want/Wish, ISIN, coupon, old
price, minimum efficient ticket, stamp duty (bollo), exit tax, white-list share. Method notes cover:
time grid and 31 December due date, taxes by regime, Monte Carlo, required contribution, FI levels,
performance formulas, optimizer rules, the kept simplifications (S6, S7, cash stamp duty) and the
pension capital/annuity note.

### Delivery (t13, t16)

Eight stories (ticket 13's S0–S6 plus S7 from ticket 16), one GitHub parent issue each, run in order; story k+1 starts after story k's PR is
merged into `main`. Every story after S0 ends with usable screens and one `ready-for-human` UI gate
(agent checks with `agent-browser`, user approves). Every trail passes `pnpm gate` (Biome,
`tsc --noEmit` strict, Vitest incl. golden cases + mock differential + fixture snapshot,
`pnpm build`, `pnpm audit`); CI runs it on every PR to `main` from S0 on. `Codex review: yes` on
S1, S3, S4, S6. The AC list below is the Definition of done of each story; ticket 15 may move one AC
to the next story if a story does not fit, keeping its id.

| Story | Title |
|---|---|
| S0 | Wipe and scaffold |
| S1 | Goals and deterministic projection |
| S2 | Import, prices and data safety |
| S3 | Pension and cash flow |
| S4 | Monte Carlo, required contributions and FI |
| S5 | Tracking and Dashboard |
| S6 | Optimizer and polish |
| S7 | UI/UX polish (t16) |

## Testing Decisions

- Test external behaviour at the highest seam: the engine's public functions (inputs → outputs) and
  the REST API (request → response + DB state). No tests of private helpers. UI is checked by
  `agent-browser` and the user, not by Playwright (t06).
- **No Excel parity test** (t12): the workbook has no cached values and v1 departs from it on purpose.
  The workbook is a formula reading aid only, never recalculated, committed or imported.
- **Golden cases** with numbers written in the test, hand-checked: the source spec tax cases, one
  case per rule change (stub year, coupon, commission in basis, yearly pension mix, goal-year cut-off),
  the FI cases (t07), plus performance, holdings and pension cases.
- **Differential test vs the mock engine**: the mock's engine copied unchanged into the test tree,
  fast-check inputs restricted to where v1 and the mock must agree: asOf in December (r = 0),
  commissions 0, couponRate 0, contributionGrowth 0, ralGrowth 0, pension with one flow. Compared
  functions: goal projection (deterministic net per goal), cash flow from year Y0+2 (avoids the
  first-year refund timing), plan vs actual on ledgers with buys only (no sells, coupons or plan
  versions). Listed expected differences outside that domain: M2, E9, S1, S2, S5, growth exponents of
  the first full year, and plan versions.
  The mock's cash flow growth is nominal: the harness maps mock growth = (1 + inflation)(1 + g) − 1
  for incomeGrowth and expenseGrowth, so the rows still compare (#156).
- **Synthetic fixture** (one JSON in `fixtures/`; extended and its snapshot re-reviewed in S3 for
  pension and in S4 for Monte Carlo): 7 made-up products (ETF WL 0, ETF
  WL 50%, direct, govt with couponRate, deposit, two pension funds), 4 made-up goals (one with τ < 1,
  one with the zainetto, one holding a product at a loss, retirement), a ledger with opening + buy +
  sell + buy, round pension inputs, a cash flow with expenses (income, essential and optional
  expenses, a few events), pinned asOf. Its outputs are a reviewed regression snapshot. The
  same data is the app's "Load the sample data". No real names, ISINs or amounts; no xlsx.
- **Property tests** (fast-check): net non-decreasing in the monthly contribution; the required
  contribution reaches the target; weights always sum to 1.
- **Fineco reader**: committed synthetic XLSX files with the real shape (t09), plus a local test on
  `real/fineco-movimenti-sample.xlsx` that is skipped when the file is absent (never committed).
- Prior art: the throwaway `prototypes/16-app/` tests (18 golden + import tests) show the shape;
  the code is not reused.

## Definition of done

Each AC names a check and its expected result. Ids are global; headings are the stories.

### S0 — Wipe and scaffold

- AC-1: The legacy tag exists before the wipe. Check: `git ls-remote --tags origin finance-os-legacy`. Expected: one line pointing to `fb215e5…` (annotated tag peeled).
- AC-2: The old app is gone. Check: `git ls-files src/financeos tests pyproject.toml uv.lock docs PRODUCT.md .impeccable demo real`. Expected: no output; `git ls-files .scratch/gbi-v1/spec.md` still lists the spec.
- AC-3: `.gitignore` blocks personal data. Check: `git check-ignore -q x.sqlite x.db x.xlsx x.csv` and `git check-ignore fixtures/a.xlsx`. Expected: the first exits 0; the second exits 1.
- AC-4: The new `CLAUDE.md` is in place. Check: read it against the "New CLAUDE.md" decision above. Expected: 60–80 lines, the listed sections, the pnpm pin and Node type-stripping rules.
- AC-5: Supply-chain guards are set. Check: `package.json`, `pnpm-workspace.yaml`, `pnpm config get minimum-release-age`; `grep -E '"(plotly|better-sqlite3|xlsx)' package.json`. Expected: `packageManager` is `pnpm@10.32.1`, every version exact, lockfile committed, `minimumReleaseAge` 10080, `onlyBuiltDependencies: []`; grep prints nothing.
- AC-6: The gate runs. Check: `pnpm gate`. Expected: runs Biome, `tsc --noEmit`, Vitest, `pnpm build`, `pnpm audit`; exit 0.
- AC-7: Architecture rules 1–3 are enforced. Check: the architecture test (or Biome rule) with a planted violation in a scratch file: `engine/` importing `node:*`/`server/`/`web/`; `web/` importing `server/`; SQL outside `server/`. Expected: green on the clean tree, red on each planted violation.
- AC-8: CI runs the gate. Check: `.github/workflows/gate.yml` and the S0 PR checks. Expected: the workflow runs `pnpm gate` on PRs to `main`; the S0 PR shows it green.
- AC-9: `gbi` starts the app locally. Check: install as documented in `README.md`, then `GBI_DATA_DIR=$(mktemp -d) gbi`, `curl -s 127.0.0.1:<port>/api/health`, `lsof -iTCP -sTCP:LISTEN -P | grep node`. Expected: health returns 200; the listener is bound to 127.0.0.1 only; the SQLite file exists in that folder with all migrations applied; the browser opens.
- AC-10: Empty app shell. Check: `agent-browser` on the running app at 1440 px, light and dark. Expected: sidebar with the seven sections, "soon" placeholders, palette D tokens, Geist text font and Source Serif 4 titles; zero console errors; no network request to a host other than 127.0.0.1.
- AC-11: `DESIGN.md` exists. Check: read it. Expected: palette D tokens (light/dark, slots, tints), type scale, components and chart rules from the UI decisions above.

### S1 — Goals and deterministic projection

- AC-12: Holdings and PMC. Check: engine test, ledger buy 10 @ 100 (commission 2.95), buy 10 @ 120, sell 5, buy 5 @ 90, split over two buckets. Expected: PMC after each step equals the hand values written in the test (commission included); the sell leaves PMC unchanged; units per bucket sum to account units.
- AC-13: Golden tax cases. Check: engine tests for one ETF gain; one ETF loss + one govt gain (credit applied at 12.5/26); a zainetto expiring before the goal date (no credit) and after it (credit); a deposit account; a pension fund at 10, 15, 20, 35 years of membership. Expected: hand-checked nets; exit rates 15%, 15%, 13.5%, 9%.
- AC-14: Stub year and 31 December due date. Check: engine test, asOf 2026-10-31, goal 2028, monthly 100, one ETF with μ = 0, TER 0, bollo 0, start value 0. Expected: gross at goal = 2,600 (stub 200 + 1,200 + 1,200). Supersedes ticket 12's 1,400.
- AC-15: BTP coupon. Check: engine test, govt product value 10,000, μ = 4%, couponRate 4%, bollo 0, one full year. Expected: value 10,350 and basis 10,350.
- AC-16: Commission in basis and stamp duty. Check: engine tests. Expected: a buy of 1,000 with commission 2.95 has basis 1,002.95; stamp duty lowers value and basis but never raises the taxable gain.
- AC-17: Target over real time. Check: engine test, asOf 2026-10-31, goal 2028, target 10,000, inflation 2%. Expected: target at goal date = 10,000 × 1.02^(2 + 2/12) ≈ 10,438.39.
- AC-18: Mock differential. Check: Vitest differential test with fast-check on the agreed domain. Expected: deterministic outputs equal the mock's within €0.01.
- AC-19: Synthetic fixture. Check: fixture regression snapshot test; `git grep -nE 'IT[0-9]{10}|gbi-planner-v2' -- '*.json'`. Expected: snapshot matches; grep prints nothing.
- AC-20: Property tests. Check: fast-check suite. Expected: net is non-decreasing in the monthly contribution; normalised weights sum to 1.
- AC-21: Schema and migrations. Check: API test on a fresh data folder, start twice. Expected: all tables `STRICT`; money columns integer cents; second start applies no migration.
- AC-22: Transactions via API. Check: API tests. Expected: qty = amount / price (BTP: amount / (price/100)); sells stored as negative qty; editing or deleting a transaction re-derives holdings in the next read.
- AC-23: Setup (Products, Allocation, Goals with plan history, Assumptions incl. Commission plan and fee model). Check: API tests + `agent-browser`. Expected: create/edit/delete work; weights are rescaled to 100% per goal; the correlation matrix stays symmetric; a non-positive-definite matrix is shrunk and flagged.
- AC-24: Transactions screen. Check: `agent-browser`. Expected: add form with price prefilled from the product's last price, commission estimate and a cost warning below the min efficient ticket; list filters by bucket and year; edit; delete.
- AC-25: Goals list and detail (deterministic). Check: `agent-browser` on the sample data. Expected: the sidebar has Goals > List and History, no Detail; a goal chip opens the goal's page, which has a back link and a goal switch; list rows show name + priority and value vs target (status, P and plan gap arrive in S4 and S5); detail shows value, deterministic net, target at goal date, holdings (units, price, PMC, gain, tax if sold), value vs money put in.
- AC-26: Sample data. Check: "Load the sample data" on an empty data folder. Expected: the synthetic fixture is loaded and the Goals list shows its 4 goals, and Setup > Goal definitions lists the same 4.
- AC-27: S1 UI gate. Check: screenshots of S1 screens at 1440 px, light. Expected: the user approves or skips; adding one transaction takes under 20 seconds.

### S2 — Import, prices and data safety

- AC-28: Fineco reader. Check: test on the committed synthetic Fineco XLSX (same shape as t09: 5 metadata rows, header row 6, blank row 7, 7 data rows); local test on `real/fineco-movimenti-sample.xlsx` when present. Expected: 7 rows: 6 trades (5 A, 1 V) and 1 coupon; no row lost to the metadata block; dates parsed from text DD/MM/YYYY.
- AC-29: Row statuses. Check: import tests with one row per case. Expected: ready; already in your records; already in the opening position (date ≤ opening asOf); needs a goal; product not found; needs fix for non-EUR, `Cambio` ≠ 1, unknown `Descrizione`, unreadable date, missing qty/price, duplicate inside the file; a `Controvalore` mismatch gives a warning only.
- AC-30: Bucket chain and splits. Check: import tests. Expected: the chain assigns the only holding/weighted bucket automatically; split by weights gives integer units by largest remainder; split by units is ready only when parts sum to the broker qty; commission split by units; nothing is committed without confirmation.
- AC-31: Re-import adds nothing. Check: import the synthetic file (with one split trade) twice. Expected: second import adds 0 rows.
- AC-32: Undo. Check: dump all tables except ImportBatch, import a transactions batch and a prices batch (overwriting one price), undo both, dump again. Expected: dumps are equal; both ImportBatch rows have `undoneAt` set.
- AC-33: Coupons. Check: import test, bond held in two buckets on the coupon date. Expected: two `coupon` transactions split by units held, amounts summing to the net cash, qty 0; units and PMC unchanged; not counted as contribution.
- AC-34: Generic CSV/XLSX path. Check: import tests with `;` and decimal comma, the three date formats, a saved mapping. Expected: auto-guessed mapping is editable; the saved mapping is offered and applied on the next import.
- AC-35: Products and goals import. Check: import a products CSV and a goals CSV twice. Expected: upsert by ISIN or name; second run changes nothing.
- AC-36: Current portfolio form. Check: API test + `agent-browser`. Expected: per product units + PMC split across buckets with the shared split component; writes `opening` transactions with price = PMC; never counted as contributions.
- AC-37: Manual and CSV prices. Check: API tests + `agent-browser`. Expected: month-end grid shows 6 months, current month editable, "add next month" works; long and wide CSV both import; each PricePoint stores its source; a manual price is not overwritten by a later fetch unless re-fetched explicitly.
- AC-38: Yahoo adapter. Check: tests with a stubbed provider returning a good price, a USD price, a +30% move, and an error. Expected: only the good price is stored; the other two land in the review list; the error does not block the Prices screen; R10's condition is true. Manual check: `.MI` ETF fetch returns EUR prices.
- AC-39: Price age per kind. Check: engine/API tests. Expected: a provider product with a close 8 days before today is old, 7 days is not; a manual product is old only when the previous month-end price is missing; old prices are flagged and still in net worth.
- AC-40: JSON export/import. Check: export, restore into an empty data folder, export again. Expected: the two exports are equal.
- AC-41: Backups and data folder. Check: start the app twice on one day and once the next day with 30 backups present; set `GBI_DATA_DIR` under `~/Library/Mobile Documents/`. Expected: one new backup per day, 30 kept; a cloud-sync warning is shown.
- AC-42: First run. Check: `agent-browser` on an empty data folder. Expected: Overview shows the checklist (products, goals, current portfolio) and "Load the sample data"; the third step is locked until a product and a goal exist.
- AC-43: Import speed. Check: test with a synthetic 200-row Fineco XLSX. Expected: parse + preview in under 2 s.
- AC-44: S2 UI gate. Check: screenshots of Import, Prices and the Current portfolio form. Expected: the user approves or skips; month-end prices for 15 products update in under 2 minutes by CSV paste.

### S3 — Pension and cash flow

- AC-45: Pension schedule. Check: golden test with round inputs (RAL, growth, TFR 6.91%, worker/employer %, voluntary blank, cap 5,300, extra 2,650). Expected: per-year TFR, worker, employer, voluntary to cap (TFR outside it), deductible and refund paid in t + 1 equal the hand values.
- AC-46: Yearly flow mix. Check: golden test with two pension products whose shares differ per flow and a worker % that changes the flow mix over years. Expected: each year's product contributions follow that year's flows, not year-1 weights.
- AC-47: Exit tax per goal year. Check: engine test with two goals in different years. Expected: each uses its own rate.
- AC-48: Cash flow. Check: golden test, asOf 2026-10-31. Expected: the 2026 row has income, expenses and contributions × 2/12 and events and refund whole; the pension goal counts only its voluntary part; a goal's contributions appear through its target year and not after.
- AC-49: Pension screen. Check: `agent-browser` + API test. Expected: cap, used, still available, refund, exit tax for this year; voluntary YTD equals the sum of this year's `pensionContribution` transactions with flow `Voluntary` (AC-94); flows table; 10-year schedule and chart; the 50% capital note.
- AC-50: Setup Cash flow. Check: `agent-browser`. Expected: inputs and events editable; the 10-year table matches the engine's cash flow.
- AC-94: Contribution flow. Check: migration + API test with one pension fund that takes both Work and Voluntary flows, a Work and a Voluntary contribution this year. Expected: voluntary YTD (Pension screen, cash flow refund, R2) counts only the Voluntary one; a contribution on a one-flow product gets that flow by default; on a two-flow product the API refuses a missing flow; existing rows are backfilled where the product has one flow; a row with no flow counts as Work.
- AC-95: Non-deducted part. Check: golden engine test where worker + employer + voluntary exceed cap + extra by €500 in one year. Expected: that year's non-deducted = 500; the exit-tax basis is lower by 500 (plus nothing else); the Pension screen shows "€500 of this year's payments are not tax-deductible" and still available 0.
- AC-96: Refund ends with the goal. Check: cash-flow golden test with the pension goal due inside the 10 years. Expected: refund in targetYear + 1 is the last; later rows show refund 0.
- AC-97: Current year to cap. Check: engine and API tests with voluntary blank, worker + employer 800, limit 7,950, asOf 2026-10-31. Expected: voluntary YTD 7,650 → stub voluntary 0, non-deducted 500, the Pension screen says 500 is not deductible and the exit-tax basis is lower by exactly 500; voluntary YTD 7,000 → stub voluntary 150, non-deducted 0, no line, basis unchanged.
- AC-51: S3 UI gate. Check: screenshots of Pension and Setup Cash flow. Expected: the user approves or skips.

### S4 — Monte Carlo, required contributions and FI

- AC-52: Seeded MC. Check: engine test. Expected: same seed → identical outputs; another seed → different outputs.
- AC-53: Volatility 0. Check: engine test with σ = 0 for all products. Expected: MC median equals the deterministic net.
- AC-54: MC accuracy. Check: fixture goal, 1,000 paths vs a 20,000-path reference. Expected: P(success) within ±2 pp.
- AC-55: Stub shock scaling. Check: engine test, f = 2/12, many paths. Expected: the sample variance of stub log-returns is f·s² within sampling error.
- AC-56: Cholesky fallback. Check: engine test with a non-positive-definite matrix. Expected: off-diagonals shrunk in 10% steps until it factorises; a flag is returned.
- AC-57: Required contribution. Check: engine + property tests. Expected: the returned amount reaches the target (det.) or the required P (MC); `null` after 12 doublings; no contribution step left (r = 0 and targetYear = Y0, or τ = 0) → 0 if met, else `null`; a goal due this year with r > 0 is solved normally.
- AC-58: Status. Check: engine test. Expected: P ≥ required → On track; within 15 points → At risk; else Off track; minProb overrides the priority default.
- AC-59: FI levels. Check: engine tests (t07). Expected: essential 1,000, optional 500, expenseGrowth = 0 → Barista FIRE (L2) = 200,000, Lean FIRE (L3) = 300,000, Financial Freedom (L4) = 400,000 flat in all years; expenseGrowth 3% → L3(10) = 300,000 × 1.03^10 ≈ 403,000, whatever the inflation.
- AC-60: FI wealth. Check: engine tests. Expected: net of liquidation tax today and projected; includePension defaults to true; Level 1 progress excludes the pension bucket; unticking a goal's countsTowardFI removes it.
- AC-61: Goals with MC. Check: `agent-browser` on the sample data. Expected: list shows status and P vs required; detail shows fan, P vs required, range chart and "what it would take" (det./prob., "not reachable" when `null`); no raw "P10–P90" label.
- AC-62: Independence screen. Check: `agent-browser`. Expected: one tile per level (typical year, deterministic year, P(reached in 20 y), target), one chart of wealth against the level lines, "what counts" ticks, include-pension switch; no progress ladder; changing a multiplier updates levels without a page reload.
- AC-63: Engine speed. Check: timing test, 6 goals × 1,000 paths × 40 years. Expected: full analysis under 1 s.
- AC-64: S4 UI gate. Check: screenshots of Goals and Independence. Expected: the user approves or skips.

### S5 — Tracking and Dashboard

- AC-65: TWR and XIRR. Check: golden 12-month fixture with hand-checked values (incl. one coupon). Expected: within 0.01 pp; a month with zero prior value gives no division by zero.
- AC-66: Drawdown and scopes. Check: engine test. Expected: drawdown = index / running max − 1; scopes all, all except pension, each bucket.
- AC-67: Plan history. Check: engine test, plan changed from 500 to 700 from month 4. Expected: planned = Σ plan in force per month; contributionGrowth not used.
- AC-68: Flexible months. Check: engine test, plan 500/month, actual 0 then 1,000. Expected: cumulative gap 0 after month 2; no R1.
- AC-69: R1 threshold. Check: engine test, gap = 3 months of plan + €1 and above the min ticket; and a gap of 3 months − €1. Expected: R1 fires on the first, not the second.
- AC-70: Openings and coupons. Check: engine test. Expected: opening transactions and coupons are never counted as contributions.
- AC-71: Next contribution. Check: engine test. Expected: picks the non-pension bucket with the largest negative gap; split by weights; "wait" when below the min ticket with commission-bearing products; never the pension goal.
- AC-72: Rules R1–R10. Check: one engine test per rule (true and false case). Expected: each fires only on its condition; each alert carries rule id, name and condition.
- AC-73: Dismissals. Check: API tests per key type. Expected: a dismissed alert stays hidden while its key is unchanged, returns when the key changes, and the dismissal is cleared when the condition becomes false.
- AC-74: Snapshots. Check: API test with `GBI_AS_OF` moved forward 3 months, then an assumption changed. Expected: previous month `saved`, older gaps `recomputed`; saved snapshots unchanged after the assumption change; manual save and delete of saved snapshots work.
- AC-75: Monthly job. Check: API test with a stubbed provider. Expected: on the first start in a new month prices are fetched before the snapshot; the manual trigger runs at most once a day unless the last run failed.
- AC-76: Performance, Goal history, Plan vs actual screens. Check: `agent-browser` on the sample data. Expected: contents as in the screens table; recomputed snapshots are labelled.
- AC-77: Overview. Check: `agent-browser` on a fixture with 5 years of monthly data. Expected: all cells of the screens table render; every number links to its explaining screen; page ready in under 2 s.
- AC-78: S5 UI gate. Check: screenshots of Overview, Performance, Goal history, Plan vs actual. Expected: the user approves or skips.

### S6 — Optimizer and polish

- AC-79: Candidates. Check: engine test. Expected: 4 products at 10% → 286 mixes; 6 products at 20% → 252; a 40% cap drops every mix with a weight above 40%.
- AC-80: Choice. Check: engine test on a two-product fixture against a brute-force check, for O1, O2, O4, O5. Expected: same mix, tie-breaks as in the table; with no feasible mix, the highest-P mix is returned with the "not feasible" flag.
- AC-81: Rebalance. Check: engine test. Expected: the expected tax is deducted and basis reset; pension buckets are refused.
- AC-82: Apply weights. Check: API test. Expected: AllocationWeights change only after the confirm call; for the pension goal only the flows change.
- AC-83: Optimizer speed. Check: timing test, largest candidate set the rules allow (286 mixes) × 300 paths; "spend least" with 3 products. Expected: under 3 s and under 10 s.
- AC-84: Optimizer screen. Check: `agent-browser`. Expected: contents as in the screens table; the rule that chose the mix is shown; the known-limit note is next to the result.
- AC-85: Glossary & method. Check: `agent-browser`. Expected: every listed term has Italian term, English term and explanation; every jargon term in the UI opens its popover by click, tap, Enter or Space; method notes cover the listed topics.
- AC-86: Dark mode. Check: `agent-browser` on every built screen in dark. Expected: no hard-coded colours, readable charts, zero console errors.
- AC-87: Width. Check: `agent-browser` at 1024, 1440 and 1920 px on every screen. Expected: no horizontal overflow; every chart fills its box.
- AC-88: S6 UI gate. Check: screenshots of Optimizer, Glossary, and dark mode. Expected: the user approves or skips.

### S7 — UI/UX polish

- AC-89: Audit first. Check: the S7 parent issue. Expected: an impeccable audit of the built app (both themes, 1024–1920 px) is attached before any fix; each finding becomes a sub-issue or is marked "won't fix" with the user's OK.
- AC-90: Known gaps fixed. Check: `agent-browser`. Expected: the range-of-outcomes chart spans two columns at 1280 px with no label collisions (t16 #23); the P(success) trend explains the drop near a goal's date (t16 #24); every gap uses a `DESIGN.md` spacing token (t11 spacing rhythm).
- AC-91: Contrast. Check: contrast measurement of text and chart marks on every screen, both themes. Expected: body text ≥ 4.5:1; every series below 3:1 has a direct label or legend entry.
- AC-92: Open colour questions settled. Check: `DESIGN.md`. Expected: records the user's choice on the highlight vs pension goal colour and on goals beyond six (t11 open questions 1 and 4).
- AC-93: S7 UI gate. Check: screenshots of every screen, both themes. Expected: the user approves.

## Out of Scope

Source-spec non-goals: multi-user, several broker accounts, automatic trading, tax filing,
decumulation plans, glide paths, regime dichiarativo, currencies other than EUR. Building this as a
module of the old Finance OS. Playwright (t06). Excel parity (t12). Docker image (a `GBI_DATA_DIR`
volume is enough). Optional daily price fetch (replaced by the monthly job and the manual trigger,
t05).

### v2 candidates

Published by ticket 15 as one issue "GBI v2 backlog".

- Second price provider, e.g. EODHD (t02).
- Class-level optimizer caps, e.g. Gold ≤ 20% (t10).
- Goal month: a due date other than 31 December (t12, t16).
- Per-year pension deduction cap (t12).
- BTP maturity before the goal year: model and flag it (t12).
- 365-day membership years (t12 S3). The exit-tax base already leaves out the non-deducted part (AC-95).
- Extra-deduction window and regional/municipal surcharges in the refund (t12 S6).
- 12.5% on the govt-bond share of pension funds (t12 S7).
- Flat €34.20 stamp duty for current accounts (t12).
- Pension payout: 50% capital, annuity, phased payout (t12 S4).
- One-off Excel v2 importer (t13).
- Mobile layout from 360 px (t13).
- Bond-specific commission minimum (€2.95 on Fineco's list, else €5.95) (t03).

## Further Notes

### Source spec open questions

| Question | Answer |
|---|---|
| FI multipliers on monthly expenses; Level 1 from EF goal or months | Monthly, 300× and 200×; Level 1 = EF goal target or efMonths × essential (t07); Barista FIRE 200× essential added as Level 2 (user, 2026-11-07) |
| FI: do pension funds count, from which age | Count by default, no age logic; excluded from Level 1 (t07) |
| Stack | TypeScript end to end, local Node server + React, SQLite (t05) |
| Finance OS module or standalone | Standalone restart in the same repo (map, t06) |
| yfinance acceptable, second provider | Yahoo via `yahoo-finance2`, best effort, ETFs only; no second provider in v1 (t02, t05) |
| Which broker export first | Fineco movimenti XLSX preset (t08, t09) |
| Split one trade across buckets | User always confirms: one bucket, by weights, or by units (t08) |
| Class-level optimizer caps | v2; per-product caps only (t10) |
| Snapshot cadence | Monthly automatic (catch-up) plus manual (t10) |
| Fineco minimum and zero-commission list | €2.95 min / €19 max on the Trading plan; fee model per plan; zero commission is a per-product flag (t03) |
| Version plan changes | Yes, per goal from a month; plan vs actual cumulative (t10) |

### Changes against the source spec, in one place

Excel parity dropped; 31 December due date and pro-rata stub year with √ shock scaling and real-time
inflation; BTP `couponRate`; commissions in basis; yearly pension flow mix; FI wealth net, pension
included by default, Level 1 without pension, targets follow expenseGrowth; versioned plan with
cumulative plan vs actual and R1 after N months; `coupon` transaction type; Current portfolio form;
per-kind price age; dismissal keys; Goals list replaces the 9-column table; Excel v2 importer and
360 px layout to v2; dark mode in v1; Playwright dropped; optimizer speed budget restated as 286
mixes (the source spec's 462 is above the largest set its own step rules allow).

### Performance budgets

Kept from the source spec (t16 measured 5–10× margin on one thread): engine < 1 s (AC-63),
Overview < 2 s (AC-77), optimizer < 3 s and "spend least" < 10 s (AC-83).
