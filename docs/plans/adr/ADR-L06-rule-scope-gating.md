# ADR-L06 — Rule scope gating: which evaluation call a Rule applies to

| | |
|---|---|
| **Status** | Accepted (task #13/#14, W2-rule-scope-partition.md follow-up) |
| **Date** | 2026-08-03 |
| **Resolves** | W2-rule-scope-partition.md §2's open design question: *"Today no field on `Rule` or `LeafCondition` distinguishes 'applies to any Bucket using this version' from 'applies only at Portfolio scope' from 'applies only to this one named Bucket.'"* |
| **Depends on** | RFC-0006 §3 / §3.1 (the closed catalog; the no-computation boundary), RFC-0006 §4 (`FactSet`, `unavailable`), RFC-0007 §5 (`scope: portfolio` requires homogeneous governance or `SKIPPED(heterogeneous_strategies)`), C2 (engines take no ports), ADR-L04/ADR-L05 (house style) |
| **Blocks** | The §8.5 demo-fixture partition (10/9/8/1) — a separate, later task. This ADR only unblocks the engine-side mechanism the fixture will need. |

---

## 1. Context

`rule_engine.evaluate(rules, facts)` evaluates every rule in `sv.rules` against whichever single
scope's `facts` the caller assembled. Nothing gates a rule to the scope it is meant for:
`drift_outside_tolerance`, `untargeted_allocation`, `allocation_absent` and `over_apportioned` all
carry a `scope: str` param, but RFC-0006 §3.1 states plainly that the Rule Engine performs no
financial computation and holds no notion of "this call's scope" to compare against — and indeed
`params.scope` today is read only inside each kind's message-binding helper, never compared to
anything.

`cli.py evaluate` only ever constructs `Scope.for_bucket(...)`, so the gap was invisible: one
`StrategyVersion`'s rules were only ever evaluated once, against one scope. Adding a Portfolio-scope
call (task #14, RFC-0007 §5) changes that — the same `sv.rules` collection is now evaluated at
**two** different scopes for one Portfolio, and nothing stops a rule authored for one of them from
running at both.

## 2. Decision Drivers

- **C2 / RFC-0006 §3.1.** The engine takes no ports and performs no financial computation, so it
  must not be taught to compare a rule's declared scope against the facts it was handed — that
  reasoning belongs to the application layer, which already assembles scope-specific facts one call
  at a time (RFC-0005 §3's composition point, `evaluate_strategy`).
- **No authoring migration for the one rule that exists today.** `demo/` is frozen for this task
  (a separate, later task owns the fixture). Whatever default this ADR picks must leave every rule
  authored without an explicit gate behaving exactly as it does today — including under a **newly
  added** Portfolio-scope call it was never evaluated against before.
- **`unassigned_residual_above` carries no `scope` param at all** (ADR-0029: portfolomo-scoped by
  nature) — its own condition params contain no scope hint to fall back on. Any mechanism must
  still be able to gate a rule authored on it.

## 3. Considered Options

1. **A field on `LeafCondition`.** Rejected: `params` is validated per-kind by the catalog's own
   Pydantic model (RFC-0006 §2/§9), and a gate is not a condition parameter — it would have to be
   re-declared on all eleven kinds' params models, most of which have no legitimate reason to know
   about it.
2. **Scope-kind matching in the app layer over the existing `params["scope"]` string, with no new
   field.** Promotes the existing (currently decorative) string to also be the applicability gate.
   Works for four kinds; leaves `unassigned_residual_above` — and any future kind authored without a
   `scope` param — with no way to narrow.
3. **A new field on `Rule`, `scope_gate`, an explicit override; falling back to option 2's inference
   when unset; unconstrained (applies to whichever call it is given) when neither is present.**
4. **Teach the engine `evaluate(rules, facts, *, scope)` and filter internally.** Rejected outright
   on C2/§3.1 — this is exactly "teaching the engine about scope" the corpus's own open question
   warns against, and it would need a port-free way to resolve a Bucket-specific gate's `BucketId`
   against `scope.id`, which the engine has no business doing.

## 4. Decision Outcome

**Option 3.** A new model, `RuleScopeGate` (`core/strategy/rule.py`), plus a new optional field on
`Rule`:

```python
class RuleScopeGate(DomainModel):
    kind: ScopeKind                    # BUCKET | PORTFOLIO
    bucket_id: BucketId | None = None  # only meaningful when kind is BUCKET

    def applies_to(self, scope: Scope) -> bool: ...

class Rule(DomainModel):
    ...
    scope_gate: RuleScopeGate | None = None
```

`RuleScopeGate.applies_to`:

| `kind` | `bucket_id` | Applies to |
|---|---|---|
| `BUCKET` | `None` | Every governed Bucket's call (the generic case: one rule, evaluated once per Bucket) |
| `BUCKET` | set | That one named Bucket's call only |
| `PORTFOLIO` | must be `None` (construction-time guard) | The Portfolio-scope call only |

The application layer (`app/evaluate_strategy.py`) filters `sv.rules` immediately before calling
`rule_engine.evaluate`, per C2:

```python
rules = tuple(rule for rule in sv.rules if _applies_to_this_call(rule, scope))
firings = evaluate(rules, facts)
```

### 4.1 The three-level lookup

`_applies_to_this_call(rule, scope)`:

1. **An explicit `rule.scope_gate` wins**, whatever it says.
2. **Otherwise, `rule.condition.params["scope"]`, if present and parseable as a canonical `Scope`
   ref** (`"bucket:<uuid>"` / `"portfolio:<uuid>"`, the same string `Scope.ref` already produces),
   narrows the rule to *exactly* that scope. This is §3's option 2, and it is the reason no existing
   rule — including `demo/strategy.yaml`'s single authored rule, which already writes
   `scope: "bucket:44940ba1-..."` — needs any authoring change to keep behaving correctly once a
   second (Portfolio) scope call exists.
3. **With neither, the rule is unconstrained**: it applies to whichever call it is given. This is
   `unassigned_residual_above`'s case (no `scope` param, ADR-0029) and is exactly today's implicit
   behaviour for every rule, preserved byte-for-byte.

A firing on a rule the current call's scope does not gate for is not evaluated at all — not even a
`SKIPPED` row is produced for it. It is excluded from `rules` before `evaluate` ever sees it, the
same way a `disabled` rule reaches `evaluate` but a gated-out-of-this-call rule never does.

### 4.2 Why promote `params["scope"]` rather than only add the new field

Rejected minimal alternative: ship only the new `scope_gate` field, defaulting every rule
(including the one demo/ rule) to unconstrained. This was tried first and it breaks
`tests/test_golden_demo.py`: the demo's one `drift_outside_tolerance` rule, authored against one
Bucket's own ref, would then also evaluate at the newly-added Portfolio-scope call — the same drift
fact computed at Portfolio-level allocation, producing a second `Alert` for the same `rule_id`
in the same `as_of`, doubling the golden file's asserted `alert_count`. Since `demo/` cannot be
touched to add an explicit gate (frozen for this task) and the test cannot be edited to accept the
new count, the fix has to come from a default that reads the rule's own already-authored intent —
and `params["scope"]` already states it, verbatim, for exactly the kinds that need it. This also
directly closes the W2 plan's own observation that the string is "read only as a message binding,
never compared" — after this ADR it is compared, by default, which is the natural resolution the
plan's wording points at rather than a new invention.

## 5. Consequences

### 5.1 File-by-file

| File | Change |
|---|---|
| `src/financeos/core/strategy/rule.py` | `RuleScopeGate` (frozen, `extra=forbid`), `applies_to`, a construction-time guard rejecting `bucket_id` set with `kind=PORTFOLIO`; `Rule.scope_gate: RuleScopeGate \| None = None`. |
| `src/financeos/core/strategy/__init__.py` | Exports `RuleScopeGate`. |
| `src/financeos/app/evaluate_strategy.py` | `_condition_scope_ref`, `_applies_to_this_call`; `sv.rules` is subset before `evaluate(...)`. Also: heterogeneous-governance detection for Portfolio scope and the `SkipReason.HETEROGENEOUS_STRATEGIES` wiring (RFC-0007 §5, task #14) — the two land together because the Portfolio-scope call this ADR gates is the same call that needs the heterogeneity check. |
| `src/financeos/adapters/importers/yaml_strategy.py` | `_parse_scope_gate` — optional `scope_gate:` block in authored YAML, parsed only when present. `demo/strategy.yaml` is not touched; nothing requires it to declare one. |
| `src/financeos/cli.py` | `evaluate` additionally calls `evaluate_strategy` once per governed Portfolio (task #14), alongside the existing per-Bucket loop, when no `--bucket-id` filter narrows to one Bucket. |
| `src/financeos/core/shared/enums.py` | `SkipReason.HETEROGENEOUS_STRATEGIES`. |
| `src/financeos/adapters/duckdb/queries/allocation.py` | `TARGETS_HETEROGENEOUS` now aliases the enum member instead of a duplicated string literal. |
| `src/financeos/web/labels.py` | Removed the now-stale comment describing the label as "drafted ahead of the enum member." |
| `src/financeos/adapters/duckdb/queries/runs.py` | `run_outcome_counts`: `coalesce(count_if(...), 0)` — see §5.3. |
| `src/financeos/adapters/duckdb/queries/snapshots.py` | `drift_history` collapses to one row per `(portfolio_id, as_of)` — see §5.3/§6.1 (owner ruling). |
| `tests/test_evaluate_strategy.py` | `TestRuleScopeGateModel`, `TestRuleScopeGating` (a Bucket-gated and a Portfolio-gated rule are mutually exclusive across the two calls), `TestHeterogeneousGovernance` (`SKIPPED(heterogeneous_strategies)` from `evaluate_strategy`), `TestSnapshotDedupeAcrossScopeCalls` (an N-Bucket Portfolio yields exactly one `DriftPoint` per `as_of`). |

### 5.2 Positive

- No authoring migration for `demo/` or any rule that predates this ADR.
- The gate lives where C2 says it must: the application layer decides which rules a call sees; the
  engine still knows nothing about scope.
- `params["scope"]`, previously inert, now does real work, closing the exact gap the W2 plan named.

### 5.3 Negative / accepted costs, and one found defect requiring a decision

- **Two lookup paths to reason about** (`scope_gate`, then `params["scope"]`) instead of one. This
  is the direct cost of not touching `demo/`; a single mechanism would be simpler if authoring were
  free to change everywhere.
- **`run_outcome_counts` defect, found and fixed as a direct consequence of this ADR.**
  `count_if(...)` returns `NULL` (not `0`) over a zero-row group in DuckDB, unlike `count(*)` on the
  same empty result. Every Bucket-scope call before this ADR always evaluated at least one rule, so
  a run with zero `alert` rows never existed in practice; the Portfolio-scope call this ADR's rule
  gating makes possible for a single-Strategy Portfolio (its one rule gated out of the Portfolio
  call entirely) is the first case that reaches it. Fixed with `coalesce(..., 0)`; recorded here
  because it was latent before this change and only this change made it reachable.
- **A pre-existing read-side defect, made universal rather than created.** `evaluate_strategy` has
  always written a full Portfolio-wide `Snapshot` on **every** call (RFC-0009 §5.1) — this ADR does
  not touch that, and the owner ruling below confirms it stands. `cli.py:216-229` already looped
  **every** Bucket before this ADR, so an N-Bucket Portfolio already made N `evaluate_strategy`
  calls per `as_of` and already wrote N identical `Snapshot` rows at that `as_of`; `drift_history`
  (assumed at most one row per `as_of`) already returned N duplicate points per date for such a
  Portfolio. The three tests that surfaced this — `tests/test_queries.py`'s two `drift_history`
  tests and `tests/test_web_runs.py::test_provenance_bar_links_to_run_health` — passed only because
  the demo fixture is a single-Bucket Portfolio, where N happened to be 1. This ADR's
  Portfolio-scope call did not create the defect: it added one more call alongside the (already
  N ≥ 1) Bucket-scope loop, turning `N` into `N + 1` and making the multiplicity universal —
  reachable even at `N = 1` — rather than a latent property of multi-Bucket Portfolios nobody had
  written a fixture for yet.

  **Owner ruling: dedupe read-side.** RFC-0009 §5.1 stands unchanged — every `evaluate_strategy`
  call still writes its own `Snapshot`; the write side is not touched. `drift_history`
  (`adapters/duckdb/queries/snapshots.py`) now collapses to one row per `(portfolio_id, as_of)`,
  picking the latest `recorded_at` (ties broken on `snapshot.id`) via a `row_number()` window,
  keeping the existing `run.mode = 'ACTUAL'` and no-`run_id` exclusions intact. Verified by
  `TestSnapshotDedupeAcrossScopeCalls` (§5.1): a 2-Bucket Portfolio evaluated at both Bucket scopes
  and Portfolio scope for one `as_of` yields exactly one `DriftPoint`. Both `drift_history` tests
  now pass unedited.

  **`test_provenance_bar_links_to_run_health` — a test-fixture defect, not a production one;
  fixed by editing the test (owner ruling).** The homepage's own query (`latest_actual_run`,
  `adapters/duckdb/queries/runs.py`) was never wrong: `ORDER BY run.as_of DESC, run.evaluated_at
  DESC LIMIT 1` is already deterministic and already returns the truly most-recent
  `evaluation_run` row (the Portfolio-scope one, evaluated last in the CLI's loop). The test's
  *own* comparison query — `SELECT id FROM evaluation_run LIMIT 1`, no `ORDER BY`, no `mode`
  filter — never expressed "the run the provenance bar points at"; it expressed "an arbitrary
  run", and only read as the former because exactly one `evaluation_run` row existed when the
  test was written. Like the Snapshot case above, that assumption was already false for any
  N-Bucket Portfolio (`N ≥ 2` rows, arbitrary pick) before this ADR; task #14 only made it
  reachable at `N = 1` too. This is a defect in the test's own fixture query, not in the
  production read path, so the fix is in the test: its query now mirrors `latest_actual_run`
  exactly (`mode = 'ACTUAL'`, `ORDER BY as_of DESC, evaluated_at DESC`), and the assertion is
  strengthened to check both that the bar links to that truly-latest run **and** that it does
  not link to an earlier one — the property the original assertion was silently failing to
  check even when it happened to pass. `latest_actual_run` itself is untouched.

## 6. Consequences of the ruling, and what remains open

### 6.1 Both read-side questions — resolved

- **Snapshot/`drift_history`** (§5.3): read-side dedupe, write side unchanged. `drift_history`'s
  `row_number()`-windowed collapse to one row per `(portfolio_id, as_of)` is the shipped answer.
- **`test_provenance_bar_links_to_run_health`** (§5.3): a test-fixture defect, not a production
  one — the test's own comparison query never expressed "the run the provenance bar points at",
  only "an arbitrary run", and passed before this ADR only because exactly one `evaluation_run`
  row existed for the single-Bucket demo. Fixed by editing the test's query to mirror
  `latest_actual_run` (`mode = 'ACTUAL'`, `ORDER BY as_of DESC, evaluated_at DESC`) and
  strengthening the assertion to also check the bar does *not* link to an earlier run —
  `latest_actual_run` itself was already correct and is untouched.

No further decision needed on either; both close here.

### 6.2 Open item for the product owner

**Authoring convention for a future "generic, any-Bucket" rule.** Today's only example
(`demo/strategy.yaml`) hardcodes one Rule per Bucket, each with its own literal `scope` ref — the
`RuleScopeGate(kind=BUCKET, bucket_id=None)` "any Bucket" case is implemented and tested
(`TestRuleScopeGateModel`) but has no authored example yet. The §8.5 fixture task should confirm
which authoring shape it wants for the "7 generic rules" row before writing it.
