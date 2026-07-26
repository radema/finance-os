# RFC-0012 — Classification Axes, Measurement, and Goals

| | |
|---|---|
| **Status** | Proposed |
| **Track** | Technical (0004–0012) |
| **Depends on** | RFC-0004 through RFC-0011; RFC-0010 v0.2 for sequencing |
| **Amends** | RFC-0004 (I-14, class diagram), RFC-0006 §7.1, RFC-0007 §12.2, RFC-0009 §3.3 / §6, RFC-0011 §1 / §6 (precedence), RFC-0011 ADR-0030 / ERR-8 |
| **Defines** | Orthogonal classification axes · valuation and return series · candidate `StrategyVersion` evaluation · `Goal` as a first-class object |
| **Precedence** | Section-scoped and recency-ordered — see §8. This document wins where it and RFC-0004–0011 disagree on a subject it addresses; it makes no claim over subjects it does not. |
| **Language** | English. Ubiquitous Language verbatim per RFC-0003. |

---

## 1. Context

RFC-0010 v0.2 sequences four capabilities that the rest of the corpus does not yet describe: country and sector concentration, portfolio measurement over time, candidate-strategy exploration, and `Goal` as something other than a magic number inside a rule's `params`.

A roadmap cannot contain those decisions. It says *when*; the domain model, the schema, and the invariant registry say *what*, and those live in amending documents by the convention RFC-0000 §10 rule 3 sets out. RFC-0010 v0.2 is a deliberate one-time exception to that rule for the document whose value is being current (its §1.1); this document is not an exception and follows the convention.

Four errata and four resolutions. Two of the errata were found while writing RFC-0010 v0.2, and one of them — ERR-14 — changes a position this track had taken earlier in the same session, which is recorded in §3 rather than quietly corrected.

**Sequencing is not restated here.** Per RFC-0010 §2.2, §3 of that document is the sole normative home for increment membership. Where this document needs to say when something ships, it points.

---

## 2. Errata

### ERR-11 — `goal` has no DDL, and `strategy_goal` has a dangling FK

**Defect.** RFC-0011 ERR-8 supplied completing DDL for six missing tables and introduced a seventh gap in the process:

```sql
CREATE TABLE strategy_goal (
    strategy_id  UUID NOT NULL REFERENCES strategy(id),
    goal_id      UUID NOT NULL REFERENCES goal(id),   -- ← no such table
    PRIMARY KEY (strategy_id, goal_id)
);
```

`Goal` is an aggregate root in RFC-0004 §2.2 with a declared lifecycle, and nowhere in the corpus is there a `CREATE TABLE goal`. ERR-8 closed six holes and opened one.

**Repair.** DDL supplied in ADR-0036. Until it lands, `strategy_goal` must not ship — a table with an unresolvable foreign key is worse than an absent one, because the migration succeeds and the constraint silently means nothing.

### ERR-12 — ADR-0030's reconstructability claim is false as written

**Defect.** ADR-0030 states that when `goal_funding_gap` arrives, *"the rule's params pin the `goal_id`… which is where the provenance actually needs it: the evaluation's target is reconstructable from the version."*

It is not. The version pins a `goal_id`; the *target value* lives on `Goal`, which ADR-0030 deliberately placed **outside** the freeze boundary and which is therefore mutable. Revising a goal from €60,000 to €70,000 leaves every prior trace resolving its `goal_id` to a different number than the one it evaluated. Stage B reconstruction (RFC-0009 §5) silently returns the wrong premise, and Stage A is unaffected only by accident — because it replays recorded values rather than re-resolving references.

This is the same defect ADR-0012 solved for `asset_class` and ADR-0019 solved for `valuation_basis`, arriving in a third place because ADR-0030 moved an object out of a freeze boundary without giving it the correction machinery that boundary was providing.

**Repair.** ADR-0036: `Goal` revisions are repository-enforced with an audit row, and `goal_funding_gap` binds `target_value` as a `Bound` carrying `source={kind:"goal", goal_id, last_revision_id}`. ADR-0030's sentence is restated: *the evaluation's target is reconstructable from the version **plus the trace binding**.* The link-table decision itself is unaffected and stands.

### ERR-13 — candidate-`StrategyVersion` evaluation is used but never specified

**Defect.** Three documents disagree about whether this capability exists.

- RFC-0006 §6.2 specifies hypothetical evaluation in exactly one shape: real Operations **plus a `ScenarioOperation` delta**. That is candidate-*asset* evaluation — *"what if I bought X."*
- RFC-0008 §8 hardens hypothetical runs (zero Recommendations) and gives the reason for persisting them: *"what was I considering in March, and what would it have said?"*
- The UI mock shows a persisted hypothetical run labelled *"what if Global were targeted at 12%"* — candidate-*version* evaluation, which no RFC specifies.

Worse, it is currently impossible. ERR-6 makes `evaluation_run.strategy_version_id` non-nullable, and RFC-0007 §7 freezes on any edit, so an unfrozen draft has no id to pin and a frozen draft is indistinguishable from a decision.

**Repair.** ADR-0035.

### ERR-14 — `concentration_above` already contradicts RFC-0006 §7.1

