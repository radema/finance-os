# UX-0001 — V1.0 UI Reference

| | |
|---|---|
| **Status** | Non-normative. Illustrative only. |
| **Track** | Presentation. **Not** part of the RFC corpus (0004–0011) and carrying no amending authority over it. |
| **Companion artifact** | `finance-os-ui-mock.html` — static, fake data, no backend |
| **Subordinate to** | RFC-0011 → RFC-0004…0010 → RFC-0001/0002/0003. Where this document and any RFC disagree, **the RFC wins without argument.** |
| **Purpose** | Give an implementing agent a concrete visual target for V1.0, and separate what the corpus specifies from what a designer had to invent. |
| **Language** | English UI. Provisional — see §6.1. |

---

## 1. What this is, and what it is not

**Is:** a picture of seven read/write surfaces, with fake data that reconciles, so templates can be built against a target instead of against prose. Every block carries an increment badge (S / V1.0 / V1.1 / V1.2) and, behind the *Spec annotations* toggle, its governing RFC section.

**Is not:** a decision document. Nothing here has been ratified. Three specific cautions:

1. **The mock is not a scope grant.** It shows V1.0 whole. The next thing to build is the walking skeleton (RFC-0005 §8), which is three views, not seven. Screens marked `V1.0` and above are visible so nothing gets designed into a corner later — not because they are next.
2. **A mock silently answers open questions.** §6 lists every live question in RFC-0000 §8 that this file has taken a position on. Each of those positions is invented and needs ratifying before it becomes code.
3. **Layout is the least load-bearing part.** The parts worth preserving are the component contracts in §4, because each encodes an invariant. Move the panels around freely.

---

## 2. Screen inventory

| # | Screen | Route | Increment | Read source | Governing sections |
|---|---|---|---|---|---|
| 1 | Findings | `/` | S (n=1) → V1.0 | `mv_finding` | RFC-0008 §4, §3, §6 (run health) |
| 2 | Explanation surface | `/recommendations/{id}` | S | `recommendation` + `alert.trace` + `evaluation_run` + `snapshot` + `mv_finding` | RFC-0008 §6 — block order taken literally |
| 3 | Allocation & Net Worth | `/allocation` | S (flat) → V1.0 | allocation + snapshot query modules | RFC-0007 §2, §4.1; ADR-0024; RFC-0009 §6 |
| 4 | Buckets & apportionment | `/buckets`, `/buckets/{id}/apportion` | V1.0 | `bucket_apportionment` resolved at `as_of` | ADR-0025, ADR-0001, ADR-0029 |
| 5 | Operations | `/operations` | V1.0 | `operation` | ADR-0026, ADR-0028; I-10 as revised by RFC-0005 §5.2 |
| 6 | Strategy | `/strategies/{id}` | V1.0 (skeleton uses YAML import) | `strategy_version` document | ADR-0017, ADR-0018, ADR-0009, ADR-0027, ADR-0030 |
| 7 | Run health | `/runs`, `/runs/{id}` | V1.0 | `evaluation_run` + `alert` | RFC-0006 §5, ADR-0016, RFC-0008 §8 |

Screens 1, 2 and 3 are the skeleton's three views. Everything on 4–7 is deferred.

### 2.1 Read path

Every screen above is **read-side only** except the two write actions in §3. Per RFC-0005 §2 and §5.3 that means: named SQL in `adapters/duckdb/queries/`, one module per view, returning flat rows for Jinja2. No aggregate is ever loaded to render a page. No inline SQL in a route handler.

### 2.2 Write actions in the mock

| Action | Use case | Screen | Note |
|---|---|---|---|
| Save apportionment | `ApportionBucket` | 4 | Appends effective-dated rows; supersedes, never updates |
| Freeze version | `DefineStrategy` | 6 | Produces a new immutable `strategy_version`; `change_note` required |

`RecordDecision` is drawn on screen 2 but disabled: it is V1.1. `ImportOperations` and `EvaluateStrategy` are CLI-first in V1.0.

---

## 3. HTMX decomposition

Per ADR-0007 the unit of work is a small server-rendered fragment behind one endpoint. Suggested split:

