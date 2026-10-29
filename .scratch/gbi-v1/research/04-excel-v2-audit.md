# 04 — Excel v2 audit against the spec and the mock engine

Ticket: `issues/04-excel-v2-audit.md`. Date: 2026-10-29. File audited: `gbi-planner-v2.xlsx`
(sha256 prefix `e94d5394c637673b`, path in `map.md` Notes). Read with openpyxl, formulas and cached values.

## Question

Map the Excel v2 sheets and formulas to the spec (`reference/source-spec.md`, "Calculation engine") and the
mock JS engine (`reference/mock-app.html`). List every disagreement, judge which is right under 2026 Italian
tax rules and financial correctness, say whether the file holds personal figures, and propose an anonymised
parity fixture.

## Short answer

1. **The Excel holds no computed numbers.** openpyxl 3.1.5 wrote the file (`docProps/app.xml`). Every one of the
   ~285,000 formulas has no cached value. Nobody has read a baseline from it. The spec's parity test
   (`source-spec.md:326`, "Goals!M within €1") has nothing to compare against until someone recalculates the file
   in Excel or LibreOffice. A `pycel` attempt evaluated only some cells (see Sources).
2. **The deterministic path agrees in all three** (inferred from reading the formulas, not from numbers): growth,
   TER, stamp duty, the basis rule, ETF blended rate, credits in tax euros, the zainetto, pension 20% and exit tax.
3. **The Excel differs on method, not on deterministic tax.** It takes PMC as an input. It solves "monthly needed"
   by a linear rule. Its Monte Carlo works per bucket, unseeded and independent per goal. Its next-contribution
   rule includes the pension bucket. Spec and mock are right on each of these.
4. **The mock has one off-by-one the Excel does not.** Its cash flow and plan-vs-actual count contributions in the
   goal year (t = T+1). The projection stops at t = T. The Excel is right here.
5. **All three share some tax simplifications.** BTP coupons are treated as deferred gains. Commissions are left
   out of the basis. The whole pension pot is treated as a lump sum. Year-1 pension weights are frozen.
   Extra-deduction years are not limited.
6. **Personal data:** goal names and targets, household income and expenses, one-off events, and the product list
   with its weights look real. Holdings (`Versamenti`) and pension inputs (`Pensione`) are labelled as example values.

## Sheet map

| Sheet | Purpose | Key ranges |
|---|---|---|
| Start, Method, Migrazione, Glossary | Text: v2 notes, method, migration, glossary | `Method!A3:A15` states the simplifications |
| Settings | Assumptions | `B4` start year, `B5` inflation, `B6:B7` 26/12.5%, `B8` bollo, `B9:B11` required P, `B13:B15` zainetto, `B21` pension tax, `B24:B28` commissions |
| Correlations | 6×6 class matrix, lower triangle input | `B3:G8` |
| Products | 15 product slots: regime, μ, σ, TER, last price, PMC | inputs `A5:M19`; `N` tax rate, `P` det. growth factor, `Q` vol after fund tax |
| Goals | 6 goals, results | inputs `B5:H10`; `I` horizon, `J` target nominal, `L` zainetto credit, `M` det. net, `O` value of €1/month, `P`/`V` monthly needed, `Q:U` MC stats, `W` status |
| Mapping | Goal↔product rows, weights, quantity from ledger | inputs `A5:B44`, `E5:E44`; `F` qty, `G` value, `H` basis, `N` rescaled weight, `T` blended weight |
| Versamenti | Ledger (Apertura/Acquisto/Vendita/Contributo fondo) | `A5:H1004`; `I` amount, `M` est. commission |
| Contrib_Schedule | Yearly planned contribution per goal, t = 1..40 | `C5:AP10` |
| Det_Projection | Per-product deterministic value and basis, t = 0..40 | `K:AY` value, `BA:CO` basis, `CQ:CW` liquidation, `CX:GF` €1/month marginal |
| Pensione | RAL, flows, cap, exit rate, yearly schedule | inputs `B4:B15`, `A22:C26`; `B17:B18` exit rate; `C31:L70` schedule |
| CashFlow | Household cash flow, 40 years | inputs `B4:B7`, `A11:C20`; rows `24:63` |
| Piano_vs_Reale | Plan vs actual and next contribution | `C6:J11`; next action `C14:C17`; uses `TODAY()` |
| Bucket_Params, MC_Helper | Blended per-bucket μ, σ, tax, bollo for MC | `Bucket_Params!C5:P10`; `MC_Helper!AP5:AP44` |
| MC_G1..MC_G6 | 1000 paths per goal, `NORMSINV(RAND())` | paths `B31:AP1030`; `AR` net, `AS` success |
| Dashboard, Lists | Charts and dropdown lists | no engine logic |