**Defect.** RFC-0006 §7.1 makes a strong structural claim:

> **For allocation and drift conditions, the binding namespace contains `AssetClass` but no `AssetId` or instrument name.** So it is not merely discouraged but *structurally impossible* to interpolate "VWCE" into a drift message.

`concentration_above(scope, threshold_weight)` consumes **per-asset** allocation. Its whole purpose is to report that one position is too large a share of a scope, and a message that cannot name the position is useless — *"something is 22% of your portfolio"* is not a finding. So either the kind binds an `AssetId`, contradicting §7.1's claim about allocation conditions, or it ships unusable.

This matters beyond tidiness. In this session's earlier analysis, per-asset metric conditions were argued to be the thing that would "convert a structural guarantee into a behavioural one." That framing was wrong: **the conversion already happened, in a V1.2 kind that has been in the catalog since RFC-0006, and nobody noticed.** The argument against per-asset metrics is therefore weaker than stated — they add volume to an existing exception rather than creating a new one.

**Repair.** §7.1's claim is restated with its true scope, and the guarantee is relocated to where it can actually be enforced:

> **Target and drift conditions** bind `AssetClass` values only; interpolating an instrument name into their messages remains structurally impossible.
> **Per-asset conditions** (`concentration_above`, and any future `asset_metric_*` kind) bind an `AssetId` **as a label only**. No kind that binds an `AssetId` may also bind a direction, a quantity, a price target, or a `SuggestionClass` outside `{REVIEW_ALLOCATION, REVIEW_BUCKET_ASSIGNMENT, REVIEW_STRATEGY, NO_ACTION}`.

Enforcement is a reflection test in the registry-completeness suite (RFC-0006 §12), sitting beside the existing I-12 reflection test: *for every registered kind, if `AssetId ∈ binding_namespace` then `{direction, quantity, price_target} ∩ binding_namespace = ∅`.* This is a genuinely weaker guarantee than "the binding does not exist," and calling it what it is beats the alternative — believing the strong version while shipping the weak one.

### ERR-15 — RFC-0011's precedence claim inverts against RFC-0010 v0.2

**Defect.** Three statements in the corpus are jointly unsatisfiable:

- RFC-0011 §1: *"Where a conflict exists between an original RFC and this document, **this document wins**."* Its `Amends` field lists RFC-0010.
- RFC-0011 §6: *"Supersedes RFC-0010 §5."*
- RFC-0010 v0.2 header: *"Integrates RFC-0011 §5 (Roadmap Deltas), RFC-0011 §6 (Ratification Queue)."*

By the rule the corpus actually states, RFC-0011 wins. So RFC-0011 §6's row **`E9 | Required | V2`** defeats RFC-0010 v0.2 §5's **`E9 | Required | V1.1`**, and the ratification that ADR-0036 places on the V1.1 critical path remains authoritatively a V2 concern. **The precedence machinery returns the stale answer, and returns it confidently** — which is worse than having no rule, because a reader who follows the convention correctly arrives at the wrong increment.

Two smaller instances of the same shape:

- RFC-0000 §5 names RFC-0011 Appendix A as *"the cumulative table"*; RFC-0010 v0.2 Appendix A now also claims that role. Two cumulative indexes, one of them ending at ADR-0031.
- RFC-0011 §5's seven roadmap deltas are no-ops against v0.2 — harmless, but a reader cannot establish that without applying all seven and finding each already present.

**Root cause, which matters more than the symptom.** RFC-0011's precedence claim is **document-scoped** (*"this document wins"*) in a corpus where amendment is **section-scoped** (RFC-0000 §4 maps corrections location by location). That was sound while RFC-0011 was the newest document, because nothing downstream could integrate it. RFC-0010 v0.2 is the first document in this corpus to *absorb* an amendment rather than layer on one, and a document-scoped claim has no way to express "superseded in part."

This is a structural defect in the convention, not a mistake in RFC-0011. It would have surfaced at the first integration regardless of which document integrated first.

**Repair.** Precedence becomes section-scoped and recency-ordered (§8). RFC-0011 §1's sentence is restated:

> Where a conflict exists between this document and RFC-0004–0009, this document wins. Where a section of this document has been integrated into a later revision of a document it amends, **the later revision wins for that section**. §5 and §6 are so integrated, into RFC-0010 v0.2.

RFC-0011's `Track` field reads *Technical (0004–0012)*. Its §6 heading gains *"— superseded by RFC-0010 v0.2 §5; retained for provenance."*

**Not repaired, deliberately:** nothing else. Every ERR and every ADR in RFC-0011 stands exactly as written, which is why this is a precedence repair and not a reason to rewrite the document. An errata log's value is being a record of what was wrong and when; rewriting it to remove two superseded sections would trade the corpus's main asset for one avoided lookup.

---

## 3. Resolutions (ADR-0033 — ADR-0036)

### ADR-0033 — Orthogonal classification axes, with fractional exposure

**Context.** `asset.asset_class VARCHAR` is single-valued, and `AssetClass` is treated corpus-wide as *the* taxonomy. Monitoring whether an allocation is concentrated in one country or sector requires classification on axes that vary independently of asset class: one ETF is simultaneously `EQUITY_DEVELOPED`, mostly US, and mostly technology. RFC-0007 §12.2 flagged the taxonomy-ownership seam and deferred it "until a second Strategy exists"; the fixture has two.

