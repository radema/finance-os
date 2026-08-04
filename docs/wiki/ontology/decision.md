# Decision context — the immutable audit artifacts

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.
Machine-readable form: `../semantic/entities.yaml` (`context: decision`).

`src/financeos/core/decision/`

## The governing idea

**Every artifact here is an audit record, so the whole context has no mutable link.**

No context depends on this one — the dependency edges are **inbound only** (RFC-0004 §4), which is
what makes the Recommendation pipeline testable in isolation. Nothing in this package can be
updated, and nothing in it points at anything that can change underneath it.

## The chain — read this first

The single most common question about this domain is *"what is the relationship between a Rule and a
Recommendation?"* The answer has a middle term that is usually skipped:

```
Rule  ──evaluate──▶  RuleFiring  ──materialize──▶  Alert  ──(FIRED only)──▶  Recommendation
                     (in memory)                   (persisted,               (persisted,
                                                    all 4 outcomes)          1:1 with a FIRED Alert)
                                                        │
                                                        └──▶ EvaluationTrace (I-6)
```

- `RuleFiring` never persists. It is the Strategy→Decision **contract**.
- **`Alert` is the persisted evaluation record**, and all four outcomes are written.
- `Recommendation` is **1:1 with a FIRED `Alert`** — not with a Rule, and not with a run.
- **`HYPOTHETICAL` runs produce zero Recommendations** even for FIRED alerts (RFC-0008 §8).

## `EvaluationRun` — `artifacts.py:42`

```
id · portfolio_id · strategy_id · strategy_version_id
scope: Scope · as_of: date · evaluated_at: Instant
mode: RunMode · engine_versions: Mapping[str, str]
input_digest: str            # sha256, pattern-enforced ^[0-9a-f]{64}$
```

One evaluation of one scope against one frozen `StrategyVersion` (**E4**, **ERR-2**).

- `strategy_version_id` is the **I-11 pin**, held here rather than on each `Alert` so it is **one
  join away from every Alert and can never dangle** (**ERR-6** — this replaced RFC-0004's
  `Alert.strategyVersion` field).
- `as_of` is the **domain** date evaluated against; `evaluated_at` is wall clock from the `Clock`
  port. Staleness is measured against `as_of`, never a wall clock, so a replay does not depend on
  when it is replayed (**I-7**).
- `scope` persists as `scope_kind` + `scope_id` (added by **ERR-2**). `scope_id` carries **no FK** —
  it may be a `BucketId` or a `PortfolioId`.
- `mode` — `HYPOTHETICAL` runs persist Alerts and traces but produce **no** Recommendations
  (RFC-0008 §8), so a speculative firing cannot leak into the findings list. `mv_finding` filters
  `WHERE run.mode = 'ACTUAL'` for the same reason.
- `input_digest` is a SHA-256 over the canonical bound inputs. It answers *"would this evaluate
  identically today?"* without recomputing anything (RFC-0006 §10).

## `Alert` — `artifacts.py:67`

```
id · run_id · rule_id · outcome: Outcome · priority: Priority
severity: SeverityAmount | None · trace: EvaluationTrace · recorded_at
```

A **rule evaluation record** (**E5**, ratified), not a notification.

> All four outcomes are persisted, because *"nothing fired" is as much an explanation as a firing*.
> Only `FIRED` reaches the recommendations list; `SKIPPED` and `ERROR` reach the **run-health**
> panel.

Two fields carry a caveat:

- `rule_id` is a **logical identifier with no foreign key** (**ADR-0027**). It resolves through
  `run_id → strategy_version.definition.rules`, and the Decision Engine **rejects a firing whose
  rule is absent from the pinned version** (`RuleNotInVersionError`).
- `severity` is `None` for kinds declaring no formula **and** for `SKIPPED`/`ERROR` outcomes
  (**ERR-1**).

`_is_explainable` (`artifacts.py:87`) enforces three things at construction:

1. `trace.outcome` must equal `self.outcome` — the trace cannot disagree with the record;
2. `FIRED` and `NOT_FIRED` require a **bound, stepped** trace (`I-6`);
3. `severity` must be `None` for `SKIPPED` and `ERROR` (`ERR-1`).

## `Provenance` — `artifacts.py:102`

```
run_id · strategy_id · strategy_version_id · rule_id
input_refs: tuple[str, ...] · evaluated_at
```

The **P7** carrier: what a `Recommendation` was produced from.

`rule_id` and `run_id` are **non-nullable**, so **no construction path exists** for a Recommendation
that does not derive from a Rule. **I-5** is structural, not a validated rule.

## `Recommendation` — `artifacts.py:117`

```
id · alert_id · provenance: Provenance
finding_key: str          # sha256, pattern-enforced
observation: str          # WHAT is true — rendered from trace.message_bindings
rationale: str            # WHY it matters — assembled from the frozen StrategyVersion
suggestion_class: SuggestionClass · recorded_at
```

Motivated, **never prescriptive** (**I-12**, **I-17**; RFC-0008 §5).