| Fragment | Endpoint | Trigger | Why a fragment |
|---|---|---|---|
| Trace (bindings + steps) | `GET /recommendations/{id}/trace` | `hx-trigger="revealed"` | The expensive part of screen 2 and the one most pages never need. RFC-0005 §5.4 calls this out by name. |
| Reconcile block | `GET /recommendations/{id}/reconcile` | lazy | Requires a recomputation; must not block first paint |
| Severity sparkline | `GET /findings/{key}/severity` | lazy | First read-side query that scans all runs for one finding (RFC-0008 §12.3) |
| Apportionment rows | `POST /buckets/{id}/apportion` | `hx-post` | Server-side Pydantic validation with inline errors, including the soft over-apportionment warning |
| Price fetch | `GET /prices/fetch` | polling fragment | ADR-0008: long fetches block a request; poll rather than add a worker |

Everything else renders with the page. Resist making the findings list a fragment — it is the page.

---

## 4. Component contracts

These five are the parts worth keeping. Each one exists because an invariant or ADR made it necessary.

### 4.1 The tolerance rail

A horizontal gauge spanning **−3 to +3 band-widths**, with the in-tolerance zone shaded, the target as a centre tick, and current position as a marker. Overflow beyond ±3 clamps with a caret.

```
position% = clamp(3, 97, 50 + (signed_severity / 6) × 100)
signed_severity = drift / effective_band
```

Why it works at all: `severity` is dimensionless (RFC-0007 §3.1), so **one gauge is legible across every asset class and both tolerance kinds**. A 6.00pp breach on a 40% ABSOLUTE target and a 0.5pp breach on a 2% RELATIVE target render comparably, which is the whole point of the severity contract. A gauge keyed to raw drift would not have this property, and building one would quietly discard RFC-0007 §3.1.

Reused unchanged on screens 1, 2, 3 and 6. If it appears in three places with three geometries, the contract has been lost.

### 4.2 The trace ladder

Bindings and steps rendered as an ordered derivation in monospace: each binding shows `name · value · resolvable source`; each step shows `# · op · operands · result`. Not prose.

This follows directly from RFC-0009 §4.1: the trace is *data* with ordered steps, precisely so the explanation can be mechanical rather than interpretive. Rendering it as a sentence would throw that away. Two rules:

- Every binding's `source` is a link where it resolves (strategy version, operation, price, reading). The chain **Recommendation → trace → Rule → StrategyVersion → your own change_note** must be walkable by clicking, not by querying. That chain *is* P7.
- Decimals render exactly as stored, as strings. Never format through a float.

### 4.3 The provenance bar

Sticky, always visible: portfolio · `as_of` · `run_id` · `mode` · `input_digest`.

Justification: under the correction model (ADR-0012) the same question has different true answers depending on which run you are reading, and screen 3's charts read the *as-recorded* series while screen 2's Reconcile block reads a *recomputation*. A user who cannot see which they are looking at will eventually be misled. Cheap insurance against the exact failure RFC-0009 §2.2 warns about.

### 4.4 Outcome chips and the SKIPPED discipline

Four outcomes, four distinct treatments; `SKIPPED` and `ERROR` are **never** styled as reassurance. The findings list carries a persistent skip banner whenever the last run skipped anything, and it says so in words: *skipping is not compliance*.

ADR-0016 identifies silent false reassurance as the failure mode most likely to mislead. A UI that renders "0 findings" over 20 skipped rules re-introduces it at the presentation layer, after the domain went to trouble to prevent it.

### 4.5 The three voices

| Face | Speaks for | Used in |
|---|---|---|
| IBM Plex Sans | the system | chrome, labels, observations |
| IBM Plex Mono | machine-verifiable values | every number, every id, every trace row |
| IBM Plex Serif | **the user's own words** | declared principles, `change_note`, assembled `rationale`, `userRationale` |

This is P3 and P6 made visible: a reader can always tell whether they are being shown the system's arithmetic or a restatement of their own prior declaration. Under ADR-0023 the rationale is assembled *from the user's frozen strategy* — the typography says so without a caption.

Cheap to keep, and the one aesthetic choice here that is load-bearing. Fonts must be **vendored as static files**, not CDN-linked: ADR-0007 promises no build step and ADR-0008's Local First means the app must render with no network. The mock uses a CDN link purely so a single file opens in a browser.

---

## 5. Specified vs invented

The honest split. Read this before treating anything in the mock as a requirement.

### 5.1 Specified by the corpus — implement as shown

