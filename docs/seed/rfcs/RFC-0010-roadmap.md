# RFC-0010 — Roadmap

| | |
|---|---|
| **Status** | Proposed · **revision v0.3** |
| **Track** | Technical (0004–0012) |
| **Depends on** | RFC-0004 through RFC-0009 |
| **Supersedes** | RFC-0010 v0.1 (integrated, not amended — see §10) |
| **Integrates** | RFC-0011 §5 (Roadmap Deltas), RFC-0011 §6 (Ratification Queue) |
| **Amends** | RFC-0001 §Roadmap (see §4) |
| **Companion** | RFC-0012 — the domain and schema decisions this roadmap sequences |
| **Language** | English. Ubiquitous Language verbatim per RFC-0003. |

---

## 1. Context

RFC-0001 sequences V1 as Cash Flow, Portfolio, Dashboard, Strategy; V2 as Rule Engine, Forecast, Planning; V3 as Knowledge Base and AI Assistant.

Three decisions taken during the technical track break that sequence:

- **The Rule Engine moves to V1** (your decision). RFC-0001's V1 already contains Strategy and Dashboard, and neither can answer *"sto rispettando la mia strategia?"* without rule evaluation. Manifest P3 is unimplementable in a V1 that has no Rule Engine, so the original split was internally inconsistent.
- **Cash Flow moves to V1.1** (ADR-0024, argued in §4.1). This is the more contentious change and it rests on a finding: **Net Worth does not require Cash Flow.**
- **V1 is subdivided into four point releases** (ADR-0032, new in this revision). v0.1 used the labels `S`, `V1.0`, `V1.1`, `V1.2` without ever declaring what earns a point release, which left every re-sequencing argument to be conducted about a container with no definition. §2.1 fixes that.

The anti-goals hold: V2 and V3 are sketched only far enough to confirm nothing here forecloses them.

### 1.1 Why this is a revision rather than an amendment

RFC-0000 §10 rule 3 requires corrections to arrive as new amending documents, never in-place edits, so that every `RFC-000X §Y` reference stays stable. This document deliberately breaks that rule once, and the reasoning should be on the record.

A roadmap is the one document in the corpus whose *whole value is being current*. RFC-0011 §5 had already made seven amendments to it, and this revision adds three increments and eleven deferral rows. A reader following the amendment chain would need three documents open to learn what V1.2 contains — which is precisely the failure §2.2 exists to prevent.

The audit properties are preserved by other means: **§10 tabulates every change from v0.1**, and **all v0.1 section numbers keep their subjects**, so `RFC-0010 §3`, `§4.1`, `§5`, `§6.2`, and `§7` all still resolve. The one visible cost is §6.4 appearing after §6.3 despite being a first-order risk, because §6.2 is referenced externally as the kill criteria.

**This exception applies to RFC-0010 only.** Every other document in the corpus keeps the amend-never-edit convention, and RFC-0012 is written as an amending document accordingly.

---

## 2. Sequencing Principle

Each increment is a shippable vertical slice that newly answers **one more question from RFC-0001's own list**. That list is the product's definition of usefulness, so it is the right measure of increment value — and it prevents the classic failure of shipping infrastructure that answers nothing.

| RFC-0001 question | Answered by |
|---|---|
| *Sto rispettando la mia strategia?* | **V1.0** |
| *Quanto è cambiato il mio patrimonio?* | **V1.0** (Net Worth), deepened in **V1.3** (return series) |
| *Cosa dovrei fare oggi?* | **V1.0** (findings) → **V1.1** (Decision loop closed) |
| *Come sta andando il mese?* | **V1.1** (Cash Flow) |
| *Quali rischi sto assumendo?* | **V1.2** (concentration by axis, indicators, bonds) → **V1.3** (drawdown, volatility) |
| *Cosa succederà nei prossimi mesi?* | **V2** (Forecast) |

```mermaid
flowchart LR
    S["S — Skeleton<br/>spine proven"] --> V10["V1.0 — Strategy compliance<br/>+ Net Worth"]
    V10 --> V11["V1.1 — Cash Flow<br/>+ Decision loop + Goal"]
    V11 --> V12["V1.2 — Risk, classification<br/>axes, integrity"]
    V12 --> V13["V1.3 — Measurement<br/>return series, drawdown"]
    V13 --> V2["V2 — Forecast, Planning,<br/>scheduling, notification"]
    V2 --> V3["V3 — Knowledge,<br/>AI assistant"]
```

Relative sizes in §3 are S/M/L against the 14-task skeleton in RFC-0005 §8.4 as the unit. **No calendar estimates** — I have no basis for your velocity, and a fabricated date would be the one number in this corpus with no provenance.

### 2.1 What earns a point release versus a major (ADR-0032)

**Increments are classified by the epistemic character of the output they add, not by size or by area.**

| Class | Output is | Replay guarantee | Increments |
|---|---|---|---|
| **A — Observation** | Deterministic arithmetic over recorded facts | Full: every finding replays from its trace (RFC-0009 §4.1) | S, V1.0–V1.3 |
| **B — Projection** | Dependent on estimated parameters or assumed distributions | Partial: replay reproduces the *comparison*, not the derivation | V2 |
| **C — Generation** | Authored by a model rather than derived | None: output is not reproducible from inputs | V3 |

- A **major** increment introduces a new class.
- A **point release** adds capability within the current class.
- **`S`** ships no user-facing value; its only job is to prove a contract.

The criterion is derived from the Manifest rather than invented: P3 (explainable) and P7 (reconstructable) are exactly what weakens as you move down the table, so "which class is this?" and "what does the product still promise?" are the same question.

Four consequences make it load-bearing rather than decorative:

1. **It places VaR on principle instead of on taste.** A Monte Carlo VaR is a small code change — a derived `Bound` and one condition kind, following RFC-0007 §8.1's existing pattern exactly. It is nonetheless **Class B**, because its number depends on an assumed distribution. Implementation size and increment class are independent, and conflating them is how a product's promises erode one convenient feature at a time.
2. **It retro-explains why the Rule Engine had to move to V1.0.** Without it, V1 produces no Class A findings at all — only stored state. RFC-0001's original split put the entire epistemic payload in V2.
3. **It imposes a UI requirement, not just a labelling one.** A Class B finding must be distinguishable from a Class A finding at the point of reading. See §6.4.
4. **It bounds `.x` growth.** When a proposed point release would introduce a new class, it is a major. `V1.9` is not reachable by adding features; it is reachable only by adding Class A features.

The criterion also classifies the existing corpus without special pleading, which is the real test of it. `indicator_percentile` is Class A (arithmetic over recorded readings). Amortized cost is Class A (arithmetic over a schedule). Realized volatility and max drawdown are Class A (arithmetic over a recorded series). Sharpe is Class A, since a risk-free rate is an observable `MarketIndicator` and annualization is a declared convention rather than an estimate. VaR is the first Class B condition kind, and Forecast is the first Class B engine.

### 2.2 Increment membership has exactly one home

**§3's `In` tables are the sole normative statement of what ships when.** Every other appearance of an increment label anywhere in the corpus is descriptive and must reference rather than restate.