**Not in the Excel:** FI levels, TWR/XIRR/drawdown, the mix optimizer, snapshots, price history. The spec's
parity test can only cover Goals, Pensione, Contrib_Schedule and CashFlow.

## Formula comparison table

Refs: Excel = sheet!cell. Spec = `source-spec.md:line`. Mock = `mock-app.html:line`.

| Topic | Excel | Spec | Mock | Verdict | Conf. |
|---|---|---|---|---|---|
| ETF tax rate | `Products!N5`: 26% − 13.5% × WL | :87 same | :424 same | Agree; right (white-list share at 48.08%) | High |
| Det. growth | `Products!P5`: (1+μ)(1−TER); cash and pension net of 26%/20% | :96-98 | :468-470 | Agree | High |
| Stamp duty | value × (1−0.2%), basis −= bollo × value (`Det_Projection!L6`, `BB6`) | :100 | :472 | Agree. Bollo is not a deductible cost, so keeping the gain unchanged is right. Cash on a current account pays €34.20 flat, not 0.2% | High |
| Cash regime | basis = value each year (`BB6`) | :91 | :473 | Agree; no exit tax is right for deposits | High |
| Contribution timing | added at year end, t = 1..T (`Contrib_Schedule!C5`) | :102-103 | :474 | Agree. All give t = 1 a full 12 months even in October (see Errors E9) | High |
| Liquidation | `Goals!M5`: V − ETF tax − exit tax − max(0, offsettable − credits − zainetto) | :104 | :448-458 | Agree. ETF gain not offsettable, ETF loss is a credit, 48.08% via tax euros | High |
| Zainetto | `Goals!L5`: credit only if goal year ≤ expiry | :104 | :446 | Agree. Not applied in Excel MC (E5) | High |
| Pension exit rate | `Pensione!B18`: max(9%, 15% − 0.3% × (yrs−15)) | :104 | :412 | Agree; matches D.Lgs. 252/2005 art. 11 c.6 | High |
| Exit-tax base | basis = TFR + all contributions | :104 | :453 | Shared simplification: non-deducted contributions are exempt (S3) | High |
| Pension schedule | `Pensione!C31:J31` | :109 | :401-410 | Agree. TFR 6.91% = 1/13.5 − 0.5% is right; cap €5,300 is right for 2026 | High |
| Pension weights | `Pensione!D22`: year-1 flow mix | :109 (year not stated) | :413-417 year 1 | Shared error: the mix drifts as RAL grows (S5) | High |
| Required contribution | `Goals!P5`/`V5`: linear, F + gap / value of €1/month | :107 bisection | :494-503 bisection | Spec/mock right. Excel is wrong at tax kinks, and `GF6` taxes every regime as ETF (E3) | High |
| Monte Carlo | per bucket, blended lognormal, own RAND per goal | :106 class shocks, shared, seeded | :483-492 | Spec/mock right; Excel cannot be a parity target (E4) | High |
| Holdings / PMC | `Products!K` typed input; qty `SUMIFS` with no date filter | :84 derived | :380-391 derived | Spec/mock right (E1) | High |
| Positions without mapping | dropped (Mapping rows only) | silent | :434 kept | Mock right: value must not vanish | Med |
| Status | `Goals!W5`: ≥ req; ≥ req − 15 pp | :108 | :528 | Agree | High |
| Cash flow window | `CashFlow!G24`: t ≤ T | :110 | :618 `y <= g.year`, so t ≤ T+1 | Excel right; mock off by one (M1) | High |
| Cash flow refund | `CashFlow!Q25` = refund of t−1; `Q24` = 0 | :110 | :616 | Agree; year-1 refund for the prior year is missing (S6) | Med |
| Plan vs actual | `TODAY()`, current year × MONTH/12 | :120 from trackingStart | :590-599 | Spec/mock better (pinned date). Mock includes the goal year (M1) | High |
| Next contribution | `Piano_vs_Reale!C14`: MIN over all goals, pension included | :120 non-pension | :601-610 | Spec/mock right (E6) | High |
| Commission | min(19, max(2.95, 0.19% × amount)) (`Versamenti!M5`) | Commission entity | :393-398 | Agree. Check the €2.95 minimum against the user's Fineco plan | Med |
| Commission in basis | not included | not included | not included | Shared error: TUIR art. 68 adds "oneri inerenti" to cost (S2) | Med |

## Errors found in the Excel

- **E1 — PMC typed by hand.** `Products!K5:K19` is an input, and `Mapping!H` = qty × that PMC. `Acquisto` rows in
  `Versamenti` do not update it. Spec and mock derive PMC from buys.
- **E2 — No baseline values.** All formulas are uncached (Short answer 1). The file needs a recalculation and a
  saved copy before any number can serve as a reference.
