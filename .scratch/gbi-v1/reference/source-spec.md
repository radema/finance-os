
# Goal-based investing app: product & technical spec
 · 
## Purpose and scope
Build a local-first app that replaces the Excel/Google Sheets goal-based investing (GBI) tracker. It keeps every feature of the Excel v2 and adds six: performance tracking over time, goal analysis repeated over time, an enhanced dashboard, three financial-independence levels, a per-bucket mix optimizer, and rule-based alerts.
User. One Italian household investor (single user), regime amministrato, one broker account (Fineco), Italian pension funds. Tax rules as of 2026.
References.
- 
Interactive mock (behaviour and layout reference): [https://claude.ai/artifact/84iAK81nRPTmbmYnQPmyhy] Goal-based investing app (mock). Its JavaScript engine is a working reference implementation for every formula in this spec.
- 
Excel v2 (gbi-planner-v2.xlsx): the deterministic projection is the parity baseline (see Testing).
In scope. Goals and buckets, products, transactions, prices, pension module, household cash flow, deterministic and Monte Carlo goal analysis, required contributions, plan vs actual, next-contribution suggestion, performance (TWR, XIRR, drawdown), goal-analysis snapshots, financial-independence levels, mix optimizer, alerts, import/export.
Non-goals (v1). Multi-user, multiple broker accounts, automatic trading, tax filing, decumulation plans (multi-year withdrawals), glide paths, regime dichiarativo, currencies other than EUR. The app suggests; it never acts on the account.
Glossary. Bucket = goal + the holdings assigned to it. PMC = average cost per unit at account level. TWR = time-weighted return. XIRR = money-weighted return. Snapshot = goal analysis frozen at a date.
## Domain model
Transactions and prices are the only sources of truth for holdings. Values, cost bases and performance are always derived, never typed in.
 | 
Entity | 
Key fields | 
Notes
 | 
Settings | 
inflation, taxStd 26%, taxGovt 12.5%, bollo 0.2%, pensionTax 20%, required probabilities (Need 90 / Want 75 / Wish 50), MC paths, seed, trackingStart (YYYY-MM), zainetto {amount, expiry, goalId} | 
One row, versioned
 | 
Commission | 
rate 0.19%, min €, max €19 | 
Min efficient ticket = min / rate
 | 
FireSettings | 
efFromGoal or efMonths, l2Mult 300, l3Mult 200, includePension | 
Level definitions
 | 
AssetClass | 
6 fixed: Equity, Govt bonds, Corp bonds, Multi-asset, Cash, Gold/Commodities | 
Correlation matrix 6×6
 | 
Product | 
id, name, ISIN, assetClass, regime (etf, direct, govt, cash, pension), whiteListShare, expReturn, volatility, TER/ISC, maturity (YYYY-MM), zeroCommission, priceSource (provider, csv, manual), ticker | 
Return/vol are user assumptions; ticker used by the provider
 | 
PricePoint | 
productId, month (YYYY-MM), price per unit, source (provider, csv, manual), fetchedAt, importBatchId? | 
Month-end. Bonds: price/100. Pension: unit value
 | 
Goal | 
id, name, priority (Need/Want/Wish), target (today’s €), targetYear, monthlyContribution, contributionGrowth, minProb?, countsTowardFI | 
Exactly one goal may be the pension goal
 | 
AllocationWeight | 
goalId, productId, weight | 
Split of new money; rescaled to 100% per goal
 | 
Transaction | 
id, date, goalId, productId, type (opening, buy, sell, pensionContribution), qty (signed), price, commission? (actual), note, importBatchId? | 
Sell = negative qty
 | 
ImportBatch | 
id, kind (transactions, prices, products, goals), source name, file name, createdAt, rows read / imported / skipped, undoneAt? | 
Unit of undo
 | 
ImportMapping | 
name (e.g. Fineco movimenti), kind, column map, delimiter, decimal and date format | 
Reused on the next import
 | 
PensionPlan | 
ral, ralGrowth, tfrPct, workerPct, employerPct, voluntary (blank = to cap), marginalRate, firstYear, cap 5,300, extra, goalId, flows[{productId, flow Work/Voluntary, pct}] | 
Drives pension goal contributions and weights
 | 
CashFlow | 
income, incomeGrowth, essential €/month, optional €/month, expenseGrowth, events[{year, label, amount}] | 
Essential/optional also feed FI levels
 | 
Snapshot | 
date, source (saved, recomputed), assumptionsHash, per goal {prob, reqP, detNet, target, median, p10, p90, value, status} | 
Frozen at save time
 | 
Alert | 
ruleId, severity, title, body, condition, createdAt, dismissedAt? | 
Generated, never stored as truth
Derived, not stored. Units per (goal, product) = sum of transaction qty. Account PMC per product = running weighted average of buys across all buckets (sells do not change it). Bucket cost basis = units × account PMC. Value = units × month-end price.
## Calculation engine
One pure, deterministic, unit-tested module with no UI or storage dependencies. Same inputs and seed give the same outputs. The mock’s engine script is the reference; port it function by function.
Holdings at date d. Walk transactions with date ≤ d in date order. Units per (goal, product) = Σ qty. Account PMC per product: on a buy, PMC = (PMC × units + price × qty) / (units + qty); sells leave it unchanged.
Per-product parameters. Lognormal: s = √ln(1 + σ²/(1+μ)²), m = ln(1+μ) − s²/2. Tax rate on gains by regime:
- 
etf: 26% − 13.5% × whiteListShare; gains are redditi di capitale (not offsettable).
- 
direct: 26%; govt: 12.5%; both offsettable by losses and zainetto.
- 
cash: interest taxed yearly at 26% (no exit tax).
- 
pension: return taxed yearly at pensionTax (20%), symmetric; no stamp duty; exit tax on cost basis.
Goal projection (one path). Yearly steps t = 1…T, T = targetYear − current year. For each product in the bucket:
- 
Growth g = exp(m + s·z) × (1 − TER), deterministic g = (1 + μ)(1 − TER). z = correlated class shock.
- 
Cash: g = 1 + (g − 1)(1 − 26%) when g > 1. Pension: g = 1 + (g − 1)(1 − 20%).
- 
Value × g. Stamp duty (not pension): b = 0.2% × value; value −= b; basis = max(0, basis − b), so stamp duty never reduces the taxable gain.
- 
Contribution C(t) × weight added to value and basis, at year end.
C(t) = 12 × monthly × (1 + growth)^(t−1). Pension goal: C(t) = TFR + worker + employer + voluntary from the pension schedule.
Liquidation at goal date. Per product gain = value − basis. Taxes and credits are counted in tax euros, which applies the 48.08% rule for govt bonds automatically. ETF gains taxed, ETF losses become credits. Direct/govt gains are summed, then reduced by credits from losses in the same bucket plus the assigned zainetto (tax euros = amount × 26%). Pension: exit tax = rate × basis, rate = max(9%, 15% − 0.3% × max(0, years of membership at goal year − 15)). Net = gross − taxes.
Target. Target at date = target × (1 + inflation)^T. Success = net ≥ target at date.
Monte Carlo. P paths (default 1,000; 300 for snapshots and optimizer). Shocks: one 6-class correlated normal vector per path and year (Cholesky; if not positive definite, shrink off-diagonals by 10% until it is). The same shock array is shared by all buckets, so sums across buckets are coherent. Outputs per goal: P(success), percentiles 10/50/90 of net value per year, average shortfall.
Required contribution. Bisection on monthly amount (pension: on a multiplier of the schedule) until deterministic net ≥ target, or MC probability ≥ required, using common random numbers. Return null (not reachable) after 12 doublings. Horizon < 1 year: 0 if already met, else null.
Status. On track if P ≥ required; At risk if within 15 points; else Off track.
Pension schedule (year t, current year = 1). RAL(t) = RAL × (1 + g)^(t−1); TFR = RAL × 6.91%; worker and employer = RAL × %; voluntary = given, or max(0, cap + extra − worker − employer). Deductible = min(cap + extra, worker + employer + voluntary). Refund (cash inflow in t + 1) = min(voluntary, room) × marginal rate. Pension product weights = flow share × % of flow.
Cash flow (year t). Capacity = income − 12 × (essential + optional) (both growing) + events + pension refund of t − 1. Planned from savings = Σ goal contributions; the pension goal counts only its voluntary part.
Financial-independence levels (today’s €).
- 
Level 1 Safety = the emergency-fund goal target, or efMonths × essential.
- 
Level 2 Barista FIRE = l2Mult × essential monthly expenses (default 300).
- 
Level 3 FIRE = Level 2 + l3Mult × optional monthly expenses (default 200).
FI wealth = Σ net value of buckets with countsTowardFI (pension only if includePension), deflated by inflation. Projection: per path, sum of those buckets for t = 0…40; after a goal’s date contributions stop and the bucket keeps compounding. Report median, P10/P90, deterministic line, first year the median and the deterministic line cross each level, and P(level reached) per year.
Performance (monthly). For each month m: value V(m) = Σ units × price(m); flow F(m) = Σ transaction amounts in m (opening included). TWR: r(m) = (V(m) − F(m)) / V(m−1) − 1, chained. Drawdown = index / running max − 1. XIRR on dated flows (−amount) plus final value, solved by bisection in [−99%, 100%]. Scopes: all, all except pension, each bucket.
Plan vs actual. Planned since trackingStart = monthly × months (pension: schedule total / 12 per month); actual = Σ non-opening transaction amounts. Next contribution: the non-pension bucket with the largest negative gap; amount = gap, split by weights; recommend waiting if the amount is below the min efficient ticket and the bucket holds commission-bearing products.
### Mix optimizer
The optimizer answers one question per bucket: which split of new money (or of the whole bucket) best serves this goal? It works in three steps.
- 
Candidates. Every mix of the chosen products (1–6) in steps of 10% (≤ 4 products) or 20% (5–6), dropping mixes where any product exceeds the user’s maximum per product (default no limit; 40–80% suggested).
- 
Evaluation. Each mix runs on the same shock array (300 paths; 200 for “spend least”), so differences come from the mix, not from luck. Per mix: P(success), median, P10, P90, average shortfall, deterministic value, and for “spend least” the monthly contribution needed.
- 
Choice. Keep the feasible mixes (P(success) ≥ required probability), then apply the criterion. If no mix is feasible, return the mix with the highest P(success) and say so.
 | 
Criterion | 
Objective among feasible mixes | 
Tie-break | 
Default for
 | 
Protect the bad case (O1) | 
Maximise P10 (value reached in 9 of 10 markets) | 
Higher P(success) | 
Need
 | 
Grow the typical outcome (O2) | 
Maximise the median | 
Higher P(success) | 
Want, Wish
 | 
Spend least (O5) | 
Minimise the monthly contribution that reaches the required probability (bisection per mix) | 
Higher median | 
–
 | 
Maximise the chance (O4) | 
Maximise P(success); no feasibility filter | 
Higher median | 
–
Modes. New money only (default): current holdings stay, contributions follow the new weights; no tax. Rebalance now: current holdings are sold first, the tax due is deducted, and basis is reset; pension buckets are excluded because pension funds cannot be sold.
Output. Suggested vs current weights; outcomes compared (P, median, P10, shortfall, monthly needed); switch tax; the rule text; a scatter of all mixes (x = P(success), y = median); the top 10. “Use as contribution weights” writes AllocationWeights after confirmation; pension weights are changed only in the pension flows.
Known limit. An optimizer amplifies errors in expected return and volatility. The UI says so next to the result, and the per-product cap is the guard. Class-level caps (for example ≤ 20% Gold/Commodities) are a v2 candidate.
## Features and screens
Thirteen screens, as in the mock. English UI, Italian glossary, EUR in it-IT format, light and dark themes, usable from 360 px wide. A global valuation date (default: last month with prices) drives every screen.
 | 
Screen | 
Content | 
Acceptance criteria
 | 
Dashboard | 
Net worth, market change this month, YTD TWR, FI wealth, goals on track; FI ladder; alerts; goals table with status, P(success) trend sparkline, plan gap; net worth by bucket over time with money put in; 10-year savings capacity vs plan | 
Loads in < 2 s with 5 years of monthly data; every number links to the screen that explains it
 | 
Goals | 
Table of all goals (det., median, P10–P90, P, monthly now, needed det./prob., status); detail: value, P vs required, XIRR, fan chart, P history, holdings with units/price/PMC/gain/tax if sold, value vs money put in | 
Deterministic net matches Excel v2 to €1 on the same inputs
 | 
Financial independence | 
Ladder of 3 levels with % reached; table with target, progress, year reached (det./median), P(reached in 20 y); editable multipliers and expense split; projection fan in today’s € with level lines | 
Changing a multiplier updates levels instantly; pension excluded by default
 | 
Mix optimizer | 
Bucket, mode, criterion (4 named options), maximum per product, product universe; “How the optimizer chooses” panel; suggested vs current weights; outcomes compared; switch tax; scatter of all mixes; top 10; “Use as contribution weights” | 
462 mixes × 300 paths in < 3 s (“spend least” < 10 s); the rule that chose the mix is shown; applying writes AllocationWeights only after confirmation
 | 
Performance | 
Scope selector; value, gain, TWR since start/YTD/12m, XIRR, max drawdown; charts: value vs money put in, growth of €100, drawdown, monthly returns; table for all scopes | 
TWR and XIRR match a hand-checked spreadsheet within 0.01 pp
 | 
Goal history | 
Metric switch (P, funded ratio, median/target); lines per goal over snapshots; snapshot table; Save snapshot; delete saved snapshots | 
Saved snapshots never change when assumptions change; recomputed ones are labelled
 | 
Plan vs actual | 
Planned vs put in since trackingStart; next contribution card with product split, commission and cost %; cumulative planned vs actual per goal | 
Opening transactions never count as contributions
 | 
Transactions | 
Add form (date, bucket, product, type, amount, price prefilled, commission optional) with commission estimate and cost warning; filters by bucket and year; delete | 
Quantity = amount / price; sells stored as negative qty; edits re-derive all holdings
 | 
Import | 
Tabs for transactions and prices (products and goals later); paste or upload CSV/XLSX; column mapping with saved mappings; row check with status and bucket picker (per row or for all); import ready rows; list of past imports with undo | 
A 200-row Fineco export imports in < 1 minute of user time; re-importing the same file adds 0 rows; undo restores the exact previous state
 | 
Prices | 
Price sources per product (provider + ticker, CSV, manual) with last price and status; Fetch latest prices; month-end grid (6 months, current month editable); add next month; positions by product with account PMC and buckets | 
A provider failure never blocks the screen; missing price falls back to last known month and raises R5
 | 
Pension | 
This year: cap, used, still available, refund, exit tax; inputs; flows table; 10-year schedule and chart | 
Voluntary YTD is computed from pension transactions on Voluntary products
 | 
Setup | 
Products, Allocation (pension weights read-only), Goals, Cash flow (+ 10-year table), Assumptions (tax, probabilities, MC, trackingStart, commissions, correlations, reset) | 
Correlation matrix stays symmetric; invalid matrices are shrunk and flagged
 | 
Glossary & method | 
Italian terms with English and plain explanation; method notes | 
Content matches this spec
Data entry that must be fast. Add a transaction in under 20 seconds; update month-end prices for 15 products in under 2 minutes (CSV paste or import).
## Prices and bulk import
Prices arrive three ways, chosen per product: an online provider, a CSV import, or a single manual entry. All three write the same PricePoint with its source recorded, so every valuation can be traced back.
Price sources.
- 
Provider (by ticker). A PriceProvider interface: fetch(tickers, from, to) -> [(ticker, date, close, currency)]. First adapter: Yahoo Finance through yfinance (tickers like VWCE.MI). Month-end close = last trading day of the month. Reject a price in a currency other than EUR, or a move above 25% versus the previous month, into a review list instead of storing it.
- 
CSV import. Long format (date, ISIN or ticker or name, price) or wide format (date + one column per ticker). See bulk import below.
- 
Manual. One field per product and month, as in the mock. The right choice for BTP (price/100 from the broker) and pension funds (unit value from the fund statement).
Yahoo Finance caveats. It has no official API: yfinance reads public endpoints that can change or rate-limit without notice, and its terms restrict use to personal purposes. Treat it as best effort: cache results, retry with backoff, never block the app when it fails, and raise R10. Coverage for Borsa Italiana bonds and Italian pension funds is poor or absent, so those stay manual or CSV.
Scheduling. Fetch on demand (button) and automatically on the first day of each month for the previous month; optional daily fetch for the dashboard. A manual price always wins over a fetched one for the same month unless the user re-fetches explicitly.
Bulk import pipeline (transactions and prices).
- 
Parse. CSV or XLSX; detect delimiter, decimal comma and date format (YYYY-MM-DD, DD/MM/YYYY, YYYY-MM).
- 
Map columns. Auto-guess from header names; the user can change each mapping. Saved mappings per source (for example “Fineco movimenti”) are reused next time.
- 
Match products. By ISIN, then ticker, then exact name; unknown products are listed and can be created from the row.
- 
Assign buckets (transactions). Bucket column if present; else the only bucket that holds or is weighted on the product; else the user picks per row or for all remaining rows. Option: split one broker trade across buckets by weights.
- 
Validate. Missing quantity/price, unreadable date, sign from a buy/sell column (A/V, Buy/Sell), duplicates against existing data (key: date, product, quantity, price) and inside the file.
- 
Preview and commit. Row-level status (ready, skipped, needs fix); import only ready rows in one ImportBatch.
- 
Undo. Each batch can be undone as a whole: its transactions are removed or the previous prices restored.
Other bulk imports. Products and goals from CSV (same pipeline, upsert by ISIN or name), the one-off Excel v2 importer, and full JSON restore.
## Rules: alerts and recommendations
Every alert and every suggestion shows the rule that produced it (id, name, condition). Rules are data with parameters, evaluated after each recalculation; no recommendation exists without a rule.
 | 
Rule | 
Severity | 
Condition | 
Message
 | 
R1 Behind plan | 
Medium | 
Non-pension bucket gap since trackingStart < −min efficient ticket | 
“{goal} is €X behind plan” + next-contribution card
 | 
R2 Deduction room | 
Info | 
Cap + extra − (worker + employer + voluntary YTD) > 0, current year | 
“€X of pension deduction still available; refund ≈ €Y”
 | 
R3 Maturity ahead | 
Medium | 
Held product with maturity ≤ 36 months | 
“{product} matures in N months: plan the proceeds”
 | 
R4 Status worsened | 
Medium | 
Goal status worse than in the latest snapshot | 
“{goal} got riskier: from A to B”
 | 
R5 Stale prices | 
Medium | 
Held product whose last price month < valuation month | 
List of products
 | 
R6 Need off track | 
High | 
Priority Need and status Off track | 
P vs required + monthly needed
 | 
R7 Costly trades | 
Info | 
Last 12 months: commission / amount > 1.25 × rate | 
Count + advice to batch
 | 
R8 Near goal, risky assets | 
Medium | 
Horizon ≤ 1 year and equity value > 0 | 
“Consider moving to low-risk assets”
 | 
R9 Units mismatch | 
High | 
Units per product across buckets ≠ units on the broker statement (when entered) | 
“{product}: buckets hold X, broker shows Y”
 | 
R10 Price fetch failed | 
Medium | 
Provider error, non-EUR currency or monthly move > 25% | 
“N prices need a check” + review list
 | 
O1–O5 Optimizer | 
– | 
See Mix optimizer | 
Rule text shown under the suggestion
Alerts can be dismissed until the condition changes. Thresholds (36 months, 1.25×, 15 points) are settings, not constants.
## Architecture, stack and data
Proposed stack: a Python engine and API with SQLite, a React SPA, shipped as one Docker image and runnable locally with uv. Python keeps the engine testable against the Excel and close to the existing data tooling; the mock’s JavaScript engine is the reference to port.
The UI talks only to the API. The API validates input, calls the engine and the rules, and reads and writes SQLite. Importers and the monthly job write through the same store.
- 
Engine. Pure functions, NumPy-vectorised Monte Carlo (paths × years × classes), seeded RNG. No I/O. Target: full analysis of 6 goals × 1,000 paths × 40 years in < 1 s.
- 
API. REST, JSON. Recalculation on every write; results cached by an inputs hash.
- 
Storage. SQLite, one file; schema migrations (Alembic). Money as decimal in storage, float in the engine.
- 
Frontend. React + TypeScript + Vite; charts with Apache ECharts or Chart.js; same screens and copy as the mock.
- 
Prices. PriceProvider adapters behind one interface (first: Yahoo Finance via yfinance), plus CSV import and manual entry; every price stores its source. See Prices and bulk import.
- 
Import/export. One import pipeline (parse, map, match, assign, validate, preview, commit, undo) for transactions, prices, products and goals; saved column mappings; one-off Excel v2 importer; full JSON export/import.
- 
Deployment. Local or self-hosted; no auth by default, put behind a reverse proxy with auth if exposed. Nightly backup of the SQLite file.
## Testing and validation
The engine is accepted only when it reproduces the Excel v2 deterministic results and hand-checked golden cases.
- 
Excel parity. Import the Excel v2 example inputs; deterministic net value per goal must match Goals!M within €1, and Pension, Contrib_Schedule and CashFlow rows within €0.01.
- 
Golden tax cases. One ETF gain; one ETF loss + one direct govt-bond gain (credit applied at 12.5/26); zainetto expiring before the goal date; a deposit account; a pension fund at 10, 15, 20 and 35 years of membership (15% / 15% / 13.5% / 9%).
- 
Holdings. PMC after buy, buy, partial sell, buy matches a broker example; units per bucket sum to account units.
- 
Performance. TWR and XIRR on a 12-month fixture match a spreadsheet within 0.01 pp; a month with zero value does not divide by zero.
- 
Monte Carlo. Same seed → identical outputs; with volatility 0 the median equals the deterministic value; P(success) for a fixture within ±2 pp of a 20,000-path reference.
- 
Optimizer. On a two-product fixture the chosen mix equals a brute-force check; rebalance mode deducts the expected tax.
- 
Property tests (Hypothesis). Net value is non-decreasing in monthly contribution; required contribution makes the target reachable; weights always sum to 1.
- 
UI. Playwright smoke tests per screen in light and dark mode at 1360 px and 390 px; no console errors.
## Delivery plan and open questions
Six milestones, each shippable and tested before the next starts.
- 
Engine core. Holdings, taxes, deterministic projection, pension schedule, cash flow; Excel parity tests green.
- 
Monte Carlo and solver. Shocks, P(success), fan, required contributions, FI levels projection.
- 
Data layer, import and prices. SQLite schema, JSON export/import, Excel v2 importer, bulk import pipeline with undo, price sources (manual, CSV, Yahoo adapter).
- 
Core screens. Setup, Transactions, Import, Prices, Pension, Goals, Plan vs actual.
- 
Tracking. Performance, snapshots and Goal history, monthly job (prices + snapshot), Dashboard with rules R1–R10.
- 
Optimizer and polish. Mix optimizer (O1–O5), Financial independence screen, glossary, dark mode, mobile layout, Playwright suite.
Open questions
- 
FI levels: confirm that the 300× and 200× multipliers apply to monthly expenses (300× monthly = 25× yearly, the 4% rule), and whether Level 1 should use the emergency-fund goal or a number of months.
- 
FI levels: should pension funds count, and from which age?
- 
Stack: confirm Python + FastAPI + SQLite + React, or prefer a single-language TypeScript app with the engine in the browser.
- 
Should this be built as a module of the Finance OS project (shared Bucket, Holding, Rule, Alert, Snapshot concepts) or as a standalone app?
- 
Prices: is Yahoo Finance via yfinance acceptable given it is unofficial, or should a second provider be planned as fallback from the start?
- 
Import: which broker export to support first (Fineco “movimenti” CSV or XLSX)? A sample file is needed to fix the mapping.
- 
Import: when one broker trade serves several buckets, split it by weights automatically or always ask?
- 
Optimizer: add class-level caps (e.g. Gold ≤ 20%) in v1, or keep only the per-product cap?
- 
Snapshot cadence: monthly automatic plus manual, or manual only?
- 
Fineco commission minimum (assumed €2.95) and the list of zero-commission ETFs to confirm.
- 
Plan history: should changes to monthly contributions be versioned, so plan vs actual uses the plan in force at each date?