This rule exists because the labels had already drifted. RFC-0006 §3's catalog marked `indicator_threshold` and `concentration_above` as V1 while v0.1 §3 placed them in V1.2; ERR-3 corrected the catalog and settled precedence — *"RFC-0010 is authoritative for sequencing; the catalog column is descriptive only."* With five copies in circulation (§7 here, RFC-0000 §9, RFC-0006 §3, UX-0001, and the mock's `data-i` badges), one correction is a pattern rather than an accident.

Consequently **§7 is derived from §3**, not a parallel source. If the two disagree, §3 wins and §7 is regenerated.

---

## 3. The Increments

### S — Walking Skeleton  ·  size: 1 unit

Fully specified in RFC-0005 §8. One `Asset` pair, ~10 `Operation`s, one `Bucket`, one `Strategy`/`StrategyVersion`, one `Rule` (`drift_outside_tolerance`), one explainable `Recommendation`, three web views.

`EvaluationRun` is **in** scope — the single `evaluate` necessarily writes one row — so RFC-0005 §8.4 task 10 reads "repositories for the eight aggregates in scope" (ERR-7).

**Done when** `uv run financeos seed demo && evaluate && serve` renders one Recommendation whose trace matches `demo/expected/` (RFC-0005 §8.3).

**Defers** everything else. Its only job is to prove the spine and the replay contract before anything is built on them.

---

### V1.0 — Strategy compliance and Net Worth  ·  size: M–L

**The first genuinely useful release.** You can run your real portfolio through it weekly and get findings you would act on.

**In**

| Area | Content |
|---|---|
| Ingestion | CSV importers for broker Operations; `HttpPriceProvider` (EOD, on demand) alongside `SeedFilePriceProvider` for tests; `TRANSFER_IN`/`TRANSFER_OUT`/`CORRECTION` support (ADR-0028) |
| Portfolio | Multiple `Asset`s, `Bucket`s, apportionment UI, `UNASSIGNED` residual (signed — it may go negative) |
| Cash as Asset | Liquidity and deposit accounts as `Asset`s with a `CASH` class — this is what delivers Net Worth without Cash Flow (§4.1) |
| Cash legs | `Account` as reference entity carrying `cash_asset_id`; paired-Operation writer; `cash_leg_of` (ADR-0026) |
| Market — price half | `price` table, `PriceProvider` port, `price_latest()` / `price_as_known_at()`, `PriceView` contract (ADR-0031) |
| Strategy | Authoring UI: target tree (depth 1–2), tolerances, rule editor over the V1.0 catalog |
| Rules | `drift_outside_tolerance`, `allocation_absent`, `untargeted_allocation`, `unassigned_residual_above`, `bucket_below_target_value`, `over_apportioned` (ADR-0025) |
| Decision context | `Alert` (four outcomes), `Recommendation`, `mv_finding`, run health panel, Reconcile block |
| Reporting | Allocation dashboard, Net Worth, `Snapshot` on every evaluate, drift-over-time from Snapshots |
| Run hygiene | `evaluation_run.mode` and the mandatory `mode = 'ACTUAL'` read-side predicate — required from day one even though the candidate *flows* ship in V1.2 (§3 note below) |
| Data | `financeos export --authored` (RFC-0009 §7.1) — **required before migration 002** |
| UI (data I/O) | Web routes wiring `import_operations`, `import_strategy`, `export_authored` into the browser — CSV/YAML upload, bundle download. No new domain aggregate or write use case; apportionment and Strategy-authoring remain V1.0's only entity-*editing* UI (ADR-0037) |

**Defers** Cash Flow (`Transaction`, `Category`, run rate), `Decision` capture, `MarketIndicator`, bonds/amortized cost, Forecast, Tax, Knowledge, `Goal`, multi-currency, tamper-evidence, interior-node tolerances, rebalancing calculator, classification axes, candidate flows, entity management UI (create/edit forms for `Portfolio`/`Bucket`/`Account`/`Asset`, ADR-0037).

**Done when** you have imported your actual holdings, authored your actual Strategy, and the findings it produces are ones you recognize as true and would act on.

> That last criterion is deliberately subjective. A technical done-when ("all rules evaluate") is satisfiable by a system that says nothing useful.

*Note on `mode`.* UX-0001 and the mock badge the run-history surface `V1.0`, which implies candidate evaluation ships there. It does not. What ships in V1.0 is the `mode` column and the exclusion discipline, because RFC-0009 requires the predicate in every read-side query from the first run. The candidate-asset and candidate-version *flows* are V1.2, and require RFC-0012 ADR-0035.

---

### V1.1 — Cash Flow, the Decision loop, and Goal  ·  size: M

**In**

| Area | Content |
|---|---|
| Cash Flow | `Account` promoted to full aggregate, `Transaction`, `Category` hierarchy, CSV import, categorization rules, Cash Flow Engine (run rate, by-category) |
| Dedup | `Transaction` ↔ cash-leg reconciliation at import, shape fixed by ADR-0026 |
| Cross-context rules | `emergency_cover_below_months`, `savings_rate_below` |
| Decision loop | `Decision` capture, `informedBy`/`enactedBy` linking, dismissal as `ACKNOWLEDGED`/`DEFERRED`, derived visibility |
| **Goal — object only** | `goal` table (ERR-11), `strategy_goal` link (ADR-0030), `goal_revision_audit`, CRUD, display against Buckets. **No rule reads a Goal in this increment.** (RFC-0012 ADR-0036) |
| Apportionment defaults | Per-`Bucket` default rules so new Operations do not all land `UNASSIGNED` (§6.1) |
| Reporting | Monthly view, income/expense series |
| **Entity management UI** | **Create/edit forms for `Portfolio`, `Bucket`, `Account`, `Asset` in the browser — the ongoing path for structural changes after initial fixture-seed setup, replacing direct CSV/DB editing for anything beyond apportionment and Strategy authoring. Needs new write-side use cases: none exist pre-V1.1 beyond `ApportionBucket` and Strategy-freeze (ADR-0037)** |

**Defers** Forecast, Tax, multi-currency, bonds, `REJECTED` UI, Decision templates, `goal_funding_gap`, classification axes.

**Done when** *"come sta andando il mese?"* is answerable from the app rather than from a spreadsheet, and at least one real `Decision` is recorded with its enacting `Operation`s linked.

`emergency_cover_below_months` is the increment's real payoff: the first rule that crosses two bounded contexts, and the first finding no single-purpose tool could produce.

**Why `Goal` moved here from V2.** v0.1 deferred `Goal` wholesale to V2 because `goal_funding_gap` needs Forecast. That conflated three separable pieces, and the object is the cheapest of them — CRUD, no engine, no rule, no new fact. Two arguments carry it:

- **V1.0 already contains a Goal wearing a disguise.** *Capital preservation v1* governs Emergency with `bucket_below_target_value(€24,000.00)` at CRITICAL priority. That is a target value with an implied date and purpose, living as a magic number in a rule's `params` with nowhere to record why. Because it sits inside a frozen `StrategyVersion`, raising the floor to €28,000 mints a strategy version, and there is no way to mark it achieved. That is bookkeeping polluting the lineage `change_note` exists to narrate — the exact harm ADR-0030 was written to prevent, arriving through a door ADR-0030 did not close.
- **A funding gap next to a known savings rate is a live number.** Cash Flow arrives in this increment, which makes V1.1 the first increment where a Goal is worth looking at rather than merely stored.

**Cost:** E9 (`objective` / `Goal` split) escalates from "blocks V2" to **"blocks V1.1"**. That is the real price of this move and it is a scheduling risk, not a technical one — see §5.

**Why entity management UI is here, not V1.0 (ADR-0037).** §3 V1.0 never specified it — only the apportionment UI and Strategy-authoring UI are in scope there, and both existed as forms before this revision. A product-owner request asked for full create/edit UI plus import/export buttons for `Portfolio`, `Bucket`, `Account`, and `Asset`. Import/Export UI was in reach — it wires three use cases (`import_operations`, `import_strategy`, `export_authored`) that already existed for the CLI, so no new domain logic. Entity CRUD was not: no write-side use case exists today for `Portfolio`, `Bucket`, `Account`, or `Asset` creation (`ApportionBucket` mutates an existing Bucket's apportionment; Strategy-freeze mutates an existing Strategy's version — neither creates the entities themselves), and `Account` itself has no aggregate yet, only a reference-entity DTO (ADR-0026). Building it in V1.0 would mean improvising the write-side contract for four entities in one pass, ungoverned by any RFC. Landing it in V1.1 instead pairs it with `Account`'s already-scheduled promotion to a full aggregate.

---

### V1.2 — Risk, classification axes, and integrity  ·  size: M

**In**

| Area | Content |
|---|---|
| Market — indicator half | `MarketIndicator`, `IndicatorReading` (bitemporal), Market Engine fetch, `IndicatorView`, `indicator_threshold`, `indicator_percentile` |
| **Classification axes** | Orthogonal axes on `Asset` — `ASSET_CLASS`, `COUNTRY`, `SECTOR`, `CURRENCY_EXPOSURE`; per-axis `AllocationBreakdown`; per-axis `asset_classification_audit` (RFC-0012 ADR-0033) |
| **Risk rules** | `concentration_above(axis, threshold_weight)` — generalized at birth rather than shipped single-axis and rewritten |
| **Coverage rules** | `classification_unknown_above(axis, threshold_weight)` — reports the share of a scope whose look-through exposure is unknown. Without it, incomplete provider data reads as *low* concentration everywhere (RFC-0012 ADR-0033) |
| **Goal rules** | `goal_funding_gap(goal_id, threshold)` — static: apportioned value of linked Buckets against `target_value`. Class A arithmetic; no projection (RFC-0012 ADR-0036) |
| **Candidate flows** | Candidate-asset evaluation via `ScenarioOperation` (RFC-0006 §6.2) and candidate-`StrategyVersion` evaluation via draft-lineage versions (RFC-0012 ADR-0035) |
| Bonds | `valuation_basis`, `maturity_date`, `redemption_value`, amortized cost (ADR-0019) |
| Tolerances | `CompositeTolerance` (5/25), interior-node tolerances, optional asymmetric bands |
| Integrity | Hash chain over append-only tables (RFC-0005 §10.3), restoring what DuckDB's lack of per-table grants removed |
| Tools | Rebalancing calculator — classification-value amounts only, read-side, never a `Recommendation` field (RFC-0008 §5.4) |

**Defers** the valuation and return series and everything downstream of it, Forecast, Planning, Tax, Knowledge, scheduling, notification, per-asset metric conditions, VaR.

**Done when** *"quali rischi sto assumendo?"* is answerable **structurally** — concentration by country and sector, not just by asset class — and bond positions stop producing drift you have no intention of acting on.

**On targets and axes.** Axes ship **read-only for targeting** in V1.2: you get concentration findings on country and sector, but `TargetAllocation` still keys on the `ASSET_CLASS` axis alone. Setting targets on a second axis raises a question this corpus has not answered — two axes with independent target trees can be jointly unsatisfiable, and there is no defined resolution. Deferred to V1.3+ behind the kill criterion in §6.2.

---

### V1.3 — Measurement  ·  size: S

The bridge increment. Small, and it unlocks both the metrics you asked for and V2's Forecast.

**In**

| Area | Content |
|---|---|
| **Valuation series** | `mv_valuation_series(scope, date) → value`, computed from `price` × `operation`, on a declared date grid (RFC-0012 ADR-0034) |
| **Return series** | Time-weighted returns, neutralizing contributions and withdrawals. Made possible by ADR-0026's cash legs and ADR-0028's `TRANSFER_IN`/`TRANSFER_OUT` split, which are what distinguish capital *entering* the portfolio from capital *moving within* it |
| **Metric facts** | Strategy Engine derives `max_drawdown`, `realized_volatility`, and `sharpe_ratio` as single `Bound`s with `source={kind:"derived", …}` — the pattern RFC-0007 §8.1 already established for `indicator_percentile` |
| **Metric conditions** | `max_drawdown_below`, `realized_volatility_above`, `sharpe_ratio_below` — scoped to `Bucket` or `Portfolio` |
| Reporting | Net-worth and return charts over the series, annotated at reclassification dates per RFC-0009 §6 |

**Defers** per-asset metric conditions (gated on E13), VaR and every Class B metric, multi-axis targeting.

**Done when** a drawdown or volatility finding has appeared, you understood it without opening the trace, and you can state what it would take to make it stop firing.

**Why this is a separate increment rather than part of V1.2.** This closes v0.1 §9 question 4 ("should V1.2 be split?") — yes, but not along the axis that question anticipated. Risk rules and integrity work are not the separable pair; **measurement** is. Everything in V1.2 evaluates a *position* against a *target*. Everything here evaluates a *history*, which requires a series that does not exist yet and a return convention that has to be chosen and defended. Bundling them would have made V1.2 the increment that never ships.

**Two things to notice about the series, because both correct earlier reasoning in this corpus.**

RFC-0009 §6 decided historical series render as-recorded and are never recomputed. That decision does **not** block this, and the reason is in its own justification: the harm named there is recomputation *under current classifications*, and the mechanism is reclassification. But `price × quantity` is classification-independent — reclassifying an `Asset` moves value between allocation buckets and never changes total value. So §6 governs drift and allocation series, and a value series computed from prices is outside its scope. Stated explicitly because the opposite reading is the obvious one.

`Snapshot` is **not** the series source, despite being the only existing time series. Its cadence is every `evaluate` — user-triggered and irregular, since ADR-0008 has no scheduler — and `total_value` includes deposits and withdrawals. A Sharpe ratio over irregularly spaced, contribution-contaminated observations is not a Sharpe ratio; it is a number with a Greek letter attached. `Snapshot` remains the as-recorded checkpoint it was designed to be.

---

### V2 — Forecast, Planning, scheduling  ·  size: L

The first **Class B** increment (§2.1). Sketched only to confirm nothing is foreclosed.