| Element | Source |
|---|---|
| Nine blocks of screen 2, in that order | RFC-0008 §6 |
| List grouped on `finding_key` from `mv_finding`, never raw rows | RFC-0008 §4, §10 |
| `ORDER BY priority_rank DESC, severity DESC NULLS LAST, rule_id ASC` | RFC-0008 §3 |
| Rationale assembled from `StrategyVersion`; never per-rule prose | ADR-0023 |
| `suggestion_class` from the closed enum; no instrument/direction/size anywhere | E7, I-12 |
| Correlated findings shown separately, never collapsed | RFC-0008 §4.1 |
| Apportionment warns and does not block; `over_apportioned` is a finding | ADR-0025 |
| Negative UNASSIGNED residual is legal and is a deficit | ADR-0025 |
| Untargeted and unassigned capital stay in the denominator | RFC-0007 §4.1, ADR-0029 |
| Portfolio scope under mixed governance → `SKIPPED(heterogeneous_strategies)`, never an average | RFC-0007 §5 |
| Relative weights in a tree; effective target = product along path | ADR-0017, I-13 |
| ABSOLUTE = pp, RELATIVE = proportion of target; one tolerance per node in V1 | ADR-0018 |
| Freeze requires a `change_note`; Goal links do not trigger a freeze | RFC-0007 §7, ADR-0030 |
| Seven operation types; transfers as linked pairs; `CORRECTION` as a signed delta | ADR-0028 |
| Hypothetical runs produce zero recommendations | RFC-0008 §8 |
| Dismissal is a `Decision`, `userRationale` optional | ADR-0022 |
| Charts read the as-recorded series | RFC-0009 §6 |

### 5.2 Invented — no corpus basis, change freely

Screen count and grouping (Decide / Hold / Declare / Verify); the rail-and-marker geometry; the palette; the three-voice typography; sticky provenance bar; increment badges as a UI affordance; the copy of every observation and every empty/warning state; the greyed-out V1.1 slots; the "why is this here?" link from an untargeted class to its finding; interior nodes showing a roll-up with no band; showing UNASSIGNED as a pseudo-row in the by-Bucket table.

### 5.3 Deliberately absent — superseded, see §10