- **E3 — Linear "monthly needed".** `Goals!P5` = F + (J − M)/O and `V5` = F + (J − U)/O. Net value is piecewise
  linear in the contribution (the `MAX` on gains, credits and the zainetto), so a straight line misses the kinks.
  `Det_Projection!GF6` taxes direct and govt marginal gains at their rate with no offset. For the pension goal,
  the €1/month grows at RAL growth (`Goals!G10`), but the real schedule does not follow that shape. `V5` uses one
  MC percentile as a proxy for the probability target. The spec's bisection is right.
- **E4 — Monte Carlo is not comparable.** `MC_G*!C31` uses `NORMSINV(RAND())`, with no seed and new draws on every
  recalculation. Each goal sheet draws on its own, so cross-goal sums are not coherent. The model is one blended
  lognormal per bucket (`Bucket_Params!F5:I5`), with weights from value + all future contributions (`Mapping!T5`).
  The MC basis (`MC_G1!B16:AP16`) ignores stamp duty, so bollo lowers the taxable gain, unlike the
  deterministic path.
- **E5 — MC tax ignores credits.** `MC_G1!AR31` = V − blended rate × max(0, V − basis) − fixed exit tax. There are
  no ETF-loss credits and no zainetto (`Goals!L5` is unused). The pension exit tax is the deterministic amount
  (`Bucket_Params!O5`) on every path.
- **E6 — Next contribution includes pension.** `Piano_vs_Reale!C14` takes `MIN($I$6:$I$11)` over every goal, the
  payroll-fed pension goal included. The "wait" rule in `C17` does not check for zero-commission products; it
  only names them in the text.
- **E7 — `TODAY()` in plan vs actual.** `Piano_vs_Reale!B3` makes the sheet change from day to day. It cannot be a
  fixture unless the date is pinned.
- **E8 — Exit rate is global.** `Det_Projection!CW6` uses `Pensione!B18`, the pension goal's rate, for any
  "Pension fund" product in any goal. The mock uses each goal's own year (:446). Minor, because the Excel
  allows only one pension goal.
- **E9 — Year-1 timing (convention, not a bug).** Horizon = goal year − `Settings!B4`. Year 1 gets a full 12-month
  contribution even late in the year. All three do this. Deciding it is a separate ticket.
- **E10 — `CashFlow!P` depends on MC.** "Needed from savings" reads `Goals!V`, which is MC-based. Leave it out of
  the "CashFlow rows within €0.01" parity check.

## Mock errors (for the engine-reference ticket)

- **M1 — Off by one in the goal year.** `cashflow()` (:618) and `planVsActual()` (:594) keep contributions while
  `y <= g.year`, which means t ≤ T+1. `runPath` (:465) stops at t ≤ T. The Excel uses t ≤ T in both places
  (`CashFlow!G24`, `Contrib_Schedule!C5`). Fix the mock to `y < g.year`.
- **M2 — FI wealth now is gross.** `fireWealthNow()` (:555-560) sums gross value. Spec :118 says net.

## Shared simplifications (all three)

- **S1 — BTP coupons (Med).** BTP coupons are redditi di capitale (TUIR art. 44), taxed at 12.5% when paid, and
  losses cannot offset them. The model treats the whole BTP return as a deferred, offsettable gain. This matters
  only when credits or a zainetto exist. `Product.maturity` is unused, yet some BTPs and iBonds in the file
  mature before their goal year (`Products!B12:B14`, `B7:B8`).
- **S2 — Commissions in basis (Med).** The tax cost includes "oneri inerenti" (TUIR art. 68). Adding the actual
  commission to the basis lowers the taxed gain. Small impact.
- **S3 — Pension exit-tax base (High).** The taxable part excludes returns already taxed at 20% and non-deducted
  contributions (Fondo Priamo regime document). Using basis = all contributions is right only while
  contributions stay within the cap, which is the default when voluntary is blank. Membership years are
  approximated as goal year − first year. The law counts 365-day years and caps pre-2007 years at 15.
- **S4 — Pension as a lump sum (High).** At retirement, at most 50% can usually be taken as capital (D.Lgs.
  252/2005 art. 11 c.3; not fetched). A new phased payout (min. 5 years, 20%→15%) starts 31 Oct 2026. The model
  treats the whole pot as available at the goal date. Flag this in the UI or the glossary.
- **S5 — Frozen pension weights (High).** All three split every year's flow with the year-1 mix. As RAL grows,
  worker + employer contributions grow and the voluntary room (`cap − w − e`) shrinks. Route the work and
  voluntary flows separately each year.