- **Forecast Engine** consumes the V1.3 return series and Cash Flow run rate. Already sited; no architectural change.
- **Planning** — `goal_funding_gap` gains its projective form: *on track by `target_date` at your current savings rate*. This is the piece of `Goal` that genuinely needed V2.
- **VaR** — Monte Carlo or parametric, with **model assumptions frozen in `StrategyVersion`** alongside tolerances: distribution family, lookback window, horizon, confidence level, and RNG seed. Two properties follow. ADR-0023's rationale assembly can then render *"at 99% over 10 days, under a Student-t fit to three years of daily returns, as you specified in v4"* — the assumption becomes visible, versioned and diffable rather than a hidden engine default. And changing your mind about the distribution correctly mints a new version with a `change_note`, because it *is* a change in strategy thinking. Extension E14.
- **Determinism.** RFC-0006 §11's determinism test requires byte-identical traces for an identical `FactSet`, and `input_digest` is a SHA-256 over the canonical form. A stochastic simulation satisfies this only if the seed is derived deterministically from the inputs and recorded. One line, but it must be decided rather than discovered when the build goes red.
- **Scheduled ingestion** via ADR-0008's escape hatch: a fetcher writing a Parquet staging directory it owns exclusively, imported on app open. **Never two writers on one DuckDB file.**
- **Notification** — the first genuinely new architectural requirement, and the first reason a `CRITICAL` finding would need to reach you before you open the app.
- **Tax Engine** — estimate only, `OperationView` contract already defined (RFC-0004 §4.1).

**Not foreclosed by anything in V1**, confirmed: Snapshots exist and are append-only; the return series arrives in V1.3; the ingestion escape hatch is designed; `Goal` is a real object from V1.1; the Tax contract is specified; `StrategyVersion` can carry model assumptions because it already carries tolerances.

---

### V3 — Knowledge and AI  ·  size: L

The first **Class C** increment.

- **Knowledge context** links documents to Strategies and Decisions. `StrategyVersion.change_note` (RFC-0007 §7) is already the seed of this: the only place your reasoning is recorded.
- **AI assistant** — per Vision, *"l'AI non prenderà decisioni, userà il dominio esistente."* ADR-0023 constrains this precisely: the assistant may **read** traces, rationales, and change notes; it must **not author** `rationale`, because a generated explanation cannot be replayed from a trace and an unreproducible explanation is not one.
- I-12 continues to hold structurally, so no assistant surface can emit an instrument-level prescription regardless of prompt.

The one architectural pressure V3 creates: local LLM inference alongside a single-writer DuckDB process. Read-only access is fine; anything that writes needs the same staging discipline as V2 ingestion.

---

## 4. Divergence from RFC-0001 — Amendment Request

| Item | RFC-0001 | Here | Reason |
|---|---|---|---|
| Rule Engine | V2 | **V1.0** | P3 and the Strategy pillar are unimplementable without it. Your decision. |
| Cash Flow | V1 | **V1.1** | ADR-0024, §4.1. |
| Dashboard | V1 | V1.0 (allocation, Net Worth) → V1.1 (monthly) → V1.3 (return series) | Split by data dependency. |
| Decision Engine | Pillar, unsequenced | V1.0 findings → V1.1 capture | Was in no context and no service (E1). |
| **V1 granularity** | One increment | **V1.0 → V1.1 → V1.2 → V1.3** | **ADR-0032.** Four Class A slices, each independently shippable. |
| **`Goal`** | Implicit in V2 Planning | **V1.1** object → **V1.2** static gap → **V2** projection | Split by what each piece actually needs. |
| Forecast | V2 | V2 | Unchanged. |
| Knowledge, AI | V3 | V3 | Unchanged. |

### 4.1 Why Cash Flow can wait (ADR-0024)

The apparent blocker is that Net Worth is a V1 pillar and `Account` lives in the Cash Flow context. But RFC-0003 lists **"Conto deposito"** and **"Liquidità"** among `Asset` *examples*. Cash positions are therefore Assets with Holdings, and Net Worth is portfolio value including a `CASH` asset class — needing no `Transaction`, no `Category`, and no Cash Flow Engine.

`Account` in the Cash Flow sense is about **income and expenditure**, which answers a different question. Once that separation is seen, deferring is straightforward:

- Cash Flow is the highest-volume, highest-friction data in the system — every transaction, categorized. Front-loading it front-loads the chore.
- It is also the **commodity** part. Every personal-finance app tracks spending; none knows your strategy. Building the differentiated half first means the project is worth continuing even if it stops early.
- RFC-0001 itself says *"non nasce per tracciare spese."*

**One qualification added in this revision.** ADR-0026 promoted `Account` to a V1.0 *reference* entity carrying `cash_asset_id`, so v0.1's phrasing that "V1.0 has no `Account`" is wrong as written. What V1.0 has no `Account` *for* is income and expenditure. The entity exists; its Cash Flow behaviour does not.

---

## 5. Extension & Ratification Queue

Integrates RFC-0011 §6 and adds three items. Fourteen extensions to the frozen source documents; six need a product-track decision.

| E | Extension | Ratification | Blocks | Origin |
|---|---|---|---|---|
| **E1** | Ninth bounded context `Decision` | **Required** | **S** | RFC-0004 |
| E2 | `StrategyVersion` immutable aggregate | Technical | — | RFC-0004 |
| E3 | `VirtualHolding` as named (now derived) concept | Low risk | — | RFC-0004, amended ADR-0025 |
| E4 | `EvaluationRun` aggregate | Technical | — | RFC-0009 |
| **E5** | `Alert` = "rule evaluation record" | **Required** | V1.0 | RFC-0009 |
| E6 | `asset_classification_audit` | Technical | — | RFC-0009 |
| **E7** | `SuggestionClass` closed enum | **Required** | V1.0 | RFC-0006 |
| E8 | Strategy Engine not a Domain Service | Technical | — | RFC-0007 |
| **E9** | `Goal` vs `Strategy.objective` split | **Required** | **V1.1** ← escalated from V2 | RFC-0007 |
| **E10** | `OperationType` widened to seven values | **Required** | V1.0 | ADR-0028 |
| E11 | Market charter includes prices | Low risk | V1.0 | ADR-0031 |
| **E12** | **`AssetClass` generalized to classification axes** | **Required** | **V1.2** | **RFC-0012 ADR-0033** |
| E13 | Per-asset metric conditions | **Gated** on RFC-0012 ERR-14's restatement of RFC-0006 §7.1 | Unscheduled | RFC-0012 ERR-14 |
| E14 | Risk-model assumptions frozen in `StrategyVersion` | Technical | V2 | §3, V2 |

E1 remains the only skeleton blocker. E5, E7, E10 are the V1.0 batch.

**The scheduling risk this revision creates.** E9 now blocks V1.1 rather than V2, so a product-track decision that was two increments away is now one. If the product track cannot ratify E9 in time, the fallback is clean and should be agreed in advance: **ship the `goal` table and `strategy_goal` link with `Strategy.objective` untouched, and defer only the Ubiquitous Language reconciliation.** The object does not depend on the naming question being settled; only the docs do.

