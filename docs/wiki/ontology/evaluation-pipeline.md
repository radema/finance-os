# The evaluation pipeline — where everything meets

Point-in-time map, base commit `2dd7346`. Ground truth: `docs/seed/rfcs/` then `src/`.

`uv run financeos evaluate` runs this. The composition lives in **exactly one place**:
`src/financeos/app/evaluate_strategy.py` (561 lines — the largest module in `app/`, and
legitimately so).

## Why composition is centralised

Two contracts force it:

- **`I-7` / `C2`** — no engine holds a port. An engine cannot load a fact, read a clock or mint an
  id, so someone else must assemble every input first.
- **No engine calls another engine.** So the ordering between engines cannot live inside any of them.

The `app/` use case is the only layer that holds ports and owns transactions
(`app/unit_of_work.py`). That makes it the single composition point (RFC-0005 §3).

## The flow

From `evaluate_strategy.py`'s own module docstring:

```
compute_holdings            # Bucket scope: resolve VirtualHoldings, call .as_holding().
   │                        # The engine takes Sequence[Holding] and does NOT branch on scope.
   ▼
compute_allocation          # values holdings via PriceView; flags unpriced_assets
   │
   ├─▶ compute_apportionment  # FACT_APPORTIONMENT — assembled in EVERY scope
   ├─▶ compute_residual       # FACT_RESIDUAL — Portfolio-wide by nature
   ├─▶ compute_drift(allocation, sv.targets, strategy_version_id=sv.id)   # FACT_DRIFT
   └─▶ compute_targets(sv.targets, strategy_version_id=sv.id)             # FACT_TARGETS
   │
   ▼
build FactSet               # frozen, fully materialized — no lazy loading is possible
   │
   ▼
subset sv.rules by scope    # ADR-L06 — the SCOPE GATE. Read here, never by the engine.
   │
   ▼
evaluate(rules, facts)      # rule_engine — pure; returns RuleFiring per rule, all 4 outcomes
   │
   ▼
materialize(firings, sv, run, next_id=..., recorded_at=...)
                            # decision_engine — Alerts (all), Recommendations (FIRED only)
   │
   ▼
persist in one transaction  # DuckDBEvaluationRepository: evaluation_run, alert,
                            # recommendation, snapshot
```

## Stage 1 — assemble the facts

`FactSet` (`core/engines/rule_engine.py:112`) is **frozen and fully materialized**. There is no lazy
loading, because engines hold no repository (**I-7**), so the application service assembles
everything *first*.

Six fact families, each a named constant in `rule_engine.py`:

| Family | Constant | Line | Shape | Produced by |
|---|---|---|---|---|
| `drift` | `FACT_DRIFT` | 76 | `Mapping[AssetClass, Bound[DriftLine]]` | `strategy_engine.compute_drift` |
| `allocation` | `FACT_ALLOCATION` | 80 | `Mapping[AssetClass, Bound[AllocationLine]]` | `portfolio_engine.compute_allocation` |
| `residual` | `FACT_RESIDUAL` | 84 | `Bound[WeightAmount] \| None` | `portfolio_engine.compute_residual` |
| `targets` | `FACT_TARGETS` | 90 | `Mapping[AssetClass, Bound[LeafTarget]]` | `strategy_engine.compute_targets` |
| `bucket_value` | `FACT_BUCKET_VALUE` | 96 | `Bound[Money] \| None` | `compute_allocation`'s scope total |
| `apportionment` | `FACT_APPORTIONMENT` | 100 | `Mapping[AssetId, Bound[ApportionmentLine]]` | `portfolio_engine.compute_apportionment` |

Three of these distinctions are easy to get wrong:

- **`allocation` vs `drift`** — `allocation` carries **every held class**, targeted or not; `drift`
  carries **targeted leaves only**.
- **`targets` vs `drift`** — `targets` exists separately (**ADR-L05 §5**) precisely so
  `untargeted_allocation` can test *membership* without depending on drift being computable.
- **`bucket_value` vs `allocation`** — `bucket_value` is a scope-level **total**, not a per-class
  mapping. **ERR-4** removed a phantom `prices` fact that `bucket_below_target_value`'s catalog row
  once carried.

### `FactSet.unavailable` — the honesty channel

```python
unavailable: Mapping[str, SkipReason]   # e.g. {"drift": SkipReason.ZERO_PORTFOLIO_VALUE}
```

When a whole family could not be computed, the **producing engine's reason** is recorded here and
travels to the trace. That is the mechanism that makes an unevaluable rule read `SKIPPED(<reason>)`
rather than the inverted `NOT_FIRED` (**ADR-0016**). Never substitute a zero for an unavailable fact.