~~No net-worth hero number. P1 says the decisions are the product, so the landing screen is the findings list and net worth lives one click away on screen 3.~~ This was a reading of the Manifest, not a requirement, and the product owner overrode it on 2026-08-01 (task #12): see **ADR-L08** (`docs/plans/adr/ADR-L08-dashboard-landing-page.md`) for the decision and its reasoning. The owner picked variation C, «Il patrimonio annotato», and it is now a real route, **`/dashboard`** (`web/routes/dashboard.py`), sitting alongside `/` rather than replacing it. `/` (screen 1) is untouched: it stays the findings-first landing page this row describes, and P1 is unaffected — it is a scope ratification, not a landing-page rule. `/dashboard`'s own two guards (no open-findings count without its unevaluated count beside it; the composition reconciles on the net-worth tick, ADR-0029) are what keep it from being the false-reassurance dashboard this row originally warned against.

---

## 6. Open questions this mock has silently answered

Each of these is live in RFC-0000 §8. The mock took a position because it had to render *something*. **None of these positions is ratified.**

| Question | Owner | The mock's answer | Confidence |
|---|---|---|---|
| **6.1** Rationale localization / UI language | RFC-0008 §12.1 | English UI over English-authored strategy prose. The corpus source documents are Italian, so this is a real fork: an Italian UI over English `StrategyVersion` prose mixes languages mid-sentence, and RFC-0008 §12.1 says rationale templates are constrained by the answer. **Decide this before writing rationale templates**, not after. | Low — flagged, not resolved |
| **6.2** Cash-leg display collapsing | RFC-0011 §8.2 | Legs shown inline, indented, greyed, collapsible as a group; never a separate table. Keeps the ledger one uniform "one row = one account's side of one event" shape. | Medium |
| **6.3** Interior-node tolerances in the UI | RFC-0007 §12.3 | V1.0 shows interior nodes as roll-up value + weight with an explicit "no band" marker, so the absence is visible rather than ambiguous. | Medium |
| **6.4** Chart library | RFC-0005 §10.4 | Sidestepped. The mock's two charts are CSS bars with no library at all, which satisfies "V1.0, no dependency". Enough for a sparkline and a snapshot series; not enough for anything V1.2 wants. | Medium — it is a deferral, not a decision |
| **6.5** `over_apportioned` warning in the CLI importer | RFC-0011 §8.4 | Not addressed. The mock places the soft warning in the apportionment UI only, which is what ADR-0025 specifies; the CLI half is untouched. | n/a |
| **6.6** Suppression visibility ("why is this hidden?") | RFC-0008 §11 | Not addressed — needs an answer in V1.1 when `Decision` capture lands, or derived visibility becomes the system's one unexplainable behaviour. The greyed section on screen 1 is a placeholder, not a design. | None |
| **6.7** `REJECTED` vs `ACKNOWLEDGED` | R-1 | Follows R-1: the mock's capture form offers acted / considered-not-acting / revisit-later. No `REJECTED` affordance. | High — matches the resolution |

---

## 7. Gaps found in the corpus while building this

Three places where rendering a screen required an answer the corpus does not contain. These are reported as findings, not decided.

### 7.1 The cash leg has no `type`, and every obvious choice violates the DDL — **blocking**

ADR-0026 specifies the *amount* of an auto-emitted cash leg (`BUY` → `−(q × p) − fees`, `SELL` → `+(q × p) − fees`, dividends and coupons positive) and specifies `cash_leg_of`. It does not say what value goes in `operation.type` for the leg row.

The natural choice — mirror the parent's type — is invalid against ADR-0028's own revised checks:

```sql
CHECK (type <> 'BUY'  OR quantity > 0)   -- a BUY's cash leg is negative
CHECK (type <> 'SELL' OR quantity < 0)   -- a SELL's cash leg is positive
```

So every BUY and every SELL cash leg fails a CHECK constraint. `DIVIDEND` and `COUPON` legs are unaffected, having no sign check. Three ways out:

1. **Exempt legs from sign checks**, exactly as `CORRECTION` is exempt: `CHECK (cash_leg_of IS NOT NULL OR type <> 'BUY' OR quantity > 0)`, and likewise for SELL. Keeps the seven-value enum, so **E10 is unchanged and no further product ratification is needed**. The leg's type still records *why* the cash moved, which the Tax Engine will want. Cheapest and least invasive — this is the recommendation.
2. **Type legs as `TRANSFER_IN` / `TRANSFER_OUT`.** Signs then satisfy the existing checks, but it overloads transfer semantics, and `transfer_pair_id` and `cash_leg_of` would both be meaningful on the same row for different reasons. Rejected: it makes `mv_holding` and any transfer-pair integrity check ambiguous.
3. **Add `CASH_IN` / `CASH_OUT`.** Cleanest semantically, but widens E10 from seven values to nine and re-opens a ratification RFC-0011 §8.1 wants closed *now*.

This blocks **skeleton task 3** (the `CORRECTION` × `transfer_pair_id` × `cash_leg_of` truth table, RFC-0011 §8.3) — that truth table cannot be written without it. Needs an ADR-0032.

### 7.2 Three V1.0 condition kinds have no declared `severity` — **blocking the build, literally**

RFC-0006 §12 makes the registry completeness test **fail the build** unless every registered kind declares a severity formula or an explicit `null`. Formulas exist for `drift_outside_tolerance` (RFC-0007 §3.1), `untargeted_allocation` (RFC-0007 §4.2) and `over_apportioned` (ADR-0025). Three V1.0 kinds have none:

| Kind | Mock assumes | Note |
|---|---|---|
| `unassigned_residual_above` | `residual_weight / threshold_weight` | By analogy with `untargeted_allocation`. Plausible, undeclared. |
| `bucket_below_target_value` | `null` | The mock uses this deliberately, because it is the only way anything exercises `NULLS LAST` in the ordering contract. A shortfall ratio would work equally well and would be more informative. |
| `allocation_absent` | not exercised | Probably `null`, or `1.0` constant. |

Each needs one line in its registration. Trivial to fix, but the build fails until it is done, so it belongs in the V1.0 opening batch rather than being discovered mid-sprint.

### 7.3 Bucket values can exceed the capital that exists

With a negative UNASSIGNED residual (legal per ADR-0025), Σ bucket values > Σ holdings, while Σ buckets + UNASSIGNED = Σ holdings exactly. So a by-Bucket table showing only buckets adds up to more than net worth. The corpus permits this state and says nothing about displaying it.

The mock's answer: show UNASSIGNED as a signed pseudo-row in the same table, so the column always totals to net worth, and let it go negative in red. Invented, and worth a second opinion — the alternative (a footnote) makes the arithmetic invisible, which seems worse.

---

## 8. Fixture dataset

The mock's numbers reconcile from one holdings ledger, so they can be lifted straight into `demo/` and `demo/expected/` (RFC-0005 §8.3). **The canonical example from RFC-0005 §8.3 / RFC-0008 §5.1 is preserved exactly**: Equity/Developed 34.00% against a 40.00% target, ±2.00pp ABSOLUTE, drift −6.00pp, `severity = 3.00`, drift value −€3,240.00.

### 8.1 Assets and prices at `as_of = 2026-07-24`

| Asset | Class | Price | Held (fold) |
|---|---|---|---|
| `IE00B4L5Y983` iShares Core MSCI World | `EQUITY_DEVELOPED` | 109.2857 | 251.0000 |
| `IE00B3RBWM25` Vanguard FTSE All-World | `EQUITY_GLOBAL` | 154.6364 | 46.0000 |
| `LU1681045453` Amundi MSCI EM | `EQUITY_EMERGING` | 21.3750 | 340.0000 |
| `IT0005494239` BTP 3.85% 2035 | `BOND_GOV_EUR` | 1.0044 | 21,600.0000 |
| `LU0478205379` Xtrackers EUR Corp | `BOND_CORP_IG` | 15.0000 | 423.0000 |
| `cash:acct-trd` Conto trading | `CASH` | 1.0000 | 6,320.0000 |
| `cash:acct-cc` Conto corrente | `CASH` | 1.0000 | 9,400.0000 |
| `dep:banca-x` Conto deposito 24m | `CASH` | 1.0000 | 15,000.0000 |
| `IT0005482309` BTP short 2028 | `BOND_GOV_EUR` | 0.9880 | 7,100.0000 |

CASH assets are valued at par and need no price series (ADR-0026).

### 8.2 Apportionment (units)

| Asset | Pension | Children | Emergency | Personal | Σ | Held | Residual |
|---|---|---|---|---|---|---|---|
| `IE00B4L5Y983` | 168 | 76 | — | — | 244 | 251 | +7 |
| `IE00B3RBWM25` | 44 | 9 | — | — | **53** | **46** | **−7** ← `over_apportioned` |
| `LU1681045453` | 240 | 100 | — | — | 340 | 340 | 0 |
| `IT0005494239` | 15,000 | 6,600 | — | — | 21,600 | 21,600 | 0 |
| `LU0478205379` | 288 | 135 | — | — | 423 | 423 | 0 |
| `cash:acct-trd` | 4,320 | 2,000 | — | — | 6,320 | 6,320 | 0 |
| `dep:banca-x` | — | — | 11,000 | — | 11,000 | 15,000 | +4,000 |
| `IT0005482309` | — | — | 7,100 | — | 7,100 | 7,100 | 0 |
| `cash:acct-cc` | — | — | — | — | 0 | 9,400 | +9,400 |

### 8.3 Derived totals

```
Pension     54,000.00      Children  22,488.98     Emergency  18,014.80
Personal         0.00      UNASSIGNED 13,082.55  (12.16%, threshold 10%)
NET WORTH  107,586.33  =  buckets + UNASSIGNED, exactly
prior snapshot 2026-06-26  104,936.33   →  +2,650.00  (+2.53%)
```

### 8.4 Strategies

**Long-term growth v3** (frozen 2026-03-12, horizon 20y) governs Pension, Children, Personal.

```
root
├── EQUITY  0.5000
│   ├── DEVELOPED 0.8000  → 40.00%   ABSOLUTE ±2.00pp
│   └── EMERGING  0.2000  → 10.00%   RELATIVE 0.25  → ±2.50pp
├── BONDS   0.4000
│   ├── GOV_EUR   0.7500  → 30.00%   ABSOLUTE ±2.00pp
│   └── CORP_IG   0.2500  → 10.00%   RELATIVE 0.25  → ±2.50pp
└── CASH    0.1000        → 10.00%   ABSOLUTE ±3.00pp
```

Children of every node sum to 1.0000 (I-13). 11 rules: 7 Bucket-scope, 1 Bucket-specific, 3 portfolio-scope.

**Capital preservation v1** (frozen 2026-02-04) governs Emergency: `CASH` 70% ±5.00pp ABSOLUTE, `BOND_GOV_EUR` 30% ±5.00pp ABSOLUTE, plus `bucket_below_target_value(€24,000.00)`. 3 rules.

Two strategies over one portfolio is deliberate: it is what makes portfolio-scope drift `SKIPPED(heterogeneous_strategies)` reachable in the fixture.

### 8.5 The run — `run:0f31a9c4`, `mode = ACTUAL`

28 evaluations = (7 Bucket-scope rules × 3 governed Buckets) + 1 Bucket-specific + 3 portfolio-scope + 3 Capital-preservation.

| Outcome | n | Detail |
|---|---|---|
| `FIRED` | 10 | Pension 3 · Children 2 · Emergency 3 · portfolio 2 |
| `NOT_FIRED` | 9 | Pension 4 · Children 5 |
| `SKIPPED` | 8 | 7 × `zero_portfolio_value` (Personal is empty) · 1 × `heterogeneous_strategies` (portfolio scope) |
| `ERROR` | 1 | `currency_mismatch` — a EUR bucket compared against a USD target; `Money` raises rather than converting (I-15) |

Ordered findings, demonstrating all three clauses of the RFC-0008 §3 sort:

| # | Priority | Severity | Kind · scope |
|---|---|---|---|
| 1 | CRITICAL | *null* | `bucket_below_target_value` · Emergency |
| 2 | HIGH | 3.00 | `drift_outside_tolerance` EQ/DEV · Pension ← canonical |
| 3 | HIGH | 2.52 | `untargeted_allocation` · Pension |
| 4 | HIGH | 1.79 | `drift_outside_tolerance` CASH · Emergency `rule:3d02` |
| 5 | HIGH | 1.79 | `drift_outside_tolerance` GOV_EUR · Emergency `rule:6b7f` |
| 6 | HIGH | 1.53 | `drift_outside_tolerance` EQ/DEV · Children |
| 7 | HIGH | 1.24 | `untargeted_allocation` · Children |
| 8 | HIGH | 1.05 | `drift_outside_tolerance` GOV_EUR · Pension |
| 9 | HIGH | 0.15 | `over_apportioned` · portfolio |
| 10 | MEDIUM | 1.22 | `unassigned_residual_above` · portfolio |

Rows 4 and 5 tie on severity and are separated only by `rule_id ASC`. Row 10 outranks row 9 on severity and still sorts below it, because the authored priority band dominates. Row 1 sorts first on band alone with a null severity. **A fixture that does not exercise all three of these is not testing the ordering contract.**

### 8.6 The narrative the fixture encodes

One cause, three findings: on 19 Jul 2026 `asset:IE00B3RBWM25` was reclassified `EQUITY_DEVELOPED → EQUITY_GLOBAL`. Under the correction model this rewrites history (ADR-0012), so:

- `EQUITY_GLOBAL` becomes untargeted capital that stays in the denominator (RFC-0007 §4.1) → findings 3 and 7;
- every targeted class is diluted → findings 2, 6 and 8 read as under-allocation;
- recomputing the finding's May occurrence now diverges from its stored trace → the Reconcile block on screen 2 (RFC-0009 §2.2).

Separately, a `SELL` of 14 units on 15 Jul dropped the holding below the standing apportionment → finding 9, and a negative UNASSIGNED residual.

This is not decoration. It is the smallest fixture that exercises the dilution trap, the Reconcile view, `over_apportioned`, a negative residual, all four outcomes, and all three ordering clauses at once. Building `demo/` from something simpler leaves most of the corpus's hard cases untested.

---

## 9. Suggested build order

1. **Skeleton, three views** (RFC-0005 §8 as corrected by RFC-0011 ERR-7): allocation (depth-1 tree), findings list at n=1 against `mv_finding`, trace detail as an HTMX fragment. Screens 1–3 of the mock, stripped to one rule and one recommendation.
2. **Before anything else:** the §7.2 severity declarations (the build fails without them) and an ADR resolving §7.1 (skeleton task 3 is blocked without it).
3. Screen 7 (run health) next, not last. It is cheap, and it is the only thing that makes a broken configuration visible while you are still configuring.
4. Screens 4 and 5, then 6. Screen 6 comes last of the V1.0 set on RFC-0005 §8's own reasoning: a form-based strategy editor built before the Rule representation settles is the most speculative UI in the product.
5. Decide §6.1 (UI language) before writing any rationale template.

---

## 10. Maintenance

This document has no authority and should not accumulate any. If a position taken here gets ratified, it moves into a real RFC (RFC-0012+, per RFC-0000 §10.3) and the row here becomes a pointer. If the mock and the corpus drift apart, **delete the mock** rather than let it read as a specification.