**Decision Drivers.** Concentration findings must stay inside I-14 (key on classification values, never `AssetId` — unlike ERR-14's per-asset kinds, this one need not bend); classification must not become a fourth manual chore (RFC-0010 §6.1); per-axis auditing must work exactly as `asset_classification_audit` already does; forward-only migrations are expensive but the authored-data export is already a V1.0 prerequisite; and — decisively — **a broad ETF has no single country.**

**Considered Options.**
1. *Keep `asset.asset_class`; add a side table for secondary axes only.*
2. *Unified `asset_classification` table, single value per axis; drop the column.*
3. *JSON column on `asset`.*
4. *Typed columns per axis (`country`, `sector`).*
5. *Unified table with **fractional weights** per axis value.*

**Decision Outcome.** Option 5.

Options 1 and 4 were the cheap answers and both are wrong in the same way. Option 1 makes the primary axis structurally different from every other axis forever: one in a column, the rest in a table, two code paths reading classifications, and an audit table covering half the data. Option 4 needs a migration per axis and hard-codes the axis set in DDL. Option 3 defeats per-axis auditing and `GROUP BY axis`, and RFC-0009 §9 already notes that JSON is not statically typed at the storage layer.

Option 2 is the interesting near-miss, and rejecting it is the substance of this ADR. **A single dominant value per axis is close to worthless for a portfolio of broad ETFs.** Classify a world-equity fund as `COUNTRY = GLOBAL` and the roughly two-thirds US exposure inside it becomes invisible — which is precisely the concentration the requirement exists to surface. The feature would ship, pass its tests, and answer the question wrongly. Fractional weights cost nothing extra in schema or audit; what they cost is *data*, and that is a sourcing problem rather than a migration.

**Mechanics.**

```sql
CREATE TABLE classification_axis (
    axis        VARCHAR PRIMARY KEY,   -- 'ASSET_CLASS' | 'COUNTRY' | 'SECTOR' | 'CURRENCY_EXPOSURE'
    label       VARCHAR NOT NULL,
    targetable  BOOLEAN NOT NULL       -- only ASSET_CLASS is TRUE (see below)
);

CREATE TABLE asset_classification (
    asset_id      UUID NOT NULL REFERENCES asset(id),
    axis          VARCHAR NOT NULL REFERENCES classification_axis(axis),
    value         VARCHAR NOT NULL,
    weight        DECIMAL(9,8) NOT NULL,       -- Σ = 1 per (asset, axis) — I-19
    source        VARCHAR NOT NULL,            -- 'PROVIDER' | 'MANUAL'
    ratified_at   TIMESTAMPTZ,                 -- NULL = provider-proposed, not accepted
    PRIMARY KEY (asset_id, axis, value),
    CHECK (weight > 0)
);

-- Replaces RFC-0009 §3.3's single-axis table.
CREATE TABLE asset_classification_audit (
    id            UUID PRIMARY KEY,
    asset_id      UUID NOT NULL REFERENCES asset(id),
    axis          VARCHAR NOT NULL,
    from_value    JSON,                        -- NULL on first classification
    to_value      JSON NOT NULL,               -- [{"value":"US","weight":"0.64"}, …]
    source        VARCHAR NOT NULL,
    reason        VARCHAR,
    changed_at    TIMESTAMPTZ NOT NULL
);
```

The audit row carries the whole distribution rather than a scalar pair, because a fractional reclassification is not a single from→to move.

**Migration.** Create the three tables; backfill `ASSET_CLASS` from `asset.asset_class` at `weight = 1`, `source = 'MANUAL'`, `ratified_at = now()`; migrate existing audit rows with `axis = 'ASSET_CLASS'` and scalar values wrapped as single-element distributions; drop `asset.asset_class`. This is the first migration that needs `financeos export --authored`, which RFC-0010 §3 V1.0 already lists as required before migration 002 — the safety net was built before the thing it catches.

**Repository.** `AssetRepository.reclassify(asset_id, axis, distribution, source, reason)` is the only mutation path, extending the existing single-axis method and writing both rows in one transaction. There is no generic `update(asset)` that touches a classification.

**Allocation.** `AllocationBreakdown` becomes per-axis. For each axis, each Holding's value decomposes across that axis's values by weight, and the resulting per-value totals sum to the scope's total by construction (I-19). `ASSET_CLASS` decomposition is unchanged from today's behaviour, because every weight there is 1.

**Targeting stays on one axis.** `classification_axis.targetable` is TRUE for `ASSET_CLASS` only. Two axes with independent target trees can be jointly unsatisfiable — a 40% US target and a 30% technology target may have no portfolio that satisfies both given available instruments — and this corpus has no defined resolution for that. The column exists so the restriction is data rather than a hardcoded assumption, and RFC-0010 §6.2 carries the kill criterion that decides whether it is ever relaxed.

**Unknown exposure is surfaced, not hidden.** Where look-through data is unavailable, the distribution is a single `UNKNOWN` value at weight 1. Following RFC-0007 §4.1's honesty argument exactly — capital that exists must not vanish from the denominator — `UNKNOWN` stays in the per-axis denominator, and a new condition kind **`classification_unknown_above(axis, threshold_weight)`** reports it. This is the same pattern as `untargeted_allocation`, `unassigned_residual_above`, and `over_apportioned`: the system surfaces its own data gap through the explainable channel rather than through a banner. Without it, incomplete look-through data reads as *low* concentration everywhere, which is the most dangerous possible failure for this feature.

**Consequences.**

- `concentration_above` is generalized at birth to `concentration_above(axis, threshold_weight)` rather than shipped single-axis and rewritten.
- **I-14 is restated** (§4) and **E12 is required** (§5): `AssetClass` stops being the taxonomy and becomes one axis. Cheap in code, expensive in documents.
- Classification data is external, so it belongs to Market's egress surface per ADR-0031 for *fetching*, while Portfolio owns the ratified value. The `ratified_at` null-state is what keeps a provider from silently changing your allocation view: unratified proposals are visible in the classification UI and excluded from `AllocationBreakdown`.
- Look-through data is typically free only for top-10 holdings. Coverage will be partial, permanently, and `classification_unknown_above` is how you find out where.
- One more axis-selection decision per view. Mitigated by defaulting every existing surface to `ASSET_CLASS`, so nothing changes visually until you ask it to.

---

### ADR-0034 — Valuation and return series as derived read models

**Context.** Every metric RFC-0010 V1.3 schedules — drawdown, realized volatility, Sharpe — needs a return series. The corpus has no return series and no valuation series. `Snapshot` is the only time series, and it is unfit for the purpose in two independent ways: its cadence is every `evaluate` (user-triggered, irregular, because ADR-0008 has no scheduler), and `total_value` includes contributions and withdrawals, so its changes are not returns.

**Decision Drivers.** Class A only (RFC-0010 §2.1) — deterministic, replayable, no estimated parameters; no scheduler may be introduced; RFC-0009 §6's as-recorded decision must be respected or explicitly scoped; contributions must not appear as performance; the same series must serve V1.3 metrics and V2's Forecast, so it is built once.

**Considered Options.**
1. *`Snapshot` series as-is.*
2. *Nightly scheduled valuation.*
3. *Derived series computed on demand from `price` × `operation`.*
4. *Materialized daily table maintained on import.*

**Decision Outcome.** Option 3, with option 4 available later as pure persistence optimization behind the same port — the `mv_` prefix convention (RFC-0009 §3.4) already permits that swap without application changes.

Option 1 produces a number with a Greek letter attached rather than a statistic. Option 2 contradicts ADR-0008, and the escape hatch ADR-0008 provides is for *ingestion*, not for computation the app can do on open.

**Two corrections to earlier reasoning, both of which cut in favour of this being cheaper than it looked.**

*RFC-0009 §6 does not block this.* That decision forbids recomputing historical series **under current classifications**, and its stated mechanism is reclassification. But `price × quantity` is classification-independent: reclassifying an `Asset` moves value between allocation buckets and never changes a total. So §6 governs drift and allocation series, and a *value* series computed from prices falls outside its scope. §6 is hereby scoped explicitly, because the opposite reading is the natural one and would have killed this feature on a misapplied precedent.

*The data for contribution-neutral returns already exists.* ADR-0026's cash legs and ADR-0028's `TRANSFER_IN`/`TRANSFER_OUT` split were introduced for unrelated reasons, and together they are exactly what distinguishes capital *entering* the portfolio from capital *moving within* it. A `BUY` consumes cash and a `SELL` produces it, both inside the boundary, netting to zero. A paired transfer with both sides in the portfolio nets to zero by `transfer_pair_id`. What remains is an external flow.

**Mechanics.**

```
mv_valuation_series(scope, date) → value
    holdings as of date  =  fold over operation where date(op) ≤ date
    value                =  Σ  quantity × price, via ASOF join to nearest-prior price
```

The ASOF join is the reason ADR-0005 chose DuckDB, and this is the query that cashes that choice in. Grid: business-daily from the first `Operation` date.

**Time-weighted return.** Sub-periods break at every external-flow date, so returns chain exactly and no Modified-Dietz approximation is needed:

```
r_i   = (V_end,i − V_start,i) / V_start,i     for each flow-free sub-period i
TWR   = Π (1 + r_i) − 1
index = cumulative Π (1 + r_i), rebased to 100
```

**Metrics derive from the index, never from the raw value series.** This is the subtle error worth pre-empting: a €20,000 withdrawal is a −18% move in the value series and a 0% move in the index. Max drawdown computed on value would report a drawdown that never happened, confidently, with a trace.

| Metric | Definition | Convention to declare |
|---|---|---|
| `max_drawdown` | Largest peak-to-trough decline of the TWR index over the window | Window length |
| `realized_volatility` | Stdev of daily log returns × √252 | Annualization factor |
| `sharpe_ratio` | (annualized TWR − risk-free) / `realized_volatility` | Risk-free source, annualization |

The risk-free rate is a `MarketIndicator` (V1.2) consumed via `IndicatorView`, which pins `reading_id` — so Sharpe stays Class A: every input is a recorded observation and every step is arithmetic.

**Trace shape.** Each metric reaches the Rule Engine as a single `Bound`, following RFC-0007 §8.1's established pattern rather than inventing one:

```
Bound(value="0.1840",
      source={kind:"derived", engine:"strategy", method:"twr_max_drawdown",
              grid:"BUSINESS_DAILY", window:"P3Y", price_accessor:"price_latest",
              inputs:["op:…", "price:…"]})
```

Stage A replays the comparison against the recorded value; Stage B resolves `inputs`. `method`, `grid`, `window`, and `price_accessor` are in `source` because a replay discrepancy must be attributable to a convention change, which is the same job `engine_versions` does for code.

**Price accessor.** `price_latest()`, i.e. best current estimate of history rather than as-known-then. A series built from `price_as_known_at()` would be contaminated by when you happened to open the app, which is an artefact of your behaviour rather than of the market. Recorded as the resolution to RFC-0010 §9 question 7, and it does sit slightly uneasily beside RFC-0009 §6 — the discomfort is real and the alternative is worse.

**Consequences.**

- The series is recomputed per run. Bounded at this data volume; promotable to a table with no port change if it stops being.
- **A late-arriving price revision changes historical returns**, which sounds alarming and is actually handled: `input_digest` differs, so the existing Reconcile view (RFC-0009 §2.2) surfaces it as *"premises changed"* — the same machinery, no new mechanism.
- Three conventions (grid, annualization, window) are authoring or engine decisions with no safe default, joining tolerance kinds on the list of things this system asks you to choose deliberately.
- V2's Forecast gains its input series in V1.3, one increment before it needs it.
- `Snapshot` keeps its original job — as-recorded checkpoint, `run_id`-joinable to Alerts — and stops being asked to be a performance series it was never designed to be.

---

### ADR-0035 — Candidate `StrategyVersion` evaluation via draft lineage

**Context.** ERR-13: candidate-version evaluation is shown in the mock, implied by RFC-0008 §8's justification for persisting hypothetical runs, specified nowhere, and currently impossible because `evaluation_run.strategy_version_id` is non-nullable and freeze-on-any-edit gives a draft no id to pin.

**Decision Drivers.** `evaluation_run` must keep a real, non-null, immutable version target or the replay contract breaks; the mainline lineage must narrate strategy *thinking*, since that is `change_note`'s entire purpose and ADR-0030's stated reason for existing; *"what was I considering in March?"* must remain answerable (RFC-0008 §8); and no new query discipline should be invented if an existing one fits.

**Considered Options.**
1. *Nullable `frozen_at`, draft versions mutable in place.*
2. *Freeze candidates into the mainline lineage with an `abandoned` flag.*
3. *Evaluate candidates in memory; never persist the run.*
4. *Candidates frozen and immutable, on a separate lineage.*

**Decision Outcome.** Option 4.

Option 1 puts a mutable row behind a non-null FK from an immutable audit record, which is the exact failure mode the whole Decision context is built to avoid. Option 2 pollutes the lineage `change_note` exists to narrate: version history becomes a log of experiments, and *"how did my thinking change over three years?"* — ADR-0009's stated justification for file export — gets answered with abandoned what-ifs. Option 3 discards the capability RFC-0008 §8 explicitly justified persisting.

**Mechanics.**

```sql
ALTER TABLE strategy_version ADD COLUMN lineage_kind    VARCHAR NOT NULL DEFAULT 'MAINLINE';
ALTER TABLE strategy_version ADD COLUMN adopted_from_id UUID REFERENCES strategy_version(id);
```

- A candidate is **frozen and immutable like any other version**. It gets a real id, a `change_note`, and a `parent_version_id`. So `evaluation_run.strategy_version_id` needs no change, and replay is untouched — the version a March candidate run pinned will still be byte-identical in October.
- `change_note` on a candidate records **the question**, not a decision: *"what if Global were targeted at 12%"* — which is exactly what the mock renders as the run's label. The field already fits; only its reading changes.
- A `CANDIDATE` is never the target of `strategy.current_version_id` (I-22), and version-history surfaces filter `lineage_kind = 'MAINLINE'`.
- **Adopting a candidate** freezes a new `MAINLINE` version whose `parent_version_id` is the current mainline head and whose `adopted_from_id` points at the candidate. Lineage stays linear; the experiment stays attributable.
- A candidate evaluation must run `mode = 'HYPOTHETICAL'`, so RFC-0008 §8's zero-Recommendations rule applies. **Two independent guards:** a candidate cannot produce a Recommendation because hypothetical runs write none, and cannot become current because of I-22.

**Consequences.**

- `strategy_version` grows with abandoned candidates. Trivial at this volume, and the rows are the record of what you considered.
- **A second mandatory read-side predicate** joins `mode = 'ACTUAL'`. This is the cost worth naming: RFC-0008 §8 chose to write no Recommendation rows *specifically because* "a forgotten predicate in one query module is a plausible bug," and this adds one such predicate back. Mitigation is the same shape as the one already in place — filtering lives in named query helpers, never inlined — plus one property test asserting no `MAINLINE` history query returns a candidate.
- Candidate-asset evaluation (`ScenarioOperation`) and candidate-version evaluation now share one flow and one run mode, so the UI has one what-if surface rather than two.
- Strategy exploration remains Class A: comparing what two target trees *would have said about facts you actually hold* is arithmetic. It is not a backtest, and it makes no claim about which strategy performs better. RFC-0006 §14.6's caution about rule tuning after seeing the data still applies to how you *use* it.

---

### ADR-0036 — `Goal` as a first-class object with a revision audit

**Context.** ERR-11 (`goal` has no DDL) and ERR-12 (revisions break reconstructability). Separately, RFC-0010 §3 V1.1 documents the motivating case: `bucket_below_target_value(€24,000.00)` is a goal wearing a rule's clothing, frozen in a `StrategyVersion`, unraisable without minting a version, and unmarkable as achieved.

**Decision Drivers.** ADR-0030 placed `Goal` outside the freeze boundary and must not be reversed — the reasoning there was correct; a mutable object referenced by an immutable trace needs the correction machinery ADR-0012 established; status changes are bookkeeping and must not require the same ceremony as a target change; `goal_funding_gap` must be Class A in V1.2 and only its projective form belongs in V2.

**Considered Options.**
1. *Goals frozen inside `StrategyVersion`* — reverses ADR-0030.
2. *Goals mutable, traces pin only `goal_id`* — status quo, i.e. ERR-12.
3. *Goals mutable with a revision audit; traces bind the value.*
4. *Goals append-only; a revision is a new `Goal` superseding the old.*

**Decision Outcome.** Option 3. Option 4 is the more purist reading and it breaks the object's identity: *"€60,000 by 2032"* revised upward is the same goal with a new number, not a different goal, and splitting it makes `strategy_goal` links and achievement history incoherent.

**Mechanics.**

```sql
CREATE TABLE goal (
    id            UUID PRIMARY KEY,
    name          VARCHAR NOT NULL,
    kind          VARCHAR NOT NULL,
    target_value  DECIMAL(19,4) NOT NULL,
    currency      VARCHAR(3) NOT NULL,
    target_date   DATE,
    status        VARCHAR NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('ACTIVE','ACHIEVED','ABANDONED'))
);

CREATE TABLE goal_revision_audit (
    id            UUID PRIMARY KEY,
    goal_id       UUID NOT NULL REFERENCES goal(id),
    field         VARCHAR NOT NULL,        -- 'target_value' | 'target_date' | 'kind'
    from_value    VARCHAR NOT NULL,
    to_value      VARCHAR NOT NULL,
    reason        VARCHAR,
    changed_at    TIMESTAMPTZ NOT NULL
);
```

- `GoalRepository.revise(goal_id, field, to_value, reason)` is the only path that touches an evaluation-relevant field, and writes both rows in one transaction. No generic `update(goal)`.
- `GoalRepository.set_status(...)` is separate and **unaudited**. Status is bookkeeping — precisely ADR-0030's own argument for keeping Goal links out of the freeze boundary, applied one level down.
- **`goal_funding_gap(goal_id, threshold)`** binds `target_value` as a `Bound` with `source={kind:"goal", goal_id, last_revision_id}` — null `last_revision_id` if never revised. Stage A replays from the recorded value; Stage B resolves the revision. `required_facts` declares the binding, so the registry-completeness test (RFC-0006 §12) fails the build if a future edit drops it.
- Facts: apportioned value of the Buckets linked to the goal's Strategies, against `target_value`. Severity: `gap / target_value`, monotonic in the gap, exactly 1 when the gap equals the target. No projection — Class A.
- A goal with `status ≠ 'ACTIVE'` yields **`SKIPPED(goal_not_active)`**, reusing RFC-0006's outcome machinery rather than inventing an error path, in the same idiom as `heterogeneous_strategies`. It surfaces in the run health panel, which is what stops an achieved goal from silently disabling a rule you forgot you wrote.

**Consequences.**

- **ADR-0030 is amended, not reversed.** Its link-table decision stands; its reconstructability sentence is corrected (ERR-12).
- **E9 escalates to blocking V1.1** (RFC-0010 §5). The fallback stated there — ship the object, defer the Ubiquitous Language reconciliation — is available because nothing here depends on the naming question.
- `bucket_below_target_value` is **not** rewritten. It stays as authored in V1.0, and once `goal_funding_gap` exists for goal-linked Buckets you disable the floor rule, which freezes a version and records why. That is the correct amount of ceremony for a strategy change, and retrofitting the old rule's params to reference a Goal would put a mutable reference inside a frozen definition — the thing ERR-12 exists to prevent.
- A third correction-with-audit pattern joins `asset_class` and `valuation_basis`. Three instances is a pattern worth naming; a shared repository mixin is a refactor, not a decision.

---

## 4. Invariant Registry Deltas

For RFC-0000 §6. `WT` = write-time, `ET` = evaluation-time, `CI` = build contract, `TL` = type-level.

| ID | Invariant | Enforcement | Origin |
|---|---|---|---|
| **I-14** *(restated)* | Targets are keyed by **`(axis, value)`**, never by `AssetId` | TL — map key type; `classification_axis.targetable` gates which axes may appear | ADR-0033 |
| **I-19** *(new)* | Per `Asset` per axis, classification weights sum to 1 within an explicit `Decimal` epsilon | WT — repository constructor, same epsilon discipline as I-13 | ADR-0033 |
| **I-20** *(new)* | Every `Asset` carries a classification on the `ASSET_CLASS` axis | WT — non-empty check on asset creation; allocation depends on it | ADR-0033 |
| **I-21** *(new)* | Every registered `condition_kind` declares its epistemic class (A/B/C) | CI — registry completeness test | RFC-0010 ADR-0032 |
| **I-22** *(new)* | A `CANDIDATE` `strategy_version` is never referenced by `strategy.current_version_id` | WT + named property test | ADR-0035 |

I-21 originates in RFC-0010's ADR-0032 but is recorded here, because this document is the amending document and the registry takes its rows from one place regardless of which ADR produced them.

Application-level integrity checks added to RFC-0000 §6's closing list: *no `MAINLINE` version-history query returns a `CANDIDATE`* (ADR-0035); *no condition kind binding an `AssetId` also binds a direction, quantity, or price target* (ERR-14); *`goal_funding_gap` binds `target_value`* (ADR-0036, via `required_facts`).

---

## 5. Extension & Ratification Deltas

For RFC-0010 §5, which is the authoritative queue.

| E | Extension | Ratification | Blocks | Origin |
|---|---|---|---|---|
| **E9** | `Goal` vs `Strategy.objective` split | **Required** | **V1.1** ← escalated from V2 | ADR-0036 |
| **E12** | `AssetClass` generalized to classification axes, with fractional exposure | **Required** | **V1.2** | ADR-0033 |
| E13 | Per-asset metric conditions (`asset_metric_*`) | **Gated** on ERR-14's restatement being accepted | Unscheduled | ERR-14 |
| E14 | Risk-model assumptions frozen in `StrategyVersion` | Technical | V2 | RFC-0010 §3 V2 |

**E12 is the heaviest ratification in the corpus so far**, because it changes what a word means rather than adding one. `AssetClass` becomes one axis among several, which touches RFC-0003's Ubiquitous Language, RFC-0004 §4.1's shared-kernel note ("`AssetClass` is owned by Portfolio and consumed as an opaque taxonomy key by Strategy"), I-14, and every `AssetClass` reference in the technical corpus. None of it is hard; all of it is documents.

**E13's status changed as a result of ERR-14.** It was previously argued that per-asset conditions would convert I-12 from a structural guarantee into a behavioural one. ERR-14 establishes that `concentration_above` already did so, in V1.2, unremarked. E13 therefore does not cross a line — it widens an existing exception, and it is gated on ERR-14's restatement being ratified rather than on a fresh argument about I-12. If the restatement is accepted, per-asset metric conditions become an ordinary category-2 change (a condition kind over facts that exist) and can be scheduled on their merits.

---

## 6. Consequences

**Positive**

- **The two prerequisites are separated from the features that need them.** Classification axes and the valuation series are independent of each other and jointly gate everything else, so they can be built in either order and neither waits on a metric decision.
- **Fractional exposure is in the schema from the first migration.** The country/sector feature would otherwise have shipped an answer that looked right and was wrong for exactly the portfolio it was built for.
- **Three latent defects are closed** — a dangling FK (ERR-11), a false reconstructability claim (ERR-12), and a capability the UI promises and no RFC specifies (ERR-13).
- **One overstated guarantee is corrected** (ERR-14), which is a loss of a claim rather than a loss of a property. The property was never there.
- Every resolution reuses existing machinery: ADR-0012's correction-with-audit, RFC-0007 §8.1's derived `Bound`, RFC-0006's `SKIPPED` taxonomy, RFC-0009's `mv_` promotion path, RFC-0008 §8's mode discipline. No new mechanism is introduced anywhere in this document.
- `Snapshot` is relieved of a job it was never designed for, and keeps the one it was.

**Negative / accepted costs**

- **The first real migration.** ADR-0033 drops a column that most existing queries read. Forward-only, so `financeos export --authored` stops being a nice-to-have and becomes the rollback plan — which RFC-0010 §3 V1.0 already anticipated, but anticipating and depending on are different.
- **Classification coverage will be permanently partial.** Free look-through data typically stops at top-10 holdings. `classification_unknown_above` makes the gap visible, which is the best available outcome, not a fix.
- **A second mandatory read-side predicate** (ADR-0035), weakening the "a row never written cannot leak" argument RFC-0008 §8 was proud of.
- **Three declared conventions** (grid, annualization, window) with no safe default, on top of two tolerance kinds. The list of things this system asks you to decide deliberately keeps growing, and each one is a place to be quietly inconsistent.
- **I-12's guarantee is now split** into a strong form (target and drift conditions) and a weak form (per-asset conditions). Two-tier invariants are harder to hold in your head than one-tier invariants.
- **Two ratifications land on the product track at once** (E9 escalated, E12 new), in a corpus that already has six pending.

---

## 7. Open Questions

1. **Which of the seven `OperationType` values constitute an external flow?** ADR-0034's TWR sub-period boundaries depend on the exact enumeration ADR-0028 produced, and this document does not restate it. Unpaired `TRANSFER_IN`/`TRANSFER_OUT` are certainly external; `BUY`/`SELL`/`CORRECTION` certainly are not. The remaining values need explicit classification, and a misclassification shows up as performance rather than as an error. **Due with E10 ratification, before any V1.3 work.**
2. **Which classification-data provider, and under what licence?** Same shape as RFC-0009 §10.5's price-licence question, and it should be answered at the same time rather than twice.
3. **Does E12 make the target tree's shape a Strategy concern?** RFC-0007 §12.2 called the seam thin. With multiple axes, "two Strategies wanting different groupings of the same classes" stops being hypothetical. Due with E12.
4. **Is Sharpe's annualization convention frozen in `StrategyVersion` or engine-global?** Frozen is consistent with tolerances and with E14's treatment of VaR assumptions; engine-global is less authoring burden. Leaning frozen, for consistency with the direction E14 sets.
5. **Should `classification_unknown_above` be per-axis or one rule covering all axes?** Per-axis matches `concentration_above` and gives independent thresholds; one rule is less authoring. Leaning per-axis, since the acceptable unknown fraction for `SECTOR` and for `ASSET_CLASS` are not the same number.
6. **Do unratified provider classifications need their own finding?** They are excluded from `AllocationBreakdown`, so an unratified reclassification silently keeps the old allocation view. That is the safe direction, but it is also silent. A `classification_unratified_above` kind would surface it — possibly one hygiene rule too many.
7. **Are ERR-15's two annotations to RFC-0011 acceptable as in-place edits?** They are a restated sentence in §1 and a heading suffix on §6 — no ERR, ADR, or DDL touched. Strictly, the convention forbids them and §8 alone is sufficient: a reader who consults §8 gets the right answer without them. The case for making them anyway is that a reader who opens RFC-0011 *directly* sees a document claiming authority it no longer has, and the cost of discovering §8 is exactly the cost ERR-15 exists to remove. Leaning yes, recorded as an exception in RFC-0000 §4 rather than taken silently.

---

## 8. Corpus Precedence

Replaces the document-scoped rule in RFC-0011 §1 (ERR-15). **Section-scoped and recency-ordered: the most recent statement on a subject wins, except where a later document explicitly names an earlier one as authoritative.**

| Subject | Authoritative source |
|---|---|
| Increment membership and sequencing | **RFC-0010 v0.2 §3** — §2.2 makes it the sole home; every other copy is descriptive |
| Extension & ratification queue | **RFC-0010 v0.2 §5** — integrates RFC-0011 §6 |
| Risk register, kill criteria | **RFC-0010 v0.2 §6** |
| Deferral inventory | **RFC-0010 v0.2 §7** — derived from §3, regenerated on conflict |
| Increment-class criterion | **RFC-0010 v0.2 ADR-0032** |
| Cumulative ADR index | **RFC-0010 v0.2 Appendix A** — RFC-0011 Appendix A becomes a historical snapshot ending at ADR-0031 |
| Classification axes, series, candidate versions, `Goal` | **RFC-0012** (this document) |
| Invariant registry | **RFC-0000 §6**, taking its rows from RFC-0012 §4 |
| Schema repairs to RFC-0004–0009 (ERR-1…ERR-10) | **RFC-0011** — unchanged, still authoritative |
| ADR-0025…0031 | **RFC-0011** — except ADR-0030's reconstructability sentence (ERR-12) |
| Everything else | The owning RFC, as listed in RFC-0000 §2 |

**One consequence for RFC-0000.** §3 currently reads *"Originals are never edited, so all `RFC-000X §Y` references remain stable."* That sentence conflates two properties which have now come apart. RFC-0010 is a declared exception to *never edited* (RFC-0010 §1.1), but its v0.2 preserves every v0.1 section number, so *references remain stable* survives. §3 should be restated to assert the second property and name RFC-0010 as the exception to the first — otherwise the index asserts a convention the corpus stopped following.

**Why recency rather than a fixed hierarchy.** A fixed order ("RFC-0011 always wins") is simpler to state and is exactly what failed here: it cannot express partial supersession, and it silently privileges whichever document happened to be newest when the rule was written. Recency-ordering costs a reader one extra question — *which document spoke last about this subject?* — and RFC-0000 §4's cross-reference table exists to answer it.

---

## Appendix A — ADR Index (additions)

| ADR | Title | Status | Owner |
|---|---|---|---|
| ADR-0033 | Orthogonal classification axes, with fractional exposure | Proposed | RFC-0012 |
| ADR-0034 | Valuation and return series as derived read models | Proposed | RFC-0012 |
| ADR-0035 | Candidate `StrategyVersion` evaluation via draft lineage | Proposed | RFC-0012 |
| ADR-0036 | `Goal` as a first-class object with a revision audit | Proposed | RFC-0012 |

Amended by this document: **ADR-0012** (extended to per-axis and to `Goal` revisions) · **ADR-0030** (reconstructability sentence corrected, ERR-12) · **ERR-8** (completed with `goal` DDL, ERR-11). None reversed.

Cumulative index: RFC-0010 v0.2 Appendix A.