> ### I-12 is structural
>
> **There is no instrument, action, direction or quantity field to populate.** Nor can any
> `SuggestionClass` member carry one (**E7**). A prescriptive Recommendation is **unrepresentable**,
> not merely discouraged — which is also the MiFID suitability firewall expressed as a **schema**
> rather than as a policy.
>
> Do not add such a field. Verified by `tests/test_i12_structural.py`.

The three content fields divide the work precisely:

- **`observation`** — what is true, rendered from the trace's captured `message_bindings`. Rendering
  reads **only the trace**, so a March observation re-rendered in October reads the March trace and
  nothing else (RFC-0008 §5.1).
- **`rationale`** — why it matters, assembled from the frozen `StrategyVersion` (**ADR-0023**). The
  system restates the user's own declaration; it never asserts suitability.
- **`suggestion_class`** — a **category of deliberation**, from a closed enum (**E7**). Italian
  surface forms are impersonal infinitives, fixed verbatim by **P21**.

`I-17`: a Recommendation **cannot reference a `Decision`**. The edge points the other way only.

## `finding_key` — the one to be careful with

Computed at `core/engines/decision_engine.py:158`:

```python
sha256_hex(str(rule.id), str(run.scope.id), canonical_json(dict(rule.condition.params)))
```

Three components: **which Rule**, **which scope**, **which exact parameterisation**.

**`strategy_version_id` is deliberately excluded.** Editing an unrelated rule freezes a new version,
which would otherwise **reset the finding's history** — making *"this has been drifting for five
months"* unanswerable.

**`scope_id` is deliberately redundant**, since most kinds also carry scope in `params` (**R-2**).
The redundancy is kept on purpose so a future kind whose params omit scope cannot silently merge
findings across Buckets.

> ### ⚠ The bug that has already shipped once
>
> **Any resolution or dedup logic keying on *less* than the full `finding_key` silently hides live
> findings.** Not "produces a wrong count" — *hides them*, invisibly.
>
> Pinned by
> `tests/test_finding_resolution.py::test_editing_rule_params_does_not_resolve_an_unrelated_finding`.
> If you are writing anything that resolves, dismisses, groups or deduplicates a finding, key on the
> whole hash. This applies with particular force to the unbuilt `Decision` entity, whose entire job
> is resolution.

## `Finding` — `mv_finding`, the read-side dedup

`adapters/duckdb/migrations/001_init.sql:413`. A plain **`VIEW`** — despite the `mv_` prefix,
neither `mv_finding` nor `mv_holding` is a real materialized view. The prefix records **intent** (a
derived model), not a storage mechanism.

```sql
SELECT r.finding_key, r.rule_id,
       arg_min(r.id, r.recorded_at) AS first_recommendation_id,
       arg_max(r.id, r.recorded_at) AS latest_recommendation_id,
       min(run.as_of) AS first_seen,  max(run.as_of) AS last_seen,
       count(*) AS occurrences,
       arg_max(a.severity, r.recorded_at) AS current_severity,
       arg_max(a.priority, r.recorded_at) AS current_priority,
       arg_max(CASE a.priority WHEN 'CRITICAL' THEN 5 ... WHEN 'INFO' THEN 1 END,
               r.recorded_at) AS priority_rank
FROM recommendation r
JOIN alert a            ON a.id = r.alert_id
JOIN evaluation_run run ON run.id = r.run_id
WHERE run.mode = 'ACTUAL'
GROUP BY r.finding_key, r.rule_id
ORDER BY priority_rank DESC, current_severity DESC NULLS LAST, r.rule_id ASC;
```

**Deduplication is read-side** (**ADR-0021**). The Decision Engine deduplicates **nothing** —
because a mutable Recommendation would be a row whose `run_id` no longer identifies the run that
produced its content.

`finding_key` is a **stored column** on `recommendation` (written at insert time, indexed by
`ix_recommendation_finding_key`), not something this view derives. The view only `GROUP BY`s on the
already-hashed value.

> **Correlated findings are never collapsed** (RFC-0008 §4.1). Equity-under and bonds-over are shown
> as **two** findings — they have different `finding_key`s and are genuinely two facts.

## `EvaluationTrace` — `trace.py:122`

The **P3** carrier and the object the replay contract quantifies over. Stored as JSON on
`alert.trace` (**ADR-0013**).

### The replay contract (RFC-0009 §4.1)

> Given `condition` plus the `value` of every binding, and **ignoring all `source` fields**,
> re-executing `steps` must reproduce `outcome` exactly.

Executable form: `rule_engine.replay_trace()` (`rule_engine.py:1435`). Verified by a property test
over **every outcome the engine can produce** (`tests/test_trace_replay.py`).

### Four load-bearing properties — nothing may weaken these

1. **Every binding carries both `value` and `source`** — `value` is what Stage A replays, `source` is
   what Stage B resolves. The whole A ⊂ B mechanism of **ADR-0004**.
2. **`steps` are explicit and ordered** — a small algebra of named operations over named values,
   which is what makes replay *mechanical* rather than *interpretive*.