E12 is the more consequential ratification, because it changes what `AssetClass` *means* in the Ubiquitous Language — from a single taxonomy to one axis among several. See RFC-0012 ADR-0033 for the I-14 restatement it requires.

---

## 6. Risk Register

Ordered by how likely each is to end the project. Technical risk is not the problem — the architecture is boring on purpose.

### 6.1 Data-entry friction is the top risk

Three manual chores were each individually justified and together form the real threat:

| Chore | Origin | Frequency |
|---|---|---|
| Apportion every new Operation to Buckets | ADR-0001 / ADR-0025 (quantity-based, manual) | Every purchase |
| Record every `Decision` | ADR-0002 | Every decision |
| Categorize every Transaction | V1.1 | Every transaction |

Each was defended on audit grounds. None delivers immediate reward at the moment it is performed. A tool that demands three habits before returning value tends to lose all three.

**Mitigations, scheduled rather than aspirational:**

- **Apportionment defaults in V1.1.** A per-`Bucket` default rule so new Operations land apportioned, with `UNASSIGNED` as an exception rather than the norm. Cheapest of the three fixes, addresses the most frequent chore.
- **`Decision` capture stays optional and one-click.** `userRationale` optional (RFC-0008 §7.1), reachable from a finding.
- **Categorization rules ship with Cash Flow**, not after it — Konty's `transaction_types.yaml` pattern.

**A fourth chore is now visible and must not be added to the list.** Classification axes (V1.2) mean country and sector values for every `Asset`. Unlike the three above, this is *external data on a small, slow-changing set* — a few dozen instruments, not a monthly transaction stream — so it belongs to ingestion rather than to habit. RFC-0012 ADR-0033 requires it to arrive provider-fetched with manual ratification, never as an empty field waiting to be filled.

### 6.2 Kill criteria

Explicit checkpoints, because a half-used feature is worse than an absent one — it implies an audit trail that does not exist.

| After | If | Then |
|---|---|---|
| 8 weeks of V1.0 | Zero `Decision`s recorded | **Delete `Decision` capture.** Keep the `Recommendation` history; drop the aggregate rather than let it imply reconstruction it cannot support. |
| 8 weeks of V1.0 | `UNASSIGNED` residual is persistently large | Apportionment model is wrong for you. Revisit ADR-0001/0025 — quantity-based may be too granular. |
| V1.0 complete | Findings are ones you already knew | The Strategy is under-articulated, not the engine. Fix upstream; do not add rules. |
| V1.1 complete | Transactions imported but never categorized | Cut Cash Flow to balances only. Run-rate rules go with it. |
| V1.1 complete | No `Goal` has been created, or none links to a Bucket | **Do not build `goal_funding_gap`.** Delete the object. A funding gap on a goal nobody stated is a rule with no referent. |
| V1.2 complete | No concentration finding on a non-`ASSET_CLASS` axis has ever been actionable | **Keep axes read-only permanently.** Do not build multi-axis targeting. The joint-satisfiability problem is only worth solving if the single-axis version proved useful. |
| V1.3 complete | A metric finding has never changed a decision | **Delete the metric conditions; keep the series.** V2's Forecast needs it regardless. |
| Any point | A Class B finding is not visually distinguishable from a Class A finding | **Do not ship Class B.** See §6.4. |
| Any point | The trace-replay property test cannot be maintained | **Stop.** I-6 has become decorative and P3 is no longer true. This is the one non-negotiable check. |

### 6.3 Lower-order risks

- **Strategy tree editor complexity** — nested weight editing with live normalization is the fiddliest UI in V1. Mitigation: depth-1 in V1.0, nesting in V1.2 with ADR-0017's model unchanged.
- **Price data fragility** — yfinance-class sources break periodically. The `PriceProvider` port and the retained seed fixture mean a break is an inconvenience, not an outage. Classification-data providers (V1.2) inherit the same posture.
- **Free-tier terms changing** under a commercial pivot. Already covered by ADR-0010; record the licence per `price.source`.
- **V1.2 scope growth.** Classification axes plus the indicator half plus bonds plus integrity is the widest increment after V1.0. If it stalls, the split is along the same line as V1.3's: ship axes and indicators, defer bonds and the hash chain to V1.4.
- **Return-convention bikeshedding** (V1.3). Time-weighted versus money-weighted is a genuine choice with no universally right answer. Pick time-weighted, document why in the ADR, and do not revisit it without a finding that demonstrably misled you.

### 6.4 Epistemic drift is the second first-order risk

*Placed after §6.3 only because §6.2 is referenced externally as the kill criteria; this belongs immediately after §6.1 in reading order.*

A drift finding is arithmetic on recorded facts. A VaR finding is inference under estimated assumptions. Both render as one sentence with three numbers, in the same font, with the same trace affordance, sorted into the same list by the same `severity` key. **The reader cannot tell them apart.**

This is not a hypothetical. v0.1 §8 named "the kind of plausible-looking wrong number this architecture exists to prevent" as the thing the whole design opposes, and the mechanism by which it would arrive is not a bug — it is a well-implemented Class B feature rendered through a Class A surface. The code would be correct. The product would quietly stop meaning what it says.

Three mitigations, all cheap and all required before any Class B output ships:

1. **`condition_kind` declares its class** at registration, enforced by RFC-0006 §12's registry completeness test — the same mechanism that already refuses to build a kind with no explanation template.
2. **The finding surface renders the class**, and Class B findings carry their assumption inline rather than behind a link. *"…under a Student-t fit to three years of daily returns"* is part of the sentence, not a footnote.
3. **`severity` does not sort across classes.** A Class B breach ratio and a Class A breach ratio are not commensurable, and pretending otherwise is exactly the "silently averaging incommensurable policies" failure RFC-0007 §5 already refused for heterogeneous strategies.

The corresponding kill criterion in §6.2 is deliberately blunt, because this risk is invisible from inside the code.

---

## 7. Consolidated Deferral Inventory

**Derived from §3** (§2.2). Everything deferred anywhere in RFC-0004–0012, with its target. Nothing in this corpus is deferred to nowhere.