- **S6 — Extra deduction and refund (Med).** `Pensione!B14` / `extra` is applied every year. The law allows
  €2,650/yr only in years 6-25 of participation, for first jobs after 2007, and only up to the room left unused
  in years 1-5. The refund uses the marginal IRPEF rate only. Regional and municipal surcharges also fall
  (small understatement). The refund for t = 1 (from the previous year's contributions) is zero.
- **S7 — Pension fund tax (Low impact).** 20% flat, symmetric. The real rate is 12.5% on the govt-bond share (62.5%
  base). `Settings!C21` and `Method!A9` say so.

## Personal figures

The file holds what look like personal figures. Do not copy these ranges into the repo:

- `Goals!B5:F10`: goal names (one names an employer), targets, years, monthly amounts. Refer to them as G1-G6.
- `CashFlow!B4`, `B6`: household income and expenses typed as formulas with the amounts inside.
  `CashFlow!A11:C18`: yearly events.
- `Products!B5:C17` and `Mapping!A5:E44`: the real product list (ISINs) and the weights per goal. These show the
  portfolio make-up but no amounts.
- Labelled as example values: `Versamenti!A5:H27` (100 units at €100, note "esempio"), `Products!J:K` (all 100),
  `Pensione!B4:B15` ("VALORI DI ESEMPIO"). Treat them as possibly real all the same.

## Parity fixture proposal

Build a synthetic workbook, not this file. Keep the Excel's structure and replace every input:

1. **Inputs:** `Settings!B4:B26` (keep the rates; set start year 2026), `Correlations!B3:G8` (keep),
   `Products` with 7 made-up products, one per regime branch: ETF WL 0, ETF WL 50%, Direct 26%, Govt 12.5%,
   **Cash/deposit** (none in the current file), and two Pension funds. Use 4 goals with made-up names and round
   targets: one Need with T < 1, one with the **zainetto** assigned (`Settings!B13:B15`, blank today), one holding
   a **product at a loss** (PMC > price, so that `CV` and the credits run), and the pension goal. Use a
   `Versamenti` ledger with Apertura + buy + sell + buy rows, and `Pensione` with round RAL, blank voluntary,
   extra = 0.
2. **Recalculate** in Excel or LibreOffice and save, so that cached values exist. Then extract with
   `data_only=True`.
3. **Outputs to commit as JSON:** `Goals!I:O` (horizon, target, credit, det. net, value of €1/month),
   `Det_Projection!CQ:CW` per row, `Contrib_Schedule!C5:AP10`, `Pensione!B17:B18` and `C31:L70`,
   `CashFlow!C24:O63` (not `P`). Leave out MC sheets, `Goals!P:W`, `Piano_vs_Reale` and Dashboard.
4. **Expected differences to encode, not to match:** PMC (derive it from the ledger and type the same value into
   `Products!K`), M1 (fixture goals end after the cash-flow window, or the mock is fixed first), and E8.
5. Commit the fixture under the new repo's test data. Do not commit the xlsx.

## Open

- Recalculate this file, or build the synthetic one, before claiming numeric parity. Every deterministic
  "Agree" above is inferred from reading the algebra.
- Product decisions: the year-1 timing convention (E9), lump-sum vs 50% capital for pension (S4), and whether to
  model BTP coupons (S1). Each needs the user's call.

## Sources

- Excel: `/mnt/c/Users/RaulDeMaio/Downloads/gbi-planner-v2.xlsx`, read with openpyxl (formulas and `data_only`).
  `docProps/app.xml`: "Microsoft Excel Compatible / Openpyxl 3.1.5". `pycel` (Python 3.11) evaluated only partly:
  `Goals!I5:I10`, `J5`, `Pensione!B18` = 0.09, `Pensione!H31`. Other cells raised `AssertionError`, so this does
  not confirm parity.
- Spec: `reference/source-spec.md:81-120`, `:326-334`. Mock: `reference/mock-app.html:380-625`.
- Deduction cap €5,300 from 2026 (L. 199/2025): https://www.fiscozen.it/news/previdenza-complementare-cosa-cambia-dal-2026-tra-adesione-automatica-portabilita-del-contributo-datoriale-e-nuovo-limite-di-deducibilita/
- Fund regime document (Jul 2026): 20% on returns, 62.5% base for govt bonds, exit 15%→9%, taxable-part
  exclusions, extra deduction €2,650 (total €7,950), phased payout from 31 Oct 2026:
  https://www.fondopriamo.it/cms/resource/2301/documento-sul-regime-fiscale-luglio-2026.pdf
- ETF gains as redditi di capitale, ETF losses usable as credits, 48.08% in offsets (secondary source):
  https://fiscoinvestimenti.it/compensazione-minusvalenze-zainetto-fiscale-2026/
- Cited but not fetched: TUIR art. 44, 67, 68; D.Lgs. 252/2005 art. 8 and 11; DPR 642/1972 Tariffa art. 13 c.2-ter
  (bollo); IRPEF 2026 brackets 23/33/43% (as stated in `Pensione!C10`).