### `Bound[T]` — why the trace is unavoidable

Every fact entering an evaluation is a `Bound` (`core/shared/bound.py:43`): `value`, `source`,
`observed_at`. `source` has **no default**, so **a fact with no provenance cannot be constructed** —
a binding can never appear in a trace without a source.

`.age(as_of)` measures against the run's **domain date**, never a wall clock: the core holds no
`Clock` (**I-7**) and a replay must not depend on when it is replayed.

## Stage 2 — gate the rules by scope

**ADR-L06.** Before calling the engine, `evaluate_strategy` subsets `sv.rules` to those that apply
to *this* scope call. Three code paths, in precedence order:

1. **An explicit `Rule.scope_gate`** wins (`RuleScopeGate.applies_to(scope)`, `rule.py:79`).
2. Otherwise, a parseable **scope-shaped value among the condition params** is used
   (`_parse_scope_ref`, `_named_scope_value`).
3. Otherwise, `_default_scope_gate(rule)` infers one from the **condition kind** via the registry.

`_applies_to_this_call` at `evaluate_strategy.py:429` is the decision point.

> The engine **never** sees a gate. **C2** and RFC-0006 §3.1 put this in the application layer, and
> `RuleScopeGate`'s docstring is explicit that a `LeafCondition`'s `scope` param is a **message
> binding**, never compared against the facts' actual scope.

`_placement_error` / `_placement_error_firing` handle a rule whose inferred placement can never match
any call — surfaced as a firing rather than swallowed.

## Stage 3 — evaluate

`rule_engine.evaluate(rules, facts, registry=REGISTRY)` — pure. The recorder is **local mutable
state returned as part of the output**, so no port is held (**I-7** / **C2**) and a re-run is
byte-reproducible.

Rules are processed in `_in_order` — `(priority DESC, rule_id ASC)`.

Per rule (`_evaluate_rule`, `rule_engine.py:1323`):

1. build the `ConditionRef` from `condition.kind`, `kind_version`, `params`;
2. look the kind up in the registry (`UnknownConditionKindError` → `ERROR`);
3. parse params against `spec.params_model` (`ValidationError` → `ERROR`);
4. check `rule.enabled` → `SKIPPED(disabled)`;
5. check `spec.required_facts` against `facts.unavailable` → `SKIPPED(<reason>)`;
6. check staleness against `max_staleness` → `SKIPPED(stale_fact)` with a `StaleFactNote`;
7. run `spec.evaluate(params, facts, recorder)` → `ConditionResult(fired, severity)`;
8. a `SkipSignal` raised mid-evaluation (`rule_engine.py:301` — *control flow, not an error*) →
   `SKIPPED`; any other exception → `ERROR` with the message, **and the run continues**.

### The trace is accumulated, not emitted

`TraceRecorder` (`rule_engine.py:349`) is threaded through as the evaluator's third argument.
Reading a fact appends a `Binding`; every arithmetic step goes through the recorder and appends a
`Step`.

> **There is no code path that evaluates without producing a trace**, because *the values being
> evaluated are the trace bindings*. **I-6** therefore cannot decay into decoration — decoration
> would require a second, untraced arithmetic path, and one does not exist. **Do not create one.**

### The closed catalog — six kinds at `2dd7346`

`ConditionRegistry` / `REGISTRY` (`rule_engine.py:600` / `:637`). **Adding a kind is a code change,
deliberately** (**ADR-0014**).

| kind (v1) | `required_facts` | severity formula | `default_max_staleness` | Registered at |
|---|---|---|---|---|
| `drift_outside_tolerance` | `drift` | `\|drift\| / effective_band` | 7 days | `:713` |
| `untargeted_allocation` | `targets`, `allocation` | `max(current_weight over affected set) / threshold_weight` | 7 days | `:870` |
| `unassigned_residual_above` | `residual` | `residual_weight / threshold_weight` | 7 days | `:956` |
| `allocation_absent` | `allocation` | **`None`** | 7 days | `:1040` |
| `bucket_below_target_value` | `bucket_value` | `1 + shortfall_value / target_value` | 7 days | `:1150` |
| `over_apportioned` | `apportionment` | `1 + Σ deficit_quantity / Σ apportioned_quantity` | **`None`** (**ERR-10**) | `:1268` |

`over_apportioned`'s `default_max_staleness=None` is correct and commented in place: *both operands
are authored/derived, not observed*, so there is no observation to go stale.