| Item | Origin | Target |
|---|---|---|
| Cash Flow context, Cash Flow Engine | RFC-0004 | V1.1 |
| `Decision` capture | ADR-0002 | V1.1 |
| Apportionment default rules | ADR-0001 | V1.1 |
| `Transaction`↔`Operation` overlap / cash-leg dedup | RFC-0004 §10.6, ADR-0026 | V1.1 |
| **`Goal` object, `goal` DDL, revision audit** | **RFC-0012 ADR-0036 / ERR-11** | **V1.1** |
| `MarketIndicator`, `IndicatorReading`, indicator conditions | RFC-0006 §3, ERR-3 | V1.2 |
| `concentration_above` | RFC-0006 §3, ERR-3 | V1.2 |
| **Classification axes (country, sector, currency exposure)** | **RFC-0012 ADR-0033** | **V1.2** |
| **`goal_funding_gap`, static form** | **RFC-0012 ADR-0036** | **V1.2** |
| **Candidate-asset evaluation (`ScenarioOperation`)** | **RFC-0006 §6.2** | **V1.2** |
| **Candidate-`StrategyVersion` evaluation** | **RFC-0012 ADR-0035** | **V1.2** |
| Bond `valuation_basis`, amortized cost | ADR-0019 | V1.2 |
| Accrued-interest treatment | RFC-0007 §12.4 | V1.2 |
| `CompositeTolerance` (5/25) | ADR-0018 | V1.2 |
| Interior-node tolerances | RFC-0007 §12.3 | V1.2 |
| Asymmetric tolerance bands | RFC-0007 §12.5 | V1.2, if a rule wants it |
| Hash-chain tamper-evidence | RFC-0005 §10.3 | V1.2 |
| Rebalancing calculator | RFC-0007 §12.6 | V1.2 (read-side only) |
| **Valuation and return series** | **RFC-0012 ADR-0034** | **V1.3** |
| **`max_drawdown_below`, `realized_volatility_above`, `sharpe_ratio_below`** | **§3, V1.3** | **V1.3** |
| **Multi-axis targeting** | **RFC-0012 ADR-0033** | **V1.3+, behind §6.2 kill criterion** |
| **Per-asset metric conditions** | **RFC-0012 ERR-14, E13** | **Gated on ERR-14's restatement of RFC-0006 §7.1** |
| **VaR and every Class B condition kind** | **§2.1, §3 V2** | **V2** |
| **Risk-model assumptions in `StrategyVersion`** | **E14** | **V2** |
| `goal_funding_gap`, projective form | RFC-0012 ADR-0036 | V2 |
| Forecast Engine, Planning | RFC-0001 | V2 |
| Tax Engine | RFC-0003 | V2 |
| Scheduled ingestion (staging dir) | ADR-0008 | V2 |
| Notification channel | RFC-0008 §12.2 | V2 |
| Decision templates | RFC-0008 §12.5 | V2 |
| `REJECTED` status, UI | RFC-0008 §12.4, R-1 | V2, if the distinction proves real |
| Multi-currency + FX bitemporal | RFC-0004 §10.5 | V2 |
| Knowledge context, AI assistant | RFC-0001 | V3 |
| `AssetClass` taxonomy ownership seam | RFC-0007 §12.2 | **V1.2 — E12 forces it** |
| `NOT_FIRED` retention policy | RFC-0009 §10.3 | When it measurably hurts |
| Chart library choice | RFC-0005 §10.4 | V1.0, no dependency either way |
| Rationale localization | RFC-0008 §12.1 | When UI language is fixed |

One row changed status rather than target: RFC-0007 §12.2's `AssetClass` ownership seam was deferred "until a second Strategy exists." The fixture has two, and E12 generalizes the taxonomy outright, so the question is due in V1.2 rather than pending.

---

## 8. Consequences

**Positive**

- The differentiated half ships first. If the project stops after V1.0 it is still the only tool that knows your strategy.
- Every increment answers a question RFC-0001 asked, so increment value is measured against the product's own definition of usefulness.
- Net Worth in V1.0 without Cash Flow, via cash-as-`Asset` — a real simplification found in the source rather than invented.
- **Increment membership has a definition and a single home** (§2.1, §2.2). Re-sequencing arguments are now about a container whose criterion is written down, and the ERR-3 class of drift has one place to be corrected.
- **The class criterion places VaR on principle.** The most likely future scope argument in this project is pre-decided by a rule derived from the Manifest rather than by whoever is more persuasive on the day.
- **`Goal` becomes real one increment after it becomes cheap**, and takes the `bucket_below_target_value` magic number with it.
- **Country and sector risk is reachable without touching I-12.** The one requirement in this batch that stays entirely inside the architecture's grain, because it still keys on classification values rather than instruments.
- Nothing is deferred to nowhere (§7).
- Kill criteria are written down now, while it is still cheap to be honest about them — including two that would delete features this revision just scheduled.

**Negative / accepted costs**

- **V1.0 is now M–L.** Four RFC-0011 deltas landed in the increment that was already the largest. Each is justified individually; jointly they push it past the size v0.1 claimed.
- **V1.0 still cannot answer *"come sta andando il mese?"***, one of RFC-0001's six questions. The most visible cost of ADR-0024, unchanged.
- **E9 now blocks V1.1**, pulling a product-track dependency one increment closer. §5 states the fallback, but the coupling is real.
- **E12 changes the Ubiquitous Language.** `AssetClass` stops being *the* taxonomy and becomes one axis. Cheap in code, not cheap in documents — RFC-0003, RFC-0004 §4.1, I-14, and every `AssetClass` mention need reconciling.
- **Five increments before V2** is one more than v0.1 promised, and each added increment is another release cycle of overhead for a solo project.
- **This document was rewritten rather than amended** (§1.1), so a reader holding v0.1 has no diff except §10. The convention was broken once, deliberately, for the one document whose value is being current.
- **Three divergences from RFC-0001** now require product-track amendment, up from two. Until they land, the two tracks disagree in writing about what V1 is and how many of them there are.

---

## 9. Open Questions

1. **E1, E5, E7, E10 ratification.** E1 blocks the skeleton.
2. **E9 ratification, now on the V1.1 critical path.** Does the product track accept the `objective` / `Goal` split, or is the fallback in §5 taken?
3. **E12 ratification.** Does the product track accept `AssetClass` as one axis among several? This is the largest Ubiquitous Language change in the corpus so far.
4. **Is cash-as-`Asset` acceptable for Net Worth**, or does Net Worth require `Account` as its own concept? The whole ADR-0024 argument rests on this reading of RFC-0003's Asset examples.
5. ~~**Should V1.2 be split?**~~ **Resolved.** Yes, but along the measurement line rather than the risk/integrity line — see V1.3's rationale in §3.
6. **When does the product track write its amendments?** Six of the fourteen extensions and three roadmap amendments belong to documents this track does not own.
7. **Which price accessor does the valuation series use** — `price_latest()` or `price_as_known_at()`? Leaning `price_latest()`: a return series built from as-known-then prices is contaminated by when you happened to open the app. But it means the series is a best-current-estimate of history rather than a record of it, which sits uneasily beside RFC-0009 §6. Owner: RFC-0012 ADR-0034.
8. **Is Sharpe's annualization convention frozen in `StrategyVersion` or engine-global?** Frozen is more consistent with tolerances; engine-global is less authoring burden. Due before V1.3.
9. **Does E12 make the target tree's shape a Strategy concern after all?** RFC-0007 §12.2 flagged the seam as thin. With multiple axes, two Strategies wanting different groupings becomes concrete rather than hypothetical. Due with E12.

---

## 10. Revision History

### v0.3 — this document

Product-owner session working against the built V1.0 UI found a gap (no browser path to create/edit `Portfolio`/`Bucket`/`Account`/`Asset`) and asked for it plus Import/Export buttons. ADR-0037 splits the request. Changes from v0.2:

| # | Change | Location |
|---|---|---|
| 1 | **Import/Export UI added**: web routes for `import_operations`, `import_strategy`, `export_authored` (ADR-0037) | §3 V1.0 |
| 2 | **Entity management UI** (create/edit forms for `Portfolio`/`Bucket`/`Account`/`Asset`) added, deferred from V1.0 (ADR-0037) | §3 V1.1 |
| 3 | `Defers` line for V1.0 gains entity management UI | §3 V1.0 |
| 4 | ADR-0037 introduced | Appendix A, ADR body |

### v0.2 — superseded

Integrates all seven RFC-0011 §5 deltas and RFC-0011 §6's queue, and adds this session's decisions. Changes from v0.1:

| # | Change | Location |
|---|---|---|
| 1 | Increment-class criterion declared; ADR-0032 introduced | §2.1 *(new)* |
| 2 | §3 declared the single home for increment membership; §7 declared derived | §2.2 *(new)* |
| 3 | Rewrite-versus-amend deviation justified | §1.1 *(new)* |
| 4 | `EvaluationRun` in skeleton scope (ERR-7) | §3 S |
| 5 | `over_apportioned`, cash-leg machinery, `TRANSFER_IN`/`OUT`/`CORRECTION`, Market price half (ADR-0025/26/28/31) | §3 V1.0 |
| 6 | V1.0 size M → M–L | §3 V1.0 |
| 7 | `mode` versus candidate-flow discrepancy with UX-0001 resolved | §3 V1.0 note |
| 8 | `Transaction`↔cash-leg dedup (ADR-0026) | §3 V1.1 |
| 9 | **`Goal` object moved V2 → V1.1**, with the `bucket_below_target_value` argument | §3 V1.1 |
| 10 | **Classification axes and `concentration_above(axis, …)` added** | §3 V1.2 |
| 11 | **`goal_funding_gap` static form added**; candidate flows placed | §3 V1.2 |
| 12 | `indicator_threshold` / `concentration_above` availability corrected (ERR-3) | §3 V1.2 |
| 13 | **V1.3 — Measurement introduced**; closes v0.1 §9 q4 | §3 V1.3 *(new)* |
| 14 | VaR placed in V2 with frozen assumptions and the determinism requirement | §3 V2 |
| 15 | "V1.0 has no `Account`" corrected per ADR-0026 | §4.1 |
| 16 | Ratification queue integrated from RFC-0011 §6; **E9 escalated to V1.1**; E12–E14 added | §5 |
| 17 | Classification data explicitly excluded from the chore list | §6.1 |
| 18 | Four kill criteria added (Goal, axes, metrics, Class B) | §6.2 |
| 19 | V1.2 scope-growth and return-convention risks added | §6.3 |
| 20 | **Epistemic drift added as a first-order risk** | §6.4 *(new)* |
| 21 | Deferral inventory regenerated: eleven rows added, one status change | §7 |
| 22 | Consequences and open questions updated throughout | §8, §9 |

**Section numbering preserved from v0.1:** §1 Context · §2 Sequencing Principle · §3 The Increments · §4 Divergence (§4.1 Cash Flow) · §5 Ratification Queue · §6 Risk Register (§6.1 friction, §6.2 kill criteria, §6.3 lower-order) · §7 Deferral Inventory · §8 Consequences · §9 Open Questions. External references resolve unchanged.

### v0.1 — superseded

Original. Increments S, V1.0, V1.1, V1.2, V2, V3. ADR-0024. Retained in version control; not maintained.

---

## Appendix A — ADR Index (cumulative, complete)

| ADR | Title | Status | Owner |
|---|---|---|---|
| ADR-0001 | Bucket apportionment model | Accepted, amended by ADR-0025 | RFC-0004 |
| ADR-0002 | Definition of `Decision` | Accepted | RFC-0004 |
| ADR-0003 | `Holding` as derived read model | Accepted | RFC-0004 |
| ADR-0004 | Scope of reconstructability | Accepted | RFC-0009 |
| ADR-0005 | Local store: DuckDB single file | Accepted | RFC-0005 |
| ADR-0006 | Pydantic v2 in the domain core | Accepted | RFC-0005 |
| ADR-0007 | UI: FastAPI + Jinja2 + HTMX | Accepted | RFC-0005 |
| ADR-0008 | Single process, on-demand ingestion | Accepted | RFC-0005 |
| ADR-0009 | Strategy files as derived artifacts | Accepted | RFC-0005 |
| ADR-0010 | Defer commercialization posture | Accepted | RFC-0005 |
| ADR-0011 | Corrections as append-only supersession | Accepted | RFC-0009 |
| ADR-0012 | Reclassification as correction | Accepted | RFC-0009 |
| ADR-0013 | Trace stored as JSON, not STRUCT | Accepted, amended by ERR-1 | RFC-0009 |
| ADR-0014 | Conditions as a closed typed catalog | Accepted | RFC-0006 |
| ADR-0015 | No forward chaining | Accepted | RFC-0006 |
| ADR-0016 | `SKIPPED` distinct from `NOT_FIRED` | Accepted | RFC-0006 |
| ADR-0017 | Hierarchical `TargetAllocation`, relative weights | Accepted | RFC-0007 |
| ADR-0018 | Tolerance semantics: ABSOLUTE pp, RELATIVE proportional | Accepted | RFC-0007 |
| ADR-0019 | Dual valuation basis for bonds | Accepted | RFC-0007 |
| ADR-0020 | Strategy as policy, applied per Bucket | Accepted | RFC-0007 |
| ADR-0021 | Findings as a derived read model | Accepted | RFC-0008 |
| ADR-0022 | Dismissal is a `Decision` | Accepted | RFC-0008 |
| ADR-0023 | `rationale` assembled from `StrategyVersion` | Accepted | RFC-0008 |
| ADR-0024 | Cash Flow deferred to V1.1 | Accepted, amended by ADR-0026 | RFC-0010 |
| ADR-0025 | `VirtualHolding` derived; I-9 as evaluation-time finding | Accepted | RFC-0011 |
| ADR-0026 | Cash legs auto-emitted as paired Operations | Accepted | RFC-0011 |
| ADR-0027 | Rule definitions embedded in `StrategyVersion` | Accepted | RFC-0011 |
| ADR-0028 | `OperationType` widened; transfers as pairs | Accepted | RFC-0011 |
| ADR-0029 | `UNASSIGNED` in denominators | Accepted | RFC-0011 |
| ADR-0030 | `Goal` links outside the freeze boundary | Accepted, **amended by ADR-0036** | RFC-0011 |
| ADR-0031 | Market owns all external observations | Accepted | RFC-0011 |
| **ADR-0032** | **Increment classes: observation, projection, generation** | **Accepted** | **RFC-0010 v0.2** |
| ADR-0033 | Orthogonal classification axes | Proposed | RFC-0012 |
| ADR-0034 | Valuation and return series as derived read models | Proposed | RFC-0012 |
| ADR-0035 | Candidate `StrategyVersion` evaluation via draft lineage | Proposed | RFC-0012 |
| ADR-0036 | `Goal` as a first-class object with a revision audit | Proposed | RFC-0012 |
| **ADR-0037** | **Entity management UI deferred V1.0 → V1.1; V1.0 ships Import/Export UI only** | **Accepted** | **RFC-0010 v0.3** |