3. **Decimals serialize as strings.** A trace that round-trips `0.4` as `0.4000000000000001` is not
   an audit artifact.
4. **`message_bindings` are captured, not re-derived at render time.** The message seen in March
   must be reproducible verbatim in October.

### Structure

| Type | Code | Role |
|---|---|---|
| `ConditionRef` | `trace.py:91` | the condition **as evaluated** — kind, `kind_version`, canonical params |
| `Binding` | `trace.py:66` | one fact read: `name`, `value`, `source`, `observed_at` |
| `Step` | `trace.py:75` | one recorded op: `op`, `inputs`, `out`, `value` |
| `StepOp` | `trace.py:37` | **the step algebra** — exactly 15 members |
| `FactUnavailable` | `trace.py:99` | a needed fact, and **why** it was unusable |
| `StaleFactNote` | `trace.py:113` | name, `observed_at`, `age_days`, `max_staleness_days` |

`Step.value = None` records a `divide_safe` over a **zero denominator** — a **skip marker**, not an
error (RFC-0006 §4.1). A dotted `inputs` name addresses a field of a structured binding value, e.g.
`"tolerance.band"`.

### The step algebra — 15 ops

```
subtract  add  multiply  divide_safe  abs
gt  gte  lt  lte  eq  abs_gt  ratio_to
all  any  not
```

Deliberately tiny, **total**, and `Decimal`-exact, executed under a **fixed** decimal
`Context(prec=28)` so a replay on another machine cannot diverge. **One implementation
(`apply_op`) serves both recording and replay**, so the two cannot drift apart.

> **Adding an op requires an ADR.** The list growing is the signal that a general expression
> language is being reinvented by accident.

### `TRACE_VERSION` — traces are never migrated

`trace.py:34`, currently `1`. **Stored traces are never migrated** (RFC-0009 §7.2). A schema change
**bumps `TRACE_VERSION` and keeps the reader for every prior version**. Do not write a trace
migration.

One deliberate deviation from RFC-0009 §4.1's illustrative JSON: a step's operand list is named
`inputs`, not `in`, because `in` is a Python keyword and a serialization alias for it would be a
permanent footgun at the persistence boundary.

## `RuleFiring` — `firing.py:11`

```
rule_id · priority · outcome · skip_reason · severity · error · trace
```

The Strategy→Decision contract, **owned by the consuming context** (it lives here, not in
`core/strategy/`) — see [`bounded-contexts.md`](bounded-contexts.md) on C3.

Strategy evaluates rules and hands over outcomes plus their traces; **it never constructs a
`Recommendation`**. `error` carries the exception message for an `ERROR` outcome, and **the run
continues**.

## `Snapshot` — `snapshot.py:50`

An immutable Portfolio-wide checkpoint (**I-16**, RFC-0009 §5.1), written on every `evaluate` run
and **sharing `run_id`** with that run's Alerts — so *"what did the Portfolio look like when this
Recommendation appeared"* is a single **join** rather than a reconstruction.

> A **checkpoint and a series source, never a source of truth.** It is rebuildable from facts and
> may be dropped and regenerated.

Uses **only `core.shared` vocabulary** — `MoneyAmount`, `WeightAmount`, never `Money` or
`AllocationLine` from `core.portfolio` — because `core.decision` may not import another bounded
context (**C3**).

`by_bucket` is keyed by Bucket id as a string, plus the `UNASSIGNED` constant (`snapshot.py:29`).
`SnapshotBucketLine.weight` **may be negative** for `UNASSIGNED` — the same signed reading
`over_apportioned` and `unassigned_residual_above` give it (**ADR-0025**/**ADR-0029**).

Feeds the read-side series: `queries/snapshots.py::drift_history`,
`queries/recommendations.py::severity_history`.

## Behaviours here that look like bugs

- **`SKIPPED` and `ERROR` alerts exist in the database but appear in no findings list.** Correct —
  they are run-health signal.
- **`HYPOTHETICAL` runs persist alerts and traces but produce zero Recommendations** (RFC-0008 §8).
- **Dismissal is recorded as a `Decision`; nothing is mutated and there is no `dismissed` flag**
  (**ADR-0022**). Also, `Decision` is not implemented yet — so there is currently **no dismissal
  path at all**, which is a gap, not a bug in what exists.
- **Correlated findings are never collapsed.**
- **`alert.rule_id` and `recommendation.rule_id` have no FK.** Correct (**ADR-0027**).

## Engine

`decision_engine.py` — a single pure composition function `materialize(...)`, **not** a ninth Domain
Service. It materializes one `Alert` per firing whatever the outcome, one `Recommendation` per
`FIRED` firing, orders them, and attaches provenance. `next_id` is passed **as a value** so the
engine holds no port (**I-7**).

Ordering: `priority_rank DESC, severity DESC NULLS LAST, rule_id ASC` — a **total** order, so a
re-run is byte-identical. See [`outcomes-and-severity.md`](outcomes-and-severity.md).
