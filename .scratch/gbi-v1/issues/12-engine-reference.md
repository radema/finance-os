# 12 — Engine reference when Excel, spec and mock disagree

Type: grilling
Status: resolved
Blocked by: 04
Map: ../map.md

## Question

For each disagreement listed in `research/04-excel-v2-audit.md`: which formula does v1 implement? Then: which artefact is the acceptance oracle for engine tests (Excel parity within EUR 1, hand-checked golden cases, the mock engine), and which parity fixture gets committed.

## Answer

Grilled with the user 2026-10-29. Sources: `research/04-excel-v2-audit.md` (codes E*, M*, S* below), `reference/source-spec.md` "Calculation engine" and "Testing and validation", `reference/mock-app.html`. Changes to the source spec are marked **(change)**.

### Which formula v1 implements

Spec and mock win over the Excel everywhere the audit found them right:

| Code | v1 rule |
|---|---|
| E1 | PMC derived from transactions. The opening comes from the "Current portfolio" form with the fiscal PMC typed by the user (ticket 08); later buys update it. |
| E3 | Required contribution by bisection (spec/mock), not the Excel linear rule. |
| E4, E5 | Monte Carlo seeded, one correlated class-shock array shared by all buckets; MC liquidation applies ETF-loss credits and the zainetto, as the deterministic path does. |
| E6 | Next contribution never picks the pension goal. The retirement goal has its own rule: voluntary = max(0, cap + extra − worker − employer), TFR outside the cap. |
| E7 | `asOf` is an engine input (the app passes today; tests pin it). |
| E8 | Exit-tax rate computed per goal from that goal's year. |
| M1 | Contributions stop at the goal date in every function (projection, cash flow, plan vs actual): mock `y <= g.year` becomes `y < g.year`. |
| M2 | Already fixed by ticket 07 (FI wealth net). |
| — | Positions with no weight row stay in the bucket projection (mock behaviour). |

Pension deduction cap: a setting (default €5,300), one value for all future years; a change recomputes everything.

Product calls:

- **E9 — year-1 timing (change): pro-rata stub year.** Goal date = 1 January of the goal year (unchanged). The current calendar year Y0 = year(`asOf`) is a stub of r = 12 − month(`asOf`) months (the `asOf` month counts as done; `asOf` in October → 2 months, in December → 0). In the stub: contribution = r × monthly (pension: schedule of Y0 × r/12), growth factor g^(r/12), stamp duty × r/12. Then full years Y0+1 … goal year − 1; full year k (k = 1, 2, …) contributes 12 × monthly × (1 + growth)^(k−1). With r = 0 this equals the mock started on 1 January of Y0+1. Same stub rule in cash flow and the FI projection.
- **S4 — pension at retirement: full value + warning.** The engine values the whole pot net of exit tax (as ticket 07 counts it in FI wealth). The pension and goal screens and the glossary say that usually at most 50% can be taken as capital and the rest is paid as an annuity (and that a phased payout exists from 31 Oct 2026). No decumulation logic in v1.
- **S1 — BTP coupons (change): optional `couponRate` on govt products.** Each year (stub pro-rata) coupon = couponRate × value at the start of the step; taxed 12.5% when paid; the net coupon is reinvested in the same product and added to value and basis; coupons are never offset by credits or the zainetto. Price return = μ − couponRate, deferred and offsettable as today. `couponRate` = 0 gives today's result. Bond maturity is not modelled and not flagged in v1 (v2).
- **S5 — pension flow mix (change): recomputed every year.** Each year's TFR, worker, employer and voluntary flows are split separately with each product's % of that flow; no frozen year-1 weights.
- **S2 — commissions in basis (change):** the actual commission of a buy is added to the tax basis (TUIR art. 68), consistent with Fineco's fiscal PMC.
- **Kept as simplifications (documented in the method notes, v2 candidates):** S3 exit-tax base = all contributions (exact while voluntary stays within the cap, the user's rule); S6 extra deduction every year and refund at the marginal IRPEF rate only; S7 pension fund return taxed at 20% flat (accumulation tax, distinct from the 15%→9% exit tax); cash pays 0.2% stamp duty (deposit account), not the €34.20 flat current-account duty.

### v2 candidates (for the spec's section, ticket 10)

Goal month (goal date other than 1 January); per-year pension cap; BTP maturity before the goal year; S3 exact exit-tax base and 365-day membership years; S6 extra-deduction window and regional/municipal surcharges in the refund; S7 12.5% on the govt-bond share of pension funds; flat €34.20 stamp duty for current accounts; pension payout (50% capital, annuity, phased payout).

### Test oracle and committed fixture (change to "Testing and validation")

- **Excel parity is dropped** as an acceptance test. The file has no cached values and v1 departs from it on purpose (E1, E3, E9, S1, S2, S5). The Excel is a formula reading aid only; it is never recalculated, committed or imported for tests.
- **Acceptance gate = hand-checked golden cases**, numbers written in the test: the spec's golden tax cases (ETF gain; ETF loss + govt gain; zainetto expiring; deposit; exit tax at 10/15/20/35 years) plus one case per change in this ticket (stub year, coupon, commission in basis, yearly pension mix, M1 cut-off) and the FI cases of ticket 07.
- **Differential test vs the mock engine** (ticket 05): the mock engine copied unchanged into the test tree, fast-check random inputs restricted to the domain where v1 and mock must agree: stub r = 0 (mock started on 1 January of the next year), commissions 0, `couponRate` 0, pension with one flow (constant mix), outputs before the goal year only for cash flow and plan vs actual. Listed expected differences outside that domain: M1, M2, E9, S1, S2, S5.
- **Committed fixture:** synthetic JSON only, under the new repo's engine test data: 7 made-up products (ETF WL 0, ETF WL 50%, direct, govt with `couponRate`, deposit, two pension funds), 4 made-up goals (one with T < 1, one with the zainetto, one holding a product at a loss, retirement), a ledger with opening + buy + sell + buy, round pension inputs, pinned `asOf`. Its outputs are stored as a reviewed regression snapshot. No real names, ISINs, amounts, and no xlsx.

Check: the spec's engine section states the stub-year rule, `couponRate`, commission in basis and yearly pension mix, and its testing section has no Excel parity test; engine tests pass the golden cases (a) `asOf` 2026-10-31, goal 2028, monthly 100, one ETF with μ = 0, TER 0, stamp duty 0, start value 0 → gross at goal = 1,400 (mock: 2,400), and (b) govt product value 10,000, μ = 4%, couponRate 4%, stamp duty 0, one full year → value 10,350 and basis 10,350; `git grep -nE 'IT[0-9]{10}|gbi-planner-v2' -- '*.json'` in the new repo's test data returns nothing.