---

### ADR-0024 — Cash Flow deferred to V1.1

*Unchanged from v0.1 except the `Account` qualification in §4.1. Retained here in full because RFC-0000 §5 indexes it to this document.*

**Context.** RFC-0001 places Cash Flow in V1 alongside Portfolio, Dashboard, and Strategy. Net Worth is a V1 pillar and `Account` belongs to the Cash Flow bounded context, which appears to make Cash Flow a V1 prerequisite.

**Decision Drivers.** Shortest path to a useful release; front-loading differentiated capability over commodity capability; minimizing manual data-entry habits required before the product returns value; RFC-0001's own statement that the product does not exist to track spending.

**Considered Options.**
1. *Cash Flow in V1.0* as RFC-0001 specifies.
2. *Cash Flow in V1.1*, with Net Worth delivered via cash positions modelled as `Asset`s.
3. *Cash Flow in V1.0 but balances only* — `Account` with no `Transaction`.

**Decision Outcome.** Option 2. The apparent blocker dissolves on inspection: RFC-0003 lists *"Conto deposito"* and *"Liquidità"* among `Asset` examples, so cash positions are Holdings and Net Worth is portfolio value including a `CASH` class. `Account` in the Cash Flow sense concerns income and expenditure — a different question, answered in V1.1.

Option 3 introduces a second representation of cash — as `Account` balance and as `Asset` — which would need reconciling later and risks double-counting in Net Worth. Option 1 front-loads the highest-volume, highest-friction, least differentiated data in the system, delaying the only capability no competing tool has.

**Consequences.** V1.0 cannot answer *"come sta andando il mese?"* — one of RFC-0001's six questions — for an entire increment, and this requires a product-track amendment. `emergency_cover_below_months`, the most valuable cross-context rule, waits for V1.1. In exchange, the `Transaction`↔`Operation` overlap (RFC-0004 §10.6) need not be resolved until real Operation data exists to inform it, and V1.0 requires exactly one new manual habit rather than three.

**Amended by ADR-0026.** `Account` exists in V1.0 as a reference entity carrying `cash_asset_id`. What is deferred is its Cash Flow behaviour, not the entity.

---

### ADR-0032 — Increment classes: observation, projection, generation

**Context.** v0.1 used `S`, `V1.0`, `V1.1`, `V1.2`, `V2`, `V3` as section headers without defining the scheme. There was no stated criterion for what earns a point release versus a major, no ADR, and RFC-0001 knows only of V1/V2/V3. Every re-sequencing argument — Cash Flow, `Goal`, VaR — was therefore conducted about a container with no definition, which is why they kept resolving on intuition.

**Decision Drivers.** The Manifest is the only stable authority available for such a criterion; P3 and P7 are the properties that actually vary across the roadmap; the criterion must classify the existing corpus correctly without special pleading; it must be decidable in advance of implementation, or it cannot pre-empt an argument; and it must not reduce to "size", because size and consequence are independent here.

**Considered Options.**
1. *Size-based* — a major is a big release. Fails: VaR is small code and large consequence.
2. *Area-based* — a major introduces a new bounded context. Fails: V1.1 introduces Cash Flow, which is plainly not a major.
3. *Question-based* — a major answers a new RFC-0001 question. Fails: V1.1 and V1.2 each answer one, and neither is a major.
4. *Epistemic-class-based* — a major changes the character of the output's claim to truth.
5. *No criterion* — status quo, decide case by case.

**Decision Outcome.** Option 4. Three classes: **A — Observation** (deterministic arithmetic over recorded facts, fully replayable), **B — Projection** (depends on estimated parameters or assumed distributions, only the comparison replays), **C — Generation** (authored by a model, not reproducible). A major introduces a new class; a point release adds capability within the current class.

Option 2 is the intuitive answer and it is wrong in a specific, instructive way: bounded contexts describe *where code lives*, and the roadmap's real risk is about *what the product claims*. Option 5 is what produced the VaR argument this ADR closes.

**Consequences.**

- VaR, however small its diff, is V2. Forecast was already V2 for the same reason, which the criterion now makes explicit rather than coincidental.
- Sharpe, drawdown, and realized volatility are Class A and therefore admissible in V1.x — which is a *reversal* of an earlier informal position that grouped them with VaR. The distinction is that they require a series, not a model.
- A new obligation lands on the Rule Engine registry: `condition_kind` declares its class, enforced by RFC-0006 §12's completeness test.
- A new obligation lands on the UI: Class B findings must be distinguishable from Class A findings, and `severity` must not sort across classes (§6.4).
- `V1.3` becomes a legitimate label rather than an ad-hoc one, and the increment count before V2 grows to five.
- The criterion is a constraint on this project's future self, which is the point. It will at some stage forbid something convenient.

---

### ADR-0037 — Entity management UI deferred to V1.1; V1.0 ships Import/Export UI only

**Context.** A product-owner session working against the built V1.0 UI (apportionment forms, Strategy-authoring forms, the new `/dashboard`) found it had no way to create or edit `Portfolio`, `Bucket`, `Account`, or `Asset` from the browser, and asked for both full create/edit forms for those four entities and Import/Export buttons wired into the UI.

**Decision Drivers.** §3 V1.0's UI scope is exactly two forms (apportionment, Strategy authoring) and neither is a general entity editor; no write-side use case exists today for creating any of the four entities (`ApportionBucket` and Strategy-freeze both mutate an *existing* aggregate, they don't mint `Portfolio`/`Bucket`/`Account`/`Asset`); `Account` has no aggregate yet, only a reference-entity DTO (ADR-0026); Import/Export, by contrast, wires three use cases that already exist and ship with the CLI (`import_operations`, `import_strategy`, `export_authored`) — no new domain logic, no new invariant to enforce at write time.

**Considered Options.**
1. *Build both now* — full CRUD UI for all four entities plus Import/Export buttons, in V1.0.
2. *Build neither* — leave the CLI/fixture-seed path as the only way in, until V1.1.
3. *Build Import/Export UI now, defer entity CRUD UI to V1.1.*

**Decision Outcome.** Option 3. Import/Export UI costs nothing architecturally — it is a thin web-route wrapper over use cases already proven by the CLI and its tests. Entity CRUD UI is real scope growth: it requires a write-side use case per entity, none of which exist, and for `Account` a domain aggregate that doesn't exist either. Building it ungoverned, mid-session, without an RFC would repeat the exact failure mode this corpus's governance rules exist to prevent.

**Consequences.** V1.0 ships Import/Export UI (§3 V1.0, new row). Entity management UI moves to V1.1 (§3 V1.1, new row), where it is paired with `Account`'s already-scheduled promotion to a full aggregate — the two land together rather than `Account` being promoted twice. Until V1.1 ships, the only way to create a `Portfolio`, `Bucket`, `Account`, or `Asset` remains the fixture-seed CSV path (`financeos seed <dir>`), which is destructive (wipes the store) and was never intended as a repeating workflow — that gap is now on the record rather than silently worked around.