`ConditionKindSpec` (`rule_engine.py:562`) requires **eight** components — kind, version,
`params_model`, `required_facts` (non-empty), `default_max_staleness`, `severity`,
`explanation_template`, `numeric_bindings`, plus `evaluate`. Every field is required, so omitting any
is a **construction failure** — RFC-0006 §12's completeness test enforced by the **type system** as
well as by a test.

> **The Rule Engine performs no financial computation** (RFC-0006 §3.1). A new fact must carry
> something *another* engine already computed. If you find yourself adding arithmetic to an
> evaluator, the fact is in the wrong shape.

Registry lookups are also exposed read-side by `queries/strategies.py::rule_catalog_kinds`, which is
how the UI offers kinds and their param fields.

## Stage 4 — materialize

`decision_engine.materialize(firings, strategy_version, run, next_id=..., recorded_at=...)`.

- one `Alert` per firing, **whatever the outcome**;
- one `Recommendation` per **`FIRED`** firing — and **zero** for a `HYPOTHETICAL` run (RFC-0008 §8);
- every rule is resolved against the pinned version — the integrity guarantee replacing the dropped
  FK (**ADR-0027**), raising `RuleNotInVersionError`;
- `rationale` assembled from the frozen `StrategyVersion` **only** (**ADR-0023**);
- `observation` rendered from the trace's `message_bindings`, raising `TemplateRenderError` if a
  template names a binding the trace does not carry (the binding namespace of each kind is closed
  and known, so this is a bug, not a runtime condition);
- `finding_key` computed per Recommendation (`:158`);
- ordered `priority_rank DESC, severity DESC NULLS LAST, rule_id ASC`.

`next_id` is passed **as a value**, not as an injected port — that is how the engine gets ids while
respecting **I-7**.

## Stage 5 — persist

One transaction, via `app/unit_of_work.py` and `DuckDBEvaluationRepository`
(`adapters/duckdb/repositories/evaluation.py`): `evaluation_run`, `alert`, `recommendation`,
`snapshot`.

`Snapshot` is written on every `evaluate` run **sharing the same `run_id`** (RFC-0009 §5.1,
RFC-0010 V1.0).

All five tables are append-only (**C6**).

## Determinism is a gate, not an aspiration

Four mechanisms together:

1. **Total ordering** — `(priority_rank DESC, severity DESC NULLS LAST, rule_id ASC)`; without the
   `rule_id` tie-break, equal rows could reorder between runs.
2. **`input_digest`** — SHA-256 over the canonical bound inputs, via `canonical_json` /
   `canonical_decimal` (`core/shared/canonical.py`).
3. **A fixed decimal context** — `Context(prec=28, rounding=ROUNDING)` (`rule_engine.py:104`), so
   neither a caller's ambient context nor the machine a replay runs on can change a recorded value.
4. **A byte-identical re-run**, verified by a trace-replay property test.

Pinned by `tests/test_trace_replay.py`:
`test_replaying_a_trace_reproduces_its_outcome`,
`test_evaluation_is_deterministic_to_the_byte`,
`test_the_property_covers_every_outcome_the_engine_can_produce`;
plus `tests/test_aggregates.py::test_input_digest_must_be_a_sha256`.

## Read side — after the run

The write side ends at persistence. Everything a user sees comes from
`adapters/duckdb/queries/*.py`, importable **only** by `web/` (**C4**), returning **non-domain DTOs**.
Never inline SQL in a route.

| Module | Answers |
|---|---|
| `findings.py` | the findings list, from `mv_finding` (restates the ordering triple) |
| `runs.py` | run list, run detail, `list_alerts`, `run_outcome_counts` → the **run-health** panel |
| `recommendations.py` | one recommendation's detail, plus `severity_history` |
| `traces.py` | shapes `alert.trace` JSON into the explanation ladder |
| `allocation.py`, `buckets.py`, `holdings.py`, `operations.py` | the portfolio surfaces |
| `snapshots.py` | `drift_history` |
| `strategies.py` | strategy list/detail, `rule_catalog_kinds` |
| `it_locale.py` | Italian number/money/percent/date formatting (**P14**) |

## The full gate

Before merging anything (from `CLAUDE.md`):

```bash
uv run ruff check src tests      # NOT `ruff check .` — that descends into .claude/worktrees/
uv run mypy                      # strict
uv run lint-imports              # C1-C5
uv run pytest -q
uv run financeos seed demo && uv run financeos evaluate   # asserts exact numbers in demo/expected/
node docs/design/audit_offline.mjs
```

The demo run is **part of the gate, not a smoke test**.
